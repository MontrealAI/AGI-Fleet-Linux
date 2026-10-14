import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import {LinuxSandbox,sandboxArguments} from '../../platforms/linux.mjs';
import {LocalRuntime} from '../../supervisor/runtime.mjs';
import {task} from '../helpers.mjs';
import {defaultMission,executeMission} from '../../../fleet/successor/vendor/manager/site/assets/successor/missions.mjs';
import crypto from 'node:crypto';

test('real native isolation denies host state, inherited credentials, input writes and host network',async()=>{
  const sandbox=new LinuxSandbox(),d=sandbox.inspect();
  if(!d.supported){
    const probe=spawnSync('/usr/bin/bwrap',[...sandboxArguments(),'--','/node','--version'],{encoding:'utf8',timeout:5000,maxBuffer:8192,env:{PATH:'/usr/bin:/bin'}});
    assert.fail(JSON.stringify({host:d,probe:{status:probe.status,error:probe.error?.code,stderr:probe.stderr}}));
  }
  const host=net.createServer(socket=>socket.destroy());
  await new Promise((resolve,reject)=>{host.once('error',reject);host.listen(0,'127.0.0.1',resolve);});
  const port=host.address().port,network=fs.readlinkSync('/proc/self/ns/net');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-isolation-')),secret=path.join(dir,'other-actor-token'),input=path.join(dir,'input');fs.writeFileSync(secret,'not-for-executor');fs.writeFileSync(input,'immutable');
  try{
    const code=`const fs=require('fs'),net=require('net'),assert=require('assert/strict');const status=fs.readFileSync('/proc/self/status','utf8');for(const capability of ['CapInh','CapPrm','CapEff','CapBnd'])assert.match(status,new RegExp('^'+capability+':\\\\s+0+$','m'));assert.match(status,/^NoNewPrivs:\\s+1$/m);assert.equal(process.env.ACTOR_SECRET,undefined);assert.equal(fs.existsSync(${JSON.stringify(secret)}),false);assert.equal(fs.existsSync('/run/user'),false);assert.equal(fs.existsSync('/var/run/docker.sock'),false);assert.throws(()=>fs.writeFileSync('/input/file','changed'));assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),${JSON.stringify(network)});const s=net.connect({host:'127.0.0.1',port:${port}});s.on('connect',()=>process.exit(1));s.on('error',()=>console.log('ISOLATION_PASS'));setTimeout(()=>process.exit(1),1000).unref();`;
    const result=spawnSync('/usr/bin/bwrap',[...sandboxArguments(),'--ro-bind',input,'/input/file','--','/node','-e',code],{encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin',ACTOR_SECRET:'do-not-inherit'}});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ISOLATION_PASS/);assert.equal(fs.readFileSync(input,'utf8'),'immutable');
  }finally{await new Promise(resolve=>host.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
test('actual saved code executes in a fresh sandbox and produces verified report bytes',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-native-run-'));fs.chmodSync(directory,0o700);
  const runtime=new LocalRuntime(directory,{create:true});
  try{const p=runtime.issueClient().principal,a=runtime.addActor({role:'agent',name:'Native qualification'},p);runtime.activate({actor:a.id,confirm:true},p);const g=runtime.prepare({actor:a.id,task:task()},p);runtime.authorize({grant:g.grant,commitment:g.commitment,confirm:true},p);const r=await runtime.run({actor:a.id,grant:g.grant},p);assert.equal(r.receipt.result.checker.passed,true);assert.equal(r.receipt.observation.processGroupGone,true);assert.equal(r.receipt.observation.network,'none');assert.match(r.receipt.result.files.find(f=>f.name==='report.html').content,/<table/);}finally{runtime.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('actual cancelled sandbox retains cleanup evidence and permits only explicit no-success reconciliation',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-native-cancel-'));fs.chmodSync(directory,0o700);
  const runtime=new LocalRuntime(directory,{create:true});
  try{
    const p=runtime.issueClient().principal,a=runtime.addActor({role:'agent',name:'Cancellation qualification'},p);
    runtime.activate({actor:a.id,confirm:true},p);const g=runtime.prepare({actor:a.id,task:task()},p);
    runtime.authorize({grant:g.grant,commitment:g.commitment,confirm:true},p);
    const running=runtime.run({actor:a.id,grant:g.grant},p),run=runtime.status(p).runs[0].id;
    runtime.cancel({actor:a.id,run},p);await assert.rejects(running,/RUN_CANCELLED/);
    const plan=await runtime.dispatch('reconciliation',{run},p);
    assert.equal(plan.kind,'recorded-sandbox-closure');assert.equal(plan.eligible,true);
    const result=await runtime.dispatch('reconcile',{run,commitment:plan.commitment,confirm:true},p);
    assert.equal(result.receipt.disposition,'closed-without-success');assert.equal(runtime.status(p).stopped,true);
    assert.equal(runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'consumed');
  }finally{runtime.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('one host concurrently executes Agent work and an unrelated internal Node check in distinct kernel namespaces',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-native-two-roles-'));fs.chmodSync(directory,0o700);
  const runtime=new LocalRuntime(directory,{create:true});
  try{
    const operator=runtime.issueClient().principal;
    const actors=['agent','node'].map(role=>{const a=runtime.addActor({role,name:'Concurrent '+role},operator);return runtime.activate({actor:a.id,confirm:true},operator);});
    const clients=actors.map(a=>runtime.issueClient(a.id).principal);
    const unrelated=defaultMission('website','en'),files=executeMission(unrelated,'improved').files;
    const tasks=[task(),{schema:'agi-fleet/local-task/v1',action:'successor-check',workspace:'files',input:{mission:unrelated,variant:'improved',files},review:'internal',sourceActor:crypto.randomUUID(),sourceController:crypto.randomUUID()}];
    const grants=actors.map((a,i)=>runtime.prepare({actor:a.id,task:tasks[i]},clients[i]));
    for(const g of grants)runtime.authorize({grant:g.grant,commitment:g.commitment,confirm:true},operator);
    const runs=await Promise.all(actors.map((a,i)=>runtime.run({actor:a.id,grant:grants[i].grant},clients[i])));
    assert.ok(runs.every(r=>r.state==='complete'&&r.receipt.result.checker.passed===true&&r.receipt.independentReview===false));
    assert.notEqual(runs[0].receipt.observation.worker.pidNamespace,runs[1].receipt.observation.worker.pidNamespace);
    assert.notEqual(runs[0].receipt.observation.worker.networkNamespace,runs[1].receipt.observation.worker.networkNamespace);
    for(let i=0;i<2;i++){
      assert.ok(runs[i].receipt.observation.worker.maxRSSKiB>0);assert.ok(runs[i].receipt.observation.wallMilliseconds>0);
      assert.throws(()=>runtime.output({actor:actors[1-i].id,run:runs[1-i].run},clients[i]),/CLIENT_SCOPE_DENIED/);
    }
  }finally{runtime.close();fs.rmSync(directory,{recursive:true,force:true});}
});
