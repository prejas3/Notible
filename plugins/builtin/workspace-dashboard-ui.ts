import type { PluginObject, ViewMount } from "../../packages/plugin-api/src/index.ts";
import "./surface.css";
import "./workspace-dashboard-ui.css";
import { NEW_PROJECT_PROPS } from "./task-statuses.ts";

/**
 * The workspace dashboard, written against the **public** plugin contract.
 *
 * This is deliberate dogfooding. Every other builtin surface renders through
 * Core's privileged React path; this one gets exactly what a stranger's plugin
 * gets — `mount`, `context.data`, `context.data.index`, `openObject` — so that
 * "is the API good enough to build a real product surface with?" has an
 * answer that is demonstrated rather than asserted.
 *
 * It replaces a read-only list of deadlines. The complaint that produced this
 * rewrite was precise: you could see what was due but you could not get *into*
 * a project from here, so the view was a report rather than a place to start
 * work from.
 */

const DAY_MS = 86_400_000;
/** How far ahead "coming up" reaches. Two weeks fits on one screen. */
const HORIZON_DAYS = 14;
const CONTAINER_TYPES = new Set(["project", "folder", "space", "whiteboard"]);
/** Titles Sync ("(conflict copy — device, date)") and Teams ("(conflict copy,
 * name)") give the losing version. No `$` anchor: Sync may truncate the title. */
export const isConflictCopy = (title: string | null | undefined) => /\(conflict copy\b/.test(title ?? "");
/**
 * When an item stops being counted as "po terminie": the moment its status
 * reads as closed. The old list was hand-written and had drifted away from the
 * statuses the type schemas actually offer (`work-models.ts` ships "closed",
 * `ai.ts` also counts "resolved"), so a task closed as "closed" stayed overdue
 * for ever. Compared normalised, because a status is user-editable text.
 */
const DONE_STATUSES = new Set([
  "done", "completed", "complete", "closed", "resolved", "cancelled", "canceled", "archived",
]);

function normalizeStatus(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function propsOf(object: PluginObject): Record<string, unknown> {
  try {
    const parsed = JSON.parse(object.props) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The one date that makes an item due: a task's due, a milestone's target. */
function dueOf(object: PluginObject): number | null {
  const raw = propsOf(object).due ?? propsOf(object).targetDate ?? propsOf(object).date;
  if (typeof raw !== "string" || !raw) return null;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : null;
}

function isDone(object: PluginObject): boolean {
  const status = propsOf(object).status;
  return typeof status === "string" && DONE_STATUSES.has(normalizeStatus(status));
}

function dayDiff(time: number, today: number): number {
  return Math.round((new Date(time).setHours(0, 0, 0, 0) - today) / DAY_MS);
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Whole sentences with a `{count}`, never "za" + n + "dni".
 *
 * This surface was written in Polish, hardcoded, before the application had a
 * translation layer at all. Fragments glued around a number cannot be
 * translated in either direction — their order is fixed here, in the code, so
 * no locale file could repair the grammar of a language that puts them
 * elsewhere.
 */
function whenLabel(days: number, t: Translate): string {
  if (!Number.isFinite(days)) return t("No due date");
  if (days < 0) return days === -1 ? t("yesterday") : t("{count} days ago", { count: Math.abs(days) });
  if (days === 0) return t("today");
  if (days === 1) return t("tomorrow");
  return t("in {count} days", { count: days });
}

function el(tag: string, text?: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/** A row that opens something when clicked. Buttons, not divs: this view is
 * navigation, and navigation has to work from the keyboard. */
function openRow(label: string, meta: string, onOpen: () => void, className = "wd-row"): HTMLElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.append(el("span", label, "wd-row-label"));
  if (meta) node.append(el("span", meta, "wd-row-meta"));
  node.addEventListener("click", onOpen);
  return node;
}

/** Object types Triage can hold before it's sorted into a project. */
const TRIAGE_TYPES = new Set(["task", "issue", "note"]);
const TRIAGE_TYPE_OPTIONS = ["task", "issue", "note"];

function section(title: string, count?: number): HTMLElement {
  const node = el("section", undefined, "wd-section");
  const heading = el("div", undefined, "wd-section-head");
  heading.append(el("h3", title, "wd-section-title"));
  if (count !== undefined) heading.append(el("span", String(count), "wd-section-count"));
  node.append(heading);
  return node;
}

/** Types that are a unit of work, so "no due date" is worth surfacing for
 * them and not for every stray note. */
const WORK_TYPES = new Set(["task", "issue", "milestone", "cycle", "release"]);

function textProp(object: PluginObject, key: string): string {
  const value = propsOf(object)[key];
  return typeof value === "string" ? value : "";
}

/** The counts strip. The state of the workspace has to be legible before you
 * read a single row. */
function metrics(entries: Array<[string, number, boolean]>): HTMLElement {
  const row = el("div", undefined, "wd-metrics");
  for (const [label, value, alert] of entries) {
    const cell = el("div", undefined, alert && value > 0 ? "wd-metric is-alert" : "wd-metric");
    cell.append(el("strong", String(value), "wd-metric-value"));
    cell.append(el("span", label, "wd-metric-label"));
    row.append(cell);
  }
  return row;
}

/**
 * "Bez terminu" is a nudge, not a rule: plenty of tasks legitimately have no
 * deadline, and a list you cannot silence stops being read. So instead of
 * making every dateless item look like a defect, each one can be dismissed —
 * per workspace, in the plugin's own storage, and reversible from the section
 * header.
 */
function ignoreKey(containerId: string): string {
  return "wd-ignored:" + containerId;
}

/**
 * Quick capture: one field, Enter creates a task with no project. Sorting it
 * out happens later, in the Triage section — the bar itself never asks for
 * more than a title, or it stops being quick.
 */
function captureBar(t: Translate, onCapture: (title: string) => void): HTMLElement {
  const bar = el("div", undefined, "wd-capture");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "wd-capture-input";
  input.placeholder = t("Capture a thought…");
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const title = input.value.trim();
    if (!title) return;
    input.value = "";
    onCapture(title);
  });
  bar.append(input);
  return bar;
}

export const mountWorkspaceDashboard: ViewMount = ({ container, plugin, containerId, openObject }) => {
  const t: Translate = (key, values) => plugin.i18n.t(key, values);
  const root = el("div", undefined, "wd-root");
  const body = el("div", t("Loading…"), "wd-body");
  root.append(body);
  container.append(root);

  let disposed = false;
  let controls: Array<{ dispose(): void }> = [];
  function disposeControls() {
    for (const control of controls) control.dispose();
    controls = [];
  }

  async function descendantsOf(id: string): Promise<PluginObject[]> {
    // Walk the tree breadth-first through the public query API. There is no
    // "give me everything under this" call, and adding one would be a Core
    // privilege a third-party plugin could not use — so this does it the way
    // any plugin would have to.
    const collected: PluginObject[] = [];
    let frontier = [id];
    const seen = new Set(frontier);
    for (let depth = 0; depth < 6 && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const parentId of frontier) {
        const children = await plugin.data.objects.query({ parentId, limit: 500 });
        for (const child of children) {
          if (seen.has(child.id)) continue;
          seen.add(child.id);
          collected.push(child);
          if (CONTAINER_TYPES.has(child.type)) next.push(child.id);
        }
      }
      frontier = next;
    }
    return collected;
  }

  async function render() {
    if (!containerId) {
      body.replaceChildren(el("p", t("This view needs a workspace."), "wd-empty"));
      return;
    }
    // CONFLICT-COPY-HIDE: sync/Teams conflict copies stay in the tree (next to
    // the original, for review) but are not work to plan, so the dashboard
    // skips them (Hive #1, 03.10). ponytail: matched by title, the only marker
    // existing copies carry; a props flag would need all three sync plugins.
    const everything = (await descendantsOf(containerId)).filter((object) => !isConflictCopy(object.title));
    if (disposed) return;

    const today = new Date().setHours(0, 0, 0, 0);
    const leaves = everything.filter((object) => !CONTAINER_TYPES.has(object.type));
    const projects = everything.filter((object) => object.type === "project");
    const titleOf = new Map(everything.map((object) => [object.id, object.title || t("Untitled")]));

    // What a row needs to be worth reading: which project it belongs to, how
    // urgent it is, and where it stands. The old view showed a bare title and
    // a date, which is why it read as a report rather than a place to start.
    const open = leaves.filter((object) => !isDone(object));
    const dated = open
      .map((object) => ({ object, due: dueOf(object) }))
      .filter((entry): entry is { object: PluginObject; due: number } => entry.due !== null)
      .map((entry) => ({ ...entry, days: dayDiff(entry.due, today) }))
      .sort((left, right) => left.due - right.due);

    const overdue = dated.filter((entry) => entry.days < 0);
    const dueToday = dated.filter((entry) => entry.days === 0);
    const thisWeek = dated.filter((entry) => entry.days > 0 && entry.days <= 7);
    const later = dated.filter((entry) => entry.days > 7 && entry.days <= HORIZON_DAYS);
    const ignored = new Set(plugin.storage.get<string[]>(ignoreKey(containerId)) ?? []);
    const dateless = open.filter((object) => dueOf(object) === null && WORK_TYPES.has(object.type));
    const undated = dateless.filter((object) => !ignored.has(object.id));

    function setIgnored(next: Set<string>) {
      plugin.storage.set(ignoreKey(containerId!), [...next]);
      void render();
    }

    disposeControls();
    body.replaceChildren();
    body.append(metrics([
      [t("overdue"), overdue.length, true],
      [t("today"), dueToday.length, false],
      [t("this week"), thisWeek.length, false],
      [t("no due date"), undated.length, false],
    ]));

    body.append(captureBar(t, (title) => {
      void plugin.data.objects.create({ type: "task", title, parentId: containerId! }).then(() => void render());
    }));

    const columns = el("div", undefined, "wd-columns");
    const main = el("div", undefined, "wd-column wd-column-main");
    const side = el("div", undefined, "wd-column");
    columns.append(main, side);
    body.append(columns);

    // Triage: things captured straight onto the workspace, not yet inside a
    // project. Sorting one out (project + type) makes it disappear from here
    // — it stopped being unsorted.
    const triaged = everything.filter((object) => object.parent_id === containerId && TRIAGE_TYPES.has(object.type));
    if (triaged.length > 0) {
      const triageSection = section(t("Triage"), triaged.length);
      for (const object of triaged) {
        const row = el("div", undefined, "wd-triage-row");
        const openButton = document.createElement("button");
        openButton.type = "button";
        openButton.className = "wd-row wd-triage-title";
        openButton.append(el("span", object.title || t("Untitled"), "wd-row-label"));
        openButton.addEventListener("click", () => void openObject(object.id));
        row.append(openButton);

        const typeHost = el("div", undefined, "wd-triage-select");
        controls.push(plugin.ui.mountSelect(typeHost, {
          value: object.type,
          ariaLabel: t("Type"),
          options: TRIAGE_TYPE_OPTIONS.map((option) => ({ value: option, label: option.charAt(0).toUpperCase() + option.slice(1) })),
          onChange: (value) => void plugin.data.objects.setType(object.id, value).then(() => void render()),
        }));
        row.append(typeHost);

        const projectHost = el("div", undefined, "wd-triage-select");
        controls.push(plugin.ui.mountSelect(projectHost, {
          value: "",
          ariaLabel: t("Project"),
          options: [
            { value: "", label: t("No project") },
            ...projects.map((project) => ({ value: project.id, label: project.title || t("Untitled") })),
          ],
          onChange: (value) => {
            if (value) void plugin.data.objects.move(object.id, value).then(() => void render());
          },
        }));
        row.append(projectHost);

        triageSection.append(row);
      }
      main.append(triageSection);
    }

    function attentionRow(entry: { object: PluginObject; days: number }): HTMLElement {
      const parentTitle = entry.object.parent_id ? titleOf.get(entry.object.parent_id) : undefined;
      const priority = textProp(entry.object, "priority");
      const status = textProp(entry.object, "status");
      const row = document.createElement("button");
      row.type = "button";
      row.className = entry.days < 0 ? "wd-row is-overdue" : "wd-row";
      row.append(el("span", entry.object.title || t("Untitled"), "wd-row-label"));
      const tags = el("span", undefined, "wd-row-tags");
      if (parentTitle) tags.append(el("span", parentTitle, "wd-chip"));
      if (status) tags.append(el("span", status, "wd-chip"));
      if (priority) tags.append(el("span", priority, "wd-chip wd-priority-" + priority.toLowerCase()));
      row.append(tags);
      row.append(el("span", whenLabel(entry.days, t), "wd-row-meta"));
      row.addEventListener("click", () => void openObject(entry.object.id));
      return row;
    }

    const groups: Array<[string, Array<{ object: PluginObject; days: number }>]> = [
      [t("Overdue"), overdue],
      [t("Due today"), dueToday],
      [t("This week"), thisWeek],
      [t("Later (up to 14 days)"), later],
    ];
    let anyAttention = false;
    for (const [title, entries] of groups) {
      if (entries.length === 0) continue;
      anyAttention = true;
      const group = section(title, entries.length);
      for (const entry of entries.slice(0, 12)) group.append(attentionRow(entry));
      main.append(group);
    }
    if (!anyAttention) {
      const clear = section(t("Needs attention"), 0);
      clear.append(el("p", t("Nothing is due in the next two weeks."), "wd-empty"));
      main.append(clear);
    }

    if (undated.length > 0 || ignored.size > 0) {
      const group = section(t("No due date"), undated.length);
      for (const object of undated.slice(0, 10)) {
        const wrap = el("div", undefined, "wd-row-wrap");
        wrap.append(attentionRow({ object, days: Number.NaN }));
        const dismiss = el("button", t("Ignore"), "wd-ignore") as HTMLButtonElement;
        dismiss.type = "button";
        dismiss.title = t("Stop showing this item under “No due date”");
        dismiss.addEventListener("click", () => setIgnored(new Set([...ignored, object.id])));
        wrap.append(dismiss);
        group.append(wrap);
      }
      if (undated.length === 0) group.append(el("p", t("Everything without a due date is ignored."), "wd-empty"));
      if (ignored.size > 0) {
        const restore = el("button", t("Restore ignored ({count})", { count: ignored.size }), "wd-ignore") as HTMLButtonElement;
        restore.type = "button";
        restore.addEventListener("click", () => setIgnored(new Set()));
        group.append(restore);
      }
      main.append(group);
    }

    // Projects: counts per state, deliberately with no percentage bar. Task
    // sizes are not comparable, so a percentage reads as progress it cannot
    // actually measure.
    if (projects.length > 0) {
      const projectSection = section(t("Projects"), projects.length);
      const summaries = projects.map((project) => {
        const inside = everything.filter((object) => object.parent_id === project.id && !CONTAINER_TYPES.has(object.type));
        const dues = inside.filter((object) => !isDone(object)).map(dueOf).filter((value): value is number => value !== null);
        return {
          object: project,
          open: inside.filter((object) => !isDone(object)).length,
          done: inside.filter(isDone).length,
          nextDue: dues.length > 0 ? Math.min(...dues) : null,
        };
      }).sort((left, right) => right.open - left.open);
      for (const summary of summaries) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "wd-project";
        card.append(el("span", summary.object.title || t("Untitled"), "wd-row-label"));
        const counts = t("{open} open · {done} closed", { open: summary.open, done: summary.done });
        const due = summary.nextDue !== null ? " \u00b7 " + whenLabel(dayDiff(summary.nextDue, today), t) : "";
        card.append(el("span", counts + due, "wd-row-meta"));
        card.addEventListener("click", () => void openObject(summary.object.id));
        projectSection.append(card);
      }
      side.append(projectSection);
    }

    // Open checkboxes written inside note bodies are invisible to the object
    // query, so they need the content index.
    try {
      const tasks = await plugin.data.index.query({ kind: "task", limit: 500 });
      if (disposed) return;
      const known = new Set(everything.map((object) => object.id));
      const openTasks = tasks.filter((task) => !task.checked && known.has(task.object_id));
      if (openTasks.length > 0) {
        const inNotes = section(t("Unfinished in notes"), openTasks.length);
        for (const task of openTasks.slice(0, 10)) {
          inNotes.append(openRow(task.value, titleOf.get(task.object_id) || "notatka", () => void openObject(task.object_id)));
        }
        side.append(inNotes);
      }
    } catch {
      // The content index is optional to this view: an older host without it
      // should still get the attention list rather than an error screen.
    }

    const recent = [...leaves].sort((left, right) => right.updated_at - left.updated_at).slice(0, 8);
    if (recent.length > 0) {
      const recentSection = section(t("Recently opened"));
      for (const object of recent) {
        recentSection.append(openRow(
          object.title || t("Untitled"),
          new Date(object.updated_at).toLocaleDateString(),
          () => void openObject(object.id),
        ));
      }
      side.append(recentSection);
    }

    if (leaves.length === 0 && projects.length === 0) {
      // Buttons, not just a sentence (S5): an empty overview is where people
      // decide what to make first.
      const empty = el("div", undefined, "wd-empty-start");
      empty.append(el("p", t("This workspace is empty. Add a project or a note to see something here."), "wd-empty"));
      const create = (type: "project" | "note", label: string) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = type === "project" ? "btn-primary" : "";
        button.textContent = label;
        button.addEventListener("click", () => {
          const content = type === "note" ? JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }) : undefined;
          void plugin.data.objects.create({ type, title: type === "project" ? t("New project") : t("New note"), parentId: containerId!, ...(content ? { content } : {}), ...(type === "project" ? { props: JSON.stringify({ status: "planned", priority: "none", ...NEW_PROJECT_PROPS }) } : {}) })
            .then((object) => plugin.ui.openObject(object.id));
        });
        return button;
      };
      const actions = el("div", undefined, "wd-empty-actions");
      actions.append(create("project", t("New project")), create("note", t("New note")));
      empty.append(actions);
      body.replaceChildren(empty);
    }
  }

  void render().catch((error: unknown) => {
    body.replaceChildren(el("p", error instanceof Error ? error.message : String(error), "wd-empty"));
  });

  // Recompute when anything changes — including changes made by other
  // plugins, which is the property that makes Core's event set worth having.
  const subscription = plugin.events.on("workspace.changed", () => {
    void render().catch(() => {});
  });

  return {
    dispose: () => {
      disposed = true;
      disposeControls();
      subscription.dispose();
      root.remove();
    },
  };
};
