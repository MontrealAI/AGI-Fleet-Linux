#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';

export function selectRepairRole(args, home = os.homedir()) {
  const index = args.indexOf('--role');
  if (index !== -1) {
    if (!['agent', 'node'].includes(args[index + 1])) throw Error('REPAIR_ROLE_INVALID');
    return args[index + 1];
  }
  const installed = ['agent', 'node'].filter(role => fs.existsSync(path.join(home, role === 'agent' ? '.openclaw-agi-compute' : '.openclaw-agi-node-compute', 'agi-compute-profile.json')));
  if (installed.length === 1) return installed[0];
  throw Error(installed.length ? 'REPAIR_ROLE_SELECTION_REQUIRED' : 'EXISTING_COMPUTE_PROFILE_NOT_FOUND');
}
export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) { console.log('Repair-Compute.command [--role agent|node] [--network] [--export NEW_FILE.json] [--apply|--resume|--rollback|--restart]\nThe installed compute profile determines the role. If both exist, specify --role. Run in the existing Standard compute account.'); return 0; }
  const role = selectRepairRole(args);
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', role === 'agent' ? 'AGI_Agent' : 'AGI_Node');
  const {repairMain} = await import(pathToFileURL(path.join(directory, 'compute/repair.mjs')).href);
  return repairMain(args.includes('--role') ? args : [...args, '--role', role]);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.message === 'REPAIR_ROLE_SELECTION_REQUIRED' ? 'Both compute profiles exist. Open the Agent or Node package and use its Repair-Compute.command, or add --role agent / --role node.' : 'No matching compute profile was selected. Open Repair-Compute.command in the existing Standard compute account. For a new installation, use Setup-OpenClaw.command.');
  process.exitCode = 2;
});
