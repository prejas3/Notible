// R5 L7: interface size steps.
//   node --experimental-strip-types scripts/zoom-check.mjs
import assert from "node:assert/strict";
import { stepZoom, ZOOM_STEPS } from "../src/core/app/zoom.ts";

assert.equal(stepZoom(1, 1), 1.1);
assert.equal(stepZoom(1, -1), 0.9);
assert.equal(stepZoom(1.25, 0), 1, "Ctrl+0 resets");
assert.equal(stepZoom(ZOOM_STEPS.at(-1), 1), ZOOM_STEPS.at(-1), "stops at the largest");
assert.equal(stepZoom(ZOOM_STEPS[0], -1), ZOOM_STEPS[0], "stops at the smallest");
assert.equal(stepZoom(1.17, 1), 1.5, "an odd value moves to the step above its own");
console.log("zoom-check: ok");
