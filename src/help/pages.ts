import { HELP_ORDER } from "./index.ts";
import { parsePage, splitSections, type HelpPage, type HelpSection } from "./parse.ts";

// Vite bundles every page as a string (same ?raw mechanism as RELEASE_NOTES.md).
const raw = import.meta.glob("./pages/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const HELP_PAGES: Map<string, HelpPage> = new Map(Object.values(raw).map((text) => {
  const page = parsePage(text);
  return [page.id, page];
}));

// Table-of-contents order, so search ties resolve the way a reader would expect.
export const HELP_SECTIONS: HelpSection[] = HELP_ORDER.flatMap((id) => {
  const page = HELP_PAGES.get(id);
  return page ? splitSections(page) : [];
});
