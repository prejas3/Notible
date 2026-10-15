import sharp from "sharp";
import { writeFileSync } from "node:fs";

// Brand tokens, lifted from public/brand/notible-lockup.svg / notible-mark.svg
const BG_DARK = "#090B0D";
const CREAM = "#F3F0E8";
const ACCENT = "#7557E8";

// The notch mark, viewBox 0 0 512 512 (public/brand/notible-mark.svg)
const MARK_PATH = "M80 48c-17.673 0-32 14.327-32 32v224c0 17.673 14.327 32 32 32h72c17.673 0 32 14.327 32 32v64c0 17.673 14.327 32 32 32h216c17.673 0 32-14.327 32-32V216c0-17.673-14.327-32-32-32h-64c-17.673 0-32-14.327-32-32V80c0-17.673-14.327-32-32-32H80Z";

function markGroup({ x, y, size, fill = CREAM, dot = ACCENT }) {
  const scale = size / 512;
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <path fill="${fill}" d="${MARK_PATH}"/>
    <circle cx="256" cy="256" r="36" fill="${dot}"/>
  </g>`;
}

// --- Header: 150x57, white installer-page background, dark rounded-square
// badge on the left + "Notible" wordmark, matching the lockup's own light-
// background treatment (dark square, dark text) rather than inventing a new
// composition.
const badgeSize = 40;
const badgeY = (57 - badgeSize) / 2;
const header = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="#FFFFFF"/>
  <rect x="8" y="${badgeY}" width="${badgeSize}" height="${badgeSize}" rx="9" fill="${BG_DARK}"/>
  ${markGroup({ x: 8 + badgeSize * 0.2, y: badgeY + badgeSize * 0.2, size: badgeSize * 0.6 })}
  <text x="58" y="35" fill="${BG_DARK}" font-family="Segoe UI Variable Display, Segoe UI, sans-serif" font-size="20" font-weight="650" letter-spacing="-0.5">Notible</text>
</svg>`;

// --- Sidebar: 164x314, full-bleed dark panel with the mark centered in the
// upper-middle (standard NSIS welcome/finish page layout) and the wordmark
// beneath it.
const sideMarkSize = 96;
const sidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <rect width="164" height="314" fill="${BG_DARK}"/>
  ${markGroup({ x: (164 - sideMarkSize) / 2, y: 96, size: sideMarkSize })}
  <text x="82" y="232" fill="${CREAM}" font-family="Segoe UI Variable Display, Segoe UI, sans-serif" font-size="22" font-weight="650" letter-spacing="-0.5" text-anchor="middle">Notible</text>
</svg>`;

writeFileSync("header.svg", header);
writeFileSync("sidebar.svg", sidebar);

await sharp(Buffer.from(header)).png().toFile("header.png");
await sharp(Buffer.from(sidebar)).png().toFile("sidebar.png");

console.log("PNGs written");
