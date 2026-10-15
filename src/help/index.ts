/** Help's table of contents: the only place that defines page order. Pure
 * data so Node checks can import it; pages themselves load in pages.ts. */
export interface HelpChapter { title: string; pages: string[] }

export const HELP_CHAPTERS: HelpChapter[] = [
  { title: "Getting started", pages: ["getting-started"] },
  { title: "Writing notes", pages: ["writing-notes"] },
  { title: "Organising your work", pages: ["containers", "kinds-of-items"] },
  { title: "Commands and shortcuts", pages: ["commands-and-shortcuts"] },
  { title: "Finding things", pages: ["finding-things"] },
  { title: "Properties and views", pages: ["properties-and-views"] },
  { title: "Move, export and delete", pages: ["move-export-delete"] },
  {
    title: "Plugins",
    pages: [
      "plugins",
      "plugin-automations",
      "plugin-calendar",
      "plugin-editor-extensions",
      "plugin-queries",
      "plugin-finance",
      "plugin-import-export",
      "plugin-planning",
      "plugin-properties",
      "plugin-search",
      "plugin-work-models",
      "plugin-themes",
      "plugin-typewriter",
      "plugin-views",
      "plugin-whiteboard",
      "market-plugins",
    ],
  },
  { title: "Settings", pages: ["settings"] },
];

export const HELP_ORDER: string[] = HELP_CHAPTERS.flatMap((chapter) => chapter.pages);
