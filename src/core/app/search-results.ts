/**
 * Search in the sidebar (R5 F1). Every word of the query must appear somewhere in the item —
 * title, text or fields, in any order, also as part of a word ("mil" finds Milk) — and a hit in
 * the text shows the words around it.
 */
export function searchWords(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
}

export function matchesAllWords(parts: readonly string[], query: string): boolean {
  const words = searchWords(query);
  if (words.length === 0) return true;
  const haystack = parts.join("\n").toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** The text around the first word found, on one line, with "…" where it was cut. Empty when no word is in the text. */
export function snippetFor(text: string, query: string, before = 32, after = 72): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  const lower = flat.toLocaleLowerCase();
  let at = -1;
  for (const word of searchWords(query)) {
    const index = lower.indexOf(word);
    if (index !== -1 && (at === -1 || index < at)) at = index;
  }
  if (at === -1) return "";
  const start = Math.max(0, at - before);
  const end = Math.min(flat.length, at + after);
  // Cut at word boundaries, so the snippet doesn't start or end mid-word.
  const from = start === 0 ? 0 : flat.indexOf(" ", start) + 1 || start;
  const toSpace = flat.lastIndexOf(" ", end);
  const to = end >= flat.length ? flat.length : toSpace > at ? toSpace : end;
  return `${from > 0 ? "…" : ""}${flat.slice(from, to)}${to < flat.length ? "…" : ""}`;
}
