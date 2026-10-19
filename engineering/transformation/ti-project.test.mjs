// Actual pinned native objects/adapters; no policy-double positive payment.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {canonical} from '../../local-runtime/primitives.mjs';
import {createTIProject,appendTIProject,inspectTIProject,summaryHTML,createSummaryHandoff} from '../../local-runtime/transformation/project.mjs';
import {TIProjectStore} from '../../local-runtime/transformation/store.mjs';
import {openInstalledTI,nativeCLI} from '../../local-runtime/transformation/installed.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-ti-actual-'));
const sources=JSON.parse(fs.readFileSync(process.env.TI_INSTALLED_SOURCES,'utf8'));
const installed=await openInstalledTI(sources,path.join(root,'captured'));
const r=installed.receivers;
const raw=fs.readFileSync(path.join(installed.alphaRoot,'examples/transformational-intelligence/campaign.json'),'utf8');
const native=await r.native(raw),request=canonical(native.bindings.request);
// This is the immutable committed fixture selected by operator source pins,
// not a context accepted from a portable project import.
installed.trustRuntimeBinding(native.campaign_id,native.bindings_digest);
const checksum=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
const reseal=value=>{delete value.sha256;return canonical({...value,sha256:checksum(value)});};
test.after(()=>{installed.close();fs.rmSync(root,{recursive:true,force:true});});

async function completed() {
  const first=await createTIProject(request,r);
  return appendTIProject(first,'native-result',raw,r);
}
test('actual native campaign and both real currency receivers retain one inert project',async()=>{
  let project=await completed();
  for(const [kind,name] of [['manager-inspection','manager'],['jobs-inspection','jobs']]) {
    project=await appendTIProject(project,kind,canonical(await r[name](raw)),r);
  }
  const read=await inspectTIProject(project,r);
  assert.equal(read.project.projectId,native.campaign_id);
  assert.equal(read.project.revision,3);
  assert.deepEqual(read.summaries.slice(2).map(row=>[row.asset,row.decimals,row.paidProposal]),
    [['USDC',6,'refused-native-zero-allowance'],['AGIALPHA',18,'refused-native-zero-allowance']]);
  assert.equal(read.runAuthorized,false);assert.equal(read.independentReview,false);
  assert.equal(await appendTIProject(project,'jobs-inspection',canonical(await r.jobs(raw)),r),project);
  const offline=await inspectTIProject(project,{public:r.public,native:r.native});
  assert.equal(offline.summaries[2].inspection,'historical-unverified');
});
test('exact source summary is visible inert HTML and uses the real native handoff',async()=>{
  const html=await summaryHTML(raw,r.native);
  assert.ok(html.includes('Fixed summary / Résumé fixe'));
  for(const line of native.result.results.candidate[0].text.split('\n'))assert.ok(html.includes(line.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')));
  assert.equal(html.includes('<script'),false);
  const handoff=await createSummaryHandoff(raw,{inspectNative:r.native,...installed.project,...installed.computer});
  const read=await r.handoff(handoff);
  assert.equal(read.project.id,native.campaign_id);assert.deepEqual(read.handoff.task.allowed_urls,[]);
  const project=await appendTIProject(await completed(),'computer-handoff',handoff,r);
  assert.equal((await inspectTIProject(project,r)).summaries.at(-1).state,'requires-separate-native-permission');
  const changed=JSON.parse(handoff);changed.task.html='<h1>Different work</h1>';
  await assert.rejects(appendTIProject(await completed(),'computer-handoff',canonical(changed),r),/TI_PROJECT_BROWSER_ARTIFACT/);
});
test('private persistent history reopens and import is idempotent without grants',async()=>{
  const directory=path.join(root,'fleet-state');let store=new TIProjectStore(directory,r,{create:true});
  const first=await createTIProject(request,r),next=await completed();
  await store.save(first);await store.save(next,first);store.close();
  store=new TIProjectStore(directory,r);
  try {
    assert.equal(await store.get(native.campaign_id),next);assert.equal(await store.import(next),next);
    assert.equal(store.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,0);
    await assert.rejects(store.save(first,next),/TI_PROJECT_HISTORY_REWRITTEN/);
    const routed=await appendTIProject(next,'manager-inspection',canonical(await r.manager(raw)),r);
    await assert.rejects(store.save(routed,first),/TI_PROJECT_REVISION_CONFLICT/);
    const copies=await Promise.all([store.import(next),store.import(next)]);
    assert.deepEqual(copies,[next,next]);
  } finally {store.close();}
});
test('rehashed authority, route, request and evidence substitutions refuse',async()=>{
  const project=JSON.parse(await completed());
  for(const change of [v=>v.authority='approved',v=>v.qualification='production',v=>v.settlement='paid']) {
    const v=structuredClone(project);change(v);await assert.rejects(inspectTIProject(reseal(v),r),/TI_PROJECT_AUTHORITY/);
  }
  const v=structuredClone(project), changed=JSON.parse(v.history[0].raw);changed.charter.purpose='A substituted purpose';
  v.history[0].raw=canonical(changed);v.history[0].sha256=checksum(v.history[0].raw);
  await assert.rejects(inspectTIProject(reseal(v),r),/TI_PROJECT_NATIVE_BINDING/);
  const route=await r.manager(raw);route.asset='AGIALPHA';
  await assert.rejects(appendTIProject(await completed(),'manager-inspection',canonical(route),r),/TI_PROJECT_ROUTE_BINDING/);
  const source=JSON.parse(request);source.configuration.api_key='synthetic-secret-marker';
  await assert.rejects(createTIProject(canonical(source),r),/credential/i);
});
test('internally consistent new engine bindings cannot choose their own trusted route context',async()=>{
  const stale=structuredClone(native),previous=stale.bindings_digest;
  stale.bindings.engine_sha256='f'.repeat(64);
  const binding=checksum('successor-omega/v1:ti-bindings\0'+canonical(stale.bindings));
  const replace=value=>value===previous?binding:Array.isArray(value)?value.map(replace):value&&typeof value==='object'
    ?Object.fromEntries(Object.entries(value).map(([key,child])=>[key,replace(child)])):value;
  const changed=replace(stale);
  changed.transformation_digest=checksum('successor-omega/v1:ti-transformation\0'+canonical(changed.transformation));
  changed.freeze.manifest.package=changed.transformation;
  changed.freeze.digest=checksum('successor-omega/v1:ti-finalist-freeze\0'+canonical(changed.freeze.manifest));
  changed.result.freeze_digest=changed.freeze.digest;
  await r.native(canonical(changed));
  await assert.rejects(r.manager(canonical(changed)),/TRANSFORMATION_STALE_BINDINGS/);
  await assert.rejects(r.jobs(canonical(changed)),/TRANSFORMATION_STALE_BINDINGS/);
});
test('out-of-order and incomplete evidence cannot claim a later phase',async()=>{
  const first=await createTIProject(request,r);
  await assert.rejects(appendTIProject(first,'manager-inspection',canonical(await r.manager(raw)),r),/TI_PROJECT_COMPLETED_NATIVE_REQUIRED/);
  await assert.rejects(appendTIProject(await completed(),'computer-return','{}',r),/TI_PROJECT_HANDOFF_REQUIRED/);
  await assert.rejects(inspectTIProject('{"schema":0,"schema":1}',r),/DUPLICATE_KEY/);
  await assert.rejects(appendTIProject(first,'native-result',' '.repeat(12_000_001),r),/TI_PROJECT_CAPACITY/);
});
test('actual frozen native export can advance to completed without invented wire fields',async()=>{
  const frozen=structuredClone(native);frozen.phase='frozen';frozen.result=null;frozen.revision--;
  await r.native(canonical(frozen));
  let project=await createTIProject(request,r);
  project=await appendTIProject(project,'native-result',canonical(frozen),r);
  project=await appendTIProject(project,'native-update',raw,r);
  assert.equal((await inspectTIProject(project,r)).native.phase,'completed');
});
test('every parsed event is screened before any receiver or persistence',async()=>{
  for(const [field,value] of [['api_key','synthetic-peer-credential-marker'],['api%5fkey','synthetic-encoded-marker']]) {
    for(const where of ['conditions','review','activation']) {
      const entry={envelope:native,conditions:{evidence_scope:'local-structural-only'},behavior_digest:'a'.repeat(64),
        state:'pending-review',review:null,activation:null,retirement:null,authority_granted:false};
      entry[where]={[field]:value};
      if(where==='conditions')entry.conditions.evidence_scope='local-structural-only';
      entry.archive_digest=checksum('successor-omega/v1:ti-library-archive\0'+canonical({envelope:entry.envelope,
        conditions:entry.conditions,behavior_digest:entry.behavior_digest}));
      let invoked=false;
      await assert.rejects(appendTIProject(await completed(),'reuse-archive',canonical(entry),{...r,
        library:()=>{invoked=true;return entry;}}),/credential/i);
      assert.equal(invoked,false);
    }
  }
});
test('actual isolated native API adapter performs a fresh campaign in a distinct journal',async()=>{
  const output=path.join(root,'fresh-native.json'),home=path.join(root,'alpha-state');
  const result=nativeCLI(installed,process.env.TI_PYTHON,home,['successor-transform','demo','--output',output]);
  const freshRaw=fs.readFileSync(output,'utf8'),fresh=await r.native(freshRaw);
  assert.notEqual(fresh.campaign_id,native.campaign_id);assert.equal(result.campaign_id,fresh.campaign_id);
  let project=await createTIProject(canonical(fresh.bindings.request),r);
  project=await appendTIProject(project,'native-result',freshRaw,r);
  assert.equal((await inspectTIProject(project,r)).native.phase,'completed');
  const verify=nativeCLI(installed,process.env.TI_PYTHON,home,['verify']);
  assert.equal(verify.valid,true);
  const record=nativeCLI(installed,process.env.TI_PYTHON,home,['current-binding',fresh.campaign_id]);
  assert.equal(record.matches_retained,true);
  assert.equal(record.bindings_digest,fresh.bindings_digest);
  installed.trustRuntimeBinding(fresh.campaign_id,record.bindings_digest);
  for(const [kind,name] of [['manager-inspection','manager'],['jobs-inspection','jobs']])
    project=await appendTIProject(project,kind,canonical(await r[name](freshRaw)),r);
  const trust=path.join(root,'producer-trust.json'),conditions=path.join(root,'reuse-conditions.json'),archive=path.join(root,'archive.json');
  fs.writeFileSync(trust,canonical({schema_version:1,principals:{'ti-project-producer':{public_key:verify.identity.split(':').at(-1),
    roles:['producer'],provenance:'local',independence_attestation:''}}}),{mode:0o600});
  fs.writeFileSync(conditions,canonical({method_id:'public-summary-closure',version:1,producer:'ti-project-producer',
    supported_scope:['fixed-summary-public-source'],prerequisites:['audited-acyclic-annotations'],
    failure_conditions:['unreliable-annotations'],retirement_triggers:['code or source or instrument changes'],
    costs:{setup_units:fresh.result.costs.search_units,per_use_units:fresh.result.costs.execution_units},
    evidence_digests:[fresh.freeze.digest,checksum('successor-omega/v1:ti-library-result\0'+canonical(fresh.result))],
    evidence_scope:'local-structural-only'}),{mode:0o600});
  nativeCLI(installed,process.env.TI_PYTHON,home,['successor-library','--trust',trust,'--producer','ti-project-producer',
    '--output',archive,'archive',output,conditions,'--operation-id','project-archive']);
  project=await appendTIProject(project,'reuse-archive',fs.readFileSync(archive,'utf8'),r);
  assert.equal((await inspectTIProject(project,r)).archive.state,'pending-review');
  const cache=path.join(installed.alphaRoot,'alpha_factory_v1/__pycache__');fs.mkdirSync(cache);
  fs.writeFileSync(path.join(cache,'__init__.cpython-312.pyc'),'synthetic-cache-marker');
  try {assert.throws(()=>nativeCLI(installed,process.env.TI_PYTHON,home,['verify']),/TI_CAPTURE_EXTRA_SOURCE/);}
  finally {fs.rmSync(cache,{recursive:true});}
});
