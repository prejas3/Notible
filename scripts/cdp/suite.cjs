#!/usr/bin/env node
/**
 * Repeatable CDP smoke-test suite for the real, installed Notible app.
 *
 * Why this exists: manual CDP testing on the live install with real user data
 * (see notes (internal, not published) session 2026-09-15) twice typed test characters
 * into a real note and once trashed it, because each ad-hoc script re-invented
 * selectors and had no safety rail before sending keystrokes. This script is
 * the fix — a fixed, reviewed set of fixtures plus a hard guard that refuses
 * to type into anything whose title isn't in SAFE_TITLES.
 *
 * ── One-time setup (already done as of 2026-09-15, re-run only if fixtures
 *    are missing) ──
 * The suite assumes three permanent fixtures already exist in the workspace:
 *   - "CDP-TEST-Suite"      — a Project with every module tab enabled
 *                             (Tasks/Timeline/Planning/Calendar/Finance/
 *                             Automations/Whiteboard), for project-dashboard
 *                             sub-tab checks.
 *   - "CDP-TEST-Note"       — a plain note, for editor/typing checks.
 *   - "CDP-TEST-Manuscript" — a Typewriter manuscript, for Manuscript/Codex/
 *                             Board pane checks.
 * If any are missing, create them by hand (Create button → pick the type →
 * rename to the exact title above) rather than scripting creation again —
 * that flow is exactly what went wrong last time.
 *
 * ── Usage ──
 *   1. cd into this scratchpad/anywhere with playwright-core installed
 *      (npm i playwright-core --no-save — see notible-live-app-cdp-testing
 *      memory for full CDP-launch procedure).
 *   2. Launch NotibleApp.exe with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
 *      --remote-debugging-port=9222 (kill any running instance first).
 *   3. node scripts/cdp/suite.js <check> [check...]   (or "all")
 *
 * Checks: status, tabs, typing, focus-mode, dashboard-tabs, typewriter-panes
 *
 * ── Safety rules baked into this file — do not weaken them ──
 *   - SAFE_TITLES is the only set of documents this script will ever send
 *     keyboard.type() into. assertSafeTitle() is called immediately before
 *     every single keystroke-producing action, not just once per check.
 *   - Nothing here ever deletes, trashes, or restores anything. If a check
 *     needs cleanup, it undoes its own typing via Backspace in the same
 *     function, never via a trash icon.
 *   - Nothing here creates new fixtures. If a fixture is missing, the check
 *     reports MISSING and stops — it does not try to recreate it via the
 *     Create-menu flow (that flow's success can't be assumed by a script
 *     that isn't watching the screen).
 */

const { chromium } = require('playwright-core');

const SAFE_TITLES = new Set(['CDP-TEST-Suite', 'CDP-TEST-Note', 'CDP-TEST-Manuscript']);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function connect() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.bringToFront();
  return { browser, page };
}

/** Click a sidebar item by its exact visible title and confirm the editor
 *  actually switched to it (title input value matches) before returning. */
async function openByTitle(page, title) {
  const item = page.locator('.core-sidebar button, .core-sidebar a, .core-sidebar span', { hasText: title }).first();
  if (!(await item.count())) return { ok: false, reason: `"${title}" not found in sidebar — fixture missing?` };
  await item.click();
  await sleep(500);
  const current = await page.evaluate(() => document.querySelector('.core-title-input')?.value ?? document.body.innerText.slice(0, 60));
  const ok = current === title || current.includes(title);
  return { ok, current };
}

/** MUST be called immediately before any page.keyboard.type()/press() that
 *  produces characters. Throws (never silently continues) if the currently
 *  open document is not one of the fixed safe fixtures. */
async function assertSafeTitle(page) {
  const current = await page.evaluate(() => document.querySelector('.core-title-input')?.value);
  if (!SAFE_TITLES.has(current)) {
    throw new Error(`SAFETY ABORT: current document title is "${current}", not one of ${[...SAFE_TITLES].join(', ')} — refusing to type.`);
  }
}

// ---------------------------------------------------------------------------

async function checkStatus(page) {
  console.log('--- status ---');
  for (const title of SAFE_TITLES) {
    const found = (await page.evaluate((t) => document.querySelector('.core-sidebar')?.innerText.includes(t), title));
    console.log(`${found ? 'OK  ' : 'MISS'}  ${title}`);
  }
}

/** Table<->Calendar (and Overview/Automations) alignment + mount-fade, on the
 *  real "Projects" object. Read-only: clicking object tabs never mutates
 *  content, so this is safe to run against real data. */
async function checkObjectTabs(page) {
  // Known open item (2026-09-15): Table/Calendar/Automations consistently read
  // the same top (~364px, confirming the Calendar alignment fix works) but
  // Overview reads 0px every run — its `.core-container-slot` first child's
  // getBoundingClientRect() comes back zeroed, which usually means that
  // element isn't the actual visible content (display:none, 0-size wrapper,
  // or a <style>/fragment marker). Not investigated further yet — if you're
  // debugging Overview specifically, check what workspace-dashboard-ui.ts
  // actually renders as .core-container-slot's first element.
  console.log('--- object tabs (Overview/Table/Calendar/Automations) ---');
  const opened = await openByTitle(page, 'Projects');
  if (!opened.ok) { console.log('SKIP: could not open "Projects" —', opened.reason ?? opened.current); return; }

  const tabs = ['Overview', 'Table', 'Calendar', 'Automations'];
  const rows = {};
  for (const name of tabs) {
    const btn = page.locator('[role="tablist"] button', { hasText: name }).first();
    if (!(await btn.count())) { console.log(`  ${name}: tab not found, skipping`); continue; }
    await btn.click();
    await sleep(260); // let the 160ms core-view-in fade settle
    // Generic on purpose: every view type (Overview/Table/Calendar/Automations)
    // mounts inside .core-container-slot, so its first child's top edge is the
    // one number comparable across all of them, regardless of each view's own
    // internal structure.
    const firstRowTop = await page.evaluate(() => {
      const slot = document.querySelector('.core-container-slot');
      const el = slot?.firstElementChild;
      return el ? Math.round(el.getBoundingClientRect().top) : null;
    });
    rows[name] = firstRowTop;
    console.log(`  ${name}: first content row top = ${firstRowTop}px`);
  }
  const values = Object.values(rows).filter((v) => v !== null);
  const spread = values.length ? Math.max(...values) - Math.min(...values) : 0;
  console.log(`  spread across tabs: ${spread}px ${spread <= 4 ? '(aligned)' : '(STILL MISALIGNED — see notes)'}`);
}

/** Editor status-label / icon-button flicker check. Types into CDP-TEST-Note
 *  ONLY (guarded), and undoes its own typing before returning. */
async function checkTypingFlicker(page) {
  console.log('--- typing flicker (CDP-TEST-Note) ---');
  const opened = await openByTitle(page, 'CDP-TEST-Note');
  if (!opened.ok) { console.log('SKIP:', opened.reason ?? opened.current); return; }
  await assertSafeTitle(page);

  const editor = page.locator('.core-editor-panel [contenteditable="true"], .core-editor-panel .ProseMirror').first();
  await editor.click();
  await assertSafeTitle(page); // re-check after click, belt and suspenders

  const marker = 'zzzCDPzzz';
  const samples = [];
  for (const ch of marker) {
    await page.keyboard.type(ch, { delay: 15 });
    const x = await page.evaluate(() => {
      const el = document.querySelector('.core-editor-toolbar .core-icon-action');
      return el ? Math.round(el.getBoundingClientRect().x * 100) / 100 : null;
    });
    samples.push(x);
  }
  const stable = samples.every((v) => v === samples[0]);
  console.log(`  icon-button X while typing: ${JSON.stringify(samples)}`);
  console.log(`  ${stable ? 'PASS' : 'FAIL'}: icon button ${stable ? 'did not move' : 'moved — flicker regressed'}`);

  // Undo: backspace exactly as many characters as were typed.
  await assertSafeTitle(page);
  for (let i = 0; i < marker.length; i++) await page.keyboard.press('Backspace');
  await sleep(600);
  const leftoverCheck = await page.evaluate(() => document.querySelector('.core-editor-panel [contenteditable="true"], .core-editor-panel .ProseMirror')?.innerText.includes('zzzCDPzzz'));
  console.log(`  cleanup: marker text present after undo = ${leftoverCheck} (must be false)`);
}

/** Focus mode toggle — no typing at all, safe on any open document. Confirms
 *  the sidebar/properties collapse and (critically) come back on exit, since
 *  the animated version of this broke exactly that way in 0.82.5.
 *  0.82.7 timing: entering fades opacity for FOCUS_FADE_MS (380ms in
 *  CoreOnlyApp.tsx — keep this in sync if that constant changes) THEN does
 *  the instant structural swap; exiting swaps back instantly, then fades in
 *  on the next paint. So: sample opacity mid-fade (should be between 0 and 1,
 *  layout still 272px), sample width after the swap delay (should be 0), and
 *  sample opacity right after exit-click (should still read ~0, since the
 *  fade-in hasn't started the same tick) as well as after it's had time to
 *  finish (~1 = fully back). */
async function checkFocusMode(page) {
  console.log('--- focus mode toggle ---');
  const opened = await openByTitle(page, 'CDP-TEST-Note');
  if (!opened.ok) { console.log('SKIP:', opened.reason ?? opened.current); return; }

  const before = await page.evaluate(() => document.querySelector('.core-sidebar')?.getBoundingClientRect().width ?? null);
  const focusBtn = page.locator('[title="Focus mode"], [aria-label="Focus mode"]').first();
  if (!(await focusBtn.count())) { console.log('  SKIP: focus-mode button not found'); return; }

  await focusBtn.click();
  await sleep(150); // mid-fade: layout must still be 2-column, opacity partway down
  const midFadeWidth = await page.evaluate(() => document.querySelector('.core-sidebar')?.getBoundingClientRect().width ?? 0);
  const midFadeOpacity = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.core-sidebar')).opacity));
  console.log(`  mid-fade (150ms in): sidebar width=${midFadeWidth}px (expect ≈${before}px, unchanged) opacity=${midFadeOpacity} (expect between 0 and 1)`);

  await sleep(450); // past the 380ms fade + structural swap
  const duringWidth = await page.evaluate(() => document.querySelector('.core-sidebar')?.getBoundingClientRect().width ?? 0);
  console.log(`  settled focus state: sidebar width=${duringWidth}px (expect 0/hidden)`);

  const exitBtn = page.locator('[title="Exit focus mode"], [aria-label="Exit focus mode"]').first();
  await exitBtn.click();
  const rightAfterExitWidth = await page.evaluate(() => document.querySelector('.core-sidebar')?.getBoundingClientRect().width ?? 0);
  console.log(`  right after exit click: sidebar width=${rightAfterExitWidth}px (expect ≈${before}px — layout restored instantly, still invisible)`);

  await sleep(450); // past the 380ms fade-in
  const after = await page.evaluate(() => document.querySelector('.core-sidebar')?.getBoundingClientRect().width ?? null);
  const afterOpacity = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.core-sidebar')).opacity));
  console.log(`  settled after exit: sidebar width=${after}px opacity=${afterOpacity} (expect ≈ before=${before}px, opacity≈1)`);

  const ok = duringWidth === 0 && after !== null && Math.abs(after - before) < 2 && afterOpacity > 0.9;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: focus mode entered and exited cleanly`);
}

/** Project dashboard's own sub-tabs (Tasks/Timeline/Planning/Calendar/
 *  Finance/Automations/Whiteboard) on CDP-TEST-Suite. Read-only.
 *  NOTE: Automations and Whiteboard are separate plugins, not project-
 *  dashboard-ui's own `.pd-panel` — "panel mounted = false" for those two is
 *  CORRECT, not a bug. Tasks can also read false on the very first click if
 *  it was already the active tab pre-navigation (no remount happens) — click
 *  a different tab first if you need a clean read on Tasks specifically. */
async function checkDashboardTabs(page) {
  console.log('--- project dashboard sub-tabs (CDP-TEST-Suite) ---');
  const opened = await openByTitle(page, 'CDP-TEST-Suite');
  if (!opened.ok) { console.log('SKIP:', opened.reason ?? opened.current); return; }

  const tabs = ['Tasks', 'Timeline', 'Planning', 'Calendar', 'Finance', 'Automations', 'Whiteboard'];
  for (const name of tabs) {
    const btn = page.locator('[role="tablist"] button', { hasText: name }).first();
    if (!(await btn.count())) { console.log(`  ${name}: tab not found`); continue; }
    await btn.click();
    await sleep(220);
    const ok = await page.evaluate(() => !!document.querySelector('.pd-panel'));
    const note = (name === 'Automations' || name === 'Whiteboard') ? ' (expected false — different plugin)' : '';
    console.log(`  ${name}: panel mounted = ${ok}${note}`);
  }
}

/** Typewriter's Manuscript/Codex/Board pane switch, on CDP-TEST-Manuscript.
 *  Selectors here are best-effort (not fully reconnoitred) — if a locator
 *  finds nothing this logs SKIP rather than throwing, so a wrong selector
 *  never turns into a wrong click on real data. */
async function checkTypewriterPanes(page) {
  console.log('--- typewriter panes (CDP-TEST-Manuscript) ---');
  const opened = await openByTitle(page, 'CDP-TEST-Manuscript');
  if (!opened.ok) { console.log('SKIP:', opened.reason ?? opened.current); return; }

  const panes = ['Manuscript', 'Board', 'Codex'];
  for (const name of panes) {
    const btn = page.locator('button', { hasText: name }).first();
    if (!(await btn.count())) { console.log(`  ${name}: nav button not found (verify selector), skipping`); continue; }
    await btn.click();
    await sleep(220);
    console.log(`  ${name}: clicked, no crash`);
  }
}

// ---------------------------------------------------------------------------

const CHECKS = {
  status: checkStatus,
  tabs: checkObjectTabs,
  typing: checkTypingFlicker,
  'focus-mode': checkFocusMode,
  'dashboard-tabs': checkDashboardTabs,
  'typewriter-panes': checkTypewriterPanes,
};

async function main() {
  const args = process.argv.slice(2);
  const names = args.includes('all') || args.length === 0 ? Object.keys(CHECKS) : args;
  const { browser, page } = await connect();
  try {
    for (const name of names) {
      const fn = CHECKS[name];
      if (!fn) { console.log(`Unknown check "${name}". Available: ${Object.keys(CHECKS).join(', ')}, all`); continue; }
      try {
        await fn(page);
      } catch (err) {
        console.log(`FAIL (${name}):`, err.message);
      }
      console.log('');
    }
  } finally {
    await browser.close(); // disconnects Playwright only, does not close the app
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
