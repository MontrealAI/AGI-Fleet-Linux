#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {Companion,COMPANION_DEFAULT} from '../src/control/companion.mjs';
import {normalizeWork} from '../src/work.mjs';
import {DECLARATION} from '../src/review.mjs';
import {sha256,ensure} from '../src/util.mjs';
import {createCommissioningPlan,verifyPlan,verifyFixtureDelivery,corruptFixtureDelivery} from '../compute/commissioning-fixture.mjs';
import {verifyCommissioningCapture} from '../compute/commissioning-evidence.mjs';
import {runLocalControls} from '../compute/controlled-controls.mjs';
import {assertComputePolicy} from '../compute/policy.mjs';
import companionRelease from '../config/companion-releases.json' with {type:'json'};
const help=`Usage:
  node scripts/commissioning.mjs prepare NEW_KIT_DIRECTORY
  node scripts/commissioning.mjs status KIT_DIRECTORY
  node scripts/commissioning.mjs verify KIT_DIRECTORY [CAPTURE.json]
  node scripts/commissioning.mjs run KIT_DIRECTORY --connection PRIVATE_CONNECTION.json --allow-provider-calls
  node scripts/commissioning.mjs local-controls KIT_DIRECTORY --settings COMPUTE_SETTINGS.json --allow-local-runtime
prepare/status/verify never contact a provider, Docker or the network.
local-controls runs only in the compute account with reviewed settings. It creates
one bounded, network:none synthetic Docker container and removes that exact
container. This checks Chromium CDP and frame-bound desktop input; it does not
claim model-driven browser/desktop, vision, public-web, or normal Agent pipeline proof.
run is available in the Agent package only and explicitly spends up to three
configured-provider allowances through the normal
Agent Companion -> Compute API: create, review, bad-delivery review. No fallback,
automatic retry, wallet, publication, transaction or settlement. Use the separate
signer/operator account and a reviewed mode-600 connection file with exactly port,
token and policyHash. Never share that file. Compute budgets and account separation
remain enforced. Local role review is not independent third-party validation.
Missing authoritative execution capture remains BLOCKED; a successful model reply
never proves a tool was used. Exit 0=prepared; 1=failed; 2=blocked/not tested.`;
function read(file,max=16000000){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);ensure(s.isFile()&&s.nlink===1&&s.size>0&&s.size<=max,'COMMISSIONING_FILE');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}}
function write(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});}
const summary=report=>({schema:report.schema,runID:report.runID,status:report.status,gates:report.gates.map(({id,status,code})=>({id,status,code})),productionQualified:false});
async function run(kit,plan,connectionFile){
 ensure(companionRelease.role==='agent','COMMISSIONING_AGENT_CLIENT_REQUIRED');
 ensure(Date.now()<plan.expiresAt,'COMMISSIONING_PLAN_EXPIRED');
 const file=path.resolve(connectionFile),stat=fs.lstatSync(file);
 ensure(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid?.()&&(stat.mode&0o077)===0,'COMMISSIONING_PRIVATE_CONNECTION');
 const connection=JSON.parse(read(file,8192));
 ensure(Object.keys(connection).sort().join('|')==='policyHash|port|token'&&Number.isInteger(connection.port)&&connection.port>=1024&&connection.port<=65535&&/^[a-f0-9]{64}$/.test(connection.token)&&/^[a-f0-9]{64}$/.test(connection.policyHash),'COMMISSIONING_CONNECTION');
 const statePath=path.join(kit,'run-state.json');write(statePath,{schema:'agi-commissioning-run/v1',runID:plan.runID,status:'started',startedAt:Date.now(),maximumRequests:3});
 const ledger=path.join(kit,'agent-allowance-journal');fs.mkdirSync(ledger,{mode:0o700});
 const capture={schema:'agi-commissioning-capture/v1',runID:plan.runID,releaseSHA256:plan.releaseSHA256,dependencyMode:'live-provider-requested-via-configured-gateway',startedAt:Date.now(),policyBefore:connection.policyHash,policyAfter:null,transport:{source:'agent-companion/v1',requests:[]},requests:{},sessions:{},computeJournal:null};
 let pendingName;
 const companion=new Companion(ledger,()=>connection.token,{fetchImpl:async(url,options)=>{
  const res=await fetch(url,options);
  if(new URL(url).pathname==='/health'){
   const health=await res.clone().json();capture.policyAfter=health.policyHash;
   capture.healthObservation={protocol:health.protocol,role:health.role,uid:health.uid,policyHash:health.policyHash,configuredCapabilities:health.capabilities,actualProviderRouting:'not-independently-verified'};
  }else{
   const id=options.headers['x-agi-request-id'],kind=options.headers['x-agi-kind'];
   ensure(capture.transport.requests.length<3,'COMMISSIONING_REQUEST_LIMIT');
   capture.transport.requests.push({id,kind,status:res.status});capture.requests[pendingName]={id,kind,agent:kind==='generate'?'agi-creator':'agi-reviewer'};
  }
  return res;
 }});
 companion.config={...COMPANION_DEFAULT,enabled:true,acknowledged:true,mode:'workstation',port:connection.port,agent:'agi-creator',maxCalls24h:3,timeoutMs:660000};
 companion.state.computePolicy=connection.policyHash;companion.save();companion.persist();
 const abort=new AbortController(),cancel=()=>{abort.abort();companion.cancel?.();};
 process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
 const request=async(name,kind,input)=>{
  ensure(!abort.signal.aborted,'COMMISSIONING_CANCELLED');pendingName=name;
  const wait=companion.state.nextAt-companion.now();if(wait>0){ensure(wait<=60000,'COMMISSIONING_COOLDOWN');await delay(wait,undefined,{signal:abort.signal});}
  const answer=await companion.request(kind,input,{cacheMs:0});ensure(!answer.cached,'COMMISSIONING_CACHE_FORBIDDEN');const {at,cached,...result}=answer;return result;
 };
 try{
  const produced=await request('creator','generate',{specification:normalizeWork(plan.specification,DECLARATION),attempt:1});
  ensure(produced.status==='complete','COMMISSIONING_PROVIDER_DECLINED');capture.delivery=produced.content;verifyFixtureDelivery(plan,capture.delivery);
  capture.review=await request('reviewer','computer-review',{specification:plan.specification,delivery:capture.delivery});
  capture.negativeDelivery=corruptFixtureDelivery(plan,capture.delivery);
  capture.negativeReview=await request('negativeReviewer','computer-review',{specification:plan.specification,delivery:capture.negativeDelivery});
 }catch(error){capture.failure=/^[A-Z0-9_]+$/.test(error.code??error.message)?error.code??error.message:'COMMISSIONING_REQUEST_FAILED';}
 finally{
  process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
  const journal={schema:1,requests:[],calls:[]};
  for(const [name,request]of Object.entries(capture.requests))try{
   const r=await fetch(`http://127.0.0.1:${connection.port}/commissioning/requests/${request.id}`,{headers:{Authorization:'Bearer '+connection.token},redirect:'error',signal:AbortSignal.timeout(5000)});
   ensure(r.ok,'COMMISSIONING_OBSERVER_EXPORT_UNAVAILABLE');let size=0,parts=[];for await(const b of r.body){size+=b.length;ensure(size<=2097152,'COMMISSIONING_OBSERVER_EXPORT_LIMIT');parts.push(b);}
   const evidence=JSON.parse(Buffer.concat(parts));ensure(evidence.observation?.requestID===request.id&&evidence.journal?.requests?.length===1&&evidence.journal.requests[0].id===request.id,'COMMISSIONING_OBSERVER_EXPORT_SCOPE');
   capture.sessions[name]=evidence.observation;journal.requests.push(evidence.journal.requests[0]);journal.calls.push(...evidence.journal.calls);
  }catch{capture.sessions[name]={status:'BLOCKED',code:'COMMISSIONING_OBSERVER_EXPORT_UNAVAILABLE'};}
  if(journal.requests.length)capture.computeJournal=journal;
  capture.finishedAt=Date.now();write(path.join(kit,'capture.json'),capture);
  fs.writeFileSync(statePath,JSON.stringify({schema:'agi-commissioning-run/v1',runID:plan.runID,status:capture.failure?'failed-or-uncertain':'captured-unqualified',finishedAt:capture.finishedAt,requests:capture.transport.requests.length,failure:capture.failure??null})+'\n',{mode:0o600});
 }
 return verifyCommissioningCapture(plan,capture);
}
async function main(){
 const [action,dir,...args]=process.argv.slice(2);if(!action||action==='--help'){console.log(help);return;}
 ensure(dir,'COMMISSIONING_DIRECTORY');const kit=path.resolve(dir);
 if(action==='prepare'){
  ensure(!args.length&&!fs.existsSync(kit),'COMMISSIONING_NEW_DIRECTORY_REQUIRED');const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const releaseSHA256=sha256(read(path.join(root,'MANIFEST.sha256'))),plan=createCommissioningPlan({releaseSHA256});
  fs.mkdirSync(kit,{recursive:false,mode:0o700});write(path.join(kit,'plan.private.json'),plan);write(path.join(kit,'specification.json'),plan.specification);write(path.join(kit,'status.json'),verifyCommissioningCapture(plan));
  console.log(JSON.stringify({status:'PREPARED',runID:plan.runID,directory:kit,providerCalls:0,productionQualified:false}));return;
 }
 ensure(fs.lstatSync(kit).isDirectory()&&!fs.lstatSync(kit).isSymbolicLink(),'COMMISSIONING_DIRECTORY');const plan=verifyPlan(JSON.parse(read(path.join(kit,'plan.private.json'))));let report;
 if(action==='local-controls'){
  ensure(args.length===3&&args[0]==='--settings'&&args[2]==='--allow-local-runtime','COMMISSIONING_EXPLICIT_LOCAL_AUTHORIZATION_REQUIRED');
  const file=path.resolve(args[1]),stat=fs.lstatSync(file);ensure(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid?.()&&(stat.mode&0o077)===0,'COMMISSIONING_PRIVATE_SETTINGS');
  const settings=JSON.parse(read(file,1048576));assertComputePolicy(settings);write(path.join(kit,'local-controls-run.json'),{startedAt:Date.now(),providerCalls:0});
  const capture=await runLocalControls(settings,plan,kit);write(path.join(kit,'local-controls.json'),capture);console.log(JSON.stringify({status:capture.validation.status,code:capture.validation.code,scope:capture.validation.scope,providerCalls:0,modelDriven:false,productionQualified:false},null,2));if(capture.validation.status!=='PASS')process.exitCode=2;return;
 }
 if(action==='run'){ensure(args.length===3&&args[0]==='--connection'&&args[2]==='--allow-provider-calls','COMMISSIONING_EXPLICIT_PROVIDER_AUTHORIZATION_REQUIRED');report=await run(kit,plan,args[1]);}
 else if(action==='status'||action==='verify'){ensure(args.length<=(action==='verify'?1:0),'COMMISSIONING_ARGUMENTS');const captureFile=args[0]?path.resolve(args[0]):path.join(kit,'capture.json'),controls=path.join(kit,'local-controls.json');report=verifyCommissioningCapture(plan,fs.existsSync(captureFile)?JSON.parse(read(captureFile)):null,{localControls:fs.existsSync(controls)?JSON.parse(read(controls)):null});}
 else throw Error('COMMISSIONING_COMMAND');
 console.log(JSON.stringify(summary(report),null,2));if(report.status!=='PASS')process.exitCode=report.status==='FAIL'?1:2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e.code??e.message)?e.code??e.message:'COMMISSIONING_COMMAND_FAILED');process.exitCode=1;});
