#!/usr/bin/env node
/** Quiescent, code-only signer update. Never restores profile state or touches compute. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const MAX_FILE = 450000000;
const ROLES = {
  agent: { name: 'montreal-ai-private-agi-agent', package: 'AGI_Agent', old: ['1.25.2', '1.25.4', '1.25.5'], next: '1.25.6' },
  node: { name: 'montreal-ai-private-agi-node', package: 'AGI_Node', old: ['2.26.2', '2.26.4', '2.26.5'], next: '2.26.6' },
  moderator: { package: 'AGI_Moderator', old: ['1.0.2', '1.0.4', '1.0.5'], next: '1.0.6' },
  employer: { package: 'AGI_Employer', old: ['1.0.2', '1.0.4', '1.0.5'], next: '1.0.6' },
  evidence: { package: 'AGI_Evidence', old: ['1.0.2', '1.0.4', '1.0.5'], next: '1.0.6' },
  recovery: { package: 'AGI_Recovery', old: ['1.0.2', '1.0.4', '1.0.5'], next: '1.0.6' },
};
const fail = code => { throw Error(code); };
const need = (ok, code) => { if (!ok) fail(code); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const inside = (base, file) => file === base || file.startsWith(base + path.sep);
const present = file => { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const syncDir = dir => { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
function safePath(file, uid, directory = true) {
  need(path.isAbsolute(file), 'UPDATE_ABSOLUTE_PATH_REQUIRED');
  for (let p = file; p !== path.dirname(p); p = path.dirname(p)) need(!fs.lstatSync(p).isSymbolicLink(), 'UPDATE_SYMLINK_REFUSED');
  const stat = fs.lstatSync(file);
  need(directory ? stat.isDirectory() : stat.isFile(), 'UPDATE_FILE_TYPE_REFUSED');
  need(stat.uid === uid && !(stat.mode & 0o022), 'UPDATE_PATH_OWNERSHIP_OR_MODE');
  return fs.realpathSync(file);
}
function accountPath(file, accountHome, uid, { create = false } = {}) {
  need(inside(accountHome, file), 'UPDATE_PATH_OUTSIDE_SIGNER_ACCOUNT');
  let current = accountHome;
  for (const segment of path.relative(accountHome, file).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (create && !present(current)) { fs.mkdirSync(current, { mode: 0o700 }); syncDir(path.dirname(current)); }
    safePath(current, uid);
  }
  return file;
}
function entries(root, { uid, exclude = () => false } = {}) {
  const result = [];
  const visit = relative => {
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    need(!stat.isSymbolicLink(), 'UPDATE_SYMLINK_REFUSED');
    need(stat.uid === uid && !(stat.mode & 0o022), 'UPDATE_PATH_OWNERSHIP_OR_MODE');
    if (exclude(relative)) return;
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(relative ? relative + '/' + name : name);
    else {
      need(stat.isFile() && stat.nlink === 1, 'UPDATE_SPECIAL_OR_LINKED_FILE_REFUSED');
      need(stat.size < MAX_FILE, 'UPDATE_FILE_EXCEEDS_450_MB');
      result.push({ path: relative, sha256: hash(fs.readFileSync(file)), bytes: stat.size, mode: stat.mode & 0o777 });
    }
  };
  visit('');
  return result;
}
function writeExclusive(file, bytes, mode = 0o600) {
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, mode);
  try { fs.fchmodSync(fd, mode); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDir(path.dirname(file));
}
function writeJSON(file, value) { writeExclusive(file, JSON.stringify(value, null, 2) + '\n'); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
export function verifyPackage(root, { uid = process.getuid() } = {}) {
  root = safePath(path.resolve(root), uid);
  const observed = entries(root, { uid }), byPath = new Map(observed.map(row => [row.path, row]));
  need(byPath.has('MANIFEST.sha256'), 'UPDATE_PACKAGE_MANIFEST_REQUIRED');
  const expected = new Map();
  for (const line of fs.readFileSync(path.join(root, 'MANIFEST.sha256'), 'utf8').trimEnd().split('\n')) {
    const m = /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);
    need(m && !path.isAbsolute(m[2]) && !m[2].split('/').some(x => ['..', '.', ''].includes(x)) && !m[2].includes('\\'), 'UPDATE_MANIFEST_INVALID');
    need(m[2] !== 'MANIFEST.sha256' && !expected.has(m[2]), 'UPDATE_MANIFEST_INVALID');
    expected.set(m[2], m[1]);
  }
  need(expected.size === observed.length - 1, 'UPDATE_UNTRACKED_OR_MISSING_PACKAGE_FILES');
  for (const [name, digest] of expected) need(byPath.get(name)?.sha256 === digest, 'UPDATE_PACKAGE_HASH_MISMATCH');
  for (const row of observed) {
    const name = path.basename(row.path);
    need(!['vault.json', 'app-state.json', 'agent.config.json', 'node.config.json', 'config.json', 'COMPUTE_STOP', 'compute-journal.json', 'application.lock', 'RUNNING.lock', 'process.lock'].includes(name), 'UPDATE_PRIVATE_STATE_IN_CODE');
    need(!/\.(?:sqlite(?:3)?(?:-(?:wal|shm|journal))?|agiagentbackup|aginodebackup)$/.test(name), 'UPDATE_PRIVATE_STATE_IN_CODE');
    const fd = fs.openSync(path.join(root, row.path), 'r'), header = Buffer.alloc(16);
    try { fs.readSync(fd, header, 0, 16, 0); } finally { fs.closeSync(fd); }
    need(!header.equals(Buffer.from('SQLite format 3\0')), 'UPDATE_PRIVATE_STATE_IN_CODE');
  }
  return { root, package: json(path.join(root, 'package.json')), files: observed, digest: hash(JSON.stringify(observed)) };
}
function profileExclusion(relative) {
  return ['application.lock', 'data/RUNNING.lock', 'process.lock', 'process-lock.sqlite', 'process-lock.sqlite-wal', 'process-lock.sqlite-shm', 'process-lock.sqlite-journal'].includes(relative);
}
function inspectProfile(profile, role, installedVersion, uid, accountHome, expectedAddress) {
  profile = safePath(path.resolve(profile), uid);
  need(inside(accountHome, profile) && profile !== accountHome, 'UPDATE_PROFILE_OUTSIDE_SIGNER_ACCOUNT');
  need(!profile.split(path.sep).some(x => x.startsWith('.openclaw') || x.startsWith('.agi-genesis-setup-')), 'UPDATE_COMPUTE_PROFILE_REFUSED');
  const release = json(path.join(profile, 'release-profile.json'));
  need(release.schema === 1 && release.role === role && release.version === installedVersion && /^[0-9a-f-]{36}$/.test(release.id), 'UPDATE_PROFILE_RELEASE_MISMATCH');
  need(!present(path.join(profile, 'restore-in-progress.json')), 'UPDATE_RESTORE_PENDING');
  if (['agent', 'node'].includes(role)) {
    const config = json(path.join(profile, role + '.config.json'));
    need(path.resolve(profile, config.dataDir ?? 'data') === path.join(profile, 'data'), 'UPDATE_EXTERNAL_DATA_DIRECTORY_REQUIRES_REVIEW');
    need(inside(profile, path.resolve(profile, config.keystore ?? 'keystore.json')), 'UPDATE_EXTERNAL_KEYSTORE_REQUIRES_REVIEW');
    const actual = config[role === 'agent' ? 'agent' : 'validator'];
    const address = release.expectedAddress || actual;
    need(typeof expectedAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(expectedAddress), 'UPDATE_EXPECTED_WALLET_REQUIRED');
    need(address?.toLowerCase() === expectedAddress.toLowerCase() && (!actual || actual.toLowerCase() === expectedAddress.toLowerCase()), 'UPDATE_WALLET_MISMATCH');
  } else {
    const config = json(path.join(profile, 'config.json'));
    need(config.role === role, 'UPDATE_PROFILE_ROLE_MISMATCH');
    if (role !== 'evidence') need(/^0x[0-9a-fA-F]{40}$/.test(expectedAddress || '') && release.expectedAddress?.toLowerCase() === expectedAddress.toLowerCase() && config.wallet?.toLowerCase() === expectedAddress.toLowerCase(), 'UPDATE_WALLET_MISMATCH');
  }
  return { root: profile, id: release.id, role, version: release.version, expectedAddress: release.expectedAddress || null };
}
function acquireLocks(profile, role, uid) {
  const paths = ['agent', 'node'].includes(role) ? [path.join(profile, 'application.lock'), path.join(profile, 'data/RUNNING.lock')] : [path.join(profile, 'process.lock')];
  const held = [], token = crypto.randomUUID(); let lease, released = false;
  const release = () => {
    if (released) return; released = true;
    for (const file of held.reverse()) { need(json(file).updateToken === token, 'UPDATE_LOCK_CHANGED'); fs.unlinkSync(file); syncDir(path.dirname(file)); }
    if (lease) { try { lease.exec('ROLLBACK'); } catch {} finally { lease.close(); } }
  };
  try {
    for (const file of paths) need(!present(file), 'UPDATE_CLOSE_SIGNER_AND_WORKER_FIRST');
    if (!['agent', 'node'].includes(role)) {
      const file = path.join(profile, 'process-lock.sqlite');
      if (present(file)) safePath(file, uid, false);
      lease = new DatabaseSync(file);
      fs.chmodSync(file, 0o600);
      lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS holder(pid INTEGER);');
      lease.prepare('INSERT INTO holder VALUES(?)').run(process.pid);
    }
    for (const file of paths) {
      safePath(path.dirname(file), uid);
      writeJSON(file, { pid: process.pid, updateToken: token }); held.push(file);
    }
    return release;
  } catch (error) { release(); throw error; }
}
function copyVerified(root, target, inventory, privateFiles = false) {
  fs.mkdirSync(target, { mode: 0o700 });
  for (const row of inventory) {
    const destination = path.join(target, row.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const bytes = fs.readFileSync(path.join(root, row.path));
    need(hash(bytes) === row.sha256, 'UPDATE_SOURCE_CHANGED');
    writeExclusive(destination, bytes, privateFiles ? 0o600 : row.mode);
  }
  syncDir(target);
}
async function snapshotProfile(profile, target, uid) {
  const before = entries(profile, { uid, exclude: profileExclusion }), sqlite = new Set();
  for (const row of before) {
    const fd = fs.openSync(path.join(profile, row.path), 'r'), header = Buffer.alloc(16);
    try { fs.readSync(fd, header, 0, 16, 0); } finally { fs.closeSync(fd); }
    if (header.equals(Buffer.from('SQLite format 3\0'))) sqlite.add(row.path);
  }
  for (const row of before) if (/-(wal|shm|journal)$/.test(row.path)) need(sqlite.has(row.path.replace(/-(wal|shm|journal)$/, '')), 'UPDATE_ORPHAN_SQLITE_SIDECAR');
  fs.mkdirSync(target, { mode: 0o700 });
  const methods = [];
  for (const row of before) {
    if (/(?:-wal|-shm|-journal)$/.test(row.path) && sqlite.has(row.path.replace(/-(wal|shm|journal)$/, ''))) continue;
    const source = path.join(profile, row.path), destination = path.join(target, row.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    if (sqlite.has(row.path)) {
      const db = new DatabaseSync(source, { readOnly: true }), deadline = Date.now() + 120000;
      try { await backup(db, destination, { rate: 100, progress: () => { need(Date.now() < deadline, 'UPDATE_SQLITE_BACKUP_TIMEOUT'); return 100; } }); }
      finally { db.close(); }
      fs.chmodSync(destination, 0o600);
      const checked = new DatabaseSync(destination, { readOnly: true });
      try { need(checked.prepare('PRAGMA integrity_check').all().every(row => row.integrity_check === 'ok'), 'UPDATE_SQLITE_BACKUP_INVALID'); }
      finally { checked.close(); }
      const fd = fs.openSync(destination, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      syncDir(path.dirname(destination)); methods.push({ path: row.path, method: 'sqlite-native-backup-integrity-checked' });
    } else {
      const bytes = fs.readFileSync(source); need(hash(bytes) === row.sha256, 'UPDATE_PROFILE_CHANGED');
      writeExclusive(destination, bytes); methods.push({ path: row.path, method: 'quiescent-copy' });
    }
  }
  // SQLite can manage its SHM bookkeeping even for a read-only connection. The
  // authoritative database/WAL and every other profile file must remain exact.
  const authoritative = rows => rows.filter(row => !row.path.endsWith('-shm'));
  need(same(authoritative(before), authoritative(entries(profile, { uid, exclude: profileExclusion }))), 'UPDATE_PROFILE_CHANGED');
  return { sourceInventory: authoritative(before), files: entries(target, { uid }), methods };
}
function audit(transaction, event, extra = {}) {
  const files = fs.readdirSync(transaction).filter(name => /^event-\d{4}\.json$/.test(name)).sort();
  const previous = files.length ? hash(fs.readFileSync(path.join(transaction, files.at(-1)))) : null;
  writeJSON(path.join(transaction, `event-${String(files.length + 1).padStart(4, '0')}.json`), { schema: 'agi-signer-update-event/v1', at: new Date().toISOString(), event, previous, ...extra });
}
export async function prepareUpdate({ source, installed, profile, role, expectedAddress, accountHome = os.homedir(), uid = process.getuid() }) {
  need(ROLES[role], 'UPDATE_ROLE_REQUIRED'); accountHome = safePath(path.resolve(accountHome), uid);
  for (const file of [source, installed, profile]) accountPath(path.resolve(file), accountHome, uid);
  const old = verifyPackage(installed, { uid }), next = verifyPackage(source, { uid }), contract = ROLES[role];
  const ancestorManifests = [];
  for (let parent = path.dirname(old.root); inside(accountHome, parent) && parent !== accountHome; parent = path.dirname(parent)) {
    if (!present(path.join(parent, 'MANIFEST.sha256'))) continue;
    const ancestor = verifyPackage(parent, { uid });
    need(ancestor.package.name === 'montreal-ai-autonomous-fleet', 'UPDATE_UNRECOGNIZED_ANCESTOR_PACKAGE');
    ancestorManifests.push({ root: parent, version: ancestor.package.version, digest: ancestor.digest, manifestSHA256: hash(fs.readFileSync(path.join(parent, 'MANIFEST.sha256'))), afterUpdate: 'HISTORICAL_MIXED_VERSION_USE_SELECTED_ROLE_MANIFEST' });
  }
  need(old.package.name === next.package.name && (!contract.name || old.package.name === contract.name), 'UPDATE_PACKAGE_ROLE_MISMATCH');
  if (!contract.name) for (const item of [old, next]) need(json(path.join(item.root, 'config/operator-role.json')).role === role, 'UPDATE_PACKAGE_ROLE_MISMATCH');
  need(contract.old.includes(old.package.version) && next.package.version === contract.next, 'UPDATE_VERSION_TRANSITION_UNSUPPORTED');
  need(inside(accountHome, old.root) && inside(accountHome, next.root), 'UPDATE_CODE_OUTSIDE_SIGNER_ACCOUNT');
  need(!inside(old.root, next.root) && !inside(next.root, old.root), 'UPDATE_SOURCE_DESTINATION_OVERLAP');
  safePath(path.dirname(old.root), uid);
  const identity = inspectProfile(profile, role, old.package.version, uid, accountHome, expectedAddress);
  need(!inside(old.root, identity.root) && !inside(next.root, identity.root) && !inside(identity.root, old.root) && !inside(identity.root, next.root), 'UPDATE_PROFILE_CODE_OVERLAP');
  const release = acquireLocks(identity.root, role, uid);
  let transaction;
  try {
    const history = path.join(accountHome, 'Library/Application Support/MONTREAL.AI/Signer Updates');
    accountPath(history, accountHome, uid, { create: true }); need((fs.statSync(history).mode & 0o077) === 0, 'UPDATE_PRIVATE_HISTORY_PERMISSIONS_REQUIRED');
    need(!inside(old.root, history) && !inside(next.root, history) && !inside(identity.root, history), 'UPDATE_HISTORY_PATH_OVERLAP');
    const operationId = crypto.randomUUID(); transaction = path.join(history, operationId); fs.mkdirSync(transaction, { mode: 0o700 }); syncDir(history);
    need(fs.statSync(transaction).dev === fs.statSync(path.dirname(old.root)).dev, 'UPDATE_ATOMIC_RENAME_REQUIRES_SAME_FILESYSTEM');
    audit(transaction, 'snapshot-started', { operationId, role, from: old.package.version, to: next.package.version });
    const snapshot = await snapshotProfile(identity.root, path.join(transaction, 'profile-snapshot'), uid);
    writeJSON(path.join(transaction, 'snapshot.json'), snapshot);
    const stage = path.join(transaction, 'staged-code');
    const previousCode = path.join(transaction, 'previous-code');
    copyVerified(next.root, stage, next.files);
    need(verifyPackage(stage, { uid }).digest === next.digest, 'UPDATE_STAGE_VERIFICATION_FAILED');
    const oldByPath = new Map(old.files.map(row => [row.path, row]));
    const nextByPath = new Map(next.files.map(row => [row.path, row]));
    const changes = [...new Set([...oldByPath.keys(), ...nextByPath.keys()])].sort().filter(name => !same(oldByPath.get(name), nextByPath.get(name))).map(name => ({ path: name, before: oldByPath.get(name)?.sha256 ?? null, after: nextByPath.get(name)?.sha256 ?? null }));
    const plan = { schema: 'agi-signer-code-update/v1', operationId, role, profile: identity, installed: old.root, source: next.root, stage, previousCode, from: old.package.version, to: next.package.version, oldDigest: old.digest, newDigest: next.digest, changes, ancestorManifests, computeChange: false, stateRestore: false, distribution: 'unsigned-unnotarized' };
    writeJSON(path.join(transaction, 'plan.json'), plan);
    const approval = hash(fs.readFileSync(path.join(transaction, 'plan.json')));
    audit(transaction, 'staged', { approval });
    return { transaction, plan, approval, release, uid };
  } catch (error) { if (transaction) audit(transaction, 'failed', { code: sanitizedCode(error) }); release(); throw error; }
}
function profileMatches(context) {
  const snapshot = json(path.join(context.transaction, 'snapshot.json'));
  const now = entries(context.plan.profile.root, { uid: context.uid, exclude: profileExclusion }).filter(row => !row.path.endsWith('-shm'));
  need(same(snapshot.sourceInventory, now), 'UPDATE_PROFILE_CHANGED_REVIEW_REQUIRED');
}
export function applyUpdate(context, approvedHash) {
  const { plan, transaction, approval, uid } = context;
  need(approvedHash === approval && hash(fs.readFileSync(path.join(transaction, 'plan.json'))) === approval, 'UPDATE_EXACT_APPROVAL_REQUIRED');
  need(verifyPackage(plan.installed, { uid }).digest === plan.oldDigest && verifyPackage(plan.stage, { uid }).digest === plan.newDigest, 'UPDATE_CODE_CHANGED');
  for (const ancestor of plan.ancestorManifests) need(verifyPackage(ancestor.root, { uid }).digest === ancestor.digest, 'UPDATE_ANCESTOR_CODE_CHANGED');
  profileMatches(context);
  audit(transaction, 'approved', { approval });
  audit(transaction, 'apply-intent');
  need(!present(plan.previousCode), 'UPDATE_PREVIOUS_CODE_EXISTS');
  fs.renameSync(plan.installed, plan.previousCode); syncDir(path.dirname(plan.installed)); syncDir(transaction);
  try { fs.renameSync(plan.stage, plan.installed); syncDir(path.dirname(plan.installed)); syncDir(transaction); }
  catch (error) { fs.renameSync(plan.previousCode, plan.installed); syncDir(path.dirname(plan.installed)); syncDir(transaction); audit(transaction, 'apply-failed-code-restored', { code: sanitizedCode(error) }); throw error; }
  need(verifyPackage(plan.installed, { uid }).digest === plan.newDigest, 'UPDATE_POST_APPLY_VERIFICATION_FAILED');
  profileMatches(context); audit(transaction, 'applied', { stateChanged: false, computeChanged: false });
  return { operationId: plan.operationId, status: 'APPLIED', from: plan.from, to: plan.to, transaction };
}
export function rollbackUpdate(transaction, approval, { uid = process.getuid(), accountHome = os.homedir(), rename = fs.renameSync } = {}) {
  transaction = safePath(path.resolve(transaction), uid); accountHome = safePath(path.resolve(accountHome), uid);
  accountPath(transaction, accountHome, uid);
  need(inside(path.join(accountHome, 'Library/Application Support/MONTREAL.AI/Signer Updates'), transaction), 'UPDATE_HISTORY_PATH_INVALID');
  const plan = json(path.join(transaction, 'plan.json'));
  need(approval === hash(fs.readFileSync(path.join(transaction, 'plan.json'))), 'UPDATE_EXACT_APPROVAL_REQUIRED');
  need(plan.schema === 'agi-signer-code-update/v1' && ROLES[plan.role] && inside(accountHome, plan.installed) && plan.previousCode === path.join(transaction, 'previous-code') && plan.stage === path.join(transaction, 'staged-code') && !inside(plan.profile.root, plan.installed) && !inside(plan.installed, plan.profile.root), 'UPDATE_PLAN_INVALID');
  accountPath(plan.profile.root, accountHome, uid); accountPath(path.dirname(plan.installed), accountHome, uid);
  const identity = inspectProfile(plan.profile.root, plan.role, plan.from, uid, accountHome, plan.profile.expectedAddress);
  need(identity.id === plan.profile.id, 'UPDATE_PROFILE_ID_CHANGED');
  const release = acquireLocks(identity.root, plan.role, uid);
  try {
    const context = { transaction, plan, uid }; profileMatches(context);
    need(verifyPackage(plan.previousCode, { uid }).digest === plan.oldDigest, 'UPDATE_OLD_CODE_CHANGED');
    if (present(plan.installed)) need(verifyPackage(plan.installed, { uid }).digest === plan.newDigest, 'UPDATE_CURRENT_CODE_CHANGED');
    const retained = path.join(transaction, 'rejected-code');
    if (present(retained)) {
      need(!present(plan.installed) && verifyPackage(retained, { uid }).digest === plan.newDigest, 'UPDATE_ROLLBACK_STATE_REQUIRES_REVIEW');
    }
    audit(transaction, 'rollback-approved', { approval, profileRestore: false });
    if (present(plan.installed)) { rename(plan.installed, retained); syncDir(path.dirname(plan.installed)); syncDir(transaction); }
    try { rename(plan.previousCode, plan.installed); syncDir(path.dirname(plan.installed)); syncDir(transaction); }
    catch (error) {
      if (!present(plan.installed) && present(retained)) { fs.renameSync(retained, plan.installed); syncDir(path.dirname(plan.installed)); syncDir(transaction); }
      audit(transaction, 'rollback-failed-current-code-restored', { code: sanitizedCode(error) }); throw error;
    }
    need(verifyPackage(plan.installed, { uid }).digest === plan.oldDigest, 'UPDATE_ROLLBACK_VERIFICATION_FAILED');
    audit(transaction, 'rolled-back-code-only', { profileRestore: false });
    return { status: 'ROLLED_BACK_CODE_ONLY', transaction };
  } finally { release(); }
}
function sanitizedCode(error) { return /^UPDATE_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'UPDATE_IO_OR_SQLITE_FAILURE'; }
function defaultProfile(role) { return ['agent', 'node'].includes(role) ? path.join(os.homedir(), 'Library/Application Support/MONTREAL.AI/AGI ' + (role === 'agent' ? 'Agent' : 'Node')) : path.join(os.homedir(), 'Library/Application Support/AGI Fleet', role); }
async function chooseFolder(prompt) {
  const result = await promisify(execFile)('/usr/bin/osascript', ['-e', 'on run argv\nreturn POSIX path of (choose folder with prompt (item 1 of argv))\nend run', prompt], { timeout: 180000, maxBuffer: 16384 });
  return result.stdout.trim();
}
export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) { console.log('Update-Signer.command — guided in-place signer update. Close signer/worker first. Compute, OAuth and STOP remain untouched. Run without arguments for guided review; --rollback TRANSACTION requires explicit confirmation of the retained proposal and unchanged prelaunch profile. No profile rollback is performed.'); return; }
  need(process.platform === 'darwin' && process.getuid() !== 0, 'UPDATE_SIGNER_MAC_ACCOUNT_REQUIRED');
  const [major, minor] = process.versions.node.split('.').map(Number); need(major === 24 && minor >= 19, 'UPDATE_NODE_24_REQUIRED');
  const rl = createInterface({ input: process.stdin, output: process.stdout }); let prepared;
  try {
    console.log('Keep agiagentv1 and existing compute v3. This updates signer application code only. No new account or OAuth is requested. Close the signer application and stop its worker; leave compute untouched. Distribution remains unsigned and unnotarized.');
    if (args[0] === '--rollback') {
      need(args.length === 2, 'UPDATE_ARGUMENTS_INVALID');
      const file = path.resolve(args[1]), plan = json(path.join(file, 'plan.json')), digest = hash(fs.readFileSync(path.join(file, 'plan.json')));
      console.log(`Code-only rollback ${plan.to} → ${plan.from}. Allowed only before relaunch while all profile state is unchanged. Proposal: ${digest}`);
      const approval = (await rl.question('Type ROLLBACK to approve this displayed code-only rollback: ')).trim(); need(approval === 'ROLLBACK', 'UPDATE_CANCELLED');
      console.log(JSON.stringify(rollbackUpdate(file, digest))); return;
    }
    need(args.length === 0, 'UPDATE_ARGUMENTS_INVALID');
    const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const own = json(path.join(releaseRoot, 'package.json'));
    let role = Object.keys(ROLES).find(key => ROLES[key].name === own.name);
    if (!role && present(path.join(releaseRoot, 'config/operator-role.json'))) role = json(path.join(releaseRoot, 'config/operator-role.json')).role;
    if (!role) role = (await rl.question('Role (agent/node/moderator/employer/evidence/recovery) [agent]: ')).trim() || 'agent';
    need(ROLES[role], 'UPDATE_ROLE_REQUIRED');
    const source = present(path.join(releaseRoot, 'packages', ROLES[role].package)) ? path.join(releaseRoot, 'packages', ROLES[role].package) : releaseRoot;
    console.log('Select the EXISTING ' + ROLES[role].package + ' application folder in the folder chooser. If it is in a Fleet folder, open packages and select this role folder.');
    const installed = await chooseFolder('Select the EXISTING ' + ROLES[role].package + ' application folder to update');
    const profileChoice = (await rl.question('Signer profile: original, seed, or choose [original]: ')).trim() || 'original';
    need(['original', 'seed', 'choose'].includes(profileChoice) && !(role === 'evidence' && profileChoice === 'seed'), 'UPDATE_PROFILE_SELECTION_INVALID');
    const profile = profileChoice === 'choose' ? await chooseFolder('Select the EXISTING signer profile, never a compute profile') : defaultProfile(role) + (profileChoice === 'seed' ? ' — Seed Wallet' : '');
    const expectedAddress = role === 'evidence' ? undefined : (await rl.question('Independently recorded full public wallet address: ')).trim();
    prepared = await prepareUpdate({ source, installed, profile, role, expectedAddress });
    const { plan, approval, transaction } = prepared;
    console.log(`\n${role}: ${plan.from} → ${plan.to}\nInstalled: ${plan.installed}\nProfile: ${plan.profile.root}\nWallet: ${plan.profile.expectedAddress || 'keyless'}\nChanged code files: ${plan.changes.length}\nVerified snapshot, full changed-file list and audit: ${transaction}\nCompute changes: none. Snapshot state will never be automatically restored.\nUnsigned/unnotarized package; manifest establishes consistency, not publisher authentication.\nExact proposal: ${approval}`);
    for (const ancestor of plan.ancestorManifests) console.log(`MIXED VERSION NOTICE: ${ancestor.root} remains Fleet ${ancestor.version} with only ${role} updated. Its outer manifest becomes historical and will fail after this selected update. Use the updated role's Verify-Package.command and this update receipt. Other roles are unchanged; this is not a new coordinated installation.`);
    for (const row of plan.changes) console.log((row.before ? row.after ? 'CHANGE ' : 'REMOVE ' : 'ADD ') + row.path);
    need((await rl.question('Type APPLY to approve this displayed update, or Enter to cancel: ')).trim() === 'APPLY', 'UPDATE_CANCELLED');
    const result = applyUpdate(prepared, approval); console.log(JSON.stringify(result));
    console.log('Open your SAME installed launcher and SAME signer profile. Compare the wallet address. A new app release requires a new verified encrypted backup and fresh activation before authorized work; it preserves wallet and OAuth. Then review and approve the existing v3 compute identity. Do not run Install.command in compute. Keep the private update evidence on the signer account.');
  } catch (error) {
    if (prepared) audit(prepared.transaction, 'operator-session-ended', { code: sanitizedCode(error) });
    throw error;
  } finally { prepared?.release(); rl.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(sanitizedCode(error)); process.exitCode = 1; });
