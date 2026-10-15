import type { PluginContext } from "../../packages/plugin-api/src/index.ts";
import { createBuiltinSurface } from "./scaffold.ts";
import { parseQuery, schemaFieldsOf } from "./queries.ts";

/**
 * `notible.queries` — a builtin of its own, deliberately not part of
 * `notible.editor-extensions`.
 *
 * The reason is a permission, and it is the whole security argument for this
 * feature. Embedded queries need `data.read`; editor-extensions declares only
 * `["workspace.ui", "editor.extension"]`, and its mermaid renderer is driven
 * by note text exactly as this one is. Note text arrives by import, by sync
 * from another device, by paste, and by any plugin's `objects.create` — so
 * adding `data.read` there would silently turn every imported note into a
 * workspace-read trigger for a plugin nobody would think to re-read the
 * manifest of.
 *
 * Splitting it is not cosmetic: permissions are computed from the manifest for
 * builtins exactly as for third-party packages (`new Set(manifest.permissions)`
 * in `src/core/extensions/host.ts`), so this really has the read and
 * editor-extensions really does not. It also gets its own Plugin Matrix row,
 * which is where a user can see the difference and switch it off.
 */

/** Diagnostic command: check a block without putting it in a note. */
async function inspectQuery(context: PluginContext, input?: unknown) {
  const source = typeof input === "string"
    ? input
    : String((input as { source?: unknown } | undefined)?.source ?? "");
  const types = await context.data.types.list();
  const firstPass = parseQuery(source, new Set(["title", "updated"]));
  const wanted = firstPass.ok ? firstPass.query.types : types.map((type) => type.name);
  const parsed = parseQuery(source, schemaFieldsOf(types, wanted));
  return parsed.ok
    ? { ok: true, types: parsed.query.types, layout: parsed.query.layout, filters: [...parsed.query.fields.keys()] }
    : { ok: false, errors: parsed.errors };
}

export const queriesPlugin = createBuiltinSurface({
  manifest: {
    id: "notible.queries",
    name: "Embedded queries",
    version: "0.1.0",
    apiVersion: "1.3",
    entry: "index.ts",
    description: "A fenced notible block in a note becomes a live table of matching objects.",
    guide: [
      "## Writing a query",
      "",
      "Type / in a note and pick \"Live list of matching items\", or open a notible code fence yourself. Inside it, one instruction per line:",
      "",
      "```",
      "type: task",
      "status: open",
      "sort: due asc",
      "limit: 20",
      "```",
      "",
      "The block answers with whatever matches at the moment you open the note. The rows are the real objects, so clicking one opens it and edits there change the record.",
      "",
      "## Fields you can filter on",
      "",
      "```",
      "type      task, issue, project, note, or any type a plugin adds",
      "status    exact match on a property value (also priority, assignee)",
      "in        only inside the named project or folder",
      "tag       has the given #tag",
      "sort      a field, then asc or desc",
      "limit     cap the row count",
      "```",
      "",
      "Lines you leave out are simply not constrained.",
    ].join("\n"),
    permissions: ["workspace.ui", "data.read", "editor.extension"],
  },
  capability: "queries",
  commandName: "Check a query block",
  viewTitle: "Embedded queries",
  onCommand: (context, input) => inspectQuery(context, input),
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
  settingsRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
  codeBlocks: [{
    language: "notible",
    // Loaded lazily so the DOM half stays out of the entry bundle, the same
    // shape the other builtin surfaces use.
    render: (blockContext) => {
      let inner: { dispose(): void } | void;
      let disposed = false;
      void import("./queries-render.ts").then((module) => {
        if (disposed) return;
        inner = module.renderQueryBlock(blockContext);
      });
      return {
        dispose: () => {
          disposed = true;
          inner?.dispose();
        },
      };
    },
  }],
});
