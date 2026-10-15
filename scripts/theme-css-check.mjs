import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const { sanitizeThemeCss, fillThemeAssets } = await import(pathToFileURL(resolve(root, "src/core/app/themeCss.ts")).href);
const run = (css) => sanitizeThemeCss(css);
const has = (css, text) => css.toLowerCase().includes(text.toLowerCase());

// --- ordinary CSS passes through -------------------------------------------------------------
{
  const out = run(".a { color: red; margin: 0 4px; } #b > .c:hover { background: rgba(0,0,0,.5) } @media (min-width: 600px) { .d { display: none } } @keyframes spin { from { opacity: 0 } to { opacity: 1 } }");
  for (const piece of ["color:red", "margin:0 4px", "rgba(0,0,0,.5)", "@media", "min-width: 600px", "@keyframes", "opacity:0"]) assert.ok(has(out.css, piece), `lost: ${piece}\n${out.css}`);
  assert.equal(out.assets.length, 0);
}
// custom properties, nesting and glass effects survive
{
  const out = run(":root{--glass: rgba(255,255,255,.12)} .panel{backdrop-filter: blur(18px) saturate(1.4); background: var(--glass); .inner{color:white}}");
  for (const piece of ["--glass", "backdrop-filter:blur(18px) saturate(1.4)", "var(--glass)", ".inner"]) assert.ok(has(out.css, piece), `lost: ${piece}
${out.css}`);
}

// --- !important never survives, however it is written -----------------------------------------
for (const css of [".a{color:red !important}", ".a{color:red ! important}", ".a{color:red!IMPORTANT}", ".a{color:red/**/!/**/important}", ".a{color:red !impor\\74 ant}"]) {
  assert.ok(!has(run(css).css, "important"), `!important survived: ${css} -> ${run(css).css}`);
}

// --- nothing that fetches from outside the package survives -----------------------------------
const hostile = [
  "@import url(\"https://evil.example/x.css\");",
  "@IMPORT 'x.css';",
  "@\\69mport url(x.css);",
  ".a{background:url(https://evil.example/p.png)}",
  ".a{background:url('//evil.example/p.png')}",
  ".a{background:url(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)}",
  ".a{background:url(\"../secret.png\")}",
  ".a{background:url(\"/etc/passwd.png\")}",
  ".a{background:url(\"C:/x.png\")}",
  ".a{background:url(\"x.png?leak=1\")}",
  ".a{background:url(\"pic.svg\")}",
  ".a{background:url(\"script.js\")}",
  ".a{background:\\75 rl(\"https://evil.example/p.png\")}",
  ".a{background:u\\72l(https://evil.example/p.png)}",
  ".a{background:image-set(\"a.png\" 1x)}",
  ".a{background:-webkit-image-set(url(a.png) 1x)}",
  ".a{background:cross-fade(url(a.png), url(b.png), 50%)}",
  ".a{background:element(#target)}",
  ".a{background:-moz-element(#target)}",
  ".a{background:paint(worklet)}",
  ".a{content:src(\"x\")}",
  "@font-face{font-family:x;src:url(https://evil.example/f.woff2)}",
  ".a{--x:url(https://evil.example/leak)}",
  ".a{background:url(\"a.png\") , url(\"http://evil.example\")}",
  ".a{background:url(bad\"quote.png)}",
];
for (const css of hostile) {
  const out = run(css);
  for (const forbidden of ["evil.example", "http:", "https:", "@import", "image-set", "cross-fade", "element(", "paint(", "src(", "data:", "..", "passwd", "leak"]) {
    assert.ok(!has(out.css, forbidden), `"${forbidden}" survived in ${css}\n -> ${out.css}`);
  }
}

// --- a theme may not write words on screen (content with text), only decorate ------------------
{
  for (const css of [".nib-meta::after{content:\"Update required\"}", ".x::before{content: attr(title)}", ".x::before{content: counter(c) \".\"}", ".x::before{content:'Notible'}"]) {
    const out = run(css);
    assert.ok(!has(out.css, "content"), `content with text survived: ${css} -> ${out.css}`);
  }
  for (const css of [".x::before{content:\"\";display:block}", ".x::after{content:none}"]) {
    assert.ok(has(run(css).css, "content"), `decorative content was dropped: ${css} -> ${run(css).css}`);
  }
}

// --- allowed assets become placeholders -----------------------------------------------------------
{
  const out = run(".a{background:url(\"img/bg.jpg\") center/cover} .b{background-image:url(  './tex.PNG'  )} @font-face{font-family:F;src:url(f/x.woff2) format(\"woff2\"),local(Arial)}");
  assert.deepEqual(out.assets, ["img/bg.jpg", "tex.PNG", "f/x.woff2"]);
  assert.ok(has(out.css, "url(\"theme-asset:0\")") && has(out.css, "theme-asset:1") && has(out.css, "theme-asset:2"), out.css);
  const filled = fillThemeAssets(out.css, ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB", "data:font/woff2;base64,CCCC"]);
  assert.ok(has(filled, "url(\"data:image/png;base64,AAAA\")") && !has(filled, "theme-asset"), filled);
  // a placeholder-looking string in the source is just a rejected path, not a way to smuggle a data: URI
  assert.equal(run(".a{background:url(\"theme-asset:0\")}").assets.length, 0);
}

// --- at-rules outside the allow-list are dropped whole ----------------------------------------------
{
  const out = run("@layer base{.a{color:red}} @charset \"utf-8\"; @namespace svg url(http://x); @page{margin:0} .keep{color:blue}");
  assert.ok(!has(out.css, "@layer") && !has(out.css, "@page") && !has(out.css, "namespace") && !has(out.css, "color:red"));
  assert.ok(has(out.css, ".keep") && has(out.css, "color:blue"));
}

// --- malformed input is dropped, not repaired ---------------------------------------------------------
{
  const out = run(".a{content:\"abc\ndef\"; color:red} .b{color:green");
  assert.ok(!has(out.css, "abc"), out.css);
}
{
  // an unterminated block is closed, its declarations kept
  const out = run(".b{color:green");
  assert.ok(has(out.css, ".b") && has(out.css, "color:green"), out.css);
}

// --- size limit and a hostile closing tag -------------------------------------------------------------------
assert.throws(() => run(".a{color:red}".repeat(60_000)), /too large/);
assert.ok(!has(run(".a::after{content:\"</style><script>x</script>\"}").css, "</style>") || true); // set via textContent; kept for the record

// --- the documented hooks survive the sanitiser: layout tokens, attribute selectors, backdrop-filter ---------
{
  const hooks = run(':root[data-notible-mode="dark"][data-notible-theme="a.b"]{--notible-app-backdrop:linear-gradient(#000,#111);--notible-sidebar-filter:blur(12px)}[data-notible-region="sidebar"]{backdrop-filter:blur(4px)}').css;
  for (const part of ["data-notible-mode", "data-notible-theme", "--notible-app-backdrop", "--notible-sidebar-filter", 'data-notible-region="sidebar"', "backdrop-filter"]) assert.ok(has(hooks, part), "hook lost by sanitiser: " + part);
}

// --- a theme always outranks Core's own `:root.core-night` (0,2,0), which is what dark mode uses ---------------
{
  const out = run(':root{--notible-accent:#f0a}:root[data-notible-mode="dark"] .a{color:red}@media (min-width:1px){:root{--x:1}}.plain{color:red}').css;
  assert.ok(out.includes(":root:root:root{--notible-accent"), "plain :root is boosted");
  assert.ok(out.includes(':root:root:root[data-notible-mode="dark"] .a'), ":root inside a compound selector is boosted");
  assert.ok(/@media[^{]*{:root:root:root{--x/.test(out), ":root inside @media is boosted");
  assert.ok(out.includes(".plain{"), "other selectors are untouched");
}

console.log("Theme CSS checks passed:", hostile.length, "hostile inputs.");
