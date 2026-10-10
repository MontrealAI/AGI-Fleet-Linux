import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { need, readFile, digest } from './core.mjs';

export const LINUX_ADAPTER = 'agi-linux-workstation/v0.1.0';
export const exactOpenClawVersion = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(value);

export function validateLinuxSession(s) {
  need(s.platform === 'linux' && ['x64', 'arm64'].includes(s.arch) && typeof s.glibc === 'string' && /^\d+\.\d+/.test(s.glibc), 'LINUX_GLIBC_X64_ARM64_REQUIRED');
  need(Number.isSafeInteger(s.uid) && s.uid > 0 && s.euid === s.uid, 'DEDICATED_NONROOT_ACCOUNT_REQUIRED');
  need(Array.isArray(s.groups) && !s.groups.some(g => ['root', 'sudo', 'wheel', 'docker', 'lxd', 'incus', 'admin'].includes(g)), 'UNPRIVILEGED_ACCOUNT_REQUIRED');
  need(!s.waylandDisplay && s.sessionType === 'x11', 'X11_SESSION_REQUIRED_WAYLAND_NOT_QUALIFIED');
  need(typeof s.display === 'string' && /^:\d+(?:\.\d+)?$/.test(s.display), 'LOCAL_X11_DISPLAY_REQUIRED');
  need(typeof s.dbusAddress === 'string' && /^unix:(?:path|abstract)=/.test(s.dbusAddress) && !/[\r\n;]/.test(s.dbusAddress), 'PRIVATE_DESKTOP_BUS_REQUIRED');
  need(path.isAbsolute(s.home ?? '') && s.homeOwner === s.uid && (s.homeMode & 0o077) === 0, 'PRIVATE_COMPUTE_HOME_REQUIRED');
  return { platform: s.platform, arch: s.arch, glibc: s.glibc, uid: s.uid, sessionType: s.sessionType, display: s.display };
}

export function validateDesktopOwnership(s) {
  need(s.runtimeDir === '/run/user/' + s.uid && s.runtimeDirectory && s.runtimeOwner === s.uid && (s.runtimeMode & 0o077) === 0, 'PRIVATE_RUNTIME_DIRECTORY_REQUIRED');
  need(s.busAddress === 'unix:path=' + s.runtimeDir + '/bus' && s.busSocket && s.busOwner === s.uid, 'OWNED_DESKTOP_BUS_REQUIRED');
  if (s.xauthorityPresent) need(s.xauthorityRegular && !s.xauthorityLink && s.xauthorityOwner === s.uid && (s.xauthorityMode & 0o077) === 0, 'OWNED_XAUTHORITY_REQUIRED');
}

export function inspectHardware() {
  const user = os.userInfo(), home = fs.realpathSync(user.homedir), st = fs.statSync(home);
  const session = validateLinuxSession({
    platform: process.platform, arch: process.arch,
    glibc: process.report.getReport().header.glibcVersionRuntime,
    uid: process.getuid?.(), euid: process.geteuid?.(),
    groups: execFileSync('/usr/bin/id', ['-Gn'], { encoding: 'utf8', timeout: 5000 }).trim().split(/\s+/),
    sessionType: process.env.XDG_SESSION_TYPE, waylandDisplay: process.env.WAYLAND_DISPLAY,
    display: process.env.DISPLAY, dbusAddress: process.env.DBUS_SESSION_BUS_ADDRESS,
    home, homeOwner: st.uid, homeMode: st.mode,
  });
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  need(runtimeDir === '/run/user/' + session.uid && fs.realpathSync(runtimeDir) === runtimeDir, 'PRIVATE_RUNTIME_DIRECTORY_REQUIRED');
  const runtime = fs.lstatSync(runtimeDir), bus = fs.lstatSync(path.join(runtimeDir, 'bus'));
  const xauthority = process.env.XAUTHORITY ? fs.lstatSync(process.env.XAUTHORITY) : null;
  validateDesktopOwnership({uid:session.uid, runtimeDir, runtimeDirectory:runtime.isDirectory(), runtimeOwner:runtime.uid, runtimeMode:runtime.mode, busAddress:process.env.DBUS_SESSION_BUS_ADDRESS, busSocket:bus.isSocket(), busOwner:bus.uid, xauthorityPresent:!!xauthority, xauthorityRegular:xauthority?.isFile(), xauthorityLink:xauthority?.isSymbolicLink(), xauthorityOwner:xauthority?.uid, xauthorityMode:xauthority?.mode});
  const machine = readFile('/etc/machine-id', 1024).toString().trim();
  const boot = readLinuxBootId();
  need(/^[a-f0-9]{32}$/.test(machine) && /^[a-f0-9-]{36}$/.test(boot), 'LINUX_MACHINE_IDENTITY');
  return { ...session, machineSha256: digest(machine), bootSha256: digest(boot), osBuild: os.release(), chip: os.cpus()[0]?.model ?? process.arch, adapter: LINUX_ADAPTER };
}

export function readLinuxBootId() {
  const fd = fs.openSync('/proc/sys/kernel/random/boot_id', fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    need(fs.fstatSync(fd).isFile(), 'LINUX_BOOT_IDENTITY');
    const buffer = Buffer.alloc(128), n = fs.readSync(fd, buffer, 0, buffer.length, null);
    const value = buffer.subarray(0, n).toString('utf8').trim();
    need(n < buffer.length && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value), 'LINUX_BOOT_IDENTITY');
    return value;
  } finally { fs.closeSync(fd); }
}

function fileDigest(file, expected, budget) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    need(before.isFile() && before.dev === expected.dev && before.ino === expected.ino && before.nlink === 1 && before.size <= 1073741824 && !(before.mode & 0o6022), 'INSTALLATION_FILE');
    budget.bytes += before.size;
    need(budget.bytes <= 8589934592, 'INSTALLATION_SIZE');
    const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1048576);
    let length = 0, n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) { hash.update(buffer.subarray(0, n)); length += n; }
    const after = fs.fstatSync(fd);
    need(length === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'INSTALLATION_CHANGED');
    return { sha256: hash.digest('hex'), bytes: before.size, mode: before.mode & 0o777 };
  } finally { fs.closeSync(fd); }
}

export function inspectInstallation(input, { kind = 'openclaw', bundleId } = {}) {
  need(path.isAbsolute(input ?? '') && ['openclaw', 'application'].includes(kind), 'INSTALLATION_PATH');
  const root = fs.realpathSync(input), budget = { bytes: 0, entries: 0 }, active = new Set(), cached = new Map();
  const treeRoot = kind === 'openclaw' && path.basename(path.dirname(root)) === 'node_modules' ? path.dirname(root) : root;
  const inside = target => target === treeRoot || (path.relative(treeRoot, target) && !path.relative(treeRoot, target).startsWith('..' + path.sep) && path.relative(treeRoot, target) !== '..' && !path.isAbsolute(path.relative(treeRoot, target)));
  function walk(file) {
    need(++budget.entries <= 250000, 'INSTALLATION_ENTRIES');
    const st = fs.lstatSync(file);
    need(st.uid === 0 || st.uid === process.getuid?.(), 'INSTALLATION_OWNER');
    if (st.isSymbolicLink()) {
      const target = fs.realpathSync(file);
      need(inside(target), 'INSTALLATION_LINK_ESCAPE');
      return ['link', fs.readlinkSync(file), walk(target)];
    }
    need(!(st.mode & 0o022), 'INSTALLATION_WRITABLE_BY_OTHERS');
    if (cached.has(file)) return cached.get(file);
    need(!active.has(file), 'INSTALLATION_LINK_CYCLE');
    active.add(file);
    let result;
    if (st.isDirectory()) {
      const entries = fs.readdirSync(file).sort();
      result = ['directory', st.mode & 0o777, entries.map(name => [name, walk(path.join(file, name))])];
      const after = fs.lstatSync(file);
      need(after.dev === st.dev && after.ino === st.ino && after.mtimeMs === st.mtimeMs && after.ctimeMs === st.ctimeMs, 'INSTALLATION_CHANGED');
    } else result = ['file', fileDigest(file, st, budget)];
    active.delete(file);
    const identity = digest(result); cached.set(file, identity); return identity;
  }
  if (kind === 'application') {
    need(typeof bundleId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(bundleId), 'APPLICATION_ID');
    const st = fs.lstatSync(root);
    need(st.isFile() && !!(st.mode & 0o111), 'APPLICATION_EXECUTABLE');
    return { app: root, bundleId, identityKind: 'linux-executable', installationSha256: digest({ adapter: LINUX_ADAPTER, bundleId, path: root, content: walk(root) }), signatureVerified: false };
  }
  need(fs.lstatSync(root).isDirectory(), 'OPENCLAW_PACKAGE_DIRECTORY');
  const pkg = JSON.parse(readFile(path.join(root, 'package.json'), 1048576));
  need(pkg.name === 'openclaw' && exactOpenClawVersion(pkg.version), 'OPENCLAW_PACKAGE_VERSION');
  const entry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.openclaw;
  need(typeof entry === 'string' && entry.length > 0 && !path.isAbsolute(entry) && !entry.split(/[\\/]/).includes('..') && inside(path.resolve(root, entry)) && fs.statSync(path.resolve(root, entry)).isFile(), 'OPENCLAW_PACKAGE_ENTRY');
  const content = walk(treeRoot);
  const nodePath = fs.realpathSync(process.execPath), nodeStat = fs.lstatSync(nodePath);
  need(nodeStat.uid === 0 || nodeStat.uid === process.getuid?.(), 'NODE_RUNTIME_OWNER');
  const node = { path: nodePath, version: process.version, ...fileDigest(nodePath, nodeStat, budget) };
  return { app: root, bundleId: 'openclaw', version: pkg.version, identityKind: 'linux-package-tree', identityScope: treeRoot === root ? 'self-contained-package-tree-and-node' : 'sibling-node-modules-tree-and-node', dependencyRoot: treeRoot, nodeExecutable: nodePath, nodeVersion: process.version, files: budget.entries, bytes: budget.bytes, installationSha256: digest({ adapter: LINUX_ADAPTER, root, dependencyRoot: treeRoot, version: pkg.version, content, node }), signatureVerified: false };
}
