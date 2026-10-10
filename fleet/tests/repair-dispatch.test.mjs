import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {selectRepairRole} from '../scripts/repair-compute.mjs';

test('one-entry repair chooses the installed role and refuses ambiguity without changing profiles', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-dispatch-')); t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  assert.throws(() => selectRepairRole([], home), /PROFILE_NOT_FOUND/);
  const agent = path.join(home, '.openclaw-agi-compute'); fs.mkdirSync(agent); fs.writeFileSync(path.join(agent, 'agi-compute-profile.json'), '{}');
  assert.equal(selectRepairRole([], home), 'agent');
  const node = path.join(home, '.openclaw-agi-node-compute'); fs.mkdirSync(node); fs.writeFileSync(path.join(node, 'agi-compute-profile.json'), '{}');
  assert.throws(() => selectRepairRole([], home), /ROLE_SELECTION_REQUIRED/);
  assert.equal(selectRepairRole(['--role', 'node'], home), 'node'); assert.throws(() => selectRepairRole(['--role', 'invalid'], home), /ROLE_INVALID/);
  assert.deepEqual(fs.readdirSync(agent), ['agi-compute-profile.json']); assert.deepEqual(fs.readdirSync(node), ['agi-compute-profile.json']);
});

test('repair command launchers support paths with spaces and preserve child failure without closing caller shell', t => {
  const root = fileURLToPath(new URL('../', import.meta.url)), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repair launcher ')); t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const executable = path.join(directory, 'mock runtime');
  fs.writeFileSync(executable, '\x23!/bin/sh\nprintf "%s\\n" "$@" > "$AGI_CAPTURE"\nexit 2\n', {mode: 0o755});
  for (const app of ['', 'packages/AGI_Agent', 'packages/AGI_Node']) {
    const target = path.join(directory, 'Release with spaces', app); fs.mkdirSync(path.join(target, 'scripts'), {recursive: true});
    fs.writeFileSync(path.join(target, 'scripts/node-runtime.sh'), `agi_require_node_24() { AGI_RUNTIME_NODE=${quote(executable)}; }\n`);
    fs.copyFileSync(path.join(root, app, 'Repair-Compute.command'), path.join(target, 'Repair-Compute.command'));
    const capture = path.join(directory, 'capture.txt'), result = spawnSync('/bin/sh', ['-c', '"$1" --export "$2"; code=$?; printf "caller-alive:%s" "$code"', 'test', path.join(target, 'Repair-Compute.command'), '/private folder/report.json'], {encoding: 'utf8', env: {...process.env, AGI_CAPTURE: capture}});
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /caller-alive:2/);
    assert.deepEqual(fs.readFileSync(capture, 'utf8').trim().split('\n').slice(1), ['--interactive', '--export', '/private folder/report.json']);
  }
});

import {COMPUTE_ROLES,roleContract} from '../packages/AGI_Node/compute/roles.mjs';
for(const role of COMPUTE_ROLES)test('Fleet selects exact registered '+role+' profile and explicit role',t=>{const h=fs.mkdtempSync(path.join(os.tmpdir(),'agi-role-dispatch-'));t.after(()=>fs.rmSync(h,{recursive:true,force:true}));const profile=path.join(h,'.openclaw-'+roleContract(role).profile);fs.mkdirSync(profile,{mode:0o700});fs.writeFileSync(path.join(profile,'agi-compute-profile.json'),'{}');assert.equal(selectRepairRole([],h),role);assert.equal(selectRepairRole(['--role',role],h),role);});
