import {sandboxWorkspaceRoot} from '../compute/sandbox-scope.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {canonical,sha256} from '../src/util.mjs';
import {buildBundle,validateBundle} from '../src/artifacts.mjs';
import {normalizeWork} from '../src/work.mjs';
import {DECLARATION} from '../src/review.mjs';
import {ComputeWorker} from '../compute/server.mjs';
import {computeProfile} from '../compute/profile.mjs';
import {produceFiles,reviewFiles} from '../compute/workstation-session.mjs';
import {createCommissioningPlan,expectedFixtureFiles,verifyFixtureDelivery,corruptFixtureDelivery} from '../compute/commissioning-fixture.mjs';
import {verifyExecCapture,verifyInteractiveCapture,verifyCommissioningCapture} from '../compute/commissioning-evidence.mjs';
import {sanitizeEngineEvent,selectSessionContainer,DockerExecutionObserver} from '../compute/execution-observer.mjs';
const makePlan=()=>createCommissioningPlan({releaseSHA256:'a'.repeat(64),now:Math.floor(Date.now()/1000)*1000-10000});
const response=(plan,failed=false)=>({safeToReview:true,checks:plan.specification.criteria.map(c=>({id:c.id,status:failed&&c.id==='totals'?'fail':'pass',method:'Recomputed fixture rows and read actual declared files',observed:failed&&c.id==='totals'?'CAD total has a one-cent error':'Matches recomputation',files:['result.json','reconciliation.csv']}))});
function captureFixture(){
 const plan=makePlan(),delivery=buildBundle(plan.specification,expectedFixtureFiles(plan)),files=verifyFixtureDelivery(plan,delivery).files;
 const capture={schema:'agi-commissioning-capture/v1',runID:plan.runID,releaseSHA256:plan.releaseSHA256,dependencyMode:'mocked',startedAt:plan.createdAt+1000,finishedAt:plan.createdAt+5000,policyBefore:'b'.repeat(64),policyAfter:'b'.repeat(64),transport:{source:'agent-companion/v1',requests:[]},requests:{},computeJournal:{schema:1,requests:[],calls:[]},sessions:{},delivery,review:response(plan),negativeDelivery:corruptFixtureDelivery(plan,delivery),negativeReview:response(plan,true)};
 for(const [i,name]of ['creator','reviewer','negativeReviewer'].entries()){
  const request={id:crypto.randomUUID(),kind:i?'computer-review':'generate',agent:i?'agi-reviewer':'agi-creator'},container=sha256('container'+i),workspace=sha256('workspace'+i),execID=sha256('exec'+i),time=Math.floor(capture.startedAt/1000);
  capture.requests[name]=request;capture.transport.requests.push({...request,status:200});capture.computeJournal.requests.push({...request,status:'complete',at:capture.startedAt+i});capture.computeJournal.calls.push(capture.startedAt+i);
  capture.sessions[name]={source:'docker-engine-observer/v1',status:'CAPTURED',requestID:request.id,agent:request.agent,sessionKey:`agent:${request.agent}:agi-work-${request.id}`,startedAt:capture.startedAt,finishedAt:capture.finishedAt,expectedImageID:'sha256:'+'c'.repeat(64),inspect:{Id:container,Image:'sha256:'+'c'.repeat(64),HostConfig:{NetworkMode:'none',Privileged:false,ReadonlyRootfs:true},Mounts:[{sourceSHA256:workspace,Destination:'/workspace',RW:true}]},explain:{agentId:request.agent,sandbox:{sessionIsSandboxed:true,scope:'session',backend:'docker',workspaceAccess:'none',workspaceSHA256:workspace}},explainArguments:['sandbox','explain','--agent',request.agent,'--session',`agent:${request.agent}:agi-work-${request.id}`,'--json'],beforeContainerIDs:[],afterContainerIDs:[],unrelatedBefore:[],unrelatedAfter:[],events:['exec_create','exec_start','exec_die'].map(Action=>({Type:'container',Action,time,Actor:{ID:container,Attributes:{execID,...(Action==='exec_die'?{exitCode:'0'}:{})}}})),artifacts:i?[]:files.map(f=>({...f,readMethod:'docker-cp',containerID:container,path:'/workspace/deliverables/'+f.name}))};
 }
 return {plan,capture,files};
}
test('commissioning challenge is fresh, answer withheld, and useful artifacts independently recomputed',()=>{
 const a=makePlan(),b=makePlan();assert.notDeepEqual(a.privateOracle.rows,b.privateOracle.rows);assert.notEqual(a.privateOracle.expected.inputSHA256,b.privateOracle.expected.inputSHA256);
 assert.ok(!a.specification.prompt.includes(canonical(a.privateOracle.expected)));
 const bundle=buildBundle(a.specification,expectedFixtureFiles(a));assert.equal(verifyFixtureDelivery(a,bundle).files.length,2);
 assert.throws(()=>verifyFixtureDelivery(a,corruptFixtureDelivery(a,bundle)),/RECONCILIATION/);
 const files=validateBundle(a.specification,Buffer.from(bundle)).files;files.set('reconciliation.csv',Buffer.from('department,currency,amountCents\nengineering,CAD,0\n'));
 assert.throws(()=>verifyFixtureDelivery(a,buildBundle(a.specification,files)),/CSV/);
});
test('a model claiming files-ready without tool execution or real files fails normal Compute collection',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-echo-proof-')),jobRoot=path.join(dir,'jobs'),inputRoot=path.join(dir,'input');fs.mkdirSync(jobRoot);fs.mkdirSync(inputRoot);
 const worker=new ComputeWorker({role:'agent',workstation:true,profileDir:dir,workspace:dir,jobRoot,inputRoot,maxRuns24h:3,maxImages24h:1},{verifyPolicy:false,cleanupInventory:async()=>({status:"CAPTURED",containerIDs:[]}),cli:async(c,args)=>args[1]==='recreate'?{ok:true,exitStatus:0,signal:null,elapsedMs:1,timeoutMs:30000,timedOut:false,started:true,processTerminationConfirmed:true}:{agentId:'agi-creator',sandbox:{scope:'session',workspaceAccess:'none',sessionIsSandboxed:true,backend:'docker',effectiveHostWorkspaceRoot:sandboxWorkspaceRoot(c,args[args.indexOf('--session')+1])}}});
 worker.c.gatewayConfig=path.join(dir,'openclaw.json');worker.c.policyHash='a'.repeat(64);worker.c.imageID='sha256:'+'b'.repeat(64);worker.c.browserImageID='sha256:'+'c'.repeat(64);
 const profile=computeProfile({token:'a'.repeat(64),port:18896,model:'openai/gpt-6-astra',workspace:dir,imageID:worker.c.imageID,browserImageID:worker.c.browserImageID,jobRoot,inputRoot,workstation:true});
 for(const agent of Object.values(profile.agents.entries))if(agent.tools)agent.tools.allow=agent.tools.allow?.filter(t=>!['browser','web_fetch','web_search'].includes(t));
 fs.writeFileSync(worker.c.gatewayConfig,JSON.stringify(profile));
 worker.chat=async()=>JSON.stringify({status:'complete',content:'files-ready'});
 try{await assert.rejects(worker.execute('generate',{specification:normalizeWork(makePlan().specification,DECLARATION),attempt:1},{id:crypto.randomUUID()}));assert.equal(worker.state.calls.length,1);assert.equal(worker.state.requests[0].status,'failed-or-uncertain');}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('model success and correct bytes alone cannot pass tool/container proof',()=>{
 const {plan,capture}=captureFixture();capture.sessions={};const r=verifyCommissioningCapture(plan,capture);
 assert.equal(r.gates.find(g=>g.id==='artifact-reconciliation').status,'PASS');assert.equal(r.gates.find(g=>g.id==='exec-creator').status,'BLOCKED');assert.equal(r.productionQualified,false);
});
test('exec proof binds actual successful events, session, container, image, isolated mount and copied files',()=>{
 const {capture,files}=captureFixture(),original=capture.sessions.creator,request=capture.requests.creator;
 assert.ok(verifyExecCapture(original,request,files));
 for(const mutate of [x=>x.events=[],x=>x.events.reverse(),x=>x.events[2].Actor.Attributes.exitCode='1',x=>x.events[2].Actor.ID='f'.repeat(64),x=>x.sessionKey+='old',x=>x.inspect.Image='sha256:'+'f'.repeat(64),x=>x.inspect.HostConfig.NetworkMode='host',x=>x.inspect.Mounts[0].sourceSHA256='f'.repeat(64),x=>x.artifacts[0].sha256='f'.repeat(64),x=>x.afterContainerIDs.push(x.inspect.Id),x=>x.unrelatedBefore.push('e'.repeat(64))]){const altered=structuredClone(original);mutate(altered);assert.throws(()=>verifyExecCapture(altered,request,files));}
 const rounded=structuredClone(original);rounded.startedAt+=700;assert.ok(verifyExecCapture(rounded,request,files));
 for(const event of rounded.events)event.timeMS=event.time*1000+500;assert.throws(()=>verifyExecCapture(rounded,request,files),/ACTUAL_EXEC/);
});
test('captured mocked positives retain hardware, independent review, browser, desktop and payment gaps',()=>{
 const {plan,capture}=captureFixture(),r=verifyCommissioningCapture(plan,capture);assert.equal(r.dependencyMode,'mocked');assert.equal(r.status,'BLOCKED');assert.equal(r.productionQualified,false);
 for(const name of ['normal-pipeline','artifact-reconciliation','exec-creator','exec-reviewer','exec-negativeReviewer','positive-review','negative-review'])assert.equal(r.gates.find(g=>g.id===name).status,'PASS');
 for(const name of ['physical-mac','browser','desktop','independent-third-party','paid-settlement'])assert.equal(r.gates.find(g=>g.id===name).status,'NOT_TESTED');
 assert.equal(r.gates.find(g=>g.id==='model-tool-creator').code,'GATEWAY_TOOL_TRACE_REQUIRED');
});
test('HTTP success, repeated request IDs, absent charging and false reviewer approval fail qualification',()=>{
 for(const mutate of [x=>x.review.checks[0].status='uncertain',x=>x.negativeReview.checks[0].status='pass',x=>x.computeJournal.calls=[],x=>x.policyAfter='f'.repeat(64),x=>x.requests.reviewer.id=x.requests.creator.id]){const {plan,capture}=captureFixture();mutate(capture);assert.equal(verifyCommissioningCapture(plan,capture).status,'FAIL');}
});
test('browser observation cannot imply desktop GUI proof and prompts may not disclose the fixture answer',()=>{
 const plan=makePlan(),challenge=plan.privateOracle.browserChallenge,fixtureBytes='<p>'+challenge+'</p>';
 const e={source:'controlled-fixture-observer/v1',runID:plan.runID,capability:'browser',requestID:crypto.randomUUID(),fixtureURL:'https://controlled-fixture.invalid/',fixtureBytes,fixtureSHA256:sha256(fixtureBytes),prompt:'Read the controlled fixture then submit its code.',observedValue:challenge,domBytes:fixtureBytes,domSHA256:sha256(fixtureBytes)};
 e.effect={action:'submit',value:challenge,requestID:e.requestID};e.toolEvents=['navigate','click'].map(action=>({source:'observer',requestID:e.requestID,tool:'browser',action,target:e.fixtureURL}));
 assert.ok(verifyInteractiveCapture('browser',plan,e));assert.throws(()=>verifyInteractiveCapture('desktop',plan,e),/SOURCE/);e.prompt+=' '+challenge;assert.throws(()=>verifyInteractiveCapture('browser',plan,e),/UNPREDICTABLE/);
});
test('observer projects Engine records without command text, environment, or account data',()=>{
 const e=sanitizeEngineEvent({Type:'container',Action:'exec_create: echo SECRET_VALUE',time:123,Actor:{ID:'a'.repeat(64),Attributes:{execID:'b'.repeat(64),name:'private-account',token:'SECRET_VALUE'}}});
 assert.equal(e.Action,'exec_create');assert.ok(!JSON.stringify(e).includes('SECRET_VALUE'));assert.ok(!JSON.stringify(e).includes('private-account'));
 assert.equal(sanitizeEngineEvent({Type:'network',Actor:{ID:'a'.repeat(64)}}),null);
 assert.equal(sanitizeEngineEvent({Type:'container',Action:'exec_start',time:123,timeNano:'123555000000',Actor:{ID:'a'.repeat(64)}}).timeMS,123555);
 const match={Id:'a'.repeat(64),Image:'sha256:'+'b'.repeat(64),Mounts:[{Source:'/owned',Destination:'/workspace',RW:true}]};
 assert.equal(selectSessionContainer([match],'/owned',match.Image),match);assert.throws(()=>selectSessionContainer([match,match],'/owned',match.Image),/CONTAINER_REQUIRED/);assert.throws(()=>selectSessionContainer([match],'/unrelated',match.Image),/CONTAINER_REQUIRED/);
});
test('observer detects artifact changes after cleanup and never executes untrusted model commands',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-observer-')),root=path.join(dir,'session'),requestID=crypto.randomUUID(),container='a'.repeat(64),image='sha256:'+'b'.repeat(64);let removed=false;const commands=[];
 const inspection={Id:container,Image:image,HostConfig:{NetworkMode:'none',Privileged:false,ReadonlyRootfs:true},Mounts:[{Source:root,Destination:'/workspace',RW:true}]};
 const o=new DockerExecutionObserver({profileDir:dir,imageID:image},{requestID,agent:'agi-creator',sessionKey:`agent:agi-creator:agi-work-${requestID}`},{command:async args=>{commands.push(args);if(args[0]==='ps')return removed?'':container+'\n';if(args[0]==='inspect')return JSON.stringify([inspection]);if(args[0]==='cp'){fs.writeFileSync(args[2],'actual bytes');return '';}throw Error('UNEXPECTED');}});
 o.record.beforeContainerIDs=[];
 try{await o.capture({root,agent:'agi-creator',key:o.record.sessionKey,explain:{agentId:'agi-creator',sandbox:{sessionIsSandboxed:true,scope:'session',backend:'docker',workspaceAccess:'none'}}},[{name:'result.txt',maxBytes:100}]);removed=true;const record=await o.finish(new Map([['result.txt',Buffer.from('changed bytes')]]));assert.equal(record.status,'BLOCKED');assert.match(record.code,/ARTIFACT_CHANGED/);assert.ok(commands.every(args=>['ps','inspect','cp'].includes(args[0])));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('CLI preparation is network-free, status is NOT TESTED/BLOCKED, and run needs explicit authorization',()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'agi-commissioning-cli-')),kit=path.join(parent,'kit'),script=new URL('../scripts/commissioning.mjs',import.meta.url).pathname;
 const invoke=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
 try{const made=invoke('prepare',kit);assert.equal(made.status,0,made.stderr);assert.equal(JSON.parse(made.stdout).providerCalls,0);const status=invoke('status',kit);assert.equal(status.status,2);assert.equal(JSON.parse(status.stdout).productionQualified,false);assert.equal(invoke('run',kit).status,1);assert.equal(fs.existsSync(path.join(kit,'run-state.json')),false);}finally{fs.rmSync(parent,{recursive:true,force:true});}
});
test('collector streams real-shaped Engine events and inspects/copies only the attributed session',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-observer-stream-')),root=path.join(dir,'workspace'),request={id:crypto.randomUUID(),agent:'agi-creator'},container='a'.repeat(64),execID='b'.repeat(64),image='sha256:'+'c'.repeat(64),time=Math.floor(Date.now()/1000)*1000,bytes=Buffer.from('independently copied bytes');let stage=0,child;
 const inspection={Id:container,Image:image,Config:{Env:['SECRET=DO_NOT_EXPORT']},HostConfig:{NetworkMode:'none',Privileged:false,ReadonlyRootfs:true},Mounts:[{Source:root,Destination:'/workspace',RW:true}]};
 const observer=new DockerExecutionObserver({profileDir:dir,imageID:image,docker:'/mock/docker'},{requestID:request.id,agent:request.agent,sessionKey:`agent:${request.agent}:agi-work-${request.id}`},{now:()=>time,environment:()=>({PATH:'/mock'}),spawnImpl:()=>{child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.kill=()=>{child.exitCode=0;child.emit('close',0);};return child;},command:async args=>{if(args[0]==='ps')return stage++===1?container+'\n':'';if(args[0]==='inspect')return JSON.stringify([inspection]);if(args[0]==='cp'){assert.ok(args[1].startsWith(container+':/workspace/deliverables/'));fs.writeFileSync(args[2],bytes);return '';}throw Error('UNEXPECTED');}});
 try{
  await observer.start();
  for(const action of ['exec_create: python SECRET_SOURCE','exec_start: python SECRET_SOURCE','exec_die'])child.stdout.write(JSON.stringify({Type:'container',Action:action,time:time/1000,Actor:{ID:container,Attributes:{execID,...(action==='exec_die'?{exitCode:'0'}:{})}}})+'\n');
  await observer.capture({root,agent:request.agent,key:observer.record.sessionKey,explain:{agentId:request.agent,sandbox:{sessionIsSandboxed:true,scope:'session',backend:'docker',workspaceAccess:'none'}}},[{name:'proof.txt',maxBytes:100}]);
  const result=await observer.finish(new Map([['proof.txt',bytes]]));assert.equal(result.status,'CAPTURED');
  assert.ok(verifyExecCapture(result,request,[{name:'proof.txt',bytes:bytes.length,sha256:sha256(bytes)}]));
  const stored=fs.readFileSync(path.join(dir,'commissioning-observations',request.id+'.json'),'utf8');assert.ok(!stored.includes('SECRET'));assert.ok(!stored.includes(root));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('failed sandbox cleanup still stops the observer and preserves quarantine',async t=>{
 const plan=makePlan(),delivery=buildBundle(plan.specification,expectedFixtureFiles(plan));
 for(const agent of ['agi-creator','agi-reviewer']){
  const id=crypto.randomUUID(),calls=[],profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-cleanup-observer-'));let finishes=0,stops=0;
  t.after(()=>fs.rmSync(profileDir,{recursive:true,force:true}));
  const worker={c:{profileDir},executionObserverFactory:async()=>({capture:async()=>{},finish:async()=>{finishes++;return {status:'CAPTURED',persistence:'PASS'};}}),cleanupAgent:async(role,key)=>{calls.push({role,key});throw Error('cleanup failed');},stopForCleanup:()=>{stops++;}};
  const action=agent==='agi-creator'?produceFiles(worker,{acceptance:plan.specification},1,id):reviewFiles(worker,plan.specification,delivery,id);
  await assert.rejects(action,/COMPUTE_SANDBOX_CLEANUP_FAILED/);assert.equal(finishes,1);assert.equal(stops,1);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.role===agent&&c.key===`agent:${agent}:agi-work-${id}`));
 }
});
