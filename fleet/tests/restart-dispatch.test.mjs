import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {main} from '../scripts/restart-compute.mjs';
test('Fleet restart help needs no profile and unsupported flags never bypass explicit role selection',async()=>{assert.equal(await main(['--help']),0);await assert.rejects(main(['--role','invalid']),/REPAIR_ROLE_INVALID/);});
test('all restart launchers support spaces, forward roles, preserve failure and leave their caller alive',t=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),dir=fs.mkdtempSync(path.join(os.tmpdir(),'restart launcher '));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const quote=s=>"'"+s.replaceAll("'","'\\''")+"'",node=path.join(dir,'mock node');fs.writeFileSync(node,'\x23!/bin/sh\nprintf "%s\\n" "$@" > "$AGI_CAPTURE"\nexit 2\n',{mode:0o755});
 for(const app of ['',...['Agent','Node','Moderator','Employer','Evidence','Recovery'].map(role=>'packages/AGI_'+role)]){const target=path.join(dir,'Release with spaces',app);fs.mkdirSync(path.join(target,'scripts'),{recursive:true});fs.writeFileSync(path.join(target,'scripts/node-runtime.sh'),`agi_require_node_24() { AGI_RUNTIME_NODE=${quote(node)}; }\n`);fs.copyFileSync(path.join(root,app,'Restart-Compute.command'),path.join(target,'Restart-Compute.command'));const capture=path.join(dir,'capture'),r=spawnSync('/bin/sh',['-c','"$1" '+(app?'--help':'--role node')+'; code=$?; printf "caller-alive:%s" "$code"','test',path.join(target,'Restart-Compute.command')],{encoding:'utf8',env:{...process.env,AGI_CAPTURE:capture}});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/caller-alive:2/);assert.deepEqual(fs.readFileSync(capture,'utf8').trim().split('\n').slice(1),app?['--role',app.split('_').at(-1).toLowerCase(),'--help']:['--role','node']);}
});
