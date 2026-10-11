import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FROZEN_RELEASE, verifyMaterializedFleet } from '../verify-mainnet-source.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fleet-observer-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'release');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/ethers'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/main.mjs'), '// frozen source\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'node_modules/ethers/index.js'), '// frozen dependency\n');
  const files = [{ executable: true, path: 'src/main.mjs', sha256: hash('// frozen source\n') }];
  const revisionSHA256 = hash(JSON.stringify(files));
  fs.writeFileSync(path.join(root, 'source-inventory.json'), JSON.stringify({
    schema: 'agi-source-inventory/v1', revisionSHA256, files,
  }));
  const names = ['src/main.mjs', 'source-inventory.json', 'node_modules/ethers/index.js'];
  const manifest = names.map(name => hash(fs.readFileSync(path.join(root, name))) + '  ' + name + '\n').join('');
  fs.writeFileSync(path.join(root, 'MANIFEST.sha256'), manifest);
  return { root, parent, identity: { version: 'fixture', sha256: 'fixture',
    manifestSHA256: hash(manifest), sourceRevisionSHA256: revisionSHA256,
    sourceFiles: files.length, manifestEntries: names.length } };
}

test('verification follows the selected materialization, independent of the current source mirror', t => {
  const { root, identity } = fixture(t);
  const result = verifyMaterializedFleet(root, identity);
  assert.equal(result.status, 'PASS');
  assert.equal(result.sourceFilesVerified, 1);
  assert.equal(result.manifestEntriesVerified, 3);
  assert.equal(result.rpcRequests, 0);
  assert.equal(result.transactionsSent, 0);
  assert.equal(result.productionQualified, false);
  assert.throws(() => verifyMaterializedFleet(root), /Frozen manifest identity differs/);
  assert.equal(FROZEN_RELEASE.sourceRevisionSHA256,
    '0bf5b82329a7f743759fa7f8a6383ef985df286f3c702143719b8667c5051f97');
});

for (const name of ['src/main.mjs', 'node_modules/ethers/index.js', 'source-inventory.json']) {
  test('changed bytes are rejected before imports: ' + name, t => {
    const { root, identity } = fixture(t);
    fs.appendFileSync(path.join(root, name), 'changed');
    assert.throws(() => verifyMaterializedFleet(root, identity), /Release file differs/);
  });
}

test('a replaced manifest cannot authorize changed dependencies', t => {
  const { root, identity } = fixture(t);
  fs.writeFileSync(path.join(root, 'MANIFEST.sha256'), '0'.repeat(64) + '  src/main.mjs\n');
  assert.throws(() => verifyMaterializedFleet(root, identity), /Frozen manifest identity differs/);
});

test('executable mode changes and missing dependencies are rejected', t => {
  const { root, identity } = fixture(t);
  fs.chmodSync(path.join(root, 'src/main.mjs'), 0o644);
  assert.throws(() => verifyMaterializedFleet(root, identity), /Source mode differs/);
  fs.chmodSync(path.join(root, 'src/main.mjs'), 0o755);
  fs.unlinkSync(path.join(root, 'node_modules/ethers/index.js'));
  assert.throws(() => verifyMaterializedFleet(root, identity), { code: 'ENOENT' });
});

test('unlisted files that could change module resolution are rejected', t => {
  const { root, identity } = fixture(t);
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  assert.throws(() => verifyMaterializedFleet(root, identity), /Unexpected release file/);
});

test('symlinked files, parent directories and roots are rejected even with identical bytes', t => {
  const { root, parent, identity } = fixture(t);
  const source = path.join(root, 'src/main.mjs'), outside = path.join(parent, 'same.mjs');
  fs.renameSync(source, outside);
  fs.symlinkSync(outside, source);
  assert.throws(() => verifyMaterializedFleet(root, identity), /Unsafe release file/);
  fs.unlinkSync(source);
  fs.renameSync(outside, source);
  fs.renameSync(path.join(root, 'src'), path.join(parent, 'sources'));
  fs.symlinkSync(path.join(parent, 'sources'), path.join(root, 'src'), 'dir');
  assert.throws(() => verifyMaterializedFleet(root, identity), /Unsafe release file/);
  fs.symlinkSync(root, path.join(parent, 'alias'), 'dir');
  assert.throws(() => verifyMaterializedFleet(path.join(parent, 'alias'), identity), /canonical directory/);
});

test('manifest traversal cannot read outside the release', t => {
  const { root, identity } = fixture(t);
  const manifest = hash('outside') + '  ../outside\n';
  fs.writeFileSync(path.join(root, 'MANIFEST.sha256'), manifest);
  assert.throws(() => verifyMaterializedFleet(root, { ...identity, manifestSHA256: hash(manifest) }),
    /Unsafe release path/);
});
