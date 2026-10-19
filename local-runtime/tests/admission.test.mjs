import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,task} from './helpers.mjs';
import {id,parseStrict,canonical,digest} from '../contracts.mjs';
import {defaultMission} from '../../fleet/successor/vendor/manager/site/assets/successor/missions.mjs';

test('read-only admission explains inactive actors and is scoped without creating authority',async()=>{
  const f=fixture();try{
    const a=f.runtime.addActor({role:'agent',name:'Preflight'},f.operator),b=f.runtime.addActor({role:'agent',name:'Other'},f.operator),p=f.runtime.issueClient(a.id).principal;
    const report=await f.runtime.dispatch('admission',{actor:a.id,task:task()},p);
    assert.equal(report.status,'MISSING_PREREQUISITE');assert.equal(report.issues[0].code,'ACTIVATION_REQUIRED');assert.equal(report.acceptedContract,null);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,0);assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);
    await assert.rejects(f.runtime.dispatch('admission',{actor:b.id,task:task()},p),/CLIENT_SCOPE_DENIED/);
  }finally{f.close();}
});

test('admission binds existing descriptors, exact inputs, offline route and honest evidence; grant and dispatch retain it',async()=>{
  const f=fixture();try{
    const a=f.create(),g=f.prepare(a),report=g.admission;
    assert.equal(report.status,'SUPPORTABLE');assert.equal(report.bindingSha256,digest(report.binding));assert.deepEqual(report.binding.tools.actions,['successor-run','alpha-run','alpha-computer-run']);
    assert.equal(report.binding.taskSha256,digest(task()));assert.equal(report.binding.provider.model,null);assert.equal(report.binding.review.independent,false);
    assert.equal(report.qualification.hostProbe,'SYNTHETIC_OR_UNVERIFIED_PROBE');assert.equal(report.qualification.liveObserved,'NOT_RUN');assert.equal(report.qualification.operationallyQualified,false);
    assert.equal(report.qualification.componentTested,'REQUIRES_EXACT_SOURCE_EVIDENCE');assert.equal(report.qualification.nativeTested,'REQUIRES_EXACT_SOURCE_EVIDENCE');assert.equal(report.qualification.independentlyReviewed,'NOT_VERIFIED');
    assert.equal(report.qualification.commerciallyMeasured,'NOT_RUN');assert.deepEqual(report.acceptedContract.deliverables,['report.html','result.json','method.json']);
    assert.match(report.acceptedContract.checks,/business acceptance are not evaluated/);assert.equal(report.acceptedContract.limits.modelCalls,0);
    f.authorize(g);await f.run(a,g);const run=f.runtime.status(f.operator).runs[0];assert.equal(run.value.admission.bindingSha256,report.bindingSha256);
    assert.equal(run.value.admission.checkedAt>=report.checkedAt,true);
  }finally{f.close();}
});

test('custom prompts, desktop, wrong roles and independent review are held before grant or budget',()=>{
  const f=fixture();try{
    const a=f.create(),custom=task();custom.input.mission=defaultMission('custom');
    assert.equal(f.runtime.admission({actor:a.id,task:custom},f.operator).status,'OUTSIDE_SCOPE');assert.throws(()=>f.prepare(a,custom),/RUNTIME_UNAVAILABLE/);
    const desktop={...task(),workspace:'desktop'},wrong={...task(),action:'protocol-inspect'};
    assert.equal(f.runtime.admission({actor:a.id,task:desktop},f.operator).issues[0].code,'WORKSPACE_NOT_QUALIFIED');
    assert.equal(f.runtime.admission({actor:a.id,task:wrong},f.operator).status,'OUTSIDE_SCOPE');
    const n=f.create('node'),review={...task(),action:'successor-check',review:'independent',sourceActor:id(),sourceController:id()};review.input.files=[];
    assert.equal(f.runtime.admission({actor:n.id,task:review},f.operator).issues[0].code,'INDEPENDENT_REVIEW_NOT_QUALIFIED');
    review.sourceController=n.controller;assert.equal(f.runtime.admission({actor:n.id,task:review},f.operator).issues[0].code,'KNOWN_REVIEW_CONFLICT');
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,0);assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);
  }finally{f.close();}
});

test('malformed tasks return a bounded refusal without a contract or durable mutation',()=>{
  const f=fixture();try{
    const a=f.create();for(const malformed of [null,[],{schema:'unknown'}, {...task(),extraAuthority:true}]){
      const r=f.runtime.admission({actor:a.id,task:malformed},f.operator);assert.equal(r.status,'OUTSIDE_SCOPE');assert.equal(r.acceptedContract,null);
    }
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,0);
  }finally{f.close();}
});

test('missing isolation has actionable prerequisite guidance; Mac and changed provider stay outside scope',()=>{
  const f=fixture();try{
    const a=f.create();f.backend.inspect=()=>({supported:false,backend:'linux-bwrap-offline/v1',code:'SANDBOX_PREREQUISITE_MISSING'});
    let r=f.runtime.admission({actor:a.id,task:task()},f.operator);assert.equal(r.status,'MISSING_PREREQUISITE');assert.match(r.issues[0].help,/bubblewrap\/prlimit/);
    f.backend.inspect=()=>({supported:true,identity:'synthetic-host',backend:'synthetic-boundary',platform:'darwin',arch:'arm64',productionQualified:true});
    r=f.runtime.admission({actor:a.id,task:task()},f.operator);assert.equal(r.status,'OUTSIDE_SCOPE');assert.equal(r.qualification.productionQualified,false);
    f.backend.inspect=()=>({supported:true,identity:'synthetic-host',backend:'synthetic-boundary',inference:'live-provider',network:'outbound'});
    r=f.runtime.admission({actor:a.id,task:task()},f.operator);assert.equal(r.status,'OUTSIDE_SCOPE');assert.equal(r.issues[0].code,'OFFLINE_CONFIGURATION_REQUIRED');
  }finally{f.close();}
});

test('capability facts are rechecked at authorization and dispatch before consuming grants or reserving work',async()=>{
  const f=fixture();try{
    const a=f.create(),g=f.prepare(a);const original=f.backend.inspect;
    f.backend.inspect=()=>({...original(),files:'different mounted inputs'});
    assert.throws(()=>f.authorize(g),/CAPABILITY_DRIFT_REAUTHORIZE/);assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'prepared');
    f.backend.inspect=original;f.authorize(g);f.backend.inspect=()=>({...original(),bootId:'new-session-with-same-identity'});
    await assert.rejects(f.run(a,g),/CAPABILITY_DRIFT_REAUTHORIZE/);assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'authorized');
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);
    f.backend.inspect=()=>({...original(),network:'outbound'});await assert.rejects(f.run(a,g),/OFFLINE_CONFIGURATION_REQUIRED/);
    assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);
  }finally{f.close();}
});

test('legacy grants cannot inherit admission and input substitution changes the commitment',()=>{
  const f=fixture();try{
    const a=f.create(),g=f.prepare(a),row=f.runtime.store.db.prepare('SELECT value FROM grants WHERE id=?').get(g.grant),saved=parseStrict(row.value);
    delete saved.admission;f.runtime.store.db.prepare('UPDATE grants SET value=? WHERE id=?').run(canonical(saved),g.grant);
    assert.throws(()=>f.authorize({...g,commitment:digest(saved)}),/ADMISSION_REPREPARE_REQUIRED/);
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'prepared');
    const fresh=f.prepare(a),changed=task();changed.input.mission.name='Different exact inputs';
    assert.notEqual(f.runtime.admission({actor:a.id,task:changed},f.operator).bindingSha256,fresh.admission.bindingSha256);
  }finally{f.close();}
});
