import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { UPDATE_NOTES_FILE, releaseNotesSection, shortNotes } from './release-notes.mjs';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const tauriConfig = JSON.parse(await readFile(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const version = packageJson.version;
const expectedFiles = [
  `Notible_${version}_x64-setup.exe`,
  `Notible_${version}_x64-setup.exe.sig`,
  `Notible_${version}_x64_en-US.msi`,
  `Notible_${version}_x64_en-US.msi.sig`,
  'latest.json',
  'SHA256SUMS',
];

const args = process.argv.slice(2);
const dirFlag = args.indexOf('--dir');
const packageDir = dirFlag >= 0 && args[dirFlag + 1]
  ? path.resolve(root, args[dirFlag + 1])
  : path.join(root, 'release', version, 'updater');

const failures = [];

try {
  const actualFiles = (await readdir(packageDir)).sort();
  const expectedSorted = [...expectedFiles].sort();
  if (actualFiles.join('\n') !== expectedSorted.join('\n')) {
    failures.push(`package must contain exactly: ${expectedFiles.join(', ')}`);
    const unexpected = actualFiles.filter((filename) => !expectedFiles.includes(filename));
    if (unexpected.length > 0) failures.push(`unexpected files: ${unexpected.join(', ')}`);
  }
} catch {
  failures.push(`package directory is missing: ${packageDir}`);
}

for (const filename of expectedFiles) {
  const filePath = path.join(packageDir, filename);
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size === 0) {
      failures.push(`${filename} is missing or empty`);
    }
  } catch {
    failures.push(`${filename} is missing`);
  }
}

try {
  const manifest = JSON.parse(await readFile(path.join(packageDir, 'latest.json'), 'utf8'));
  const installer = expectedFiles[0];
  const endpoint = tauriConfig.plugins?.updater?.endpoints?.[0];
  const expectedUrl = endpoint ? new URL(installer, endpoint).toString() : null;
  const windowsPlatform = manifest.platforms?.['windows-x86_64'];

  if (manifest.version !== version) failures.push(`latest.json version is ${manifest.version}, expected ${version}`);
  if (expectedUrl && windowsPlatform?.url !== expectedUrl) {
    failures.push(`latest.json URL is ${windowsPlatform?.url ?? '<missing>'}, expected ${expectedUrl}`);
  }
  if (!windowsPlatform?.signature) failures.push('latest.json is missing the Windows signature');
  // The notes must be this release's own section (see release-notes.mjs), not an older changelog.
  try {
    const expectedNotes = shortNotes(releaseNotesSection(await readFile(path.join(root, UPDATE_NOTES_FILE), 'utf8'), version));
    if (manifest.notes !== expectedNotes) failures.push(`latest.json notes are not the ${version} section of ${UPDATE_NOTES_FILE}`);
  } catch (error) {
    failures.push(error.message);
  }
} catch (error) {
  failures.push(`latest.json is not valid JSON: ${error.message}`);
}

try {
  const sumsText = await readFile(path.join(packageDir, 'SHA256SUMS'), 'utf8');
  const sumEntries = sumsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([0-9a-f]{64})\s+(.+)$/i);
      return match ? { hash: match[1].toUpperCase(), filename: match[2] } : null;
    });

  if (sumEntries.length !== 2) failures.push('SHA256SUMS must contain exactly the NSIS and MSI installer entries');

  for (const installer of [expectedFiles[0], expectedFiles[2]]) {
    const entry = sumEntries.find((candidate) => candidate?.filename === installer);
    if (!entry) {
      failures.push(`SHA256SUMS is missing ${installer}`);
      continue;
    }
    const content = await readFile(path.join(packageDir, installer));
    const actualHash = createHash('sha256').update(content).digest('hex').toUpperCase();
    if (entry.hash !== actualHash) failures.push(`SHA256SUMS hash mismatch for ${installer}`);
  }
} catch (error) {
  failures.push(`SHA256SUMS could not be read: ${error.message}`);
}

if (failures.length > 0) {
  console.error(`Updater package validation failed for ${packageDir}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Updater package is complete and verified: ${packageDir}`);
console.log(`- ${expectedFiles.join(', ')}`);
