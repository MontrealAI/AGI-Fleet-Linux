// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inspectEvidence} from './inspect.mjs';

const fixtureURL = new URL('./fixtures/ca626861.json', import.meta.url);
const raw = fs.readFileSync(fixtureURL, 'utf8');
const make = () => JSON.parse(raw);
const inspect = bundle => inspectEvidence(JSON.stringify(bundle));
const sha = value => createHash('sha256').update(value).digest('hex');

test('actual public source + installed receipts yield bounded evidence, not execution authority', () => {
  const {report, custodyTask} = inspectEvidence(raw);
  assert.equal(report.status, 'COMPONENT_EVIDENCE_CHECKED');
  assert.equal(report.executionPerformed, false);
  assert.equal(report.fleetNativeExecutionQualified, false);
  assert.equal(report.productionQualified, false);
  assert.deepEqual(report.authority, []);
  assert.equal(report.businessAccepted, false);
  assert.equal(report.confirmation, false);
  assert.equal(report.settlement, 'NOT_RUN');
  assert.deepEqual([report.records, report.operations, report.installedFiles, report.controls.length], [7, 55, 16, 7]);
  assert.equal(custodyTask.action, 'evidence-inspect');
  assert.equal(custodyTask.review, 'none');
  assert.equal(custodyTask.input.files.length, 5);
  for (const file of custodyTask.input.files) {
    assert.equal(sha(file.content), file.sha256);
    assert.ok(Buffer.byteLength(file.content) <= 300_000);
    assert.match(file.name, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}\.json$/);
  }
});
for (const key of ['repository', 'sourceCommit', 'componentRun', 'componentArtifact', 'componentArchiveSha256',
  'controlsRun', 'controlsArtifact', 'controlsArchiveSha256']) {
  test(`refuse independently changed binding ${key}`, () => {
    const bundle = make(); bundle.binding[key] = typeof bundle.binding[key] === 'number' ? 1 : 'changed';
    assert.throws(() => inspect(bundle), /SOURCE_RUN_ARTIFACT_MISMATCH/);
  });
}
for (const name of ['source.json', 'installed.json', 'layout.json', 'controls.json']) {
  test(`refuse missing ${name}`, () => { const b = make(); delete b.files[name]; assert.throws(() => inspect(b)); });
  test(`refuse same-size tampered ${name}`, () => {
    const b = make(); b.files[name] = ' ' + b.files[name].slice(1);
    assert.throws(() => inspect(b), /EVIDENCE_BYTES_MISMATCH/);
  });
}
for (const [name, mutation] of [
  ['source blocked', r => { r.status = 'BLOCKED'; }],
  ['source not executed', r => { r.candidate_execution.executed = false; }],
  ['wrong program', r => { r.program_sha256 = '0'.repeat(64); }],
  ['wrong cohort', r => { r.cohort_sha256 = '0'.repeat(64); }],
  ['wrong freeze', r => { r.freeze_sha256 = '0'.repeat(64); }],
  ['no negative control', r => { r.negative_control_rejected = false; }],
  ['rejected acceptance', r => { r.separate_acceptance.acceptance = 'REJECTED'; }],
  ['authority inflation', r => { r.separate_acceptance.business_accepted = true; }],
]) test(`refuse ${name}, even when caller reconstructs valid JSON`, () => {
  const b = make(), receipt = JSON.parse(b.files['source.json']); mutation(receipt);
  b.files['source.json'] = JSON.stringify(receipt); assert.throws(() => inspect(b));
});
test('refuse source receipt substituted for installed receipt', () => {
  const b = make(); b.files['installed.json'] = b.files['source.json']; assert.throws(() => inspect(b));
});
test('refuse skipped or absent named isolation control', () => {
  for (const omit of [false, true]) {
    const b = make(), c = JSON.parse(b.files['controls.json']);
    if (omit) c.attempts.pop(); else c.attempts[0].executed = false;
    b.files['controls.json'] = JSON.stringify(c); assert.throws(() => inspect(b));
  }
});
test('refuse extra files, imported authority, duplicate keys and oversized input', () => {
  const extra = make(); extra.files['rogue.json'] = '{}'; assert.throws(() => inspect(extra));
  const authority = make(); authority.authority = ['execute']; assert.throws(() => inspect(authority));
  assert.throws(() => inspectEvidence(raw.replace('"schema":', '"schema":"wrong","schema":')));
  assert.throws(() => inspectEvidence(' '.repeat(200_001)));
});
test('CLI is read-only, fail-closed, and refuses file/parent symlinks', () => {
  const cli = fileURLToPath(new URL('./inspect.mjs', import.meta.url));
  const good = spawnSync(process.execPath, [cli, fileURLToPath(fixtureURL)], {encoding:'utf8'});
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).report.status, 'COMPONENT_EVIDENCE_CHECKED');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-evidence-test-'));
  try {
    const bad = path.join(temp, 'bad.json'); fs.writeFileSync(bad, '{}');
    const failed = spawnSync(process.execPath, [cli, bad], {encoding:'utf8'});
    assert.equal(failed.status, 1); assert.equal(failed.stdout, '');
    assert.equal(JSON.parse(failed.stderr).status, 'REFUSED');
    fs.symlinkSync(fileURLToPath(fixtureURL), path.join(temp, 'link.json'));
    fs.symlinkSync(path.dirname(fileURLToPath(fixtureURL)), path.join(temp, 'parent'));
    for (const candidate of [path.join(temp, 'link.json'), path.join(temp, 'parent', 'ca626861.json')]) {
      const result = spawnSync(process.execPath, [cli, candidate], {encoding:'utf8'});
      assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).code, 'INPUT_SYMLINK');
    }
    assert.deepEqual(fs.readdirSync(temp).sort(), ['bad.json', 'link.json', 'parent']);
  } finally { fs.rmSync(temp, {recursive:true, force:true}); }
});
