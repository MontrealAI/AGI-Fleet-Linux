import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Derived from the size/SHA-256-verified 1.0.9 ZIP, not the changing source mirror.
export const FROZEN_RELEASE = Object.freeze({
  version: '1.0.9',
  sha256: '5e17bac752ae8dfc8756fe8dc612ceb8820616723808232f3541d552addce102',
  manifestSHA256: '575b06be5344efaa861b8c5fe22fe48cfc9d97aa0edd29d474ff2218152758f6',
  sourceRevisionSHA256: '0bf5b82329a7f743759fa7f8a6383ef985df286f3c702143719b8667c5051f97',
  sourceFiles: 4816,
  manifestEntries: 32900,
});
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;

// An explicit identity allows small test fixtures. The observer always uses the frozen default.
export function verifyMaterializedFleet(directory, identity = FROZEN_RELEASE) {
  const root = path.resolve(directory);
  assert.ok(fs.lstatSync(root).isDirectory() && fs.realpathSync(root) === root,
    'Fleet must be a canonical directory without symbolic links');
  const regular = name => {
    assert.ok(typeof name === 'string' && name.length > 0 && !name.includes('\\')
      && !name.includes('\0') && name.split('/').every(part => part && part !== '.' && part !== '..'),
    'Unsafe release path');
    const file = path.join(root, name), stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && fs.realpathSync(file) === file && stat.size < 450000000,
      'Unsafe release file: ' + name);
    return { file, stat };
  };
  const manifest = regular('MANIFEST.sha256');
  assert.ok(manifest.stat.size <= 10000000, 'Manifest exceeds the size limit');
  const manifestBytes = fs.readFileSync(manifest.file);
  assert.equal(digest(manifestBytes), identity.manifestSHA256, 'Frozen manifest identity differs');
  const expected = new Set(['MANIFEST.sha256']);
  for (const line of manifestBytes.toString('utf8').trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    assert.ok(match && !expected.has(match[2]), 'Invalid or duplicate manifest entry');
    const [, hash, name] = match;
    expected.add(name);
    const { file } = regular(name);
    assert.equal(digest(fs.readFileSync(file)), hash, 'Release file differs: ' + name);
  }
  assert.equal(expected.size - 1, identity.manifestEntries, 'Manifest coverage differs');
  // Extra files can shadow package imports even when all listed source hashes match.
  let count = 0;
  const walk = relative => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(name);
      else {
        assert.ok(entry.isFile() && expected.has(name), 'Unexpected release file: ' + name);
        count++;
      }
    }
  };
  walk('');
  assert.equal(count, expected.size, 'Materialized release coverage differs');
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'source-inventory.json')));
  assert.equal(inventory.schema, 'agi-source-inventory/v1', 'Source inventory schema differs');
  assert.equal(inventory.revisionSHA256, identity.sourceRevisionSHA256, 'Frozen source identity differs');
  assert.equal(digest(JSON.stringify(ordered(inventory.files))), identity.sourceRevisionSHA256,
    'Source inventory fingerprint differs');
  assert.equal(inventory.files.length, identity.sourceFiles, 'Source coverage differs');
  const seen = new Set();
  for (const row of inventory.files) {
    assert.ok(expected.has(row.path) && !seen.has(row.path), 'Invalid source inventory entry');
    seen.add(row.path);
    const { file, stat } = regular(row.path);
    assert.equal(digest(fs.readFileSync(file)), row.sha256, 'Source file differs: ' + row.path);
    assert.equal(Boolean(stat.mode & 0o111), row.executable, 'Source mode differs: ' + row.path);
  }
  return { status: 'PASS', fleetVersion: identity.version, fleetSHA256: identity.sha256,
    manifestSHA256: identity.manifestSHA256, manifestEntriesVerified: count - 1,
    sourceRevisionSHA256: inventory.revisionSHA256, sourceFilesVerified: inventory.files.length,
    rpcRequests: 0, transactionsSent: 0, productionQualified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.version, 'v24.21.0', 'Use the release-pinned Node 24.21.0');
    assert.ok(process.argv.length === 4 && process.argv[2] === '--fleet',
      'Usage: node engineering/verify-mainnet-source.mjs --fleet /absolute/materialized/Fleet');
    console.log(JSON.stringify(verifyMaterializedFleet(process.argv[3]), null, 2));
  } catch (error) {
    console.error(error instanceof assert.AssertionError ? error.message : 'Materialized Fleet verification failed');
    process.exitCode = 1;
  }
}
