import {readSetupArguments} from '../compute/setup-ledger.mjs';
import {validateManagedGatewayAuthority} from '../compute/setup-managed-service.mjs';
import {syntheticAuthority,writeSyntheticService} from './managed-service-fixture.mjs';
import {cleanInitializationFixture} from './clean-initialization-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {runtimeDatabase,stageRuntimeFixture} from './runtime-sqlite-fixture.mjs';
import {statePreparationFixture} from './state-preparation-fixture.mjs';
import {setupCapable} from '../compute/setup.mjs';
import {inspectExecutable} from '../compute/runtime-env.mjs';
import {policyHash} from '../compute/policy.mjs';
function fixture(t,role='agent'){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-setup-entry-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));const profile=role==='node'?'agi-node-compute':'agi-compute',profileDir=path.join(home,'.openclaw-'+profile),port=role==='node'?18898:18894,gatewayPort=role==='node'?18900:18896,active=new Set(),events=[],images=new Map(),imageRecords=new Map();let imageAttempt=0,imagePlan=({tag})=> 'sha256:'+(tag.includes('browser')?'d':'a').repeat(64),imageReject=()=>false;let stopTime=0,loginCount=0,failStart=false,modelDelay=0,healthDelay=0,modelCalls=0,healthCalls=0,failHealth=false,failFirstRollbackStop=false,rollbackPrintFailed=false,rollbackArmed=false,failAllRollbackStops=false;
 const runtime={home,node:path.join(home,'bin/node'),openclaw:path.join(home,'bin/openclaw'),docker:path.join(home,'bin/docker'),versions:{node:'24.21.0',openclaw:'2026.9.5'}};
 fs.mkdirSync(path.join(home,'bin'),{mode:0o700});for(const kind of ['node','openclaw','docker'])fs.writeFileSync(runtime[kind],'\x23!/bin/sh\nexit 0\n',{mode:0o700});runtime.executableIdentity={schema:1,...Object.fromEntries(['node','openclaw','docker'].map(kind=>[kind,inspectExecutable(runtime[kind],kind,{home})]))};
 const dependencies={deriveManagedGatewayAuthority:syntheticAuthority,prepareManagedGatewayService:c=>{writeSyntheticService(c);return validateManagedGatewayAuthority(c);},prepareCandidateState:({candidate,profileDir:live})=>{assert.notEqual(candidate,live);assert.equal(live,profileDir);assert.ok(fs.existsSync(path.join(candidate,'compute-settings.json')));events.push({command:'prepare candidate state',candidate:true});return statePreparationFixture();},finishCandidateStatePreparation:()=>events.push({command:'candidate state preparation saved',candidate:true}),stageCandidateAuthOrder:stageRuntimeFixture,home,platform:'darwin',uid:504,fileUID:process.getuid(),runtimePlatform:process.platform,serviceStop:{timeoutMs:100,pollIntervalMs:1,requestTimeoutMs:50,now:()=>stopTime,sleep:async ms=>{stopTime+=ms;}},discoverRuntime:()=>runtime,runtimeEnvironment:()=>({HOME:home,PATH:'/usr/bin:/bin'}),gatewayWrapperPlan:c=>({path:path.join(c.profileDir,'agi-runtime/gateway-wrapper'),content:'\x23!/bin/sh\nexit 0\n',installEnvironment:{OPENCLAW_WRAPPER:path.join(c.profileDir,'agi-runtime/gateway-wrapper')},heapMiB:4096}),collectPreflight:()=>({facts:{platform:'darwin',account:'standard',totalMemoryBytes:8*1024**3,openclawVersion:'2026.9.5',availableDiskBytes:3*1024**3},gates:[{id:'runtime',state:'passed'}]}),desktopCheck:()=>({passed:true,detail:{passed:true,schema:'agi-workstation-check/v3'},oomKilled:false}),readiness:{pollIntervalMs:1,gatewayTimeoutMs:5000,computePortTimeoutMs:5000,healthTimeoutMs:5000},listen:async p=>active.has(p),fetch:async(url,options)=>{const c=JSON.parse(fs.readFileSync(path.join(profileDir,'compute-settings.json')));assert.ok(fs.existsSync(path.join(profileDir,'COMPUTE_STOP')));if(url.endsWith('/v1/models')){events.push({command:'gateway models',candidate:false});assert.equal(options.headers.Authorization,'Bearer '+c.gatewayToken);return new Response(JSON.stringify({data:++modelCalls<=modelDelay?[]:[...(role==='agent'?['agi-creator']:[]),'agi-checker','agi-reviewer'].map(id=>({id:'openclaw/'+id}))}));}events.push({command:'compute health',candidate:false});assert.equal(options.headers.Authorization,'Bearer '+c.token);healthCalls++;if(failHealth)rollbackArmed=true;return new Response(JSON.stringify({role,policyHash:policyHash(c),stopped:true,gatewayReady:healthCalls>healthDelay,policyCurrent:!failHealth}));},spawnSync:(exe,args,options)=>{
  if(exe==='/bin/launchctl'){if(args[0]==='bootout'){active.clear();return {status:0};}if(args[0]==='print'&&rollbackArmed&&(failAllRollbackStops||failFirstRollbackStop&&!rollbackPrintFailed)){rollbackPrintFailed=true;return failAllRollbackStops?{status:0,stdout:'service still loaded'}:{status:1,stderr:'Permission denied fixture'};}if(args[0]==='print')return {status:113,stderr:'Bad request.\nCould not find service "'+args[1].split('/').at(-1)+'" in domain for user gui: 504\n'};events.push({command:'compute bootstrap',candidate:false});active.add(port);return {status:0};}
  if(exe===runtime.docker){if(args[0]==='info')return{status:0,stdout:'29.8.0'};if(args[0]==='build'){const tag=args[args.indexOf('-t')+1],label=args[args.indexOf('--label')+1].split('=')[1];images.set(tag,label);const id=imagePlan({tag,attempt:imageAttempt});imageRecords.set(tag,{id,label});imageRecords.set(id,{id,label});return {status:0};}if(args[0]==='image'){const tag=args.at(-1),v=imageRecords.get(tag);events.push({command:'image inspect',tag,attempt:imageAttempt,imageID:v?.id});return {status:v?0:1,stdout:JSON.stringify(v?[{Id:v.id,Config:{Labels:{'ai.montreal.agi.recipe':imageReject({tag,attempt:imageAttempt})?'invalid-recipe':v.label}}}]:[])};}throw Error('UNEXPECTED_DOCKER');}
  assert.equal(exe,runtime.openclaw);const a=args.slice(2),state=options.env.OPENCLAW_STATE_DIR,config=options.env.OPENCLAW_CONFIG_PATH;events.push({command:a.join(' '),candidate:state!==profileDir,timeout:options.timeout});
  if(a[0]==='config'){JSON.parse(fs.readFileSync(config));return {status:0};}
  if(a[0]==='models'){const agent=a[a.indexOf('--agent')+1],authFile=path.join(state,'agents',agent,'agent/auth-profiles.json');if(a[1]==='status')return{status:fs.existsSync(authFile)?0:1};if(a.includes('login')){loginCount++;assert.notEqual(state,profileDir);fs.mkdirSync(path.dirname(authFile),{recursive:true,mode:0o700});fs.writeFileSync(authFile,'{"private":"OAUTH-CANARY"}',{mode:0o600});const c=JSON.parse(fs.readFileSync(config));c.auth.profiles['openai:agi-compute-pro'].displayName='PRIVATE ACCOUNT';fs.writeFileSync(config,JSON.stringify(c));return{status:0};}if(a.includes('order'))return {status:0};}
  if(a[0]==='infer')return{status:0,stdout:'{}'};
  if(a[0]==='gateway'){if(a[1]==='install')writeSyntheticService(JSON.parse(fs.readFileSync(path.join(state,'compute-settings.json'))));if(a[1]==='start'){if(failStart)return{status:1,stderr:'Gateway failed fixture'};active.add(gatewayPort);}return{status:0,stdout:'Gateway '+a[1]+' fixture completed',stderr:'Gateway diagnostic fixture'};}
  throw Error('UNEXPECTED_COMMAND');
 }};
 const kit={schema:`agi-${role}-openclaw-setup/v1`,openclawVersion:'2026.9.5',token:'b'.repeat(64),port,agent:role==='node'?'agi-checker':'agi-creator',model:'openai/gpt-6-astra',mode:'workstation',signerUID:503};
 const rl={question:async prompt=>prompt.includes('Type APPROVE')?'APPROVE '+/APPROVE ([a-f0-9]{12})/.exec(prompt)[1]:prompt.includes('SEPARATE')?'SEPARATE':'STOP AND REVIEW'};
 return {home,profileDir,events,dependencies,kit,rl,set imageAttempt(v){imageAttempt=v;imageRecords.clear();},set imagePlan(v){imagePlan=v;imageRecords.clear();},set imageReject(v){imageReject=v;},get loginCount(){return loginCount;},set failStart(v){failStart=v;},set modelDelay(v){modelDelay=v;modelCalls=0;},set healthDelay(v){healthDelay=v;healthCalls=0;},set failHealth(v){failHealth=v;},set failFirstRollbackStop(v){failFirstRollbackStop=v;},set failAllRollbackStops(v){failAllRollbackStops=v;},get active(){return active;},run:()=>setupCapable(kit,rl,{repair:true,dependencies})};
}
for(const role of ['agent','node'])test('complete '+role+' setup entry stages OAuth in isolation and seals the final configuration without live providers',async t=>{
 const f=fixture(t,role),result=await f.run(),c=JSON.parse(fs.readFileSync(path.join(f.profileDir,'compute-settings.json')));assert.equal(result.supportReport.passed,true);assert.deepEqual(result.supportReport.statePreparation,statePreparationFixture());const preparation=f.events.findIndex(e=>e.command==='prepare candidate state'),firstOAuth=f.events.findIndex(e=>e.command.startsWith('models'));assert.ok(preparation>=0&&firstOAuth>preparation);assert.equal(result.supportReport.stages.services,'passed');assert.equal(c.policyHash,policyHash(c));assert.equal(c.policySealVersion,2);assert.equal(c.capabilityPolicy,'offline-public/v1');assert.equal(c.gatewayWrapper,path.join(f.profileDir,'agi-runtime/gateway-wrapper'));assert.equal(fs.existsSync(path.join(f.profileDir,'SETUP_PENDING')),false);assert.equal(fs.existsSync(path.join(f.profileDir,'COMPUTE_STOP')),false);assert.ok(f.events.filter(e=>e.command.startsWith('models')).every(e=>e.candidate));assert.equal(f.loginCount,role==='agent'?3:2);assert.ok(f.events.find(e=>e.command==='gateway install --port '+c.gatewayPort));
});
test('repeat install preserves manually repaired authentication and budgets; failed service upgrade restores complete profile',async t=>{
 const f=fixture(t);await f.run();let c=JSON.parse(fs.readFileSync(path.join(f.profileDir,'compute-settings.json')));c.maxRuns24h=7;c.maxImages24h=2;c.policyHash=policyHash(c);fs.writeFileSync(path.join(f.profileDir,'compute-settings.json'),JSON.stringify(c));fs.writeFileSync(path.join(f.profileDir,'compute-journal.json'),'{"calls":[123],"requests":["accepted"]}');const logins=f.loginCount;await f.run();c=JSON.parse(fs.readFileSync(path.join(f.profileDir,'compute-settings.json')));assert.equal(c.maxRuns24h,7);assert.equal(c.maxImages24h,2);assert.equal(f.loginCount,logins);const beforeConfig=fs.readFileSync(path.join(f.profileDir,'openclaw.json'),'utf8'),beforeJournal=fs.readFileSync(path.join(f.profileDir,'compute-journal.json'),'utf8');f.failStart=true;await assert.rejects(f.run(),/SERVICE_START_FAILED/);assert.equal(fs.readFileSync(path.join(f.profileDir,'openclaw.json'),'utf8'),beforeConfig);assert.equal(fs.readFileSync(path.join(f.profileDir,'compute-journal.json'),'utf8'),beforeJournal);assert.equal(f.loginCount,logins);
});

test('existing-profile repair reaches the exact review checkpoint with three reused identities and no live configuration write',async t=>{
 const f=fixture(t);await f.run();const logins=f.loginCount,start=f.events.length,config=fs.readFileSync(path.join(f.profileDir,'openclaw.json')),settings=fs.readFileSync(path.join(f.profileDir,'compute-settings.json'));
 let checkpoint=false;f.rl.question=async prompt=>{
  if(!prompt.includes('Type APPROVE'))return 'SEPARATE';
  checkpoint=true;const report=JSON.parse(fs.readFileSync(path.join(f.home,'.agi-genesis-setup-agent/security-review.json')));
  assert.match(report.candidateIdentity,/^[a-f0-9]{64}$/);assert.ok(prompt.includes(report.digest.slice(0,12)));
  assert.deepEqual(report.statePreparation,statePreparationFixture());assert.deepEqual(report.authStaging.map(x=>x.agent),['agi-checker','agi-creator','agi-reviewer']);assert.ok(report.authStaging.every(x=>x.verified));
  assert.deepEqual(fs.readFileSync(path.join(f.profileDir,'openclaw.json')),config);assert.deepEqual(fs.readFileSync(path.join(f.profileDir,'compute-settings.json')),settings);
  assert.ok(f.events.slice(start).every(x=>!x.command.startsWith('gateway install')&&!x.command.includes('auth order set')&&!x.command.includes('auth login')));
  return 'REVIEW LATER';
 };
 await assert.rejects(f.run(),/SETUP_SECURITY_REVIEW_REQUIRED/);assert.ok(checkpoint);assert.equal(f.loginCount,logins);
 const tx=JSON.parse(fs.readFileSync(path.join(f.home,'.agi-genesis-setup-agent/transaction/transaction.json')));assert.equal(tx.state,'prepared');assert.equal(tx.approval,null);
});
test('changing candidate configuration while the operator reviews it prevents publishing',async t=>{
 const f=fixture(t);await f.run();const config=fs.readFileSync(path.join(f.profileDir,'openclaw.json')),start=f.events.length;
 f.rl.question=async prompt=>{
  if(!prompt.includes('Type APPROVE'))return 'SEPARATE';
  const file=path.join(f.home,'.agi-genesis-setup-agent/transaction/candidate/openclaw.json'),changed=JSON.parse(fs.readFileSync(file));changed.gateway.port=18897;fs.writeFileSync(file,JSON.stringify(changed),{mode:0o600});
  return 'APPROVE '+/APPROVE ([a-f0-9]{12})/.exec(prompt)[1];
 };
 await assert.rejects(f.run(),/SETUP_REVIEW_STALE/);assert.deepEqual(fs.readFileSync(path.join(f.profileDir,'openclaw.json')),config);assert.ok(f.events.slice(start).every(x=>!x.command.startsWith('gateway install')));
});

for(const role of ['agent','node'])test('macOS '+role+' fixture sequences delayed Gateway models before bootstrap, retries authenticated health and retains STOP until final verification',async t=>{
 const f=fixture(t,role);f.modelDelay=2;f.healthDelay=2;const result=await f.run(),commands=f.events.map(x=>x.command),report=result.supportReport.serviceReadiness;
 const install=commands.findIndex(x=>x.startsWith('gateway install')),start=commands.indexOf('gateway start'),models=commands.indexOf('gateway models'),bootstrap=commands.indexOf('compute bootstrap'),health=commands.indexOf('compute health');
 assert.ok(install<start&&start<models&&models<bootstrap&&bootstrap<health);assert.equal(f.events[install].timeout,30000);assert.equal(f.events[start].timeout,90000);assert.equal(commands.filter(x=>x==='gateway models').length,3);assert.equal(commands.filter(x=>x==='compute health').length,3);assert.equal(report.gateway.state,'passed');assert.equal(report.health.state,'passed');assert.equal(report.health.lastFailure.predicates.gatewayReady,false);assert.equal(report.finalPolicy.state,'passed');assert.match(report.commands.gatewayStart.stdout,/Gateway start fixture completed/);assert.match(report.commands.gatewayStart.stderr,/diagnostic fixture/);assert.equal(fs.existsSync(path.join(f.profileDir,'COMPUTE_STOP')),false);
});

test('primary health failure survives initial rollback-stop failure; outer recovery restores profile/services and retains failed candidate',async t=>{
 const f=fixture(t);await f.run();const before=fs.readFileSync(path.join(f.profileDir,'openclaw.json'));const serviceFile=path.join(f.home,'Library/LaunchAgents/ai.montreal.agi-compute.plist'),service=fs.readFileSync(serviceFile);const logins=f.loginCount;f.failHealth=true;f.failFirstRollbackStop=true;
 let error;try{await f.run();assert.fail('expected failed readiness');}catch(e){error=e;}
 assert.equal(error.message,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(error.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(error.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(error.supportReport.failureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(error.supportReport.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(error.supportReport.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.deepEqual(error.supportReport.recovery,{profile:'RESTORED',serviceFiles:'RESTORED'});assert.equal(error.supportReport.transaction.state,'rolled-back');assert.equal(error.supportReport.serviceReadiness.health.lastFailure.predicates.policyCurrent,false);assert.equal(error.supportReport.serviceReadiness.health.lastFailure.predicates.policyHashMatches,true);assert.equal(error.supportReport.serviceReadiness.finalPolicy.state,'pending');assert.equal(f.active.size,0);assert.equal(f.loginCount,logins);assert.deepEqual(fs.readFileSync(path.join(f.profileDir,'openclaw.json')),before);assert.deepEqual(fs.readFileSync(serviceFile),service);
 const txDir=path.join(f.home,'.agi-genesis-setup-agent/transaction'),tx=JSON.parse(fs.readFileSync(path.join(txDir,'transaction.json')));assert.equal(tx.state,'rolled-back');assert.equal(tx.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(tx.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.ok(fs.existsSync(path.join(txDir,tx.failedCandidate)));assert.equal(error.supportReport.walletAccessed,false);
});

test('changing saved limits immediately after healthy response fails closed and retains prior settings as evidence',async t=>{
 const f=fixture(t);await f.run();const file=path.join(f.profileDir,'compute-settings.json'),before=fs.readFileSync(file),fetch=f.dependencies.fetch;
 f.dependencies.fetch=async(url,options)=>{const response=await fetch(url,options);if(url.endsWith('/health')){const saved=JSON.parse(fs.readFileSync(file));saved.maxRuns24h++;fs.writeFileSync(file,JSON.stringify(saved),{mode:0o600});}return response;};
 let error;try{await f.run();assert.fail('expected final policy refusal');}catch(e){error=e;}
 assert.equal(error.message,'COMPUTE_POLICY_CHANGED');assert.equal(error.supportReport.serviceReadiness.health.state,'passed');assert.equal(error.supportReport.serviceReadiness.finalPolicy.state,'failed');assert.equal(error.supportReport.transaction.state,'safe-stop-required');assert.equal(error.rollbackFailureCode,'SETUP_ROLLBACK_RUNTIME_CHANGED');assert.deepEqual(fs.readFileSync(path.join(f.home,'.agi-genesis-setup-agent/transaction/previous/compute-settings.json')),before);assert.notDeepEqual(fs.readFileSync(file),before);assert.equal(f.active.size,0);
});

for(const role of ['agent','node'])test('interrupted '+role+' recovery preserves original health and rollback failures before a new transaction exists',async t=>{
 const f=fixture(t,role);await f.run();f.failHealth=true;f.failAllRollbackStops=true;
 let first;try{await f.run();assert.fail('expected persistent shutdown refusal');}catch(e){first=e;}
 assert.equal(first.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(first.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(first.supportReport.transaction.state,'safe-stop-required');
 const support=path.join(f.home,'.agi-genesis-setup-'+role),txFile=path.join(support,'transaction/transaction.json'),tx=JSON.parse(fs.readFileSync(txFile)),config=fs.readFileSync(path.join(f.profileDir,'openclaw.json')),settings=fs.readFileSync(path.join(f.profileDir,'compute-settings.json')),logins=f.loginCount,start=f.events.length;
 let retry;try{await f.run();assert.fail('expected interrupted recovery refusal');}catch(e){retry=e;}
 assert.equal(retry.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(retry.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(retry.supportReport.failureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.deepEqual(retry.supportReport.transaction,{id:tx.id,state:'safe-stop-required'});assert.equal(retry.supportReport.recovery.profile,'SAFE_STOP_REQUIRED');assert.equal(retry.supportReport.recovery.serviceFiles,'RESTORE_REQUIRED');assert.equal(retry.supportReport.walletAccessed,false);assert.equal(retry.supportReport.stages.profile,'failed');
 const saved=JSON.parse(fs.readFileSync(path.join(support,'setup-diagnostics.json')));assert.equal(saved.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(saved.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.deepEqual(saved.transaction,{id:tx.id,state:'safe-stop-required'});assert.equal(saved.recovery.profile,'SAFE_STOP_REQUIRED');
 assert.equal(f.loginCount,logins);assert.ok(f.events.slice(start).every(event=>!event.command.startsWith('models')&&!event.command.startsWith('gateway')));assert.deepEqual(fs.readFileSync(path.join(f.profileDir,'openclaw.json')),config);assert.deepEqual(fs.readFileSync(path.join(f.profileDir,'compute-settings.json')),settings);assert.ok(fs.existsSync(path.join(f.profileDir,'COMPUTE_STOP')));assert.equal(JSON.parse(fs.readFileSync(txFile)).id,tx.id);assert.ok(fs.existsSync(path.join(support,'transaction/previous')));
});

for(const role of ['agent','node'])test('interrupted '+role+' service-file recovery preserves the original cause after profile restoration succeeds',async t=>{
 const f=fixture(t,role);await f.run();const before=fs.readFileSync(path.join(f.profileDir,'openclaw.json'));f.failHealth=true;f.failAllRollbackStops=true;
 await assert.rejects(f.run(),/COMPUTE_SERVICE_HEALTH_FAILED/);f.failAllRollbackStops=false;
 const support=path.join(f.home,'.agi-genesis-setup-'+role),txFile=path.join(support,'transaction/transaction.json'),tx=JSON.parse(fs.readFileSync(txFile)),logins=f.loginCount,spawn=f.dependencies.spawnSync;let prints=0;
 f.dependencies.spawnSync=(exe,args,options)=>{if(exe==='/bin/launchctl'&&args[0]==='print'&&++prints===3)return {status:1,stderr:'Permission denied fixture'};return spawn(exe,args,options);};
 let error;try{await f.run();assert.fail('expected service-file recovery refusal');}catch(e){error=e;}
 assert.equal(error.message,'SETUP_SERVICE_ROLLBACK_REQUIRED');assert.equal(error.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(error.rollbackFailureCode,'SETUP_SERVICE_ROLLBACK_REQUIRED');assert.deepEqual(error.supportReport.transaction,{id:tx.id,state:'rolled-back'});assert.deepEqual(error.supportReport.recovery,{profile:'RESTORED',serviceFiles:'RESTORE_REQUIRED'});assert.equal(error.supportReport.walletAccessed,false);assert.equal(f.loginCount,logins);assert.deepEqual(fs.readFileSync(path.join(f.profileDir,'openclaw.json')),before);
 const saved=JSON.parse(fs.readFileSync(path.join(support,'setup-diagnostics.json')));assert.equal(saved.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(saved.rollbackFailureCode,'SETUP_SERVICE_ROLLBACK_REQUIRED');assert.equal(saved.recovery.profile,'RESTORED');assert.equal(saved.recovery.serviceFiles,'RESTORE_REQUIRED');assert.equal(JSON.parse(fs.readFileSync(txFile)).primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(JSON.parse(fs.readFileSync(txFile)).id,tx.id);
});

for(const role of ['agent','node'])test('legacy '+role+' socket path moves only in the reviewed candidate and disabled setup creates no endpoint',async t=>{
 const f=fixture(t,role);await f.run();const settingsFile=path.join(f.profileDir,'compute-settings.json'),configFile=path.join(f.profileDir,'openclaw.json'),settings=JSON.parse(fs.readFileSync(settingsFile)),config=JSON.parse(fs.readFileSync(configFile)),legacy=path.join(f.profileDir,'web.sock');
 settings.publicWebPolicy.brokerSocketPath=legacy;config.plugins.entries['agi-public-browser'].config.socketPath=legacy;fs.writeFileSync(configFile,JSON.stringify(config));settings.policyHash=policyHash(settings);fs.writeFileSync(settingsFile,JSON.stringify(settings));const beforeSettings=fs.readFileSync(settingsFile),beforeConfig=fs.readFileSync(configFile),logins=f.loginCount;let reviewed=false;
 f.rl.question=async prompt=>{if(!prompt.includes('Type APPROVE'))return 'SEPARATE';reviewed=true;const candidate=path.join(f.home,'.agi-genesis-setup-'+role,'transaction/candidate'),next=JSON.parse(fs.readFileSync(path.join(candidate,'compute-settings.json'))),gateway=JSON.parse(fs.readFileSync(path.join(candidate,'openclaw.json')));assert.deepEqual(fs.readFileSync(settingsFile),beforeSettings);assert.deepEqual(fs.readFileSync(configFile),beforeConfig);assert.equal(next.publicWebPolicy.enabled,false);assert.equal(next.publicWebPolicy.mode,'disabled');assert.equal(gateway.plugins.entries['agi-public-browser'].config.socketPath,next.publicWebPolicy.brokerSocketPath);assert(!next.publicWebPolicy.brokerSocketPath.startsWith(f.profileDir+path.sep));assert(!next.publicWebPolicy.brokerSocketPath.startsWith(candidate+path.sep));assert.equal(fs.existsSync(path.dirname(next.publicWebPolicy.brokerSocketPath)),false);return 'REVIEW LATER';};
 await assert.rejects(f.run(),/SETUP_SECURITY_REVIEW_REQUIRED/);assert.equal(reviewed,true);assert.equal(f.loginCount,logins);assert.equal(fs.existsSync(legacy),false);assert.equal(f.active.size,0);
});

test('setup waits for delayed absent-job observations and records bounded shutdown without a rollback error',async t=>{
 const f=fixture(t),spawn=f.dependencies.spawnSync;let remaining=4;
 f.dependencies.spawnSync=(exe,args,options)=>exe==='/bin/launchctl'&&args[0]==='print'&&remaining-->0?{status:0,stdout:'state = terminating'}:spawn(exe,args,options);
 const result=await f.run();assert.equal(result.supportReport.passed,true);assert.equal(result.supportReport.rollbackFailureCode,null);const delayed=result.supportReport.serviceShutdown.find(x=>x.attempts>1);assert.ok(delayed);assert.equal(delayed.state,'passed');assert.deepEqual(delayed.servicesAbsent,{compute:true,gateway:true});assert.deepEqual(delayed.portsClosed,{compute:true,gateway:true});assert.equal(delayed.socketsAbsent,true);
});

for(const role of ['agent','node'])test('physical-Mac prefixed absence resumes '+role+' safe-stop recovery, archives its checkpoint and reaches fresh approval without new OAuth',async t=>{
 const f=fixture(t,role);await f.run();
 const support=path.join(f.home,'.agi-genesis-setup-'+role),txDir=path.join(support,'transaction'),settingsFile=path.join(f.profileDir,'compute-settings.json'),journal=path.join(f.profileDir,'compute-journal.json'),settings=JSON.parse(fs.readFileSync(settingsFile));
 settings.maxRuns24h=7;settings.maxImages24h=2;settings.policyHash=policyHash(settings);fs.writeFileSync(settingsFile,JSON.stringify(settings),{mode:0o600});fs.writeFileSync(journal,'{"accepted":["preserve-accepted-work"],"allowance":11}',{mode:0o600});
 const beforeJournal=fs.readFileSync(journal),authNames=[...(role==='agent'?['agi-creator']:[]),'agi-checker','agi-reviewer'],auth=new Map(authNames.map(name=>[name,fs.readFileSync(path.join(f.profileDir,'agents',name,'agent/auth-profiles.json'))])),logins=f.loginCount;
 f.failHealth=true;f.failAllRollbackStops=true;await assert.rejects(f.run(),/COMPUTE_SERVICE_HEALTH_FAILED/);
 const originalReceipt=fs.readFileSync(path.join(txDir,'transaction.json')),interrupted=JSON.parse(originalReceipt);await assert.rejects(f.run(),error=>{assert.equal(error.message,'SETUP_ROLLBACK_STOP_REQUIRED');assert.equal(error.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(error.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');return true;});const checkpoint=fs.readFileSync(path.join(txDir,'recovery-evidence/transaction-before-recovery.json'));assert.deepEqual(checkpoint,originalReceipt);
 assert.equal(interrupted.state,'safe-stop-required');assert.equal(interrupted.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(interrupted.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');
 // Recovery remains automatic: only the observed service responses change;
 // the test never deletes or edits a transaction, STOP file, service or profile.
 f.failHealth=false;f.failAllRollbackStops=false;const ask=f.rl.question,spawn=f.dependencies.spawnSync,observations=[];let reviewed=false;
 f.dependencies.spawnSync=(exe,args,options)=>{const result=spawn(exe,args,options);if(exe==='/bin/launchctl'&&args[0]==='print'){assert.equal(result.status,113);assert.equal(result.stderr,'Bad request.\nCould not find service "'+args[1].split('/').at(-1)+'" in domain for user gui: 504\n');observations.push(args[1]);}return result;};
 f.rl.question=async prompt=>{if(prompt.includes('Type APPROVE')){reviewed=true;const review=JSON.parse(fs.readFileSync(path.join(support,'security-review.json')));const staged=JSON.parse(fs.readFileSync(path.join(txDir,'transaction.json')));assert.notEqual(staged.id,interrupted.id);assert.equal(staged.approval,null);assert.ok(prompt.includes(review.digest.slice(0,12)));assert.equal(f.loginCount,logins);}return ask(prompt);};
 const result=await f.run(),archive=path.join(support,'transaction-archive-'+interrupted.id),retained=JSON.parse(fs.readFileSync(path.join(archive,'transaction.json'))),current=JSON.parse(fs.readFileSync(path.join(txDir,'transaction.json')));
 assert.equal(reviewed,true);assert.equal(result.supportReport.passed,true);assert.equal(result.supportReport.walletAccessed,false);assert.equal(f.loginCount,logins);assert.notEqual(current.id,interrupted.id);assert.equal(current.state,'complete');assert.equal(retained.state,'rolled-back');assert.equal(retained.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(retained.rollbackFailureCode,'SETUP_ROLLBACK_STOP_REQUIRED');assert.deepEqual(fs.readFileSync(path.join(archive,'recovery-evidence/transaction-before-recovery.json')),checkpoint);assert.ok(fs.existsSync(path.join(archive,retained.failedCandidate)));assert.equal(fs.existsSync(path.join(f.profileDir,'COMPUTE_STOP')),false);
 assert.deepEqual(fs.readFileSync(journal),beforeJournal);for(const [name,bytes]of auth)assert.deepEqual(fs.readFileSync(path.join(f.profileDir,'agents',name,'agent/auth-profiles.json')),bytes);const final=JSON.parse(fs.readFileSync(settingsFile));assert.equal(final.maxRuns24h,7);assert.equal(final.maxImages24h,2);
 const labels=role==='agent'?['ai.montreal.agi-compute','ai.openclaw.agi-compute']:['ai.montreal.agi-node-compute','ai.openclaw.agi-node-compute'];for(const label of labels)assert.ok(observations.includes('gui/504/'+label));assert.ok(result.supportReport.serviceShutdown.length>=3);
 for(const stop of result.supportReport.serviceShutdown){assert.equal(stop.state,'passed');assert.deepEqual(stop.servicesAbsent,{compute:true,gateway:true});assert.deepEqual(stop.portsClosed,{compute:true,gateway:true});assert.equal(stop.socketsAbsent,true);for(const name of ['compute','gateway'])assert.deepEqual(stop.launchctlPrint[name],{attempt:stop.attempts,status:113,classification:'absent',badRequestPrefix:true});}
});

for(const role of ['agent','node'])for(const failure of ['rejected-schema','invalid-receipt'])test(`${role} candidate state preparation ${failure} stops before OAuth, review or services and preserves the live profile`,async t=>{
 const f=fixture(t,role);await f.run();const beforeConfig=fs.readFileSync(path.join(f.profileDir,'openclaw.json')),beforeSettings=fs.readFileSync(path.join(f.profileDir,'compute-settings.json')),logins=f.loginCount,start=f.events.length;let approvals=0;
 f.rl.question=async prompt=>{if(!prompt.includes('Type APPROVE'))return 'SEPARATE';approvals++;assert.fail('preparation failure must precede approval');};
 f.dependencies.prepareCandidateState=()=>{if(failure==='rejected-schema')throw Error('SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');return {...statePreparationFixture(),private:'PREPARATION-PRIVATE-CANARY'};};
 let error;try{await f.run();assert.fail('expected preparation failure');}catch(value){error=value;}
 assert.equal(error.message,failure==='rejected-schema'?'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED':'SETUP_STATE_PREPARATION_RECEIPT_INVALID');assert.equal(error.supportReport.stages.profile,'failed');assert.notEqual(error.supportReport.stages.oauth,'passed');assert.notEqual(error.supportReport.stages.services,'passed');assert.equal(approvals,0);assert.equal(f.loginCount,logins);assert.ok(f.events.slice(start).every(event=>!event.command.startsWith('models')&&!event.command.startsWith('gateway')));assert.deepEqual(fs.readFileSync(path.join(f.profileDir,'openclaw.json')),beforeConfig);assert.deepEqual(fs.readFileSync(path.join(f.profileDir,'compute-settings.json')),beforeSettings);
 const tx=JSON.parse(fs.readFileSync(path.join(f.home,'.agi-genesis-setup-'+role+'/transaction/transaction.json')));assert.equal(tx.state,'prepared');assert.equal(tx.approval,null);assert.equal(tx.approvedIdentity,null);assert.equal(tx.approvedSecurityRecord,undefined);assert.equal(error.supportReport.walletAccessed,false);assert.equal(error.supportReport.moneyMoved,false);assert.equal(error.supportReport.statePreparation,null);assert(!JSON.stringify(error.supportReport).includes('PREPARATION-PRIVATE-CANARY'));
});

for(const role of ['agent','node'])test('clean '+role+' entry refuses old profile/evidence before lock, runtime discovery or recovery writes',async t=>{
 const f=fixture(t,role),support=path.join(f.home,'.agi-genesis-setup-'+role);fs.mkdirSync(support,{mode:0o700});const evidence=path.join(support,'transaction-evidence.json');fs.writeFileSync(evidence,'preserve-exactly',{mode:0o600});const before=fs.statSync(evidence);let invoked=false;
 f.dependencies.discoverRuntime=()=>{invoked=true;throw Error('MUST_NOT_DISCOVER');};
 await assert.rejects(setupCapable(f.kit,f.rl,{cleanInstall:true,assuranceMode:'verified',dependencies:{...f.dependencies,initializeFreshCandidateState:f.dependencies.prepareCandidateState,prepareCandidateState:()=>{throw Error('LEGACY_PREPARATION_MUST_NOT_RUN');}}}),/CLEAN_INSTALL_EVIDENCE_EXISTS/);
 assert.equal(invoked,false);assert.equal(f.events.length,0);assert.deepEqual(fs.readdirSync(support),['transaction-evidence.json']);assert.equal(fs.readFileSync(evidence,'utf8'),'preserve-exactly');assert.equal(fs.statSync(evidence).mtimeMs,before.mtimeMs);assert.equal(fs.existsSync(f.profileDir),false);
});
for(const role of ['agent','node'])test('clean '+role+' entry prepares fresh roles and initialization before review, seals limits and requires complete readiness',async t=>{
 const f=fixture(t,role);f.dependencies.cleanInstallGroups=()=>({status:0,stdout:'staff everyone localaccounts\n'});
 f.dependencies.prepareCleanCandidateInitialization=({candidate,profileDir})=>{assert.notEqual(candidate,profileDir);assert.equal(fs.existsSync(profileDir),false);f.events.push({command:'clean initialization',candidate:true});return cleanInitializationFixture();};
 f.dependencies.finishCleanCandidateInitialization=()=>{};
 const result=await setupCapable(f.kit,f.rl,{cleanInstall:true,assuranceMode:'verified',dependencies:{...f.dependencies,initializeFreshCandidateState:f.dependencies.prepareCandidateState,prepareCandidateState:()=>{throw Error('LEGACY_PREPARATION_MUST_NOT_RUN');}}}),report=result.supportReport,settings=JSON.parse(fs.readFileSync(path.join(f.profileDir,'compute-settings.json')));
 assert.equal(report.installationTrack,'clean-install');assert.equal(report.cleanInstallAdmission.standardAccount,true);assert.equal(report.cleanInitialization.verified,true);assert.equal(report.passed,true);assert.equal(report.serviceReadiness.finalPolicy.state,'passed');assert.equal(settings.maxRuns24h,256);assert.equal(settings.maxImages24h,32);assert.equal(settings.policyHash,policyHash(settings));assert.equal(f.loginCount,role==='agent'?3:2);assert.equal(fs.existsSync(path.join(f.profileDir,'COMPUTE_STOP')),false);
 const tx=JSON.parse(fs.readFileSync(path.join(f.home,'.agi-genesis-setup-'+role,'transaction/transaction.json')));assert.equal(tx.previousExisted,false);assert.equal(tx.state,'complete');assert.deepEqual(tx.cleanInitializationReceipt,cleanInitializationFixture());
 const review=JSON.parse(fs.readFileSync(path.join(f.home,'.agi-genesis-setup-'+role,'security-review.json')));assert.deepEqual(review.cleanInitialization,cleanInitializationFixture());
 const commands=f.events.map(event=>event.command);assert.ok(commands.indexOf('clean initialization')>commands.findIndex(command=>command.includes('auth login')));assert.ok(commands.indexOf('clean initialization')<commands.findIndex(command=>command.startsWith('gateway install')));
});

for(const role of ['agent','node'])test('clean '+role+' Standard-account rejection creates no installer state',async t=>{
 const f=fixture(t,role);let discovered=false;f.dependencies.discoverRuntime=()=>{discovered=true;throw Error('MUST_NOT_DISCOVER');};f.dependencies.cleanInstallGroups=()=>({status:0,stdout:'staff admin\n'});const before=fs.readdirSync(f.home);
 await assert.rejects(setupCapable(f.kit,f.rl,{cleanInstall:true,assuranceMode:'verified',dependencies:{...f.dependencies,initializeFreshCandidateState:f.dependencies.prepareCandidateState,prepareCandidateState:()=>{throw Error('LEGACY_PREPARATION_MUST_NOT_RUN');}}}),/COMPUTE_STANDARD_ACCOUNT_REQUIRED/);assert.equal(discovered,false);assert.equal(f.events.length,0);assert.deepEqual(fs.readdirSync(f.home),before);
});

for(const role of ['agent','node'])test('clean '+role+' early cancellation can retry explicitly without deleting evidence or touching legacy state',async t=>{
 const f=fixture(t,role);f.dependencies.cleanInstallGroups=()=>({status:0,stdout:'staff everyone localaccounts\n'});const ask=f.rl.question;f.rl.question=async()=> 'CANCEL';
 await assert.rejects(setupCapable(f.kit,f.rl,{cleanInstall:true,assuranceMode:'verified',dependencies:{...f.dependencies,initializeFreshCandidateState:f.dependencies.prepareCandidateState,prepareCandidateState:()=>{throw Error('LEGACY_PREPARATION_MUST_NOT_RUN');}}}),/COMPUTE_SEPARATE_OS_USER_REQUIRED/);
 const support=path.join(f.home,'.agi-genesis-setup-'+role),old=fs.readFileSync(path.join(support,'setup-diagnostics.json'));assert.equal(fs.existsSync(path.join(support,'transaction')),false);assert.equal(fs.existsSync(f.profileDir),false);
 f.rl.question=ask;f.dependencies.prepareCleanCandidateInitialization=()=>cleanInitializationFixture();f.dependencies.finishCleanCandidateInitialization=()=>{};
 const result=await setupCapable(f.kit,f.rl,{cleanInstall:true,assuranceMode:'verified',cleanRetry:true,dependencies:{...f.dependencies,initializeFreshCandidateState:f.dependencies.prepareCandidateState,prepareCandidateState:()=>{throw Error('LEGACY_PREPARATION_MUST_NOT_RUN');}}});assert.equal(result.supportReport.passed,true);assert.ok(result.supportReport.cleanRetryEvidence);assert.deepEqual(fs.readFileSync(path.join(support,result.supportReport.cleanRetryEvidence.path,'setup-diagnostics.json')),old);assert.equal(result.supportReport.componentEvidence.valuesIncluded,false);
});

test('clean early retry refuses to overwrite prior ledger when archive parent cannot be synced',async t=>{
 const f=fixture(t);f.dependencies.cleanInstallGroups=()=>({status:0,stdout:'staff everyone localaccounts\n'});f.rl.question=async()=> 'CANCEL';await assert.rejects(setupCapable(f.kit,f.rl,{cleanInstall:true,assuranceMode:'verified',dependencies:{...f.dependencies,initializeFreshCandidateState:f.dependencies.prepareCandidateState,prepareCandidateState:()=>{throw Error('LEGACY_PREPARATION_MUST_NOT_RUN');}}}),/COMPUTE_SEPARATE_OS_USER_REQUIRED/);
 const support=path.join(f.home,'.agi-genesis-setup-agent'),file=path.join(support,'genesis-setup-progress.json'),before=fs.readFileSync(file),rootStat=fs.statSync(support),original=fs.fsyncSync;let injected=false;
 fs.fsyncSync=fd=>{const st=fs.fstatSync(fd);if(st.dev===rootStat.dev&&st.ino===rootStat.ino){injected=true;throw Error('SIMULATED_ROOT_FSYNC_FAILURE');}return original(fd);};
 try{await assert.rejects(setupCapable(f.kit,f.rl,{cleanInstall:true,assuranceMode:'verified',cleanRetry:true,dependencies:{...f.dependencies,initializeFreshCandidateState:f.dependencies.prepareCandidateState,prepareCandidateState:()=>{throw Error('LEGACY_PREPARATION_MUST_NOT_RUN');}}}),/SIMULATED_ROOT_FSYNC_FAILURE|CLEAN_INSTALL_RETRY_UNAVAILABLE/);}finally{fs.fsyncSync=original;}
 assert.equal(injected,true);assert.deepEqual(fs.readFileSync(file),before);assert.equal(fs.existsSync(path.join(support,'transaction')),false);assert.equal(fs.existsSync(f.profileDir),false);
});

for(const role of ['agent','node'])test('Standard default '+role+' install admits bounded runtime materialization and completes critical health',async t=>{
 const f=fixture(t,role);f.dependencies.cleanInstallGroups=()=>({status:0,stdout:'staff everyone localaccounts'});const stage=f.dependencies.stageCandidateAuthOrder;f.dependencies.stageCandidateAuthOrder=options=>{const receipt=stage(options);const {db}=runtimeDatabase(options.candidate,'agent',options.agent);db.prepare('UPDATE auth_profile_store SET store_json=? WHERE store_key=?').run(JSON.stringify({version:1,profiles:{'openai:agi-compute-pro':{provider:'openai',type:'oauth',access:'fixture',refresh:'fixture',expires:4102444800000,accountId:options.agent}}}),'primary');db.close();return receipt;};
 f.dependencies.initializeFreshCandidateState=f.dependencies.prepareCandidateState;
 f.dependencies.prepareCandidateState=()=>{throw Error('LEGACY_MUST_NOT_RUN');};
 f.dependencies.prepareCleanCandidateInitialization=()=>{throw Error('VERIFIED_INITIALIZER_MUST_NOT_RUN');};
 const fetch=f.dependencies.fetch;f.dependencies.fetch=async(url,opts)=>{
  if(url.endsWith('/health')){const dir=path.join(f.profileDir,'operational-runtime-cache');fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,'cache.json'),'runtime-generated',{mode:0o600});const db=stageRuntimeFixture({candidate:f.profileDir,agent:role==='agent'?'agi-creator':'agi-checker'});}
  return fetch(url,opts);
 };
 const result=await setupCapable(f.kit,f.rl,{cleanInstall:true,dependencies:f.dependencies});
 const report=result.supportReport,tx=JSON.parse(fs.readFileSync(path.join(f.home,'.agi-genesis-setup-'+role,'transaction/transaction.json')));
 assert.equal(report.assuranceMode,'standard');assert.equal(report.verificationScope,'critical-execution-authority');assert.equal(report.cleanInitialization,null);assert.equal(report.componentEvidence,null);
 assert.equal(report.passed,true);assert.equal(report.serviceReadiness.finalPolicy.state,'passed');assert.equal(tx.state,'complete');assert.equal(tx.installationTrack,'standard-install');assert.equal(tx.previousExisted,false);assert.equal(tx.runtimeSecurityVersion,undefined);assert.equal(tx.componentEvidenceVersion,undefined);assert.equal(tx.completedIdentityKind,'standard-authority/v1');
 const config=JSON.parse(fs.readFileSync(path.join(f.profileDir,'openclaw.json')));assert.equal(config.cron.enabled,false);assert.equal(f.loginCount,role==='agent'?3:2);assert.equal(fs.existsSync(path.join(f.profileDir,'COMPUTE_STOP')),false);assert.equal(fs.existsSync(path.join(f.profileDir,'operational-runtime-cache/cache.json')),true);
});
for(const role of ['agent','node'])test('Standard '+role+' health failure stops services and retains fresh runtime without historical equivalence',async t=>{
 const f=fixture(t,role);f.dependencies.cleanInstallGroups=()=>({status:0,stdout:'staff everyone localaccounts'});const stage=f.dependencies.stageCandidateAuthOrder;f.dependencies.stageCandidateAuthOrder=options=>{const receipt=stage(options);const {db}=runtimeDatabase(options.candidate,'agent',options.agent);db.prepare('UPDATE auth_profile_store SET store_json=? WHERE store_key=?').run(JSON.stringify({version:1,profiles:{'openai:agi-compute-pro':{provider:'openai',type:'oauth',access:'fixture',refresh:'fixture',expires:4102444800000,accountId:options.agent}}}),'primary');db.close();return receipt;};f.dependencies.initializeFreshCandidateState=f.dependencies.prepareCandidateState;f.failHealth=true;
 await assert.rejects(setupCapable(f.kit,f.rl,{cleanInstall:true,dependencies:f.dependencies}),e=>{assert.equal(e.primaryFailureCode,'COMPUTE_SERVICE_HEALTH_FAILED');assert.equal(e.rollbackFailureCode,null);assert.equal(e.supportReport.transaction.state,'rolled-back');return true;});
 assert.equal(f.active.size,0);assert.equal(fs.existsSync(f.profileDir),false);assert.equal(fs.existsSync(path.join(f.home,'.agi-genesis-setup-'+role,'transaction/candidate/openclaw.json')),true);
});

function standardRetryFixture(t,role){
 const f=fixture(t,role);f.dependencies.cleanInstallGroups=()=>({status:0,stdout:'staff everyone localaccounts'});
 const stage=f.dependencies.stageCandidateAuthOrder;f.dependencies.stageCandidateAuthOrder=options=>{const receipt=stage(options);const {db}=runtimeDatabase(options.candidate,'agent',options.agent);db.prepare('UPDATE auth_profile_store SET store_json=? WHERE store_key=?').run(JSON.stringify({version:1,profiles:{'openai:agi-compute-pro':{provider:'openai',type:'oauth',access:'fixture',refresh:'fixture',expires:4102444800000,accountId:options.agent}}}),'primary');db.close();return receipt;};
 f.dependencies.initializeFreshCandidateState=f.dependencies.prepareCandidateState;
 f.dependencies.prepareCandidateState=()=>{throw Error('LEGACY_MUST_NOT_RUN');};f.dependencies.prepareCleanCandidateInitialization=()=>{throw Error('VERIFIED_INITIALIZER_MUST_NOT_RUN');};
 return f;
}
async function stoppedStandardDockerAttempt(f){
 const discover=f.dependencies.discoverRuntime;f.dependencies.discoverRuntime=()=>{throw Error('COMPUTE_DOCKER_REQUIRED');};
 await assert.rejects(setupCapable(f.kit,f.rl,{cleanInstall:true,dependencies:f.dependencies}),e=>{assert.equal(e.supportReport.assuranceMode,'standard');assert.equal(e.supportReport.transaction,null);return e.message==='COMPUTE_DOCKER_REQUIRED';});
 f.dependencies.discoverRuntime=discover;
 const support=path.join(f.home,'.agi-genesis-setup-'+(f.kit.schema.includes('node')?'node':'agent'));
 return {support,report:fs.readFileSync(path.join(support,'setup-diagnostics.json')),ledger:fs.readFileSync(path.join(support,'genesis-setup-progress.json'))};
}
for(const role of ['agent','node'])for(const flag of ['--retry-standard-install','--retry-clean-install'])test(role+' Docker preflight retry '+flag+' remains Standard through approval and authenticated completion',async t=>{
 const f=standardRetryFixture(t,role),prior=await stoppedStandardDockerAttempt(f);
 assert.equal(f.loginCount,0);assert.equal(f.active.size,0);assert.equal(fs.existsSync(f.profileDir),false);assert.equal(fs.existsSync(path.join(prior.support,'transaction')),false);
 const result=await setupCapable(f.kit,f.rl,{...readSetupArguments(['kit.json',flag]),dependencies:f.dependencies});
 assert.equal(result.supportReport.assuranceMode,'standard');assert.equal(result.supportReport.verificationScope,'critical-execution-authority');assert.equal(result.supportReport.componentEvidence,null);assert.equal(result.supportReport.cleanInitialization,null);assert.equal(result.supportReport.passed,true);assert.equal(result.supportReport.serviceReadiness.health.state,'passed');assert.equal(result.supportReport.serviceReadiness.finalPolicy.state,'passed');assert.equal(f.loginCount,role==='agent'?3:2);
 const archive=path.join(prior.support,result.supportReport.cleanRetryEvidence.path);assert.deepEqual(fs.readFileSync(path.join(archive,'setup-diagnostics.json')),prior.report);assert.deepEqual(fs.readFileSync(path.join(archive,'genesis-setup-progress.json')),prior.ledger);
 const tx=JSON.parse(fs.readFileSync(path.join(prior.support,'transaction/transaction.json')));assert.equal(tx.state,'complete');assert.equal(tx.completedIdentityKind,'standard-authority/v1');
});
for(const role of ['agent','node'])test(role+' explicit Verified retry refuses a Standard failure before evidence or services change',async t=>{
 const f=standardRetryFixture(t,role),prior=await stoppedStandardDockerAttempt(f);await assert.rejects(setupCapable(f.kit,f.rl,{...readSetupArguments(['kit.json','--retry-verified-install']),dependencies:f.dependencies}),/CLEAN_INSTALL_RETRY_MODE_MISMATCH/);assert.deepEqual(fs.readFileSync(path.join(prior.support,'setup-diagnostics.json')),prior.report);assert.deepEqual(fs.readFileSync(path.join(prior.support,'genesis-setup-progress.json')),prior.ledger);assert.equal(fs.existsSync(path.join(prior.support,'early-attempts')),false);assert.equal(f.loginCount,0);assert.equal(f.active.size,0);
});
for(const role of ['agent','node'])for(const flag of ['--retry-verified-install','--retry-clean-install'])test(role+' Verified preflight retry '+flag+' preserves Verified rather than switching tier',async t=>{
 const f=fixture(t,role);f.dependencies.cleanInstallGroups=()=>({status:0,stdout:'staff everyone localaccounts'});const ask=f.rl.question;f.rl.question=async()=> 'CANCEL';
 await assert.rejects(setupCapable(f.kit,f.rl,{cleanInstall:true,assuranceMode:'verified',dependencies:f.dependencies}),/COMPUTE_SEPARATE_OS_USER_REQUIRED/);
 const support=path.join(f.home,'.agi-genesis-setup-'+role),before=fs.readFileSync(path.join(support,'setup-diagnostics.json'));
 await assert.rejects(setupCapable(f.kit,f.rl,{...readSetupArguments(['kit.json','--retry-standard-install']),dependencies:f.dependencies}),/CLEAN_INSTALL_RETRY_MODE_MISMATCH/);assert.deepEqual(fs.readFileSync(path.join(support,'setup-diagnostics.json')),before);
 f.rl.question=ask;f.dependencies.prepareCleanCandidateInitialization=()=>cleanInitializationFixture();f.dependencies.finishCleanCandidateInitialization=()=>{};
 const result=await setupCapable(f.kit,f.rl,{...readSetupArguments(['kit.json',flag]),dependencies:{...f.dependencies,initializeFreshCandidateState:f.dependencies.prepareCandidateState}});
 assert.equal(result.supportReport.passed,true);assert.equal(result.supportReport.assuranceMode,'verified');assert.ok(result.supportReport.componentEvidence);assert.deepEqual(fs.readFileSync(path.join(support,result.supportReport.cleanRetryEvidence.path,'setup-diagnostics.json')),before);
});
for(const mutation of ['missing-report','old-release','wrong-role','missing-mode','wrong-mode','inconsistent-ledger','not-failed','unrecognized-failure','images-started','oauth-authenticated','approval','transaction','live-profile','service-file','loaded-service','open-port','permission-error','paid-call','images-bound','report-symlink','report-hardlink','report-public-mode'])test('Standard retry rejects '+mutation+' without replacing the failed attempt',async t=>{
 const f=standardRetryFixture(t,'node'),prior=await stoppedStandardDockerAttempt(f),reportFile=path.join(prior.support,'setup-diagnostics.json'),ledgerFile=path.join(prior.support,'genesis-setup-progress.json');
 const report=JSON.parse(prior.report),ledger=JSON.parse(prior.ledger);
 if(mutation==='missing-report')fs.unlinkSync(reportFile);
 else if(mutation==='old-release'){report.versions.fleet='1.18.8';}
 else if(mutation==='wrong-role')report.versions.role=report.versions.role==='agent'?'node':'agent';
 else if(mutation==='missing-mode')delete report.assuranceMode;
 else if(mutation==='wrong-mode')report.assuranceMode='verified';
 else if(mutation==='inconsistent-ledger')report.runID='f'.repeat(36);
 else if(mutation==='not-failed')report.passed=true;
 else if(mutation==='unrecognized-failure'){report.primaryFailureCode='UNKNOWN';report.failureCode='UNKNOWN';}
 else if(mutation==='images-started'){report.stages.images='running';ledger.stages.images='running';}
 else if(mutation==='oauth-authenticated')ledger.auth['agi-checker']=true;
 else if(mutation==='approval')report.securityReviewDigest='a'.repeat(64);
 else if(mutation==='transaction')fs.mkdirSync(path.join(prior.support,'transaction'),{mode:0o700});
 else if(mutation==='live-profile')fs.mkdirSync(f.profileDir,{mode:0o700});
 else if(mutation==='service-file'){const dir=path.join(f.home,'Library/LaunchAgents');fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,'ai.openclaw.agi-node-compute.plist'),'retained',{mode:0o600});}
 else if(mutation==='loaded-service'||mutation==='permission-error'){const spawn=f.dependencies.spawnSync;f.dependencies.spawnSync=(exe,args,opts)=>exe==='/bin/launchctl'&&args[0]==='print'?(mutation==='loaded-service'?{status:0,stdout:'loaded'}:{status:1,stderr:'Permission denied'}):spawn(exe,args,opts);}
 else if(mutation==='open-port')f.active.add(18898);
 else if(mutation==='paid-call')report.paidProviderCall=true;
 else if(mutation==='images-bound')report.images.work='sha256:'+'a'.repeat(64);
 if(!['missing-report','report-symlink','report-hardlink','report-public-mode'].includes(mutation))fs.writeFileSync(reportFile,JSON.stringify(report),{mode:0o600});fs.writeFileSync(ledgerFile,JSON.stringify(ledger),{mode:0o600});
 if(mutation==='report-symlink'){fs.renameSync(reportFile,path.join(f.home,'report-target'));fs.symlinkSync(path.join(f.home,'report-target'),reportFile);}
 if(mutation==='report-hardlink')fs.linkSync(reportFile,path.join(f.home,'report-copy'));
 if(mutation==='report-public-mode')fs.chmodSync(reportFile,0o644);
 const before=fs.readdirSync(prior.support),bytes=fs.existsSync(reportFile)?fs.readFileSync(reportFile):null,progress=fs.readFileSync(ledgerFile);
 await assert.rejects(setupCapable(f.kit,f.rl,{...readSetupArguments(['kit.json','--retry-standard-install']),dependencies:f.dependencies}),/CLEAN_INSTALL_(RETRY|PROFILE|SERVICE)/);
 assert.deepEqual(fs.readdirSync(prior.support),before);if(bytes)assert.deepEqual(fs.readFileSync(reportFile),bytes);assert.deepEqual(fs.readFileSync(ledgerFile),progress);assert.equal(fs.existsSync(path.join(prior.support,'early-attempts')),false);assert.equal(f.loginCount,0);
});
