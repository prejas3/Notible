// R4 T11: a new whiteboard card lands where nothing else is.
//   node --experimental-strip-types scripts/whiteboard-place-check.mjs
import assert from "node:assert/strict";
import { freeSpot } from "../plugins/builtin/link-geometry.ts";

const start = { x: 40, y: 40 };
// Empty board: the start.
assert.deepEqual(freeSpot([], 220, 140, start), start);
// A card at the start: the next one goes beside it, not on it.
const first = { x: 40, y: 40, w: 220, h: 140 };
const second = freeSpot([first], 220, 140, start);
assert.deepEqual(second, { x: 284, y: 40 });
// A full first row: the next row.
const row = [0, 1, 2, 3].map((i) => ({ x: 40 + i * 244, y: 40, w: 220, h: 140 }));
assert.deepEqual(freeSpot(row, 220, 140, start), { x: 40, y: 204 });
// Never overlapping (with the gap) whatever is there.
const boxes = [{ x: 100, y: 60, w: 300, h: 300 }, { x: 600, y: 0, w: 50, h: 50 }];
const spot = freeSpot(boxes, 220, 140, start);
for (const b of boxes) assert.ok(spot.x >= b.x + b.w + 24 || spot.x + 220 + 24 <= b.x || spot.y >= b.y + b.h + 24 || spot.y + 140 + 24 <= b.y, `clear of ${JSON.stringify(b)}`);

console.log("whiteboard-place-check: ok");
