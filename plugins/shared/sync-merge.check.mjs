// SYNC-MERGE-A (Hive #5): merge + lineage tests, run by both Sync self-checks.
import assert from "node:assert/strict";
import * as M from "./sync-merge.js";

// The moved section still works on its own.
assert.equal(typeof M.objectHash({ type: "note", title: "a", content: "", props: "{}" }), "string");
assert.equal(M.planConflicts([], new Map(), {}, {}, "x").objects.length, 0);

// ---- body diff3
const doc = (lines) => JSON.stringify({ type: "doc", content: lines.map((t) => (t ? { type: "paragraph", content: [{ type: "text", text: t }] } : { type: "paragraph" })) });
{
  // Exactly Core's documentFromText bytes.
  assert.equal(M.linesToContent(["a", "", "b"]), doc(["a", "", "b"]));
  assert.equal(M.linesToContent([]), doc([""]));
  assert.deepEqual(M.flatLines(doc(["a", "", "b"])), ["a", "", "b"]);
  assert.deepEqual(M.flatLines(""), []);
  assert.deepEqual(M.flatLines(M.linesToContent([])), []); // Core's empty doc == "" (no spurious blank line)
  // Review Focus 1: anything richer is refused.
  for (const rich of [
    JSON.stringify({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "h" }] }] }),
    JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "b", marks: [{ type: "bold" }] }] }] }),
    JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }] }),
    JSON.stringify({ type: "doc", content: [{ type: "paragraph", attrs: {}, content: [{ type: "text", text: "a" }] }] }),
    JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a\nb" }] }] }),
    "not json", "[]", JSON.stringify({ type: "doc" }),
  ]) assert.equal(M.flatLines(rich), null, rich);

  assert.deepEqual(M.toUnits(["a", "```js", "x", "", "```", "b"]), ["a", "```js\nx\n\n```", "b"]);
  assert.equal(M.toUnits(["a", "```", "x"]), null);
}
{
  // diffUnits: hunks turn a into b, on random edits.
  let seed = 7;
  const rnd = (n) => (((seed = (seed * 1103515245 + 12345) % 2147483648) >>> 16) % n);
  for (let round = 0; round < 300; round++) {
    const a = Array.from({ length: rnd(30) }, () => "abcde"[rnd(5)]);
    const b = a.slice();
    for (let k = rnd(6); k > 0; k--) {
      const at = rnd(b.length + 1);
      if (rnd(2)) b.splice(at, 0, "xyz"[rnd(3)]); else b.splice(at, 1);
    }
    const hunks = M.diffUnits(a, b);
    assert.deepEqual(M.applyHunks(a, hunks), b, JSON.stringify({ a, b, hunks }));
    for (let i = 1; i < hunks.length; i++) assert.ok(hunks[i - 1].e < hunks[i].s || (hunks[i - 1].e === hunks[i].s && hunks[i].s > hunks[i - 1].s), "hunks are separate");
  }
  assert.deepEqual(M.diffUnits(["a"], ["a"]), []);
  assert.deepEqual(M.diffUnits([], ["a", "b"]), [{ s: 0, e: 0, ins: ["a", "b"] }]);
  // Review Focus 2: budgets bail fast.
  let t = Date.now();
  assert.equal(M.diffUnits(Array(20_001).fill("a"), ["a"]), null);
  const x = Array.from({ length: 5000 }, (_, i) => `x${i}`);
  const y = Array.from({ length: 5000 }, (_, i) => `y${i}`);
  assert.equal(M.diffUnits(x, y), null, "D over 2000 bails");
  assert.ok(Date.now() - t < 3000, `budget bail took ${Date.now() - t} ms`);
}
{
  const ml = (b, l, r, n = true) => M.mergeLines(b, l, r, n);
  // Different lines: both kept.
  assert.deepEqual(ml(["a", "b", "c"], ["A", "b", "c"], ["a", "b", "C"]), { units: ["A", "b", "C"], lost: false });
  // Adjacent lines (touching hunks): both kept.
  assert.deepEqual(ml(["a", "b"], ["A", "b"], ["a", "B"]), { units: ["A", "B"], lost: false });
  // Same line: newer wins, lost.
  assert.deepEqual(ml(["a"], ["L"], ["R"], true), { units: ["L"], lost: true });
  assert.deepEqual(ml(["a"], ["L"], ["R"], false), { units: ["R"], lost: true });
  // Case 6: same-spot insertions: common prefix once, newer middle, older middle.
  assert.deepEqual(ml(["a"], ["a", "x", "y"], ["a", "x", "z"], false), { units: ["a", "x", "z", "y"], lost: false });
  // Insertion next to a change at its boundary: both, insertion first.
  assert.deepEqual(ml(["a", "b"], ["a", "N", "b"], ["a", "B"]), { units: ["a", "N", "B"], lost: false });
  // Case 7: an insertion strictly inside the other side's changed range: clash.
  assert.deepEqual(ml(["a", "b", "c"], ["a", "b", "I", "c"], ["X", "Y", "Z"], false), { units: ["X", "Y", "Z"], lost: true });
  // Superset: no loss.
  assert.deepEqual(ml(["a"], ["a", "x"], ["a", "x", "y"]), { units: ["a", "x", "y"], lost: false });
  // Deletion vs edit is a clash (empty region never "contained").
  assert.deepEqual(ml(["a", "b"], ["a"], ["a", "B"], false), { units: ["a", "B"], lost: true });
  // Blank-only difference: newer, no loss.
  assert.deepEqual(ml(["a", "b"], ["a", "", "b"], ["a", "", "", "b"], true), { units: ["a", "", "b"], lost: false });
  // Case 16: short-line loss is detected by position, not by "Done exists elsewhere".
  assert.deepEqual(ml(["Done", "todo"], ["Done", "Done"], ["Done", "later"], false), { units: ["Done", "later"], lost: true });
  // Case 11: a mermaid fence edited on both: newer fence, lost.
  const f = (s) => ["```mermaid", s, "```"].join("\n");
  assert.deepEqual(ml(["p", f("a")], ["p", f("L")], ["p", f("R")], true), { units: ["p", f("L")], lost: true });
  // Case 10: embedded table: cell on one side, paragraph above on the other.
  const table = (cell) => ["```notible-table", JSON.stringify({ v: 1, columns: [{ id: "c1", name: "A" }] }), JSON.stringify({ id: "r1", cells: { c1: cell } }), "```"].join("\n");
  const merged = ml(["p", table("x")], ["p", table("L")], ["P", table("x")]);
  assert.equal(merged.lost, false);
  assert.equal(merged.units[0], "P");
  assert.match(merged.units[1], /"c1":"L"/);
  // Same cell on both: newer value, lost.
  const clash = ml(["p", table("x")], ["p", table("L")], ["p", table("R")], false);
  assert.equal(clash.lost, true);
  assert.match(clash.units[1], /"c1":"R"/);
}
{
  // ---- mergeObject
  const obj = (over) => ({ id: "n1", type: "note", title: "T", content: doc(["a", "b", "c"]), props: "{}", parent_id: null, archived_at: null, trashed_at: null, created_at: 1, updated_at: 10, ...over });
  const sym = (base, L, R, x) => {
    const one = M.mergeObject(base, L, R, x);
    const two = M.mergeObject(base, { ...R, id: L.id }, { ...L, id: R.id }, !x);
    assert.deepEqual(two && { ...two.object }, one && { ...one.object }, "mergeObject is symmetric");
    assert.deepEqual(two && two.notes, one && one.notes, "notes are symmetric");
    if (one) assert.equal(two.loser === null, one.loser === null);
    if (one?.loser) assert.notEqual(two.loser, one.loser, "loser names the same version from the other side");
    return one;
  };
  const base = obj({});
  let r = sym(base, obj({ title: "T2", updated_at: 11 }), obj({ content: doc(["a", "B", "c"]), updated_at: 12 }), false);
  assert.equal(r.object.title, "T2");
  assert.equal(r.object.content, doc(["a", "B", "c"]));
  assert.equal(r.loser, null);
  assert.equal(r.object.updated_at, 13);
  r = sym(obj({ props: '{"status":"a","due":1}' }), obj({ props: '{"status":"b","due":1}', updated_at: 11 }), obj({ props: '{"due":2,"status":"a"}', updated_at: 12 }), false);
  assert.deepEqual(JSON.parse(r.object.props), { due: 2, status: "b" });
  assert.equal(r.loser, null);
  r = sym(obj({ props: '{"s":"a"}' }), obj({ props: '{"s":"L"}', updated_at: 11 }), obj({ props: '{"s":"R"}', updated_at: 12 }), false);
  assert.equal(JSON.parse(r.object.props).s, "R");
  assert.equal(r.loser, "L");
  r = sym(obj({ props: '{"_automationLog":[1]}' }), obj({ props: '{"_automationLog":[2]}', updated_at: 11 }), obj({ props: '{"_automationLog":[3]}', updated_at: 12 }), false);
  assert.deepEqual(JSON.parse(r.object.props)._automationLog, [3]);
  assert.equal(r.loser, null);
  r = sym(obj({ props: "{}" }), obj({ props: '{"__proto__":{"x":1}}', updated_at: 11 }), obj({ props: '{"k":1}', updated_at: 12 }), false);
  assert.equal(({}).x, undefined);
  r = sym(base, obj({ trashed_at: 11, updated_at: 11 }), obj({ content: doc(["a", "X", "c"]), updated_at: 12 }), false);
  assert.equal(r.object.trashed_at, null);
  assert.equal(r.loser, null);
  assert.match(r.notes.join(" "), /deleted on one device but edited on another/);
  r = sym(base, obj({ trashed_at: 11, updated_at: 11 }), obj({ trashed_at: 12, updated_at: 12 }), false);
  assert.equal(r.object.trashed_at, 12);
  r = sym(base, obj({ parent_id: "p1", updated_at: 11 }), obj({ parent_id: "p2", updated_at: 12 }), false);
  assert.equal(r.object.parent_id, "p2");
  assert.equal(r.loser, null);
  assert.equal(r.notes.length, 1);
  assert.equal(M.mergeObject(base, obj({ type: "task" }), obj({}), true), null);
  assert.equal(M.mergeObject(base, obj({ content: JSON.stringify({ type: "doc", content: [{ type: "heading", content: [] }] }) }), obj({ content: doc(["z"]) }), true), null);
  assert.equal(M.mergeObject(base, obj({ content: doc(["```", "x"]) }), obj({ content: doc(["q"]) }), true), null);
  const tp = (cell) => JSON.stringify({ columns: [{ id: "c1", name: "A" }], rows: [{ id: "r1", cells: { c1: cell } }] });
  r = sym(obj({ type: "table", props: tp("x") }), obj({ type: "table", props: tp("L"), updated_at: 11 }), obj({ type: "table", props: tp("R"), updated_at: 12 }), false);
  assert.equal(r.loser, "L");
  // F1: value-equal table cells spelled differently stay symmetric.
  const tc = (cells) => JSON.stringify({ columns: [{ id: "c1", name: "A" }, { id: "c2", name: "B" }], rows: [{ id: "r1", cells }] });
  r = sym(obj({ type: "table", props: tc({ c1: "x", c2: "y" }) }), obj({ type: "table", props: tc({ c1: "", c2: "y" }), updated_at: 11 }), obj({ type: "table", props: tc({ c2: "Y" }), updated_at: 12 }), false);
  assert.equal(JSON.parse(r.object.props).rows[0].cells.c2, "Y");
  r = sym(obj({ type: "table", props: tc({ c1: "x" }) }), obj({ type: "table", props: tc({ c1: null }), updated_at: 11 }), obj({ type: "table", props: tc({ c1: false, c2: "z" }), updated_at: 12 }), true);
  // F5: both trashed keeps the later stamp even when the other side is newer.
  r = sym(base, obj({ trashed_at: 20, updated_at: 30 }), obj({ trashed_at: 25, updated_at: 26 }), true);
  assert.equal(r.object.trashed_at, 25);
  // F6: long titles are capped in notes.
  r = sym(base, obj({ parent_id: "p1", title: "x".repeat(500), updated_at: 11 }), obj({ parent_id: "p2", title: "x".repeat(500), updated_at: 12 }), false);
  assert.ok(r.notes[0].length < 200);
  // Symmetry fuzz over small random triples.
  let seed = 11;
  const rnd = (n) => (((seed = (seed * 1103515245 + 12345) % 2147483648) >>> 16) % n);
  const lines = () => Array.from({ length: 1 + rnd(4) }, () => "abc"[rnd(3)]);
  let titleClashes = 0;
  let bodyClashes = 0;
  for (let i = 0; i < 300; i++) {
    const fb = obj({ content: doc(lines()), title: "t" + rnd(4) });
    const fL = obj({ content: doc(lines()), title: "t" + rnd(4), updated_at: 10 + rnd(3) });
    const fR = obj({ content: doc(lines()), title: "t" + rnd(4), updated_at: 10 + rnd(3) });
    const fr = sym(fb, fL, fR, rnd(2) === 1);
    if (new Set([fb.title, fL.title, fR.title]).size === 3) titleClashes += 1;
    if (fr?.loser) bodyClashes += 1;
  }
  assert.ok(titleClashes > 0, "fuzz exercises title clashes");
  assert.ok(bodyClashes > 0, "fuzz exercises content clashes");
}
// ---- lineage helpers
{
  const e = (vid, vh = "h" + vid, by = "", at = 0) => [vid, vh, by, at];
  assert.match(M.randomVid(), /^[0-9a-z]{12}$/);
  assert.notEqual(M.randomVid(), M.randomVid());
  assert.deepEqual(M.seedEntry("abc"), ["cabc", "abc", "", 0]);
  assert.ok(M.isSeedOnly([M.seedEntry("abc")]));
  assert.ok(!M.isSeedOnly([e("x"), M.seedEntry("abc")]));
  assert.equal(M.mergeVid("a", "b", "h"), M.mergeVid("b", "a", "h"));
  assert.match(M.mergeVid("a", "b", "h"), /^m[0-9a-z]{1,15}$/);
  // merged: min position, vid tie-break, cut to 8, same for both argument orders.
  assert.deepEqual(M.merged([e("a1"), e("c")], [e("b1"), e("c")]).map((x) => x[0]), ["a1", "b1", "c"]);
  assert.deepEqual(M.merged([e("b1"), e("c")], [e("a1"), e("c")]).map((x) => x[0]), ["a1", "b1", "c"]);
  assert.equal(M.merged(Array.from({ length: 8 }, (_, i) => e("a" + i)), Array.from({ length: 8 }, (_, i) => e("b" + i))).length, 8);
  assert.deepEqual(M.pin(e("z"), [e("a"), e("z"), e("b")]).map((x) => x[0]), ["z", "a", "b"]);
  // ancestor: smallest max(position), vid tie-break; symmetric.
  assert.equal(M.ancestor([e("a1"), e("x"), e("c")], [e("b1"), e("y"), e("c")])[0], "c");
  assert.equal(M.ancestor([e("a1"), e("c"), e("d")], [e("d"), e("c")])[0], "c");
  assert.equal(M.ancestor([e("q"), e("p")], [e("p"), e("q")])[0], "p");
  assert.equal(M.ancestor([e("p"), e("q")], [e("q"), e("p")])[0], "p");
  assert.equal(M.ancestor([e("a")], [e("b")]), null);
  // copyId: UUID v4 shape, deterministic, differs per vid.
  assert.match(M.copyId("n1", "v1"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(M.copyId("n1", "v1"), M.copyId("n1", "v1"));
  assert.notEqual(M.copyId("n1", "v1"), M.copyId("n1", "v2"));
  const loser = { id: "n1", type: "note", title: "Plan", content: "c", props: "{}", parent_id: "p", archived_at: null, trashed_at: 5, created_at: 1, updated_at: 9, extra: "x" };
  const copy = M.conflictCopy("n1", loser, ["v1", "h", "Laptop", Date.UTC(2026, 9, 3, 14, 5)], 99);
  assert.equal(copy.object.title, "Plan (conflict copy — Laptop, 2026-10-03 14:05 UTC)");
  assert.equal(copy.object.trashed_at, null);
  assert.equal(copy.object.extra, undefined, "explicit fields only");
  assert.equal(copy.object.updated_at, Date.UTC(2026, 9, 3, 14, 5));
  assert.equal(copy.entry[1], M.objectHash(copy.object));
  assert.equal(M.conflictCopy("n1", loser, ["v1", "h", "", 0], 99).object.title, "Plan (conflict copy — another device)");
  assert.equal(M.conflictCopy("n1", loser, ["v1", "h", "", 0], 99).object.updated_at, 99);
}
{
  // Review Focus 3: hostile lineage.
  const snap = (lineage, devices = ["A"]) => ({ lineageV: 1, devices, lineage });
  assert.deepEqual(M.readLineage({}), {});
  assert.deepEqual(M.readLineage(snap({}, "nope")), {});
  assert.deepEqual(M.readLineage(snap({}, Array(65).fill("d"))), {});
  assert.deepEqual(M.readLineage(snap({}, ["x".repeat(81)])), {});
  const good = M.readLineage(snap({ n1: [["v1", "h1", 0, 5], ["v1", "h1", 0, 5], ["v0", "h0", 0, 1]] }));
  assert.deepEqual(good.lineage.get("n1"), [["v1", "h1", "A", 5], ["v0", "h0", "A", 1]], "deduped, names mapped back");
  const bad = M.readLineage(JSON.parse(JSON.stringify(snap({
    __proto__: [["v1", "h1", 0, 5]],
    "bad id!": [["v1", "h1", 0, 5]],
    n2: [["v1", "h1", 3, 5]],
    n3: Array.from({ length: 9 }, (_, i) => ["v" + i, "h", 0, 1]),
    n4: [["V-1", "h1", 0, 5]],
    n5: [["v1", "h1", 0, -1]],
    n6: [["v1", "h1", 0, Date.UTC(2201, 0, 1)]],
    n7: "x",
  }))));
  assert.equal(bad.lineage.size, 0);
  assert.equal(({}).length, undefined, "no prototype pollution");
  // Valid "__proto__" via JSON text is an own key and still refused by storeable.
  const proto = M.readLineage(JSON.parse('{"lineageV":1,"devices":["A"],"lineage":{"__proto__":[["v1","h1",0,5]]}}'));
  assert.equal(proto.lineage.size, 0);
  assert.ok(M.storeable("2f1c9a4e-1b2c-4d3e-8f90-123456789abc"));
  for (const id of ["", "a/b", "a:b", "x".repeat(65), "__proto__"]) assert.ok(!M.storeable(id), id);
}
{
  // Fix round 1: rejected ids, hostile stamps, long titles, code-point names.
  const snap = (lineage, devices = ["A"]) => ({ lineageV: 1, devices, lineage });
  const r = M.readLineage(snap({
    good: [["v1", "h1", 0, 5]], f1: [["v1", "h1", 0.5, 5]], f2: [["v1", "H!", 0, 5]], f3: [["v1", "h1", 0]],
    f4: [], f5: Array.from({ length: 9 }, (_, i) => ["v" + i, "h", 0, 1]), f6: "x", "bad id!": [["v1", "h1", 0, 5]],
  }));
  assert.deepEqual([...r.lineage.keys()], ["good"]);
  assert.deepEqual([...r.lineageRejected].sort(), ["f1", "f2", "f3", "f4", "f5", "f6"], "storeable but invalid; unstoreable ids are not listed");
  const p = M.readLineage(JSON.parse('{"lineageV":1,"devices":["A"],"lineage":{"__proto__":[["v1","h1",0,5]],"n1":[["v1","h1",0,5]]}}'));
  assert.deepEqual([...p.lineage.keys()], ["n1"]);
  assert.equal(p.lineageRejected.size, 0);
  assert.equal(Object.getPrototypeOf(p.lineage), Map.prototype);
  assert.equal(M.readLineage(snap({}, ["😀".repeat(80)])).lineageV, 1, "80 code points is fine");
  assert.deepEqual(M.readLineage(snap({}, ["😀".repeat(81)])), {});
  const lo = { type: "note", title: "T", content: "", props: "{}" };
  for (const at of [Infinity, NaN, -1, "123", 8.64e15 + 1, Date.UTC(2201, 0, 1)]) {
    const cc = M.conflictCopy("n1", lo, ["v1", "h", "D", at], 7);
    assert.equal(cc.object.title, "T (conflict copy — D)");
    assert.equal(cc.object.updated_at, 7);
  }
  const long = M.conflictCopy("n1", { ...lo, title: "a".repeat(3999) + "😀" }, ["v1", "h", "D", 0], 7).object.title;
  assert.ok(long.length <= M.MERGE_TITLE_LIMIT && long.endsWith("(conflict copy — D)"));
  assert.ok(!/[�-�](?![�-�])/.test(long), "no lone surrogate");
}
{
  // loadVersion validates vid, vh and the content hash (case 21).
  const store = new Map();
  const st = { get: async (k) => store.get(k) ?? null };
  const o = { type: "note", title: "T", content: "c", props: "{}", parent_id: null, archived_at: null, trashed_at: null };
  const vh = M.objectHash(o);
  store.set("v:n1:v1", JSON.stringify(M.versionOf(o, ["v1", vh, "", 0])));
  assert.equal((await M.loadVersion(st, "n1", ["v1", vh, "", 0])).title, "T");
  assert.equal(await M.loadVersion(st, "n1", ["v1", "other", "", 0]), null);
  store.set("v:n1:v2", JSON.stringify({ ...M.versionOf(o, ["v2", vh, "", 0]), title: "tampered" }));
  assert.equal(await M.loadVersion(st, "n1", ["v2", vh, "", 0]), null);
  store.set("v:n1:v3", "{not json");
  assert.equal(await M.loadVersion(st, "n1", ["v3", vh, "", 0]), null);
}
// ---- simulator: N devices, a Drive, Core's newest-wins apply
const memStore = () => {
  const m = new Map();
  return {
    m,
    fail: false,
    async get(k) { return m.get(k) ?? null; },
    async getMany(ks) { return ks.map((k) => m.get(k) ?? null); },
    async setMany(es) { if (this.fail) throw new Error("store full"); for (const [k, v] of es) m.set(k, v); },
    async deleteMany(ks) { for (const k of ks) m.delete(k); },
    async keys(p = "") { return [...m.keys()].filter((k) => k.startsWith(p)).sort(); },
    async deletePrefix(p) { let n = 0; for (const k of [...m.keys()]) if (k.startsWith(p)) { m.delete(k); n++; } return n; },
  };
};
const clone = (x) => JSON.parse(JSON.stringify(x));
class Device {
  constructor(name) { Object.assign(this, { name, rows: new Map(), tomb: new Map(), store: memStore(), lin: null, bases: {}, tables: {}, seen: new Map(), descriptors: new Map(), typing: null, legacy: false, events: [] }); }
  put(o) { this.rows.set(o.id, clone(o)); }
  edit(id, patch, at) { this.put({ ...this.rows.get(id), ...patch, updated_at: at }); }
  body(id) { return M.flatLines(this.rows.get(id).content).join("|"); }
  copies() { return [...this.rows.values()].filter((o) => o.title.includes("(conflict copy")).map((o) => JSON.stringify(o)).sort(); }
  apply(input) {
    let n = 0;
    // SYNC-NO-LOSS (Hive #14, F2): the user saves after the plan was made, before Core applies it.
    if (this.beforeApply) { const f = this.beforeApply; this.beforeApply = null; f(this); }
    const stale = [];
    for (const o of input.objects) {
      if (this.tomb.has(o.id) || this.refuse?.(o)) continue;
      const cur = this.rows.get(o.id);
      // Core's sync_apply: a row that changed since the plan's export is refused.
      if (input.expected && Object.hasOwn(input.expected, o.id) && (cur?.updated_at ?? null) !== input.expected[o.id]) { stale.push(o.id); continue; }
      if (cur && o.updated_at <= cur.updated_at) continue;
      this.put(o);
      n++;
    }
    for (const t of input.tombstones ?? []) { this.rows.delete(t.object_id); this.tomb.set(t.object_id, t.deleted_at); }
    if (this.typing) { const f = this.typing; this.typing = null; f(this); }
    for (const d of M.readConflictDescriptors(input)) if (!stale.includes(d.copyId) && !stale.includes(d.originalId)) this.descriptors.set(d.copyId, d);
    return { appliedObjects: n, staleObjects: stale };
  }
  exported() { return [...this.rows.values()].map(clone); }
}
const drive = new Map();
async function cycle(dev, view = drive) {
  dev.lin ??= await M.openLineage(dev.store, dev.exported());
  if (dev.legacy) dev.lin.off = true;
  const localById = new Map(dev.exported().map((o) => [o.id, o]));
  const io = {
    deviceName: dev.label ?? dev.name, copyLabel: dev.label ?? dev.name, localById,
    apply: async (input) => dev.apply(input),
    exportById: async (ids) => new Map(dev.exported().filter((o) => ids.has(o.id)).map((o) => [o.id, o])),
  };
  let writes = 0;
  for (const [peer, file] of [...view]) {
    if (peer === dev.name || dev.seen.get(peer) === file.rev) continue;
    const raw = clone(file.snap);
    const validated = { deviceName: peer, objects: raw.objects, conflicts: raw.conflicts, tombstones: raw.tombstones, ...M.readLineage(raw) };
    const res = await M.pullPeer(dev.lin, io, {
      validated,
      apply: { objects: validated.objects, conflicts: validated.conflicts, relations: [], tombstones: validated.tombstones, relationTombstones: [] },
      deferredIds: new Set(), bases: dev.bases[peer] ?? {}, tables: dev.tables[peer] ?? {},
    });
    writes += res.applied;
    dev.events.push(...res.events);
    dev.bases[peer] = res.next.bases;
    dev.tables[peer] = res.next.tables;
    if (!res.retry) dev.seen.set(peer, file.rev);
  }
  const objects = dev.exported();
  const lineage = await M.pushLineage(dev.lin, objects, dev.label ?? dev.name);
  const snap = clone({ objects, conflicts: [...dev.descriptors.values()], tombstones: [...dev.tomb].map(([object_id, deleted_at]) => ({ object_id, deleted_at })), ...lineage });
  const prev = drive.get(dev.name);
  if (prev && JSON.stringify(prev.snap) === JSON.stringify(snap)) return writes;
  drive.set(dev.name, { snap, rev: (prev?.rev ?? 0) + 1 });
  return writes + 1;
}
/** One round: everyone pulls the Drive as it was at the start, then pushes. */
async function together(devs) { const view = new Map(drive); let w = 0; for (const d of devs) w += await cycle(d, view); return w; }
/** Settles within `max` rounds and then stays quiet. Returns rounds used. */
async function settle(devs, max = 2) {
  for (let i = 0; i <= max; i++) if (!(await together(devs))) return i;
  assert.fail(`did not settle within ${max} rounds`);
}
const copyCheck = (devs, n) => {
  const sets = devs.map((d) => d.copies());
  for (const s of sets) assert.deepEqual(s, sets[0], "same copies, same bytes on every device");
  assert.equal(sets[0].length, n, `expected ${n} conflict copies`);
};
const note = (id, lines, at = 1) => ({ id, type: "note", title: "N", content: doc(lines), props: "{}", parent_id: null, archived_at: null, trashed_at: null, created_at: 1, updated_at: at });
/** Fresh world: devices holding identical copies, lineage seeded, settled. */
async function world(names, objects) {
  drive.clear();
  const devs = names.map((n) => new Device(n));
  for (const d of devs) for (const o of objects) d.put(o);
  await settle(devs);
  return devs;
}
{ // 1: different paragraphs, simultaneous
  const [A, B] = await world(["A", "B"], [note("n1", ["a", "b", "c"])]);
  A.edit("n1", { content: doc(["A", "b", "c"]) }, 10);
  B.edit("n1", { content: doc(["a", "b", "C"]) }, 11);
  await settle([A, B], 3);
  for (const d of [A, B]) assert.equal(d.body("n1"), "A|b|C");
  copyCheck([A, B], 0);
}
{ // 2: adjacent lines, simultaneous and sequential
  let [A, B] = await world(["A", "B"], [note("n1", ["a", "b"])]);
  A.edit("n1", { content: doc(["A", "b"]) }, 10);
  B.edit("n1", { content: doc(["a", "B"]) }, 11);
  await settle([A, B], 3);
  for (const d of [A, B]) assert.equal(d.body("n1"), "A|B");
  copyCheck([A, B], 0);
  [A, B] = await world(["A", "B"], [note("n1", ["a", "b"])]);
  A.edit("n1", { content: doc(["A", "b"]) }, 10);
  await cycle(A);
  B.edit("n1", { content: doc(["a", "B"]) }, 11);
  await cycle(B);
  await settle([A, B]);
  for (const d of [A, B]) assert.equal(d.body("n1"), "A|B");
  copyCheck([A, B], 0);
}
{ // 3: same line → newer text, 1 copy of the older one
  const [A, B] = await world(["A", "B"], [note("n1", ["a"])]);
  A.edit("n1", { content: doc(["old"]) }, 10);
  B.edit("n1", { content: doc(["new"]) }, 11);
  await settle([A, B], 3);
  for (const d of [A, B]) assert.equal(d.body("n1"), "new");
  copyCheck([A, B], 1);
  assert.match(A.copies()[0], /old/);
}
{ // 4: sequential re-edit (round-1 trace): A's S and B's T survive, no copies
  const [A, B] = await world(["A", "B"], [note("n1", ["s", "x", "t"])]);
  A.edit("n1", { content: doc(["S1", "x", "t"]) }, 10);
  B.edit("n1", { content: doc(["s", "x", "t"]) }, 1); // unchanged
  await settle([A, B]);
  B.edit("n1", { content: doc(["S1", "x", "T"]) }, 20);   // B edits T, still holding head = A's version
  A.edit("n1", { content: doc(["S2", "x", "t"]) }, 21);   // A edits S again and pushes first
  await cycle(A);
  await cycle(B);
  await settle([A, B]);
  for (const d of [A, B]) assert.equal(d.body("n1"), "S2|x|T");
  copyCheck([A, B], 0);
}
{ // 5: three devices, both read orders; a C without the ancestor; all at once
  for (const order of [["A", "B", "C"], ["C", "B", "A"]]) {
    const devs = await world(["A", "B", "C"], [note("n1", ["a", "b", "c"])]);
    const by = Object.fromEntries(devs.map((d) => [d.name, d]));
    by.A.edit("n1", { content: doc(["A", "b", "c"]) }, 10);
    by.B.edit("n1", { content: doc(["a", "b", "B"]) }, 11);
    for (const n of order) await cycle(by[n]);
    await settle(devs, 4);
    for (const d of devs) assert.equal(d.body("n1"), "A|b|B");
    assert.ok(devs[0].copies().length <= 1);
    copyCheck(devs, devs[0].copies().length);
  }
  { // C lost its stored versions: legacy for it, ≤ 2 copies, no lost text
    const devs = await world(["A", "B", "C"], [note("n1", ["a"])]);
    const [A, B, C] = devs;
    A.edit("n1", { content: doc(["fromA"]) }, 10);
    B.edit("n1", { content: doc(["fromB"]) }, 11);
    C.edit("n1", { content: doc(["fromC"]) }, 12);
    for (const k of await C.store.keys("v:")) C.store.m.delete(k);
    await settle(devs, 5);
    const texts = new Set(devs.flatMap((d) => [...d.rows.values()].map((o) => M.flatLines(o.content).join("|"))));
    for (const t of ["fromA", "fromB", "fromC"]) assert.ok(texts.has(t), `${t} survives somewhere`);
    const bodies = devs.map((d) => d.body("n1"));
    assert.ok(bodies.every((b) => b === bodies[0]));
  }
  { // all three read each other in one round (round-3 N2)
    const devs = await world(["A", "B", "C"], [note("n1", ["a", "b", "c"])]);
    devs[0].edit("n1", { content: doc(["A", "b", "c"]) }, 10);
    devs[1].edit("n1", { content: doc(["a", "B", "c"]) }, 11);
    devs[2].edit("n1", { content: doc(["a", "b", "C"]) }, 12);
    await settle(devs, 5);
    for (const d of devs) assert.equal(d.body("n1"), "A|B|C");
    copyCheck(devs, 0);
  }
}
{ // 8 + 9 through the full path: title on A, prop on B
  const [A, B] = await world(["A", "B"], [{ ...note("n1", ["a"]), props: '{"status":"open","due":1}' }]);
  A.edit("n1", { title: "Renamed" }, 10);
  B.edit("n1", { props: '{"status":"open","due":2}' }, 11);
  await settle([A, B], 3);
  for (const d of [A, B]) {
    assert.equal(d.rows.get("n1").title, "Renamed");
    assert.equal(JSON.parse(d.rows.get("n1").props).due, 2);
  }
  copyCheck([A, B], 0);
}
{ // 12: unclosed fence on one side → legacy (today's newer-wins + copy)
  const [A, B] = await world(["A", "B"], [note("n1", ["a"])]);
  A.edit("n1", { content: doc(["```", "open"]) }, 10);
  B.edit("n1", { content: doc(["b"]) }, 11);
  await settle([A, B], 3);
  for (const d of [A, B]) assert.equal(d.body("n1"), "b");
  assert.equal(new Set([...A.copies(), ...B.copies()].map((c) => JSON.parse(c).content)).size, 1);
}
{ // 12b (Review Focus 1): a rich body takes the legacy path, same result as today
  const [A, B] = await world(["A", "B"], [note("n1", ["a"])]);
  const rich = JSON.stringify({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "H" }] }] });
  A.edit("n1", { content: rich }, 10);
  B.edit("n1", { content: doc(["b"]) }, 11);
  await settle([A, B], 3);
  for (const d of [A, B]) assert.equal(d.rows.get("n1").content, doc(["b"]));
}
{ // 13: trash on A, edit on B → kept, not trashed
  const [A, B] = await world(["A", "B"], [note("n1", ["a"])]);
  A.edit("n1", { trashed_at: 10 }, 10);
  B.edit("n1", { content: doc(["edited"]) }, 11);
  await settle([A, B], 3);
  for (const d of [A, B]) { assert.equal(d.rows.get("n1").trashed_at, null); assert.equal(d.body("n1"), "edited"); }
  copyCheck([A, B], 0);
  // SYNC-NOTICE (Hive #11): A hears its delete was overridden, B that its edit was kept.
  assert.deepEqual(A.events.map((e) => [e.kind, e.id, e.device]), [["restored", "n1", "B"]]);
  assert.deepEqual(B.events.map((e) => [e.kind, e.id, e.device]), [["kept-edit", "n1", "A"]]);
}
{ // 14: content returns (trash→restore, rename→back) racing an edit
  const [A, B] = await world(["A", "B"], [note("n1", ["a", "b"])]);
  A.edit("n1", { trashed_at: 10 }, 10);
  await cycle(A);
  A.edit("n1", { trashed_at: null }, 12);
  B.edit("n1", { content: doc(["a", "B"]) }, 13);
  await settle([A, B], 4);
  A.edit("n1", { title: "X" }, 20);
  await cycle(A);
  A.edit("n1", { title: "N" }, 22);
  B.edit("n1", { content: doc(["A2", "B"]) }, 23);
  await settle([A, B], 4);
  for (const d of [A, B]) { assert.equal(d.body("n1"), "A2|B"); assert.equal(d.rows.get("n1").title, "N"); assert.equal(d.rows.get("n1").trashed_at, null); }
}
{ // 15: database restore on B: re-seeds, catches up, A never goes back
  // Fix round 1 (F-C): B's seed c+vh(v1) sits at position 1 of A's lineage, so it is
  // no longer proof of ancestry; both sides now take the legacy path, which still
  // ends at v2 (Core's newest-wins keeps A's newer row). Expectation unchanged.
  // Hive #12 (SYNC-ABA): B's bases (localStorage) outlive the restore and say v2,
  // so A's newer v2 over B's v1 reads like case 39's revert over an edit. B now
  // keeps the restored v1 as one conflict copy instead of dropping it (was 0).
  // Stamps cannot separate the two shapes (fuzz reset seeds 3984, 7231 lost
  // text when they tried), and an extra copy loses nothing.
  const [A, B] = await world(["A", "B"], [note("n1", ["v1"])]);
  const old = clone([...B.rows.values()]);
  A.edit("n1", { content: doc(["v2"]) }, 10);
  await settle([A, B]);
  B.rows = new Map(old.map((o) => [o.id, o]));
  B.store = memStore();
  B.lin = null;
  B.seen = new Map();
  await settle([A, B], 3);
  for (const d of [A, B]) assert.equal(d.body("n1"), "v2");
  copyCheck([A, B], 1);
  assert.match(A.copies()[0], /v1/, "the copy holds the restored text");
}
{ // 16: short-line loss through the full path
  const [A, B] = await world(["A", "B"], [note("n1", ["Done", "todo"])]);
  A.edit("n1", { content: doc(["Done", "Done"]) }, 10);
  B.edit("n1", { content: doc(["Done", "later"]) }, 11);
  await settle([A, B], 3);
  copyCheck([A, B], 1);
}
{ // 17: A's clock a day ahead
  const [A, B] = await world(["A", "B"], [note("n1", ["a", "b"])]);
  A.edit("n1", { content: doc(["A", "b"]) }, 86_400_000);
  B.edit("n1", { content: doc(["a", "B"]) }, 11);
  await settle([A, B], 3);
  for (const d of [A, B]) assert.equal(d.body("n1"), "A|B");
  assert.ok(A.copies().length <= 1);
}
{ // 18: the user types during the cycle → no advance, not seen, next cycle merges
  const [A, B] = await world(["A", "B"], [note("n1", ["a", "b", "c"])]);
  A.edit("n1", { content: doc(["A", "b", "c"]) }, 10);
  await cycle(A);
  B.edit("n1", { content: doc(["a", "B", "c"]) }, 11);
  await cycle(B);
  A.typing = (d) => d.edit("n1", { content: doc(["A", "b", "c", "typed"]) }, 99);
  const before = A.seen.get("B");
  await cycle(A);
  assert.equal(A.seen.get("B"), before, "the peer file is not marked seen");
  copyCheck([A], 0);
  await settle([A, B], 3);
  for (const d of [A, B]) assert.equal(d.body("n1"), "A|B|c|typed");
  copyCheck([A, B], 0);
}
{ // 19: burst: 200 objects, 20 same-line clashes → 20 copies, same everywhere
  const objs = Array.from({ length: 200 }, (_, i) => note(`n${i}`, ["a", "b"]));
  const [A, B] = await world(["A", "B"], objs);
  for (let i = 0; i < 200; i++) {
    A.edit(`n${i}`, { content: doc(["A", "b"]) }, 10);
    B.edit(`n${i}`, { content: doc(i < 20 ? ["B", "b"] : ["a", "B"]) }, 11);
  }
  await settle([A, B], 3);
  copyCheck([A, B], 20);
  assert.equal(A.body("n50"), "A|B");
}
{ // 20: upgrade while dirty → legacy once, then lineage works
  drive.clear();
  const A = new Device("A");
  const B = new Device("B");
  A.put(note("n1", ["a", "b"]));
  B.put(note("n1", ["a", "B"], 5)); // edited before the upgrade, never exchanged
  await settle([A, B], 3);
  for (const d of [A, B]) assert.equal(d.body("n1"), "a|B");
  A.edit("n1", { content: doc(["A", "B"]) }, 20);
  B.edit("n1", { content: doc(["a", "B", "c"]) }, 21);
  await settle([A, B], 3);
  for (const d of [A, B]) assert.equal(d.body("n1"), "A|B|c");
}
{ // 21: corrupt stored version → missing → legacy
  const [A, B] = await world(["A", "B"], [note("n1", ["a", "b"])]);
  for (const k of await A.store.keys("v:")) A.store.m.set(k, "{broken");
  A.edit("n1", { content: doc(["A", "b"]) }, 10);
  B.edit("n1", { content: doc(["a", "B"]) }, 11);
  await settle([A, B], 3);
  const bodies = [A.body("n1"), B.body("n1")];
  assert.equal(bodies[0], bodies[1]);
}
{ // 22: legacy peer (no lineageV) → exactly planConflicts
  const [A, B] = await world(["A", "B"], [note("n1", ["a"])]);
  B.legacy = true;
  B.lin.off = true;
  A.edit("n1", { content: doc(["A"]) }, 10);
  B.edit("n1", { content: doc(["B"]) }, 11);
  await cycle(B);
  const snapB = clone(drive.get("B").snap);
  assert.equal(snapB.lineageV, undefined);
  const expected = M.planConflicts(snapB.objects, new Map(A.exported().map((o) => [o.id, o])), A.bases.B ?? {}, A.tables.B ?? {}, "A");
  const before = new Map(A.rows);
  await cycle(A);
  const touched = [...A.rows.values()].filter((o) => before.get(o.id)?.updated_at !== o.updated_at);
  assert.equal(touched.length, expected.objects.filter((o) => !before.get(o.id) || o.updated_at > before.get(o.id).updated_at).length);
}
{ // 23: fast-forward keeps R's head → no spurious version at the next push
  for (const [x, y] of [["A", "B"], ["B", "A"]]) {
    const devs = await world([x, y], [note("n1", ["a"])]);
    devs[0].edit("n1", { content: doc(["z"]) }, 10);
    await cycle(devs[0]);
    await cycle(devs[1]);
    const head = devs[1].lin.lin.get("n1").l[0];
    assert.equal(head[1], M.objectHash(devs[1].rows.get("n1")));
    const rev = drive.get(devs[1].name).rev;
    await cycle(devs[1]);
    assert.equal(drive.get(devs[1].name).rev, rev, "no new push");
  }
}
{ // 24: criss-cross with a dirty side → no lost text, ≤1 copy, settles
  const [A, B] = await world(["A", "B"], [note("n1", ["s", "t", "u"])]);
  A.edit("n1", { content: doc(["S", "t", "u"]) }, 10);
  B.edit("n1", { content: doc(["s", "T", "u"]) }, 11);
  await together([A, B]);
  B.edit("n1", { content: doc(["s", "T2", "u"]) }, 12);
  await together([A, B]);
  await settle([A, B], 4);
  assert.equal(A.body("n1"), B.body("n1"));
  assert.match(A.body("n1"), /S/);
  assert.ok(A.copies().length <= 1);
  copyCheck([A, B], A.copies().length);
}
{ // 25: a newer local tombstone blocks an object → file still seen
  const [A, B] = await world(["A", "B"], [note("n1", ["a"]), note("n2", ["x"])]);
  A.rows.delete("n1");
  A.tomb.set("n1", 50);
  B.edit("n1", { content: doc(["b"]) }, 11);
  await cycle(B);
  await cycle(A);
  assert.equal(A.seen.get("B"), drive.get("B").rev, "marked seen");
  assert.ok(!A.lin.lin.has("n1"), "lineage purged");
}
{ // 26: a lineage-only change is pushed
  const [A, B] = await world(["A", "B"], [note("n1", ["a"])]);
  A.edit("n1", { content: doc(["same"]) }, 10);
  B.edit("n1", { content: doc(["same"]) }, 11);
  await together([A, B]);
  const revs = [drive.get("A").rev, drive.get("B").rev];
  await together([A, B]);
  assert.ok(drive.get("A").rev > revs[0] || drive.get("B").rev > revs[1], "pin(merged) changed lineage and was pushed");
  await settle([A, B]);
}
{ // 27 (Review Focus 4): store fails mid-sync → lineage off, sync carries on as legacy
  const [A, B] = await world(["A", "B"], [note("n1", ["a"])]);
  A.store.fail = true;
  A.edit("n1", { content: doc(["A"]) }, 10);
  B.edit("n1", { content: doc(["B"]) }, 11);
  await settle([A, B], 3);
  assert.equal(A.lin.off, true);
  assert.equal(A.body("n1"), B.body("n1"));
  assert.equal(drive.get("A").snap.lineageV, undefined, "an off device reads as a legacy peer");
}
{ // 28 (Review Focus 5): ids that cannot be store keys → legacy, never in a key
  const [A, B] = await world(["A", "B"], [note("odd:id/1", ["a", "b"])]);
  A.edit("odd:id/1", { content: doc(["A", "b"]) }, 10);
  B.edit("odd:id/1", { content: doc(["a", "B"]) }, 11);
  await settle([A, B], 3);
  for (const d of [A, B]) assert.ok(!(await d.store.keys("")).some((k) => k.includes("odd:id/1")));
  assert.equal(A.body("odd:id/1"), B.body("odd:id/1"));
}
{ // 29 (fix round, readLineage.lineageRejected): a malformed lineage for a changed object → legacy, not skipped
  // Without the rule, the implicit seed "c"+vh(R) is in A's lineage (n1 was "a" at seeding) and check 3 skips R.
  const [A, B] = await world(["A", "B"], [note("n1", ["a"])]);
  A.edit("n1", { content: doc(["b"]) }, 10);
  await settle([A, B]);
  B.edit("n1", { content: doc(["a"]) }, 20); // back to the seeded text
  await cycle(B);
  const snap = drive.get("B").snap;
  snap.lineage.n1[0][0] = "BAD!";
  assert.ok(M.readLineage(clone(snap)).lineageRejected.has("n1"));
  await cycle(A);
  assert.equal(A.body("n1"), "a", "the change arrived through the legacy path");
  await settle([A, B], 3);
  for (const d of [A, B]) assert.equal(d.body("n1"), "a");
  copyCheck([A, B], 0);
}
{ // 30: an unaware snapshot ({} from readLineage, no `lineageRejected`) and a long device name
  const long = "😀".repeat(100);
  const [A, B] = await world([long, "B"], [note("n1", ["a"])]);
  A.edit("n1", { content: doc(["A"]) }, 10);
  await settle([A, B]);
  const read = M.readLineage(clone(drive.get(long).snap));
  assert.equal(read.lineageV, 1, "the peer accepts our device names");
  assert.equal([...read.lineage.get("n1")[0][2]].length, 80);
  const lin = await M.openLineage(memStore(), []);
  const res = await M.pullPeer(lin, { deviceName: "X", copyLabel: "X", localById: new Map(), apply: async () => ({ appliedObjects: 1 }), exportById: async () => new Map([["n9", note("n9", ["z"])]]) },
    { validated: { objects: [note("n9", ["z"])], tombstones: [], ...M.readLineage({}) }, apply: { objects: [note("n9", ["z"])], relations: [], tombstones: [], relationTombstones: [] }, deferredIds: new Set(), bases: {}, tables: {} });
  assert.equal(res.applied, 1);
  assert.deepEqual(lin.lin.get("n9").l, [M.seedEntry(M.objectHash(note("n9", ["z"])))], "taken from an older peer: seed lineage");
}
{ // 31: the user types during a legacy apply → the typed row is a local edit, not a seed
  const [A, B] = await world(["A", "B"], [note("n1", ["a"])]);
  B.legacy = true;
  B.lin.off = true;
  B.edit("n1", { content: doc(["fromB"]) }, 11);
  await cycle(B);
  A.typing = (d) => d.edit("n1", { content: doc(["typed"]) }, 99);
  await cycle(A);
  assert.ok(!M.isSeedOnly(A.lin.lin.get("n1").l), "pushed with its own vid");
  await settle([A, B], 3);
  assert.equal(A.body("n1"), B.body("n1"));
  const texts = new Set([A, B].flatMap((d) => [...d.rows.values()].map((o) => M.flatLines(o.content).join("|"))));
  for (const t of ["typed", "fromB"]) assert.ok(texts.has(t), `${t} survives somewhere`);
}
// SYNC-MERGE-A (Hive #5), fix round 1: seeded randomness. randomVid and
// planConflicts' copy ids read crypto; this swaps in mulberry32 so a failing
// seed replays exactly.
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
async function withSeed(seed, fn) {
  const rnd = mulberry32(seed);
  const hex = () => Math.floor(rnd() * 2 ** 32).toString(16).padStart(8, "0");
  const real = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: {
    getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(rnd() * 256); return a; },
    randomUUID: () => { const h = hex() + hex() + hex() + hex(); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`; },
  } });
  try { return await fn(rnd); } finally { Object.defineProperty(globalThis, "crypto", real); }
}
const allTexts = (devs) => new Set(devs.flatMap((d) => [...d.rows.values()].flatMap((o) => M.flatLines(o.content))));
{ // 32 (F-A): alternating with a legacy peer leaves no orphaned v: rows
  const [A, B] = await world(["A", "B"], [note("n1", ["a"])]);
  B.legacy = true;
  B.lin.off = true;
  let t = 100;
  for (let i = 0; i < 40; i++) {
    A.edit("n1", { content: doc(["A" + i]) }, t++);
    await cycle(A);
    await cycle(B);
    B.edit("n1", { content: doc(["B" + i]) }, t++);
    await cycle(B);
    await cycle(A);
    const rows = (await A.store.keys("v:n1:")).length;
    assert.ok(rows <= A.lin.lin.get("n1").h.size + 3, `round ${i}: ${rows} v: rows`);
  }
  // Three aware devices editing different lines: every v: row is held.
  const devs = await world(["A", "B", "C"], [note("n2", ["a", "b", "c"])]);
  for (let i = 0; i < 15; i++) {
    devs.forEach((d, k) => d.edit("n2", { content: doc(M.flatLines(d.rows.get("n2").content).map((x, j) => (j === k ? "ABC"[k] + i : x))) }, t++));
    await settle(devs, 6);
  }
  for (const d of devs) {
    const keys = await d.store.keys("v:n2:");
    assert.ok(keys.every((k) => d.lin.lin.get("n2").h.has(k.split(":")[2])), `${d.name}: no orphans`);
  }
  copyCheck(devs, 0);
}
{ // 33 (F-B): an identical edit, then disjoint edits: the adopted head is held, no copy
  for (let seed = 1; seed <= 12; seed++) {
    await withSeed(seed, async () => {
      const [A, B] = await world(["A", "B"], [note("n1", ["a", "b"])]);
      A.edit("n1", { content: doc(["same", "b"]) }, 10);
      B.edit("n1", { content: doc(["same", "b"]) }, 11);
      await settle([A, B]);
      for (const d of [A, B]) { const r = d.lin.lin.get("n1"); assert.ok(r.h.has(r.l[0][0]), `seed ${seed}: ${d.name} holds its head`); }
      A.edit("n1", { content: doc(["same", "b", "fromA"]) }, 20);
      B.edit("n1", { content: doc(["fromB", "same", "b"]) }, 21);
      await settle([A, B], 4);
      for (const d of [A, B]) assert.equal(d.body("n1"), "fromB|same|b|fromA", `seed ${seed}`);
      copyCheck([A, B], 0);
    });
  }
}
{ // 34 (F-C): a re-seed whose content went back to an earlier state is not proof of ancestry
  // (a) B reverts to the seeded text, then its lineage is reset (re-pair).
  const [A, B] = await world(["A", "B"], [note("n1", ["a"])]);
  A.edit("n1", { content: doc(["b"]) }, 10);
  await settle([A, B]);
  B.edit("n1", { content: doc(["a"]) }, 20);
  await M.resetLineage(B.store);
  B.lin = null;
  B.seen = new Map();
  await settle([A, B], 4);
  for (const d of [A, B]) assert.equal(d.body("n1"), "a", "(a) B's newest edit kept");
  copyCheck([A, B], 0);
}
{ // 34 (b): staggered upgrade, B reverts offline on the old plugin, then upgrades
  for (const resetSeen of [false, true]) {
    drive.clear();
    const A = new Device("A"), B = new Device("B");
    A.put(note("n1", ["a"]));
    B.put(note("n1", ["a"]));
    B.lin = { store: B.store, lin: new Map(), off: true, pending: new Set() };
    B.legacy = true;
    await settle([A, B]);
    A.edit("n1", { content: doc(["b"]) }, 10);
    await settle([A, B]);
    B.edit("n1", { content: doc(["a"]) }, 20);
    B.legacy = false;
    B.lin = null;
    if (resetSeen) B.seen = new Map(); // a real app restart
    await settle([A, B], 4);
    for (const d of [A, B]) assert.equal(d.body("n1"), "a", `(b) resetSeen=${resetSeen}: B's newest edit kept, no divergence`);
    copyCheck([A, B], 0);
  }
}
{ // 34 (c): mixed fleet, a legacy apply records the seed a third device holds deep
  drive.clear();
  const [A, B, C] = ["A", "B", "C"].map((n) => new Device(n));
  for (const d of [A, B, C]) d.put(note("n1", ["a"]));
  B.lin = { store: B.store, lin: new Map(), off: true, pending: new Set() };
  B.legacy = true;
  await settle([A, B, C]);
  C.edit("n1", { content: doc(["b"]) }, 10);
  await cycle(C);
  await cycle(A);
  await cycle(B);
  B.edit("n1", { content: doc(["a"]) }, 20);
  await cycle(B);
  await cycle(A);
  await cycle(C);
  await settle([A, B, C], 5);
  for (const d of [A, B, C]) assert.equal(d.body("n1"), "a");
}
{ // 35 (F-D): Core applies the merge and its copy, then the cycle dies before the lineage write
  for (const when of ["after", "before"]) {
    const [A, B] = await world(["A", "B"], [note("n1", ["x", "s", "y"])]);
    B.edit("n1", { content: doc(["x", "fromB", "y"]) }, 20);
    await cycle(B);
    A.edit("n1", { content: doc(["x", "fromA", "y"]) }, 10); // older, same spot: A's text loses
    const real = A.apply.bind(A);
    A.apply = (input) => {
      A.apply = real;
      if (when === "after") real(input);
      assert.ok(input.objects.some((o) => o.title.includes("(conflict copy")), "the copy rides in the first apply");
      throw new Error("app quit");
    };
    await assert.rejects(cycle(A), /app quit/);
    await settle([A, B], 4);
    assert.ok(allTexts([A, B]).has("fromA"), `${when}: fromA kept as a copy`);
    assert.equal(A.body("n1"), B.body("n1"));
    copyCheck([A, B], 1);
  }
}
{ // 36 (F-E): the user types into the merged row before the export; the local loser's copy stays
  for (let seed = 1; seed <= 10; seed++) {
    await withSeed(seed, async () => {
      const [A, B] = await world(["A", "B"], [note("n1", ["x", "s", "y"])]);
      A.edit("n1", { content: doc(["x", "fromA", "y"]) }, 10);
      B.edit("n1", { content: doc(["x", "fromB", "y"]) }, 20);
      await cycle(B);
      A.typing = (d) => { const l = M.flatLines(d.rows.get("n1").content); l[2] = "typed"; d.edit("n1", { content: doc(l) }, 99); };
      await cycle(A);
      await settle([A, B], 4);
      const texts = allTexts([A, B]);
      for (const t of ["fromA", "fromB", "typed"]) assert.ok(texts.has(t), `seed ${seed}: ${t} survives`);
      assert.equal(A.body("n1"), B.body("n1"));
    });
  }
}
{ // 37 (M6): the merge note caps the title at 80 code points
  const [A, B] = await world(["A", "B"], [{ ...note("n1", ["a", "b"]), title: "😀".repeat(100) }]);
  A.edit("n1", { content: doc(["A", "b"]) }, 10);
  B.edit("n1", { content: doc(["a", "B"]) }, 11);
  await cycle(B);
  const localById = new Map(A.exported().map((o) => [o.id, o]));
  const raw = clone(drive.get("B").snap);
  const validated = { objects: raw.objects, tombstones: raw.tombstones, ...M.readLineage(raw) };
  const res = await M.pullPeer(A.lin, { deviceName: "A", copyLabel: "A", localById, apply: async (i) => A.apply(i), exportById: async (ids) => new Map(A.exported().filter((o) => ids.has(o.id)).map((o) => [o.id, o])) },
    { validated, apply: { objects: validated.objects, relations: [], tombstones: [], relationTombstones: [] }, deferredIds: new Set(), bases: A.bases.B ?? {}, tables: {} });
  const n = res.notes.find((x) => x.includes("merged"));
  assert.ok(n && n.startsWith(`"${"😀".repeat(80)}…"`), n);
}
{ // 37b (fix round 3, N1): B reverts, its lineage is reset and re-seeded, then B edits
  // elsewhere. The salted "r" re-seed never matches the "c" seed deep in A's lineage,
  // so check 5 cannot use it as the merge base and B's revert survives.
  for (const pushFirst of [true, false]) {
    const [A, B] = await world(["A", "B"], [note("n1", ["a1", "a2"])]);
    A.edit("n1", { content: doc(["b1", "a2"]) }, 10);
    await settle([A, B]);
    B.edit("n1", { content: doc(["a1", "a2"]) }, 20);
    await M.resetLineage(B.store);
    await M.markReseed(B.store);
    B.lin = null;
    B.seen = new Map();
    if (pushFirst) await cycle(B);
    else B.lin = await M.openLineage(B.store, B.exported());
    assert.ok(B.lin.lin.get("n1").l[0][0].startsWith("r"), "salted re-seed");
    B.edit("n1", { content: doc(["a1", "c2"]) }, 21);
    await cycle(B);
    await cycle(A);
    await settle([A, B], 4);
    assert.equal(A.body("n1"), B.body("n1"));
    assert.ok([...allTexts([A, B])].some((t) => t.includes("a1")), `pushFirst=${pushFirst}: B's revert a1 survives`);
    assert.equal(A.body("n1").split("|")[0], "a1", "B's newer revert wins the body");
  }
}
{ // 37c (fix round 4, R3-1): a store failure turns lineage off; lineageOff's own
  // markReseed fails on that same store, yet the reopened lineage is salted,
  // because openLineage rotated the marker right after the first seeding.
  const [A, B] = await world(["A", "B"], [note("n1", ["a1", "a2"])]);
  assert.ok(B.store.m.get("reseed"), "the first seeding leaves a marker");
  // Hive #14 (F1): a first upgrade is salted too (was "c" + vh); after the first
  // exchange both devices hold one adopted head (check 2).
  assert.ok(B.lin.lin.get("n1").l[0][0].startsWith("r"), "every empty-store seed is salted");
  B.store.fail = true;
  B.edit("n1", { content: doc(["x", "a2"]) }, 5);
  await cycle(B);
  assert.equal(B.lin.off, true, "the store failure turned lineage off");
  B.store.fail = false;
  B.lin = null;
  await cycle(B);
  assert.equal(B.lin.off, false);
  assert.ok(B.lin.lin.get("n1").l[0][0].startsWith("r"), "the reopened lineage is a salted r seed");
  await settle([A, B], 4);
  assert.equal(A.body("n1"), "x|a2");
}
{ // 37d (fix round 4, R3-2): a salted "r" seed is unique, so a deep match of it is real
  // ancestry (checks 3/4), unlike a "c" seed. Both devices re-seed and agree on one r
  // head (check 2); A edits on top; B's row then carries a newer stamp on the old
  // content (the fuzz seed 271 shape). B must fast-forward to A's edit, not send the
  // stale newer row down the legacy path, where newest-wins dropped A's text.
  const [A, B] = await world(["A", "B"], [note("n1", ["a1"])]);
  for (const d of [A, B]) {
    await M.resetLineage(d.store);
    await M.markReseed(d.store);
    d.lin = null;
    d.seen = new Map();
  }
  drive.clear(); // old seed-only snapshots read as an implicit "c" seed
  await settle([A, B], 4);
  const r = A.lin.lin.get("n1").l[0][0];
  assert.ok(r.startsWith("r"), "salted re-seed");
  assert.equal(B.lin.lin.get("n1").l[0][0], r, "both hold the same r head");
  A.edit("n1", { content: doc(["y"]) }, 10);
  await cycle(A);
  assert.ok(A.lin.lin.get("n1").l.findIndex((e) => e[0] === r) > 0, "r is deep in A's lineage");
  B.edit("n1", {}, 50); // same content, newer stamp
  await settle([A, B], 4);
  for (const d of [A, B]) assert.equal(d.body("n1"), "y", `${d.name}: A's edit on top of the r seed wins`);
  copyCheck([A, B], 0);
}
{ // 37d P9 (final review, M2): the check-3 half of R3-2. Same shape as 37d, but B
  // pushes its newer-stamped row first and then A pulls it: B's head is the r seed,
  // deep in A's lineage, so A must keep its own edit (check 3 trusts an r seed at
  // any position). With r seeds treated as c seeds again, A falls to the legacy
  // path, B's newer stamp wins and A ends on the stale text.
  const [A, B] = await world(["A", "B"], [note("n1", ["a1"])]);
  for (const d of [A, B]) {
    await M.resetLineage(d.store);
    await M.markReseed(d.store);
    d.lin = null;
    d.seen = new Map();
  }
  drive.clear();
  await settle([A, B], 4);
  const r = A.lin.lin.get("n1").l[0][0];
  assert.ok(r.startsWith("r"), "salted re-seed");
  A.edit("n1", { content: doc(["y"]) }, 10);
  await cycle(A);
  assert.ok(A.lin.lin.get("n1").l.findIndex((e) => e[0] === r) > 0, "r is deep in A's lineage");
  B.edit("n1", {}, 50); // same content, newer stamp
  await cycle(B, new Map()); // B pushes first, pulls nothing
  await cycle(A); // A pulls B's r-headed row
  assert.equal(A.body("n1"), "y", "A keeps its edit on top of the r seed");
  await settle([A, B], 4);
  for (const d of [A, B]) assert.equal(d.body("n1"), "y", `${d.name}: converges on y`);
  copyCheck([A, B], 0);
}
{ // 38 (M8): seeded fuzz. Edits, reverts to earlier text, solo and joint cycles,
  // typing during an apply, lineage resets; then settle. No text that no device
  // overwrote may be lost, devices converge (copies too), and they settle.
  // The clock is a wall clock: an edit is stamped after every stamp it can see,
  // as Date.now() would be (an earlier stamp is clock skew, M7, out of scope).
  const run = async (seed, mode) => withSeed(seed, async (rnd) => {
    const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
    const devs = await world(["A", "B", "C"].slice(0, 2 + Math.floor(rnd() * 2)), [note("n1", ["l0", "l1", "l2", "l3"]), note("n2", ["m0", "m1"])]);
    let t = 100, tok = 0;
    const removed = new Set(), all = new Set(), history = [];
    const stamp = () => (t = Math.max(t, ...devs.flatMap((x) => [...x.rows.values()].map((o) => o.updated_at))) + 1 + Math.floor(rnd() * 3));
    const write = (d, id, k, next) => {
      const lines = M.flatLines(d.rows.get(id).content);
      if (lines[k] !== next) removed.add(lines[k]);
      lines[k] = next;
      all.add(next);
      d.edit(id, { content: doc(lines) }, stamp());
    };
    for (let step = 0; step < 30; step++) {
      const d = pick(devs);
      const r = rnd();
      if (r < 0.5) {
        const id = pick(["n1", "n1", "n2"]);
        const k = Math.floor(rnd() * M.flatLines(d.rows.get(id).content).length);
        // Fix round 2 (N3): reverts in every mode, the reset mode included. The
        // legacy planConflicts ABA that lost text on <1% of wide-sweep reset seeds
        // is fixed (Hive #12, case 39): 0 losses over reset seeds 1..20000.
        let next;
        if (rnd() < 0.15 && history.length) next = pick(history);
        else { next = `t${tok++}${d.name}`; history.push(next); }
        write(d, id, k, next);
      } else if (r < 0.58 && mode === "type") {
        const id = pick(["n1", "n2"]);
        d.typing = (dev) => write(dev, id, 0, `y${tok++}${dev.name}`);
      } else if (r < 0.62 && mode === "reset") {
        await M.resetLineage(d.store);
        await M.markReseed(d.store); // fix round 3: a reset re-seeds salted, as lineageOff does
        d.lin = null;
        d.seen = new Map();
      } else if (r < 0.85) await cycle(d);
      else { const view = new Map(drive); for (const x of devs) await cycle(x, view); }
    }
    for (const d of devs) d.typing = null;
    const where = `fuzz ${mode} seed ${seed}`;
    await settle(devs, 8).catch(() => assert.fail(`${where}: did not settle`));
    const bodies = devs.map((d) => ["n1", "n2"].map((id) => d.body(id)).join("/"));
    assert.equal(new Set(bodies).size, 1, `${where}: diverged ${bodies.join(" | ")}`);
    const copies = JSON.stringify(devs[0].copies());
    for (const d of devs) assert.equal(JSON.stringify(d.copies()), copies, `${where}: copies differ`);
    const have = allTexts(devs);
    const lost = [...all].filter((x) => !removed.has(x) && !have.has(x));
    assert.deepEqual(lost, [], `${where}: lost`);
  });
  for (const mode of ["plain", "type", "reset"]) for (let seed = 1; seed <= 40; seed++) await run(seed, mode);
}
{ // 39 (Hive #12, SYNC-ABA): legacy path, A reverts to the base text under a newer
  // stamp while B edits. remote == base read as "only B changed", newest-wins then
  // put A's revert over B's edit and B's text was gone (fuzz reset seeds 272, 1302...).
  const [A, B] = await world(["A", "B"], [note("n1", ["v1"])]);
  for (const d of [A, B]) {
    await M.resetLineage(d.store);
    await M.markReseed(d.store);
    d.lin = null;
    d.seen = new Map();
  }
  drive.clear();
  B.edit("n1", { content: doc(["b"]) }, 10);
  A.edit("n1", { content: doc(["x"]) }, 11);
  A.edit("n1", { content: doc(["v1"]) }, 12); // A reverts
  await cycle(A);
  await cycle(B);
  assert.ok(allTexts([B]).has("b"), "B's edit survives A's newer revert");
  await settle([A, B], 4);
  for (const d of [A, B]) assert.ok(allTexts([d]).has("b"), `${d.name}: has B's edit`);
  assert.equal(A.body("n1"), B.body("n1"), "converged");
  // SYNC-NOTICE (Hive #11): the device whose row became the copy is told, naming both.
  const told = [A, B].flatMap((d) => d.events.filter((e) => e.kind === "copy"));
  assert.ok(told.length >= 1 && told.every((e) => e.id === "n1" && /conflict copy/.test(e.copy)), JSON.stringify(told));
  // SYNC-NOTICE fix (Hive #20): each copy event names its copy object by id.
  for (const d of [A, B]) for (const e of d.events.filter((x) => x.kind === "copy")) {
    assert.equal(d.rows.get(e.copyId)?.title, e.copy, `#20: ${d.name}'s copy event carries the copy's id`);
  }
}
{ // SYNC-NOTICE (Hive #11): one notice per cycle, grouped, never one per note
  const t = (key, v = {}) => key.split(/\{(\w+)\}/).map((x, i) => (i % 2 ? String(v[x]) : x)).join("");
  assert.equal(M.mergeNotice([], t), null);
  assert.equal(M.mergeNotice([{ kind: "unknown", id: "a", title: "A" }], t), null);
  assert.deepEqual(M.mergeNotice([{ kind: "kept-edit", id: "a", title: "Shopping list", device: "Laptop" }], t),
    { message: "Sync kept your edit to 'Shopping list': it had been deleted on Laptop.", id: "a", left: [] });
  assert.match(M.mergeNotice([{ kind: "restored", id: "a", title: "T", device: "" }], t).message, /on another device after/);
  assert.match(M.mergeNotice([{ kind: "copy", id: "a", title: "T", device: "L", copy: "T (conflict copy — L)", mine: false }], t).message, /kept that version as 'T \(conflict copy — L\)'/);
  // Several events on one note are one note.
  assert.equal(M.mergeNotice([{ kind: "moved", id: "a", title: "A" }, { kind: "copy", id: "a", title: "A", mine: true }], t).id, "a");
  // SYNC-NOTICE fix (Hive #16, F5): production order (placement before copy) keeps both, copy first.
  const prod = M.mergeNotice([
    { kind: "moved", id: "a", title: "Plan", device: "Laptop" },
    { kind: "archived", id: "a", title: "Plan", device: "Laptop" },
    { kind: "copy", id: "a", title: "Plan", device: "Laptop", copy: "Mine (conflict copy — Desk)", mine: true },
    { kind: "moved", id: "a", title: "Plan", device: "Laptop" },
  ], t);
  assert.equal(prod.message, "'Plan' was changed on Laptop too, so Sync kept your version as 'Mine (conflict copy — Desk)'."
    + " 'Plan' was moved on Laptop too; that placement was kept. 'Plan' was archived or unarchived on Laptop too; that change was kept.");
  const huge = M.mergeNotice([{ kind: "moved", id: "a", title: "x".repeat(500), device: "d".repeat(99) },
    { kind: "edit-in-trash", id: "a", title: "x".repeat(500), device: "d".repeat(99) },
    { kind: "copy", id: "a", title: "x".repeat(500), mine: true, copy: "y".repeat(500), device: "d".repeat(99) }], t).message;
  assert.ok([...huge].length <= 300 && huge.includes("yyyy"), "combined: under Core's cap, copy kept");
  const many = ["a", "b", "c", "d", "e"].map((id) => ({ kind: "copy", id, title: id.toUpperCase(), mine: true }));
  assert.deepEqual(M.mergeNotice(many.slice(0, 2).map((e) => ({ ...e, kind: "moved" })), t), { message: "Sync merged conflicting changes in 2 notes: 'A', 'B'.", id: null, left: [] });
  assert.deepEqual(M.mergeNotice(many.map((e) => ({ ...e, copy: `${e.title} (copy)` })), t),
    { message: "Sync merged conflicting changes in 5 notes: 'A', 'B', 'C' and 2 more. Conflict copies kept: 'A (copy)', 'B (copy)' and 3 more.", id: null, left: [] });
  const long = many.map((e) => ({ ...e, title: "x".repeat(500), copy: "y".repeat(500), id: e.id }));
  assert.ok([...M.mergeNotice(long, t).message].length <= 300, "grouped with copies: under Core's cap");
  assert.ok([...M.mergeNotice([{ kind: "copy", id: "a", title: "x".repeat(500), mine: true, copy: "y".repeat(500) }], t).message].length < 300, "fits Core's notice cap");
  // SYNC-NOTICE fix (Hive #20): same-named copies (one minute apart) are two outcomes, not one.
  const twin = (copyId, id = "a") => ({ kind: "copy", id, title: "Plan", device: "Laptop", copy: "Plan (conflict copy — Laptop 10:15)", copyId, mine: true });
  assert.match(M.mergeNotice([twin("c1"), twin("c2")], t).message, /as 2 conflict copies, such as 'Plan \(conflict copy — Laptop 10:15\)'\.$/, "#20: both told");
  assert.equal(M.mergeNotice([twin("c1"), twin("c1")], t).message.split("as 'Plan (conflict copy").length - 1, 1, "#20: one copy told once");
  assert.match(M.mergeNotice([twin("c1"), twin("c2"), twin("c3", "b")], t).message, / and 1 more\.$/, "#20: three copies counted");
  // SYNC-NOTICE fix round 2 (Hive #20): real conflictCopy titles, one minute, one note:
  // the copies are one counted sentence, and what does not fit is left, not dropped.
  const at = Date.UTC(2026, 9, 6, 10, 15, 5);
  const real = (title, n) => [0, 1, 2].slice(0, n).map((i) => {
    const { object } = M.conflictCopy("a", { title, type: "note" }, [`v${i}`, "h", "Laptop", at + i * 10_000], at);
    return { kind: "copy", id: "a", title, device: "Laptop", copy: object.title, copyId: object.id, mine: true };
  });
  const two = real("Shopping list for the weekend", 2);
  assert.equal(two[0].copy, two[1].copy, "same generated title");
  assert.notEqual(two[0].copyId, two[1].copyId);
  const said = M.mergeNotice(two, t);
  assert.equal(said.message, `'Shopping list for the weekend' was changed on Laptop too, so Sync kept your versions as 2 conflict copies, such as '${two[0].copy}'.`);
  assert.deepEqual(said.left, []);
  const three = M.mergeNotice(real("Shopping list for the weekend", 3), t);
  assert.match(three.message, /as 3 conflict copies/);
  assert.deepEqual(three.left, []);
  const longs = real("L".repeat(400), 3);
  const crowded = [...longs, { kind: "moved", id: "a", title: "L".repeat(400), device: "D".repeat(90) },
    { kind: "archived", id: "a", title: "L".repeat(400), device: "D".repeat(90) }, { kind: "restored", id: "a", title: "L".repeat(400), device: "D".repeat(90) }];
  const first = M.mergeNotice(crowded, t);
  assert.ok([...first.message].length <= 300 && /as 3 conflict copies/.test(first.message), first.message);
  assert.ok(first.left.length >= 1 && first.left.every((e) => e.kind !== "copy"), "#20: copies told, the rest left");
  let all = first.message;
  for (let left = first.left, n = 0; left.length; n++) {
    assert.ok(n < 3, "the leftovers drain");
    const next = M.mergeNotice(left, t);
    assert.ok(next.left.length < left.length, "each notice tells at least one");
    all += next.message;
    left = next.left;
  }
  for (const phrase of ["as 3 conflict copies", "was moved", "archived or unarchived", "brought back"]) assert.ok(all.includes(phrase), `#20: told: ${phrase}`);
  // SYNC-NOTICE fix round 3 (Hive #20): Core cuts at 300 UTF-16 units; emoji are two each.
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const cart = "\u{1F6D2}".repeat(30);
  const emo = [...real(cart, 3), { kind: "moved", id: "a", title: cart, device: "Laptop" }];
  let heard = "";
  for (let left = emo, n = 0; left.length; n++) {
    assert.ok(n < 3, "emoji leftovers drain");
    const next = M.mergeNotice(left, t);
    assert.ok(next.message.length <= 300, `#20: ${next.message.length} UTF-16 units`);
    assert.ok(!lone.test(next.message), "#20: no split surrogate pair");
    heard += next.message;
    left = next.left;
  }
  assert.ok(heard.includes("as 3 conflict copies") && heard.includes("was moved"), `#20: emoji: every outcome told: ${heard}`);
  const mixed = "\u00e9\u{1F6D2}a\u{1F600}".repeat(60);
  for (const list of [real(mixed, 3), [{ kind: "moved", id: "a", title: mixed, device: mixed }], ["a", "b", "c", "d"].map((id) => ({ kind: "copy", id, title: mixed, copy: mixed, mine: true }))]) {
    const m = M.mergeNotice(list, t).message;
    assert.ok(m.length <= 300 && !lone.test(m), `#20: mixed Unicode under the cap, whole pairs: ${m.length}`);
  }
  const cap = M.mergeNotice([{ kind: "moved", id: "a", title: "x", device: "y" }], (k, v) => "\u{1F6D2}".repeat(200) + t(k, v)).message;
  assert.ok(cap.length <= 300 && !lone.test(cap), "#20: a long translated first sentence is fitted too");
}
// ---- SYNC-NO-LOSS (Hive #14): Codex review of #10/#12, one case per finding.
{ // F1: Core's store wipe (restore, epoch change) leaves no reseed marker. 37b with
  // a real wipe: the empty-store seed must still never match a seed deep in A's lineage.
  for (const pushFirst of [true, false]) {
    const [A, B] = await world(["A", "B"], [note("n1", ["a1", "a2"])]);
    A.edit("n1", { content: doc(["b1", "a2"]) }, 10);
    await settle([A, B]);
    B.edit("n1", { content: doc(["a1", "a2"]) }, 20);
    B.store = memStore(); // what plugin_store::wipe leaves: nothing, marker included
    B.lin = null;
    B.seen = new Map();
    if (pushFirst) await cycle(B);
    else B.lin = await M.openLineage(B.store, B.exported());
    B.edit("n1", { content: doc(["a1", "c2"]) }, 21);
    await cycle(B);
    await cycle(A);
    await settle([A, B], 4);
    assert.equal(A.body("n1"), B.body("n1"));
    assert.ok([...allTexts([A, B])].some((t) => t.includes("a1")), `F1 pushFirst=${pushFirst}: B's revert a1 survives a real wipe`);
  }
}
{ // F2: the user saves between the export the plan was made from and Core's apply.
  // Same-millisecond race: the typed row's stamp is below the merge's stamp.
  const [A, B] = await world(["A", "B"], [note("n1", ["a", "b"])]);
  A.edit("n1", { content: doc(["A", "b"]) }, 10);
  B.edit("n1", { content: doc(["a", "REMOTE"]) }, 11);
  await cycle(B);
  A.beforeApply = (d) => d.edit("n1", { content: doc(["A", "b", "TYPED"]) }, 11);
  await cycle(A);
  await settle([A, B], 4);
  for (const d of [A, B]) assert.ok(allTexts([d]).has("TYPED"), `F2 ${d.name}: the edit saved mid-cycle survives`);
  assert.equal(A.body("n1"), B.body("n1"));
  // Legacy path too: a stale plan is refused and retried, not applied blind.
  const [C, D] = await world(["C", "D"], [note("n2", ["x"])]);
  C.legacy = D.legacy = true;
  D.edit("n2", { content: doc(["FROM_D"]) }, 20);
  await cycle(D);
  C.beforeApply = (d) => d.edit("n2", { content: doc(["TYPED_C"]) }, 15);
  await cycle(C);
  await settle([C, D], 4);
  for (const d of [C, D]) assert.ok(allTexts([d]).has("TYPED_C") && allTexts([d]).has("FROM_D"), `F2 legacy ${d.name}: both edits survive`);
}
{ // SYNC-NOTICE fix (Hive #16, F3): a conflict copy accepted while the merged row goes to retry is told, once.
  const [A, B] = await world(["A", "B"], [note("n1", ["a"])]);
  A.edit("n1", { title: "Title A" }, 10);
  B.edit("n1", { title: "Title B" }, 11);
  await cycle(B);
  A.beforeApply = (d) => d.edit("n1", { content: doc(["a", "TYPED"]) }, 11);
  await cycle(A);
  const once = A.events.filter((e) => e.kind === "copy");
  assert.equal(once.length, 1, `F3: the copy accepted during the retry cycle is told: ${JSON.stringify(A.events)}`);
  await settle([A, B], 4);
  const copies = A.events.filter((e) => e.kind === "copy");
  // The retry merges what the user typed, so its loser is a second, different copy:
  // each copy is told exactly once, in the cycle Core took it.
  assert.equal(copies.length, A.copies().length, "F3: one notice per copy, never repeated");
  assert.equal(copies[0], once[0]);
}
{ // SYNC-NOTICE fix (Hive #16, F4): the device whose published edit lost is told when it fast-forwards.
  const kinds = (d) => d.events.map((e) => (e.kind === "copy" ? `copy:${e.mine ? "mine" : "theirs"}` : e.kind)).sort();
  for (const bMergesFirst of [false, true]) {
    const [A, B] = await world(["A", "B"], [note("n1", ["a", "b"])]);
    B.edit("n1", { content: doc(["a", "FROM_B"]) }, 10);
    A.edit("n1", { content: doc(["a", "FROM_A"]) }, 20); // newer: A's line wins, B's becomes the copy
    if (bMergesFirst) { await cycle(A); await cycle(B); await cycle(A); } // B merges, A fast-forwards
    else { await cycle(B); await cycle(A); await cycle(B); }             // A merges, B fast-forwards
    await settle([A, B], 4);
    copyCheck([A, B], 1);
    assert.deepEqual(kinds(B), ["copy:mine"], `F4 bMergesFirst=${bMergesFirst}: B is told its version became the copy`);
    assert.deepEqual(kinds(A), ["copy:theirs"], `F4 bMergesFirst=${bMergesFirst}: A is told B's version was kept as a copy`);
    assert.match(B.events[0].copy, /conflict copy/);
  }
  { // A third device that only carried B's head is not told B's edit lost.
    const [A, B, C] = await world(["A", "B", "C"], [note("n1", ["a", "b"])]);
    B.edit("n1", { content: doc(["a", "FROM_B"]) }, 10);
    await cycle(B);
    await cycle(C);
    A.edit("n1", { content: doc(["a", "FROM_A"]) }, 20);
    await cycle(A);
    await settle([A, B, C], 4);
    assert.deepEqual(kinds(B), ["copy:mine"], "F4: B (the author) is told");
    assert.deepEqual(kinds(C), [], "F4: C only relayed B's version: silent");
  }
  // A lost placement or archive stamp, with no copy, reaches the loser too.
  for (const [field, kind] of [["parent_id", "moved"], ["archived_at", "archived"]]) {
    const [A, B] = await world(["A", "B"], [note("n1", ["a"])]);
    B.edit("n1", { [field]: field === "parent_id" ? "pB" : 10 }, 10);
    A.edit("n1", { [field]: field === "parent_id" ? "pA" : 20 }, 20);
    await cycle(B);
    await cycle(A);
    await settle([A, B], 4);
    assert.deepEqual(kinds(A), [], `F4 ${kind}: the winner is not told`);
    assert.deepEqual(kinds(B), [kind], `F4 ${kind}: the loser is told on fast-forward`);
  }
  // Ordinary fast-forwards stay silent, and a receipt is read once.
  const [A, B] = await world(["A", "B"], [note("n1", ["a"])]);
  A.edit("n1", { content: doc(["a", "more"]) }, 10);
  await settle([A, B], 4);
  A.edit("n1", { parent_id: "elsewhere" }, 11);
  await settle([A, B], 4);
  assert.deepEqual([...A.events, ...B.events], [], "F4: no conflict, no notice");
  // A receipt from a hostile or broken peer is dropped, not trusted.
  const bad = M.readLineage({ lineageV: 1, devices: [""], lineage: {}, receipts: { n1: [["v1", ["evil"], "", true], ["v2", [], "", true], ["v3", ["moved"], 7, true]], n2: "x" } });
  assert.equal(bad.receipts.size, 0, "F4: malformed receipts are ignored");
  // SYNC-NOTICE fix round 2 (Hive #16, R2-5): a receipt must name an older version
  // (and a copy source) in that object's own lineage.
  const lin2 = { n1: [["v9", "h9", 0, 2], ["v1", "h1", 0, 1]] };
  const read = (n1) => M.readLineage({ lineageV: 1, devices: [""], lineage: lin2, receipts: { n1, n2: [["v1", ["moved"], "", false]] } }).receipts;
  assert.deepEqual(read([["v1", ["moved"], "", false]]).get("n1"), [["v1", ["moved"], "", false]], "R2-5: a receipt for an older version is kept");
  assert.equal(read([["v1", ["moved"], "", false]]).has("n2"), false, "R2-5: no lineage, no receipt");
  for (const [bad2, why] of [
    [["v9", ["moved"], "", false], "the head itself"],
    [["v7", ["moved"], "", false], "an unknown version"],
    [["v1", [], "v7", false], "a copy from an unknown version"],
    [["v1", [], "v1", false], "a copy of the loser's version not marked mine"],
    [["v1", [], "v9", true], "a copy marked mine from another version"],
  ]) assert.equal(read([bad2]).has("n1"), false, `R2-5: refused, ${why}`);
  // Boundaries: 5000 ids are read, and the push never sends more than that.
  const many = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`m${i}`, [["v1", "h1", 0, 1], ["v0", "h0", 0, 0]]]));
  const manyR = Object.fromEntries(Object.keys(many).map((id) => [id, [["v0", ["moved"], "", false]]]));
  assert.equal(M.readLineage({ lineageV: 1, devices: [""], lineage: many, receipts: manyR }).receipts.size, 5000);
  const lin3 = { store: memStore(), lin: new Map(), off: false, pending: new Set() };
  const objs = Object.keys(many).map((id) => note(id, ["x"]));
  for (const o of objs) {
    const vh = M.objectHash(o);
    lin3.lin.set(o.id, { l: [["v1", vh, "A", 1], ["v0", "h0", "A", 0]], h: new Set(["v1"]), r: [["v0", ["moved"], "", false]] });
  }
  const pushed = await M.pushLineage(lin3, objs, "A");
  assert.equal(Object.keys(pushed.receipts).length, 5000, "R2-5: the push caps receipts where readers cut them");
}
{ // SYNC-NOTICE fix round 2 (Hive #16, R2-1): a relay with the same (blank) name as the loser is not told.
  const kinds = (d) => d.events.map((e) => (e.kind === "copy" ? `copy:${e.mine ? "mine" : "theirs"}` : e.kind)).sort();
  const [A, B, C] = await world(["A", "B", "C"], [note("n1", ["a", "b"])]);
  B.label = C.label = "";
  B.edit("n1", { content: doc(["a", "FROM_B"]) }, 10);
  await cycle(B);
  await cycle(C);
  A.edit("n1", { content: doc(["a", "FROM_A"]) }, 20);
  await cycle(A);
  await settle([A, B, C], 4);
  assert.deepEqual(kinds(B), ["copy:mine"], "R2-1: B (the author) is told");
  assert.deepEqual(kinds(C), [], "R2-1: C shares B's name but only relayed: silent");
}
{ // SYNC-NOTICE fix round 2 (Hive #16, R2-2): the loser pulls a relay of the merge first.
  const kinds = (d) => d.events.map((e) => (e.kind === "copy" ? `copy:${e.mine ? "mine" : "theirs"}` : e.kind)).sort();
  const [A, B, C] = await world(["A", "B", "C"], [note("n1", ["a", "b"])]);
  B.edit("n1", { content: doc(["a", "FROM_B"]) }, 10);
  await cycle(B);
  A.edit("n1", { content: doc(["a", "FROM_A"]) }, 20);
  await cycle(A); // A merges; B's version becomes the copy
  await cycle(C); // C relays the merge head
  await cycle(B, new Map([["C", drive.get("C")]]));
  assert.deepEqual(kinds(B), ["copy:mine"], "R2-2: told from the relay");
  await settle([A, B, C], 4);
  assert.deepEqual(kinds(B), ["copy:mine"], "R2-2: and not again from the original");
}
{ // SYNC-NOTICE fix round 2 (Hive #16, R2-3): Core takes the merge but refuses the copy.
  const kinds = (d) => d.events.map((e) => (e.kind === "copy" ? `copy:${e.mine ? "mine" : "theirs"}` : e.kind)).sort();
  for (const refused of [false, true]) {
    const [A, B] = await world(["A", "B"], [note("n1", ["a", "b"])]);
    B.edit("n1", { content: doc(["a", "FROM_B"]), parent_id: "pB" }, 10);
    await cycle(B);
    A.edit("n1", { content: doc(["a", "FROM_A"]), parent_id: "pA" }, 20);
    if (refused) A.refuse = (o) => o.title.includes("(conflict copy");
    await cycle(A);
    A.refuse = null;
    await cycle(B);
    assert.equal(B.rows.get("n1").parent_id, "pA");
    assert.deepEqual(kinds(B), refused ? ["moved"] : ["copy:mine", "moved"], `R2-3 refused=${refused}: a copy is told only if it exists`);
    assert.deepEqual(kinds(A), refused ? [] : ["copy:theirs"], `R2-3 refused=${refused}: the merging device too`);
  }
}
{ // SYNC-NOTICE fix (Hive #16, F6): an archive-only clash is "archived", never "moved".
  const base = note("n1", ["a"], 1);
  const m = M.mergeObject(base, { ...base, archived_at: 5, updated_at: 5 }, { ...base, archived_at: 9, updated_at: 9 }, false);
  assert.deepEqual(m.events, ["archived"]);
  const both = M.mergeObject(base, { ...base, archived_at: 5, parent_id: "p1", updated_at: 5 }, { ...base, archived_at: 9, parent_id: "p2", updated_at: 9 }, false);
  assert.deepEqual(both.events, ["moved", "archived"]);
}
{ // F3: no base yet (first exchange, lost bases), both rows differ → the older one is kept as a copy
  const plan = M.planConflicts([note("n1", ["FIRST_B"], 11)], new Map([["n1", note("n1", ["FIRST_A"], 10)]]), {}, {}, "B");
  assert.ok(plan.objects.some((o) => o.id !== "n1" && /FIRST_A/.test(o.content)), "F3: local kept as a copy");
  drive.clear();
  const A = new Device("A");
  const B = new Device("B");
  A.put(note("n1", ["FIRST_A"], 10));
  B.put(note("n1", ["FIRST_B"], 11));
  await settle([A, B], 4);
  for (const d of [A, B]) assert.ok(allTexts([d]).has("FIRST_A") && allTexts([d]).has("FIRST_B"), `F3 ${d.name}: both first versions survive`);
}
{ // F4: a trashed local note with its own edit loses to a newer remote edit → copy, still in trash
  const base = note("n1", ["a"], 1);
  const local = { ...note("n1", ["LOCAL_TRASH_EDIT"], 10), trashed_at: 10 };
  const plan = M.planConflicts([note("n1", ["REMOTE"], 11)], new Map([["n1", local]]), { n1: M.objectHash(base) }, {}, "B");
  const copy = plan.objects.find((o) => o.id !== "n1");
  assert.ok(copy && /LOCAL_TRASH_EDIT/.test(copy.content) && copy.trashed_at != null, "F4: the trashed edit is kept as a copy in the trash");
  // Trashed without an edit: nothing to keep, the newer remote edit restores it (unchanged).
  const onlyTrashed = M.planConflicts([note("n1", ["REMOTE"], 11)], new Map([["n1", { ...base, trashed_at: 10, updated_at: 10 }]]), { n1: M.objectHash(base) }, {}, "B");
  assert.equal(onlyTrashed.objects.length, 1, "F4: a trash-only change makes no copy");
}
{ // F5: a column deleted on one side while the other edited a cell under it
  const { parseTable, serializeTable } = await import("../notible-tables/main.js");
  const col = (id) => ({ id, name: id, type: "text" });
  const t = (columns, cells) => JSON.stringify({ columns: columns.map(col), rows: [{ id: "r1", cells }] });
  const base = t(["c1", "c2"], { c1: "base", c2: "x" });
  const deleted = t(["c2"], { c2: "x" });
  const edited = t(["c1", "c2"], { c1: "USER_EDIT", c2: "x" });
  const roundTrip = (props) => JSON.parse(serializeTable(parseTable({ id: "t", title: "T", props })));
  for (const [l, r, localNewer] of [[deleted, edited, false], [edited, deleted, true], [deleted, edited, true], [edited, deleted, false]]) {
    const m = M.mergeTableProps(base, l, r, localNewer);
    assert.equal(roundTrip(m.props).rows[0].cells.c1, "USER_EDIT", `F5 localNewer=${localNewer}: the cell edit survives the Tables parser`);
    assert.equal(m.localLost, false, "F5: keeping the column loses nothing, no copy owed");
  }
  // Untouched column: the deletion still wins.
  const plain = M.mergeTableProps(base, deleted, t(["c1", "c2"], { c1: "base", c2: "y" }), false);
  assert.deepEqual(roundTrip(plain.props).columns.map((c) => c.id), ["c2"], "F5: an unedited column is deleted");
}
{ // F6: an unreadable table structure is a bail (null), never "everything deleted"
  const good = JSON.stringify({ columns: [{ id: "c1", name: "c1", type: "text" }], rows: [{ id: "r1", cells: { c1: "SAVED" } }] });
  const local = JSON.stringify({ ...JSON.parse(good), lockWidths: true });
  for (const bad of [
    { columns: [{ id: "c1" }], rows: "broken" },
    { columns: "broken", rows: [] },
    { columns: [{ id: "c1" }], rows: [{ id: "r1", cells: {} }, { id: "r1", cells: {} }] },
    { columns: [{ id: "c1" }], rows: [{ cells: {} }] },
    { columns: [{ id: "c1" }], rows: [{ id: "r1", cells: "x" }] },
    { columns: [{ id: "c1" }, { id: "c1" }], rows: [] },
    { columns: [null], rows: [] },
  ]) {
    assert.equal(M.mergeTableProps(good, local, JSON.stringify(bad), false), null, `F6: ${JSON.stringify(bad)}`);
    assert.equal(M.mergeTableProps(good, JSON.stringify(bad), local, true), null, `F6 (local side): ${JSON.stringify(bad)}`);
  }
  // Through the legacy plan: the valid local table is kept as a copy.
  const table = (props, at) => ({ ...note("t1", [], at), type: "table", props });
  const plan = M.planConflicts([table(JSON.stringify({ columns: [], rows: "broken" }), 11)], new Map([["t1", table(local, 10)]]),
    { t1: M.objectHash(table(good, 1)) }, { t1: good }, "B");
  assert.ok(plan.objects.some((o) => o.id !== "t1" && o.props === local), "F6: the readable local table survives as a copy");
}
{ // F9: copy titles fit the receiver's UTF-16 cap and never split a surrogate pair
  const { validateSnapshot } = await import("../notible-sync/main.js");
  const title = "😀".repeat(2000); // 4000 UTF-16 units, valid
  const lo = { ...note("n1", ["x"]), title };
  const copies = [
    M.conflictCopy("n1", lo, ["v1", "h", "Laptop", Date.UTC(2026, 9, 3)], 7).object,
    ...M.planConflicts([note("n1", ["y"], 11)], new Map([["n1", { ...lo, updated_at: 10 }]]), { n1: M.objectHash(note("n1", ["z"])) }, {}, "B").objects.filter((o) => o.id !== "n1"),
  ];
  assert.equal(copies.length, 2);
  for (const o of copies) {
    assert.ok(o.title.length <= 4000, `F9: ${o.title.length} units`);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(o.title), "F9: no lone high surrogate");
    const v = validateSnapshot({ v: 1, deviceId: "d", writtenAt: 1, objects: [o], relations: [], tombstones: [], relationTombstones: [] }, new Set(["note"]));
    assert.equal(v.rejected.length, 0, `F9: the receiver accepts the copy (${JSON.stringify(v.rejected)})`);
  }
}
{ // resetLineage empties lin: and v: only
  const s = memStore();
  await s.setMany([["lin:a", "1"], ["v:a:1", "2"], ["other", "3"]]);
  await M.resetLineage(s);
  assert.deepEqual(await s.keys(""), ["other"]);
}

// ---- SYNC-STRUCT (Hive #6): boards merge by item id, not as one value.
{
  const { parseWhiteboard } = await import("../builtin/whiteboard.ts");
  const node = (id, over = {}) => ({ id, kind: "card", x: 0, y: 0, width: 200, height: 120, text: id, ...over });
  const wb = (nodes, edges = [], viewport = { x: 0, y: 0, zoom: 1 }) => JSON.stringify({ version: 1, nodes, edges, viewport });
  const board = (id, content, at) => ({ id, type: "whiteboard", title: "Board", content, props: "{}", parent_id: null, archived_at: null, trashed_at: null, created_at: 1, updated_at: at });
  const ms = (props, at) => ({ id: "ms", type: "note", title: "Manuscript", content: "", props: JSON.stringify(props), parent_id: null, archived_at: null, trashed_at: null, created_at: 1, updated_at: at });
  /** Both devices merge (b, L, R): same bytes from either end; returns the merge seen from L. */
  const both = (b, L, R, localNewer) => {
    const one = M.mergeObject(b, L, R, localNewer);
    const two = M.mergeObject(b, R, L, !localNewer);
    assert.deepEqual(two && { ...two.object, updated_at: 0 }, one && { ...one.object, updated_at: 0 }, "same bytes on both devices");
    return one;
  };
  const nodesOf = (o) => JSON.parse(o.content).nodes;

  // Whiteboard: A drags n1 while B edits n2's text and adds n3; A adds n4.
  const b0 = board("w", wb([node("n1"), node("n2")], [{ id: "e1", from: "n1", to: "n2" }]), 1);
  let m = both(b0,
    board("w", wb([node("n1", { x: 50, y: 60 }), node("n2"), node("n4")], [{ id: "e1", from: "n1", to: "n2" }]), 10),
    board("w", wb([node("n1"), node("n2", { text: "edited" }), node("n3")], [{ id: "e1", from: "n1", to: "n2" }]), 11), false);
  assert.equal(m.loser, null, "different nodes or fields: no copy");
  let ns = nodesOf(m.object);
  // Nobody reordered: the newer side's list, with A's n4 after n2, where A had it.
  assert.deepEqual(ns.map((n) => n.id), ["n1", "n2", "n4", "n3"], "all four nodes");
  assert.deepEqual([ns.find((n) => n.id === "n1").x, ns.find((n) => n.id === "n2").text], [50, "edited"]);
  assert.equal(parseWhiteboard(m.object.content).nodes.length, 4, "the real whiteboard reader takes it");
  assert.equal(parseWhiteboard(m.object.content).edges.length, 1);

  // Move on A + text edit on B of the SAME node: both fields kept.
  m = both(b0, board("w", wb([node("n1", { x: 9 }), node("n2")]), 10), board("w", wb([node("n1", { text: "B" }), node("n2")]), 11), true);
  assert.deepEqual(nodesOf(m.object).find((n) => n.id === "n1"), node("n1", { x: 9, text: "B" }));
  assert.equal(m.loser, null);
  // Both drag the same node: newer position, silently. Both edit its text: newer text + a copy.
  m = both(b0, board("w", wb([node("n1", { x: 1 }), node("n2")], [{ id: "e1", from: "n1", to: "n2" }]), 10), board("w", wb([node("n1", { x: 2 }), node("n2")], [{ id: "e1", from: "n1", to: "n2" }]), 11), false);
  assert.equal(nodesOf(m.object)[0].x, 2);
  assert.equal(m.loser, null, "a layout clash is silent");
  m = both(b0, board("w", wb([node("n1", { text: "mine" }), node("n2")]), 10), board("w", wb([node("n1", { text: "theirs" }), node("n2")]), 11), false);
  assert.equal(nodesOf(m.object)[0].text, "theirs");
  assert.equal(m.loser, "L", "a text clash keeps the older text in a conflict copy");
  // A canvas table node clashing in its rows is one value: newer + a copy (decision 2).
  const tb = board("w", wb([node("t", { kind: "table", rows: [["a", "b"]] })]), 1);
  m = both(tb, board("w", wb([node("t", { kind: "table", rows: [["A", "b"]] })]), 10), board("w", wb([node("t", { kind: "table", rows: [["a", "B"]] })]), 11), false);
  assert.deepEqual(nodesOf(m.object)[0].rows, [["a", "B"]]);
  assert.equal(m.loser, "L");
  // Delete vs edit: the edited node stays; delete vs untouched: gone, and its edge with it.
  m = both(b0, board("w", wb([node("n2")])), board("w", wb([node("n1", { text: "kept" }), node("n2")], [{ id: "e1", from: "n1", to: "n2" }]), 11), false);
  assert.deepEqual(nodesOf(m.object).map((n) => n.id), ["n1", "n2"]);
  m = both(b0, board("w", wb([node("n2")]), 10), board("w", wb([node("n1"), node("n2", { x: 5 })], [{ id: "e1", from: "n1", to: "n2" }]), 11), false);
  assert.deepEqual(nodesOf(m.object).map((n) => n.id), ["n2"]);
  assert.deepEqual(JSON.parse(m.object.content).edges, [], "an edge to a deleted node goes too");
  // Z-order: one side reorders, the other adds: the reorder stands, the add goes after its neighbour.
  const z0 = board("w", wb([node("a"), node("b"), node("c")]), 1);
  m = both(z0, board("w", wb([node("c"), node("a"), node("b")]), 10), board("w", wb([node("a"), node("x"), node("b"), node("c")]), 11), false);
  assert.deepEqual(nodesOf(m.object).map((n) => n.id), ["c", "a", "x", "b"]);
  // Both reorder: the newer order.
  m = both(z0, board("w", wb([node("c"), node("a"), node("b")]), 10), board("w", wb([node("b"), node("c"), node("a")]), 11), false);
  assert.deepEqual(nodesOf(m.object).map((n) => n.id), ["b", "c", "a"]);
  // Viewport clash is silent; a malformed side is a bail (conflict copy path), never a loss.
  m = both(b0, board("w", wb([node("n1"), node("n2")], [], { x: 1, y: 1, zoom: 2 }), 10), board("w", wb([node("n1"), node("n2")], [], { x: 3, y: 3, zoom: 1 }), 11), false);
  assert.equal(m.loser, null);
  for (const bad of ["not json", JSON.stringify({ version: 2, nodes: [], edges: [] }), wb([node("d"), node("d")]), wb([{ kind: "card" }]), JSON.stringify({ version: 1, nodes: {}, edges: [] })]) {
    assert.equal(M.mergeObject(b0, board("w", bad, 10), board("w", wb([node("n9")]), 11), false), null, bad);
  }

  // tw.board positions: different cards both kept; same card: newer, silently.
  const p0 = { "tw.board": { c1: { x: 0, y: 0 }, c2: { x: 0, y: 0 } } };
  m = both(ms(p0, 1), ms({ "tw.board": { c1: { x: 20, y: 0 }, c2: { x: 0, y: 0 } } }, 10), ms({ "tw.board": { c1: { x: 0, y: 0 }, c2: { x: 0, y: 40 }, c3: { x: 1, y: 1 } } }, 11), false);
  assert.deepEqual(JSON.parse(m.object.props)["tw.board"], { c1: { x: 20, y: 0 }, c2: { x: 0, y: 40 }, c3: { x: 1, y: 1 } });
  m = both(ms(p0, 1), ms({ "tw.board": { c1: { x: 1, y: 0 }, c2: { x: 0, y: 0 } } }, 10), ms({ "tw.board": { c1: { x: 2, y: 0 }, c2: { x: 0, y: 0 } } }, 11), false);
  assert.deepEqual(JSON.parse(m.object.props)["tw.board"].c1, { x: 2, y: 0 });
  assert.equal(m.loser, null);
  assert.equal(M.mergeObject(ms(p0, 1), ms({ "tw.board": { c1: { x: "far" } } }, 10), ms({ "tw.board": {} }, 11), false), null, "unreadable positions bail");

  // tw.frames: both put card k in different frames -> only the newer side's frame has it.
  const f0 = { "tw.frames": [{ id: "f1", title: "One", members: ["a", "k"] }, { id: "f2", title: "Two", members: ["b"] }, { id: "f3", title: "Three", members: ["c"] }] };
  const framesOf = (o) => JSON.parse(o.props)["tw.frames"];
  m = both(ms(f0, 1),
    ms({ "tw.frames": [{ id: "f1", title: "One", members: ["a"] }, { id: "f2", title: "Two", members: ["b", "k"] }, { id: "f3", title: "Three", members: ["c"] }] }, 10),
    ms({ "tw.frames": [{ id: "f1", title: "One", members: ["a"] }, { id: "f2", title: "Two", members: ["b"] }, { id: "f3", title: "Three", members: ["c", "k"] }] }, 11), false);
  const holders = framesOf(m.object).filter((f) => f.members.includes("k")).map((f) => f.id);
  assert.deepEqual(holders, ["f3"], "a card sits in one frame: the newer side's");
  // One side renames a frame while the other moves its cards out (and adds one to another frame).
  m = both(ms(f0, 1),
    ms({ "tw.frames": [{ id: "f1", title: "Renamed", members: ["a", "k"] }, ...f0["tw.frames"].slice(1)] }, 10),
    ms({ "tw.frames": [{ id: "f1", title: "One", members: ["a"] }, { id: "f2", title: "Two", members: ["b", "k"] }, f0["tw.frames"][2]] }, 11), true);
  assert.deepEqual(framesOf(m.object).map((f) => [f.id, f.title, f.members]), [["f1", "Renamed", ["a"]], ["f2", "Two", ["b", "k"]], ["f3", "Three", ["c"]]]);
  assert.equal(m.loser, null);
  for (const f of framesOf(m.object)) assert.ok(typeof f.id === "string" && Array.isArray(f.members) && f.members.every((x) => typeof x === "string"), "the board's readFrames keeps every frame");
  // A frame emptied by the merge is dropped, as the board does.
  m = both(ms(f0, 1),
    ms({ "tw.frames": [{ id: "f1", title: "One", members: ["k"] }, ...f0["tw.frames"].slice(1)] }, 10),
    ms({ "tw.frames": [{ id: "f1", title: "One", members: ["a"] }, ...f0["tw.frames"].slice(1).map((f) => (f.id === "f2" ? { ...f, members: ["b", "k"] } : f))] }, 11), false);
  assert.ok(!framesOf(m.object).some((f) => f.id === "f1"), "f1 lost both members, so it is gone");
  // Nesting cycle (A puts f2 in f3, B puts f3 in f2) is a bail.
  const nest = (f2, f3) => ms({ "tw.frames": [{ id: "f2", title: "Two", members: f2 }, { id: "f3", title: "Three", members: f3 }] }, 0);
  const n0 = nest(["b"], ["c"]);
  assert.equal(M.mergeObject({ ...n0, updated_at: 1 }, { ...nest(["b"], ["c", "f2"]), updated_at: 10 }, { ...nest(["b", "f3"], ["c"]), updated_at: 11 }, false), null);
  // Frame title clash: newer + a copy.
  m = both(ms(f0, 1), ms({ "tw.frames": [{ ...f0["tw.frames"][0], title: "Mine" }, ...f0["tw.frames"].slice(1)] }, 10), ms({ "tw.frames": [{ ...f0["tw.frames"][0], title: "Theirs" }, ...f0["tw.frames"].slice(1)] }, 11), false);
  assert.equal(framesOf(m.object)[0].title, "Theirs");
  assert.equal(m.loser, "L");

  // tw.timeline: a label edit plus a drag of the same marker, both kept; added markers both kept.
  const t0 = { "tw.timeline": [{ id: "m1", label: "Day 1", x: 0 }] };
  m = both(ms(t0, 1), ms({ "tw.timeline": [{ id: "m1", label: "Morning", x: 0 }, { id: "m2", label: "Day 2", x: 300 }] }, 10), ms({ "tw.timeline": [{ id: "m1", label: "Day 1", x: 80, jump: true }] }, 11), false);
  assert.deepEqual(JSON.parse(m.object.props)["tw.timeline"], [{ id: "m1", jump: true, label: "Morning", x: 80 }, { id: "m2", label: "Day 2", x: 300 }]);
  assert.equal(m.loser, null);

  // _views: both add a tab; a rename on one side plus a reorder on the other; a clash is silent (decision 1).
  const container = (views, at) => ({ id: "p", type: "project", title: "P", content: "", props: JSON.stringify({ _views: views }), parent_id: null, archived_at: null, trashed_at: null, created_at: 1, updated_at: at });
  const v = (id, over = {}) => ({ id, name: id, layout: "kanban", ...over });
  const viewsOf = (o) => JSON.parse(o.props)._views;
  const c0 = container([v("tasks"), v("list", { layout: "list" })], 1);
  m = both(c0, container([v("list", { layout: "list" }), v("tasks"), v("cal", { layout: "calendar" })], 10), container([v("tasks", { name: "Board" }), v("list", { layout: "list" }), v("due", { layout: "table" })], 11), false);
  // A's order (it reordered), with B's new "due" after "list", where B had it.
  assert.deepEqual(viewsOf(m.object).map((x) => x.id), ["list", "due", "tasks", "cal"], "the reorder stands");
  assert.equal(viewsOf(m.object).find((x) => x.id === "tasks").name, "Board", "and so does the rename");
  m = both(c0, container([v("tasks", { name: "Mine" }), v("list", { layout: "list" })], 10), container([v("tasks", { name: "Theirs" }), v("list", { layout: "list" })], 11), false);
  assert.equal(viewsOf(m.object)[0].name, "Theirs");
  assert.equal(m.loser, null, "a view clash never copies the project");

  // Two-device simulations, end to end through pullPeer: every shape converges with no copy.
  const [A, B] = await world(["A", "B"], [b0, ms({ ...p0, ...f0, ...t0 }, 1), c0]);
  A.edit("w", { content: wb([node("n1", { x: 50 }), node("n2"), node("n4")], [{ id: "e1", from: "n1", to: "n2" }]) }, 10);
  B.edit("w", { content: wb([node("n1"), node("n2", { text: "edited" }), node("n3")], [{ id: "e1", from: "n1", to: "n2" }]) }, 11);
  A.edit("ms", { props: JSON.stringify({ ...f0, ...t0, "tw.board": { c1: { x: 20, y: 0 }, c2: { x: 0, y: 0 } } }) }, 10);
  B.edit("ms", { props: JSON.stringify({ ...p0, ...t0, "tw.frames": [{ id: "f1", title: "Renamed", members: ["a", "k"] }, ...f0["tw.frames"].slice(1)] }) }, 11);
  A.edit("p", { props: JSON.stringify({ _views: [v("tasks"), v("list", { layout: "list" }), v("cal", { layout: "calendar" })] }) }, 10);
  B.edit("p", { props: JSON.stringify({ _views: [v("tasks", { name: "Board" }), v("list", { layout: "list" })] }) }, 11);
  await settle([A, B], 3);
  for (const id of ["w", "ms", "p"]) assert.equal(JSON.stringify(A.rows.get(id)), JSON.stringify(B.rows.get(id)), `${id} is identical on both devices`);
  copyCheck([A, B], 0);
  assert.equal(nodesOf(A.rows.get("w")).length, 4);
  assert.equal(nodesOf(A.rows.get("w")).find((n) => n.id === "n2").text, "edited");
  assert.equal(JSON.parse(A.rows.get("ms").props)["tw.board"].c1.x, 20);
  assert.equal(JSON.parse(A.rows.get("ms").props)["tw.frames"][0].title, "Renamed");
  assert.deepEqual(viewsOf(A.rows.get("p")).map((x) => [x.id, x.name]), [["tasks", "Board"], ["list", "list"], ["cal", "cal"]]);
}
// ---- Codex on #6: prototype-named fields, and items their reader would drop.
{
  const { viewsFromObject } = await import("../builtin/views.ts");
  const boardOf = (content, at) => ({ id: "w", type: "whiteboard", title: "Board", content, props: "{}", parent_id: null, archived_at: null, trashed_at: null, created_at: 1, updated_at: at });
  // JSON text, so "__proto__" is an own field, as a peer's snapshot would carry it.
  const wbText = (nodeJson, top = "") => `{"version":1,${top}"nodes":[${nodeJson}],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}`;
  const n = (extra) => `{"id":"n1","kind":"card","x":0,"y":0,"width":1,"height":1,"text":"t"${extra}}`;
  const orders = (b, L, R, localNewer) => [M.mergeObject(b, L, R, localNewer), M.mergeObject(b, R, L, !localNewer)];
  const node1 = (m) => JSON.parse(m.object.content).nodes[0];

  // An unknown "constructor" field changed on both sides: newer + a copy, from either device.
  const [c1, c2] = orders(boardOf(wbText(n(',"constructor":"base"')), 1), boardOf(wbText(n(',"constructor":"mine"')), 10), boardOf(wbText(n(',"constructor":"theirs"')), 11), false);
  for (const m of [c1, c2]) assert.equal(node1(m).constructor, "theirs");
  assert.equal(c1.loser, "L");
  assert.equal(c2.loser, "R", "the same older version loses from the other end");
  // A one-sided edit to an own "__proto__" field survives, in an item and at the top level.
  const [p1, p2] = orders(boardOf(wbText(n(',"__proto__":{"a":1}'), '"__proto__":1,'), 1),
    boardOf(wbText(n(',"__proto__":{"a":2}'), '"__proto__":2,'), 10), boardOf(wbText(n(',"__proto__":{"a":1},"x":5').replace('"x":0,', ''), '"__proto__":1,'), 11), false);
  for (const m of [p1, p2]) {
    const item = node1(m);
    assert.ok(Object.hasOwn(item, "__proto__") && item["__proto__"].a === 2, "own __proto__ field kept with A's edit");
    assert.equal(item.x, 5, "and B's drag");
    const top = JSON.parse(m.object.content);
    assert.ok(Object.hasOwn(top, "__proto__") && top["__proto__"] === 2);
    assert.equal(m.object.content, p1.object.content, "same bytes from both ends");
  }

  // A marker without x, or a view without layout, on ANY side: a copy, never a silent drop.
  const ms = (props, at) => ({ id: "ms", type: "note", title: "M", content: "", props: JSON.stringify(props), parent_id: null, archived_at: null, trashed_at: null, created_at: 1, updated_at: at });
  const ok = { "tw.timeline": [{ id: "m1", label: "Day 1", x: 0 }] };
  const noX = { "tw.timeline": [{ id: "m1", label: "Edited" }] };
  const other = { "tw.timeline": [{ id: "m1", label: "Day 1", x: 0 }, { id: "m2", label: "Day 2", x: 9 }] };
  for (const [b, l, r] of [[ok, noX, other], [ok, other, noX], [noX, ok, other]]) {
    assert.deepEqual(orders(ms(b, 1), ms(l, 10), ms(r, 11), false), [null, null]);
  }
  const project = (views, at) => ({ id: "p", type: "project", title: "P", content: "", props: JSON.stringify({ _views: views }), parent_id: null, archived_at: null, trashed_at: null, created_at: 1, updated_at: at });
  const tasks = { id: "tasks", name: "Tasks", layout: "kanban" };
  for (const [b, l, r] of [[[tasks], [{ id: "tasks", name: "Renamed" }], [tasks, { id: "x", name: "X", layout: "list" }]], [[{ id: "tasks", name: "T" }], [tasks], [tasks, { id: "y", layout: "table" }]]]) {
    assert.deepEqual(orders(project(b, 1), project(l, 10), project(r, 11), false), [null, null]);
  }
  // Round trip through the readers: what a good merge keeps, the readers keep.
  const [v1, v2] = orders(project([tasks], 1), project([{ ...tasks, name: "Board" }], 10), project([tasks, { id: "x", name: "X", layout: "list" }], 11), false);
  for (const m of [v1, v2]) assert.deepEqual(viewsFromObject(m.object).map((v) => [v.id, v.name]), [["tasks", "Board"], ["x", "X"]]);
  // readMarkers (typewriter-board.tsx, not exported) keeps an item with a string id and a finite x.
  const readMarkersKeeps = (value) => value.filter((mk) => Boolean(mk) && typeof mk.id === "string" && Number.isFinite(mk.x)).length;
  const [t1, t2] = orders(ms(ok, 1), ms({ "tw.timeline": [{ id: "m1", label: "Edited", x: 0 }] }, 10), ms(other, 11), false);
  for (const m of [t1, t2]) {
    const markers = JSON.parse(m.object.props)["tw.timeline"];
    assert.equal(readMarkersKeeps(markers), markers.length);
    assert.deepEqual(markers.map((mk) => [mk.id, mk.label]), [["m1", "Edited"], ["m2", "Day 2"]]);
  }
}

// ---- Hive #24: tags and deps merge as sets.
{
  const task = (props, at) => ({ id: "t", type: "task", title: "T", content: "", props: JSON.stringify(props), parent_id: null, archived_at: null, trashed_at: null, created_at: 1, updated_at: at });
  const both = (b, L, R, localNewer) => {
    const one = M.mergeObject(b, L, R, localNewer);
    const two = M.mergeObject(b, R, L, !localNewer);
    assert.deepEqual(two && { ...two.object, updated_at: 0 }, one && { ...one.object, updated_at: 0 }, "same bytes on both devices");
    return one;
  };
  const props = (m) => JSON.parse(m.object.props);
  const t0 = task({ tags: ["a", "b"], deps: [{ on: "p1", kind: "finish-start" }, { on: "p2", kind: "finish-start" }] }, 1);
  // add / add: both kept, no copy.
  let m = both(t0, task({ tags: ["a", "b", "x"], deps: [{ on: "p1", kind: "finish-start" }, { on: "p2", kind: "finish-start" }, { on: "p3", kind: "start-start" }] }, 10),
    task({ tags: ["a", "b", "y"], deps: [{ on: "p1", kind: "finish-start" }, { on: "p2", kind: "finish-start" }, { on: "p4", kind: "finish-start" }] }, 11), false);
  assert.deepEqual(props(m).tags, ["a", "b", "x", "y"]);
  assert.deepEqual(props(m).deps.map((d) => d.on), ["p1", "p2", "p3", "p4"]);
  assert.equal(props(m).deps.find((d) => d.on === "p3").kind, "start-start");
  assert.equal(m.loser, null);
  // add / remove: A adds x, B removes b -> [a, x].
  m = both(t0, task({ tags: ["a", "b", "x"], deps: [{ on: "p1", kind: "finish-start" }, { on: "p2", kind: "finish-start" }, { on: "p3", kind: "finish-start" }] }, 10),
    task({ tags: ["a"], deps: [{ on: "p2", kind: "finish-start" }] }, 11), true);
  assert.deepEqual(props(m).tags, ["a", "x"]);
  assert.deepEqual(props(m).deps.map((d) => d.on), ["p2", "p3"]);
  // remove / remove: different entries both go; the same entry goes once.
  m = both(t0, task({ tags: ["b"], deps: [{ on: "p2", kind: "finish-start" }] }, 10), task({ tags: ["a"], deps: [{ on: "p2", kind: "finish-start" }] }, 11), false);
  assert.deepEqual(props(m).tags, []);
  assert.deepEqual(props(m).deps.map((d) => d.on), ["p2"]);
  // A dependency removed on one side but its kind changed on the other stays (an edit beats a delete).
  m = both(t0, task({ tags: ["a", "c"], deps: [{ on: "p2", kind: "finish-start" }] }, 10), task({ tags: ["a", "b", "d"], deps: [{ on: "p1", kind: "finish-finish" }, { on: "p2", kind: "finish-start" }] }, 11), false);
  assert.deepEqual(props(m).deps, [{ on: "p1", kind: "finish-finish" }, { on: "p2", kind: "finish-start" }]);
  assert.deepEqual(props(m).tags, ["a", "c", "d"]);
  // Both change one dependency's kind: newer, no copy.
  m = both(t0, task({ tags: ["a", "b", "x"], deps: [{ on: "p1", kind: "start-start" }, { on: "p2", kind: "finish-start" }] }, 10), task({ tags: ["a", "b", "y"], deps: [{ on: "p1", kind: "finish-finish" }, { on: "p2", kind: "finish-start" }] }, 11), false);
  assert.equal(props(m).deps[0].kind, "finish-finish");
  assert.equal(m.loser, null);
  // Malformed on any side -> a conflict copy (null), never a silent loss.
  for (const bad of [{ tags: "a,b" }, { tags: ["a", "a"] }, { tags: ["a", 3] }, { tags: ["a", ""] }, { deps: { on: "p1" } }, { deps: [{ kind: "finish-start" }] }, { deps: [{ on: "p1" }, { on: "p1" }] }, { deps: [{ on: "p1", id: "x" }] }]) {
    const key = Object.keys(bad)[0];
    const other = key === "tags" ? { tags: ["a", "b", "z"] } : { deps: [{ on: "p9", kind: "finish-start" }] };
    assert.equal(M.mergeObject(t0, task({ ...JSON.parse(t0.props), ...bad }, 10), task({ ...JSON.parse(t0.props), ...other }, 11), false), null, JSON.stringify(bad));
  }
  // Codex on #24: only a `kind` clash is silent; kinds are validated; depsOf reads back what was merged.
  const { depsOf } = await import("../builtin/ganttCascade.ts");
  const orders = (b, L, R, x) => [M.mergeObject(b, L, R, x), M.mergeObject(b, R, L, !x)];
  const dep = (over) => ({ on: "p1", kind: "finish-start", ...over });
  for (const field of ["note", "constructor"]) {
    const [o1, o2] = orders(task({ deps: [dep({ [field]: "base" })] }, 1), task({ deps: [dep({ [field]: "mine" })] }, 10), task({ deps: [dep({ [field]: "theirs" })] }, 11), false);
    for (const m of [o1, o2]) assert.equal(props(m).deps[0][field], "theirs");
    assert.deepEqual([o1.loser, o2.loser], ["L", "R"], `a ${field} clash keeps the older edit in a conflict copy`);
  }
  for (const bad of [{ bad: true }, "later", null, 3]) {
    for (const [b, l, r] of [[[dep()], [dep({ kind: bad })], [dep(), dep({ on: "p2" })]], [[dep({ kind: bad })], [dep({ kind: "start-start" })], [dep(), dep({ on: "p2" })]]]) {
      assert.deepEqual(orders(task({ deps: b }, 1), task({ deps: l }, 10), task({ deps: r }, 11), false), [null, null], `kind ${JSON.stringify(bad)}`);
    }
  }
  // A legacy dep without a kind reads as finish-start on every side: A's re-kind and B's add both survive.
  const [k1, k2] = orders(task({ deps: [{ on: "p1" }] }, 1), task({ deps: [dep({ kind: "start-start" })] }, 10), task({ deps: [{ on: "p1" }, { on: "p2" }] }, 11), false);
  for (const m of [k1, k2]) {
    assert.equal(m.loser, null);
    assert.deepEqual(depsOf(m.object), [{ on: "p1", kind: "start-start" }, { on: "p2", kind: "finish-start" }], "the real reader sees exactly the merge");
    assert.deepEqual(depsOf(m.object), props(m).deps.map(({ on, kind }) => ({ on, kind })));
  }

  // Two devices, end to end: both add tags and deps between syncs; both kept everywhere, no copy.
  const [A, B] = await world(["A", "B"], [t0]);
  A.edit("t", { props: JSON.stringify({ tags: ["a", "b", "x"], deps: [{ on: "p1", kind: "finish-start" }, { on: "p2", kind: "finish-start" }, { on: "p3", kind: "finish-start" }] }) }, 10);
  B.edit("t", { props: JSON.stringify({ tags: ["a", "y"], deps: [{ on: "p1", kind: "finish-start" }] }) }, 11);
  await settle([A, B], 3);
  assert.equal(JSON.stringify(A.rows.get("t")), JSON.stringify(B.rows.get("t")));
  copyCheck([A, B], 0);
  assert.deepEqual(JSON.parse(A.rows.get("t").props).tags, ["a", "x", "y"]);
  assert.deepEqual(JSON.parse(A.rows.get("t").props).deps.map((d) => d.on), ["p1", "p3"]);
}
console.log("sync-merge checks passed");

// Hive #7: exercise registration/transport on the actual two-device merge,
// then a relay. IDs, not equal titles or source-device labels, pair each copy.
{
  const id="20000000-0000-4000-8000-000000000001";
  const [A,B]=await world(["A","B"],[note(id,["base"])]);
  A.edit(id,{content:doc(["A version"])},10);B.edit(id,{content:doc(["B version"])},11);
  await settle([A,B],4);
  for(const d of [A,B]) {assert.equal(d.descriptors.size,1);for(const r of d.descriptors.values()){assert.equal(r.originalId,id);assert.deepEqual(r.fields,["content"]);assert.ok(d.rows.has(r.copyId));}}
  const C=new Device("relay");await settle([A,B,C],4);assert.deepEqual([...C.descriptors.values()],[...A.descriptors.values()]);
  A.edit(id,{title:"renamed A",content:doc(["A second"])},30);B.edit(id,{title:"renamed B",content:doc(["B second"])},31);
  await settle([A,B,C],4);
  assert.ok([...A.descriptors.values()].some(d=>d.fields.includes("title")),"mixed fields prevent copy disposal");
}
{
  const id="20000000-0000-4000-8000-000000000002";
  const [A,B]=await world(["legacy A","legacy B"],[note(id,["base"])]);A.legacy=B.legacy=true;
  A.edit(id,{content:doc(["legacy local"])},20);B.edit(id,{content:doc(["legacy remote"])},21);
  await settle([A,B],4);assert.equal(A.descriptors.size,1);assert.equal(B.descriptors.size,1);
  assert.deepEqual([...A.descriptors.values()],[...B.descriptors.values()]);
}
console.log("Hive #7 descriptor transport checks passed (three-way, relay, legacy, mixed fields)");
