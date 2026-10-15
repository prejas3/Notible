import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { UPDATE_NOTES_FILE, releaseNotesSection, shortNotes } from "./release-notes.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const installerUrl = args.get("--url");
const signaturePath = args.get("--sig");
const outputPath = resolve(args.get("--out") || "latest.json");
const notesPath = resolve(args.get("--notes") || UPDATE_NOTES_FILE);
if (!installerUrl || !signaturePath) {
  console.error("Usage: npm run release:manifest -- --url <https-url> --sig <installer.sig> [--notes <file>] [--out <latest.json>]");
  process.exit(1);
}
if (!installerUrl.startsWith("https://")) {
  console.error("The updater URL must use HTTPS.");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const signature = readFileSync(resolve(signaturePath), "utf8").trim();
if (!existsSync(notesPath)) throw new Error(`Notes file does not exist: ${notesPath}`);
const notes = shortNotes(releaseNotesSection(readFileSync(notesPath, "utf8"), pkg.version, notesPath));
const manifest = {
  version: pkg.version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: installerUrl,
    },
  },
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Created ${outputPath} for Notible ${pkg.version}.`);
