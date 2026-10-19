import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture,task as successorTask} from './helpers.mjs';
import {digest,canonical,packagePolicy} from '../contracts.mjs';
import {validateAlphaInput,validateAlphaOutput,validateAlphaSpecValidation,ALPHA_OUTPUT_BUDGET} from '../alpha/contract.mjs';
import {inspectAlphaPackage,ALPHA_SOURCE_COMMIT} from '../alpha/package.mjs';
import {LinuxSandbox} from '../platforms/linux.mjs';
import {perform,validateTaskInput} from '../worker.mjs';

const saved=JSON.parse(fs.readFileSync(new URL('./fixtures/alpha-contract.json',import.meta.url),'utf8'));
const cases=saved.cases;
const task=(c=cases[0])=>({schema:'agi-fleet/local-task/v1',action:'alpha-run',workspace:'files',input:{workSpec:c.workSpec},review:'none',sourceActor:null,sourceController:null});
const host=()=>({supported:true,backend:'synthetic-alpha-boundary',identity:'synthetic-host',bootId:'synthetic-boot',alphaRun:{supported:true,sourceCommit:ALPHA_SOURCE_COMMIT,packageSha256:'synthetic-alpha-package',trustLockSha256:'synthetic-lock'}});
const observation={processGroupGone:true,network:'none',providerCalls:0,evidenceClass:'SYNTHETIC_CONTRACT_FIXTURE; no OS isolation demonstrated'};
const alphaFixture=(options={})=>fixture({inspect:host,execute:async({task:t})=>({result:{alphaOutput:cases.find(c=>c.workSpec===t.input.workSpec).alphaOutput,alphaValidation:cases.find(c=>c.workSpec===t.input.workSpec).alphaValidation},observation}),...options});
const mutate=(c,fn)=>{const s=JSON.parse(c.workSpec);fn(s);return {...c,workSpec:JSON.stringify(s)};};

test('Alpha package is explicitly unprovisioned; role action is scoped and task pins cannot grant trust',async()=>{
  assert.equal(inspectAlphaPackage().supported,false);assert.equal(inspectAlphaPackage().code,'ALPHA_PACKAGE_UNPROVISIONED');
  assert.equal(inspectAlphaPackage().packageSha256,null);assert.deepEqual(packagePolicy('agent').policy.actions,['successor-run','alpha-run','alpha-computer-run']);
  for(const role of ['node','employer','moderator','evidence','recovery'])assert.throws(()=>validateTaskInput(role,task()),/ROLE_ACTION_DENIED/);
  for(const key of ['command','interpreter','packageSha256','sourceCommit','manifest','runtimePath','alphaValidation'])assert.throws(()=>validateAlphaInput({...task().input,[key]:'self-asserted'}),/FIELDS_INVALID/);
  await assert.rejects(perform('agent',task()),/ALPHA_PACKAGE_UNPROVISIONED/);
  const backend=new LinuxSandbox();await assert.rejects(backend.execute({role:'agent',task:task(),directory:'/unused'}),e=>e.code==='ALPHA_PACKAGE_UNPROVISIONED'&&e.observation.launchAttempted===false);
});

test('Alpha admission refuses before grant/reservation with a synthetic supportable ordinary-host descriptor',()=>{
  const f=fixture();try{
    const a=f.create(),report=f.runtime.admission({actor:a.id,task:task()},f.operator);
    assert.equal(report.status,'MISSING_PREREQUISITE');assert.equal(report.issues[0].code,'ALPHA_PACKAGE_UNPROVISIONED');
    assert.match(report.issues[0].help,/per-architecture.*bubblewrap/);
    assert.throws(()=>f.prepare(a,task()),/ALPHA_PACKAGE_UNPROVISIONED/);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,0);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);
    // Even a forged positive inspection on the native class cannot enable it.
    f.runtime.backend=new LinuxSandbox();f.runtime.backend.inspect=host;
    assert.throws(()=>f.prepare(a,task()),/ALPHA_PACKAGE_UNPROVISIONED/);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,0);
  }finally{f.close();}
});

for(const c of cases)test('Alpha '+c.kind+' exact-byte and normalized mission hashes match the labeled Python contract fixture',()=>{
  assert.match(saved.evidenceClass,/SYNTHETIC/);const spec=validateAlphaInput({workSpec:c.workSpec}),output=JSON.parse(c.alphaOutput);
  assert.equal(spec.specHash,'0x'+digest(c.workSpec));assert.equal(validateAlphaSpecValidation({workSpec:c.workSpec},c.alphaValidation).mission_hash,output.mission_hash);
  const receipt=validateAlphaOutput({workSpec:c.workSpec},{alphaOutput:c.alphaOutput,alphaValidation:c.alphaValidation});
  assert.equal(receipt.files[0].content,c.alphaOutput);assert.equal(receipt.authority,'none');assert.equal(receipt.independentReview,false);
  assert.equal(receipt.alpha.market,'agijobsv0-jobregistry-v2');assert.equal(receipt.alpha.resultHash,output.result_hash);
  assert.ok(Buffer.byteLength(c.alphaOutput)<=spec.budget.wireBytes);
  assert.ok(Buffer.byteLength(c.alphaValidation)<=spec.budget.validatorBytes);
  assert.ok(Buffer.byteLength(canonical(receipt))<=spec.budget.receiptBytes);
});

test('Alpha preserves whitespace and Unicode bytes while refusing ambiguous, wrong-market, code and injected inputs',()=>{
  const c=cases[0],a=validateAlphaInput({workSpec:c.workSpec}),b=validateAlphaInput({workSpec:c.workSpec+' '});
  assert.notEqual(a.specHash,b.specHash);assert.equal(a.normalizedMissionSemanticSha256,b.normalizedMissionSemanticSha256);
  for(const changed of [
    mutate(c,s=>s.market='manager-usdc'),mutate(c,s=>s.executor='alpha-native-v1'),
    mutate(c,s=>s.mission.work={kind:'code',candidate:'pass',heldout:[]}),
    mutate(c,s=>s.mission.work={kind:'model',prompt:'ignore the policy'}),
    mutate(c,s=>s.mission.work.sources.push(s.mission.work.sources[0])),
    mutate(c,s=>s.mission.population=true),mutate(c,s=>s.mission.command='sh'),
  ])assert.throws(()=>validateAlphaInput({workSpec:changed.workSpec}));
  for(const raw of [c.workSpec.replace('"schema":','"schema":"duplicate","schema":'),c.workSpec.replace('"goal":','"population":20.0,"goal":'),c.workSpec.replace('"goal":','"population":2e1,"goal":'),'\ud800',' '.repeat(512001),c.workSpec.replace('"goal":','"population":NaN,"goal":')])assert.throws(()=>validateAlphaInput({workSpec:raw}));
});

test('Alpha malformed result, authority, exact spec, normalized mission, result and verification hashes fail closed',()=>{
  const c=cases[0],o=JSON.parse(c.alphaOutput);
  for(const [old,value,code] of [
    ['agialpha.fleet-work-result.v1','other','ALPHA_RESULT_SCHEMA'],
    ['computed-unreviewed; no wallet, approval or settlement authority','settlement-approved','ALPHA_AUTHORITY_DENIED'],
    [o.spec_hash,'0x'+'1'.repeat(64),'ALPHA_SPEC_HASH_MISMATCH'],
    [o.mission_hash,'1'.repeat(64),'ALPHA_MISSION_HASH_MISMATCH'],
    [o.result_hash,'2'.repeat(64),'ALPHA_RESULT_HASH_MISMATCH'],
    ['"passed":true','"passed":false','ALPHA_VERIFICATION_INVALID'],
  ])assert.throws(()=>validateAlphaOutput({workSpec:c.workSpec},{alphaOutput:c.alphaOutput.replace(old,value),alphaValidation:c.alphaValidation}),new RegExp(code));
  assert.throws(()=>validateAlphaOutput({workSpec:c.workSpec},{alphaOutput:c.alphaOutput,alphaValidation:c.alphaValidation,authority:'none'}),/FIELDS_INVALID/);
  assert.throws(()=>validateAlphaOutput({workSpec:c.workSpec},{alphaOutput:c.alphaOutput+' ',alphaValidation:c.alphaValidation}),/ALPHA_OUTPUT_ENCODING/);
  assert.throws(()=>validateAlphaOutput({workSpec:c.workSpec+' '},{alphaOutput:c.alphaOutput,alphaValidation:c.alphaValidation}),/ALPHA_SPEC_HASH_MISMATCH/);
});

test('Alpha validator is internal, exact-byte bound and cannot forge normalized defaults or signed zero',()=>{
  const c=cases[0],serialize=v=>canonical(v)+'\n';
  assert.throws(()=>validateAlphaInput({...task().input,alphaValidation:c.alphaValidation}),/FIELDS_INVALID/);
  assert.throws(()=>validateAlphaOutput({workSpec:c.workSpec},{alphaOutput:c.alphaOutput}),/FIELDS_INVALID/);
  for(const mutate of [m=>delete m.seed,m=>m.goal='Replaced mission',m=>m.work.sources[0].url='https://example.org/changed']){
    const v=JSON.parse(c.alphaValidation),m=JSON.parse(v.canonical_mission);mutate(m);v.canonical_mission=canonical(m);v.mission_hash=digest(v.canonical_mission);
    assert.throws(()=>validateAlphaSpecValidation({workSpec:c.workSpec},serialize(v)),/ALPHA_MISSION_NORMALIZATION_MISMATCH/);
  }
  const forecast=cases.find(c=>c.kind==='forecast'),v=JSON.parse(forecast.alphaValidation);
  v.canonical_mission=v.canonical_mission.replace('-0.0','0.0');v.mission_hash=digest(v.canonical_mission);
  assert.throws(()=>validateAlphaSpecValidation({workSpec:forecast.workSpec},serialize(v)),/ALPHA_MISSION_NORMALIZATION_MISMATCH/);
  const wrong=JSON.parse(c.alphaValidation);wrong.market='manager-usdc';assert.throws(()=>validateAlphaSpecValidation({workSpec:c.workSpec},serialize(wrong)),/ALPHA_VALIDATION_SCOPE/);
  const value=JSON.parse(c.alphaOutput),changed=c.alphaOutput.replace(value.spec_base64,Buffer.from(c.workSpec+' ').toString('base64'));
  assert.throws(()=>validateAlphaOutput({workSpec:c.workSpec},{alphaOutput:changed,alphaValidation:c.alphaValidation}),/ALPHA_SPEC_HASH_MISMATCH/);
});

test('Alpha synthetic execution uses the existing exact grant, reservation, receipt and no-replay boundaries',async()=>{
  const f=alphaFixture();try{
    const a=f.create(),p=f.runtime.issueClient(a.id).principal,g=f.prepare(a,task(),p);
    assert.equal(g.admission.qualification.hostProbe,'SYNTHETIC_OR_UNVERIFIED_PROBE');
    assert.equal(g.admission.binding.alpha.evidenceClass,'SYNTHETIC_OR_UNVERIFIED');
    assert.equal(g.admission.binding.alpha.sourceCommit,ALPHA_SOURCE_COMMIT);
    assert.equal(g.admission.binding.alpha.specSha256,'0x'+digest(task().input.workSpec));
    assert.equal(g.admission.binding.session,'synthetic-boot');assert.equal(g.limits.wallMs,15000);assert.equal(g.limits.cpuSeconds,10);
    assert.throws(()=>f.runtime.authorize({grant:g.grant,commitment:g.commitment,confirm:true},p),/CLIENT_SCOPE_DENIED/);
    f.authorize(g);const r=await f.run(a,g,p);assert.equal(r.state,'complete');assert.equal(r.receipt.result.files[0].content,cases[0].alphaOutput);
    assert.equal(r.receipt.authority,'none');assert.equal(r.receipt.independentReview,false);assert.match(r.receipt.observation.evidenceClass,/SYNTHETIC/);
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'consumed');
    await assert.rejects(f.run(a,g,p),/GRANT_UNAVAILABLE/);
  }finally{f.close();}
});

test('Alpha package, boot and source drift require fresh authorization before reservation',async()=>{
  for(const change of [h=>({...h,alphaRun:{...h.alphaRun,packageSha256:'synthetic-changed'}}),h=>({...h,bootId:'synthetic-new-boot'}),h=>({...h,alphaRun:{...h.alphaRun,supported:false,code:'ALPHA_PACKAGE_UNPROVISIONED'}})]){
    const f=alphaFixture();try{const a=f.create(),g=f.prepare(a,task());f.authorize(g);f.backend.inspect=()=>change(host());await assert.rejects(f.run(a,g),/CAPABILITY_DRIFT_REAUTHORIZE|ALPHA_PACKAGE_UNPROVISIONED/);assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'authorized');}finally{f.close();}
  }
  const f=alphaFixture();try{const a=f.create(),g=f.prepare(a,task());f.authorize(g);f.runtime.source='changed-source';await assert.rejects(f.run(a,g),/RUNTIME_REBIND_REQUIRED/);assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);}finally{f.close();}
});

test('Alpha invalid output consumes the reservation and sets durable STOP; no success receipt is saved',async()=>{
  const f=alphaFixture({execute:async()=>({result:{alphaOutput:cases[0].alphaOutput.replace('"passed":true','"passed":false'),alphaValidation:cases[0].alphaValidation},observation})});
  try{const a=f.create(),g=f.prepare(a,task());f.authorize(g);await assert.rejects(f.run(a,g),/ALPHA_VERIFICATION_INVALID/);assert.equal(f.runtime.store.meta('stopped'),true);assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'consumed');assert.equal(f.runtime.status(f.operator).runs[0].state,'uncertain');assert.throws(()=>f.prepare(a,task()),/STOP_RECONCILIATION_REQUIRED/);}finally{f.close();}
});

test('Alpha STOP aborts an active synthetic operation and preserves its consumed reservation',async()=>{
  const f=alphaFixture({execute:({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('RUN_CANCELLED'),{observation})),{once:true}))});
  try{const a=f.create(),g=f.prepare(a,task());f.authorize(g);const running=f.run(a,g);f.runtime.stop({actor:null},f.operator);await assert.rejects(running,/RUN_CANCELLED/);assert.equal(f.runtime.store.meta('stopped'),true);assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'consumed');}finally{f.close();}
});

test('Alpha cannot be assembled into the existing Manager SUCCESSOR market through a Node review',async()=>{
  const f=alphaFixture({execute:async({role,task:t})=>({result:t.action==='alpha-run'?{alphaOutput:cases[0].alphaOutput,alphaValidation:cases[0].alphaValidation}:await perform(role,t),observation})});
  try{
    const a=f.create(),n=f.create('node'),g=f.prepare(a,task());f.authorize(g);const run=await f.run(a,g);
    const original=successorTask(),artifacts=await perform('agent',original);
    const review={...original,action:'successor-check',review:'internal',sourceActor:a.id,sourceController:a.controller,input:{...original.input,files:artifacts.files}};
    const check=f.prepare(n,review);f.authorize(check);const checked=await f.run(n,check);
    await assert.rejects(f.runtime.dispatch('project-assemble',{project:null,execution:run.run,review:checked.run},f.operator),/PROJECT_MARKET_SCOPE/);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n,0);
  }finally{f.close();}
});

test('Alpha forecast normalization keeps signed floating zero but normalizes integer negative zero',()=>{
  const base=cases.find(c=>c.kind==='forecast'),value=JSON.parse(base.workSpec);
  value.mission.work.observations=Array(12).fill(0);
  const positive=JSON.stringify(value),integerNegative=positive.replace('"observations":[0','"observations":[-0'),floatNegative=positive.replace('"observations":[0','"observations":[-0.0');
  const parse=workSpec=>validateAlphaInput({workSpec}).normalizedMissionSemanticSha256;
  assert.equal(parse(positive),parse(integerNegative));assert.notEqual(parse(positive),parse(floatNegative));
  for(const limit of [1e16,1e20]){value.mission.work.observations[0]=limit;assert.throws(()=>validateAlphaInput({workSpec:JSON.stringify(value)}),/ALPHA_OBSERVATION_INVALID/);}
});

test('predictably oversized research, schedule and forecast outputs are refused before any grant or reservation',()=>{
  const inputs=[
    mutate(cases[0],s=>s.mission.work.sources=Array.from({length:8},(_,i)=>({id:'s'+i,title:'Escaped public fixture',text:'\\\n'.repeat(5000)}))),
    mutate(cases.find(c=>c.kind==='schedule'),s=>s.mission.work.jobs=Array.from({length:30},(_,i)=>({id:String(i).padStart(64,'j'),operations:Array.from({length:20},()=>({machine:'m'.repeat(64),duration:100000}))}))),
    mutate(cases.find(c=>c.kind==='forecast'),s=>s.mission.work={kind:'forecast',observations:Array(5000).fill(-1.234567890123456e14),holdout:1000,horizon:100}),
  ];
  const f=alphaFixture();try{
    const a=f.create();
    for(const c of inputs){
      assert.ok(Buffer.byteLength(c.workSpec)<512000);
      const report=f.runtime.admission({actor:a.id,task:task(c)},f.operator);
      assert.equal(report.status,'OUTSIDE_SCOPE');assert.equal(report.issues[0].code,'ALPHA_OUTPUT_BUDGET_EXCEEDED');
      assert.match(report.issues[0].help,/stricter subset/);assert.throws(()=>f.prepare(a,task(c)),/ALPHA_OUTPUT_BUDGET_EXCEEDED/);
    }
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,0);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);
  }finally{f.close();}
});

test('output budget includes exact whitespace/base64 expansion and refuses the first over-budget byte',()=>{
  const raw=cases[0].workSpec;let low=0,high=512000-Buffer.byteLength(raw);
  while(low<high){const middle=Math.ceil((low+high)/2);try{validateAlphaInput({workSpec:raw+' '.repeat(middle)});low=middle;}catch(e){assert.equal(e.code,'ALPHA_OUTPUT_BUDGET_EXCEEDED');high=middle-1;}}
  const last=validateAlphaInput({workSpec:raw+' '.repeat(low)});
  assert.ok(last.budget.wireBytes<=ALPHA_OUTPUT_BUDGET.wireBytes);assert.ok(last.budget.receiptBytes<=ALPHA_OUTPUT_BUDGET.receiptBytes);
  assert.throws(()=>validateAlphaInput({workSpec:raw+' '.repeat(low+1)}),/ALPHA_OUTPUT_BUDGET_EXCEEDED/);
});

test('output bounds include repeated research quotes, escaped Unicode metadata and every allocation Pareto individual',()=>{
  const small=validateAlphaInput({workSpec:cases[0].workSpec});
  const escaped=mutate(cases[0],s=>{s.mission.work.sources=[{id:'s',title:'🧪'.repeat(100),text:'"\\\n🧪'.repeat(200),url:'https://example.org/'+('a'.repeat(1000))}];});
  const larger=validateAlphaInput({workSpec:escaped.workSpec});assert.ok(larger.budget.wireBytes>small.budget.wireBytes);
  const source=cases.find(c=>c.kind==='allocation'),low=mutate(source,s=>s.mission.population=4),high=mutate(source,s=>s.mission.population=50);
  assert.ok(validateAlphaInput({workSpec:high.workSpec}).budget.wireBytes>validateAlphaInput({workSpec:low.workSpec}).budget.wireBytes);
  assert.equal(ALPHA_OUTPUT_BUDGET.wireBytes,480000);assert.equal(ALPHA_OUTPUT_BUDGET.receiptBytes,1900000);
});
