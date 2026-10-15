// MERMAID-COLORS (Hive #41): diagrams follow the app theme (no white box in
// Midnight), colour pickers change the settings preview and the note's
// diagram, Auto follows a theme switch on the next redraw.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/mermaid-appearance.cjs
//
// Needs a fresh `npm run sandbox:build`. Screenshots land in SHOTS (default:
// the sandbox's exports folder). Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-mermaid";
// Run once per size the UI gate needs: SIZE=1024x700 (default) and SIZE=1920x1080.
const SIZE = process.env.SIZE || "1024x700";
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };

(async () => {
  const info = JSON.parse(sandboxCli("start", NAME, "--size", SIZE));
  const shots = process.env.SHOTS || info.exports;
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  // `at`: scroll that element into view first (the settings panel sits below the plugin details).
  const shot = async (name, at) => {
    if (at) await page.locator(at).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, `${SIZE}-${name}.png`) });
  };
  const type = (text) => page.keyboard.type(text, { delay: 25 });
  const noteDiagram = () => page.locator(".core-code-render .core-mermaid-diagram").first();
  // What the user sees behind and in the diagram, as computed colours.
  const look = (locator) => locator.evaluate((root) => {
    const svg = root.querySelector("svg");
    const node = svg?.querySelector(".node rect, .node polygon, .node path");
    const cluster = svg?.querySelector(".cluster rect");
    const edge = svg?.querySelector(".flowchart-link, .edgePath path");
    return {
      box: getComputedStyle(root).backgroundColor,
      fixedPanel: root.classList.contains("has-fixed-light-theme"),
      svgBackground: svg ? getComputedStyle(svg).backgroundColor : null,
      nodeFill: node ? getComputedStyle(node).fill : null,
      nodeStroke: node ? getComputedStyle(node).stroke : null,
      clusterFill: cluster ? getComputedStyle(cluster).fill : null,
      edge: edge ? getComputedStyle(edge).stroke : null,
      // The visible text: the <p> inside the label, which host CSS once restyled.
      label: svg?.querySelector(".nodeLabel p, .nodeLabel") ? getComputedStyle(svg.querySelector(".nodeLabel p, .nodeLabel")).color : null,
    };
  });
  const clear = (color) => color === "rgba(0, 0, 0, 0)" || color === "transparent";
  const isWhite = (color) => /^rgba?\(255, 255, 255/u.test(color ?? "");
  const openSettings = async () => { await page.getByRole("button", { name: "Settings", exact: true }).last().click(); await page.waitForTimeout(500); };
  const setTheme = async (label) => {
    await openSettings();
    await page.locator(".core-settings-nav button", { hasText: "Appearance" }).first().click();
    await page.locator("#core-theme").click();
    await page.getByRole("option", { name: label, exact: true }).click();
    await page.waitForTimeout(500);
  };
  const openDiagramSettings = async () => {
    await openSettings();
    await page.locator(".core-settings-nav button", { hasText: "Plugins" }).first().click();
    await page.locator(".core-plugin-index-row", { hasText: "Editor extensions" }).first().click();
    await page.locator(".mermaid-settings-preview svg").waitFor({ timeout: 15000 });
    await page.locator("#mermaid-theme").scrollIntoViewIfNeeded();
  };
  const preview = () => page.locator(".mermaid-settings-preview");
  const backToNote = async () => {
    await page.keyboard.press("Escape");
    await page.locator(".core-object-row", { hasText: "Diagram" }).first().click().catch(() => {});
    await noteDiagram().locator("svg").waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
  };

  try {
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).click();
    await page.getByRole("button", { name: "New note" }).first().click();
    await page.locator(".core-title-input").waitFor();
    await page.waitForTimeout(300);
    await type("Diagram");
    await page.keyboard.press("Enter");
    await type("/mermaid");
    await page.locator(".core-slash-menu [role=option]", { hasText: "Mermaid diagram" }).first().waitFor({ timeout: 3000 });
    await page.keyboard.press("Enter");
    await noteDiagram().locator("svg").waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);

    const day = await look(noteDiagram());
    check(clear(day.box) && !day.fixedPanel && clear(day.svgBackground), "Daylight: the diagram has no box behind it", JSON.stringify(day));
    await shot("01-daylight-note");

    await setTheme("Midnight");
    await backToNote();
    const night = await look(noteDiagram());
    check(clear(night.box) && !night.fixedPanel && clear(night.svgBackground), "Midnight: no white box behind the diagram", JSON.stringify(night));
    check(!isWhite(night.nodeFill) && night.nodeFill !== day.nodeFill, "Midnight: Auto node fill follows the theme switch", `${day.nodeFill} -> ${night.nodeFill}`);
    await shot("02-midnight-note");

    // MERMAID-SOURCE-THEME (review #41): a theme in the diagram's own front
    // matter wins over the Notible default, and picks the panel itself.
    const markdown = path.join(require("node:os").tmpdir(), "Mermaid front matter.md");
    const fence = (theme) => ["```mermaid", "---", "config:", `  theme: ${theme}`, "---", "flowchart LR", "  A[Own theme] --> B[Second]", "```"].join("\n");
    require("node:fs").writeFileSync(markdown, ["# Mermaid front matter", "", fence("forest"), "", fence("dark"), ""].join("\n"));
    await page.locator("input[type=file][accept*='.md']").setInputFiles(markdown);
    await page.locator(".core-object-row", { hasText: "Mermaid front matter" }).first().click();
    const diagrams = page.locator(".core-code-render .core-mermaid-diagram");
    await diagrams.nth(1).locator("svg").waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    const forestOwn = await look(diagrams.nth(0));
    const darkOwn = await look(diagrams.nth(1));
    check(forestOwn.nodeFill === "rgb(205, 228, 152)", "Midnight + Notible default: front matter forest draws forest's own node fill (#cde498)", JSON.stringify(forestOwn));
    check(forestOwn.fixedPanel, "front matter forest in Midnight sits on the soft panel", JSON.stringify(forestOwn));
    check(!darkOwn.fixedPanel, "front matter dark gets no soft panel", JSON.stringify(darkOwn));
    await shot("02b-front-matter-themes", ".core-code-render .core-mermaid-diagram");
    await page.locator(".core-object-row", { hasText: "Diagram" }).first().click();
    await noteDiagram().locator("svg").waitFor({ timeout: 15000 });

    await openDiagramSettings();
    const before = await look(preview());
    check(Boolean(before.clusterFill) && !isWhite(before.clusterFill), "preview draws a group, not on white, in Midnight", JSON.stringify(before));
    check(await page.locator(".core-plugin-settings-form input[type=color]").count() === 0, "no native colour input in the panel");
    await shot("03-midnight-settings", ".mermaid-settings-preview");

    // Node fill: pick a swatch.
    const nodeRow = page.locator(".core-setting-row", { hasText: "Node fill" });
    await nodeRow.locator("button.nb-control-trigger").click();
    const popover = page.locator(".mermaid-color-popover");
    await popover.waitFor();
    await page.waitForTimeout(400); // past the popover's open animation
    check(await page.evaluate(() => document.activeElement?.classList.contains("mermaid-color-auto") === true), "opening the colour popover focuses its Auto button");
    await shot("04-picker-open");
    const swatch = await popover.locator(".mermaid-color-swatch").nth(9).getAttribute("aria-label");
    await popover.locator(".mermaid-color-swatch").nth(9).click();
    await page.waitForTimeout(1200);
    const picked = await look(preview());
    check(picked.nodeFill !== before.nodeFill, "a node-fill swatch redraws the preview", `${before.nodeFill} -> ${picked.nodeFill} (${swatch})`);
    check((await nodeRow.locator(".nb-value").textContent()) === swatch, "the picker shows the picked hex", swatch);

    // Group fill and background: type a hex.
    const typeHex = async (label, hex) => {
      await page.locator(".core-setting-row", { hasText: label }).locator("button.nb-control-trigger").click();
      const input = page.locator(".mermaid-color-popover input");
      await input.fill(hex);
      await input.press("Enter");
      await page.waitForTimeout(1200);
    };
    await typeHex("Group fill", "#553311");
    check((await look(preview())).clusterFill === "rgb(85, 51, 17)", "a typed group-fill hex redraws the preview", (await look(preview())).clusterFill);
    await typeHex("Diagram background", "#102030");
    check((await look(preview())).svgBackground === "rgb(16, 32, 48)", "a picked background paints the diagram", (await look(preview())).svgBackground);
    await typeHex("Lines and arrows", "#nothex");
    check(await page.locator(".core-setting-row", { hasText: "Lines and arrows" }).locator(".nb-value").textContent() === "Auto", "an invalid hex is not saved");
    await shot("05-picked-colours", ".mermaid-settings-preview");

    // Fixed theme in Midnight: a soft panel, never white.
    await page.locator("#mermaid-theme").click();
    await page.getByRole("option", { name: "Forest", exact: true }).click();
    await page.waitForTimeout(1200);
    await shot("06-forest-picked-bg", ".mermaid-settings-preview");

    await backToNote();
    const note = await look(noteDiagram());
    check(note.svgBackground === "rgb(16, 32, 48)" && note.nodeFill === picked.nodeFill, "the note's diagram uses the picked colours", JSON.stringify(note));
    await shot("07-note-with-picks");

    // Back to Auto: background and group pickers cleared.
    await openDiagramSettings();
    for (const label of ["Diagram background", "Node fill", "Group fill"]) {
      await page.locator(".core-setting-row", { hasText: label }).locator("button.nb-control-trigger").click();
      await page.locator(".mermaid-color-popover .mermaid-color-auto").click();
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(1200);
    const forest = await look(preview());
    check(forest.fixedPanel && !isWhite(forest.box) && !clear(forest.box), "Forest in Midnight sits on a soft panel, not white", JSON.stringify(forest));
    const brightness = (color) => (color?.match(/\d+/gu) ?? [255, 255, 255]).slice(0, 3).reduce((sum, channel) => sum + Number(channel), 0);
    check(brightness(forest.label) < 300, "Forest in Midnight: node labels are dark on the light panel", forest.label);
    await shot("08-forest-midnight", ".mermaid-settings-preview");
    await page.locator("#mermaid-theme").click();
    await page.getByRole("option", { name: "Notible", exact: true }).click();
    await page.waitForTimeout(1200);

    await shot("09-midnight-settings-1920", ".mermaid-settings-preview");
    await setTheme("Daylight");
    await openDiagramSettings();
    await page.waitForTimeout(800);
    const dayPreview = await look(preview());
    check(clear(dayPreview.box) && !isWhite(dayPreview.clusterFill), "Daylight preview: no box, themed group", JSON.stringify(dayPreview));
    await shot("10-daylight-settings-1920", ".mermaid-settings-preview");
    await backToNote();
    await shot("11-daylight-note-1920");
  } catch (error) {
    check(false, "scenario ran to the end", error instanceof Error ? error.stack : String(error));
    await shot("zz-failure").catch(() => {});
  } finally {
    await browser.close();
    if (!process.env.KEEP) sandboxCli("stop", NAME);
    console.log(failures.length ? `\n${failures.length} failure(s)` : "\nall checks passed");
    process.exit(failures.length ? 1 : 0);
  }
})();
