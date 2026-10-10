import {statePreparationFixture} from './state-preparation-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {publicBrowserRuntimeSocketPath,ensurePublicBrowserRuntimeDirectory} from '../compute/public-browser-runtime.mjs';
import {fileURLToPath} from 'node:url';
import {importPublicWebQualification} from '../compute/import-public-web-qualification.mjs';
import {publicWebQualificationIdentity,publicWebQualificationCandidateIdentity,publicWebMachineIdentity,publicWebQualificationSources} from '../compute/public-web-qualification-identity.mjs';
import {beginSetupTransaction} from '../compute/setup-transaction.mjs';
import {WORKSTATION_SKILLS} from '../compute/profile.mjs';
import {canonical,sha256} from '../src/util.mjs';
import {harness} from './helpers/public-web-harness.mjs';
import {qualificationFixture} from './helpers/public-web-qualification-fixture.mjs';
import {verifyPublicWebQualification} from '../compute/public-web-qualification.mjs';
const json=(file,value)=>fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});
function importerFixture(){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-browser-import-')),profileDir=path.join(home,'.openclaw-agi-compute');fs.mkdirSync(profileDir,{mode:0o700});
 const settingsFile=path.join(profileDir,'compute-settings.json'),receiptFile=path.join(home,'receipt.json');
 const c={role:'agent',profileDir,port:18894,gatewayPort:18896,gatewayConfig:path.join(profileDir,'gateway.json'),signerUID:502,isolationAcknowledged:true,policyHash:'a'.repeat(64),publicWebPolicy:{enabled:true,mode:'commissioning',reviewerPublicKey:'reviewer fixture',operatorPublicKey:'operator fixture'}};
 json(settingsFile,c);json(c.gatewayConfig,{agents:{entries:{}}});json(receiptFile,{payload:{expiresAt:Date.now()+3600000},signature:'test-double'});
 let stopped=0,revision='b'.repeat(64),checked=0;
 const dependencies={prepareCandidateState:()=>statePreparationFixture(),finishCandidateStatePreparation:()=>{},platform:'darwin',arch:'arm64',uid:501,fileUID:process.getuid?.(),runtimePlatform:process.platform,stopTimeoutMs:200,stopPollIntervalMs:1,stop:async()=>{stopped++;return true;},assertPolicy:settings=>assert.equal(settings.profileDir,profileDir),identity:settings=>({executionFingerprint:revision,sourceHashes:{'compute/server.mjs':'d'.repeat(64)},candidatePolicyHash:settings.publicWebPolicy.qualificationCandidatePolicyHash??settings.policyHash,reviewerPublicKey:'reviewer fixture'}),verifyReceipt:receipt=>{checked++;assert.ok(receipt.payload.expiresAt>Date.now());return {residuals:[{id:'network-campaign',status:'NOT_TESTED'}],productionQualified:false};},policyHash:()=> 'c'.repeat(64)};
 const rl={question:async prompt=>'IMPORT '+/IMPORT ([a-f0-9]{12})/.exec(prompt)[1]};
 return {home,profileDir,settingsFile,receiptFile,c,dependencies,rl,stopped:()=>stopped,checked:()=>checked,mutateIdentity:()=>revision='e'.repeat(64),read:()=>JSON.parse(fs.readFileSync(settingsFile)),close:()=>fs.rmSync(home,{recursive:true,force:true})};
}
test('stopped importer publishes only reviewed qualification metadata and leaves services stopped',async()=>{const h=importerFixture();try{const result=await importPublicWebQualification({...h,role:'agent'});const actual=h.read();assert.equal(result.status,'IMPORTED');assert.equal(result.services,'STOPPED');assert.equal(result.productionQualified,false);assert.equal(actual.publicWebPolicy.mode,'qualified');assert.equal(actual.policyHash,'c'.repeat(64));assert.equal(actual.publicWebPolicy.qualificationCandidatePolicyHash,h.c.policyHash);assert.ok(fs.existsSync(actual.publicWebPolicy.qualificationReceiptFile));const {publicWebPolicy,policyHash,...base}=actual;const {publicWebPolicy:old,policyHash:oldHash,...before}=h.c;assert.deepEqual(base,before);assert.ok(h.stopped()>=2);assert.ok(h.checked()>=3);}finally{h.close();}});
test('rejected import, stale source identity and cancelled prompt never publish authority',async()=>{for(const mode of ['reject','changed','abort']){const h=importerFixture(),abort=new AbortController();try{h.rl.question=async(prompt,options)=>{if(mode==='changed')h.mutateIdentity();if(mode==='abort'){assert.equal(options.signal,abort.signal);abort.abort();throw abort.signal.reason;}return mode==='reject'?'NO':'IMPORT '+/IMPORT ([a-f0-9]{12})/.exec(prompt)[1];};await assert.rejects(importPublicWebQualification({...h,role:'agent',signal:abort.signal}));assert.equal(h.read().publicWebPolicy.mode,'commissioning');assert.equal(h.read().policyHash,h.c.policyHash);assert.ok(h.stopped()>=1);}finally{h.close();}}});
test('abort after publication uses uncancelled rollback and restores exact previous settings',async()=>{const h=importerFixture(),abort=new AbortController();try{h.dependencies.policyHash=()=>{abort.abort();return 'c'.repeat(64);};await assert.rejects(importPublicWebQualification({...h,role:'agent',signal:abort.signal}));assert.deepEqual(h.read(),h.c);assert.ok(h.stopped()>=3);}finally{h.close();}});
test('restart recovers both missing live profile and unsealed swapped candidate before validation',async()=>{for(const stage of ['first-rename','published']){const h=importerFixture();try{const directory=path.join(h.home,'.agi-genesis-setup-agent','qualification-transaction'),tx=await beginSetupTransaction({profileDir:h.profileDir,directory,stop:h.dependencies.stop});const changed={...h.c,publicWebPolicy:{...h.c.publicWebPolicy,mode:'qualified'}};json(path.join(tx.candidate,'compute-settings.json'),changed);tx.state.state=stage==='first-rename'?'publishing':'published';tx.save();fs.renameSync(h.profileDir,tx.previous);if(stage==='published')fs.renameSync(tx.candidate,h.profileDir);const result=await importPublicWebQualification({...h,role:'agent'});assert.equal(result.status,'IMPORTED');assert.equal(h.read().publicWebPolicy.qualificationCandidatePolicyHash,h.c.policyHash);}finally{h.close();}}});
test('existing cleanup uncertainty and unsafe receipt links fail before qualification publication',async()=>{for(const mode of ['journal','symlink']){const h=importerFixture();try{if(mode==='journal')json(path.join(h.profileDir,'compute-journal.json'),{requests:[{status:'cleanup-required'}]});else{const target=path.join(h.home,'target.json');fs.renameSync(h.receiptFile,target);fs.symlinkSync(target,h.receiptFile);}await assert.rejects(importPublicWebQualification({...h,role:'agent'}));assert.equal(h.read().publicWebPolicy.mode,'commissioning');}finally{h.close();}}});
test('execution fingerprint is mode-transition stable but binds machine, credentials, source and settings',async()=>{const h=harness();let root;try{
 h.c.workspace=path.join(h.dir,'workspace');fs.mkdirSync(h.c.workspace);fs.writeFileSync(path.join(h.c.workspace,'AGENTS.md'),'public fixture');for(const name of WORKSTATION_SKILLS){fs.mkdirSync(path.join(h.c.workspace,'skills',name),{recursive:true});fs.writeFileSync(path.join(h.c.workspace,'skills',name,'SKILL.md'),'fixture '+name);}
 h.c.publicWebPolicy.reviewerPublicKey=crypto.generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'});
 const actualRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-source-identity-'));fs.cpSync(path.join(actualRoot,'compute'),path.join(root,'compute'),{recursive:true});for(const name of Object.keys(publicWebQualificationSources(actualRoot)).filter(x=>!x.startsWith('compute/'))){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.copyFileSync(path.join(actualRoot,name),path.join(root,name));}
 const options={root,checkRuntime:()=>({}),machineIdentity:()=>({hostSHA256:'1'.repeat(64),osBuild:'fixture',engineIDSHA256:'2'.repeat(64)})},before=publicWebQualificationIdentity(h.c,options);assert.ok(Object.keys(before.sourceHashes).length<=128);
 const next=structuredClone(h.c);Object.assign(next.publicWebPolicy,{mode:'qualified',qualificationEvidenceSha256:'f'.repeat(64),qualificationReceiptSha256:'f'.repeat(64),qualificationReceiptFile:'/fixture/receipt',qualificationImportedAt:123,qualificationCandidatePolicyHash:h.c.policyHash});assert.equal(publicWebQualificationIdentity(next,options).executionFingerprint,before.executionFingerprint);
 next.policyHash='9'.repeat(64);const installed=publicWebQualificationIdentity(next,options),candidate=publicWebQualificationCandidateIdentity(next,{identity:c=>publicWebQualificationIdentity(c,options)});assert.equal(installed.candidatePolicyHash,h.c.policyHash);assert.equal(candidate.candidatePolicyHash,next.policyHash);assert.equal(candidate.executionFingerprint,installed.executionFingerprint);
 assert.notEqual(publicWebQualificationIdentity(next,{...options,machineIdentity:()=>({hostSHA256:'3'.repeat(64)})}).executionFingerprint,before.executionFingerprint);
 next.token='new private runtime credential';assert.notEqual(publicWebQualificationIdentity(next,options).executionFingerprint,before.executionFingerprint);next.token=h.c.token;
 fs.appendFileSync(path.join(root,'compute/public-web-proxy.mjs'),'\n// changed reviewed implementation\n');assert.notEqual(publicWebQualificationIdentity(next,options).executionFingerprint,before.executionFingerprint);
 assert.ok(!canonical(before).includes(h.dir));assert.ok(!canonical(before).includes(h.c.token));
 }finally{await h.close();if(root)fs.rmSync(root,{recursive:true,force:true});}});
test('physical machine identity rejects unsupported platform and changes with OS, engine or Mac',()=>{const engine={ID:'engine-A',ServerVersion:'29.1.0',OSType:'linux',Architecture:'aarch64',KernelVersion:'linux-fixture'};let uuid='12345678-1234-1234-1234-123456789abc',build='26A123';const run=(exe,args)=>({status:0,stdout:exe.endsWith('ioreg')?'"IOPlatformUUID" = "'+uuid+'"':exe.endsWith('sw_vers')?build:JSON.stringify(engine)}),options={run,platform:'darwin',arch:'arm64',release:'26.0.0'};const original=publicWebMachineIdentity({docker:'/fixture/docker'},options);assert.ok(!canonical(original).includes(uuid));uuid='12345678-1234-1234-1234-123456789abd';assert.notDeepEqual(publicWebMachineIdentity({docker:'/fixture/docker'},options),original);uuid='12345678-1234-1234-1234-123456789abc';build='26A124';assert.notDeepEqual(publicWebMachineIdentity({docker:'/fixture/docker'},options),original);assert.throws(()=>publicWebMachineIdentity({docker:'/fixture/docker'},{...options,platform:'linux'}),/PUBLIC_WEB_QUALIFICATION_LINUX_REQUIRED/);});

test('dead installer lock is recovered but a live setup process cannot be displaced',async()=>{for(const live of [false,true]){const h=importerFixture();try{const support=path.join(h.home,'.agi-genesis-setup-agent');fs.mkdirSync(support);const lock=path.join(support,'installer.lock');json(lock,{pid:live?process.pid:2147483646,at:new Date().toISOString()});if(live){await assert.rejects(importPublicWebQualification({...h,role:'agent'}),/SETUP_ALREADY_RUNNING/);assert.equal(JSON.parse(fs.readFileSync(lock)).pid,process.pid);}else{assert.equal((await importPublicWebQualification({...h,role:'agent'})).status,'IMPORTED');assert.equal(fs.existsSync(lock),false);}}finally{h.close();}}});

test('renewal import accepts a qualified profile only against its current policy and keeps explicit review',async()=>{const h=importerFixture();try{const oldCandidate='0'.repeat(64);h.c.publicWebPolicy.mode='qualified';h.c.publicWebPolicy.qualificationCandidatePolicyHash=oldCandidate;h.c.publicWebPolicy.qualificationReceiptSha256='1'.repeat(64);json(h.settingsFile,h.c);let checks=0;h.dependencies.verifyReceipt=(receipt,options)=>{checks++;assert.equal(options.candidatePolicyHash,h.c.policyHash,'renewal must bind the currently executed policy, not the original receipt policy');return {residuals:[],productionQualified:false};};const result=await importPublicWebQualification({...h,role:'agent'});assert.equal(result.status,'IMPORTED');assert.ok(checks>=3);assert.equal(h.read().publicWebPolicy.qualificationCandidatePolicyHash,h.c.policyHash);}finally{h.close();}});

// The old receipt is correctly signed and fresh. It cannot renew the policy
// sealed after its original import, even when all other bindings match.
test('renewal rejects replay of an independently signed original-policy receipt before stopping services',async()=>{
 const h=importerFixture(),f=await qualificationFixture({now:Date.now()-1000,candidatePolicyHash:'0'.repeat(64)});
 try{
  h.c.publicWebPolicy.mode='qualified';h.c.publicWebPolicy.qualificationCandidatePolicyHash=f.payload.candidatePolicyHash;json(h.settingsFile,h.c);json(h.receiptFile,f.receipt);
  h.dependencies.identity=()=>f.options;h.dependencies.verifyReceipt=verifyPublicWebQualification;
  await assert.rejects(importPublicWebQualification({...h,role:'agent'}),/QUALIFICATION_BINDING/);
  assert.equal(h.stopped(),0);assert.deepEqual(h.read(),h.c);
 }finally{h.close();await f.close();}
});
test('renewal remains explicitly reviewed and refuses undrained work without replacing old receipt metadata',async()=>{
 for(const pending of [false,true]){const h=importerFixture();try{
  Object.assign(h.c.publicWebPolicy,{mode:'qualified',qualificationCandidatePolicyHash:'0'.repeat(64),qualificationReceiptSha256:'1'.repeat(64)});json(h.settingsFile,h.c);
  if(pending)json(path.join(h.profileDir,'compute-journal.json'),{requests:[{status:'web-active'}],calls:[123]});else h.rl.question=async()=> 'NO';
  await assert.rejects(importPublicWebQualification({...h,role:'agent'}),pending?/RECONCILIATION_REQUIRED/:/IMPORT_CANCELLED/);assert.deepEqual(h.read(),h.c);
 }finally{h.close();}}
});

test('qualification import uses bounded external and legacy socket shutdown before snapshotting the profile',async()=>{
 for(const external of [false,true]){
 const h=importerFixture(),socketPath=external?publicBrowserRuntimeSocketPath(h.profileDir):path.join(h.profileDir,'web.sock'),server=net.createServer(socket=>socket.destroy());
 if(external)ensurePublicBrowserRuntimeDirectory({profileDir:h.profileDir,socketPath});
 try{
  await new Promise((resolve,reject)=>server.once('error',reject).listen(socketPath,resolve));fs.chmodSync(socketPath,0o600);delete h.dependencies.stop;let prints=0,probes=0;
  h.dependencies.stopTimeoutMs=500;h.dependencies.run=async(file,args)=>args[0]==='print'?(++prints<=2?{status:0,stdout:'state = stopping'}:{status:113,stderr:'Could not find service "'+args[1].split('/').at(-1)+'" in domain for user gui: 501'}):{status:0,stdout:''};
  h.dependencies.probePort=async()=>++probes===1;setTimeout(()=>server.close(),30);
  const result=await importPublicWebQualification({...h,role:'agent'});
  assert.equal(result.status,'IMPORTED');assert.equal(result.services,'STOPPED');assert(prints>2);assert(probes>1);assert.equal(fs.existsSync(socketPath),false);
 }finally{await new Promise(resolve=>server.close(()=>resolve()));if(external)fs.rmSync(path.dirname(socketPath),{recursive:true,force:true});h.close();}
 }
});
test('qualification import refuses unexpected legacy socket-path content without replacing authority',async()=>{
 const h=importerFixture(),socketPath=path.join(h.profileDir,'web.sock');
 try{
  fs.writeFileSync(socketPath,'preserve socket-path content',{mode:0o600});delete h.dependencies.stop;
  h.dependencies.run=async(file,args)=>args[0]==='print'?{status:113,stderr:'Could not find service "'+args[1].split('/').at(-1)+'" in domain for user gui: 501'}:{status:0,stdout:''};h.dependencies.probePort=async()=>false;
  await assert.rejects(importPublicWebQualification({...h,role:'agent'}));assert.deepEqual(h.read(),h.c);assert.equal(fs.readFileSync(socketPath,'utf8'),'preserve socket-path content');
 }finally{h.close();}
});

for(const mutation of ['content','schema'])test(`qualification import refuses ${mutation} preparation changes before import approval or live publication`,async()=>{
 const h=importerFixture();try{let prompts=0;h.rl.question=async()=>{prompts++;assert.fail('changed state requires full commissioning before IMPORT');};h.dependencies.prepareCandidateState=()=>({...statePreparationFixture(),[mutation==='content'?'destinationContentSha256':'destinationSchemaSha256']:'f'.repeat(64)});
 await assert.rejects(importPublicWebQualification({...h,role:'agent'}),/PUBLIC_WEB_QUALIFICATION_REPAIR_REQUIRED/);assert.equal(prompts,0);assert.deepEqual(h.read(),h.c);assert.equal(fs.existsSync(path.join(h.profileDir,'public-web-qualification.json')),false);
 }finally{h.close();}
});
