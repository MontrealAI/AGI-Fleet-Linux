import {roleContract,COMPUTE_ROLES,OPERATOR_ROLES,setupRole} from './roles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const requireValue = (ok, code) => { if (!ok) throw Error(code); };
export function serviceFilePaths(home, role, platform='darwin') {
  requireValue(COMPUTE_ROLES.includes(role), 'REPAIR_ROLE_INVALID');
  const profile = roleContract(role).profile;
  return [
    path.join(home, '.local/bin', profile + '-openclaw-gateway-wrapper'),
    ...(role === 'agent' ? [path.join(home, '.local/bin/agi-openclaw-gateway-wrapper')] : []),
    path.join(home, 'Library/LaunchAgents', 'ai.openclaw.' + profile + '.plist'),
    path.join(home, 'Library/LaunchAgents', 'ai.montreal.' + profile + '.plist'),
    ...(platform==='linux'?[path.join(home,'.config/systemd/user','ai.openclaw.'+profile+'.service'),path.join(home,'.config/systemd/user','ai.montreal.'+profile+'.service')]:[]),
  ];
}
function safeAncestors(file, home) {
  const relative = path.relative(home, file);
  requireValue(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'REPAIR_BACKUP_PATH_INVALID');
  let current = path.resolve(home);
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    requireValue(!fs.lstatSync(current).isSymbolicLink(), 'REPAIR_BACKUP_SYMLINK');
  }
}
export function snapshotServiceFiles({home = os.homedir(), role, directory, platform='darwin', uid = process.getuid?.()} = {}) {
  home = path.resolve(home);
  directory ??= path.join(home, '.agi-compute-recovery', role, crypto.randomUUID());
  directory = path.resolve(directory);
  safeAncestors(directory, home);
  requireValue(!fs.existsSync(directory), 'REPAIR_BACKUP_ALREADY_EXISTS');
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  fs.chmodSync(directory, 0o700);
  const manifest = {schema: 'agi-service-backup/v1', ...(platform==='linux'?{platform}:{}), role, createdAt: new Date().toISOString(), files: []};
  for (const [index, file] of serviceFilePaths(home, role, platform).entries()) {
    safeAncestors(file, home);
    const entry = {relative: path.relative(home, file), exists: fs.existsSync(file)};
    if (entry.exists) {
      const before = fs.lstatSync(file);
      requireValue(before.isFile() && (uid === undefined || before.uid === uid) && before.size <= 1024 * 1024, 'REPAIR_BACKUP_FILE_UNSAFE');
      const data = fs.readFileSync(file), after = fs.lstatSync(file);
      requireValue(before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, 'REPAIR_BACKUP_FILE_CHANGED');
      entry.blob = `${index}.bin`; entry.sha256 = sha(data); entry.mode = before.mode & 0o777;
      fs.writeFileSync(path.join(directory, entry.blob), data, {mode: 0o600, flag: 'wx'});
    }
    manifest.files.push(entry);
  }
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), {mode: 0o600, flag: 'wx'});
  return {directory, manifest};
}
export async function restoreServiceFiles(snapshot, {home = os.homedir(), stop} = {}) {
  requireValue(typeof stop === 'function', 'REPAIR_STOP_REQUIRED');
  const directory = path.resolve(typeof snapshot === 'string' ? snapshot : snapshot.directory);
  safeAncestors(directory, home);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  requireValue(manifest.schema === 'agi-service-backup/v1', 'REPAIR_BACKUP_INVALID');
  const expected = serviceFilePaths(home, manifest.role, manifest.platform).map(file => path.relative(home, file));
  requireValue(manifest.files?.length === expected.length, 'REPAIR_BACKUP_INVALID');
  const prepared = manifest.files.map((entry, index) => {
    requireValue(entry.relative === expected[index], 'REPAIR_BACKUP_INVALID');
    const file = path.join(home, entry.relative); safeAncestors(file, home);
    if (!entry.exists) return {file, entry};
    requireValue(entry.blob === `${index}.bin` && Number.isInteger(entry.mode) && entry.mode >= 0 && entry.mode <= 0o777, 'REPAIR_BACKUP_INVALID');
    const blob = path.join(directory, entry.blob); safeAncestors(blob, home);
    const data = fs.readFileSync(blob); requireValue(sha(data) === entry.sha256, 'REPAIR_BACKUP_CORRUPT');
    return {file, entry, data};
  });
  requireValue(await stop() === true, 'REPAIR_STOP_UNCONFIRMED');
  for (const {file, entry, data} of prepared) {
    if (!entry.exists) { fs.rmSync(file, {force: true}); continue; }
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    const temporary = file + '.repair-' + crypto.randomUUID();
    fs.writeFileSync(temporary, data, {mode: entry.mode, flag: 'wx'});
    fs.renameSync(temporary, file);
  }
  return {status: 'PASS', code: 'SERVICE_FILES_RESTORED_SERVICES_STOPPED'};
}
