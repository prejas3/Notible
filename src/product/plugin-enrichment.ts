/** Marks a string for the locale catalogue; translated where it is drawn. Local
 * (same as core-i18n's `tr`) so Node checks can import this file without JSON. */
const tr = (key: string) => key;
/**
 * Optional, human-written context about the builtin plugins — longer
 * descriptions, a concrete example, stated dependencies, permission wording,
 * and browsable categories. None of it gates visibility: a plugin with no
 * entry here still lists and still has a detail view, it just falls back to
 * its manifest. Keep these keyed by plugin id and additive.
 */

/** Groups the flat plugin list into real sections instead of an
 * unstructured grid. A presentation concern, not something a plugin author
 * declares — anything unlisted lands in "Other" via {@link categoryOf}. */
export const PLUGIN_CATEGORIES: { name: string; ids: string[] }[] = [
  { name: "Work & planning", ids: ["notible.work-models", "notible.planning", "notible.automations"] },
  { name: "Data & views", ids: ["notible.properties", "notible.views", "notible.search", "notible.library"] },
  { name: "Editor & canvas", ids: ["notible.editor-extensions", "notible.queries", "notible.whiteboard", "notible.typewriter"] },
  { name: "Integrations & data flow", ids: ["notible.finance", "notible.calendar", "notible.import-export"] },
  { name: "Appearance", ids: ["notible.themes"] },
];

/** The category a plugin id belongs to, or "Other" so nothing is ever
 * dropped from the list. */
export function categoryOf(id: string): string {
  return PLUGIN_CATEGORIES.find((category) => category.ids.includes(id))?.name ?? "Other";
}

/** Longer, one-plugin-at-a-time descriptions — deliberately not shown in the
 * list (which stays scannable with the short manifest description); only
 * the expanded detail view uses these. */
export const PLUGIN_LONG_DESCRIPTIONS: Record<string, string> = {
  "notible.properties": tr("Adds a Properties panel to notes, tasks, issues and projects, for details such as dates, links, numbers and checkboxes. Open any item and use the panel on the right to add or change them."),
  "notible.work-models": tr("Adds projects, tasks and issues, with status, priority, due dates and links between related work. After turning it on, create them from + and manage them inside a project."),
  "notible.views": tr("Shows the work in a project or workspace as a board, table, list, gallery or calendar, and remembers your filters and sorting. Open a project to switch between views."),
  "notible.planning": tr("Adds milestones, cycles, releases and a timeline (Gantt chart) to projects. Turn on Tasks, Issues and Projects first, then open a project to plan its work."),
  "notible.automations": tr("Lets Notible do routine steps for you, such as moving an urgent issue out of triage or setting a field when a status changes. Open a project's Automations tab to create a rule. Everything runs on this computer."),
  "notible.finance": tr("Adds budgets, vendors and billable or non-billable time to projects, and shows how much budget is left. Turn on Properties first, then open a project's Finance tab."),
  "notible.calendar": tr("Shows a project's dated work on a calendar, can place a Google or Outlook calendar beside it, and reminds you before events. Open a project's Calendar tab to connect an account."),
  "notible.editor-extensions": tr("Adds highlighted code, before-and-after comparisons and diagrams (Mermaid) to notes. Type / in a note to insert them."),
  "notible.whiteboard": tr("Adds whiteboards for arranging cards, shapes, linked notes and arrows freely. Create one from +, then drag things around to map ideas."),
  "notible.search": tr("Adds search filters (tag, place, type, dates), highlighted results, and a Backlinks list under each note showing which notes link to it."),
  "notible.import-export": tr("Saves one note or project, with everything inside it, as a single file, and brings such a file back in. Right-click an item → Export and print. For a copy of the whole workspace, use Settings → Recovery."),
  "notible.queries": tr("Adds live lists to notes, such as open tasks due soon, that update by themselves. In a note, type / and choose Live list of matching items, then say what it should show."),
  "notible.themes": tr("Lets you install themes that change Notible's colours, backgrounds and effects without touching your notes. Install and pick them on the Themes screen; Daylight and Midnight are always there."),
  "notible.typewriter": tr("A place to write long texts: a manuscript of parts, chapters and scenes with word targets and progress, plus a story reference for characters, places and plotlines. Create a manuscript from +."),
  "notible.library": tr("A visual shelf for books, films, series and games, with ratings, statuses, tags and covers stored in Notible's managed media folder."),
};

/** Permission ids in words a non-developer understands, phrased as what it lets the plugin do. */
export const PERMISSION_WORDS: Record<string, string> = {
  "data.read": tr("see your notes and items"),
  "data.write": tr("create and change notes and items"),
  "relations.write": tr("link items to each other"),
  "data.sync": tr("copy every change to your other devices"),
  "media.read": tr("read images pasted into notes"),
  "media.write": tr("add images you choose to Notible's media store"),
  "workspace.ui": tr("show its own screens, buttons and panels"),
  "editor.extension": tr("add blocks to the note editor"),
  "network": tr("use the internet"),
  "notifications": tr("show Windows notifications"),
};

/**
 * One concrete thing each plugin is for. A description says what a plugin
 * is; people decide with an example — deliberately small and specific.
 */
export const PLUGIN_EXAMPLES: Record<string, string> = {
  "notible.properties": tr("Give one meeting note a “decision due” date without turning it into a task type: open it, add a one-off date property, and it stays on that note alone."),
  "notible.work-models": tr("Write “Fix the invoice export” as an issue, link it to the project it belongs to, and have it show up in that project instead of floating loose in your notes."),
  "notible.views": tr("Look at the same project as a board while you are working, and as a table when you need to see dates and owners side by side — both saved, so neither has to be rebuilt."),
  "notible.planning": tr("Put a release date on the calendar, hang three milestones off it, and see which task slipping moves the release."),
  "notible.automations": tr("When a ticket's priority becomes urgent, move it out of triage automatically, so nobody has to notice it first."),
  "notible.finance": tr("Log two hours against a project as billable, and see the budget left without opening a spreadsheet."),
  "notible.calendar": tr("Point a project at a Google calendar so its dated work shows up next to your meetings."),
  "notible.editor-extensions": tr("Paste a shell script into a note and have it highlighted instead of grey — and show a before/after diff when you change it."),
  "notible.queries": tr("Put “every open issue in this project, newest first” into the project note once; it stays right without you touching it again."),
  "notible.whiteboard": tr("Map how four systems talk to each other by dragging boxes and connecting them, rather than describing it in a paragraph nobody reads."),
  "notible.search": tr("Find “tag:invoice in:Acme” and see which notes link to the one you are reading, at the bottom of it."),
  "notible.import-export": tr("Hand one project — its notes, tasks and structure — to someone else as a single file, without giving them your whole workspace."),
  "notible.themes": tr("Dress Notible in a community theme, with your own backgrounds and glass effects, or go back to Daylight and Midnight any time."),
  "notible.typewriter": tr("Draft a novel as chapters and scenes, set a 90,000-word target with a deadline, and see how many words a day you need — while a Codex tracks who appears in which scene."),
  "notible.library": tr("Keep a five-star reading list beside films and games, then filter the shelf to what you are currently reading or playing."),
};

/**
 * Plugins that assume another one is already there. Stated because enabling
 * Planning on its own produces an empty planning screen and no explanation.
 */
export const PLUGIN_WHERE: Record<string, string> = {
  "notible.planning": tr("Open a project and choose Modules to add Timeline, Planning or Calendar."),
  "notible.finance": tr("Open a project and choose Modules to add its Finance tab."),
  "notible.automations": tr("Open a project and choose Modules to add its Automations tab."),
  "notible.queries": tr("In a note, type / and choose Live list of matching items."),
  "notible.typewriter": tr("Create a manuscript from the + menu."),
  "notible.calendar": tr("Connect a calendar in a project's Calendar tab."),
  "notible.whiteboard": tr("Create one from the + menu, or add a Whiteboard tab to a project under Modules."),
  "notible.work-models": tr("Create a project, task or issue from the + menu."),
  "notible.views": tr("Open a project: its Tasks tab is a board, table, list, calendar or gallery."),
  "notible.properties": tr("Open a note, task or issue: the panel on the right."),
  "notible.search": tr("At the bottom of every note, and in search."),
};

export const PLUGIN_NEEDS: Record<string, string[]> = {
  "notible.planning": ["notible.work-models"],
  "notible.finance": ["notible.properties"],
  "notible.views": ["notible.work-models"],
  "notible.automations": ["notible.work-models"],
};
