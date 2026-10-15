// RELEASE-SAFETY (Hive #15): tells a debug-assertions exe from a real release
// one by DEBUG_BUILD_MARKER (src-tauri/src/sandbox.rs), which is compiled in
// only under cfg(debug_assertions).
//
//   node scripts/debug-build-marker.cjs --release <exe>   exit 1 if <exe> has debug-assertions
//
// The sandbox (scripts/cdp/sandbox.cjs) uses hasDebugMarker the other way round.
const fs = require('fs');

const MARKER = 'NOTIBLE-DEBUG-ASSERTIONS-BUILD:5b1e9c';
const hasDebugMarker = (file) => fs.readFileSync(file).includes(MARKER);

module.exports = { MARKER, hasDebugMarker };

if (require.main === module) {
  const [mode, exe] = process.argv.slice(2);
  if (mode !== '--release' || !exe) {
    console.error('usage: node scripts/debug-build-marker.cjs --release <exe>');
    process.exit(2);
  }
  if (hasDebugMarker(exe)) {
    console.error(`${exe} was built with debug-assertions (for example through RUSTFLAGS): it exposes debug-only commands and must not ship.`);
    process.exit(1);
  }
  console.log(`${exe}: no debug-assertions marker.`);
}
