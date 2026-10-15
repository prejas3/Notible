// Scenario: R5 "Every screen" (0.94.0, repair plan §6: L1, L2, L6, L7, F1–F4, G10).
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/r5-every-screen.cjs [--shots <dir>]
//
// Under 700 px the sidebar slides over the page from a menu button and closes when you go
// somewhere; Ctrl+K opens search; Ctrl+= / Ctrl+0 change the interface size, also in Appearance;
// a search needs every word, lists items first with where they live and a snippet, and says
// "Nothing matches" only when nothing does; a short note's footer sits under its text; tree rows
// carry their full title; in Midnight the text that the audits doubted reaches WCAG contrast.
// Needs a fresh `npm run sandbox:build`. Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const shotsAt = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });
const NAME = process.env.SANDBOX || "claude-r5";
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message) => { console.log(`${ok ? "PASS" : "FAIL"} ${message}`); if (!ok) failures.push(message); };
const CREATE = { name: "Create a note, folder or project", exact: true };

async function open(size, reuse) {
  const info = JSON.parse(sandboxCli("start", NAME, "--size", size, ...(reuse ? ["--reuse"] : [])));
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  // The shell, not the + button: under 700 px the sidebar (and its +) is hidden until opened.
  await page.locator(".core-shell .core-main").waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  return { browser, page };
}

/** WCAG contrast of an element's text against the nearest opaque background behind it. */
const CONTRAST = () => {
  const parse = (value) => { const m = value.match(/rgba?\(([^)]+)\)/u); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/u).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  window.__contrast = (el) => {
    const fg = parse(getComputedStyle(el).color);
    let bg = null;
    for (let node = el; node; node = node.parentElement) { const c = parse(getComputedStyle(node).backgroundColor); if (c && c.a > 0.9) { bg = c; break; } }
    bg ??= parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255 };
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
  };
  /** A colour (a border, a ring) against what is behind the element. */
  window.__contrastOf = (el, colour) => {
    const fg = parse(colour);
    let bg = null;
    for (let node = el.parentElement; node; node = node.parentElement) { const c = parse(getComputedStyle(node).backgroundColor); if (c && c.a > 0.9) { bg = c; break; } }
    bg ??= parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255 };
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
  };
};

(async () => {
  let session;
  try {
    // ---- Wide enough: content, search, zoom, footer, contrast ----
    session = await open("1366x768", false);
    let { page } = session;
    const shot = async (name) => { if (shotsAt) await page.screenshot({ path: path.join(shotsAt, `r5-${name}.png`) }); };

    // Two notes and a project to search across (setup through the data API).
    await page.evaluate(async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const doc = (text) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
      const project = await invoke("create_object", { type: "project", title: "Office move", content: doc(""), props: "{}", parentId: null });
      await invoke("create_object", { type: "note", title: "Shopping", content: doc("We need milk, bread and a dozen eggs before the movers arrive on Monday morning, plus coffee for everyone."), props: "{}", parentId: project.id });
      await invoke("create_object", { type: "task", title: "Pack the kitchen", content: doc("Mugs, kettle and the old toaster."), props: JSON.stringify({ status: "todo" }), parentId: project.id });
      await invoke("create_object", { type: "note", title: "A very long note title that will not fit into the sidebar at all", content: doc("Short."), props: "{}", parentId: null });
    });
    await page.reload();
    await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });

    // F4: Ctrl+K opens search.
    await page.locator(".core-main").click({ position: { x: 600, y: 200 } });
    await page.keyboard.press("Control+k");
    const search = page.locator(".core-sidebar input[type=search], .core-sidebar input").first();
    await search.waitFor();
    check(await search.evaluate((el) => el === document.activeElement), "Ctrl+K opens search with the cursor in it");
    // F3: the filter chips wait behind the Filters button.
    check(await page.locator(".core-search-filters").count() === 0, "the filter chips are hidden until asked for");
    await page.locator(".core-search-filters-toggle").click();
    check(await page.locator(".core-search-filters").count() === 1, "Filters shows them");
    await page.locator(".core-search-filters-toggle").click();
    await search.click();

    // F1/F2: every word, items first, where it lives, a snippet.
    await page.keyboard.type("eggs milk", { delay: 20 });
    await page.waitForTimeout(800);
    const groups = await page.locator(".core-sidebar .core-list-heading span").allTextContents();
    check(groups[0] === "Notes" || groups[0] === "Results", `your items come first (${groups.join(", ")})`);
    const hit = page.locator(".core-search-hit", { hasText: "Shopping" });
    check(await hit.count() === 1, "\"eggs milk\" finds the note with both words, in another order");
    const hitText = await hit.innerText();
    check(/Office move/.test(hitText) && /eggs/.test(hitText), `the hit shows its project and the words around the match (${hitText.replace(/\s+/gu, " ")})`);
    await shot("search");
    await search.fill("");
    await page.keyboard.type("kitch", { delay: 20 });
    await page.waitForTimeout(800);
    const heading = (await page.locator(".core-sidebar .core-list-heading span").allTextContents())[0];
    check(heading === "Results", `a task among them makes the heading "Results", not "Notes" (${heading})`);
    await search.fill("");
    await page.keyboard.type("zebra xylophone", { delay: 20 });
    await page.waitForTimeout(800);
    check(await page.locator(".core-sidebar .core-empty", { hasText: "Nothing matches" }).count() === 1, "Nothing matches when nothing does");
    await search.fill("");
    await page.keyboard.type("backup", { delay: 20 });
    await page.waitForTimeout(800);
    const settingsOnly = await page.locator(".core-sidebar .core-list-heading span").allTextContents();
    check(settingsOnly.length > 0 && await page.locator(".core-sidebar .core-empty", { hasText: "Nothing matches" }).count() === 0, `no "Nothing matches" while Settings or Help match (${settingsOnly.join(", ")})`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // L6: tree rows carry their full title.
    const tip = await page.locator(".core-object-row strong", { hasText: "A very long note title" }).getAttribute("title");
    check(tip === "A very long note title that will not fit into the sidebar at all", "a cut-off title shows in full on hover");

    // L2: a short note's footer sits under its text, not at the bottom of the window.
    await page.locator(".core-object-row", { hasText: "A very long note title" }).click();
    await page.waitForTimeout(800);
    const footer = await page.evaluate(() => { const stats = document.querySelector(".core-editor-stats"); return stats ? Math.round(stats.getBoundingClientRect().top) : -1; });
    check(footer > 0 && footer < 768 * 0.85, `the note footer follows the text (top ${footer} px of 768)`);
    await shot("note");

    // L7: Ctrl+= / Ctrl+0 and the Appearance row.
    const width = await page.evaluate(() => innerWidth);
    await page.keyboard.press("Control+=");
    await page.waitForTimeout(600);
    const zoomed = await page.evaluate(() => ({ width: innerWidth, stored: localStorage.getItem("notible-ui-zoom") }));
    check(zoomed.stored === "1.1" && zoomed.width < width, `Ctrl+= makes everything bigger (${width} → ${zoomed.width} px wide, stored ${zoomed.stored})`);
    await page.keyboard.press("Control+0");
    await page.waitForTimeout(600);
    check(await page.evaluate(() => innerWidth) === width, "Ctrl+0 puts it back");
    await page.getByRole("button", { name: "Settings", exact: true }).last().click();
    await page.getByRole("button", { name: /^Appearance/ }).click();
    check(await page.locator("#core-zoom").count() === 1, "Appearance has Interface size");
    // SND1: a notification sound, None until picked, with Preview.
    check(/None/.test(await page.locator("#core-notice-sound").innerText()), "Appearance has Notification sound, None by default");
    // M6: the + menu leads to plugins.
    await page.getByRole("button", CREATE).click();
    await page.locator(".core-create-more").click();
    await page.waitForTimeout(500);
    check(await page.locator(".core-plugin-index-row").count() > 0, "+ → More with plugins… opens the plugin list");
    // M1: before installing, a market plugin says what it will be allowed to do.
    await page.getByRole("tab", { name: "Market" }).click();
    await page.locator(".core-plugin-index-row", { hasText: "ReportIt" }).first().waitFor({ timeout: 30000 });
    await page.locator(".core-plugin-index-row", { hasText: "ReportIt" }).first().click();
    await page.waitForTimeout(600);
    await shot("market-detail");
    const detailText = await page.locator(".core-plugins-detail-pane").first().innerText().catch(() => "");
    check(/Will be allowed to/i.test(detailText), `a market plugin lists what it will be allowed to do before Install (${detailText.replace(/s+/gu, " ").slice(0, 120)})`);

    // G10: measured contrast in Midnight (text 4.5:1).
    await page.evaluate(() => localStorage.setItem("notible-core-theme", "night"));
    await page.reload();
    await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });
    await page.evaluate(CONTRAST);
    await page.getByRole("button", { name: "Settings", exact: true }).last().click();
    await page.getByRole("button", { name: /^Plugins/ }).click();
    await page.waitForTimeout(800);
    const measured = await page.evaluate(() => {
      const pick = (selector) => { const el = document.querySelector(selector); return el ? window.__contrast(el) : null; };
      const offSwitch = [...document.querySelectorAll(".core-switch input")].find((input) => !input.checked)?.nextElementSibling;
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--core-accent").trim();
      const probe = document.createElement("span"); probe.style.color = accent; document.body.append(probe); const accentRgb = getComputedStyle(probe).color; probe.remove();
      return {
        text: { builtIn: pick(".core-plugin-index-meta"), pluginName: pick(".core-plugin-index-row strong, .core-plugin-index-name"), sidebarHeading: pick(".core-list-heading span"), intro: pick(".core-settings-section p") },
        nonText: { offSwitchOutline: offSwitch ? window.__contrastOf(offSwitch, getComputedStyle(offSwitch).borderTopColor) : null, focusRing: offSwitch ? window.__contrastOf(offSwitch, accentRgb) : null },
      };
    });
    for (const [what, ratio] of Object.entries(measured.text)) check(ratio !== null && ratio >= 4.5, `Midnight: ${what} text contrast ${ratio}:1 (≥ 4.5)`);
    for (const [what, ratio] of Object.entries(measured.nonText)) check(ratio !== null && ratio >= 3, `Midnight: ${what} contrast ${ratio}:1 (≥ 3, non-text)`);
    await shot("night-plugins");
    await session.browser.close().catch(() => {});
    session = null;
    sandboxCli("stop", NAME, "--keep");

    // ---- L1: a narrow window ----
    session = await open("640x720", true);
    page = session.page;
    const narrow = await page.evaluate(() => ({ sidebar: getComputedStyle(document.querySelector(".core-sidebar")).visibility, toggle: getComputedStyle(document.querySelector(".core-menu-toggle")).display, main: Math.round(document.querySelector(".core-main").getBoundingClientRect().left) }));
    check(narrow.sidebar === "hidden" && narrow.toggle !== "none" && narrow.main === 0, `under 700 px the content comes first, the sidebar waits behind a menu button ${JSON.stringify(narrow)}`);
    await page.locator(".core-menu-toggle").click();
    await page.waitForTimeout(400);
    const opened = await page.evaluate(() => ({ visible: getComputedStyle(document.querySelector(".core-sidebar")).visibility, left: Math.round(document.querySelector(".core-sidebar").getBoundingClientRect().left), backdrop: Boolean(document.querySelector(".core-sidebar-backdrop")) }));
    check(opened.visible === "visible" && opened.left === 0 && opened.backdrop, `the menu button slides the sidebar over the page ${JSON.stringify(opened)}`);
    if (shotsAt) await page.screenshot({ path: path.join(shotsAt, "r5-narrow-open.png") });
    await page.locator(".core-object-row", { hasText: "Office move" }).click();
    await page.waitForTimeout(700);
    check(await page.evaluate(() => getComputedStyle(document.querySelector(".core-sidebar")).visibility) === "hidden", "opening something closes the sidebar");
    await page.locator(".core-menu-toggle").click();
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    check(await page.evaluate(() => getComputedStyle(document.querySelector(".core-sidebar")).visibility) === "hidden", "Esc closes it too");
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(sideways <= 0, `nothing scrolls sideways at 640 px (${sideways})`);
    if (shotsAt) await page.screenshot({ path: path.join(shotsAt, "r5-narrow-project.png") });
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n").slice(0, 4).join(" | ")}`);
  } finally {
    await session?.browser.close().catch(() => {});
    sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\nR5 every-screen scenario FAILED (${failures.length})` : "\nR5 every-screen scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
