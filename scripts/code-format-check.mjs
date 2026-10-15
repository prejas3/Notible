// CODE-FORMAT (Hive #35): one check per code block format action.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const f = await import(pathToFileURL(resolve(root, "src/core/app/codeFormat.ts")).href);
const run = (action, text) => f.formatCode(action, text);

// JSON pretty print + minify
assert.deepEqual(run("json-pretty", '{"a":1,"b":[true,null]}'), { text: '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}' });
assert.deepEqual(run("json-minify", '{\n  "a": 1.50,\n  "b": "x y"\n}'), { text: '{"a":1.5,"b":"x y"}' }, "1.50 is the same number as 1.5");
assert.deepEqual(run("json-minify", '{"e":1e3,"u":"\\u0041","n":-0.25,"z":0}'), { text: '{"e":1000,"u":"A","n":-0.25,"z":0}' }, "same values in other spellings are not refused");
// JSON safety: invalid, big integers, precision, range, duplicate keys, size
assert.match(run("json-pretty", "{a:1}").error, /not valid JSON/);
assert.match(run("json-pretty", "").error, /not valid JSON/);
assert.deepEqual(run("json-pretty", '{"id":12345678901234567890}').values, { number: "12345678901234567890" }, "integer > 2^53 must be refused");
assert.ok(run("json-pretty", '{"id":9007199254740991}').text, "2^53-1 is safe");
assert.ok(run("json-pretty", '{"id":-9007199254740991}').text, "-(2^53-1) is safe");
assert.deepEqual(run("json-pretty", '{"id":9007199254740992}').values, { number: "9007199254740992" }, "2^53 is past the safe range");
assert.deepEqual(run("json-minify", "[9007199254740994]").values, { number: "9007199254740994" }, "an unsafe integer a double holds exactly is still refused");
assert.ok(run("json-minify", "[1e300,9007199254740994.5e0]").error, "the precision check still runs on non-integer forms");
assert.ok(run("json-minify", "[1e300]").text, "a large number written as an exponent is not an integer token");
assert.match(run("json-minify", "[0.30000000000000000001]").error, /cannot be kept/, "precision loss must be refused");
assert.match(run("json-minify", "[1e400]").error, /cannot be kept/, "overflow must be refused");
assert.match(run("json-minify", "[1e-400]").error, /cannot be kept/, "underflow must be refused");
assert.match(run("json-pretty", '{"a":1,"b":{"a":2},"a":3}').error, /appears twice/, "duplicate key must be refused");
assert.ok(run("json-pretty", '[{"a":1},{"a":2}]').text, "the same key in sibling objects is fine");
assert.ok(run("json-pretty", '{"k\\"ey":"a,b:{c}","x":["\\\\",1]}').text, "escapes and punctuation inside strings do not confuse the scan");
assert.match(run("json-pretty", '{"\\u0061":1,"a":2}').error, /appears twice/, "keys compare decoded");
assert.match(run("json-pretty", `[${"1,".repeat(f.JSON_MAX_CHARS / 2)}1]`).error, /too large/);

// Line tools
assert.deepEqual(run("sort-lines", "b\nc\na"), { text: "a\nb\nc" });
assert.deepEqual(run("dedupe-lines", "a\nb\na\nb\nc"), { text: "a\nb\nc" });
assert.deepEqual(run("trim-trailing", "a  \nb\t\n c "), { text: "a\nb\n c" });
assert.deepEqual(run("join-lines", "  a\n\n b  \nc"), { text: "a b c" });
assert.deepEqual(run("tabs-to-spaces", "\tx\nab\ty"), { text: "    x\nab  y" }, "tabs go to the next tab stop");
assert.deepEqual(run("spaces-to-tabs", "      x  y\n  \tz"), { text: "\t  x  y\n\tz" }, "only leading indent changes");
assert.deepEqual(run("upper-case", "abc ż"), { text: "ABC Ż" });
assert.deepEqual(run("lower-case", "ABC Ż"), { text: "abc ż" });

// Never a line that would close the fence
assert.match(run("sort-lines", "b\n  ```").error, /end the code block/);

// Every action has a check above, and every listed action is runnable.
for (const { id } of f.CODE_FORMAT_ACTIONS) assert.ok("text" in run(id, "[1]") || "error" in run(id, "[1]"), id);

// codeFenceAt: the block the slash command was typed in
const body = "intro\n```json\n{\"a\":1}\n```\nmid\n```\nx\ny\n```\n";
const json = f.codeFenceAt(body, body.indexOf("{"));
assert.deepEqual(json, { lang: "json", start: body.indexOf("{"), end: body.indexOf("}") + 1 });
assert.equal(body.slice(f.codeFenceAt(body, body.indexOf("y")).start, f.codeFenceAt(body, body.indexOf("y")).end), "x\ny");
assert.equal(f.codeFenceAt(body, body.indexOf("mid")), null, "outside a block");
assert.equal(f.codeFenceAt(body, 2), null);

// The "/" menu path: offered only in a code block, JSON only in json; the
// "/filter" text is dropped and the block it was typed in is rewritten.
const c = await import(pathToFileURL(resolve(root, "src/core/app/coreCommands.ts")).href);
const note = 'a\n```json\n{"b":1}/pre\n```\nz /x';
const slash = note.indexOf("/pre");
assert.equal(c.codeFormatCommandOffered("code-format:json-pretty", note, slash), true);
assert.equal(c.codeFormatCommandOffered("code-format:sort-lines", note, slash), true);
assert.equal(c.codeFormatCommandOffered("code-format:sort-lines", note, note.indexOf("/x")), false, "not outside a block");
assert.equal(c.codeFormatCommandOffered("code-format:json-pretty", "```py\nx /j\n```", 8), false, "JSON only in json blocks");
assert.equal(c.codeFormatCommandOffered("heading-1", note, note.indexOf("/x")), true, "other commands untouched");
assert.equal(c.CODE_FORMAT_COMMANDS.length, f.CODE_FORMAT_ACTIONS.length);
const done = c.codeFormatInBody(note, slash, slash + 4, "json-pretty");
assert.equal(done.body, 'a\n```json\n{\n  "b": 1\n}\n```\nz /x');
assert.equal(done.caret, done.body.indexOf("}") + 1, "caret at the end of the block");
const bad = c.codeFormatInBody("```json\n{x/pre\n```", 10, 14, "json-pretty");
assert.deepEqual([bad.body, bad.caret, /not valid/.test(bad.error.error)], ["```json\n{x\n```", 10, true], "refused: only the /filter text goes");
assert.equal(c.codeFormatInBody("plain /s", 6, 8, "sort-lines"), null);

console.log("Code format checks passed.");
