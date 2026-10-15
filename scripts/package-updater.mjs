import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { UPDATE_NOTES_FILE, releaseNotesSection, shortNotes } from "./release-notes.mjs";

function usage(exitCode = 0) {
  console.log(`Usage:
  npm run release:updater-package -- --artifact <bundle.zip> --url <https-url> [options]

Required:
  --artifact <path>  Signed Tauri v2 updater artifact (.exe, .msi, .nsis.zip or .msi.zip)
  --url <url>        Public HTTPS URL at which the copied artifact will be hosted

Options:
  --sig <path>       Signature file (defaults to <artifact>.sig)
  --extra-artifact <path>
                     Additional signed artifact to copy and checksum (repeatable)
  --notes <path>     Release notes file; its "## <version>" section is used
                     (defaults to docs/RELEASE_NOTES.md). Fails if that section is missing.
  --out-dir <path>   Output directory (defaults to release/<version>/updater)
  --help             Show this help
`);
  process.exit(exitCode);
}

const values = new Map();
const extraArtifactArgs = [];
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (key === "--help") usage();
  if (!key.startsWith("--") || index + 1 >= process.argv.length) usage(1);
  if (key === "--extra-artifact") {
    extraArtifactArgs.push(process.argv[++index]);
    continue;
  }
  values.set(key, process.argv[++index]);
}

const artifactArg = values.get("--artifact");
const publicUrl = values.get("--url");
if (!artifactArg || !publicUrl) usage(1);
if (!publicUrl.startsWith("https://")) throw new Error("Updater URL must use HTTPS.");

const artifact = resolve(artifactArg);
const isSupportedArtifact = /\.(exe|msi)$/i.test(artifact) || /\.(nsis|msi)\.zip$/i.test(artifact);
if (!isSupportedArtifact) throw new Error("Expected a Tauri updater artifact ending in .exe, .msi, .nsis.zip or .msi.zip.");
if (!existsSync(artifact)) throw new Error(`Updater artifact does not exist: ${artifact}`);

const signature = resolve(values.get("--sig") || `${artifact}.sig`);
if (!existsSync(signature)) throw new Error(`Updater signature does not exist: ${signature}`);
const signatureText = readFileSync(signature, "utf8").trim();
if (!signatureText) throw new Error(`Updater signature is empty: ${signature}`);

const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const tauri = JSON.parse(readFileSync(resolve("src-tauri/tauri.conf.json"), "utf8"));
if (pkg.version !== tauri.version) throw new Error(`Version mismatch: package.json=${pkg.version}, tauri.conf.json=${tauri.version}`);

// The updater dialog gets this version's section only, never another release's text.
// Read before any copy, so a missing section leaves no half-made package.
const notesPath = resolve(values.get("--notes") || UPDATE_NOTES_FILE);
if (!existsSync(notesPath)) throw new Error(`Notes file does not exist: ${notesPath}`);
const notes = shortNotes(releaseNotesSection(readFileSync(notesPath, "utf8"), pkg.version, notesPath));

const outDir = resolve(values.get("--out-dir") || `release/${pkg.version}/updater`);
mkdirSync(outDir, { recursive: true });
const outputArtifact = resolve(outDir, basename(artifact));
const outputSignature = `${outputArtifact}.sig`;
copyFileSync(artifact, outputArtifact);
copyFileSync(signature, outputSignature);

const extraArtifacts = extraArtifactArgs.map((extraArtifactArg) => {
  const extraArtifact = resolve(extraArtifactArg);
  const extraSupported = /\.(exe|msi)$/i.test(extraArtifact) || /\.(nsis|msi)\.zip$/i.test(extraArtifact);
  if (!extraSupported) throw new Error(`Unsupported extra updater artifact: ${extraArtifact}`);
  if (!existsSync(extraArtifact)) throw new Error(`Extra updater artifact does not exist: ${extraArtifact}`);

  const extraSignature = resolve(`${extraArtifact}.sig`);
  if (!existsSync(extraSignature)) throw new Error(`Extra updater signature does not exist: ${extraSignature}`);
  if (!readFileSync(extraSignature, "utf8").trim()) throw new Error(`Extra updater signature is empty: ${extraSignature}`);

  const outputExtraArtifact = resolve(outDir, basename(extraArtifact));
  copyFileSync(extraArtifact, outputExtraArtifact);
  copyFileSync(extraSignature, `${outputExtraArtifact}.sig`);
  return outputExtraArtifact;
});

const manifest = {
  version: pkg.version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: { "windows-x86_64": { signature: signatureText, url: publicUrl } },
};
writeFileSync(resolve(outDir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const checksumLines = [outputArtifact, ...extraArtifacts].map((outputFile) => {
  const checksum = createHash("sha256").update(readFileSync(outputFile)).digest("hex").toUpperCase();
  return `${checksum}  ${basename(outputFile)}`;
});
writeFileSync(resolve(outDir, "SHA256SUMS"), `${checksumLines.join("\n")}\n`, "utf8");

console.log(`Updater package prepared in ${outDir}`);
console.log(`Artifact: ${basename(outputArtifact)}`);
for (const extraArtifact of extraArtifacts) console.log(`Additional artifact: ${basename(extraArtifact)}`);
console.log("Publish the artifact and latest.json together; keep the .sig file for release auditing.");
