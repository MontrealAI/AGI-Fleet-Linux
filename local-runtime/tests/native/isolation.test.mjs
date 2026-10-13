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
    const code=`const fs=require('fs'),net=require('net'),assert=require('assert/strict');assert.equal(process.env.ACTOR_SECRET,undefined);assert.equal(fs.existsSync(${JSON.stringify(secret)}),false);assert.equal(fs.existsSync('/run/user'),false);assert.equal(fs.existsSync('/var/run/docker.sock'),false);assert.throws(()=>fs.writeFileSync('/input/file','changed'));assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),${JSON.stringify(network)});const s=net.connect({host:'127.0.0.1',port:${port}});s.on('connect',()=>process.exit(1));s.on('error',()=>console.log('ISOLATION_PASS'));setTimeout(()=>process.exit(1),1000).unref();`;
    const result=spawnSync('/usr/bin/bwrap',[...sandboxArguments(),'--ro-bind',input,'/input/file','--','/node','-e',code],{encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin',ACTOR_SECRET:'do-not-inherit'}});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ISOLATION_PASS/);assert.equal(fs.readFileSync(input,'utf8'),'immutable');
  }finally{await new Promise(resolve=>host.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
test('actual saved code executes in a fresh sandbox and produces verified report bytes',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-native-run-'));fs.chmodSync(directory,0o700);
  const runtime=new LocalRuntime(directory,{create:true});
  try{const p=runtime.issueClient().principal,a=runtime.addActor({role:'agent',name:'Native qualification'},p);runtime.activate({actor:a.id,confirm:true},p);const g=runtime.prepare({actor:a.id,task:task()},p);runtime.authorize({grant:g.grant,commitment:g.commitment,confirm:true},p);const r=await runtime.run({actor:a.id,grant:g.grant},p);assert.equal(r.receipt.result.checker.passed,true);assert.equal(r.receipt.observation.processGroupGone,true);assert.equal(r.receipt.observation.network,'none');assert.match(r.receipt.result.files.find(f=>f.name==='report.html').content,/<table/);}finally{runtime.close();fs.rmSync(directory,{recursive:true,force:true});}
});
