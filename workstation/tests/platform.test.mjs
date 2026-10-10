import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { inspectInstallation, validateLinuxSession, validateDesktopOwnership, exactOpenClawVersion, readLinuxBootId } from '../engine/platform.mjs';

function packageFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-linux-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name:'openclaw', version:'2026.10.1', bin:{openclaw:'openclaw.mjs'}}));
  fs.writeFileSync(path.join(root, 'openclaw.mjs'), 'export const version="2026.10.1";');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'provider.js'), 'export const provider="cua-computer";');
  return root;
}
const session = {platform:'linux', arch:'x64', glibc:'2.39', uid:1001, euid:1001, groups:['compute'], sessionType:'x11', display:':0', dbusAddress:'unix:path=/run/user/1001/bus', home:'/home/compute', homeOwner:1001, homeMode:0o700};

test('Linux proc boot identity is read without treating its zero stat size as corruption', () => {
  assert.match(readLinuxBootId(), /^[a-f0-9-]{36}$/);
});

test('Linux session accepts glibc x64 and arm64 local X11 task accounts', () => {
  assert.equal(validateLinuxSession(session).platform, 'linux');
  assert.equal(validateLinuxSession({...session, arch:'arm64'}).arch, 'arm64');
});
test('root, privileged groups, other user homes, and broad home modes are refused', () => {
  for (const patch of [{uid:0,euid:0}, {euid:0}, {groups:['compute','docker']}, {groups:['sudo']}, {homeOwner:1002}, {homeMode:0o755}]) assert.throws(() => validateLinuxSession({...session, ...patch}), /ACCOUNT|HOME/);
});
test('Wayland including XWayland, remote X11, missing desktop bus, and musl are refused', () => {
  for (const patch of [{sessionType:'wayland'}, {waylandDisplay:'wayland-0'}, {display:'localhost:10'}, {display:undefined}, {dbusAddress:'tcp:host=example.org'}, {glibc:undefined}, {arch:'ia32'}, {platform:'darwin'}]) assert.throws(() => validateLinuxSession({...session, ...patch}), /X11|BUS|LINUX/);
});
test('desktop runtime bus and optional Xauthority must belong to the task UID', () => {
  const owned={uid:1001,runtimeDir:'/run/user/1001',runtimeDirectory:true,runtimeOwner:1001,runtimeMode:0o700,busAddress:'unix:path=/run/user/1001/bus',busSocket:true,busOwner:1001,xauthorityPresent:true,xauthorityRegular:true,xauthorityLink:false,xauthorityOwner:1001,xauthorityMode:0o600};
  validateDesktopOwnership(owned);
  for(const patch of [{runtimeDir:'/run/user/1002'},{runtimeOwner:1002},{runtimeMode:0o755},{busAddress:'unix:path=/run/user/1002/bus'},{busOwner:1002},{busSocket:false},{xauthorityOwner:1002},{xauthorityLink:true},{xauthorityMode:0o644}]) assert.throws(()=>validateDesktopOwnership({...owned,...patch}),/RUNTIME|BUS|XAUTHORITY/);
});
test('OpenClaw version selection is an exact version, never a range or latest', () => {
  for (const value of ['2026.9.5','2026.10.1-beta.2']) assert(exactOpenClawVersion(value));
  for (const value of ['latest','^2026.9.5','2026.9','2026.09.5','2026.9.5 || *']) assert(!exactOpenClawVersion(value));
});
test('package identity covers dependency bytes and exact installed version', t => {
  const root=packageFixture(t), initial=inspectInstallation(root);
  assert.equal(initial.version, '2026.10.1');
  assert.equal(initial.signatureVerified, false);
  assert.equal(inspectInstallation(root).installationSha256, initial.installationSha256);
  fs.appendFileSync(path.join(root,'node_modules/provider.js'), '\nchanged');
  assert.notEqual(inspectInstallation(root).installationSha256, initial.installationSha256);
});
test('npm-hoisted provider dependency changes invalidate the bound installation', t => {
  const base=packageFixture(t), modules=path.join(base,'node_modules'), pkg=path.join(modules,'openclaw');
  fs.mkdirSync(pkg);fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'openclaw',version:'2026.10.1',bin:'openclaw.mjs'}));fs.writeFileSync(path.join(pkg,'openclaw.mjs'),'export {};');
  const first=inspectInstallation(pkg);assert.equal(first.identityScope,'sibling-node-modules-tree-and-node');
  fs.appendFileSync(path.join(modules,'provider.js'),'\nchanged-hoisted-provider');
  assert.notEqual(inspectInstallation(pkg).installationSha256,first.installationSha256);
  assert.equal(first.nodeExecutable,fs.realpathSync(process.execPath));
});
test('package identity follows only internal dependency links and rejects escape/cycle', t => {
  const root=packageFixture(t);
  fs.symlinkSync('provider.js',path.join(root,'node_modules/provider-link.js'));
  assert.match(inspectInstallation(root).installationSha256,/^[a-f0-9]{64}$/);
  fs.symlinkSync(os.tmpdir(),path.join(root,'escape'));
  assert.throws(() => inspectInstallation(root),/LINK_ESCAPE/);
  fs.unlinkSync(path.join(root,'escape'));
  fs.symlinkSync('.',path.join(root,'cycle'));
  assert.throws(() => inspectInstallation(root),/LINK_CYCLE/);
});
test('writable package files, hardlinks, foreign package names, and unsafe entrypoints fail', t => {
  const root=packageFixture(t), entry=path.join(root,'openclaw.mjs');
  fs.chmodSync(entry,0o666);
  assert.throws(() => inspectInstallation(root),/WRITABLE|FILE/);
  fs.chmodSync(entry,0o644);
  fs.linkSync(entry,path.join(root,'hardlink'));
  assert.throws(() => inspectInstallation(root),/INSTALLATION_FILE/);
  fs.unlinkSync(path.join(root,'hardlink'));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'fake',version:'2026.10.1',bin:'openclaw.mjs'}));
  assert.throws(() => inspectInstallation(root),/PACKAGE_VERSION/);
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'openclaw',version:'2026.10.1',bin:'../escape'}));
  assert.throws(() => inspectInstallation(root),/PACKAGE_ENTRY/);
});
test('registered Linux applications bind executable bytes, canonical path, and identity', t => {
  const root=packageFixture(t), exe=path.join(root,'app');fs.writeFileSync(exe,'#!/bin/sh\nexit 0\n',{mode:0o755});
  const initial=inspectInstallation(exe,{kind:'application',bundleId:'mousepad'});
  assert.equal(initial.bundleId,'mousepad');
  fs.appendFileSync(exe,'\n');
  assert.notEqual(inspectInstallation(exe,{kind:'application',bundleId:'mousepad'}).installationSha256,initial.installationSha256);
  fs.chmodSync(exe,0o644);
  assert.throws(() => inspectInstallation(exe,{kind:'application',bundleId:'mousepad'}),/APPLICATION_EXECUTABLE/);
});
