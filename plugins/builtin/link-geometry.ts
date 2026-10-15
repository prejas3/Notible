/** Geometry shared by the Typewriter board and the Whiteboard for the round "×"
 *  that removes a connection. Pure functions, no DOM. */

export interface XY { x: number; y: number; }
export interface Box { x: number; y: number; w: number; h: number; }

export function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Where a connection's remove button sits. The middle is only the default: when
 * another line crosses or runs along it, the button would land on that line and
 * hovering it would grab the wrong connection. So sample the visible line every
 * 10px (clear of both ends and 12px clear of every box, because the button is
 * drawn under the cards) and keep the point farthest from every other line,
 * preferring the one nearest the middle of the path on a tie.
 * `pts` is a 4-point elbow: start, two bends, end.
 */
export function removeSpot(pts: XY[], others: XY[][], boxes: Box[]): XY {
  const lengths = [0, 1, 2].map((i) => Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y));
  const total = lengths[0] + lengths[1] + lengths[2];
  let best: XY | null = null;
  let bestScore = -Infinity;
  let walked = 0;
  for (const i of [0, 1, 2]) {
    const a = pts[i], b = pts[i + 1];
    const len = lengths[i];
    for (let s = 14; s <= len - 14; s += 10) {
      const t = s / len;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (boxes.some((c) => p.x > c.x - 12 && p.x < c.x + c.w + 12 && p.y > c.y - 12 && p.y < c.y + c.h + 12)) continue;
      let clearance = 60; // beyond 60px from every other line is "clear enough"
      for (const line of others) for (let k = 0; k < line.length - 1; k += 1) clearance = Math.min(clearance, distToSegment(p, line[k], line[k + 1]));
      const score = clearance * 1000 - Math.abs(walked + s - total / 2);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    walked += len;
  }
  return best ?? { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 };
}

/**
 * The first place for a w×h box that overlaps none of `boxes`, scanning rows
 * from `start` (the visible top-left), so a new card never lands on another
 * (R4 T11). `gap` keeps a little air between them. Gives up after `tries`
 * and returns `start`.
 */
export function freeSpot(boxes: Box[], w: number, h: number, start: XY, opts: { gap?: number; across?: number; tries?: number } = {}): XY {
  const gap = opts.gap ?? 24;
  const across = opts.across ?? 4;
  const tries = opts.tries ?? 200;
  const hits = (x: number, y: number) => boxes.some((b) => x < b.x + b.w + gap && x + w + gap > b.x && y < b.y + b.h + gap && y + h + gap > b.y);
  for (let i = 0; i < tries; i += 1) {
    const x = start.x + (i % across) * (w + gap);
    const y = start.y + Math.floor(i / across) * (h + gap);
    if (!hits(x, y)) return { x, y };
  }
  return start;
}
