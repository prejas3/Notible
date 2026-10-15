/** Heading text → URL-safe slug. Shared by the renderer, search and help-check,
 * so a `help:page#slug` link, a search hit and the rendered id always agree. */
export function slugify(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9 ]+/gu, "").trim().replace(/ +/gu, "-");
}

/** Slugs for one page, in document order: repeats get -2, -3, … */
export function createSlugger(): (heading: string) => string {
  const seen = new Map<string, number>();
  return (heading) => {
    const base = slugify(heading);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };
}
