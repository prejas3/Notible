// Release notes for latest.json: only the section of the version being
// released, from docs/RELEASE_NOTES.md (the same file Settings → About shows).
// CHANGELOG.md is not read: it stopped at 0.77.5 and shipped stale notes.

export const UPDATE_NOTES_FILE = "docs/RELEASE_NOTES.md";
// Cap raised to 8000: a whole 0.97.0-size section must reach latest.json.
// ponytail: plain character cap, no markdown parsing.
export const UPDATE_NOTES_LIMIT = 8000;
const MORE = "\n…";

export function releaseNotesSection(markdown, version, source = UPDATE_NOTES_FILE) {
  const heading = `## ${version}`;
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) throw new Error(`${source} has no "${heading}" section. Add it before releasing ${version}; latest.json is not written with stale notes.`);
  let end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join("\n").trim();
  if (!body) throw new Error(`The "${heading}" section in ${source} is empty.`);
  return body;
}

// Keeps whole lines while they fit; a first line that alone is too long is cut at a word.
export function shortNotes(body, limit = UPDATE_NOTES_LIMIT) {
  if (body.length <= limit) return body;
  const kept = [];
  let size = 0;
  for (const line of body.split("\n")) {
    if (size + line.length + 1 > limit - MORE.length) break;
    kept.push(line);
    size += line.length + 1;
  }
  if (kept.length === 0) return `${body.slice(0, limit - MORE.length).replace(/\s+\S*$/, "")}${MORE}`;
  return `${kept.join("\n").trimEnd()}${MORE}`;
}
