// R5 F1: every word must match; a text hit shows its surroundings.
//   node --experimental-strip-types scripts/search-results-check.mjs
import assert from "node:assert/strict";
import { matchesAllWords, snippetFor } from "../src/core/app/search-results.ts";

assert.ok(matchesAllWords(["Shopping", "milk, bread and eggs"], "eggs milk"), "every word, any order");
assert.ok(matchesAllWords(["Shopping", "milk"], "shop mil"), "parts of words");
assert.ok(!matchesAllWords(["Shopping", "milk"], "milk tea"), "a missing word misses");
assert.ok(matchesAllWords(["anything"], "  "), "an empty query matches");
assert.ok(matchesAllWords(["ŁÓDŹ plan"], "łódź"), "Polish case folding");

const long = "We moved the office on Monday. The movers arrived late, but the server rack went first and the kitchen was packed last of all, after the plants, the coffee machine and every box of old files.";
const snippet = snippetFor(long, "rack");
assert.ok(snippet.includes("server rack"), snippet);
assert.ok(snippet.startsWith("…") && snippet.endsWith("…"), `cut both ends: ${snippet}`);
assert.ok(long.includes(` ${snippet.slice(1).split(" ")[0]} `), `starts at a whole word: ${snippet}`);
assert.equal(snippetFor("Short text", "short"), "Short text", "no ellipsis when nothing is cut");
assert.equal(snippetFor("nothing here", "rack"), "", "no snippet when the word is only in the title");
console.log("search-results-check: ok");
