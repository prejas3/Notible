import fs from "node:fs";

const theme = fs.readFileSync(new URL("../src/lib/theme.ts", import.meta.url), "utf8");

const checks = [
  // Single paper identity (Kierunek B): one palette, burgundy accent, no pickers.
  [theme.includes('bg: "#fffdfa"'), "paper background matches the current warm-white palette"],
  [theme.includes("#8d3b46"), "burgundy accent is fixed"],
  [theme.includes('dataset.visualTheme = "paper"'), "visual theme is paper"],
  [theme.includes('root.setProperty("--archive-paper", PAPER.bg)'), "archive paper aliases the core background"],
  [theme.includes('root.setProperty("--archive-ink", PAPER.text)'), "archive ink aliases the core text"],
  [theme.includes('root.setProperty("--archive-burgundy", BURGUNDY)'), "archive accent aliases the core accent"],
  [!theme.includes("BgPreset"), "no background presets remain"],
  [!theme.includes("AccentPreset"), "no accent presets remain"],
  // Data-series colours are untouched — they colour charts, not chrome.
  ...["blue", "green", "amber", "red", "violet"].map((name) => [theme.includes(`\"${name}\"`), `semantic color ${name} exists`]),
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  for (const [, message] of failed) console.error(`Theme check failed: ${message}`);
  process.exit(1);
}
console.log(`Theme check passed: ${checks.length} single-theme invariants verified.`);
