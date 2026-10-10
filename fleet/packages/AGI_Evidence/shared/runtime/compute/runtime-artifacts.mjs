import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw Error('OPENCLAW_ARTIFACT_MISMATCH'); };
export const runtimeArtifactLock = Object.freeze(JSON.parse(fs.readFileSync(new URL('./runtime-artifacts.lock.json', import.meta.url), 'utf8')));
const inventoryBytes = fs.readFileSync(new URL('./openclaw-2026.9.5.inventory.json', import.meta.url));
if (sha(inventoryBytes) !== runtimeArtifactLock.openclaw.inventorySHA256) fail();
const officialInventory = JSON.parse(inventoryBytes);

// This verifies the official package-owned bytes, not all externally installed
// npm dependencies. Run at admission before invoking/importing OpenClaw; normal
// requests retain the existing sealed executable drift check.
export function verifyRuntimeArtifact(openclawExecutable, {
  platform = process.platform,
  allowedOwner = owner => owner === 0 || owner === process.getuid?.(),
  artifactLock = runtimeArtifactLock,
  inventory = officialInventory
} = {}) {
  try {
    const entry = fs.realpathSync(openclawExecutable), packageRoot = path.dirname(entry);
    if (path.basename(entry) !== 'openclaw.mjs' || inventory.schema !== 'agi-package-file-inventory/v1' || inventory.package !== 'openclaw' || inventory.version !== artifactLock.openclaw.version) fail();
    const directories = new Set();
    const trustedDirectory = directory => {
      if (directories.has(directory)) return;
      const s = fs.lstatSync(directory);
      if (!s.isDirectory() || s.isSymbolicLink() || !allowedOwner(s.uid, directory) || ((s.mode & 0o002) || ((s.mode & 0o020) && !(platform === 'darwin' && s.gid === 80)))) fail();
      if (directory !== packageRoot) trustedDirectory(path.dirname(directory));
      directories.add(directory);
    };
    trustedDirectory(packageRoot);
    const optional = new Set(inventory.optionalAbsent ?? []), expected = inventory.files;
    if (!expected || !Object.hasOwn(expected, 'package.json') || !Object.hasOwn(expected, 'openclaw.mjs')) fail();
    let verifiedFiles = 0;
    for (const [relative, record] of Object.entries(expected)) {
      if (relative.startsWith('/') || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..') || !/^[a-f0-9]{64}$/.test(record.sha256)) fail();
      const file = path.join(packageRoot, relative);
      trustedDirectory(path.dirname(file));
      let s;
      try { s = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT' && optional.has(relative)) continue; throw error; }
      if (!s.isFile() || s.isSymbolicLink() || !allowedOwner(s.uid, file) || ((s.mode & 0o002) || ((s.mode & 0o020) && !(platform === 'darwin' && s.gid === 80))) || s.size !== record.bytes) fail();
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const before = fs.fstatSync(fd), bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
        if (before.ino !== s.ino || before.dev !== s.dev || before.size !== s.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size || sha(bytes) !== record.sha256) fail();
      } finally { fs.closeSync(fd); }
      verifiedFiles++;
    }
    // npm's root dependency directory is a separate closure. Package-owned
    // files inside it were verified above; extra dependencies are not attested.
    const extraRootAllowed = new Set(inventory.extraRootAllowed ?? []);
    const walk = (directory, prefix = '') => {
      for (const item of fs.readdirSync(directory, {withFileTypes: true})) {
        if (!prefix && extraRootAllowed.has(item.name)) continue;
        const relative = prefix + item.name, file = path.join(directory, item.name);
        if (item.isSymbolicLink()) fail();
        if (item.isDirectory()) { trustedDirectory(file); walk(file, relative + '/'); }
        else if (!item.isFile() || !Object.hasOwn(expected, relative)) fail();
      }
    };
    walk(packageRoot);
    const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    if (metadata.name !== 'openclaw' || metadata.version !== artifactLock.openclaw.version) fail();
    const sdk = artifactLock.openclaw.providerAuthSDK;
    if (!sdk || expected[sdk.path]?.sha256 !== sdk.sha256) fail();
    return {schema: 'agi-openclaw-artifact/v1', version: metadata.version, packageRoot, verifiedFiles,
      packageInventorySha256: artifactLock.openclaw.inventorySHA256,
      packageTarballSha256: artifactLock.openclaw.tarballSHA256,
      providerAuthSDK: {path: path.join(packageRoot, sdk.path), sha256: sdk.sha256},
      externalDependencyClosureVerified: false};
  } catch { fail(); }
}
