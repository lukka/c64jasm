// scripts/vendor-core.js
//
// Fork-only tooling (NEVER upstream): builds the core c64jasm package and
// vendors it into the VS Code extension at vscode/vendor/c64jasm.tgz.
//
// Why a distinct version:
//   The public npm package `c64jasm` (https://www.npmjs.com/package/c64jasm)
//   ships the SAME base version (e.g. 0.9.2) that this repo builds locally, but
//   with different bytes. Embedding a local build under the identical
//   name+version invites provenance/SBOM confusion and dependency-confusion
//   risk (if the `file:` spec were ever broken, npm could silently pull the
//   different public 0.9.2). To prevent that, the vendored/embedded build is
//   packed under a DISTINCT, fork-local version: `<coreVersion>-<suffix>`
//   (default suffix `lukka`). A fork-local prerelease can never be satisfied by
//   the public registry, so any accidental registry resolution fails loudly.
//
//   The committed core package.json version is left UNTOUCHED (restored
//   byte-for-byte after `npm pack`), so upstream publishing is unaffected.
//
// This also mirrors the Unix-only `npm run dist` steps in a cross-platform way,
// so it works locally on Windows as well as in CI.
//
// Usage (from repo root, after `npm ci`):
//   node scripts/vendor-core.js
//   (then `npm install` inside ./vscode to refresh its lockfile)

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const suffix = process.env.C64JASM_VENDOR_SUFFIX || 'lukka';

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}
function rel(...p) {
  return path.join(repoRoot, ...p);
}

if (!fs.existsSync(rel('node_modules'))) {
  console.error('Root dependencies missing. Run `npm ci` at the repo root first.');
  process.exit(1);
}

// 1) Build dist/ (cross-platform equivalent of the Unix-only `npm run dist`).
fs.rmSync(rel('dist'), { recursive: true, force: true });
fs.mkdirSync(rel('build', 'src'), { recursive: true });
fs.mkdirSync(rel('dist', 'src'), { recursive: true });
run('npx pegjs -o build/src/g_parser.js src/parser.pegjs'); // === `npm run gen`
fs.copyFileSync(rel('build', 'src', 'g_parser.js'), rel('dist', 'src', 'g_parser.js'));
run('npx tsc -p tsconfig.dist.json');

// 2) Pack the core under a distinct fork-local version, then restore
//    package.json byte-for-byte so the committed file is never changed.
const pkgPath = rel('package.json');
const pkgText = fs.readFileSync(pkgPath, 'utf8');
const baseVersion = JSON.parse(pkgText).version;
const vendorVersion = `${baseVersion}-${suffix}`;

// Remove any stale tarballs so the freshly packed one is unambiguous.
for (const f of fs.readdirSync(repoRoot)) {
  if (/^c64jasm-.*\.tgz$/.test(f)) fs.rmSync(rel(f), { force: true });
}

try {
  const patched = pkgText.replace(/("version"\s*:\s*")[^"]+(")/, `$1${vendorVersion}$2`);
  if (patched === pkgText) throw new Error('Could not find a "version" field in package.json');
  fs.writeFileSync(pkgPath, patched);
  run('npm pack');
} finally {
  fs.writeFileSync(pkgPath, pkgText); // restore original bytes (no committed change)
}

// 3) Move the packed tarball to the fixed vendor path the extension depends on.
const tgz = fs.readdirSync(repoRoot).find((f) => /^c64jasm-.*\.tgz$/.test(f));
if (!tgz) throw new Error('npm pack did not produce a c64jasm-*.tgz');
fs.mkdirSync(rel('vscode', 'vendor'), { recursive: true });
fs.rmSync(rel('vscode', 'vendor', 'c64jasm.tgz'), { force: true });
fs.renameSync(rel(tgz), rel('vscode', 'vendor', 'c64jasm.tgz'));

// 4) Point the vscode lockfile's file: entry at the new build: drop the stale
//    integrity (so `npm install` re-derives it and avoids the "corrupted
//    tarball" mismatch) and record the new version.
const lockPath = rel('vscode', 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const entry = lock.packages && lock.packages['node_modules/c64jasm'];
if (entry) {
  delete entry.integrity;
  entry.version = vendorVersion;
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
}

// 5) Remove any previously installed copy. npm will not re-extract a file: dep
//    whose lockfile version still matches what is already in node_modules, so
//    without this the next install would keep the stale version.
fs.rmSync(rel('vscode', 'node_modules', 'c64jasm'), { recursive: true, force: true });

console.log(`\nVendored c64jasm@${vendorVersion} -> vscode/vendor/c64jasm.tgz`);
console.log('Next: run `npm install` in ./vscode to refresh its lockfile.');
