import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A CSS animation that keeps `animation-fill-mode: both|forwards` on `transform`
// leaves an active transform effect on the element for good, even when the last
// keyframe is `transform: none`. Browsers then treat that element as transformed,
// which makes it the containing block of every `position: fixed` descendant: a
// drag ghost or a menu positioned from clientX/clientY lands offset by the
// element's own page position. `.plugin-view-content-fade` wraps the whole Views
// content (Kanban included), so the 0.83.0 `both` shipped a drag ghost that
// rendered hundreds of pixels from the cursor.
const css = readFileSync(new URL("../plugins/builtin/views-ui.css", import.meta.url), "utf8");
const rule = css.match(/\.plugin-view-content-fade\s*\{([^}]*)\}/);
assert.ok(rule, ".plugin-view-content-fade rule not found in views-ui.css");
assert.doesNotMatch(rule[1], /\b(?:both|forwards)\b/, ".plugin-view-content-fade must not fill forwards: it would become the containing block of the Kanban drag ghost and the view menus (position: fixed)");
console.log("animation-fill-check: ok");
