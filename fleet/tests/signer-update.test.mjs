import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { prepareUpdate, applyUpdate, rollbackUpdate, verifyPackage } from '../scripts/update-signer.mjs';
const address = '0x' + '12'.repeat(20);
const uid = process.getuid();
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data), { mode: 0o600 }); }
function manifest(root) {
  const files = [];
  const visit = dir => { for (const name of fs.readdirSync(dir).sort()) { const file = path.join(dir, name); if (file === path.join(root, 'MANIFEST.sha256')) continue; if (fs.statSync(file).isDirectory()) visit(file); else files.push(sha(fs.readFileSync(file)) + '  ' + path.relative(root, file).split(path.sep).join('/')); } };
  visit(root); write(path.join(root, 'MANIFEST.sha256'), files.join('\n') + '\n');
}
function fixture(t, role = 'agent', fleet = false) {
  const accountHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agi-signer-update-')));
  t.after(() => fs.rmSync(accountHome, { recursive: true, force: true }));
  const installed = path.join(accountHome, fleet ? 'Fleet/packages/AGI_Agent' : 'installed');
  const source = path.join(accountHome, 'source'), profile = path.join(accountHome, 'profile');
  const old = role === 'agent' ? '1.25.2' : role === 'node' ? '2.26.2' : '1.0.2';
  const next = role === 'agent' ? '1.25.6' : role === 'node' ? '2.26.6' : '1.0.6';
  const name = ['agent', 'node'].includes(role) ? 'montreal-ai-private-agi-' + role : 'montreal-ai-agi-' + role;
  for (const [root, version] of [[installed, old], [source, next]]) {
    write(path.join(root, 'package.json'), { name, version }); write(path.join(root, 'src/launch.mjs'), 'export const version = ' + JSON.stringify(version) + ';\n');
    if (!['agent', 'node'].includes(role)) write(path.join(root, 'config/operator-role.json'), { schema: 'agi-fleet-operator-role/v1', role });
    manifest(root);
  }
  write(path.join(profile, 'release-profile.json'), { schema: 1, role, version: old, id: crypto.randomUUID(), expectedAddress: role === 'evidence' ? null : address });
  if (['agent', 'node'].includes(role)) { write(path.join(profile, role + '.config.json'), { dataDir: 'data', [role === 'agent' ? 'agent' : 'validator']: address }); fs.mkdirSync(path.join(profile, 'data'), { mode: 0o700 }); }
  else write(path.join(profile, 'config.json'), { role, wallet: role === 'evidence' ? null : address });
  write(path.join(profile, 'vault.json'), { encrypted: 'synthetic-encrypted-fixture-no-real-key' });
  write(path.join(profile, 'consent.json'), { revoked: true });
  write(path.join(profile, 'journal.json'), { transactions: ['fixture-confirmed'], reserved: 7 });
  if (fleet) { write(path.join(accountHome, 'Fleet/package.json'), { name: 'montreal-ai-autonomous-fleet', version: '1.19.2' }); manifest(path.join(accountHome, 'Fleet')); }
  return { accountHome, installed, source, profile, role, uid, expectedAddress: address };
}
test('apply preserves wallet, revocations, journals and allowance bytes; prelaunch rollback changes code only and retains audit', async t => {
  const f = fixture(t), before = fs.readFileSync(path.join(f.profile, 'journal.json'));
  const ctx = await prepareUpdate(f); t.after(ctx.release);
  assert.throws(() => applyUpdate(ctx, 'wrong'), /UPDATE_EXACT_APPROVAL_REQUIRED/);
  assert.equal(applyUpdate(ctx, ctx.approval).status, 'APPLIED');
  assert.deepEqual(fs.readFileSync(path.join(f.profile, 'journal.json')), before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.profile, 'consent.json'))).revoked, true);
  assert.equal(verifyPackage(f.installed).package.version, '1.25.6');
  ctx.release();
  const beforeEvents = fs.readdirSync(ctx.transaction).filter(x => x.startsWith('event-'));
  assert.equal(rollbackUpdate(ctx.transaction, ctx.approval, f).status, 'ROLLED_BACK_CODE_ONLY');
  assert.equal(verifyPackage(f.installed).package.version, '1.25.2');
  for (const file of beforeEvents) assert.ok(fs.existsSync(path.join(ctx.transaction, file)));
  assert.deepEqual(fs.readFileSync(path.join(f.profile, 'journal.json')), before);
  assert.ok(fs.existsSync(path.join(ctx.transaction, 'rejected-code')));
});
test('native SQLite backup retains committed WAL records with integrity evidence', async t => {
  const f = fixture(t), dbfile = path.join(f.profile, 'data/agent.sqlite');
  const db = new DatabaseSync(dbfile); t.after(() => db.close()); fs.chmodSync(dbfile, 0o600);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE records(value TEXT); INSERT INTO records VALUES (\'committed-in-wal\');');
  const ctx = await prepareUpdate(f); t.after(ctx.release);
  const snapshot = new DatabaseSync(path.join(ctx.transaction, 'profile-snapshot/data/agent.sqlite'), { readOnly: true });
  assert.equal(snapshot.prepare('SELECT value FROM records').get().value, 'committed-in-wal'); snapshot.close();
  const evidence = JSON.parse(fs.readFileSync(path.join(ctx.transaction, 'snapshot.json')));
  assert.equal(evidence.methods.find(x => x.path === 'data/agent.sqlite').method, 'sqlite-native-backup-integrity-checked');
  assert.equal(fs.statSync(path.join(ctx.transaction, 'profile-snapshot/vault.json')).mode & 0o777, 0o600);
  ctx.release();
});
test('profile mutation after staging refuses apply without altering installed code', async t => {
  const f = fixture(t), ctx = await prepareUpdate(f); t.after(ctx.release);
  write(path.join(f.profile, 'journal.json'), { transactions: ['new-external-transaction'] });
  assert.throws(() => applyUpdate(ctx, ctx.approval), /UPDATE_PROFILE_CHANGED_REVIEW_REQUIRED/);
  assert.equal(verifyPackage(f.installed).package.version, '1.25.2');
  ctx.release();
});
test('rollback refuses changed allowances, consent or postlaunch profile without deleting new audit', async t => {
  const f = fixture(t), ctx = await prepareUpdate(f); t.after(ctx.release);
  applyUpdate(ctx, ctx.approval); ctx.release();
  write(path.join(f.profile, 'consent.json'), { revoked: true, revocationAt: 17 });
  assert.throws(() => rollbackUpdate(ctx.transaction, ctx.approval, f), /UPDATE_PROFILE_CHANGED_REVIEW_REQUIRED/);
  assert.equal(verifyPackage(f.installed).package.version, '1.25.6');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.profile, 'consent.json'))).revocationAt, 17);
});
test('source and staged code tampering cannot pass exact approval', async t => {
  const f = fixture(t), ctx = await prepareUpdate(f); t.after(ctx.release);
  write(path.join(ctx.plan.stage, 'src/launch.mjs'), 'tampered');
  assert.throws(() => applyUpdate(ctx, ctx.approval), /UPDATE_PACKAGE_HASH_MISMATCH/);
  assert.equal(verifyPackage(f.installed).package.version, '1.25.2');
  ctx.release();
});
test('unknown untracked package state and symlinks are refused', t => {
  const f = fixture(t); write(path.join(f.source, 'private-untracked.json'), '{}');
  assert.throws(() => verifyPackage(f.source), /UPDATE_UNTRACKED_OR_MISSING_PACKAGE_FILES/);
  fs.unlinkSync(path.join(f.source, 'private-untracked.json')); fs.symlinkSync(path.join(f.profile, 'vault.json'), path.join(f.source, 'secret-link'));
  assert.throws(() => verifyPackage(f.source), /UPDATE_SYMLINK_REFUSED/);
});
test('wrong wallet, external data and unsupported version transitions fail before mutation', async t => {
  const f = fixture(t);
  await assert.rejects(prepareUpdate({ ...f, expectedAddress: '0x' + '34'.repeat(20) }), /UPDATE_WALLET_MISMATCH/);
  write(path.join(f.profile, 'agent.config.json'), { dataDir: '../external', agent: address });
  await assert.rejects(prepareUpdate(f), /UPDATE_EXTERNAL_DATA_DIRECTORY_REQUIRES_REVIEW/);
  write(path.join(f.source, 'package.json'), { name: 'montreal-ai-private-agi-agent', version: '9.0.0' }); manifest(f.source);
  await assert.rejects(prepareUpdate(f), /UPDATE_VERSION_TRANSITION_UNSUPPORTED/);
  assert.equal(fs.existsSync(path.join(f.profile, 'application.lock')), false);
});
test('live or stale application and worker locks remain intact', async t => {
  const f = fixture(t); write(path.join(f.profile, 'application.lock'), { pid: process.pid });
  await assert.rejects(prepareUpdate(f), /UPDATE_CLOSE_SIGNER_AND_WORKER_FIRST/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.profile, 'application.lock'))).pid, process.pid);
  fs.unlinkSync(path.join(f.profile, 'application.lock')); write(path.join(f.profile, 'data/RUNNING.lock'), { pid: 99999999 });
  await assert.rejects(prepareUpdate(f), /UPDATE_CLOSE_SIGNER_AND_WORKER_FIRST/);
  assert.ok(fs.existsSync(path.join(f.profile, 'data/RUNNING.lock')));
});
test('held updater locks are honored by actual Agent and Node Store entry', async t => {
  for (const role of ['agent', 'node']) {
    const f = fixture(t, role), ctx = await prepareUpdate(f); t.after(ctx.release);
    const { Store } = await import('../packages/' + (role === 'agent' ? 'AGI_Agent' : 'AGI_Node') + '/src/store.mjs');
    assert.throws(() => new Store(path.join(f.profile, 'data')), /ALREADY_RUNNING_OR_STALE_LOCK/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.profile, 'application.lock'))).pid, process.pid);
    ctx.release();
  }
});
for (const role of ['node', 'moderator', 'employer', 'evidence', 'recovery']) test(role + ' uses same bounded code-only transition', async t => {
  const f = fixture(t, role), ctx = await prepareUpdate(f); t.after(ctx.release);
  if (!['agent', 'node'].includes(role)) {
    const competitor = new DatabaseSync(path.join(f.profile, 'process-lock.sqlite'));
    assert.throws(() => competitor.exec('BEGIN EXCLUSIVE'), /locked/); competitor.close();
  }
  assert.equal(applyUpdate(ctx, ctx.approval).status, 'APPLIED'); ctx.release();
  assert.equal(rollbackUpdate(ctx.transaction, ctx.approval, f).status, 'ROLLED_BACK_CODE_ONLY');
});
test('embedded role update verifies ancestor and explicitly records mixed-version outer manifest', async t => {
  const f = fixture(t, 'agent', true), ctx = await prepareUpdate(f); t.after(ctx.release);
  assert.equal(ctx.plan.ancestorManifests[0].afterUpdate, 'HISTORICAL_MIXED_VERSION_USE_SELECTED_ROLE_MANIFEST');
  assert.ok(ctx.plan.stage.startsWith(ctx.transaction + path.sep));
  assert.equal(applyUpdate(ctx, ctx.approval).status, 'APPLIED');
  assert.throws(() => verifyPackage(path.join(f.accountHome, 'Fleet')), /UPDATE_PACKAGE_HASH_MISMATCH/);
  assert.equal(verifyPackage(f.installed).package.version, '1.25.6');
  ctx.release(); rollbackUpdate(ctx.transaction, ctx.approval, f);
  assert.equal(verifyPackage(path.join(f.accountHome, 'Fleet')).package.version, '1.19.2');
});
test('an interrupted rename can recover code when locks released and state unchanged', async t => {
  const f = fixture(t), ctx = await prepareUpdate(f); t.after(ctx.release);
  fs.renameSync(f.installed, ctx.plan.previousCode); ctx.release();
  assert.equal(rollbackUpdate(ctx.transaction, ctx.approval, f).status, 'ROLLED_BACK_CODE_ONLY');
  assert.equal(verifyPackage(f.installed).package.version, '1.25.2');
});
test('the 450 MB bound is strict', t => {
  const f = fixture(t), file = path.join(f.source, 'oversize.dat'), fd = fs.openSync(file, 'w', 0o600);
  fs.ftruncateSync(fd, 450000000); fs.closeSync(fd);
  assert.throws(() => verifyPackage(f.source), /UPDATE_FILE_EXCEEDS_450_MB/);
});
test('rollback restores current code on second rename failure and supports reviewed retry', async t => {
  const f = fixture(t), ctx = await prepareUpdate(f); t.after(ctx.release); applyUpdate(ctx, ctx.approval); ctx.release();
  let calls = 0;
  assert.throws(() => rollbackUpdate(ctx.transaction, ctx.approval, { ...f, rename: (from, to) => { if (++calls === 2) throw Error('fixture-rename-failure'); fs.renameSync(from, to); } }), /fixture-rename-failure/);
  assert.equal(verifyPackage(f.installed).package.version, '1.25.6');
  assert.equal(rollbackUpdate(ctx.transaction, ctx.approval, f).status, 'ROLLED_BACK_CODE_ONLY');
});
test('interrupted rollback between renames is resumable without state restoration', async t => {
  const f = fixture(t), ctx = await prepareUpdate(f); t.after(ctx.release); applyUpdate(ctx, ctx.approval); ctx.release();
  fs.renameSync(f.installed, path.join(ctx.transaction, 'rejected-code'));
  assert.equal(rollbackUpdate(ctx.transaction, ctx.approval, f).status, 'ROLLED_BACK_CODE_ONLY');
  assert.equal(verifyPackage(f.installed).package.version, '1.25.2');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.profile, 'consent.json'))).revoked, true);
});
test('writable and symlinked ancestors below signer home are refused', async t => {
  const f = fixture(t); const parent = path.join(f.accountHome, 'unsafe'); fs.mkdirSync(parent, { mode: 0o700 });
  const moved = path.join(parent, 'profile'); fs.renameSync(f.profile, moved); fs.chmodSync(parent, 0o777);
  await assert.rejects(prepareUpdate({ ...f, profile: moved }), /UPDATE_PATH_OWNERSHIP_OR_MODE/);
  fs.chmodSync(parent, 0o700); fs.symlinkSync(parent, path.join(f.accountHome, 'alias'));
  await assert.rejects(prepareUpdate({ ...f, profile: path.join(f.accountHome, 'alias/profile') }), /UPDATE_SYMLINK_REFUSED/);
});
test('private snapshot never enters installed code and compute sentinel remains unchanged', async t => {
  const f = fixture(t), compute = path.join(f.accountHome, 'preserved-compute-evidence/COMPUTE_STOP'); write(compute, 'preserved');
  const ctx = await prepareUpdate(f); t.after(ctx.release); applyUpdate(ctx, ctx.approval); ctx.release();
  assert.equal(fs.readFileSync(compute, 'utf8'), 'preserved');
  assert.equal(fs.existsSync(path.join(f.installed, 'profile-snapshot')), false);
  assert.equal(fs.existsSync(path.join(f.installed, 'vault.json')), false);
  assert.equal(fs.statSync(ctx.transaction).mode & 0o777, 0o700);
});
