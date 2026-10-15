import { createSlugger } from "./slug.ts";

/** `plugin` (front matter, optional): the page is about this plugin; a helper
 * treats it as off while the plugin is off (API 1.22). */
export interface HelpPage { id: string; title: string; keywords: string; body: string; plugin?: string }
export interface HelpSection { pageId: string; pageTitle: string; heading: string; slug: string; text: string; keywords: string }

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u;
const HEADING = /^(#{1,3})\s+(.+)$/u;

export function parsePage(raw: string): HelpPage {
  const match = FRONT_MATTER.exec(raw);
  if (!match) throw new Error("help: missing front matter");
  const fields: Record<string, string> = Object.fromEntries(match[1].split(/\r?\n/u).map((line) => {
    const at = line.indexOf(":");
    return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
  }));
  if (!fields.id || !fields.title || !fields.keywords) throw new Error("help: front matter needs id, title, keywords");
  return { id: fields.id, title: fields.title, keywords: fields.keywords, body: raw.slice(match[0].length).trimStart(), ...(fields.plugin ? { plugin: fields.plugin } : {}) };
}

/** One section per heading; text before the first heading is the page intro. */
export function splitSections(page: HelpPage): HelpSection[] {
  const slug = createSlugger();
  const sections: HelpSection[] = [{ pageId: page.id, pageTitle: page.title, heading: page.title, slug: "", text: "", keywords: page.keywords }];
  let inCode = false;
  for (const line of page.body.split(/\r?\n/u)) {
    if (line.trim().startsWith("```")) inCode = !inCode;
    const heading = inCode ? null : HEADING.exec(line);
    if (heading) {
      const text = heading[2].trim();
      sections.push({ pageId: page.id, pageTitle: page.title, heading: text, slug: slug(text), text: "", keywords: page.keywords });
      continue;
    }
    sections[sections.length - 1].text += `${line}\n`;
  }
  return sections;
}

/** Every whitespace-separated token must appear somewhere. Each token scores
 * where it was found (title 0 < heading 1 < text 2 < keywords 3) and a
 * section ranks by the sum, so two heading/text hits beat two text hits.
 * Keywords are page-wide, so they score worst: otherwise every section of a
 * page ties on them and the page intro beats the section actually meant.
 * Ties keep the input order (callers pass sections in table-of-contents order). */
export function searchHelp(sections: HelpSection[], query: string, limit = 6): HelpSection[] {
  const tokens = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return [];
  const ranked: { section: HelpSection; rank: number }[] = [];
  for (const section of sections) {
    const fields = [section.pageTitle, section.heading, section.text, section.keywords].map((value) => value.toLowerCase());
    let score = 0;
    for (const token of tokens) {
      const where = fields.findIndex((field) => field.includes(token));
      if (where === -1) { score = -1; break; }
      score += where;
    }
    if (score >= 0) ranked.push({ section, rank: score });
  }
  return ranked.sort((a, b) => a.rank - b.rank).slice(0, limit).map((hit) => hit.section);
}
