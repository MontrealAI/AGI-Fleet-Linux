import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fixture } from './fixture.mjs';
import { Gateway } from '../engine/gateway.mjs';
import { runNative, nativeRuntime, sourceDigest, validateConfig } from '../engine/runner.mjs';
import { open } from '../engine/envelope.mjs';
import { NativeSession } from '../engine/native.mjs';
import { Journal } from '../engine/core.mjs';

function setup(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-linux-runtime-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,...fixture(dir)}; }
function nodeDescriptor() {return {nodeId:'test-node',platform:'linux',connected:true,commands:['computer.act','screen.snapshot'],computerUse:{contractVersion:2,provider:{id:'cua-computer',generation:'linux-one'},actions:['screenshot','type']}};}

test('real Gateway adapter admits only explicitly paired Linux CUA contract-v2 providers', async t => {
  const f=setup(t),g=new Gateway(f.c);let node=nodeDescriptor();g.request=async()=>node;
  assert.equal((await g.node()).computerUse.provider.id,'cua-computer');
  for(const change of [n=>n.platform='macos', n=>n.nodeId='another-node', n=>n.connected=false, n=>n.commands=['screen.snapshot'], n=>n.computerUse.contractVersion=1, n=>n.computerUse.provider.id='fallback-provider', n=>n.computerUse.provider.generation='', n=>n.computerUse.actions=[]]) {node=nodeDescriptor();change(node);await assert.rejects(()=>g.node(),/NODE_NOT_READY|PROVIDER_CHANGED/);}
  g.close();
});
test('Linux runtime pins exact versions and source identity includes platform implementation', t => {
  const f=setup(t);f.c.openclawVersion='2026.10.1-beta.2';assert.equal(validateConfig(f.c),f.c);assert.equal(nativeRuntime(f.c).openclawVersion,f.c.openclawVersion);
  assert.throws(()=>validateConfig({...f.c,provider:'peekaboo'}),/CONFIG/);
  assert.throws(()=>validateConfig({...f.c,openclawVersion:'latest'}),/CONFIG/);
  const copy=path.join(f.dir,'source');fs.cpSync(new URL('../engine',import.meta.url),copy,{recursive:true});const hash=sourceDigest(copy);fs.appendFileSync(path.join(copy,'platform.mjs'),'\n');assert.notEqual(sourceDigest(copy),hash);
});
test('synthetic Linux run dispatches desktop action once, creates real output, and seals private handoff', async t => {
  const f=setup(t),actions=[];let step=0,outputDir;
  const gateway={hello:{server:{version:f.c.openclawVersion}},connect:async()=>{},node:async()=>nodeDescriptor(),close:()=>{},
    invoke:async(command,args)=>{actions.push({command,args});if(command==='screen.snapshot')return {displayFrameId:'fixture-frame-'+actions.length,width:100,height:80,screenIndex:0,format:'png',base64:'AA=='};if(args.action==='type')fs.writeFileSync(path.join(outputDir,'result.json'),'{"value":42}');return {ok:true};},
    plan:async(messages)=>{const job=JSON.parse(messages[1].content);assert.deepEqual(job.actualAllowedActions,['screenshot','type']);assert.match(messages[0].content,/only actions listed in actualAllowedActions/);outputDir=job.outputDirectory;return {answer:step++===0?{action:'type',args:{text:'42'}}:{finished:true,review:null},usage:{total_tokens:10}};},
  };
  const result=await runNative(f.c,f.packet,{allowTestPlatform:true,gatewayFactory:()=>gateway});
  assert.equal(result.status,'complete');assert.equal(actions.filter(x=>x.args.action==='type').length,1);assert.equal(actions.filter(x=>x.args.action==='__close_execution').length,1);
  const envelope=JSON.parse(fs.readFileSync(result.output)),delivery=JSON.parse(open(envelope,f.recipient.privateKey,envelope.header.context));assert.equal(JSON.parse(Buffer.from(delivery.files[0].content,'base64')).value,42);
  assert(!fs.readFileSync(result.output,'utf8').includes('"value":42'));
  await assert.rejects(()=>runNative(f.c,f.packet,{allowTestPlatform:true,gatewayFactory:()=>gateway}),/DUPLICATE_RUN/);
});
test('operator STOP blocks admission before any Gateway connection or model call', async t => {
  const f=setup(t);fs.mkdirSync(f.c.dataDir,{mode:0o700});fs.writeFileSync(path.join(f.c.dataDir,'STOP'),'operator stopped');let invoked=0;
  await assert.rejects(()=>runNative(f.c,f.packet,{allowTestPlatform:true,gatewayFactory:()=>{invoked++;throw Error('must not connect');}}),/OPERATOR_STOP/);assert.equal(invoked,0);
});
test('type, key and scroll carry the exact CUA screenshot frame and invalidate it before dispatch', async t => {
  const f=setup(t),journal=new Journal(f.c.dataDir),calls=[];journal.start('frame-test','a'.repeat(64),'b'.repeat(64),'agent');t.after(()=>journal.close());
  let serial=0;
  const gateway={node:async()=>({computerUse:{provider:{generation:'one'},actions:['screenshot','type','key','scroll']}}),invoke:async(command,params)=>{calls.push(params);return command==='screen.snapshot'?{displayFrameId:'frame-'+(++serial),width:120,height:90,screenIndex:0,format:'png',base64:'AA=='}:{ok:true};}};
  const session=new NativeSession(gateway,journal,'frame-test',{maxActions:12});
  for(const [action,args] of [['type',{text:'hello'}],['key',{keys:'ctrl+a'}],['scroll',{scrollDirection:'down',scrollAmount:2}]]) {
    await session.act('screenshot');const frame=session.frame.id;await session.act(action,args);
    assert.equal(calls.at(-1).displayFrameId,frame);assert.equal(calls.at(-1).refWidth,120);assert.equal(session.frame,null);
    await assert.rejects(()=>session.act(action,args),/FRESH_SCREEN_REQUIRED/);
  }
  await session.close();
});
