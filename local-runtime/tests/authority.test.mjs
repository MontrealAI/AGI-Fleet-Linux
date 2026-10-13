import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture,task} from './helpers.mjs';
import {id,digest} from '../contracts.mjs';

test('fresh actors are inert; two instances receive distinct identities; original Fleet paths remain untouched',()=>{
  const f=fixture();try{const a=f.runtime.addActor({role:'agent',name:'First'},f.operator),b=f.runtime.addActor({role:'agent',name:'Second'},f.operator);assert.notEqual(a.id,b.id);assert.equal(a.active,false);assert.equal(a.host,null);assert.throws(()=>f.prepare(a),/ACTIVATION_REQUIRED/);}finally{f.close();}
});
test('exact grant, explicit authorization and one-use dispatch produce reopened real artifacts (synthetic OS boundary)',async()=>{
  const f=fixture();try{const a=f.create(),g=f.prepare(a);await assert.rejects(f.run(a,g),/GRANT_UNAVAILABLE/);assert.throws(()=>f.runtime.authorize({grant:g.grant,commitment:'bad',confirm:true},f.operator),/GRANT_CHANGED/);f.authorize(g);const r=await f.run(a,g);assert.equal(r.receipt.result.checker.passed,true);assert.equal(r.receipt.result.files.length,3);assert.equal(r.receipt.outputSha256,digest(r.receipt.result));const disk=fs.readdirSync(f.directory+'/runs');assert.equal(disk.length,1);await assert.rejects(f.run(a,g),/GRANT_UNAVAILABLE/);}finally{f.close();}
});
test('client actor scopes cannot authorize, cross-read, create actors or substitute a different client at dispatch',async()=>{
  const f=fixture();try{const a=f.create(),b=f.create(),c=f.runtime.issueClient(a.id).principal,g=f.prepare(a,task(),c);assert.throws(()=>f.runtime.authorize({grant:g.grant,commitment:g.commitment,confirm:true},c),/CLIENT_SCOPE_DENIED/);assert.throws(()=>f.runtime.addActor({role:'node',name:'Escalate'},c),/CLIENT_SCOPE_DENIED/);assert.throws(()=>f.prepare(b,task(),c),/CLIENT_SCOPE_DENIED/);f.authorize(g);await assert.rejects(f.run(a,g),/GRANT_PRINCIPAL/);assert.equal((await f.run(a,g,c)).state,'complete');}finally{f.close();}
});
test('expiry, role spoofing, unsupported desktop and public-input injection fail before reservation',async()=>{
  const f=fixture();try{const a=f.create(),g=f.prepare(a);f.advance(300001);assert.throws(()=>f.authorize(g),/GRANT_EXPIRED/);const forged=task();forged.action='protocol-inspect';assert.throws(()=>f.prepare(a,forged),/ROLE_ACTION_DENIED/);const desktop=task();desktop.workspace='desktop';assert.throws(()=>f.prepare(a,desktop),/WORKSPACE_NOT_QUALIFIED/);const unknown=task();unknown.allowHostShell=true;assert.throws(()=>f.prepare(a,unknown),/FIELDS_INVALID/);assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);}finally{f.close();}
});
test('known common control and unverified independence cannot become independent review',()=>{
  const f=fixture();try{const node=f.create('node'),t={...task(),action:'successor-check',review:'independent',sourceActor:id(),sourceController:node.controller};t.input.files=[];assert.throws(()=>f.prepare(node,t),/KNOWN_REVIEW_CONFLICT/);t.sourceController=id();assert.throws(()=>f.prepare(node,t),/INDEPENDENT_REVIEW_NOT_QUALIFIED/);}finally{f.close();}
});
test('atomic host and actor admission bounds survive concurrent calls',async()=>{
  const jobs=[];const f=fixture({execute:({task,role})=>new Promise(resolve=>jobs.push(()=>resolve({result:{files:[],authority:'none'},observation:{processGroupGone:true}})))});
  try{const a=f.create(),b=f.create(),c=f.create();const grants=[a,b,c].map(x=>{const g=f.prepare(x);f.authorize(g);return g;});const r1=f.run(a,grants[0]),r2=f.run(b,grants[1]);await assert.rejects(f.run(c,grants[2]),/QUEUE_CAPACITY/);jobs.splice(0).forEach(fn=>fn());await Promise.all([r1,r2]);const r3=f.run(c,grants[2]);jobs.splice(0).forEach(fn=>fn());await r3;assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,3);}finally{f.close();}
});
test('daily reservations persist and cannot reset by reactivation or replay',async()=>{
  const f=fixture();try{f.runtime.store.set('maxRuns',1);const a=f.create(),g=f.prepare(a);f.authorize(g);await f.run(a,g);f.runtime.activate({actor:a.id,confirm:true},f.operator);const second=f.prepare(a);f.authorize(second);await assert.rejects(f.run(a,second),/DAILY_BUDGET_EXHAUSTED/);assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,1);}finally{f.close();}
});
test('uncertain outcomes stop the host and cannot be replayed or silently resumed',async()=>{
  const f=fixture({execute:async()=>{throw Error('PROVIDER_FAILED');}});try{const a=f.create(),g=f.prepare(a);f.authorize(g);await assert.rejects(f.run(a,g),/PROVIDER_FAILED/);assert.equal(f.runtime.store.meta('stopped'),true);assert.equal(f.runtime.status(f.operator).runs[0].state,'uncertain');assert.throws(()=>f.runtime.resume({confirm:true},f.operator),/UNCERTAIN_RUN_RECONCILIATION_REQUIRED/);assert.throws(()=>f.prepare(a),/STOP_RECONCILIATION_REQUIRED/);}finally{f.close();}
});
test('an uncertain worker aborts peer work and revokes queued authority before recovery',async()=>{
  const started=[];const f=fixture({execute:({signal})=>new Promise((resolve,reject)=>{started.push({signal,reject});signal.addEventListener('abort',()=>reject(Error('RUN_CANCELLED')),{once:true});})});
  try{
    const actors=[f.create(),f.create(),f.create()],grants=actors.map(a=>{const g=f.prepare(a);f.authorize(g);return g;});
    const first=f.run(actors[0],grants[0]),second=f.run(actors[1],grants[1]),settled=Promise.allSettled([first,second]);
    started[0].reject(Error('WORKER_FAILED'));const results=await settled;
    assert.equal(results.every(r=>r.status==='rejected'),true);assert.equal(started[1].signal.aborted,true);assert.equal(f.runtime.active.size,0);
    assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(grants[2].grant).state,'revoked');
    assert.equal(f.runtime.status(f.operator).runs.every(r=>r.state==='uncertain'),true);assert.throws(()=>f.runtime.resume({confirm:true},f.operator),/UNCERTAIN_RUN_RECONCILIATION_REQUIRED/);
  }finally{f.close();}
});
test('STOP revokes outstanding authority; resume requires new activation and new grants',()=>{
  const f=fixture();try{const a=f.create(),g=f.prepare(a);f.authorize(g);f.runtime.stop({actor:null},f.operator);assert.throws(()=>f.prepare(a),/STOP_RECONCILIATION_REQUIRED/);f.runtime.resume({confirm:true},f.operator);assert.throws(()=>f.prepare(a),/ACTIVATION_REQUIRED/);assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'revoked');}finally{f.close();}
});
test('restart invalidates unused grants and quarantines an interrupted reservation',()=>{
  const f=fixture();try{const a=f.create(),g=f.prepare(a);f.authorize(g);f.runtime.store.db.prepare("INSERT INTO runs VALUES(?,?,?,'running',?,NULL)").run(id(),a.id,g.grant,JSON.stringify({reservedAt:Date.now()}));f.runtime.store.recover();assert.equal(f.runtime.store.meta('stopped'),true);assert.equal(f.runtime.status(f.operator).runs[0].state,'uncertain');assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'revoked');}finally{f.close();}
});
test('STOP still aborts active work and blocks new work when durable storage fails',()=>{
  const f=fixture();try{const a=f.create(),abort=new AbortController();f.runtime.active.set('synthetic-active',{actor:a.id,abort});const transaction=f.runtime.store.transaction;f.runtime.store.transaction=()=>{throw Error('SQLITE_FULL');};assert.throws(()=>f.runtime.stop({actor:null},f.operator),/SQLITE_FULL/);assert.equal(abort.signal.aborted,true);f.runtime.store.transaction=transaction;assert.throws(()=>f.prepare(a),/STOP_RECONCILIATION_REQUIRED/);f.runtime.active.clear();}finally{f.close();}
});
test('explicit grant and client revocations deny queued dispatch and future authentication',async()=>{
  const f=fixture();try{const a=f.create(),c=f.runtime.issueClient(a.id),g=f.prepare(a,task(),c.principal);f.authorize(g);f.runtime.revoke({grant:g.grant},f.operator);await assert.rejects(f.run(a,g,c.principal),/GRANT_UNAVAILABLE/);const next=f.prepare(a,task(),c.principal);f.authorize(next);f.runtime.revokeClient({client:c.principal.hash},f.operator);assert.throws(()=>f.runtime.authenticate(c.token),/AUTH_REQUIRED/);await assert.rejects(f.run(a,next,c.principal),/AUTH_REQUIRED/);}finally{f.close();}
});
