import {sandboxWorkspaceRoot} from '../../compute/sandbox-scope.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {ComputeWorker,createComputeServer} from '../../compute/server.mjs';
import {computeProfile} from '../../compute/profile.mjs';
import {runtimeManifest} from '../../compute/runtime.mjs';
import {makePublicBrowserPolicy,installPublicBrowserPlugin,applyPublicBrowserProfile} from '../../compute/public-browser-config.mjs';
import {createPublicWebCommissioningFixture,createPublicWebCommissioningInput,verifyPublicWebCommissioningDelivery} from '../../compute/public-web-commissioning.mjs';
import {createExecutionAdmission} from '../../src/public-web-admission.mjs';
import {approvePublicWebGrant} from '../../compute/public-web-policy.mjs';
import {planPublicWebIsolation} from '../../compute/public-web-isolation.mjs';
import {canonical,sha256} from '../../src/util.mjs';
export function harness({role='agent',dependencies={}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-web-orchestration-')),keys=crypto.generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({format:'pem',type:'spki'}),state={prepared:0,activated:0,cleaned:0,sessionsClosed:0,commands:[]};let clock=Date.now(),workspace;
 const c={role,workstation:true,profileDir:dir,workspace:dir,docker:'/fixture/docker',jobRoot:path.join(dir,'jobs'),inputRoot:path.join(dir,'input'),gatewayConfig:path.join(dir,'gateway.json'),gatewayPort:18999,token:'a'.repeat(64),gatewayToken:'b'.repeat(64),policyHash:'c'.repeat(64),imageID:'sha256:'+'d'.repeat(64),browserImageID:'sha256:'+'e'.repeat(64),maxRuns24h:8,maxImages24h:1};
 fs.mkdirSync(c.jobRoot);fs.mkdirSync(c.inputRoot);
 c.publicWebPolicy=makePublicBrowserPolicy({profileDir:dir,operatorPublicKey:publicKey,proposal:{schema:'agi-public-browser-policy-proposal/v1',mode:'commissioning',browserImageID:'sha256:'+'1'.repeat(64),proxyImageID:'sha256:'+'2'.repeat(64)}});
 installPublicBrowserPlugin(c.publicWebPolicy.pluginDirectory);
 fs.writeFileSync(c.gatewayConfig,JSON.stringify(applyPublicBrowserProfile(computeProfile({token:c.gatewayToken,port:c.gatewayPort,model:'openai/gpt-6-astra',workspace:dir,imageID:c.imageID,browserImageID:c.browserImageID,jobRoot:c.jobRoot,inputRoot:c.inputRoot,workstation:true,role}),c.publicWebPolicy,{grantTool:true})));
 const resource=spec=>{const plan=planPublicWebIsolation({...spec,uid:1000,gid:1000});fs.mkdirSync(plan.spec.sessionDirectory,{recursive:true,mode:0o700});return {plan,browserContainerID:'3'.repeat(64),resources:[],docker:c.docker,status:'PREPARED_NOT_STARTED'};};
 const defaults={prepare:async spec=>{state.prepared++;return resource(spec);},activate:async prepared=>{state.activated++;return {...prepared,status:'STARTED_UNQUALIFIED',close:async()=>{state.cleaned++;return {status:'PASS'};}};},cleanup:async()=>{state.cleaned++;return {status:'PASS'};},createSession:async()=>({execute:async command=>{state.commands.push(command);return {title:'Example Domain'};},close:async()=>{state.sessionsClosed++;}})};
 const worker=new ComputeWorker(c,{verifyPolicy:false,cleanupInventory:async()=>({status:"CAPTURED",containerIDs:[]}),now:()=>clock,publicWebDependencies:{...defaults,...dependencies},fetchImpl:async()=>Response.json({data:role==='agent'?[{id:'openclaw/agi-creator'},{id:'openclaw/agi-checker'},{id:'openclaw/agi-reviewer'}]:[{id:'openclaw/agi-checker'},{id:'openclaw/agi-reviewer'}]}),cli:async(c,args)=>{if(args[1]==='recreate')return {ok:true,exitStatus:0,signal:null,elapsedMs:1,timeoutMs:30000,timedOut:false,started:true,processTerminationConfirmed:true};const agent=args[args.indexOf('--agent')+1],key=args[args.indexOf('--session')+1];workspace=sandboxWorkspaceRoot(c,key);return {agentId:agent,sandbox:{scope:'session',workspaceAccess:'none',sessionIsSandboxed:true,backend:'docker',effectiveHostWorkspaceRoot:workspace}};}});
 const reviewer=runtimeManifest(c,'reviewer',{commissioning:true}),agent=role==='node'?reviewer:runtimeManifest(c,'agent',{commissioning:true});
 const plan=createPublicWebCommissioningFixture({challenge:'4'.repeat(64),issuedAt:clock,agentRuntimeSha256:sha256(canonical(agent)),reviewerRuntimeSha256:sha256(canonical(reviewer))});
 function request(runRole=role==='node'?'reviewer':'agent') {const {kind,input}=createPublicWebCommissioningInput(plan,runRole);return {id:crypto.randomUUID(),kind,input,executionAdmission:createExecutionAdmission({specification:plan.specification,sourceSpecSha256:sha256(canonical(plan.specification)),chainId:31337,manager:plan.specification.settlement.manager,jobID:'1',role:runRole}),purpose:'commissioning',commissioningFixture:plan.fixture};}
 const approve=prepared=>approvePublicWebGrant(prepared.approvalPayload,keys.privateKey.export({format:'pem',type:'pkcs8'}),{now:clock});
 worker.chat=async(agent,prompt,data,signal,image,key)=>{
  assert.ok(!canonical(data).includes('agi-public-web-approval'));assert.ok(!canonical(data).includes('browserContainerID'));
  await assert.rejects(worker.publicWeb.execute({agentId:agent,sessionKey:key+'-other',command:{action:'snapshot'}}),/SESSION_REQUIRED/);
  await worker.publicWeb.execute({agentId:agent,sessionKey:key,command:{action:'navigate',url:'https://example.com/'},signal});
  if(agent==='agi-creator'){const value={schema:'agi-public-web-observation/v1',url:'https://example.com/',title:'Example Domain',heading:'Example Domain',challenge:plan.fixture.challenge};fs.writeFileSync(path.join(workspace,'deliverables/observation.json'),canonical(value));return JSON.stringify({status:'complete',content:'files-ready'});}
  return JSON.stringify({safeToReview:true,checks:[{id:'actual-observation',status:'pass',method:'Fixture browser observed page',observed:'Fixture page fields match file',files:['observation.json']}]});
 };
 return {c,dir,worker,state,plan,request,approve,resource,keys,setClock:value=>clock=value,clock:()=>clock,close:async()=>{await worker.close().catch(()=>{});fs.rmSync(dir,{recursive:true,force:true});}};
}
