#!/usr/bin/env node
// MCP server for the Notible app (SQLite over stdio). What it may do beyond
// reading is set in Notible: Settings → MCP server (see mcpSettings in lib.js).

import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  openDb, searchNotes, listNotes, getNote, listTypes, listChanges,
  proposeObjectUpdate, applyObjectUpdate, createObjectViaMcp, restoreMcpChange,
  previewTrashNotes, requestTrashNotes, trashRequestStatus, mcpSettings,
} from './lib.js';

const DB_PATH =
  process.env.NOTIBLE_DB_PATH ??
  path.join(process.env.APPDATA ?? '', 'com.notible.app', 'notible.db');

let db;
try {
  db = openDb(DB_PATH, { readonly: false });
} catch (err) {
  console.error(`Failed to open Notible database at "${DB_PATH}": ${err.message}`);
  console.error('Set NOTIBLE_DB_PATH to the location of notible.db.');
  process.exit(1);
}

const server = new McpServer({ name: 'notible', version: '1.3.0' });
const proposals = new Map();
// MCP-SETTINGS (Hive #29): the write tools are listed only when edits are on
// at start; lib.js checks again on every call, so turning edits off in the
// app takes effect at once. Turning them on needs a client restart.
let PROPOSE_ONLY = true;
try { PROPOSE_ONLY = !mcpSettings(db).allowEdits; } catch (err) { console.error(`MCP settings unreadable, edits off: ${err.message}`); }

const json = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});
const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });

server.registerTool(
  'search_notes',
  {
    description:
      'Full-text search over Notible notes (title + content). Excludes trashed and archived objects.',
    inputSchema: {
      query: z.string().describe('Search terms'),
      type: z
        .string()
        .optional()
        .describe('Filter by object type, e.g. note, task, project'),
      limit: z.number().int().min(1).max(200).optional().default(20),
    },
  },
  async ({ query, type, limit }) => {
    try {
      return json(searchNotes(db, { query, type, limit }));
    } catch (err) {
      return fail(`Search failed: ${err.message}`);
    }
  }
);

server.registerTool(
  'list_notes',
  {
    description:
      'List Notible objects, newest first. Excludes trashed and archived objects.',
    inputSchema: {
      type: z.string().optional().describe('Filter by object type'),
      limit: z.number().int().min(1).max(500).optional().default(50),
    },
  },
  async ({ type, limit }) => {
    try {
      return json(listNotes(db, { type, limit }));
    } catch (err) {
      return fail(`List failed: ${err.message}`);
    }
  }
);

server.registerTool(
  'get_note',
  {
    description:
      'Get a single Notible object by id: full content converted to readable text, props, and relations.',
    inputSchema: { id: z.string().describe('Object id (uuid)') },
  },
  async ({ id }) => {
    try {
      const note = getNote(db, id);
      if (!note) return fail(`No object found with id "${id}".`);
      return json(note);
    } catch (err) {
      return fail(`Get failed: ${err.message}`);
    }
  }
);

server.registerTool(
  'list_types',
  {
    description: 'List available Notible object types with counts (excluding trashed/archived).',
    inputSchema: {},
  },
  async () => {
    try {
      return json(listTypes(db));
    } catch (err) {
      return fail(`List types failed: ${err.message}`);
    }
  }
);

server.registerTool(
  'list_changes',
  {
    description: 'Read the durable Notible integration event stream after a numeric cursor.',
    inputSchema: {
      after: z.number().int().min(0).optional().default(0),
      limit: z.number().int().min(1).max(1000).optional().default(100),
    },
  },
  async ({ after, limit }) => {
    try {
      return json(listChanges(db, { after, limit }));
    } catch (err) {
      return fail(`Change stream failed: ${err.message}`);
    }
  }
);

server.registerTool(
  'propose_object_update',
  {
    description: 'Prepare a side-effect-free update to a task, issue or note. Review the returned before/after values, then call apply_object_update with its proposalId.',
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      content: z.string().optional(),
      propsPatch: z.record(z.unknown()).optional(),
      expectedUpdatedAt: z.number().optional(),
    },
  },
  async (input) => {
    try {
      const proposal = proposeObjectUpdate(db, input);
      const proposalId = randomUUID();
      proposals.set(proposalId, { ...proposal, expiresAt: Date.now() + 15 * 60_000 });
      return json({ proposalId, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), ...proposal });
    } catch (err) { return fail(`Proposal failed: ${err.message}`); }
  }
);

if (!PROPOSE_ONLY) server.registerTool(
  'apply_object_update',
  {
    description: 'Apply an update previously prepared with propose_object_update. This writes to Notible and records an undoable history snapshot.',
    inputSchema: { proposalId: z.string().describe('Exact proposalId returned after the user reviewed the proposed change') },
  },
  async ({ proposalId }) => {
    try {
      const proposal = proposals.get(proposalId);
      if (!proposal || proposal.expiresAt < Date.now()) throw new Error('Proposal is missing or expired. Prepare it again.');
      proposals.delete(proposalId);
      return json(applyObjectUpdate(db, proposal));
    } catch (err) { return fail(`Update failed: ${err.message}`); }
  }
);

if (!PROPOSE_ONLY) server.registerTool(
  'create_object',
  {
    description: 'Create a task, issue or note, optionally in a project. Requires the literal confirmation CREATE because this writes to Notible.',
    inputSchema: {
      type: z.enum(['task', 'issue', 'note']), title: z.string(), content: z.string().optional(),
      props: z.record(z.unknown()).optional(), parentId: z.string().optional(),
      confirmation: z.literal('CREATE'),
    },
  },
  async (input) => {
    try { return json(createObjectViaMcp(db, input)); }
    catch (err) { return fail(`Create failed: ${err.message}`); }
  }
);

if (!PROPOSE_ONLY) server.registerTool(
  'undo_mcp_update',
  {
    description: 'Undo a specific MCP update using its returned historyId. Refuses if the object changed afterwards.',
    inputSchema: { objectId: z.string(), historyId: z.number().int().positive(), expectedUpdatedAt: z.number().optional() },
  },
  async (input) => {
    try { return json(restoreMcpChange(db, input)); }
    catch (err) { return fail(`Undo failed: ${err.message}`); }
  }
);

// MCP-CLEANUP (Hive #13): preview and submit only. The user approves or
// rejects each note in Notible; there is no tool to approve, apply or delete.
const trashPreviews = new Map();

server.registerTool(
  'preview_trash_notes',
  {
    description: 'Read-only. Check whether up to 20 exact notes could be moved to the Trash in a scope the user allowed (workspace or a project id). Returns titles, paths, versions, incoming links and why any note is excluded, plus a previewId for request_trash_notes. Only active notes without children qualify; protected notes never do.',
    inputSchema: {
      ids: z.array(z.string()).min(1).max(20).describe('Exact note ids, no wildcards'),
      scopeId: z.string().optional().default('workspace').describe('"workspace" or a project id the user enabled for AI cleanup'),
    },
  },
  async ({ ids, scopeId }) => {
    try {
      const preview = previewTrashNotes(db, { ids, scopeId });
      const previewId = randomUUID();
      trashPreviews.set(previewId, { preview, expiresAt: Date.now() + 15 * 60_000 });
      return json({ previewId, ...preview });
    } catch (err) { return fail(`Preview failed: ${err.message}`); }
  }
);

server.registerTool(
  'request_trash_notes',
  {
    description: 'Ask the user to move the eligible notes of a preview to the Trash. Nothing is trashed by this call: Notible shows the request and the user approves or rejects each note. Fails with app_not_running when Notible is closed. One waiting request at a time, at most 5 per hour.',
    inputSchema: {
      previewId: z.string().describe('previewId returned by preview_trash_notes'),
      reason: z.string().min(1).max(1000).describe('Why, in a sentence the user will read'),
    },
  },
  async ({ previewId, reason }) => {
    try {
      const stored = trashPreviews.get(previewId);
      if (!stored || stored.expiresAt < Date.now()) throw new Error('Preview is missing or expired. Preview again.');
      trashPreviews.delete(previewId);
      const client = server.server.getClientVersion()?.name ?? '';
      return json(requestTrashNotes(db, { preview: stored.preview, reason, client }));
    } catch (err) { return fail(`Request failed: ${err.message}`); }
  }
);

server.registerTool(
  'get_trash_request_status',
  {
    description: 'Read-only status of a cleanup request: pending, rejected, expired, conflict or applied.',
    inputSchema: { requestId: z.string() },
  },
  async ({ requestId }) => {
    try { return json(trashRequestStatus(db, { requestId })); }
    catch (err) { return fail(`Status failed: ${err.message}`); }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Notible MCP server running (db: ${DB_PATH})`);
