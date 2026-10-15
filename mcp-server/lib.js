// Query layer + TipTap-to-text conversion for the Notible MCP server.
// Kept separate from index.js so it can be unit-tested without starting the server.

import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';

const FINANCE_TYPES = new Set(['financial_entry', 'time_entry', 'vendor']);

/**
 * MCP-SETTINGS (Hive #29): the user's switches in Settings → MCP server, read
 * from the app's device-local `mcp_settings` table on every call, so a change
 * applies without restarting the client. Defaults match the behaviour before
 * the switches existed (edits on, finance off). The env vars come from the
 * client's config, so they can only narrow: `NOTIBLE_MCP_APPROVAL_MODE=propose-only`
 * turns edits off (the in-app AI always sets it), `NOTIBLE_INCLUDE_FINANCE=0`
 * hides finance. Nothing here writes the table.
 */
export function mcpSettings(db, env = process.env) {
  const stored = (key) => {
    try { return db.prepare('SELECT value FROM mcp_settings WHERE key = ?').get(key)?.value ?? null; }
    catch (err) {
      // Table not created yet (app not opened since the update): defaults. Any
      // other error fails the call, so a busy DB never turns edits back on.
      if (/no such table/.test(err.message)) return null;
      throw err;
    }
  };
  const edits = stored('allow_edits');
  return {
    allowEdits: (edits ?? '1') === '1' && env.NOTIBLE_MCP_APPROVAL_MODE !== 'propose-only',
    includeFinance: stored('include_finance') === '1' && env.NOTIBLE_INCLUDE_FINANCE !== '0',
  };
}

const includeFinance = (db) => mcpSettings(db).includeFinance;

function assertEditsAllowed(db) {
  if (!mcpSettings(db).allowEdits) throw new Error('Edits through MCP are turned off in Notible (Settings → MCP server → Allow edits). Use propose_object_update and let the user make the change.');
}

// ---------------------------------------------------------------------------
// TipTap JSON -> plain text / markdown-ish conversion
// ---------------------------------------------------------------------------

function inlineText(node) {
  if (!node) return '';
  if (node.type === 'text') {
    let t = node.text ?? '';
    const marks = (node.marks ?? []).map((m) => m.type);
    if (marks.includes('code')) t = '`' + t + '`';
    if (marks.includes('bold')) t = '**' + t + '**';
    if (marks.includes('italic')) t = '*' + t + '*';
    const link = (node.marks ?? []).find((m) => m.type === 'link');
    if (link?.attrs?.href) t = `[${t}](${link.attrs.href})`;
    return t;
  }
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return '@' + (node.attrs?.label ?? node.attrs?.id ?? '');
  if (Array.isArray(node.content)) return node.content.map(inlineText).join('');
  return '';
}

function renderNode(node, ctx = { indent: 0, listType: null, index: 0 }) {
  if (!node || typeof node !== 'object') return '';
  const pad = '  '.repeat(ctx.indent);
  const children = Array.isArray(node.content) ? node.content : [];

  switch (node.type) {
    case 'doc':
      // Same as the app's textFromDocument: one paragraph per line, empties kept,
      // so read → edit → write round-trips without doubling blank lines.
      return children.map((c) => renderNode(c, ctx)).join('\n');
    case 'paragraph':
      return pad + inlineText(node);
    case 'heading': {
      const level = node.attrs?.level ?? 1;
      return '#'.repeat(Math.min(level, 6)) + ' ' + inlineText(node);
    }
    case 'bulletList':
      return children
        .map((li) => renderNode(li, { ...ctx, listType: 'bullet' }))
        .join('\n');
    case 'orderedList':
      return children
        .map((li, i) => renderNode(li, { ...ctx, listType: 'ordered', index: i + 1 }))
        .join('\n');
    case 'taskList':
      return children
        .map((li) => renderNode(li, { ...ctx, listType: 'task' }))
        .join('\n');
    case 'listItem':
    case 'taskItem': {
      let marker = '- ';
      if (ctx.listType === 'ordered') marker = `${ctx.index}. `;
      if (node.type === 'taskItem' || ctx.listType === 'task') {
        marker = node.attrs?.checked ? '- [x] ' : '- [ ] ';
      }
      const inner = children
        .map((c, i) => {
          const rendered = renderNode(c, { ...ctx, indent: 0 });
          return rendered;
        })
        .filter(Boolean)
        .join('\n' + pad + '  ');
      return pad + marker + inner.trimStart();
    }
    case 'codeBlock': {
      const lang = node.attrs?.language ?? '';
      return '```' + lang + '\n' + inlineText(node) + '\n```';
    }
    case 'blockquote':
      return children
        .map((c) => renderNode(c, ctx))
        .join('\n')
        .split('\n')
        .map((l) => '> ' + l)
        .join('\n');
    case 'horizontalRule':
      return '---';
    case 'image':
      return `![${node.attrs?.alt ?? ''}](${node.attrs?.src ?? ''})`;
    case 'table': {
      const rows = children.map((row) =>
        (row.content ?? [])
          .map((cell) =>
            (cell.content ?? []).map((c) => renderNode(c, ctx)).join(' ').trim()
          )
          .join(' | ')
      );
      if (rows.length === 0) return '';
      const out = ['| ' + rows[0] + ' |'];
      const cols = (children[0]?.content ?? []).length;
      out.push('|' + ' --- |'.repeat(Math.max(cols, 1)));
      for (const r of rows.slice(1)) out.push('| ' + r + ' |');
      return out.join('\n');
    }
    default:
      // Unknown block: try inline text, then recurse.
      if (children.length) {
        return children.map((c) => renderNode(c, ctx)).filter(Boolean).join('\n');
      }
      return inlineText(node);
  }
}

/**
 * Convert a stored `content` value (TipTap JSON string) to readable text.
 * Falls back to returning the raw string if it is not valid TipTap JSON.
 */
export function tiptapToText(content) {
  if (content == null || content === '') return '';
  let doc = content;
  if (typeof content === 'string') {
    try {
      doc = JSON.parse(content);
    } catch {
      return content; // not JSON -> return raw text as-is
    }
  }
  if (!doc || typeof doc !== 'object') return String(content);
  try {
    return renderNode(doc).trimEnd();
  } catch {
    return typeof content === 'string' ? content : JSON.stringify(content);
  }
}

// ---------------------------------------------------------------------------
// Query layer
// ---------------------------------------------------------------------------

export function openDb(dbPath, { readonly = true } = {}) {
  const db = new Database(dbPath, { readonly, fileMustExist: true });
  if (!readonly) db.pragma('busy_timeout = 5000');
  return db;
}

const MCP_EDITABLE_TYPES = new Set(['task', 'issue', 'note', 'todo', 'ticket', 'knowledge_article', 'bookmark']);
const MCP_CREATABLE_TYPES = new Set(['task', 'issue', 'note']);

function assertEditable(row) {
  if (!row) throw new Error('Object not found.');
  if (FINANCE_TYPES.has(row.type)) throw new Error('Finance objects are private and cannot be changed through MCP.');
  if (!MCP_EDITABLE_TYPES.has(row.type)) throw new Error(`Objects of type "${row.type}" cannot be changed through MCP.`);
  if (row.trashed_at != null) throw new Error('Trashed objects cannot be changed through MCP.');
}

function cleanPropsPatch(patch) {
  if (patch == null) return null;
  if (typeof patch !== 'object' || Array.isArray(patch)) throw new Error('propsPatch must be an object.');
  for (const key of Object.keys(patch)) {
    if (key.startsWith('_')) throw new Error(`Protected property "${key}" cannot be changed through MCP.`);
  }
  return patch;
}

/** Markdown → the app's stored shape (src/core/app/coreDocument.ts documentFromText). */
export function documentFromText(text) {
  const content = String(text).split('\n').map((line) => (line
    ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
    : { type: 'paragraph' }));
  return JSON.stringify({ type: 'doc', content });
}

/**
 * MCP-CLEANUP (Hive #22): `_` properties are app-owned (e.g. `_protected`).
 * Every MCP write keeps the row's current ones and drops any in `nextProps`,
 * so neither an edit nor an undo of one can remove a protection the user set.
 */
export function keepAppOwnedProps(currentProps, nextProps) {
  const parse = (raw) => {
    const value = parseJsonSafe(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  };
  const merged = Object.fromEntries(Object.entries(parse(nextProps)).filter(([key]) => !key.startsWith('_')));
  for (const [key, value] of Object.entries(parse(currentProps))) if (key.startsWith('_')) merged[key] = value;
  return JSON.stringify(merged);
}

function snapshot(row) {
  return { title: row.title ?? '', content: row.content ?? '', props: row.props ?? '{}' };
}

function historyAvailable(db) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='history'").get());
}

/** Build a side-effect-free update proposal. The caller must explicitly apply it. */
export function proposeObjectUpdate(db, { id, title, content, propsPatch, expectedUpdatedAt }) {
  const row = db.prepare('SELECT * FROM objects WHERE id = ?').get(id);
  assertEditable(row);
  if (expectedUpdatedAt != null && String(row.updated_at) !== String(expectedUpdatedAt)) {
    throw new Error('Conflict: the object changed since it was read. Fetch it again before proposing changes.');
  }
  const beforeProps = parseJsonSafe(row.props) ?? {};
  const patch = cleanPropsPatch(propsPatch);
  const afterProps = patch ? { ...beforeProps, ...patch } : beforeProps;
  for (const [key, value] of Object.entries(afterProps)) if (value === null) delete afterProps[key];
  const before = snapshot(row);
  const after = {
    title: title === undefined ? before.title : String(title).trim(),
    content: content === undefined ? before.content : documentFromText(content),
    props: JSON.stringify(afterProps),
  };
  if (!after.title) throw new Error('Title cannot be empty.');
  const changes = Object.keys(after).filter((key) => after[key] !== before[key]);
  if (changes.length === 0) throw new Error('The proposal does not change anything.');
  return { objectId: row.id, objectType: row.type, expectedUpdatedAt: row.updated_at, before, after, changes };
}

/** Apply a previously returned proposal with optimistic locking and history. */
export function applyObjectUpdate(db, proposal) {
  assertEditsAllowed(db);
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM objects WHERE id = ?').get(proposal.objectId);
    assertEditable(row);
    if (String(row.updated_at) !== String(proposal.expectedUpdatedAt)) {
      throw new Error('Conflict: the object changed after the proposal was prepared. Nothing was written.');
    }
    let historyId = null;
    if (historyAvailable(db)) {
      const result = db.prepare('INSERT INTO history (object_id, ts, patch) VALUES (?, ?, ?)')
        .run(row.id, Date.now(), JSON.stringify(snapshot(row)));
      historyId = Number(result.lastInsertRowid);
    }
    const updatedAt = Date.now();
    db.prepare('UPDATE objects SET title = ?, content = ?, props = ?, updated_at = ? WHERE id = ?')
      .run(proposal.after.title, proposal.after.content, keepAppOwnedProps(row.props, proposal.after.props), updatedAt, row.id);
    return { ...getNote(db, row.id), historyId };
  })();
}

export function createObjectViaMcp(db, { type, title, content = '', props = {}, parentId }) {
  assertEditsAllowed(db);
  if (!MCP_CREATABLE_TYPES.has(type)) throw new Error(`Type "${type}" cannot be created through MCP.`);
  const cleanTitle = String(title ?? '').trim();
  if (!cleanTitle) throw new Error('Title cannot be empty.');
  cleanPropsPatch(props);
  return db.transaction(() => {
    if (parentId) {
      const parent = db.prepare('SELECT id, type FROM objects WHERE id = ? AND trashed_at IS NULL').get(parentId);
      if (!parent || parent.type !== 'project') throw new Error('parentId must reference an active project.');
    }
    const id = randomUUID();
    const now = Date.now();
    db.prepare(`INSERT INTO objects (id,type,title,content,props,created_at,updated_at,archived_at,trashed_at)
                VALUES (?,?,?,?,?,?,?,NULL,NULL)`)
      .run(id, type, cleanTitle, documentFromText(content), JSON.stringify(props), now, now);
    if (parentId) db.prepare('INSERT INTO relations (from_id,to_id,kind) VALUES (?,?,?)').run(id, parentId, 'in');
    return getNote(db, id);
  })();
}

export function restoreMcpChange(db, { objectId, historyId, expectedUpdatedAt }) {
  assertEditsAllowed(db);
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM objects WHERE id = ?').get(objectId);
    assertEditable(row);
    if (expectedUpdatedAt != null && String(row.updated_at) !== String(expectedUpdatedAt)) {
      throw new Error('Conflict: the object changed after the MCP update. Nothing was restored.');
    }
    if (!historyAvailable(db)) throw new Error('History is not available in this database.');
    const entry = db.prepare('SELECT patch FROM history WHERE id = ? AND object_id = ?').get(historyId, objectId);
    if (!entry) throw new Error('History entry not found.');
    const previous = JSON.parse(entry.patch);
    db.prepare('INSERT INTO history (object_id, ts, patch) VALUES (?, ?, ?)')
      .run(objectId, Date.now(), JSON.stringify(snapshot(row)));
    db.prepare('UPDATE objects SET title=?, content=?, props=?, updated_at=? WHERE id=?')
      .run(previous.title, previous.content, keepAppOwnedProps(row.props, previous.props), Date.now(), objectId);
    return getNote(db, objectId);
  })();
}

// ---------------------------------------------------------------------------
// MCP-CLEANUP (Hive #13): AI-proposed move-to-trash, approved in the app.
// This side can only preview and submit. Approving and trashing happen in
// Notible (src-tauri/src/mcp_cleanup.rs) behind a native confirm; there is
// deliberately no approve, apply, purge or empty-trash function here.
// ---------------------------------------------------------------------------

export const CLEANUP_MAX_ITEMS = 20;
export const CLEANUP_REQUEST_TTL_MS = 15 * 60_000;
export const CLEANUP_HEARTBEAT_STALE_MS = 25_000;
export const CLEANUP_MAX_PER_HOUR = 5;
export const CLEANUP_REASON_MAX = 1000;

/** Same as `fingerprint_of` in mcp_cleanup.rs: length-prefixed fields, sha256. */
export function fingerprintOf(fields) {
  const hash = createHash('sha256');
  for (const field of fields) {
    if (field == null) hash.update('N');
    else {
      const text = String(field);
      hash.update(`S${Buffer.byteLength(text)}:`);
      hash.update(text);
    }
  }
  return hash.digest('hex');
}

export function noteFingerprint(db, id) {
  const row = db.prepare('SELECT id, type, title, content, props, updated_at, archived_at, trashed_at FROM objects WHERE id = ?').get(id);
  if (!row) return null;
  const parents = db.prepare("SELECT to_id FROM relations WHERE from_id = ? AND kind = 'in'").all(id).map((r) => r.to_id).sort();
  return fingerprintOf([row.id, row.type, row.title, row.content, row.props, row.updated_at, row.archived_at, row.trashed_at, parents.join(',')]);
}

function cleanupTablesExist(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('mcp_cleanup_session','mcp_cleanup_scopes','mcp_cleanup_requests')").get().n === 3;
}

/** The running app's session, or null when Notible is closed (stale heartbeat). */
function liveSession(db, now) {
  if (!cleanupTablesExist(db)) return null;
  const row = db.prepare('SELECT session_id, heartbeat_at, favourite_id FROM mcp_cleanup_session WHERE id = 1').get();
  return row && now - Number(row.heartbeat_at) <= CLEANUP_HEARTBEAT_STALE_MS ? row : null;
}

function parentOf(db, id) {
  return db.prepare("SELECT to_id FROM relations WHERE from_id = ? AND kind = 'in' LIMIT 1").get(id)?.to_id ?? null;
}

function pathOf(db, id) {
  const titles = [];
  const seen = new Set([id]);
  for (let current = parentOf(db, id); current && !seen.has(current) && titles.length < 64; current = parentOf(db, current)) {
    seen.add(current);
    titles.unshift(db.prepare('SELECT title FROM objects WHERE id = ?').get(current)?.title ?? '?');
  }
  return titles.join(' / ');
}

function scopeEnabled(db, scopeId) {
  return cleanupTablesExist(db) && Boolean(db.prepare('SELECT 1 FROM mcp_cleanup_scopes WHERE scope_id = ?').get(scopeId));
}

function inScope(db, id, scopeId) {
  if (scopeId === 'workspace') return true;
  const seen = new Set([id]);
  for (let current = parentOf(db, id); current && !seen.has(current) && seen.size <= 64; current = parentOf(db, current)) {
    if (current === scopeId) return true;
    seen.add(current);
  }
  return false;
}

function cleanIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Give between 1 and 20 note ids.');
  const unique = [...new Set(ids.map(String))];
  if (unique.length > CLEANUP_MAX_ITEMS) throw new Error(`At most ${CLEANUP_MAX_ITEMS} notes per request. Split the cleanup; each batch is reviewed separately.`);
  return unique;
}

/** Why one note cannot be part of a cleanup, or null. Mirrors `item_problem` in Rust. */
function exclusion(db, row, scopeId, session) {
  if (!row) return 'not found';
  if (row.type !== 'note') return 'not a note (only notes can be cleaned up)';
  if (row.trashed_at != null || row.archived_at != null) return 'already trashed or archived';
  // Unreadable props mean unknown protection, which fails closed (same in Rust).
  let props;
  try { props = JSON.parse(row.props ?? ''); } catch { props = null; }
  if (!props || typeof props !== 'object' || Array.isArray(props)) return 'protected';
  if ('_protected' in props && props._protected !== false) return 'protected';
  if (session?.favourite_id === row.id) return 'protected (opens on start)';
  if (db.prepare("SELECT 1 FROM relations WHERE to_id = ? AND kind = 'in' LIMIT 1").get(row.id)) return 'contains other items';
  if (!scopeEnabled(db, scopeId)) return 'the user has not allowed AI cleanup in this scope';
  if (!inScope(db, row.id, scopeId)) return 'outside the requested scope';
  return null;
}

/**
 * Read-only: what a cleanup of these exact ids would contain. No queries or
 * wildcards. With the app closed, the startup favourite cannot be checked,
 * so protection reads "unknown" (and submitting fails anyway).
 */
export function previewTrashNotes(db, { ids, scopeId = 'workspace' }, now = Date.now()) {
  const unique = cleanIds(ids);
  const session = liveSession(db, now);
  const items = unique.map((id) => {
    const row = db.prepare('SELECT * FROM objects WHERE id = ?').get(id);
    const excluded = exclusion(db, row, scopeId, session);
    return {
      id,
      title: row?.title ?? null,
      path: row ? pathOf(db, id) : null,
      version: row ? noteFingerprint(db, id) : null,
      incomingLinks: row ? db.prepare("SELECT COUNT(*) AS n FROM relations WHERE to_id = ? AND kind != 'in'").get(id).n : 0,
      protection: excluded?.startsWith('protected') ? 'protected' : session ? 'none' : 'unknown',
      eligible: excluded == null,
      ...(excluded ? { excluded } : {}),
    };
  });
  return { scopeId, appRunning: Boolean(session), items };
}

/**
 * Submit a preview to the running app for the user to review. Returns the
 * request id; nothing is trashed here or ever by this server. Limits: one
 * pending request per workspace, five per hour across every MCP client.
 */
export function requestTrashNotes(db, { preview, reason, client = '' }, now = Date.now()) {
  const text = String(reason ?? '').trim();
  if (!text) throw new Error('Give a short reason the user can read.');
  if (text.length > CLEANUP_REASON_MAX) throw new Error(`The reason is limited to ${CLEANUP_REASON_MAX} characters.`);
  return db.transaction(() => {
    const session = liveSession(db, now);
    if (!session) throw Object.assign(new Error('app_not_running: Notible is closed. Nothing was queued; ask the user to open Notible and try again.'), { code: 'app_not_running' });
    const pending = db.prepare("SELECT COUNT(*) AS n FROM mcp_cleanup_requests WHERE status = 'pending' AND session_id = ? AND expires_at > ?").get(session.session_id, now).n;
    if (pending > 0) throw new Error('pending_exists: a cleanup request is already waiting for the user. Wait until it is decided.');
    const recent = db.prepare('SELECT COUNT(*) AS n FROM mcp_cleanup_requests WHERE created_at > ?').get(now - 3_600_000).n;
    if (recent >= CLEANUP_MAX_PER_HOUR) throw new Error(`rate_limited: at most ${CLEANUP_MAX_PER_HOUR} cleanup requests per hour.`);
    // Fresh checks: the preview is only a promise about the moment it was made.
    const items = [];
    for (const item of preview.items.filter((entry) => entry.eligible).slice(0, CLEANUP_MAX_ITEMS)) {
      const row = db.prepare('SELECT * FROM objects WHERE id = ?').get(item.id);
      const excluded = exclusion(db, row, preview.scopeId, session);
      if (excluded) throw new Error(`"${item.title}" can no longer be included (${excluded}). Preview again.`);
      if (noteFingerprint(db, item.id) !== item.version) throw new Error(`"${item.title}" changed since the preview. Preview again.`);
      items.push({ id: item.id, title: item.title, version: item.version });
    }
    if (items.length === 0) throw new Error('None of the previewed notes can be cleaned up.');
    const id = randomUUID();
    db.prepare(`INSERT INTO mcp_cleanup_requests (id, session_id, client, reason, scope_id, items, status, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(id, session.session_id, String(client).slice(0, 100), text, preview.scopeId, JSON.stringify(items), now, now + CLEANUP_REQUEST_TTL_MS);
    return { requestId: id, status: 'pending', items: items.length, expiresAt: new Date(now + CLEANUP_REQUEST_TTL_MS).toISOString(),
      next: 'The user reviews each note in Notible (Settings → MCP server). Check get_trash_request_status later.' };
  }).immediate();
}

/** Read-only status: pending, rejected, expired, conflict or applied. */
export function trashRequestStatus(db, { requestId }, now = Date.now()) {
  if (!cleanupTablesExist(db)) throw new Error('Request not found.');
  const row = db.prepare('SELECT id, status, created_at, expires_at, decided_at, detail, session_id FROM mcp_cleanup_requests WHERE id = ?').get(requestId);
  if (!row) throw new Error('Request not found.');
  let status = row.status;
  if (status === 'pending' && (row.expires_at <= now || liveSession(db, now)?.session_id !== row.session_id)) status = 'expired';
  return { requestId: row.id, status, createdAt: row.created_at, decidedAt: row.decided_at ?? null, detail: status === 'applied' ? null : row.detail ?? null };
}

/** Escape user input for an FTS5 MATCH by quoting each token. */
function ftsQuery(query) {
  const tokens = String(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => '"' + t.replace(/"/g, '""') + '"').join(' ');
}

function parseJsonSafe(s) {
  if (s == null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export function searchNotes(db, { query, type, limit = 20 }) {
  const sql = `
    SELECT o.id, o.type, o.title,
           snippet(objects_fts, 1, '>>', '<<', ' ... ', 20) AS snippet,
           o.updated_at
    FROM objects_fts f
    JOIN objects o ON o.rowid = f.rowid
    WHERE objects_fts MATCH ?
      AND o.trashed_at IS NULL
      AND o.archived_at IS NULL
      ${includeFinance(db) ? '' : "AND o.type NOT IN ('financial_entry','time_entry','vendor')"}
      ${type ? 'AND o.type = ?' : ''}
    ORDER BY rank
    LIMIT ?`;
  const params = type ? [ftsQuery(query), type, limit] : [ftsQuery(query), limit];
  return db.prepare(sql).all(...params);
}

export function listNotes(db, { type, limit = 50 } = {}) {
  const sql = `
    SELECT id, type, title, created_at, updated_at
    FROM objects
    WHERE trashed_at IS NULL AND archived_at IS NULL
      ${includeFinance(db) ? '' : "AND type NOT IN ('financial_entry','time_entry','vendor')"}
      ${type ? 'AND type = ?' : ''}
    ORDER BY updated_at DESC
    LIMIT ?`;
  return type ? db.prepare(sql).all(type, limit) : db.prepare(sql).all(limit);
}

export function getNote(db, id) {
  const row = db.prepare('SELECT * FROM objects WHERE id = ?').get(id);
  if (!row) return null;
  if (!includeFinance(db) && FINANCE_TYPES.has(row.type)) return null;

  // MCP-SETTINGS (Hive #29, Codex review): a hidden object must not leak
  // through a readable note's relations either, in or out. A relation whose
  // other end no longer exists (type NULL) stays, as before.
  const hidden = includeFinance(db) ? '' : "AND (o.type IS NULL OR o.type NOT IN ('financial_entry','time_entry','vendor'))";
  const relationsOut = db
    .prepare(
      `SELECT r.kind, r.to_id AS id, o.title, o.type
       FROM relations r LEFT JOIN objects o ON o.id = r.to_id
       WHERE r.from_id = ? ${hidden}`
    )
    .all(id);
  const relationsIn = db
    .prepare(
      `SELECT r.kind, r.from_id AS id, o.title, o.type
       FROM relations r LEFT JOIN objects o ON o.id = r.from_id
       WHERE r.to_id = ? ${hidden}`
    )
    .all(id);

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    text: tiptapToText(row.content),
    props: parseJsonSafe(row.props),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
    trashed_at: row.trashed_at,
    relations: { outgoing: relationsOut, incoming: relationsIn },
  };
}

export function listTypes(db) {
  return db
    .prepare(
      `SELECT type, COUNT(*) AS count
       FROM objects
       WHERE trashed_at IS NULL AND archived_at IS NULL
         ${includeFinance(db) ? '' : "AND type NOT IN ('financial_entry','time_entry','vendor')"}
       GROUP BY type ORDER BY count DESC`
    )
    .all();
}

export function listChanges(db, { after = 0, limit = 100 } = {}) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'integration_events'").get();
  if (!exists) return [];
  return db.prepare(
    `SELECT id, event, object_id, object_type, occurred_at, payload
     FROM integration_events WHERE id > ?
       ${includeFinance(db) ? '' : "AND object_type NOT IN ('financial_entry','time_entry','vendor')"}
     ORDER BY id ASC LIMIT ?`
  ).all(after, Math.min(Math.max(limit, 1), 1000)).map((row) => ({ ...row, payload: parseJsonSafe(row.payload) }));
}
