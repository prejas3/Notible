// SYNC-NOTICE (Hive #11): merge notices in a Sync plugin, run by both self-checks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export async function checkNotices(Sync, pluginId, dir) {
  const shown = [];
  const store = new Map();
  const context = {
    storage: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
    i18n: { t: (key, v = {}) => key.split(/\{(\w+)\}/).map((x, i) => (i % 2 ? String(v[x]) : x)).join("") },
    ui: {
      notice: (message, options) => shown.push({ message, options }),
      openObject: (id) => shown.push({ opened: id }),
      openPluginSettings: (id) => shown.push({ settings: id }),
    },
  };
  const notify = (events) => Sync.prototype.notifyMerges.call({ context }, events);
  const events = [
    { kind: "kept-edit", id: "n1", title: "Shopping list", device: "Laptop" },
    // SYNC-NOTICE fix (Hive #16, F5): production order, the placement before the copy.
    { kind: "moved", id: "n2", title: "Plan", device: "Laptop" },
    { kind: "copy", id: "n2", title: "Plan", copy: "Plan (conflict copy — Laptop)", mine: true, device: "Laptop" },
  ];
  notify(events); // default: on
  assert.equal(shown.length, 1, "one notice for the whole cycle");
  assert.equal(shown[0].message, "Sync merged conflicting changes in 2 notes: 'Shopping list', 'Plan'. Conflict copies kept: 'Plan (conflict copy — Laptop)'.");
  shown[0].options.action.onSelect();
  assert.deepEqual(shown[1], { settings: pluginId }, "a grouped notice opens the Sync settings");
  shown.length = 0;
  notify(events.slice(0, 1));
  assert.equal(shown[0].message, "Sync kept your edit to 'Shopping list': it had been deleted on Laptop.");
  shown[0].options.action.onSelect();
  assert.deepEqual(shown[1], { opened: "n1" }, "a single notice opens the note");
  shown.length = 0;
  notify([]);
  assert.equal(shown.length, 0, "nothing merged, no notice");
  store.set("mergeNotices", false);
  notify(events);
  assert.equal(shown.length, 0, "setting off: no notice");

  // SYNC-NOTICE fix (Hive #16, F5 + F6): one note, the copy is never swallowed; an archive is not a move.
  store.delete("mergeNotices");
  shown.length = 0;
  notify(events.slice(1));
  assert.equal(shown[0].message, "'Plan' was changed on Laptop too, so Sync kept your version as 'Plan (conflict copy — Laptop)'. 'Plan' was moved on Laptop too; that placement was kept.");
  const pl = JSON.parse(readFileSync(new URL("locales/pl.json", dir), "utf8")).strings;
  const polish = (key, v = {}) => context.i18n.t(pl[key] ?? key, v);
  const archive = [{ kind: "archived", id: "n3", title: "Notes", device: "Laptop" }];
  shown.length = 0;
  notify(archive);
  assert.equal(shown[0].message, "'Notes' was archived or unarchived on Laptop too; that change was kept.");
  Sync.prototype.notifyMerges.call({ context: { ...context, i18n: { t: polish } } }, archive);
  assert.equal(shown[1].message, "„Notes” zarchiwizowano lub przywrócono z archiwum też na urządzeniu Laptop; została tamta zmiana.");
  assert.ok(!/przeniesiono/.test(shown[1].message) && !/moved/.test(shown[0].message));
  store.set("mergeNotices", false);

  const src = readFileSync(new URL("main.js", dir), "utf8");
  const run = src.slice(src.indexOf("  async run() {"), src.indexOf("\n  }\n", src.indexOf("  async run() {")));
  assert.equal(run.split("events.push(...result.events);").length, 2, "run() collects every peer's events");
  assert.equal(run.split("this.notifyMerges(events);").length, 2, "run() shows one notice per cycle");
  assert.match(src, /id: "nsync-notices-toggle", type: "checkbox", checked: sync\.context\.storage\.get\("mergeNotices"\) \?\? true/);
  assert.match(src, /switchFor\(notices\)/, "the setting is the app's switch, not an OS checkbox");
  const manifest = JSON.parse(readFileSync(new URL("plugin.json", dir), "utf8"));
  assert.equal(manifest.locales?.pl, "locales/pl.json");
  const block = src.slice(src.indexOf("const NOTICE = {"), src.indexOf("// </sync-merge>"));
  // Hive #28: the sentences are marked tr("…") and the action labels are t("…") calls.
  const keys = [...block.matchAll(/\btr\("([^"]+)"\)/g), ...block.matchAll(/\bt\("([^"]+)"/g), ...src.matchAll(/t\("(Resolve conflict|Review conflicts)"\)/g)].map((m) => m[1]);
  assert.ok(keys.length >= 11, `found ${keys.length} notice strings`);
  for (const key of keys) assert.ok(pl[key], `Polish for: ${key}`);
  // SYNC-NOTICE fix (Hive #16, F7): the setting itself goes through i18n, in Polish too.
  const setting = ["Merge notices", "Show sync merge notices", "A short notice after a sync that kept another device's version over yours, brought back a note you deleted, or saved a conflict copy.", "On", "Off"];
  const panel = src.slice(src.indexOf("const notices = element(") - 400, src.indexOf("nsync-notices-toggle\", textContent") + 2000);
  for (const key of setting) {
    assert.ok(pl[key], `Polish for the setting: ${key}`);
    assert.ok(!panel.includes(`textContent: "${key}"`), `untranslated in the panel: ${key}`);
  }
  assert.ok(src.includes('tr("Show sync merge notices")'), "the switch label is translated");
  assert.ok(src.includes('i18n.t("Merge notices")') || src.includes('tr("Merge notices")'), "the heading is translated");
  // SYNC-NOTICE fix round 2 (Hive #16, R2-4): two copies of one note from one peer
  // both survive the pending batch, including across a notice that failed to show.
  store.delete("mergeNotices");
  shown.length = 0;
  let broken = true;
  const self = { context: { ...context, ui: { ...context.ui, notice: (m) => { if (broken) throw new Error("no window"); shown.push(m); } } } };
  const copyOf = (copy) => ({ kind: "copy", id: "n4", title: "Plan", copy, mine: true, device: "Laptop" });
  assert.throws(() => Sync.prototype.notifyMerges.call(self, [copyOf("Plan (copy 1)")]), /no window/);
  broken = false;
  Sync.prototype.notifyMerges.call(self, [copyOf("Plan (copy 2)")]);
  assert.equal(shown.length, 1);
  assert.ok(shown[0].includes("Plan (copy 1)") && shown[0].includes("Plan (copy 2)"), `R2-4: both copies are named: ${shown[0]}`);
  // SYNC-NOTICE fix (Hive #20): two copies made within one minute share a title
  // but not an id; both are kept, across a failed notice and within one cycle.
  const twin = "Plan (conflict copy — Laptop 2026-10-06 10:15)";
  const same = (copyId) => ({ ...copyOf(twin), copyId });
  const count = (m) => m.split(twin).length - 1;
  shown.length = 0;
  broken = true;
  assert.throws(() => Sync.prototype.notifyMerges.call(self, [same("c1")]), /no window/);
  broken = false;
  Sync.prototype.notifyMerges.call(self, [same("c2")]);
  assert.ok(count(shown[0]) === 1 && shown[0].includes("as 2 conflict copies"), `#20: both same-named copies after a failed notice: ${shown[0]}`);
  shown.length = 0;
  Sync.prototype.notifyMerges.call(self, [same("c1"), same("c2"), { ...same("c3"), id: "n5" }]);
  assert.ok(shown[0].includes(`Conflict copies kept: '${twin.slice(0, 30)}…', '${twin.slice(0, 30)}…' and 1 more.`), `#20: three copies counted in one cycle: ${shown[0]}`);
  shown.length = 0;
  Sync.prototype.notifyMerges.call(self, [same("c1"), same("c1")]);
  assert.equal(count(shown[0]), 1, "#20: one copy reported twice is still one");
  // Round 2 (Hive #20): three copies of one note survive a failed delivery and
  // are told as one counted sentence; what does not fit waits for the next notice.
  shown.length = 0;
  broken = true;
  const big = (copyId) => ({ ...copyOf(`${"L".repeat(300)} (conflict copy — Laptop, 2026-10-06 10:15 UTC)`), title: "L".repeat(300), copyId });
  const extra = [{ kind: "moved", id: "n4", title: "L".repeat(300), device: "D".repeat(90) }, { kind: "archived", id: "n4", title: "L".repeat(300), device: "D".repeat(90) }];
  assert.throws(() => Sync.prototype.notifyMerges.call(self, [big("k1"), big("k2"), ...extra]), /no window/);
  broken = false;
  Sync.prototype.notifyMerges.call(self, [big("k3")]);
  assert.match(shown[0], /kept your versions as 3 conflict copies/, `#20: retry tells all three: ${shown[0]}`);
  const toldMoved = shown[0].includes("was moved"), toldArchived = shown[0].includes("archived or unarchived");
  assert.ok(!(toldMoved && toldArchived), "the crowded notice could not fit everything");
  Sync.prototype.notifyMerges.call(self, []);
  assert.equal(shown.length, 2, "#20: the rest goes out next time");
  assert.ok((toldMoved || shown[1].includes("was moved")) && (toldArchived || shown[1].includes("archived or unarchived")), shown[1]);
  assert.ok(!/conflict cop/.test(shown[1]), "the copies are not told twice");
  Sync.prototype.notifyMerges.call(self, []);
  assert.equal(shown.length, 2, "nothing left");
  // SYNC-NOTICE fix round 3 (Hive #20): emoji titles; every shown notice fits Core's
  // 300 UTF-16 units, so the move sentence is not cut away and then forgotten.
  shown.length = 0;
  const cart = "\u{1F6D2}".repeat(30);
  const emoji = (copyId) => ({ ...copyOf(`${cart} (conflict copy — Laptop, 2026-10-06 10:15 UTC)`), title: cart, copyId });
  Sync.prototype.notifyMerges.call(self, [emoji("e1"), emoji("e2"), emoji("e3"), { kind: "moved", id: "n4", title: cart, device: "Laptop" }]);
  Sync.prototype.notifyMerges.call(self, []);
  assert.ok(shown.every((m) => m.length <= 300), shown.map((m) => m.length).join(","));
  assert.ok(shown.join(" ").includes("as 3 conflict copies") && shown.join(" ").includes("was moved"), `#20 emoji: ${shown.join(" | ")}`);
  store.set("mergeNotices", false);
  // Hive #7: production copy IDs navigate to Core; groups open its queue.
  const routed=[];
  const resolverContext={...context,ui:{...context.ui,openSyncConflicts:(id)=>routed.push(id)}};
  store.delete("mergeNotices");shown.length=0;
  const one={kind:"copy",id:"same",title:"Same",copy:"Same (conflict copy)",copyId:"10000000-0000-4000-8000-000000000001",mine:true};
  Sync.prototype.notifyMerges.call({context:resolverContext},[one]);
  assert.equal(shown[0].options.action.label,"Resolve conflict");shown[0].options.action.onSelect();assert.equal(routed[0],one.copyId);
  shown.length=0;
  Sync.prototype.notifyMerges.call({context:resolverContext},[one,{...one,copyId:"10000000-0000-4000-8000-000000000002"}]);
  assert.equal(shown[0].options.action.label,"Review conflicts");shown[0].options.action.onSelect();assert.equal(routed[1],undefined);
  await checkRun(Sync, dir);
}

// ---- SYNC-NOTICE fix (Hive #16, F2): the real run() against a fake Core and Drive.
const memStore = () => {
  const m = new Map();
  return {
    async get(k) { return m.get(k) ?? null; },
    async getMany(ks) { return ks.map((k) => m.get(k) ?? null); },
    async setMany(es) { for (const [k, v] of es) m.set(k, v); },
    async deleteMany(ks) { for (const k of ks) m.delete(k); },
    async keys(p = "") { return [...m.keys()].filter((k) => k.startsWith(p)).sort(); },
    async deletePrefix(p) { let n = 0; for (const k of [...m.keys()]) if (k.startsWith(p)) { m.delete(k); n++; } return n; },
  };
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const doc = (text) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** A device: Core's newest-wins apply (honouring `expected`), plugin storage, notices shown. */
function fakeDevice(Sync, encodeKey, key, drive, name) {
  const rows = new Map();
  const tomb = new Map();
  const shown = [];
  const kv = new Map([["key", encodeKey(key)], ["deviceName", name]]);
  const core = {
    async export() {
      return {
        deviceId: name, cursor: 0, objects: [...rows.values()].map(clone), relations: [],
        tombstones: [...tomb].map(([object_id, deleted_at]) => ({ object_id, deleted_at })), relationTombstones: [],
      };
    },
    async apply(input) {
      const stale = [];
      let n = 0;
      for (const o of input.objects ?? []) {
        if (tomb.has(o.id)) continue;
        const cur = rows.get(o.id);
        if (input.expected && Object.hasOwn(input.expected, o.id) && (cur?.updated_at ?? null) !== input.expected[o.id]) { stale.push(o.id); continue; }
        if (cur && o.updated_at <= cur.updated_at) continue;
        rows.set(o.id, clone(o));
        n++;
      }
      for (const t of input.tombstones ?? []) { rows.delete(t.object_id); tomb.set(t.object_id, t.deleted_at); }
      return { appliedObjects: n, staleObjects: stale };
    },
  };
  const context = {
    storage: { get: (k) => kv.get(k), set: (k, v) => kv.set(k, v) },
    store: memStore(),
    data: { sync: core, types: { list: async () => [{ name: "note" }] } },
    i18n: { t: (k, v = {}) => k.split(/\{(\w+)\}/).map((x, i) => (i % 2 ? String(v[x]) : x)).join("") },
    ui: { notice: (message) => { if (context.ui.broken) throw new Error("no window"); shown.push(message); } },
  };
  const sync = new Sync(context);
  sync.remote = drive;
  return { sync, rows, tomb, shown, context };
}

/** Drive folder shared by the devices; `failUploads` makes the next N uploads throw. */
function fakeDrive() {
  const files = new Map();
  let clock = 0;
  return {
    failUploads: 0,
    async list() { return [...files.values()].map(({ id, name, modifiedTime }) => ({ id, name, modifiedTime })); },
    async download(id) { return files.get(id).bytes; },
    async upload(name, bytes) {
      if (this.failUploads > 0) { this.failUploads--; throw new Error("Drive quota exceeded"); }
      files.set(name, { id: name, name, bytes, modifiedTime: String(++clock) });
    },
    async mediaFolderId() { return "media"; },
  };
}

async function checkRun(Sync, dir) {
  const { encodeKey } = await import(new URL("main.js", dir));
  const key = new Uint8Array(32).fill(7);
  const drive = fakeDrive();
  const a = fakeDevice(Sync, encodeKey, key, drive, "Desk");
  const b = fakeDevice(Sync, encodeKey, key, drive, "Laptop");
  const n1 = { id: "n1", type: "note", title: "Shopping list", content: doc("milk"), props: "{}", parent_id: null, archived_at: null, trashed_at: null, created_at: 1, updated_at: 10 };
  for (const d of [a, b]) d.rows.set("n1", clone(n1));
  for (let i = 0; i < 2; i++) { await a.sync.run(); await b.sync.run(); }
  assert.deepEqual([...a.shown, ...b.shown], [], "settling identical devices is silent");

  // Laptop trashes the note, Desk edits it; Desk's pull keeps the edit, then its upload fails.
  b.rows.set("n1", { ...n1, trashed_at: 20, updated_at: 20 });
  await b.sync.run();
  a.rows.set("n1", { ...n1, content: doc("milk, eggs"), updated_at: 30 });
  drive.failUploads = 1;
  await assert.rejects(a.sync.run(), /quota/);
  assert.equal(a.shown.length, 1, "the merge committed before the failed upload is still announced");
  assert.match(a.shown[0], /Shopping list/);
  await a.sync.run();
  assert.equal(a.shown.length, 1, "the retry that succeeds does not announce it again");

  // A notice that could not be shown waits for the next run, once.
  a.context.ui.broken = true;
  assert.throws(() => a.sync.notifyMerges([{ kind: "kept-edit", id: "n9", title: "Later", device: "Laptop" }]), /no window/);
  a.context.ui.broken = false;
  await a.sync.run();
  assert.equal(a.shown.length, 2, "the pending batch is delivered on the next run");
  assert.match(a.shown[1], /Later/);
  await a.sync.run();
  assert.equal(a.shown.length, 2, "and only once");
}

// SYNC-NOTICE fix (Hive #16): run directly, it checks both plugins itself.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [dir, id] of [["notible-sync", "notible.sync"], ["notible-sync-simple", "notible.sync.simple"]]) {
    const base = new URL(`../${dir}/`, import.meta.url);
    const { Sync } = await import(new URL("main.js", base));
    await checkNotices(Sync, id, base);
  }
  console.log("sync-notice checks passed");
}
