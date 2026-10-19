import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture} from './helpers.mjs';
import {createServer} from '../supervisor/server.mjs';
import {client} from '../cli/main.mjs';
import fs from 'node:fs';
import {createSystem,runCandidate,exportCapsule} from '../../fleet/successor/vendor/manager/site/assets/successor/model.mjs';
import {defaultMission} from '../../fleet/successor/vendor/manager/site/assets/successor/missions.mjs';
import {MAX_BYTES,CAPSULE_ENVELOPE_BYTES} from '../primitives.mjs';

test('optional Computer Use CLI refuses ambiguous or relative configuration before creating state',()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-computer-cli-'));
  try{for(const args of [['serve','--computer-config'],['serve','--computer-config','relative.json'],['serve','--computer-config','/tmp/profile.json','--computer-config','/tmp/other.json'],['serve','--unknown','/tmp/profile.json']]){
    const state=path.join(parent,'absent-state');
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../cli/main.mjs',import.meta.url)),...args],{env:{...process.env,AGI_LOCAL_STATE:state},encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/ARGUMENTS_INVALID/);assert.equal(fs.existsSync(state),false);
  }}finally{fs.rmSync(parent,{recursive:true,force:true});}
});

test('HTTP rejects missing credentials, foreign Host/Origin, null Origin, unknown routes and scoped escalation',async()=>{
  const f=fixture(),s=createServer(f.runtime);try{const {url}=await s.start(),t=f.runtime.issueClient();
    const req=(route='status',headers={},body={})=>new Promise((resolve,reject)=>{const q=http.request(url+'/v1/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t.token,...headers}},r=>{r.resume();r.on('end',()=>resolve({status:r.statusCode}));});q.on('error',reject);q.end(JSON.stringify(body));});
    assert.equal((await req()).status,200);assert.equal((await req('status',{Authorization:''})).status,400);
    assert.equal((await req('status',{Origin:'http://evil.test'})).status,403);assert.equal((await req('status',{Origin:'null'})).status,403);assert.equal((await req('status',{Host:'localhost'})).status,403);
    assert.equal((await req('host-command',{},{})).status,400);
    const a=f.create(),c=f.runtime.issueClient(a.id);assert.equal((await req('create',{Authorization:'Bearer '+c.token},{role:'node',name:'forged'})).status,400);
    const page=await fetch(url+'/');assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(page.headers.get('access-control-allow-origin'),null);
  }finally{s.server.closeAllConnections();await new Promise(r=>s.server.close(r));f.close();}
});
test('local Unix socket CLI uses the same authority path; a second supervisor cannot take its socket',async()=>{
  const f=fixture(),socket=f.directory+'/control.sock',s=createServer(f.runtime,{socket});let second;
  try{await s.start();const {token}=f.runtime.issueClient();fs.writeFileSync(f.directory+'/credential',token,{mode:0o600});
    const result=await client({state:f.directory,tokenFile:f.directory+'/credential',action:'status',input:{}});
    const capsule=await boundaryCapsule(),imported=await client({state:f.directory,tokenFile:f.directory+'/credential',action:'project-import',input:{capsule,confirm:true}});
    const exported=await client({state:f.directory,tokenFile:f.directory+'/credential',action:'project-export',input:{project:imported.project}});assert.deepEqual(JSON.parse(exported.capsule),JSON.parse(capsule));
    assert.equal(result.schema,'agi-fleet/local-status/v1');assert.equal(fs.statSync(socket).mode&0o777,0o600);
    second=createServer(f.runtime,{socket});await assert.rejects(second.start(),/EADDRINUSE/);
  }finally{s.server.closeAllConnections();await new Promise(r=>s.server.close(r));f.close();}
});
test('WebSocket upgrades are closed without a control session',async()=>{
  const f=fixture(),s=createServer(f.runtime);try{const {url}=await s.start();await new Promise((resolve,reject)=>{const req=http.request(url,{headers:{Connection:'Upgrade',Upgrade:'websocket'}});req.on('upgrade',()=>reject(Error('UPGRADE_ACCEPTED')));req.on('error',()=>resolve());req.setTimeout(1000,()=>req.destroy());req.end();});}finally{s.server.closeAllConnections();await new Promise(r=>s.server.close(r));f.close();}
});

async function boundaryCapsule(){
  const mission=defaultMission();mission.input='id,category,value\n'+Array.from({length:1000},(_,i)=>'row'+i+','+('Category '+i).padEnd(79,'x')+',1').join('\n');
  let state=await createSystem(mission);for(let i=0;i<11;i++)state=(await runCandidate(state,'baseline',i.toString(16).padStart(64,'0'))).state;
  return exportCapsule(state);
}
test('authenticated HTTP imports and exports a near-capacity capsule inside a separately bounded JSON envelope',async()=>{
  const f=fixture(),s=createServer(f.runtime);try{
    const {url}=await s.start(),{token}=f.runtime.issueClient(),capsule=await boundaryCapsule(),body=JSON.stringify({capsule,confirm:true});
    assert.ok(Buffer.byteLength(capsule)<=MAX_BYTES);assert.ok(Buffer.byteLength(body)>MAX_BYTES);assert.ok(Buffer.byteLength(body)<CAPSULE_ENVELOPE_BYTES);
    const post=async(action,input)=>{const response=await fetch(url+'/v1/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(input)});const raw=await response.text();assert.equal(response.status,200,raw);return {raw,value:JSON.parse(raw)};};
    const imported=await post('project-import',{capsule,confirm:true});assert.equal(imported.value.authority,'none');
    const exported=await post('project-export',{project:imported.value.project});assert.ok(Buffer.byteLength(exported.raw)>MAX_BYTES);assert.ok(Buffer.byteLength(exported.raw)<CAPSULE_ENVELOPE_BYTES);assert.deepEqual(JSON.parse(exported.value.capsule),JSON.parse(capsule));
    const refused=await fetch(url+'/v1/status',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body});assert.equal(refused.status,400);
  }finally{s.server.closeAllConnections();await new Promise(r=>s.server.close(r));f.close();}
});
