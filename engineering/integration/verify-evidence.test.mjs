// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {deriveNativeSourceCapture,requireNativeSourceCapture,requireNativeArtifacts,requireRejectedAllocation,verifyEvidence} from './verify-evidence.mjs';
import {sha256} from './bridge.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-proof-negative-'));
process.on('exit',()=>fs.rmSync(root,{recursive:true,force:true}));
for(const [name,value] of Object.entries({empty:{},protocol:{authority:'none',verified:false,receipt:{state:'review',cleanup:'VERIFIED',actions_reserved:1,screenshots:[]},execution:{provider:{model:'PROTOCOL_DOUBLE_NO_BROWSER'}}},flagsOnly:{authority:'none',verified:false,receipt:{state:'review',cleanup:'VERIFIED',actions_reserved:14,screenshots:Array.from({length:15},(_,i)=>({file:'screen-'+String(i).padStart(3,'0')+'.png',sha256:'0'.repeat(64)}))},execution:{provider:{model:'SCRIPTED_COMPUTER_FIXTURE_NOT_LIVE_MODEL',endpoint:'http://127.0.0.1/fixture-no-network'}}}}))test('rejects '+name+' rather than deriving browser execution from flags',()=>assert.throws(()=>requireNativeArtifacts(root,'accepted',value)));
const mission={digest:'mission',requirements:{earlyUnits:1,earlyDay:7,totalUnits:1,finalDay:14,budgetCents:100},suppliers:[{id:'supplier',unitCents:50,freightCents:0,deliveryDay:7}]};
const report={mission,digest:'report',frozen:{programDigest:'program'}};
const positive={missionDigest:'mission',reportDigest:'report',frozenProgramDigest:'program',formulation:'actual_requirements',purchaseExecuted:false,plan:{allocations:[{supplierId:'supplier',units:1}],costCents:50},check:{valid:true,totals:{totalUnits:1,earlyUnits:1,costCents:50}}};
const returned=result=>({observedText:'SUCCESSOR_COMPUTER_RESULT '+JSON.stringify(result)});
test('rejects positive raw observation substituted for negative provenance',()=>assert.throws(()=>requireRejectedAllocation(report,returned(positive)),/Positive raw results/));
test('negative oracle requires exact report and frozen-program bindings',()=>{const late=structuredClone(positive);late.plan.allocations[0].units=2;late.check.valid=false;assert.doesNotThrow(()=>requireRejectedAllocation(report,returned(late)));late.reportDigest='other';assert.throws(()=>requireRejectedAllocation(report,returned(late)));});
test('complete former empty/protocol aggregate bypass is refused by installed exact-source inspectors',{skip:!process.env.FQR_VERIFY_ALPHA},async()=>{
  const dir=path.join(root,'forgery');for(const relative of ['accepted','rejected-late'])fs.mkdirSync(path.join(dir,relative),{recursive:true});
  const write=(name,value)=>fs.writeFileSync(path.join(dir,name),typeof value==='string'?value:JSON.stringify(value));
  const producer={repository:'MontrealAI/AGI-Fleet-Linux',commit:'1'.repeat(40),workflowRun:'1',workflowAttempt:'1'};write('execution-context.json',producer);
  const raw=JSON.stringify({authority:'none',verified:false,receipt:{state:'review',cleanup:'VERIFIED',actions_reserved:1,screenshots:[]},execution:{image:'sha256:'+'1'.repeat(64),provider:{model:'PROTOCOL_DOUBLE_NO_BROWSER'}},observedText:'PROTOCOL DOUBLE. NO BROWSER WAS EXECUTED.'});
  const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
  const body={inputs:{handoffRaw:'{}',returnRaw:raw,reportRaw:'{}'},routes:{managerRaw:'{}',jobsRaw:'{}'},historyRaw:'{}',constraintCheck:{accepted:true,independentlyImplementedConstraintCheck:true,independentlyControlledEconomicReview:false}};
  const journey=canonical({...body,sha256:sha256(canonical(body))});write('accepted/complete-journey.json',journey);
  for(const [file,value] of Object.entries({'handoff.json':'{}','computer-return.json':raw,'frozen-mission-report.json':'{}','manager-usdc-draft.json':'{}','jobs-agialpha-draft.json':'{}','alpha-retained-history.json':'{}','integration-evidence.json':{journeySha256:sha256(journey)},'browser-evidence.json':{realBrowser:true,dockerIsolation:true,nativeSession:{actions:1,screenshots:0}}}))write('accepted/'+file,value);
  write('jobs-local-lifecycle.json',{});write('manager-local-lifecycle.json',{});write('rejected-late/rejection-evidence.json',{actualBrowserResultRejected:true});
  await assert.rejects(verifyEvidence({root:dir,alphaRoot:process.env.FQR_VERIFY_ALPHA,jobsRoot:process.env.FQR_VERIFY_JOBS,managerRoot:process.env.FQR_VERIFY_MANAGER,expectedContext:producer}),/FOUR_REPO_|COMPUTER_/);
  assert.equal(fs.existsSync(path.join(dir,'compatibility-evidence.json')),false);
});

test('modified retained producer context is rejected against unchanged caller context before source imports',async()=>{const dir=path.join(root,'producer-substitution');fs.mkdirSync(dir);const trusted={repository:'MontrealAI/AGI-Fleet-Linux',commit:'1'.repeat(40),workflowRun:'1',workflowAttempt:'1'};fs.writeFileSync(path.join(dir,'execution-context.json'),JSON.stringify({...trusted,workflowAttempt:'2'}));await assert.rejects(verifyEvidence({root:dir,alphaRoot:root,jobsRoot:root,managerRoot:root,expectedContext:trusted}),/deep-equal/);assert.equal(fs.existsSync(path.join(dir,'compatibility-evidence.json')),false);});

const capturedSource={mode:'CAPTURED_ALPHA_GIT_SOURCE',commit:'1'.repeat(40),moduleCount:591,sourceBytes:3302453,sourceSha256:'2'.repeat(64)};
test('captured native source evidence binds the reviewed Alpha commit',()=>{assert.doesNotThrow(()=>requireNativeSourceCapture(capturedSource,capturedSource));assert.throws(()=>requireNativeSourceCapture({...capturedSource,commit:'3'.repeat(40)},capturedSource));});
test('legacy source-only mode cannot attest reviewed native source execution',()=>{for(const value of [null,{}, {...capturedSource,mode:'SOURCE_ONLY_LEGACY_TEST_FIXTURE'}])assert.throws(()=>requireNativeSourceCapture(value,capturedSource));});
test('a changed native capture count, byte total or well-formed digest cannot pass',()=>{for(const change of [{moduleCount:590},{sourceBytes:3302454},{sourceSha256:'3'.repeat(64)}])assert.throws(()=>requireNativeSourceCapture({...capturedSource,...change},capturedSource));});
test('Git-derived SDK inventory agrees with Python Unicode ordering and escapes without importing checkout code',()=>{
  const fixture=path.join(root,'sdk-tree');fs.mkdirSync(path.join(fixture,'alpha_factory_v1'),{recursive:true});
  for(const name of ['__init__.py','café.py','\ue000.py','𐀀.py'])fs.writeFileSync(path.join(fixture,'alpha_factory_v1',name),'VALUE = 1\n');
  const git=(...args)=>execFileSync('/usr/bin/git',['-C',fixture,...args],{encoding:'utf8'}).trim();git('init','--quiet');git('add','alpha_factory_v1');git('-c','user.name=Public fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Synthetic SDK fixture');const commit=git('rev-parse','HEAD');
  const expected=JSON.parse(execFileSync('python3',['-B','-c',"import hashlib,json,pathlib,sys; root=pathlib.Path(sys.argv[1]); files={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'alpha_factory_v1').glob('*.py')}; print(json.dumps({'mode':'CAPTURED_ALPHA_GIT_SOURCE','commit':sys.argv[2],'moduleCount':len(files),'sourceBytes':sum(p.stat().st_size for p in (root/'alpha_factory_v1').glob('*.py')),'sourceSha256':hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest()}))",fixture,commit],{encoding:'utf8'}));
  assert.deepEqual(deriveNativeSourceCapture(fixture,commit),expected);
  fs.writeFileSync(path.join(fixture,'alpha_factory_v1/__init__.py'),'VALUE = 2\n');assert.deepEqual(deriveNativeSourceCapture(fixture,commit),expected,'Expected bytes come from reviewed Git objects, not a mutable worktree');
});
