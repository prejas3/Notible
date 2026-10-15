// SYNC-MERGE-A (Hive #5): conflict handling shared by Notible Sync and Sync
// Simple. This file is the source; `node scripts/sync-merge-inline.mjs`
// copies it into both main.js files between the sync-merge markers, and both
// self-checks fail when a copy drifts. Pure: no imports, no outside names.

// I18N (Hive #28): marks a notice sentence that mergeNotice() passes to t()
// later, so scripts/plugin-locale-check.mjs sees it. A function declaration on
// purpose: main.js code above the inlined block uses it too.
function tr(key) { return key; }

/** Same as LIMITS.title in main.js; a conflict copy's title is cut to it. */
export const MERGE_TITLE_LIMIT = 4_000;
// SYNC-NO-LOSS (Hive #14, F9): the receiver's validateSnapshot caps titles in
// UTF-16 units, so copy titles are cut in units too, never inside a surrogate pair.
const cutUnits = (text, max) => {
  const out = text.slice(0, Math.max(0, max));
  return /[\uD800-\uDBFF]$/.test(out) ? out.slice(0, -1) : out;
};
const copyTitle = (title, suffix) => cutUnits(title || "Untitled", MERGE_TITLE_LIMIT - suffix.length) + suffix;

// ---------------------------------------------------------------- conflicts
//
// Without this, an object edited on two devices between syncs kept whichever
// edit was newer and dropped the other without a word. Now:
//
// - "Edited on both" is told apart from "edited on one side" by a BASE: the
//   object as it looked in that peer's snapshot the last time this device read
//   it. Local differs from the base -> we changed it since; remote differs ->
//   the peer did. Both, and different from each other -> a conflict. Hashes,
//   not clocks, so a machine whose clock is off cannot fake or hide one.
// - A table (whose rows, columns and cells all carry ids) is merged cell by
//   cell: a column added here and a cell changed there both survive.
// - Anything else, or a cell changed on both sides: the newer version wins as
//   before, and the losing one is saved next to it as a conflict copy. Only the
//   device whose OWN version lost makes that copy -- both devices see the same
//   conflict, and the copy must appear once.
//
// No base yet (first run on this version, or an object new to that peer):
// plain newest-wins, exactly the old behaviour.

/** Table props kept as merge bases, per peer, in characters. */
const TABLE_BASE_BUDGET = 500_000;

/** cyrb53: a fast 53-bit string hash. Not security -- a collision would only
 * hide one conflict, which is the old behaviour anyway. */
function hash53(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Props minus what a device writes for itself. Automations keeps a run log
// in the project's props, rewritten on each device on its own; counted as
// content, two devices that both ran a check looked like a conflicting edit
// and one of them made a conflict copy every sync cycle.
function userProps(props) {
  if (typeof props !== "string" || !props.includes("_automationLog")) return props;
  try {
    const { _automationLog, ...rest } = JSON.parse(props);
    return JSON.stringify(rest);
  } catch {
    return props;
  }
}

/** What a user would call "the object's content" -- everything but the clock. */
export function objectHash(object) {
  return hash53(JSON.stringify([
    object.type, object.title, object.content, userProps(object.props),
    object.archived_at ?? null, object.trashed_at ?? null, object.parent_id ?? null,
  ]));
}

// An empty cell has several spellings ("", null, missing, an unticked box);
// they must compare equal or a column added on one side reads as a conflict
// in every row.
const isEmptyCell = (value) => value === undefined || value === null || value === "" || value === false;
// Key order must not matter either: Tables writes a row's cells in column
// order, so the same row can come back spelled differently.
const canon = (value) => JSON.stringify(value ?? null, (_, v) => (v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
  : v));
const cellKey = (value) => (isEmptyCell(value) ? "" : canon(value));
const valueKey = (value) => canon(value);
const rowKey = (row) => canon(Object.fromEntries(Object.entries(row?.cells ?? {}).filter(([, v]) => !isEmptyCell(v))));

/**
 * Three-way merge of two Tables `props` strings against their common base.
 * `localNewer` breaks ties (same cell changed on both sides): the newer
 * object's value wins. Returns null when any side is not a readable table --
 * the caller then falls back to a conflict copy. `localLost` says whether any
 * of this device's cell edits lost, i.e. whether this device owes a copy.
 *
 * The output is canonical (sorted keys) so both devices, merging the same
 * three versions from opposite ends, write byte-identical props and the
 * exchange settles instead of ping-ponging.
 */
export function mergeTableProps(baseText, localText, remoteText, localNewer) {
  // SYNC-NO-LOSS (Hive #14, F6): a structure this merge cannot read (rows or
  // columns not a list, an item without a string id, a duplicate id, cells
  // not an object) is a bail, never "every row deleted".
  const readable = (value, field) => {
    const list = value[field];
    if (list === undefined) return true;
    if (!Array.isArray(list)) return false;
    const ids = new Set();
    for (const item of list) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || ids.has(item.id)) return false;
      if (field === "rows" && item.cells !== undefined && (!item.cells || typeof item.cells !== "object" || Array.isArray(item.cells))) return false;
      ids.add(item.id);
    }
    return true;
  };
  const parse = (text) => {
    try {
      const value = JSON.parse(text || "{}");
      return value && typeof value === "object" && !Array.isArray(value) && readable(value, "columns") && readable(value, "rows") ? value : null;
    } catch {
      return null;
    }
  };
  const base = parse(baseText);
  const mine = parse(localText);
  const theirs = parse(remoteText);
  if (!base || !mine || !theirs) return null;

  let conflicts = 0;
  let localLost = false;
  const pick = (b, l, r, key, isCell) => {
    // Value-equal but maybe spelled differently ("" / null / missing, key order):
    // pick by localNewer, which flips under a L/R swap, so both devices write the same bytes.
    if (key(l) === key(r)) return localNewer ? l : r;
    if (key(l) === key(b)) return r;
    if (key(r) === key(b)) return l;
    if (isCell) {
      conflicts += 1;
      if (!localNewer) localLost = true;
    }
    return localNewer ? l : r;
  };
  const byId = (list) => new Map((list ?? []).map((item) => [item.id, item]));
  const sorted = (object) => Object.fromEntries(Object.keys(object).sort().map((k) => [k, object[k]]));
  // SYNC-NO-LOSS (Hive #14, F5): a column deleted on one side stays when the
  // other side edited a cell under it (an edit beats a delete). The deleting
  // side's cells in that column then read as the base, so they don't clash.
  const [bCols, lCols, rCols, bRows] = [base.columns, mine.columns, theirs.columns, base.rows].map(byId);
  const cellEdited = (rows, col) => [...byId(rows).values()]
    .some((row) => cellKey(row.cells?.[col]) !== cellKey(bRows.get(row.id)?.cells?.[col]));
  const keepColumn = (id) => (lCols.has(id) ? cellEdited(mine.rows, id) : cellEdited(theirs.rows, id));
  const deleter = (id) => (!bCols.has(id) ? null : !lCols.has(id) ? "l" : !rCols.has(id) ? "r" : null);

  const mergeList = (field, mergeItem, itemKey, keep = () => false) => {
    const b = byId(base[field]);
    const l = byId(mine[field]);
    const r = byId(theirs[field]);
    const [first, second] = localNewer ? [l, r] : [r, l];
    const out = [];
    for (const id of new Set([...first.keys(), ...second.keys()])) {
      const bi = b.get(id);
      const li = l.get(id);
      const ri = r.get(id);
      if (li && ri) { out.push(mergeItem(bi, li, ri)); continue; }
      const present = li ?? ri;
      // Added on one side: keep. Deleted on one side: gone -- unless the
      // other side changed it since, in which case keeping it loses nothing.
      if (!bi || itemKey(bi) !== itemKey(present) || keep(id)) out.push(present);
    }
    return out;
  };

  const columns = mergeList("columns", (b, l, r) => sorted(pick(b, l, r, valueKey, false)), valueKey, keepColumn);
  const kept = new Set(columns.map((c) => c.id));
  const merged = {
    columns,
    rows: mergeList("rows", (b, l, r) => {
      const cells = {};
      const ids = new Set([...Object.keys(l.cells ?? {}), ...Object.keys(r.cells ?? {})]);
      for (const id of [...ids].sort()) {
        const gone = kept.has(id) ? deleter(id) : null;
        const lv = gone === "l" ? b?.cells?.[id] : l.cells?.[id];
        const rv = gone === "r" ? b?.cells?.[id] : r.cells?.[id];
        const value = pick(b?.cells?.[id], lv, rv, cellKey, true);
        // Empty spellings ("", null, false, missing) are one value: omit, so the bytes never depend on the side.
        if (!isEmptyCell(value)) cells[id] = value;
      }
      return { id: l.id, cells };
    }, rowKey),
  };
  // Styles, merged cells, width lock: whole-value three-way, newer wins a tie.
  // Not counted as a lost edit -- they are formatting, not data.
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    if (key === "columns" || key === "rows") continue;
    const value = pick(base[key], mine[key], theirs[key], valueKey, false);
    if (value !== undefined) merged[key] = value;
  }
  return { props: JSON.stringify(sorted(merged)), conflicts, localLost };
}

// E14B-SYNC-FENCE (Hive #2): a table embedded in a note (```notible-table,
// one JSON line per row) merges cell by cell like a standalone one, as long
// as the text around it is the same on both devices.
// ponytail: fences matched by position; adding, removing or reordering whole
// blocks, or editing the text around them, falls back to a conflict copy (Hive #5).
const FENCE_MARK = "\u0000fence";
function splitFences(content) {
  let lines;
  try {
    const doc = JSON.parse(content);
    if (!doc || !Array.isArray(doc.content)) return null;
    // Only Core's own flat shape (documentFromText): one plain paragraph per
    // line. Anything richer (marks, headings) would not survive the rebuild.
    lines = doc.content.map((node) => {
      if (!node || node.type !== "paragraph") throw new Error("not flat");
      const parts = node.content ?? [];
      if (parts.length > 1 || parts.some((part) => part.type !== "text" || part.marks)) throw new Error("not flat");
      return parts[0]?.text ?? "";
    });
  } catch { return null; }
  const outside = [];
  const fences = [];
  let current = null;
  for (const line of lines) {
    if (current) {
      if (line.trim() === "```") { fences.push(current); outside.push(FENCE_MARK); current = null; } else current.push(line);
    } else if (line.trim() === "```notible-table") current = [];
    else outside.push(line);
  }
  return current ? null : { outside: outside.join("\n"), fences };
}
function fenceToProps(body) {
  const [head, ...rows] = body.filter((line) => line.trim()).map((line) => JSON.parse(line));
  if (!head || head.v !== 1) throw new Error("unknown table version");
  const { v, ...rest } = head;
  return JSON.stringify({ ...rest, rows });
}
function propsToFence(props) {
  const { rows = [], ...rest } = JSON.parse(props);
  return [JSON.stringify({ v: 1, ...rest }), ...rows.map((row) => JSON.stringify(row))];
}
export function mergeEmbeddedTables(baseContent, localContent, remoteContent, localNewer) {
  const [base, local, remote] = [baseContent, localContent, remoteContent].map(splitFences);
  if (!base || !local || !remote || base.outside !== local.outside || local.outside !== remote.outside) return null;
  if (!local.fences.length || base.fences.length !== local.fences.length || local.fences.length !== remote.fences.length) return null;
  let conflicts = 0;
  let localLost = false;
  const merged = [];
  try {
    for (let i = 0; i < local.fences.length; i++) {
      const result = mergeTableProps(fenceToProps(base.fences[i]), fenceToProps(local.fences[i]), fenceToProps(remote.fences[i]), localNewer);
      if (!result) return null;
      conflicts += result.conflicts;
      localLost ||= result.localLost;
      merged.push(propsToFence(result.props));
    }
  } catch { return null; }
  const out = [];
  let index = 0;
  for (const line of local.outside.split("\n")) out.push(...(line === FENCE_MARK ? ["```notible-table", ...merged[index++], "```"] : [line]));
  const paragraphs = out.map((text) => (text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" }));
  return { content: JSON.stringify({ type: "doc", content: paragraphs }), conflicts, localLost };
}

/**
 * Decide what to hand `data.sync.apply` for one peer's objects.
 *
 * `localById` is this device's current objects; `bases` / `tableBases` are
 * that peer's objects (hash / table props) as last read. Returns the objects
 * to apply -- merged tables and conflict copies included -- plus a status
 * note per conflict.
 */
export function planConflicts(remoteObjects, localById, bases, tableBases, copyLabel, now = Date.now()) {
  const objects = [];
  const notes = [];
  const events = []; // SYNC-NOTICE (Hive #11): where this device's change did not win
  let conflicts = 0;
  const copyOf = (local, trashedAt = local.trashed_at) => ({
    ...local,
    id: crypto.randomUUID(),
    trashed_at: trashedAt,
    title: copyTitle(local.title, ` (conflict copy — ${copyLabel})`),
    created_at: now,
    updated_at: now,
  });

  for (const remote of remoteObjects) {
    const local = localById.get(remote.id);
    const base = bases[remote.id];
    const remoteHash = objectHash(remote);
    const localHash = local ? objectHash(local) : null;
    // SYNC-ABA (Hive #12): remote == base only means "nothing to take" when
    // newest-wins keeps our row. A newer peer row with the base text (a revert,
    // or a re-stamp) would land over our edit, so it is a conflict: the peer's
    // row wins, ours is kept as a copy. A restored database looks the same
    // (case 15) and gets a copy of the restored text too; stamps cannot tell
    // the two apart (fuzz reset seeds 3984, 7231), and a copy loses nothing.
    const remoteUnchanged = remoteHash === base && remote.updated_at <= local?.updated_at;
    // SYNC-NO-LOSS (Hive #14, F3): no base (first exchange, lost bases, a new
    // peer) is unknown history, not "only the peer changed": two rows that
    // differ are a conflict, so the older one is kept as a copy.
    if (!local || remoteHash === localHash || localHash === base || remoteUnchanged) {
      objects.push(remote);
      continue;
    }
    conflicts += 1;
    const localNewer = local.updated_at !== remote.updated_at ? local.updated_at > remote.updated_at : localHash > remoteHash;
    // Strictly newer than both, so Core's newest-wins takes it on every device.
    const stamp = Math.max(local.updated_at, remote.updated_at) + 1;
    const title = remote.title || local.title || "Untitled";

    // A stale base must not turn a trash-only change into a duplicate.
    if (objectHash({ ...local, trashed_at: null }) === objectHash({ ...remote, trashed_at: null })) {
      if (!localNewer) objects.push(remote.updated_at > local.updated_at ? remote : { ...remote, updated_at: stamp });
      if (!localNewer && local.trashed_at != null && remote.trashed_at == null) events.push({ kind: "restored", id: remote.id, title });
      notes.push('Trash state resolved using the newer version.');
      continue;
    }

    const merged = local.trashed_at == null && remote.trashed_at == null && remote.type === "table" && local.type === "table" && typeof tableBases[remote.id] === "string"
      ? mergeTableProps(tableBases[remote.id], local.props, remote.props, localNewer)
      : null;
    if (merged) {
      objects.push({ ...(localNewer ? local : remote), props: merged.props, updated_at: stamp });
      if (merged.localLost) {
        const copy = copyOf(local);
        objects.push(copy);
        events.push({ kind: "copy", id: remote.id, title, copy: copy.title, copyId: copy.id, mine: true });
      }
      notes.push(merged.conflicts
        ? `"${title}": merged edits from both devices; ${merged.conflicts} cell${merged.conflicts === 1 ? "" : "s"} changed on both, newer kept${merged.localLost ? ", this device's version saved as a conflict copy" : ""}.`
        : `"${title}": merged edits from both devices.`);
      continue;
    }

    // E14B-SYNC-FENCE (Hive #2): a note whose only difference is cells of
    // its embedded tables merges like a table instead of becoming a copy.
    const embedded = local.trashed_at == null && remote.trashed_at == null && local.type !== "table" && remote.type === local.type
      && local.title === remote.title && local.props === remote.props && typeof tableBases[remote.id] === "string"
      ? mergeEmbeddedTables(tableBases[remote.id], local.content, remote.content, localNewer)
      : null;
    if (embedded) {
      objects.push({ ...(localNewer ? local : remote), content: embedded.content, updated_at: stamp });
      if (embedded.localLost) {
        const copy = copyOf(local);
        objects.push(copy);
        events.push({ kind: "copy", id: remote.id, title, copy: copy.title, copyId: copy.id, mine: true });
      }
      notes.push(embedded.conflicts
        ? `"${title}": merged table edits from both devices; ${embedded.conflicts} cell${embedded.conflicts === 1 ? "" : "s"} changed on both, newer kept${embedded.localLost ? ", this device's version saved as a conflict copy" : ""}.`
        : `"${title}": merged table edits from both devices.`);
      continue;
    }

    if (localNewer) {
      // Core keeps ours by itself. The other device copies its own version
      // when it reads this one.
      notes.push(`"${title}": edited on both devices; this device's newer version kept.`);
      continue;
    }
    objects.push(remote.updated_at > local.updated_at ? remote : { ...remote, updated_at: stamp });
    // SYNC-NO-LOSS (Hive #14, F4): a trashed version is copied too when it
    // holds its own edit (trash is recoverable storage); the copy stays in the
    // trash. Only a version that differs from the base by the trash alone
    // has nothing to keep.
    const trashedEdit = local.trashed_at != null && objectHash({ ...local, trashed_at: null }) !== base;
    const savedCopy = local.trashed_at == null || trashedEdit;
    if (savedCopy) {
      const copy = copyOf(local, trashedEdit ? local.trashed_at : remote.trashed_at ?? null);
      objects.push(copy);
      events.push({ kind: "copy", id: remote.id, title, copy: copy.title, copyId: copy.id, mine: true });
    } else if (remote.trashed_at == null) events.push({ kind: "restored", id: remote.id, title });
    notes.push(`"${title}": edited on both devices; the other device's newer version kept, ${savedCopy ? (trashedEdit || remote.trashed_at != null ? "this device's saved as a conflict copy in trash" : "this device's saved as a conflict copy") : "this device's trashed version not copied"}.`);
  }
  return { objects, notes, events, conflicts };
}

/** Next base for one peer: its objects as just read -- except the held-back
 * ones, which keep their old base because this device has not taken them. */
export function nextBases(peerObjects, previous, previousTables, heldBack) {
  const bases = {};
  const tables = {};
  let budget = TABLE_BASE_BUDGET;
  for (const object of peerObjects) {
    if (heldBack.has(object.id)) {
      if (previous[object.id]) bases[object.id] = previous[object.id];
      if (previousTables[object.id]) tables[object.id] = previousTables[object.id];
      continue;
    }
    bases[object.id] = objectHash(object);
    // ponytail: bases live in the app's shared localStorage (a few MB for
    // every plugin together), so big tables get no base and fall back to a
    // conflict copy. A Core-side store would lift this.
    if (object.type === "table" && object.props.length <= budget) {
      tables[object.id] = object.props;
      budget -= object.props.length;
    } else if (typeof object.content === "string" && object.content.includes("```notible-table") && object.content.length <= budget) {
      // E14B-SYNC-FENCE (Hive #2): a note's embedded tables need its last content as the base.
      tables[object.id] = object.content;
      budget -= object.content.length;
    }
  }
  return { bases, tables };
}


// ---------------------------------------------------------------- body diff3
// SYNC-MERGE-A (Hive #5): line-level three-way merge of Core's flat note
// bodies (one plain paragraph per line, coreDocument.ts documentFromText).

const MAX_UNITS = 20_000;
const MAX_D = 2_000;

/** Lines of a flat body, or null for any richer shape (then: legacy path). */
export function flatLines(content) {
  if (content === "" || content === "{}") return [];
  let doc;
  try { doc = JSON.parse(content); } catch { return null; }
  if (!doc || typeof doc !== "object" || doc.type !== "doc" || !Array.isArray(doc.content) || Object.keys(doc).length !== 2) return null;
  const lines = [];
  for (const p of doc.content) {
    if (!p || p.type !== "paragraph") return null;
    const keys = Object.keys(p);
    if (keys.length === 1) { lines.push(""); continue; }
    if (keys.length !== 2 || !Array.isArray(p.content) || p.content.length !== 1) return null;
    const t = p.content[0];
    if (!t || t.type !== "text" || Object.keys(t).length !== 2 || typeof t.text !== "string" || !t.text || t.text.includes("\n")) return null;
    lines.push(t.text);
  }
  // Core writes "" as one empty paragraph; both mean "no lines" (linesToContent writes it back).
  return lines.length === 1 && lines[0] === "" ? [] : lines;
}

/** Exactly documentFromText(lines.join("\n")), so every device writes the same bytes. */
export function linesToContent(lines) {
  const list = lines.length ? lines : [""];
  return JSON.stringify({ type: "doc", content: list.map((text) => (text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" })) });
}

/** One unit per line; a fenced block (``` ... ```) is one unit. Unclosed: null. */
export function toUnits(lines) {
  const units = [];
  let fence = null;
  for (const line of lines) {
    if (fence) {
      fence.push(line);
      if (line.trim() === "```") { units.push(fence.join("\n")); fence = null; }
    } else if (line.trim().startsWith("```")) fence = [line];
    else units.push(line);
  }
  return fence ? null : units;
}

/** Myers O(ND): hunks {s, e, ins} turning a into b, or null over budget. */
export function diffUnits(a, b) {
  if (a.length > MAX_UNITS || b.length > MAX_UNITS) return null;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  const A = a.slice(p, a.length - q);
  const B = b.slice(p, b.length - q);
  const n = A.length;
  const m = B.length;
  if (!n || !m) return n || m ? [{ s: p, e: p + n, ins: B }] : [];
  const max = Math.min(n + m, MAX_D);
  const off = max + 1;
  const v = new Int32Array(2 * off + 1);
  // ponytail: one -d..d slice per step, O(D^2) ints (~16 MB at MAX_D);
  // a Hirschberg split if that ever matters.
  const trace = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  if (found < 0) return null;
  const at = (d, k) => trace[d][k + d];
  const ops = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const k = x - y;
    const down = k === -d || (k !== d && at(d, k - 1) < at(d, k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = at(d, pk);
    const py = px - pk;
    ops.push(down ? { x: px, ins: B[py] } : { x: px, del: true });
    x = px;
    y = py;
  }
  ops.reverse();
  const hunks = [];
  for (const op of ops) {
    let h = hunks[hunks.length - 1];
    if (!h || op.x !== h.e) { h = { s: op.x, e: op.x, ins: [] }; hunks.push(h); }
    if (op.del) h.e++; else h.ins.push(op.ins);
  }
  return hunks.map((h) => ({ s: h.s + p, e: h.e + p, ins: h.ins }));
}

export function applyHunks(a, hunks) {
  const out = [];
  let c = 0;
  for (const h of hunks) { out.push(...a.slice(c, h.s), ...h.ins); c = h.e; }
  return [...out, ...a.slice(c)];
}

const sameUnits = (x, y) => x.length === y.length && x.every((u, i) => u === y[i]);
/** big holds small in order, with only insertions around it. */
const containsUnits = (big, small) => {
  let i = 0;
  for (const u of big) if (i < small.length && u === small[i]) i++;
  return i === small.length;
};
const isTableUnit = (u) => u.split("\n")[0].trim() === "```notible-table";

function mergeTableUnit(b, l, r, localNewer) {
  try {
    const props = [b, l, r].map((u) => fenceToProps(u.split("\n").slice(1, -1)));
    const m = mergeTableProps(props[0], props[1], props[2], localNewer);
    return m && { units: [["```notible-table", ...propsToFence(m.props), "```"].join("\n")], lost: m.conflicts > 0 };
  } catch {
    return null;
  }
}

/** diff3 over units. `lost`: the older side lost an edit (it owes a copy). */
export function mergeLines(base, l, r, localNewer) {
  const hl = diffUnits(base, l);
  const hr = diffUnits(base, r);
  if (!hl || !hr) return null;
  const all = [...hl.map((h) => ({ ...h, side: "L" })), ...hr.map((h) => ({ ...h, side: "R" }))];
  const parent = all.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  // ponytail: O(H^2) over hunks, H <= 2 * MAX_D.
  for (let i = 0; i < hl.length; i++) {
    for (let j = hl.length; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      const samePoint = a.s === a.e && b.s === b.e && a.s === b.s;
      if (samePoint || (a.s < b.e && b.s < a.e)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  all.forEach((h, i) => {
    const root = find(i);
    const g = groups.get(root) ?? { S: h.s, E: h.e, members: [] };
    g.S = Math.min(g.S, h.s);
    g.E = Math.max(g.E, h.e);
    g.members.push(h);
    groups.set(root, g);
  });
  const ordered = [...groups.values()].sort((a, b) => a.S - b.S || (a.E - a.S) - (b.E - b.S));
  const sideText = (g, side) => {
    const out = [];
    let c = g.S;
    for (const h of g.members.filter((x) => x.side === side)) { out.push(...base.slice(c, h.s), ...h.ins); c = h.e; }
    return [...out, ...base.slice(c, g.E)];
  };
  const resolve = (g) => {
    const L = sideText(g, "L");
    const R = sideText(g, "R");
    const sides = new Set(g.members.map((h) => h.side));
    if (sides.size === 1) return { units: sides.has("L") ? L : R, lost: false };
    if (sameUnits(L, R)) return { units: L, lost: false };
    const newer = localNewer ? L : R;
    const older = localNewer ? R : L;
    // Blank-only difference (checked first so same-spot blank insertions do not stack).
    if (sameUnits(L.filter((u) => u !== ""), R.filter((u) => u !== ""))) return { units: newer, lost: false };
    if (g.S === g.E) {
      let pre = 0;
      while (pre < L.length && pre < R.length && L[pre] === R[pre]) pre++;
      let suf = 0;
      while (suf < L.length - pre && suf < R.length - pre && L[L.length - 1 - suf] === R[R.length - 1 - suf]) suf++;
      return { units: [...L.slice(0, pre), ...newer.slice(pre, newer.length - suf), ...older.slice(pre, older.length - suf), ...L.slice(L.length - suf)], lost: false };
    }
    if (L.length && R.length) {
      if (containsUnits(L, R)) return { units: L, lost: false };
      if (containsUnits(R, L)) return { units: R, lost: false };
    }
    const B = base.slice(g.S, g.E);
    if (B.length === 1 && L.length === 1 && R.length === 1 && isTableUnit(B[0]) && isTableUnit(L[0]) && isTableUnit(R[0])) {
      return mergeTableUnit(B[0], L[0], R[0], localNewer);
    }
    return { units: newer, lost: true };
  };
  const units = [];
  let lost = false;
  let cursor = 0;
  for (const g of ordered) {
    if (g.S < cursor) return null; // ponytail: cannot happen with separate hunks; bail rather than guess
    units.push(...base.slice(cursor, g.S));
    const res = resolve(g);
    if (!res) return null;
    units.push(...res.units);
    lost ||= res.lost;
    cursor = g.E;
  }
  units.push(...base.slice(cursor));
  return { units, lost };
}

// ---------------------------------------------------------------- object merge
// SYNC-MERGE-A (Hive #5). Every tie goes through localNewer, never through
// "which side is local", so mergeObject(b, L, R, x) == mergeObject(b, R, L, !x).

// ------------------------------------------------------- structural JSON merge
// SYNC-STRUCT (Hive #6; spec 2026-10-06-sync-structural-json-merge.md (internal, not published)).
// Boards keep a whole canvas in one prop or one line of content, so the
// key-by-key / line-by-line merge clashed on any two concurrent edits and made
// a conflict copy of the whole board. These merge by item id instead, like
// mergeTableProps; anything unreadable is still a bail (null), never a loss.

const plainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const sortKeys = (v) => JSON.parse(canon(v));

/** Three-way pick of key `k`: `from` is the side to copy it from (it may lack it = deleted). */
function mergeKey(b, l, r, k, localNewer) {
  const key = (o) => (o !== undefined && Object.hasOwn(o, k) ? valueKey(o[k]) : undefined);
  const [kb, kl, kr] = [key(b), key(l), key(r)];
  if (kl === kr) return { from: localNewer ? l : r, clash: false };
  if (kr === kb) return { from: l, clash: false };
  if (kl === kb) return { from: r, clash: false };
  return { from: localNewer ? l : r, clash: true };
}

/** Objects with unique non-empty string ids (missing = empty list), else null. */
function idItems(list, itemOk = () => true) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) return null;
  const ids = new Set();
  for (const item of list) {
    if (!plainObject(item) || typeof item.id !== "string" || !item.id || ids.has(item.id) || !itemOk(item)) return null;
    ids.add(item.id);
  }
  return list;
}

/**
 * Three-way merge of id-keyed lists. An item added on either side stays; one
 * deleted on a side stays only if the other side changed it (an edit beats a
 * delete). Fields merge one by one; a clash takes the newer side and counts
 * as a lost edit unless the field is in `layout` (or `silent` is set).
 * `fields` holds custom merges for a field changed on both sides. Order: the
 * side that reordered the shared items (the newer one if both did), with the
 * other side's new items placed after the item they followed. Symmetric:
 * (b, l, r, x) and (b, r, l, !x) give the same list.
 */
function mergeIdList(base, mine, theirs, localNewer, { layout = [], silent = false, fields = {}, sorted = false } = {}) {
  const byId = (list) => new Map(list.map((item) => [item.id, item]));
  const [b, l, r] = [base, mine, theirs].map(byId);
  let lost = false;
  const mergeItem = (bi, li, ri) => {
    // Null prototype and own-key lookups (Codex on #6): a field named
    // "__proto__" or "constructor" is an ordinary field here.
    const out = Object.create(null);
    for (const k of [...new Set([...Object.keys(li), ...Object.keys(ri)])].sort()) {
      const { from, clash } = mergeKey(bi, li, ri, k, localNewer);
      if (clash && Object.hasOwn(fields, k)) { out[k] = fields[k](bi?.[k], li[k], ri[k]); continue; }
      if (clash && !silent && !layout.includes(k)) lost = true;
      if (Object.hasOwn(from, k)) out[k] = JSON.parse(valueKey(from[k]));
    }
    return out;
  };
  const kept = new Set();
  for (const id of new Set([...l.keys(), ...r.keys()])) {
    const present = l.get(id) ?? r.get(id);
    if ((l.has(id) && r.has(id)) || !b.has(id) || valueKey(b.get(id)) !== valueKey(present)) kept.add(id);
  }
  const items = new Map([...kept].map((id) => [id, l.has(id) && r.has(id) ? mergeItem(b.get(id), l.get(id), r.get(id)) : sortKeys(l.get(id) ?? r.get(id))]));
  let order;
  if (sorted) order = [...kept].sort();
  else {
    const shared = (list) => list.map((item) => item.id).filter((id) => b.has(id) && l.has(id) && r.has(id)).join("\n");
    const lMoved = shared(mine) !== shared(base);
    const rMoved = shared(theirs) !== shared(base);
    const [first, second] = (lMoved !== rMoved ? lMoved : localNewer) ? [mine, theirs] : [theirs, mine];
    order = first.map((item) => item.id).filter((id) => kept.has(id));
    let at = 0;
    for (const { id } of second) {
      if (!kept.has(id)) continue;
      const i = order.indexOf(id);
      if (i >= 0) at = i + 1;
      else order.splice(at++, 0, id);
    }
  }
  return { list: order.map((id) => items.get(id)), lost };
}

const NODE_LAYOUT = ["x", "y", "width", "height", "color", "shape"];

/** Whiteboard content `{version: 1, nodes, edges, viewport}`; `table` node rows are one value. */
function mergeWhiteboard(bText, lText, rText, localNewer) {
  const parse = (text) => {
    if (!text || !text.trim()) return { version: 1, nodes: [], edges: [] };
    let v;
    try { v = JSON.parse(text); } catch { return null; }
    const edgeOk = (e) => typeof e.from === "string" && typeof e.to === "string";
    return plainObject(v) && v.version === 1 && Array.isArray(v.nodes) && Array.isArray(v.edges) && idItems(v.nodes) && idItems(v.edges, edgeOk) ? v : null;
  };
  const [b, l, r] = [bText, lText, rText].map(parse);
  if (!b || !l || !r) return null;
  const nodes = mergeIdList(b.nodes, l.nodes, r.nodes, localNewer, { layout: NODE_LAYOUT });
  const edges = mergeIdList(b.edges, l.edges, r.edges, localNewer, { sorted: true });
  let lost = nodes.lost || edges.lost;
  const out = Object.create(null);
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    if (k === "nodes" || k === "edges") continue;
    const { from, clash } = mergeKey(b, l, r, k, localNewer);
    if (clash && k !== "viewport") lost = true;
    if (Object.hasOwn(from, k)) out[k] = from[k];
  }
  // An edge to a node that is gone (deleted on one side) goes with it.
  const live = new Set(nodes.list.map((n) => n.id));
  out.nodes = nodes.list;
  out.edges = edges.list.filter((e) => live.has(e.from) && live.has(e.to));
  return { v: JSON.stringify(sortKeys(out)), lost };
}

/** Typewriter `tw.board`: card id -> {x, y}. Positions only, so never a lost edit. */
function mergeBoardPositions(b, l, r, localNewer) {
  const list = (v) => {
    if (v === undefined) return [];
    if (!plainObject(v)) return null;
    const out = Object.entries(v).map(([id, at]) => (plainObject(at) && Number.isFinite(at.x) && Number.isFinite(at.y) ? { ...at, id } : null));
    return out.includes(null) || out.some((item) => !item.id) ? null : out;
  };
  const [lb, ll, lr] = [b, l, r].map(list);
  if (!lb || !ll || !lr) return null;
  const m = mergeIdList(lb, ll, lr, localNewer, { silent: true, sorted: true });
  return { value: Object.fromEntries(m.list.map(({ id, ...at }) => [id, at])), lost: false };
}

/** Members added on either side, minus members removed on either side. */
const mergeSet = (b = [], l, r) => {
  const [B, L, R] = [b, l, r].map((list) => new Set(list));
  return [...new Set([...l, ...r])].filter((x) => (L.has(x) && R.has(x)) || !B.has(x)).sort();
};

/**
 * Typewriter `tw.frames`: [{id, title, members}]. A card or frame sits in at
 * most one frame, so a member both sides put in different frames stays in the
 * newer side's; empty frames are dropped (as the board does); a nesting cycle
 * is a bail.
 */
function mergeFrames(b, l, r, localNewer) {
  const frameOk = (f) => Array.isArray(f.members) && f.members.every((m) => typeof m === "string") && (f.title === undefined || typeof f.title === "string");
  const [fb, fl, fr] = [b, l, r].map((v) => idItems(v, frameOk));
  if (!fb || !fl || !fr) return null;
  const m = mergeIdList(fb, fl, fr, localNewer, { fields: { members: mergeSet } });
  const [newer, older] = localNewer ? [fl, fr] : [fr, fl];
  const home = (frames, member) => frames.find((f) => f.members.includes(member))?.id;
  const owners = new Map();
  for (const f of m.list) for (const x of f.members) owners.set(x, [...(owners.get(x) ?? []), f.id]);
  for (const [x, ids] of owners) {
    if (ids.length < 2) continue;
    const keep = [home(newer, x), home(older, x)].find((id) => ids.includes(id)) ?? [...ids].sort()[0];
    for (const f of m.list) if (f.id !== keep) f.members = f.members.filter((y) => y !== x);
  }
  const frames = m.list.filter((f) => f.members.length > 0);
  const inside = new Map(frames.map((f) => [f.id, f.members]));
  const state = new Map(); // 1 = on the path, 2 = done
  const cycle = (id) => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2 || !inside.has(id)) return false;
    state.set(id, 1);
    const found = inside.get(id).some(cycle);
    state.set(id, 2);
    return found;
  };
  if (frames.some((f) => cycle(f.id))) return null;
  return { value: frames, lost: m.lost };
}

const idListProp = (opts, itemOk) => (b, l, r, localNewer) => {
  const [ib, il, ir] = [b, l, r].map((v) => idItems(v, itemOk));
  if (!ib || !il || !ir) return null;
  const m = mergeIdList(ib, il, ir, localNewer, opts);
  return { value: m.list, lost: m.lost };
};

/**
 * Hive #24: `tags` (strings) and `deps` ([{on, kind}], one per `on`) merge as
 * sets: an add on either side stays, a removal wins only against an untouched
 * entry. A dependency kind changed on both sides: newer, silently (a
 * scheduling setting, like view settings); any other dep field clash is a
 * copy. Duplicates, junk or an unknown kind are a bail.
 */
function mergeTags(b, l, r, localNewer) {
  const items = (v) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((tag) => typeof tag !== "string" || !tag) || new Set(v).size !== v.length) return null;
    return v.map((id) => ({ id }));
  };
  const [ib, il, ir] = [b, l, r].map(items);
  if (!ib || !il || !ir) return null;
  return { value: mergeIdList(ib, il, ir, localNewer, { silent: true }).list.map((item) => item.id), lost: false };
}

// The kinds `depsOf` (ganttCascade.ts) reads; it turns anything else into
// "finish-start", so a malformed kind winning would erase the other edit.
const DEP_KINDS = new Set(["finish-start", "start-start", "finish-finish", "start-finish"]);

function mergeDeps(b, l, r, localNewer) {
  const items = (v) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || !v.every((dep) => plainObject(dep) && !Object.hasOwn(dep, "id"))) return null;
    // Codex on #24: an omitted kind is the legacy spelling of "finish-start"
    // (as `depsOf` reads it), so it is filled in on every side and never
    // clashes with an explicit one; any other kind is a bail.
    const deps = v.map(({ on, ...rest }) => ({ kind: "finish-start", ...rest, id: on }));
    return deps.every((dep) => DEP_KINDS.has(dep.kind)) ? idItems(deps) : null;
  };
  const [ib, il, ir] = [b, l, r].map(items);
  if (!ib || !il || !ir) return null;
  // Only `kind` clashes are silent; a clash on any other field
  // (a note, an unknown field) keeps the newer value and makes a conflict copy.
  const m = mergeIdList(ib, il, ir, localNewer, { layout: ["kind"] });
  return { value: m.list.map(({ id, ...rest }) => ({ on: id, ...rest })), lost: m.lost };
}

/** Props merged by id when both sides changed them; every other key stays whole-value. */
const STRUCTURED_PROPS = {
  tags: mergeTags,
  deps: mergeDeps,
  "tw.board": mergeBoardPositions,
  "tw.frames": mergeFrames,
  // Each item must pass its reader (readMarkers, viewsFromObject) on every
  // side, or the merge would keep it and the reader drop it (Codex on #6).
  "tw.timeline": idListProp({ layout: ["x", "jump"] }, (m) => Number.isFinite(m.x)),
  // A view setting never costs a project a conflict copy.
  _views: idListProp({ silent: true }, (v) => typeof v.layout === "string"),
};

function mergeContent(type, b, l, r, localNewer) {
  if (l === r || r === b) return { v: l, lost: false };
  if (l === b) return { v: r, lost: false };
  if (type === "whiteboard") return mergeWhiteboard(b, l, r, localNewer);
  const [ub, ul, ur] = [b, l, r].map((c) => { const lines = flatLines(c); return lines && toUnits(lines); });
  if (!ub || !ul || !ur) return null;
  const m = mergeLines(ub, ul, ur, localNewer);
  return m && { v: linesToContent(m.units.flatMap((u) => u.split("\n"))), lost: m.lost };
}

function mergeProps(type, b, l, r, localNewer) {
  if (l === r || r === b) return { v: l, lost: false };
  if (l === b) return { v: r, lost: false };
  if (type === "table") {
    const m = mergeTableProps(b, l, r, localNewer);
    return m && { v: m.props, lost: m.conflicts > 0 };
  }
  const parse = (text) => {
    try { const v = JSON.parse(text || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
  };
  const [pb, pl, pr] = [b, l, r].map(parse);
  if (!pb || !pl || !pr) return null;
  // Null prototype: a "__proto__" key from a peer stays an ordinary key.
  const out = Object.create(null);
  let lost = false;
  const key3 = (o, k) => (Object.hasOwn(o, k) ? valueKey(o[k]) : undefined);
  for (const k of [...new Set([...Object.keys(pb), ...Object.keys(pl), ...Object.keys(pr)])].sort()) {
    const winner = localNewer ? pl : pr;
    let from;
    if (k === "_automationLog") from = winner;
    else {
      const [kb, kl, kr] = [key3(pb, k), key3(pl, k), key3(pr, k)];
      if (kl === kr || kr === kb) from = pl;
      else if (kl === kb) from = pr;
      else if (Object.hasOwn(STRUCTURED_PROPS, k)) {
        const m = STRUCTURED_PROPS[k](pb[k], pl[k], pr[k], localNewer);
        if (!m) return null;
        lost ||= m.lost;
        out[k] = JSON.parse(valueKey(m.value));
        continue;
      }
      else { from = winner; lost = true; }
    }
    // Canonical value, so both devices write the same bytes.
    if (Object.hasOwn(from, k)) out[k] = JSON.parse(valueKey(from[k]));
  }
  return { v: JSON.stringify(out), lost };
}

export function mergeObject(base, L, R, localNewer) {
  if (base.type !== L.type || L.type !== R.type) return null;
  const newer = localNewer ? L : R;
  const notes = [];
  // SYNC-NOTICE (Hive #11): what the user should hear about; pullPeer adds id and title.
  const events = [];
  const three = (b, l, r) => (l === r || r === b ? { v: l } : l === b ? { v: r } : { v: localNewer ? l : r, clash: true });
  const title = three(base.title, L.title, R.title);
  const parent = three(base.parent_id ?? null, L.parent_id ?? null, R.parent_id ?? null);
  const archived = three(base.archived_at ?? null, L.archived_at ?? null, R.archived_at ?? null);
  const props = mergeProps(L.type, base.props, L.props, R.props, localNewer);
  if (!props) return null;
  const content = mergeContent(L.type, base.content, L.content, R.content, localNewer);
  if (!content) return null;
  const shown = title.v || "Untitled";
  const name = Array.from(shown).length > 80 ? `${Array.from(shown).slice(0, 80).join("")}…` : shown;
  if (parent.clash || archived.clash) {
    notes.push(`"${name}": moved or archived on both devices; the newer placement was kept.`);
    // SYNC-NOTICE fix (Hive #16, F6): an archive clash is not a move.
    if (!localNewer && parent.clash) events.push("moved");
    if (!localNewer && archived.clash) events.push("archived");
  }

  const bt = base.trashed_at ?? null;
  const untrashed = (o) => objectHash({ ...o, trashed_at: null });
  const baseUntrashed = untrashed(base);
  const trashOnly = (o) => bt === null && (o.trashed_at ?? null) !== null && untrashed(o) === baseUntrashed;
  const editedLive = (o) => (o.trashed_at ?? null) === null && untrashed(o) !== baseUntrashed;
  let trashed_at;
  if ((trashOnly(L) && editedLive(R)) || (trashOnly(R) && editedLive(L))) {
    trashed_at = null;
    notes.push(`"${name}" was deleted on one device but edited on another, so it was kept.`);
    events.push(trashOnly(L) ? "restored" : "kept-edit");
  } else if ((L.trashed_at ?? null) !== null && (R.trashed_at ?? null) !== null) trashed_at = Math.max(L.trashed_at, R.trashed_at);
  else trashed_at = three(bt, L.trashed_at ?? null, R.trashed_at ?? null).v;

  if (trashed_at != null && editedLive(L)) events.push("edit-in-trash");
  const lost = Boolean(title.clash) || props.lost || content.lost;
  // Hive #7: only an entirely reviewed body conflict can dispose of its copy.
  const fields = [content.lost && "content", title.clash && "title", props.lost && "props", parent.clash && "parent_id", archived.clash && "archived_at"].filter(Boolean);
  return {
    fields,
    object: {
      ...newer,
      id: L.id,
      title: title.v,
      parent_id: parent.v,
      archived_at: archived.v,
      props: props.v,
      content: content.v,
      trashed_at,
      created_at: Math.min(L.created_at, R.created_at),
      updated_at: Math.max(L.updated_at, R.updated_at) + 1,
    },
    loser: lost ? (localNewer ? "R" : "L") : null,
    notes,
    events,
  };
}

// ---------------------------------------------------------------- lineage
// SYNC-MERGE-A (Hive #5). Entry = [vid, vh, by, at]: a version id, its
// objectHash, the device name that made it ("" unknown) and its updated_at.
// Newest first, at most 8. Spec §3.

export const LINEAGE_MAX = 8;
const VID = /^[0-9a-z]{1,16}$/;
const VH = /^[0-9a-z]{1,11}$/;
const MAX_AT = Date.UTC(2200, 0, 1);

/** Ids that may appear in store keys; any other id takes the legacy path. */
export const storeable = (id) => typeof id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(id);

export function randomVid() {
  return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => (b % 36).toString(36)).join("");
}
export const seedEntry = (vh, salt) => [salt ? "r" + hash53(salt + ":" + vh) : "c" + vh, vh, "", 0];
/**
 * Either kind of seed: "c" + vh (first upgrade) or a salted "r" re-seed.
 * Checks 3/4 restrict only "c" seeds (fix round 4, R3-2); see `found` in pullPeer.
 */
export const isSeed = (e) => e[0] === "c" + e[1] || (e[0][0] === "r" && e[2] === "" && e[3] === 0);
export const isSeedOnly = (l) => l.length === 1 && l[0][0] === "c" + l[0][1] && l[0][2] === "" && l[0][3] === 0;
export const mergeVid = (a, b, vh) => "m" + hash53([a, b].sort().join(":") + ":" + vh);
const byVid = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** X's and Y's entries deduped by vid, ordered by min position, vid tie-break. */
export function merged(x, y) {
  const pos = new Map();
  for (const list of [x, y]) {
    list.forEach((e, i) => {
      const p = pos.get(e[0]);
      if (!p) pos.set(e[0], { i, e });
      else if (i < p.i) p.i = i;
    });
  }
  return [...pos.values()].sort((a, b) => a.i - b.i || byVid(a.e[0], b.e[0])).slice(0, LINEAGE_MAX).map((p) => p.e);
}

export const pin = (h, x) => [h, ...x.filter((e) => e[0] !== h[0])].slice(0, LINEAGE_MAX);

/** The shared entry with the smallest max(position); vid tie-break. a's copy. */
export function ancestor(a, b) {
  const inA = new Map();
  a.forEach((e, i) => { if (!inA.has(e[0])) inA.set(e[0], { i, e }); });
  let best = null;
  let bestMax = Infinity;
  b.forEach((e, j) => {
    const hit = inA.get(e[0]);
    if (!hit) return;
    const m = Math.max(hit.i, j);
    if (m < bestMax || (m === bestMax && byVid(e[0], best[0]) < 0)) { best = hit.e; bestMax = m; }
  });
  return best;
}

/** A peer snapshot's lineage, validated. Anything malformed is dropped. */
export function readLineage(snapshot) {
  if (snapshot?.lineageV !== 1) return {};
  const devices = snapshot.devices;
  if (!Array.isArray(devices) || devices.length > 64 || !devices.every((d) => typeof d === "string" && [...d].length <= 80)) return {};
  const lineage = new Map();
  // Ids whose list was present but invalid: pullPeer sends these to the legacy
  // path. SYNC-MERGE-A (Hive #5): not named `rejected`, which validateSnapshot
  // already returns (string[]); spreading both would overwrite it.
  const lineageRejected = new Set();
  const source = snapshot.lineage;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const id of Object.keys(source)) {
      const list = source[id];
      if (!storeable(id)) continue;
      if (!Array.isArray(list) || !list.length || list.length > LINEAGE_MAX) { lineageRejected.add(id); continue; }
      const out = [];
      const seen = new Set();
      let ok = true;
      for (const e of list) {
        const [vid, vh, by, at] = Array.isArray(e) && e.length === 4 ? e : [];
        if (typeof vid !== "string" || !VID.test(vid) || typeof vh !== "string" || !VH.test(vh)
          || !Number.isInteger(by) || by < 0 || by >= devices.length
          || !Number.isSafeInteger(at) || at < 0 || at > MAX_AT) { ok = false; break; }
        if (seen.has(vid)) continue;
        seen.add(vid);
        out.push([vid, vh, devices[by], at]);
      }
      if (ok) lineage.set(id, out);
      else lineageRejected.add(id);
    }
  }
  // SYNC-NOTICE fix (Hive #16, F4): merge receipts, { id -> [[losingVid, kinds, copyVid, mine]] }.
  const receipts = new Map();
  const rs = snapshot.receipts;
  if (rs && typeof rs === "object" && !Array.isArray(rs)) {
    for (const id of Object.keys(rs).slice(0, LIMIT_RECEIPT_IDS)) {
      // SYNC-NOTICE fix round 2 (Hive #16, R2-5): a receipt names an older
      // version (and the copy's source) in this object's own lineage, never its head.
      const l = lineage.get(id);
      if (!l || !Array.isArray(rs[id])) continue;
      const known = (vid) => l.some((e) => e[0] === vid);
      const ok = rs[id].slice(0, RECEIPTS_MAX).filter((x) => validReceipt(x) && x[0] !== l[0][0] && known(x[0]) && (!x[2] || known(x[2])));
      if (ok.length) receipts.set(id, ok);
    }
  }
  return { lineageV: 1, lineage, lineageRejected, receipts };
}

// SYNC-NOTICE fix (Hive #16, F4): a device whose published edit lost in a peer's
// merge only fast-forwards to that merge, so it never runs mergeObject itself.
// The merging device keeps, per object, what the losing version's device would
// have been told; it rides in the snapshot until that vid leaves the lineage.
const RECEIPT_KINDS = new Set(["restored", "kept-edit", "edit-in-trash", "moved", "archived"]);
const RECEIPTS_MAX = 4;
const LIMIT_RECEIPT_IDS = 5_000;
// copyVid (round 2, R2-3): the version the copy was made from, so copyId() finds
// the real copy object; "" when there is no copy. "mine" = the loser's own version.
const validReceipt = (x) => Array.isArray(x) && x.length === 4 && typeof x[0] === "string" && VID.test(x[0])
  && Array.isArray(x[1]) && x[1].length <= RECEIPT_KINDS.size && x[1].every((k) => RECEIPT_KINDS.has(k))
  && typeof x[2] === "string" && (x[2] === "" || (VID.test(x[2]) && x[3] === (x[2] === x[0]))) && typeof x[3] === "boolean"
  && (x[1].length > 0 || x[2] !== "");
/** Receipts still worth keeping: newest first, only for vids still in the lineage. */
const keepReceipts = (l, ...lists) => {
  const seen = new Set();
  return lists.flat().filter((x) => x && l.some((e) => e[0] === x[0]) && !seen.has(x[0]) && seen.add(x[0])).slice(0, RECEIPTS_MAX);
};

export const versionOf = (o, entry) => ({
  vid: entry[0], vh: entry[1], type: o.type, title: o.title, content: o.content, props: o.props,
  parent_id: o.parent_id ?? null, archived_at: o.archived_at ?? null, trashed_at: o.trashed_at ?? null,
});

/** A stored version, or null when missing, unreadable or not what the entry says. */
export async function loadVersion(store, id, entry) {
  try {
    const v = JSON.parse(await store.get(`v:${id}:${entry[0]}`));
    return v && v.vid === entry[0] && v.vh === entry[1] && objectHash(v) === entry[1] ? v : null;
  } catch {
    return null;
  }
}

/** UUID-shaped id that every device derives the same way for one losing version. */
export function copyId(objectId, vid) {
  const hex = [`${objectId}:${vid}`, `${vid}:${objectId}`, `${objectId}|${vid}`]
    .map((s) => parseInt(hash53(s), 36).toString(16).padStart(14, "0")).join("").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "89ab"[parseInt(hex[16], 16) & 3];
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The losing version as its own object; every field fixed by (objectId, entry). */
export function conflictCopy(objectId, loser, entry, stamp) {
  const [vid, , by, rawAt] = entry;
  // A bad stamp must not throw or differ between devices: no date, time 0.
  const at = Number.isSafeInteger(rawAt) && rawAt > 0 && rawAt <= MAX_AT ? rawAt : 0;
  const when = at ? `, ${new Date(at).toISOString().slice(0, 16).split("T").join(" ")} UTC` : "";
  const suffix = ` (conflict copy — ${by || "another device"}${when})`;
  const title = copyTitle(loser.title, suffix);
  const time = at || stamp;
  const object = {
    id: copyId(objectId, vid), type: loser.type,
    title,
    content: loser.content, props: loser.props, parent_id: loser.parent_id ?? null,
    archived_at: loser.archived_at ?? null, trashed_at: null, created_at: time, updated_at: time,
  };
  return { object, entry: ["k" + hash53(objectId + vid), objectHash(object), by, at] };
}

// ---------------------------------------------------------------- orchestration
// SYNC-MERGE-A (Hive #5): per-peer pull and the push, shared by both plugins
// so the simulator in sync-merge.check.mjs runs the real code. Spec §3.3-3.5
// (the spec's `planObjects` is `pullPeer` here: it also applies and verifies).

const VERSION_CAP = 4 * 1024 * 1024 - 1024;
const BATCH = 500;
const bytesOf = (s) => new TextEncoder().encode(s).length;
/** Same cap readLineage applies to a peer's `devices`: 80 code points. */
const deviceLabel = (name) => [...String(name ?? "")].slice(0, 80).join("");

async function inBatches(list, fn) {
  for (let i = 0; i < list.length; i += BATCH) await fn(list.slice(i, i + BATCH));
}

export async function resetLineage(store) {
  await store.deletePrefix("lin:");
  await store.deletePrefix("v:");
}

// SYNC-MERGE-A (Hive #5), fix round 3 (N1): a re-seed is salted so it never
// matches a pre-reset vid. Seeding after a reset with "c" + vh would mint, for
// content that went back to an earlier state, the very vid a peer holds deep in
// its lineage, and check 5 would take that seed as the merge base and drop the
// revert. A first upgrade has no marker and keeps "c" + vh, so devices that
// upgrade together still share their seed and merge their first divergence.
// Every path that wipes lineage and later re-seeds must call markReseed.
export async function markReseed(store) {
  await store.setMany([["reseed", randomVid()]]);
}

async function lineageOff(lin) {
  lin.off = true;
  lin.lin.clear();
  lin.pending.clear();
  try { await resetLineage(lin.store); await markReseed(lin.store); } catch { /* the store is what failed */ }
}

/**
 * Persist lineage for `ids`, store `versions` ([id, entry, object]) and drop
 * `purge` ids. Versions go first and a failure there only un-holds them; a
 * lineage write that fails turns lineage off for the session (legacy only).
 * `gc`: also drop versions outside "head + 2 newest held". Pulls pass false
 * and leave that to the push, so a version one peer's merge displaced is
 * still there when the next peer of the same cycle needs it as the ancestor.
 */
async function writeLineage(lin, ids, versions, purge, gc, orphans = []) {
  if (lin.off) return;
  const vEntries = [];
  for (const [id, entry, object] of versions) {
    const text = JSON.stringify(versionOf(object, entry));
    if (bytesOf(text) < VERSION_CAP) vEntries.push([`v:${id}:${entry[0]}`, text, id, entry[0]]);
    else lin.lin.get(id)?.h.delete(entry[0]);
  }
  await inBatches(vEntries, async (batch) => {
    try { await lin.store.setMany(batch.map(([k, v]) => [k, v])); } catch { for (const [, , id, vid] of batch) lin.lin.get(id)?.h.delete(vid); }
  });
  // `orphans`: v: keys the caller just took out of `h` (deleted after the lin: write).
  const drop = [...orphans];
  if (gc) { ids = [...ids, ...lin.pending]; lin.pending.clear(); } else for (const id of ids) lin.pending.add(id);
  for (const id of purge) lin.pending.delete(id);
  for (const id of gc ? new Set(ids) : []) {
    const rec = lin.lin.get(id);
    if (!rec) continue;
    // Keep the head plus the 2 newest other held versions.
    const keep = new Set(rec.l.filter((e, i) => rec.h.has(e[0]) && i === 0).map((e) => e[0]));
    for (const e of rec.l.slice(1)) if (rec.h.has(e[0]) && keep.size < (rec.h.has(rec.l[0][0]) ? 3 : 2)) keep.add(e[0]);
    for (const vid of rec.h) if (!keep.has(vid)) { rec.h.delete(vid); drop.push(`v:${id}:${vid}`); }
  }
  try {
    await inBatches([...new Set(ids)].filter((id) => lin.lin.has(id)), (batch) =>
      lin.store.setMany(batch.map((id) => { const r = lin.lin.get(id); return [`lin:${id}`, JSON.stringify({ l: r.l, h: [...r.h], ...(r.r?.length ? { r: r.r } : {}), ...(r.m ? { m: r.m } : {}) })]; })));
    for (const id of purge) {
      lin.lin.delete(id);
      await lin.store.deleteMany([`lin:${id}`]);
      await lin.store.deletePrefix(`v:${id}:`);
    }
  } catch {
    await lineageOff(lin);
    return;
  }
  try { await inBatches(drop, (batch) => lin.store.deleteMany(batch)); } catch { /* orphans cost space only */ }
}

const parseRecord = (text) => {
  try {
    const r = JSON.parse(text);
    if (!Array.isArray(r?.l) || !r.l.length || !Array.isArray(r.h)) return null;
    const rc = Array.isArray(r.r) ? r.r.filter(validReceipt) : [];
    const own = typeof r.m === "string" && VID.test(r.m) ? { m: r.m } : {};
    return rc.length ? { l: r.l, h: new Set(r.h), r: rc, ...own } : { l: r.l, h: new Set(r.h), ...own };
  } catch { return null; }
};

/** Load lineage once per plugin start; seed it on first use or after a wipe. */
export async function openLineage(store, objects) {
  const lin = { store, lin: new Map(), off: false, pending: new Set() };
  try {
    const keys = await store.keys("lin:");
    const values = keys.length ? await store.getMany(keys) : [];
    keys.forEach((k, i) => { const r = parseRecord(values[i]); if (r) lin.lin.set(k.slice(4), r); });
    if (!keys.length) {
      const versions = [];
      // SYNC-MERGE-A (Hive #5), final review (M1): an existing marker is
      // rotated before seeding and the seed uses the fresh value, so a copied
      // plugin store (same marker on two devices) can never share a salt.
      // SYNC-NO-LOSS (Hive #14, F1): every empty-store seed is salted. Core's
      // own wipe (restore, epoch change) deletes the marker with the rest, so
      // "no marker" cannot tell a first upgrade from a restored workspace, and
      // a "c" seed after a restore can match one deep in a peer's lineage.
      // Cost: a divergence before the first exchange takes the legacy path
      // (a copy) instead of a merge. The marker write stays for older code.
      const salt = randomVid();
      await store.setMany([["reseed", salt]]);
      for (const o of objects) {
        if (!storeable(o.id)) continue;
        const entry = seedEntry(objectHash(o), salt);
        lin.lin.set(o.id, { l: [entry], h: new Set([entry[0]]) });
        versions.push([o.id, entry, o]);
      }
      await writeLineage(lin, [...lin.lin.keys()], versions, [], true);
      // SYNC-MERGE-A (Hive #5), fix round 4 (R3-1): rotate the marker right
      // after every successful seeding, so any later seeding on this store is
      // salted with a never-used salt, whoever wiped lin: (lineageOff after a
      // store failure, a restore that keeps the plugin store, Task 9's resets).
      // lineageOff's own markReseed runs on the store that just failed, so it
      // is only a best-effort backup. A first upgrade has no marker yet and
      // still seeds "c" + vh.
      if (!lin.off) await markReseed(store);
    }
  } catch {
    await lineageOff(lin);
  }
  return lin;
}

/** SYNC-MERGE-A (Hive #5), fix round 1 (M6): same 80-code-point cap as mergeObject's notes. */
function shortTitle(title) {
  const shown = [...(title || "Untitled")];
  return shown.length > 80 ? `${shown.slice(0, 80).join("")}…` : shown.join("");
}

/** Pull one peer: decide per object (§3.3), apply, verify, write lineage, copies. */
export async function pullPeer(lin, io, peer) {
  const { validated, apply, deferredIds, bases, tables } = peer;
  const aware = !lin.off && validated.lineageV === 1;
  const rejected = validated.lineageRejected ?? new Set();
  const remoteLin = (R) => {
    // A list the peer sent but readLineage refused is not "implicitly a seed":
    // treating it as one could skip (check 3) or fast-forward past a real edit.
    if (!aware || !storeable(R.id) || rejected.has(R.id)) return null;
    const l = validated.lineage?.get(R.id) ?? [seedEntry(objectHash(R))];
    return l[0][1] === objectHash(R) ? l : null;
  };
  const legacy = [];
  const planned = []; // {object, vh, lin, held: [entry, object][], copy}
  const lineageOnly = [];
  const notes = [];
  const events = [];
  let merges = 0;
  // SYNC-NOTICE fix (Hive #16, F4): silent, unless the peer merged this
  // device's own published head and lost something of it on the way. A third
  // device that only carried that head is not the one whose edit lost.
  // SYNC-NOTICE fix round 2 (Hive #16, R2-1): "own" is the vid pushLineage minted here (`m`), not a
  // device name, which can be blank, shared or renamed.
  const receiptFor = (R, cur, head) => {
    if (!cur.m || cur.m !== head[0]) return [];
    const rc = validated.receipts?.get(R.id)?.find((x) => x[0] === head[0]);
    if (!rc) return [];
    const name = shortTitle(R.title);
    const said = rc[1].map((kind) => ({ kind, id: R.id, title: name }));
    if (rc[2]) said.push({ kind: "copy", id: R.id, title: name, copyId: copyId(R.id, rc[2]), mine: rc[3] });
    return said;
  };
  // SYNC-NOTICE fix round 2 (Hive #16, R2-3): a receipt's copy is told only if that copy exists here,
  // under its own current title.
  const tell = (said) => {
    for (const e of said ?? []) {
      if (!e.copyId) { events.push(e); continue; }
      const c = io.localById.get(e.copyId);
      if (c) events.push({ kind: "copy", id: e.id, title: e.title, copy: c.title, copyId: e.copyId, mine: e.mine });
    }
  };
  // SYNC-NOTICE fix round 2 (Hive #16, R2-2): a relay keeps the receipts it carries, or the loser that
  // pulls the relay first would never hear of them.
  const incoming = (id) => validated.receipts?.get(id) ?? [];

  for (const R of apply.objects) {
    const L = io.localById.get(R.id);
    const rlin = remoteLin(R);
    const cur = lin.lin.get(R.id);
    if (!rlin || (L && !cur)) { legacy.push(R); continue; }
    const vhR = objectHash(R);
    if (!L) { planned.push({ object: R, vh: vhR, lin: rlin, held: [[rlin[0], R]] }); continue; }       // 1
    const vhL = objectHash(L);
    const llin = cur.l;
    if (vhL === vhR) {                                                                                     // 2
      const h = llin[0][1] === vhL && byVid(llin[0][0], rlin[0][0]) < 0 ? llin[0] : rlin[0];
      // Only when it tells us something: a new head, or R's head unknown here.
      // A pure reorder is skipped: merged() of two lists read a round apart
      // is not a fixpoint (it re-cuts to 8), and two devices re-pushing
      // reordered lineage at each other never settle (§5).
      const write = h[0] !== llin[0][0] || !llin.some((e) => e[0] === rlin[0][0]);
      // SYNC-MERGE-A (Hive #5), fix round 1 (F-B): the adopted head is the
      // ancestor of the next divergence, so it must be held here. R's content
      // equals L's, so R is stored under h's vid.
      const hold = !cur.h.has(h[0]);
      // SYNC-NOTICE fix (Hive #16, F4): the peer's merge may equal this
      // device's text and still have dropped part of it (a copy, a placement).
      // Told the first time this device learns that merge's head.
      const said = llin.some((e) => e[0] === rlin[0][0]) ? [] : receiptFor(R, cur, llin[0]);
      if (write || hold) lineageOnly.push([R.id, write ? pin(h, merged(llin, rlin)) : llin, hold ? [h, R] : null, said]);
      continue;
    }
    // SYNC-MERGE-A (Hive #5), fix round 1 (F-C): a seed vid is "c" + content
    // hash, so a device that re-seeds (reset, restore, late upgrade) with
    // content that went back to an earlier state mints a vid that already
    // sits deep in a peer's lineage. Such a match proves nothing. A "c" seed
    // vid counts as ancestry proof in checks 3 and 4 only at position 0 of the
    // other side's lineage too; anywhere else the object takes the legacy path.
    // Fix round 4 (R3-2): a salted "r" re-seed is NOT restricted. Its salt is
    // used once per store (openLineage rotates the marker after seeding), so
    // the vid is unique and a deep match is real ancestry: treating it as
    // untrusted only sent stale or fast-forwardable R to the lossy legacy path.
    const cSeed = (e) => e[0] === "c" + e[1];
    const found = (list, e) => { const i = list.findIndex((x) => x[0] === e[0]); return i < 0 ? 0 : cSeed(e) && i > 0 ? -1 : 1; };
    const r3 = found(llin, rlin[0]);
    if (r3 < 0) { legacy.push(R); continue; }
    if (r3) continue;                                                                                      // 3
    const clean = vhL === llin[0][1];
    const r4 = clean ? found(rlin, llin[0]) : 0;
    if (r4 < 0) { legacy.push(R); continue; }
    if (r4) {                                                                                              // 4
      const object = R.updated_at > L.updated_at ? R : { ...R, updated_at: L.updated_at + 1 };
      planned.push({ object, vh: vhR, lin: pin(rlin[0], merged(rlin, llin)), held: [[rlin[0], R]], said: receiptFor(R, cur, llin[0]) });
      continue;
    }
    const top = clean ? null : [randomVid(), vhL, deviceLabel(io.deviceName), L.updated_at];               // 5
    const lfull = top ? [top, ...llin].slice(0, LINEAGE_MAX) : llin;
    const anc = ancestor(lfull, rlin);
    const base = anc && cur.h.has(anc[0]) ? await loadVersion(lin.store, R.id, anc) : null;
    const localNewer = L.updated_at !== R.updated_at ? L.updated_at > R.updated_at : vhL > vhR;
    const m = base && mergeObject(base, L, R, localNewer);
    if (!m) { legacy.push(R); continue; }
    const vhM = objectHash(m.object);
    const entry = [mergeVid(lfull[0][0], rlin[0][0], vhM), vhM, (localNewer ? lfull[0] : rlin[0])[2], m.object.updated_at];
    // R is held too: it arrived in full, and R's head is the likely ancestor
    // of the next divergence with that peer (case 18). Without it that
    // divergence takes the legacy path and makes a needless copy.
    const held = [[entry, m.object], [rlin[0], R]];
    if (top) held.push([top, L]);
    const copy = m.loser
      ? conflictCopy(R.id, m.loser === "L" ? L : R, m.loser === "L" ? lfull[0] : rlin[0], entry[3])
      : null;
    const name = shortTitle(m.object.title);
    // SYNC-NOTICE fix (Hive #16, F4): what R's device is told when it fast-forwards here.
    const theirs = mergeObject(base, R, L, !localNewer)?.events ?? [];
    const receipt = theirs.length || copy ? [rlin[0][0], theirs, copy ? (m.loser === "R" ? rlin[0] : lfull[0])[0] : "", m.loser === "R"] : null;
    // SYNC-NOTICE (Hive #11): told only once Core took the merge (a retry merges again).
    const said = m.events.map((kind) => ({ kind, id: R.id, title: name }));
    // SYNC-NOTICE fix (Hive #16, F3): the copy is told when Core took the copy
    // itself, which can happen on a cycle whose merged row goes to retry.
    if (copy) copy.descriptor = { originalId: R.id, copyId: copy.object.id, fields: m.fields };
    if (copy) copy.said = { kind: "copy", id: R.id, title: name, copy: copy.object.title, copyId: copy.object.id, mine: m.loser === "L" };
    planned.push({ object: m.object, vh: vhM, lin: [entry, ...merged(lfull, rlin)].slice(0, LINEAGE_MAX), held, copy, said, receipt });
    notes.push(...m.notes, `"${name}": edits from both devices merged${copy ? "; one clash kept as a conflict copy" : ""}.`);
    merges++;
  }

  const legacyPlan = planConflicts(legacy, io.localById, bases, tables, io.copyLabel);
  notes.push(...legacyPlan.notes);
  events.push(...legacyPlan.events);
  // SYNC-MERGE-A (Hive #5), fix round 1 (F-D/F-E): conflict copies ride in
  // the same apply as the merged rows. A second apply after the lineage write
  // could fail or be cut off, and the lineage would already say "merged", so
  // the copy would never be made again. copyId is fixed per (object, losing
  // vid), so making the same copy again on a retry is an idempotent upsert.
  const copies = planned.filter((p) => p.copy).map((p) => p.copy);
  const objects = [...planned.map((p) => p.object), ...copies.map((c) => c.object), ...legacyPlan.objects];
  // Hive #7: descriptors ride in the same Core transaction as their copies.
  const conflicts = copies.map(c => c.descriptor);
  for (const event of legacyPlan.events.filter(e => e.kind === "copy" && e.copyId)) {
    const loser = io.localById.get(event.id);
    const winner = legacyPlan.objects.find(o => o.id === event.id) ?? loser;
    if (loser && winner) {
      const fields = ["content", "title", "props", "parent_id", "type", "archived_at", "trashed_at"].filter(f => loser[f] !== winner[f]);
      conflicts.push({ originalId:event.id, copyId:event.copyId, fields:fields.length ? fields : ["content", "props"] });
    }
  }
  const incomingConflicts = readConflictDescriptors(apply);
  for (const descriptor of incomingConflicts) {
    conflicts.push(descriptor);
    // An unchanged copy still needs registering after an upgrade/relay.
    if (!objects.some(o => o.id === descriptor.copyId)) {
      const copy = io.localById.get(descriptor.copyId) ?? apply.objects.find(o => o.id === descriptor.copyId);
      if (copy) objects.push(copy);
    }
  }
  const before = new Map(objects.map((o) => [o.id, io.localById.get(o.id)]));
  // SYNC-NO-LOSS (Hive #14, F2): every decision above was made against
  // `localById`, an export taken before this apply. Core refuses (inside its
  // apply transaction) any row whose updated_at moved since -- the user saved
  // in between -- and that row is retried next cycle against the new text.
  const expected = Object.fromEntries(objects.map((o) => [o.id, before.get(o.id)?.updated_at ?? null]));
  const result = await io.apply({ objects, conflicts, relations: apply.relations, tombstones: apply.tombstones, relation_tombstones: apply.relationTombstones, expected });
  const stale = new Set(result.staleObjects ?? []);

  // Verify: Core's newest-wins may have kept a newer local row.
  const touched = new Set([...objects.map((o) => o.id), ...apply.tombstones.map((t) => t.object_id)]);
  const changed = objects.some((o) => { const l = before.get(o.id); return !l || objectHash(l) !== objectHash(o); }) || apply.tombstones.length;
  const after = changed ? await io.exportById(touched) : new Map(objects.map((o) => [o.id, io.localById.get(o.id) ?? o]));
  for (const id of touched) { const got = after.get(id); if (got) io.localById.set(id, got); else io.localById.delete(id); }

  const retryIds = new Set(stale);
  const ids = [];
  const versions = [];
  const purge = [...touched].filter((id) => !after.has(id) && lin.lin.has(id));
  // SYNC-MERGE-A (Hive #5), fix round 1 (F-A): versions that leave `h` here
  // are deleted, or nothing (not even the push's GC) would ever reach them.
  const orphans = [];
  const unhold = (id, prev, h) => { for (const vid of prev?.h ?? []) if (!h.has(vid)) orphans.push(`v:${id}:${vid}`); };
  for (const c of copies) {
    // Kept even when the merged row below goes to retry (F-E): the user may
    // have typed over the merge, and the retry merges that, not the loser.
    const got = after.get(c.object.id);
    // SYNC-NOTICE fix round 2 (Hive #16, R2-3): whether the copy exists, for the receipt below.
    c.ok = Boolean(got) && (lin.lin.has(c.object.id) || objectHash(got) === c.entry[1]);
    if (!got || objectHash(got) !== c.entry[1] || lin.lin.has(c.object.id)) continue;
    lin.lin.set(c.object.id, { l: [c.entry], h: new Set([c.entry[0]]) });
    ids.push(c.object.id);
    versions.push([c.object.id, c.entry, c.object]);
    events.push(c.said); // once: a copy already in the lineage was told when it was made
  }
  for (const p of planned) {
    const got = after.get(p.object.id);
    if (!got) continue;                                           // dropped on purpose
    if (objectHash(got) !== p.vh) { retryIds.add(p.object.id); continue; } // lost to a newer local edit
    tell(p.said);
    const prev = lin.lin.get(p.object.id);
    const h = new Set([...(prev?.h ?? [])].filter((vid) => p.lin.some((e) => e[0] === vid)));
    for (const [e] of p.held) h.add(e[0]);
    unhold(p.object.id, prev, h);
    const receipt = p.receipt && p.copy && !p.copy.ok ? (p.receipt[1].length ? [p.receipt[0], p.receipt[1], "", false] : null) : p.receipt;
    const r = keepReceipts(p.lin, [receipt], incoming(p.object.id), prev?.r ?? []);
    lin.lin.set(p.object.id, r.length ? { l: p.lin, h, r } : { l: p.lin, h });
    ids.push(p.object.id);
    for (const [e, o] of p.held) versions.push([p.object.id, e, o]);
  }
  if (!lin.off) {
    for (const [id, next, hold, said] of lineageOnly) {
      tell(said);
      const rec = lin.lin.get(id);
      rec.l = next;
      const r = keepReceipts(next, rec.r ?? [], incoming(id));
      if (r.length) rec.r = r; else delete rec.r;
      if (hold) { rec.h.add(hold[0][0]); versions.push([id, hold[0], hold[1]]); }
      ids.push(id);
    }
    // Lineage after a legacy apply (§3.5). Only when Core took what was
    // planned: a row the user typed during the cycle is a local edit, and
    // must reach the push as one (a new vid), never as a seed.
    const legacyHash = new Map(legacyPlan.objects.map((o) => [o.id, objectHash(o)]));
    for (const R of legacy) {
      const got = after.get(R.id);
      const prior = before.get(R.id);
      if (!got || !storeable(R.id) || (prior && objectHash(prior) === objectHash(got))) continue;
      const vh = objectHash(got);
      if (legacyHash.get(R.id) !== vh) continue;
      const rlin = remoteLin(R);
      const l = rlin && vh === rlin[0][1] ? pin(rlin[0], rlin) : [seedEntry(vh)];
      const h = new Set([l[0][0]]);
      unhold(R.id, lin.lin.get(R.id), h);
      lin.lin.set(R.id, { l, h });
      ids.push(R.id);
      versions.push([R.id, l[0], got]);
    }
    await writeLineage(lin, ids, versions, purge, false, orphans);
  }
  return {
    applied: result.appliedObjects,
    notes,
    events: events.map((e) => ({ ...e, device: validated.deviceName || "" })),
    conflicts: legacyPlan.conflicts + copies.length,
    merged: merges,
    retry: retryIds.size > 0,
    next: nextBases(validated.objects, bases, tables, new Set([...deferredIds, ...retryIds])),
  };
}

/** Advance lineage for local edits and return the snapshot fields. */
export async function pushLineage(lin, objects, deviceName) {
  if (lin.off) return {};
  const by = deviceLabel(deviceName);
  const ids = [];
  const versions = [];
  const live = new Set();
  for (const o of objects) {
    if (!storeable(o.id)) continue;
    live.add(o.id);
    const vh = objectHash(o);
    const rec = lin.lin.get(o.id);
    if (rec && rec.l[0][1] === vh) continue;
    const entry = [randomVid(), vh, by, o.updated_at];
    const l = [entry, ...(rec?.l ?? [])].slice(0, LINEAGE_MAX);
    const r = keepReceipts(l, rec?.r ?? []);
    lin.lin.set(o.id, { l, h: new Set([...(rec?.h ?? []), entry[0]]), ...(r.length ? { r } : {}), m: entry[0] });
    ids.push(o.id);
    versions.push([o.id, entry, o]);
  }
  const purge = [...lin.lin.keys()].filter((id) => !live.has(id));
  await writeLineage(lin, ids, versions, purge, true);
  if (lin.off) return {};
  const devices = [""];
  const index = new Map([["", 0]]);
  const at = (name) => {
    if (!index.has(name)) { if (devices.length === 64) return 0; index.set(name, devices.push(name) - 1); }
    return index.get(name);
  };
  const lineage = {};
  const receipts = {};
  let sent = 0;
  for (const o of objects) {
    const rec = lin.lin.get(o.id);
    if (rec && !isSeedOnly(rec.l)) lineage[o.id] = rec.l.map(([vid, vh, name, t]) => [vid, vh, at(deviceLabel(name)), t]);
    const r = rec ? keepReceipts(rec.l, rec.r ?? []) : [];
    // SYNC-NOTICE fix round 2 (Hive #16, R2-5): the same cap readLineage applies, so nothing is cut unseen.
    if (r.length && sent++ < LIMIT_RECEIPT_IDS) receipts[o.id] = r;
  }
  return { lineageV: 1, devices, lineage, ...(Object.keys(receipts).length ? { receipts } : {}) };
}

// ---------------------------------------------------------------- notices
// SYNC-NOTICE (Hive #11): one notice per sync cycle, never one per note.
// Whole sentences, so a translator controls the word order.
/** Core cuts a notice at 300 characters; a combined one stays under it. */
const NOTICE_CAP = 300;
const NOTICE = {
  restored: tr("Sync brought back '{title}': it was edited on {device} after you deleted it."),
  "kept-edit": tr("Sync kept your edit to '{title}': it had been deleted on {device}."),
  "edit-in-trash": tr("Sync kept your edit to '{title}', but {device} moved it to the trash."),
  moved: tr("'{title}' was moved on {device} too; that placement was kept."),
  archived: tr("'{title}' was archived or unarchived on {device} too; that change was kept."),
  copy: tr("'{title}' was changed on {device} too, so Sync kept your version as '{copy}'."),
  theirs: tr("'{title}' was changed on {device} too, so Sync kept that version as '{copy}'."),
};
// SYNC-NOTICE fix round 2 (Hive #20): several copies of one note from one device are one sentence.
const NOTICE_MANY = {
  copy: tr("'{title}' was changed on {device} too, so Sync kept your versions as {count} conflict copies, such as '{copy}'."),
  theirs: tr("'{title}' was changed on {device} too, so Sync kept those versions as {count} conflict copies, such as '{copy}'."),
};

/** One notice for a cycle's merge events: { message, id, left } (id: the note to open, or null;
 * left: the events that did not fit, to tell next time), or null. */
export function mergeNotice(events, t) {
  // SYNC-NOTICE fix round 3 (Hive #20): budgets are UTF-16 units, as Core's .slice(0, 300)
  // counts them, and a cut never splits a surrogate pair.
  const cut = (s, n) => {
    const str = String(s || "Untitled");
    if (str.length <= n) return str;
    let out = "";
    for (const ch of str) { if (out.length + ch.length > n) break; out += ch; }
    return `${out}…`;
  };
  const fit = (s) => (s.length <= NOTICE_CAP ? s : cut(s, NOTICE_CAP - 1));
  // SYNC-NOTICE fix (Hive #16, F5): every distinct outcome per note is kept,
  // and a conflict copy's name is never the one dropped.
  const byId = new Map();
  for (const e of events ?? []) {
    if (!NOTICE[e.kind]) continue;
    const kind = e.kind === "copy" && !e.mine ? "theirs" : e.kind;
    // SYNC-NOTICE fix (Hive #20): copies are told apart by id; two made within
    // one minute share a title.
    const key = e.copy ? `${kind}|${e.copyId ?? e.copy}` : kind;
    if (!byId.has(e.id)) byId.set(e.id, new Map());
    if (!byId.get(e.id).has(key)) byId.get(e.id).set(key, { ...e, kind, src: [] });
    byId.get(e.id).get(key).src.push(e);
  }
  const copyFirst = (list) => [...list].sort((a, b) => Number(Boolean(b.copy)) - Number(Boolean(a.copy)));
  if (!byId.size) return null;
  if (byId.size === 1) {
    const [[id, outcomes]] = byId;
    // Round 2 (Hive #20): copies of this note from one device fold into one counted sentence,
    // and a sentence that does not fit is left for the next notice, never dropped.
    const folded = new Map();
    for (const e of outcomes.values()) {
      const key = e.copy ? `${e.kind}|${e.device ?? ""}` : `${e.kind}|${e.copyId ?? ""}`;
      const had = folded.get(key);
      if (had) { had.count = (had.count ?? 1) + 1; had.src = [...had.src, ...e.src]; had.names.add(e.copy); } else folded.set(key, { ...e, names: new Set([e.copy]) });
    }
    const several = folded.size > 1;
    let message = "";
    const left = [];
    for (const e of copyFirst(folded.values())) {
      const device = e.device ? cut(e.device, 40) : t("another device");
      // Up to two distinct copy names; same-named copies are said once, with the count.
      const copy = e.count ? [...e.names].slice(0, 2).map((n) => cut(n, e.names.size > 1 ? 45 : several ? 70 : 100)).join("', '") : cut(e.copy, several ? 70 : 100);
      const line = t(e.count ? NOTICE_MANY[e.kind] : NOTICE[e.kind], { title: cut(e.title, several ? 40 : 60), device, copy, count: e.count });
      if (!message) message = fit(line);
      else if (message.length + 1 + line.length <= NOTICE_CAP) message += ` ${line}`;
      else left.push(...e.src);
    }
    return { message, id, left };
  }
  const notes = [...byId.values()].map((outcomes) => [...outcomes.values()]);
  const copies = notes.flat().filter((e) => e.copy);
  const names = notes.slice(0, 3).map((list) => `'${cut(list[0].title, copies.length ? 30 : 40)}'`).join(", ");
  let message = notes.length > 3
    ? t("Sync merged conflicting changes in {count} notes: {names} and {more} more.", { count: notes.length, names, more: notes.length - 3 })
    : t("Sync merged conflicting changes in {count} notes: {names}.", { count: notes.length, names });
  if (copies.length) {
    const shown = copies.slice(0, 2).map((e) => `'${cut(e.copy, 30)}'`).join(", ");
    message += " " + (copies.length > 2
      ? t("Conflict copies kept: {copies} and {more} more.", { copies: shown, more: copies.length - 2 })
      : t("Conflict copies kept: {copies}.", { copies: shown }));
  }
  return { message: fit(message), id: null, left: [] };
}

// Hive #7: optional, bounded and independent of note validation. No title inference.
export function readConflictDescriptors(snapshot) {
  const included = new Set((snapshot.objects ?? []).map(o => o.id)), seen = new Set();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const fields = ["content", "title", "props", "parent_id", "type", "archived_at", "trashed_at"];
  return (Array.isArray(snapshot.conflicts) ? snapshot.conflicts : []).slice(0,included.size).filter(d => {
    if (!d || Object.keys(d).some(k => !["originalId","copyId","fields"].includes(k)) || !uuid.test(d.originalId) || !uuid.test(d.copyId)
      || d.originalId === d.copyId || !included.has(d.copyId) || seen.has(d.copyId)
      || !Array.isArray(d.fields) || !d.fields.length || d.fields.length > fields.length || d.fields.some(f=>!fields.includes(f))) return false;
    seen.add(d.copyId); return true;
  }).map(d=>({originalId:d.originalId,copyId:d.copyId,fields:[...new Set(d.fields)].sort()}));
}
