import assert from "node:assert/strict";
import { cascadeDependents, requiredSuccessorStart, depsOf, earliestStartFor, wouldCycle } from "../plugins/builtin/ganttCascade.ts";

function task(id, startDate, due, extra = {}) {
  return { id, type: "task", title: id, props: JSON.stringify({ startDate, due, ...extra }), created_at: 1, updated_at: 1 };
}

// A -> B -> C, finish-start chain. Pushing A's end past B's (and B's past
// C's) start must cascade both hops, preserving each item's own duration.
{
  const a = task("a", "2026-01-01", "2026-01-05");
  const b = task("b", "2026-01-06", "2026-01-08", { dependsOn: "a" }); // 2-day duration
  const c = task("c", "2026-01-09", "2026-01-10", { dependsOn: "b" }); // 1-day duration
  const patches = cascadeDependents([a, b, c], "a", { start: Date.parse("2026-01-10T00:00:00Z"), end: Date.parse("2026-01-15T00:00:00Z") });
  const byId = Object.fromEntries(patches.map((p) => [p.id, p]));
  assert.equal(byId.a, undefined, "the changed item itself is not in the patch list");
  assert.equal(byId.b.startDate, "2026-01-15", "B must start the day A now finishes");
  assert.equal(byId.b.endDate, "2026-01-17", "B's 2-day duration must be preserved");
  assert.equal(byId.c.startDate, "2026-01-17", "C must cascade from B's new finish, not just A's");
  assert.equal(byId.c.endDate, "2026-01-18", "C's 1-day duration must be preserved");
}

// No shift needed: successor already starts after the new required date.
{
  const a = task("a", "2026-01-01", "2026-01-05");
  const b = task("b", "2026-02-01", "2026-02-03", { dependsOn: "a" });
  const patches = cascadeDependents([a, b], "a", { start: Date.parse("2026-01-01T00:00:00Z"), end: Date.parse("2026-01-06T00:00:00Z") });
  assert.deepEqual(patches, [], "a successor that already satisfies the constraint must not move");
}

// start-start, finish-finish and start-finish semantics.
{
  const a = task("a", "2026-01-01", "2026-01-10");
  const ss = task("ss", "2026-01-01", "2026-01-02", { dependsOn: "a", dependsOnKind: "start-start" });
  const ff = task("ff", "2026-01-01", "2026-01-02", { dependsOn: "a", dependsOnKind: "finish-finish" });
  const patches = cascadeDependents([a, ss, ff], "a", { start: Date.parse("2026-01-05T00:00:00Z"), end: Date.parse("2026-01-20T00:00:00Z") });
  const byId = Object.fromEntries(patches.map((p) => [p.id, p]));
  assert.equal(byId.ss.startDate, "2026-01-05", "start-start must move to the predecessor's new start");
  assert.equal(byId.ff.endDate, "2026-01-20", "finish-finish must land its end on the predecessor's new finish");
}

// start-finish: the successor may not finish until the predecessor starts, so
// pushing the predecessor's start forward drags the successor's *finish* to it.
{
  const a = task("a", "2026-01-01", "2026-01-10");
  const sf = task("sf", "2026-01-01", "2026-01-03", { deps: [{ on: "a", kind: "start-finish" }] }); // 2-day duration
  const patches = cascadeDependents([a, sf], "a", { start: Date.parse("2026-01-20T00:00:00Z"), end: Date.parse("2026-01-30T00:00:00Z") });
  const byId = Object.fromEntries(patches.map((p) => [p.id, p]));
  assert.equal(byId.sf.endDate, "2026-01-20", "start-finish: successor's finish lands on the predecessor's new start");
  assert.equal(byId.sf.startDate, "2026-01-18", "start-finish: successor's 2-day duration is preserved");
}

// A two-item cycle (A depends on B, B depends on A) must not infinite-loop.
{
  const a = task("a", "2026-01-01", "2026-01-02", { dependsOn: "b" });
  const b = task("b", "2026-01-03", "2026-01-04", { dependsOn: "a" });
  const patches = cascadeDependents([a, b], "a", { start: Date.parse("2026-01-01T00:00:00Z"), end: Date.parse("2026-01-02T00:00:00Z") });
  assert.ok(Array.isArray(patches), "a dependency cycle must terminate instead of hanging");
}

// requiredSuccessorStart: the shared formula behind both the cascade above
// and the Gantt drag-to-move conflict guard ("B cannot be dragged earlier
// than A allows"). A drag handler compares its own candidate date against
// this directly, so its three branches need their own coverage independent
// of cascadeDependents' end-to-end scenarios above.
{
  const predecessor = { start: Date.parse("2026-01-01T00:00:00Z"), end: Date.parse("2026-01-10T00:00:00Z") };
  const DAY = 86_400_000;
  assert.equal(requiredSuccessorStart(predecessor, "finish-start", 2 * DAY), predecessor.end, "finish-start: successor must not start before the predecessor's finish");
  assert.equal(requiredSuccessorStart(predecessor, "start-start", 2 * DAY), predecessor.start, "start-start: successor must not start before the predecessor's own start");
  assert.equal(requiredSuccessorStart(predecessor, "finish-finish", 2 * DAY), predecessor.end - 2 * DAY, "finish-finish: successor's start is back-computed from its own duration so its finish lands on the predecessor's");
  assert.equal(requiredSuccessorStart(predecessor, "start-finish", 2 * DAY), predecessor.start - 2 * DAY, "start-finish: successor's finish may not precede the predecessor's start, so its start sits one duration earlier");
}

// Legacy single-predecessor props (dependsOn / dependsOnKind) still read as a
// one-entry deps list so records written before 0.71.2 keep working.
{
  const legacy = task("legacy", "2026-01-01", "2026-01-02", { dependsOn: "x", dependsOnKind: "start-start" });
  assert.deepEqual(depsOf(legacy), [{ on: "x", kind: "start-start" }], "legacy dependsOn is read as one deps entry");
  const modern = task("modern", "2026-01-01", "2026-01-02", { deps: [{ on: "p1", kind: "finish-start" }, { on: "p2", kind: "finish-finish" }] });
  assert.equal(depsOf(modern).length, 2, "the deps array is read as-is");
}

// Multiple predecessors: the successor is pushed to satisfy the STRICTEST of
// them. B waits on both A (finish-start) and C (finish-start); moving A leaves
// C the binding constraint, moving C past A makes C bind harder.
{
  const a = task("a", "2026-01-01", "2026-01-05");
  const c = task("c", "2026-01-01", "2026-01-20");
  const b = task("b", "2026-01-21", "2026-01-23", { deps: [{ on: "a", kind: "finish-start" }, { on: "c", kind: "finish-start" }] });
  // Nudge A a little — C (ends 01-20) is still the strictest, B already clears it, so nothing moves.
  let patches = cascadeDependents([a, c, b], "a", { start: Date.parse("2026-01-02T00:00:00Z"), end: Date.parse("2026-01-08T00:00:00Z") });
  assert.deepEqual(patches, [], "B already clears its strictest predecessor (C), so a smaller move of A does nothing");
  // Push C out past B — now C binds and B must move to C's new finish.
  patches = cascadeDependents([a, c, b], "c", { start: Date.parse("2026-01-01T00:00:00Z"), end: Date.parse("2026-02-01T00:00:00Z") });
  const byId = Object.fromEntries(patches.map((p) => [p.id, p]));
  assert.equal(byId.b.startDate, "2026-02-01", "B must move to the strictest predecessor's (C's) new finish");
  assert.equal(byId.b.endDate, "2026-02-03", "B's 2-day duration is preserved");
}

// earliestStartFor: the drag-conflict guard, now across every predecessor.
{
  const b = task("b", "2026-01-10", "2026-01-12", { deps: [{ on: "a", kind: "finish-start" }, { on: "c", kind: "finish-start" }] });
  const ranges = {
    a: { start: Date.parse("2026-01-01T00:00:00Z"), end: Date.parse("2026-01-05T00:00:00Z") },
    c: { start: Date.parse("2026-01-01T00:00:00Z"), end: Date.parse("2026-01-15T00:00:00Z") },
  };
  assert.equal(earliestStartFor(b, (id) => ranges[id] ?? null), ranges.c.end, "earliest start is the latest of all predecessors' required starts");
  assert.equal(earliestStartFor(b, () => null), null, "no resolvable predecessor means no constraint");
}

// wouldCycle: adding a predecessor that already depends (transitively) on the
// item — or the item itself — is a cycle and must be rejected.
{
  const a = task("a", "2026-01-01", "2026-01-02");
  const b = task("b", "2026-01-03", "2026-01-04", { deps: [{ on: "a", kind: "finish-start" }] });
  const c = task("c", "2026-01-05", "2026-01-06", { deps: [{ on: "b", kind: "finish-start" }] });
  assert.equal(wouldCycle([a, b, c], "a", "c"), true, "making C (which depends on A via B) a predecessor of A closes a loop");
  assert.equal(wouldCycle([a, b, c], "a", "a"), true, "an item cannot depend on itself");
  assert.equal(wouldCycle([a, b, c], "c", "a"), false, "A -> C is fine, it adds no loop");
}

console.log("Gantt cascade checks passed: FS/SS/FF/SF propagation, no-op when already satisfied, cycle termination, drag-conflict formula, legacy prop fallback, multi-predecessor strictest-wins, wouldCycle guard.");
