import assert from "node:assert/strict";
import { slugify, createSlugger } from "../src/help/slug.ts";
import { parsePage, splitSections, searchHelp } from "../src/help/parse.ts";
import { inlineCode, postProcessHelpHtml, renderHelpPage } from "../src/help/render.ts";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { HELP_CHAPTERS, HELP_ORDER } from "../src/help/index.ts";

// keys render as keycaps, same markup as HotkeyCaps (Help review 02.10, H-LOOK-04); everything else stays code
{
  const cap = (...keys) => `<span class="core-hotkey-caps">${keys.map((key, index) => `<span>${index ? '<span aria-hidden="true">+</span>' : ""}<kbd>${key}</kbd></span>`).join("")}</span>`;
  assert.equal(inlineCode("Ctrl+N"), cap("Ctrl", "N"));
  assert.equal(inlineCode("Ctrl+,"), cap("Ctrl", ","));
  assert.equal(inlineCode("Alt+←"), cap("Alt", "←"));
  assert.equal(inlineCode("Ctrl+click"), cap("Ctrl", "click"));
  assert.equal(inlineCode("F1"), cap("F1"));
  assert.equal(inlineCode("[["), cap("[["));
  assert.equal(inlineCode("/"), cap("/"));
  assert.equal(inlineCode("type: task"), "<code>type: task</code>");
  assert.equal(inlineCode("A"), "<code>A</code>");
  assert.equal(inlineCode("<b>"), "<code>&lt;b&gt;</code>");
}

// The query block's / entry says "items", like the Help page (H-LOOK-05).
{
  const commands = readFileSync(new URL("../src/core/app/coreCommands.ts", import.meta.url), "utf8");
  // The name is wrapped in tr() for the locale extractor (#51).
  assert.ok(commands.includes('name: tr("Live list of matching items")') && !commands.includes("matching objects"), "the / entry is \"Live list of matching items\"");
}

// slug
assert.equal(slugify("Which one should I use?"), "which-one-should-i-use");
assert.equal(slugify("  Folders & Projects  "), "folders-projects");
const slug = createSlugger();
assert.equal(slug("Views"), "views");
assert.equal(slug("Views"), "views-2");

// parse
const page = parsePage("---\nid: containers\ntitle: Organising your work\nkeywords: folder project\n---\n\nIntro text.\n\n## Folders\n\nAnything goes.\n\n## Projects\n\nManage work.\n");
assert.equal(page.id, "containers");
assert.equal(page.title, "Organising your work");
assert.ok(page.body.startsWith("Intro text."));
assert.throws(() => parsePage("no front matter"), /missing front matter/);

// sections
const sections = splitSections(page);
assert.deepEqual(sections.map((s) => s.slug), ["", "folders", "projects"]);
assert.equal(sections[1].heading, "Folders");
assert.ok(sections[1].text.includes("Anything goes."));

// search: tokenised, every token must match, scored title 0 < heading 1 < text 2 < keywords 3, summed
assert.deepEqual(searchHelp(sections, "manage work").map((s) => s.slug), ["projects"]);
assert.equal(searchHelp(sections, "folders").map((s) => s.slug)[0], "folders");
assert.equal(searchHelp(sections, "folder anything")[0].slug, "folders", "a heading/text hit beats a page-wide keyword hit");
assert.equal(searchHelp(sections, "").length, 0);
assert.equal(searchHelp(sections, "zzz").length, 0);

{
  const html = postProcessHelpHtml(
    '<h2>Views</h2><p>See [projects](help:containers#projects), [plugins](settings:plugins), [docs](https://mermaid.js.org) and [bad](javascript:alert(1)).</p>'
    + '<h2>Views</h2><img class="core-md-image" alt="The slash menu" src="help/slash-menu.webm"><img class="core-md-image" alt="Tree" src="help/tree.webp">'
    + '<pre class="core-code-block"><code>[x](help:containers)</code></pre>',
  );
  assert.ok(html.includes('<h2 id="views">'));
  assert.ok(html.includes('<h2 id="views-2">'));
  assert.ok(html.includes('data-help="containers" data-help-slug="projects"'));
  assert.ok(html.includes('data-settings="plugins"'));
  assert.ok(html.includes('data-external="https://mermaid.js.org"'));
  assert.ok(html.includes("[bad](javascript:alert(1))"), "unknown schemes stay text");
  assert.ok(html.includes('<video class="core-help-video" src="help/slash-menu.webm"'));
  assert.ok(html.includes('src="help/tree.webp"'), "webp stays an img");
  assert.ok(html.includes("<code>[x](help:containers)</code>"), "code is untouched");
}

// Inline code survives the note renderer literally (injected fake renderer:
// marks and wikilinks would be turned into HTML if the code leaked through).
{
  const fake = (text) => text.replace(/\*\*(.+?)\*\*/gu, "<strong>$1</strong>").replace(/\[\[(.+?)\]\]/gu, '<span class="core-md-wikilink">$1</span>');
  const html = renderHelpPage("Type `**bold**` or `[[a note]]` — **real**.", fake);
  assert.ok(html.includes("<code>**bold**</code>"), html);
  assert.ok(html.includes("<code>[[a note]]</code>"), html);
  assert.ok(html.includes("<strong>real</strong>"), html);
}

// Content integrity: pages ↔ index, front matter, headings, links, media.
{
  const dir = new URL("../src/help/pages/", import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
  const pages = new Map(files.map((name) => {
    const page = parsePage(readFileSync(new URL(name, dir), "utf8"));
    assert.equal(`${page.id}.md`, name, `${name}: id must equal file name`);
    assert.match(page.id, /^[a-z0-9-]+$/u, `${name}: id must be [a-z0-9-]`);
    return [page.id, page];
  }));
  assert.equal(new Set(HELP_ORDER).size, HELP_ORDER.length, "a page is listed twice in index.ts");
  for (const id of HELP_ORDER) assert.ok(pages.has(id), `index.ts lists "${id}" but src/help/pages/${id}.md is missing`);
  for (const id of pages.keys()) assert.ok(HELP_ORDER.includes(id), `src/help/pages/${id}.md is not listed in index.ts`);
  assert.ok(HELP_CHAPTERS.every((chapter) => chapter.pages.length > 0), "empty chapter");

  const slugsOf = new Map([...pages].map(([id, page]) => [id, new Set(splitSections(page).map((s) => s.slug))]));
  for (const [id, page] of pages) {
    assert.ok(!/^####/mu.test(page.body), `${id}: use at most ### headings`);
    // Code (fenced or inline) may show [[x]] literally; running text may not.
    const prose = page.body.replace(/```[\s\S]*?```/gu, "").replace(/`[^`]+`/gu, "");
    assert.ok(!/\[\[[^\]]*\]\]/u.test(prose), `${id}: no [[wikilinks]] in Help (put examples in backticks)`);
    for (const [, , target] of page.body.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/gu)) {
      if (target.startsWith("help/")) {
        assert.match(target, /\.(webp|png|webm)$/u, `${id}: media must be .webp/.png/.webm: ${target}`);
        assert.ok(existsSync(new URL(`../public/${target}`, import.meta.url)), `${id}: missing media public/${target}`);
      } else if (target.startsWith("help:")) {
        const [linked, anchor] = target.slice(5).split("#");
        assert.ok(pages.has(linked), `${id}: link to unknown page ${target}`);
        if (anchor) assert.ok(slugsOf.get(linked).has(anchor), `${id}: link to unknown heading ${target}`);
      } else {
        assert.ok(target === "settings:plugins" || /^https?:\/\//u.test(target), `${id}: link target not allowed: ${target}`);
      }
    }
  }
}

// Every built-in plugin has a page in the Plugins chapter. The check may read
// plugins/builtin; only Core code (src/help) may not.
{
  const { BUILTIN_PLUGINS } = await import("../plugins/builtin/index.ts");
  const pluginPages = HELP_CHAPTERS.find((chapter) => chapter.title === "Plugins")?.pages ?? [];
  const missing = BUILTIN_PLUGINS
    .map((plugin) => `plugin-${plugin.manifest.id.replace(/^notible\./u, "").replace(/[^a-z0-9-]/gu, "-")}`)
    .filter((id) => !pluginPages.includes(id));
  assert.deepEqual(missing, [], `built-in plugins without a Help page in the Plugins chapter: ${missing.join(", ")}`);
}

// I18N (Hive #54): every builtin view title and manifest name that Core draws is in
// BUILTIN_TITLE_KEYS, so locale:extract sees it. A title added to plugins/builtin without
// that list would stay English in Polish.
{
  const marked = new Set([...readFileSync(new URL("../src/core/app/builtinTitles.ts", import.meta.url), "utf8").matchAll(/tr\("([^"]+)"\)/g)].map((match) => match[1]));
  const builtinDir = new URL("../plugins/builtin/", import.meta.url);
  const titles = new Set();
  for (const file of readdirSync(builtinDir).filter((name) => /\.tsx?$/.test(name))) {
    const source = readFileSync(new URL(file, builtinDir), "utf8");
    for (const match of source.matchAll(/viewTitle:\s*"([^"]+)"/g)) titles.add(match[1]);
    // manifest name, on the same line as the id or on the next one
    for (const match of source.matchAll(/id:\s*"notible\.[^"]+",\s*name:\s*"([^"]+)"/g)) titles.add(match[1]);
    // extraViews entries written on one line: { id, title, ... }
    for (const match of source.matchAll(/\{\s*id:\s*"[^"]+",\s*title:\s*"([^"]+)"/g)) titles.add(match[1]);
    // settings titles (literal, or a function over the plugin's t) and command text Core draws in the detail pane
    for (const match of source.matchAll(/settingsTitle:\s*"([^"]+)"/g)) titles.add(match[1]);
    for (const match of source.matchAll(/settingsTitle:\s*\(t\)\s*=>\s*t\("([^"]+)"\)/g)) titles.add(match[1]);
    for (const match of source.matchAll(/\{\s*id:\s*"[^"]+",\s*name:\s*"([^"]+)",\s*description:\s*"([^"]+)"/g)) titles.add(match[1]).add(match[2]);
  }
  assert.ok(titles.size >= 19, "the scan finds the builtin titles");
  assert.deepEqual([...titles].filter((title) => !marked.has(title)).sort(), [], "every builtin view title and manifest name is in src/core/app/builtinTitles.ts");
}

// I18N (Hive #58 round 2): every PLUGIN_EXAMPLES value is tr("…") so locale:extract sees it;
// a bare string would stay English in Polish without any check failing.
{
  const enrichment = readFileSync(new URL("../src/product/plugin-enrichment.ts", import.meta.url), "utf8");
  const block = enrichment.slice(enrichment.indexOf("export const PLUGIN_EXAMPLES")).split("\n};")[0];
  const bare = [...block.matchAll(/"notible\.[^"]+": "/gu)].map((match) => match[0]);
  assert.deepEqual(bare, [], "every PLUGIN_EXAMPLES text is wrapped in tr() in src/product/plugin-enrichment.ts");
}

console.log("help-check: modules and content ok");
