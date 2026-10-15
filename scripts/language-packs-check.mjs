import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const { validateLanguageCatalog, repoFromInput, isValidRepo, isOfficialReleaseUrl } = await import(pathToFileURL(resolve(root, "src/core/app/marketSource.ts")).href);

// --- catalogue ---------------------------------------------------------------
const good = { schemaVersion: 1, generatedAt: "2026-09-21T00:00:00Z", languages: [
  { locale: "de", name: "Deutsch", author: "Ada", description: "German", repo: "ada/notible-de", version: "1.0.0" },
  { locale: "pt-BR", name: "Português (Brasil)", author: "Bo", repo: "bo/notible-pt-br" },
] };
const parsed = validateLanguageCatalog(good);
assert.deepEqual(parsed.map((entry) => entry.locale), ["de", "pt-BR"]);
assert.equal(parsed[0].version, "1.0.0");
assert.equal(parsed[1].version, null, "a missing version is unknown, not invalid");

// One bad row costs that row, not the list; English can never be offered.
const messy = { schemaVersion: 1, generatedAt: "x", languages: [
  { locale: "en", name: "English", author: "x", repo: "a/b" },
  { locale: "../x", name: "Bad", author: "x", repo: "a/b" },
  { locale: "fr", name: "Français", author: "x", repo: "a/../b" },
  { locale: "es", name: "Español", author: "x", repo: "a/b" },
  { locale: "es", name: "Duplicate", author: "x", repo: "a/c" },
  "junk",
] };
assert.deepEqual(validateLanguageCatalog(messy).map((entry) => entry.locale), ["es"]);
assert.throws(() => validateLanguageCatalog({ schemaVersion: 2, languages: [] }), /schema/);
assert.throws(() => validateLanguageCatalog(null), /not an object/);

// --- repository input -------------------------------------------------------------
assert.equal(repoFromInput("ada/notible-de"), "ada/notible-de");
assert.equal(repoFromInput("  https://github.com/ada/notible-de/  "), "ada/notible-de");
assert.equal(repoFromInput("https://github.com/ada/notible-de.git"), "ada/notible-de");
assert.equal(repoFromInput("https://github.com/ada/notible-de/releases/tag/v1"), "ada/notible-de");
assert.equal(repoFromInput("https://evil.example/ada/notible-de"), null, "only github.com is accepted");
assert.equal(repoFromInput("ada"), null);
assert.equal(repoFromInput("../etc/passwd"), null);
assert.equal(isValidRepo("a/.."), false);

// "Official" is decided from the download URL, never from what a plugin says about itself.
assert.equal(isOfficialReleaseUrl("https://github.com/prejas3/notible-graph/releases/latest/download/notible.graph.zip"), true);
assert.equal(isOfficialReleaseUrl("https://github.com/PreJas3/x/releases/download/v1/x.zip"), true, "owner compared case-insensitively");
assert.equal(isOfficialReleaseUrl("https://github.com/someone/notible-graph/releases/download/v1/x.zip"), false);
assert.equal(isOfficialReleaseUrl("https://evil.example/prejas3/x.zip"), false);
assert.equal(isOfficialReleaseUrl("https://github.com.evil.example/prejas3/x.zip"), false);
assert.equal(isOfficialReleaseUrl("http://github.com/prejas3/x.zip"), false);
assert.equal(isOfficialReleaseUrl(null), false);

console.log("Language pack checks passed.");
