/**
 * Workbench — the API's own test rig, shipped as a plugin.
 *
 * Pomodoro shows what a *nice* plugin looks like. This one is deliberately
 * not nice: it touches every capability the host claims to have, in one
 * package, so that installing it either proves the API works or shows exactly
 * where it does not. If something here is blank, broken or missing, that is a
 * host bug, not a plugin bug.
 *
 * Covered: the content index, plugin stylesheets, all seven UI slots, all four
 * overlays, declarative settings, storage, events, commands.
 */

const SLOTS = [
  "workspace.sidebar",
  "workspace.ribbon",
  "editor.toolbar",
  "editor.footer",
  "object.properties",
  "settings.section",
  "workspace.corner",
];

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(label, onClick) {
  const node = el("button", label, "wb-button");
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

/** Counts what the content index found across the whole workspace. */
async function summarise(context) {
  const entries = await context.data.index.query({ limit: 5000 });
  const byKind = { heading: 0, tag: 0, link: 0, task: 0 };
  const tags = new Map();
  let done = 0;
  for (const entry of entries) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    if (entry.kind === "tag") tags.set(entry.value, (tags.get(entry.value) ?? 0) + 1);
    if (entry.kind === "task" && entry.checked) done += 1;
  }
  const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { total: entries.length, byKind, done, topTags };
}

/**
 * The main panel. Reads the content index, which is the capability with the
 * most moving parts behind it.
 */
function mountIndexPanel(context) {
  return ({ container }) => {
    const root = el("div", undefined, "wb-panel");
    const title = el("div", "Workbench", "wb-title");
    const body = el("div", "Reading index…", "wb-body");
    const actions = el("div", undefined, "wb-actions");

    async function refresh() {
      try {
        const { total, byKind, done, topTags } = await summarise(context);
        body.replaceChildren();
        body.append(el("div", `${byKind.heading} headings · ${byKind.link} links`, "wb-line"));
        body.append(el("div", `${byKind.task} tasks, ${done} done`, "wb-line"));
        body.append(el("div", `${byKind.tag} tags across the workspace`, "wb-line"));
        if (topTags.length > 0) {
          const list = el("div", undefined, "wb-tags");
          for (const [tag, count] of topTags) list.append(el("span", `#${tag} ${count}`, "wb-tag"));
          body.append(list);
        }
        if (total === 0) {
          body.append(el("div", "Nothing indexed yet — write a note with # a heading, #a-tag, [[a link]] or - [ ] a task.", "wb-hint"));
        }
      } catch (error) {
        body.replaceChildren(el("div", `Index unavailable: ${error.message}`, "wb-hint"));
      }
    }

    actions.append(button("Refresh", () => void refresh()));
    actions.append(button("Find a tag", async () => {
      const { topTags } = await summarise(context);
      if (topTags.length === 0) return context.ui.notice("No tags in the workspace yet.");
      const picked = await context.ui.suggest(topTags, ([tag, count]) => `#${tag} (${count})`, { placeholder: "Which tag?" });
      if (!picked) return;
      const hits = await context.data.index.query({ kind: "tag", value: picked[0], limit: 50 });
      context.ui.notice(`#${picked[0]} appears in ${new Set(hits.map((h) => h.object_id)).size} notes.`);
    }));

    root.append(title, body, actions);
    container.append(root);
    void refresh();

    // Recompute when the workspace changes, so the panel proves Core's events
    // fire for edits made anywhere — including by other plugins.
    const subscription = context.events.on("workspace.changed", () => void refresh());
    return { dispose: () => subscription.dispose() };
  };
}

/** A one-line marker so it is obvious whether a given slot renders at all. */
function mountMarker(label) {
  return ({ container, objectId }) => {
    const node = el("span", objectId ? `${label} · ${objectId.slice(0, 6)}` : label, "wb-marker");
    container.append(node);
    return { dispose: () => node.remove() };
  };
}

/** Per-object view: what the index found inside the note being looked at. */
function mountObjectPanel(context) {
  return ({ container, objectId }) => {
    const root = el("div", undefined, "wb-panel");
    root.append(el("div", "In this note", "wb-title"));
    const body = el("div", "…", "wb-body");
    root.append(body);
    container.append(root);

    (async () => {
      if (!objectId) {
        body.textContent = "No object in context.";
        return;
      }
      try {
        const entries = await context.data.index.forObject(objectId);
        body.replaceChildren();
        if (entries.length === 0) {
          body.append(el("div", "No headings, tags, links or tasks.", "wb-hint"));
          return;
        }
        for (const entry of entries.slice(0, 12)) {
          const prefix = entry.kind === "heading" ? "#".repeat(entry.level ?? 1)
            : entry.kind === "task" ? (entry.checked ? "[x]" : "[ ]")
            : entry.kind === "tag" ? "#" : "→";
          body.append(el("div", `${prefix} ${entry.value}`, "wb-line"));
        }
      } catch (error) {
        body.textContent = error.message;
      }
    })();

    return { dispose: () => root.remove() };
  };
}

export default {
  manifest: {
    id: "example.workbench",
    name: "Workbench",
    version: "0.1.0",
    apiVersion: "0.1",
    description: "Exercises everything the API gained in 0.42: the content index, plugin stylesheets, all six slots, every overlay and the declarative settings panel.",
    author: "Notible example",
    permissions: ["data.read", "workspace.ui", "editor.extension"],
  },

  onload(context) {
    // Every slot, so a blank one is immediately visible as a host bug.
    context.ui.registerSlot("workspace.sidebar", { id: "index", mount: mountIndexPanel(context) });
    context.ui.registerSlot("object.properties", { id: "object", mount: mountObjectPanel(context) });
    context.ui.registerSlot("workspace.ribbon", { id: "ribbon", mount: mountMarker("WB") });
    context.ui.registerSlot("editor.toolbar", { id: "toolbar", mount: mountMarker("WB toolbar") });
    context.ui.registerSlot("editor.footer", { id: "footer", mount: mountMarker("WB footer") });
    context.ui.registerSlot("settings.section", { id: "section", mount: mountMarker("WB settings section") });
    context.ui.registerSlot("workspace.corner", { id: "corner", mount: mountMarker("WB corner") });

    // The editor contract: a renderer for ```workbench blocks. If the block
    // still shows as plain code, code-block registration is not reaching the
    // editor. Type a fenced ```workbench block into any note to check.
    context.editor.registerCodeBlockRenderer("workbench", ({ container, source, objectId }) => {
      const root = el("div", undefined, "wb-panel");
      root.append(el("div", "WORKBENCH BLOCK", "wb-title"));
      const lines = source.split(/\r?\n/u).length;
      root.append(el("div", `${lines} line(s), ${source.length} characters`, "wb-line"));
      root.append(el("div", `in object ${objectId ?? "(unknown)"}`, "wb-hint"));
      container.append(root);
      return { dispose: () => root.remove() };
    });

    // The document projection: proves it reads the note in order, and that it
    // is computed from the stored body rather than from a lossy conversion.
    context.commands.register({
      id: "outline",
      name: "Workbench: outline of the open note",
      execute: async (input) => {
        const objectId = typeof input === "string" ? input : undefined;
        if (!objectId) {
          context.ui.notice("Run this from a note to see its outline.");
          return null;
        }
        const blocks = await context.data.document.get(objectId);
        const headings = blocks.filter((block) => block.kind === "heading");
        context.ui.notice(`${blocks.length} blocks, ${headings.length} headings.`);
        return blocks;
      },
    });

    context.commands.register({
      id: "report",
      name: "Workbench: index report",
      hotkey: "Mod+Shift+W",
      execute: async () => {
        const summary = await summarise(context);
        context.ui.notice(`${summary.total} entries indexed.`);
        return summary;
      },
    });

    // Each overlay gets its own command, so they can be checked one at a time.
    context.commands.register({
      id: "modal",
      name: "Workbench: open a modal",
      execute: () => {
        context.ui.modal({
          title: "Workbench modal",
          mount: ({ container }) => {
            const root = el("div", undefined, "wb-panel");
            root.append(el("div", "This is plugin content inside a Core-owned modal.", "wb-line"));
            root.append(el("div", "Escape closes it; Core owns the frame and the attribution line above.", "wb-hint"));
            container.append(root);
            return { dispose: () => root.remove() };
          },
        });
      },
    });

    context.commands.register({
      id: "menu",
      name: "Workbench: open a menu",
      execute: () => {
        context.ui.menu(
          [
            { id: "a", label: "First item", onSelect: () => context.ui.notice("First") },
            { id: "b", label: "Second item", onSelect: () => context.ui.notice("Second") },
            { id: "c", label: "Disabled", disabled: true, onSelect: () => {} },
            { id: "d", label: "After a divider", separatorBefore: true, onSelect: () => context.ui.notice("Divider item") },
          ],
          { x: 240, y: 220 },
        );
      },
    });

    // Counts loads, to show storage really survives a restart.
    const loads = (context.storage.get("loads") ?? 0) + 1;
    context.storage.set("loads", loads);

    context.settings.register({
      id: "settings",
      title: "Workbench",
      schema: {
        sections: [
          {
            title: "Diagnostics",
            description: `Loaded ${loads} time(s) since install. Slots registered: ${SLOTS.length}.`,
            fields: [
              { kind: "toggle", key: "verbose", label: "Announce every workspace change", default: false },
              { kind: "number", key: "limit", label: "Index entries to read", default: 5000, min: 10, max: 5000 },
              {
                kind: "select",
                key: "focus",
                label: "Panel focus",
                default: "all",
                options: [
                  { value: "all", label: "Everything" },
                  { value: "tasks", label: "Tasks only" },
                  { value: "tags", label: "Tags only" },
                ],
              },
              { kind: "text", key: "note", label: "Scratch note", placeholder: "anything" },
              { kind: "folder", key: "folder", label: "A folder" },
              { kind: "hotkey", key: "reportHotkey", label: "Index report", commandId: "report" },
            ],
          },
        ],
      },
    });

    this._subscription = context.events.on("object.created", ({ type }) => {
      if (context.storage.get("verbose")) context.ui.notice(`Created a ${type}`);
    });
  },

  onunload() {
    this._subscription?.dispose();
    this._subscription = null;
  },
};
