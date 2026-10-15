// Scenario E11 (repair plan 01.10): spell checking follows the app language,
// not the Windows display language.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/e11-spellcheck.cjs
//
// Needs a fresh `npm run sandbox:build`. The language reaches WebView2 at
// start-up, so each check restarts the sandbox (stop --keep / start --reuse).
// On a non-English Windows the first start shows the old behaviour; the
// restarted app must check English. Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-e11-spell";
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };

async function connect(cdp) {
  const browser = await chromium.connectOverCDP(cdp);
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole("button", { name: /^(Create a note, folder or project|Utwórz notatkę, folder lub projekt)$/ }).first().waitFor({ timeout: 30000 });
  return { browser, page };
}
async function restart(session) {
  await session.page.waitForTimeout(1500); // let the language file be written
  await session.browser.close();
  sandboxCli("stop", NAME, "--keep");
  return connect(JSON.parse(sandboxCli("start", NAME, "--reuse")).cdp);
}

/** Red squiggle pixels under a line of correct English, counted in the page. */
async function squigglesUnderEnglish(page) {
  await page.getByRole("button", { name: /^(Create a note, folder or project|Utwórz notatkę, folder lub projekt)$/ }).first().click();
  await page.getByRole("button", { name: "New note" }).first().click();
  await page.locator(".core-title-input").waitFor();
  await page.waitForTimeout(300);
  await page.keyboard.press("Tab");
  await page.keyboard.type("review hiring move monday meeting renovation about", { delay: 15 });
  await page.waitForTimeout(2500); // the spell checker runs a moment later
  const box = await page.locator("[contenteditable=true]").first().boundingBox();
  const shot = await page.screenshot({ clip: { x: box.x, y: box.y, width: Math.min(box.width, 700), height: 50 } });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 180 && pixels[i + 1] < 90 && pixels[i + 2] < 90) red += 1;
    return red;
  }, shot.toString("base64"));
}

(async () => {
  let session = await connect(JSON.parse(sandboxCli("start", NAME)).cdp);
  try {
    const first = await session.page.evaluate(() => navigator.languages[0]);
    console.log(`     first start (no language stored yet): ${first}`);
    // On a non-English Windows the first start still checks in that language:
    // the detector must see the squiggles there, or a 0 below proves nothing.
    if (!first.startsWith("en")) {
      const before = await squigglesUnderEnglish(session.page);
      check(before >= 20, `the squiggle counter sees the old underlines (${before} red pixels)`);
    }
    session = await restart(session);
    const english = await session.page.evaluate(() => navigator.languages[0]);
    check(english === "en-US", `after a restart WebView2 uses the app language (got ${english})`);
    const red = await squigglesUnderEnglish(session.page);
    check(red < 5, `correct English is not underlined (${red} red pixels)`);

    // Switch the app to Polish; after a restart spell checking follows.
    await session.page.getByRole("button", { name: "Settings", exact: true }).last().click();
    // Language lives in Settings → Languages only (R2, G4).
    await session.page.locator(".core-settings-nav button", { hasText: "Languages" }).click();
    await session.page.locator(".core-lang-row", { hasText: "Polski" }).getByRole("button", { name: "Use" }).click();
    session = await restart(session);
    const polish = await session.page.evaluate(() => navigator.languages[0]);
    check(polish === "pl", `after switching to Polish and restarting it is Polish (got ${polish})`);
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`);
  } finally {
    await session.browser.close().catch(() => {});
    sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\nE11 spellcheck scenario FAILED (${failures.length})` : "\nE11 spellcheck scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
