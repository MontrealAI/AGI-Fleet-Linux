import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Companion,COMPANION_DEFAULT} from '../src/control/companion.mjs';
import {Controller} from '../src/control/controller.mjs';
import {Store} from '../src/store.mjs';

async function approve(c,policyHash){const h=await c.inspectComputeIdentity();return c.approveComputeIdentity({policyHash,proposalID:h.proposal.id,revision:h.proposal.revision,acknowledge:true});}
const role='agent';
const response=value=>Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-identity-'));let now=1800000000000,policyHash='a'.repeat(64),fail=false,calls=0;
 const c=new Companion(dir,()=> 'c'.repeat(64),{now:()=>now,fetchImpl:async (url,options)=>{
  if(url.endsWith('/health'))return Response.json({policyCurrent:true,protocol:'agi-compute/v2',role,uid:(process.getuid?.()??0)+1001,auth:'chatgpt-oauth',policyHash,gatewayReady:true,configuredCapabilities:['browser','desktop','files','computer-review'],capabilities:['desktop','files','computer-review'],qualification:{browser:{status:'BLOCKED',secret:'must not leak'},tools:{status:'NOT_TESTED'}}});
  calls++;return fail?Response.json({error:'fixture unavailable'},{status:503}):response(options.headers['x-agi-kind']==='brief'?{summary:'Synthetic fixture.',attention:'none'}:{status:'ready'});
 }});
 return {c,dir,async setup(){await c.configure({...COMPANION_DEFAULT,enabled:true,acknowledged:true,mode:'workstation'});},setHash(v){policyHash=v;},setFail(v){fail=v;},calls:()=>calls,advance(){now+=3600001;},async close(){await c.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('first compute identity binds only after successful inference; health and failures confer no authority',async()=>{
 const h=fixture();try{await h.setup();const inspected=await h.c.inspectComputeIdentity();assert.equal(inspected.boundPolicyHash,null);assert.equal(inspected.qualification.browser.status,'BLOCKED');assert.equal(inspected.qualification.browser.secret,undefined);assert.equal(h.calls(),0);h.setFail(true);await assert.rejects(h.c.request('test',{}, {cacheMs:0}));assert.equal(h.c.state.computePolicy,undefined);assert.equal(JSON.parse(fs.readFileSync(h.c.stateFile)).computePolicy,undefined);h.advance();h.setFail(false);await h.c.request('test',{}, {cacheMs:0});assert.equal(h.c.state.computePolicy,'a'.repeat(64));assert.equal(h.c.status().qualification.inference.status,'PASS');assert.equal(h.c.status().qualification.tools.status,'NOT_TESTED');assert.equal(h.c.status().qualification.browser.status,'BLOCKED');}finally{await h.close();}
});
test('changed identities require exact approval; failed approval preserves binding, quota, and history',async()=>{
 const h=fixture();try{await h.setup();await h.c.request('test',{}, {cacheMs:0});h.advance();h.setHash('b'.repeat(64));const priorCalls=h.calls();await assert.rejects(h.c.request('test',{}, {cacheMs:0}),/COMPUTE_POLICY_CHANGED/);assert.equal(h.calls(),priorCalls);assert.equal(h.c.state.computePolicy,'a'.repeat(64));h.advance();await assert.rejects(approve(h.c,'d'.repeat(64)),/APPROVAL_INVALID/);h.advance();h.setFail(true);await assert.rejects(approve(h.c,'b'.repeat(64)));assert.equal(h.c.state.computePolicy,'a'.repeat(64));h.advance();h.setFail(false);await approve(h.c,'b'.repeat(64));assert.equal(h.c.state.computePolicy,'b'.repeat(64));assert.equal(h.c.state.calls.length,4);assert.equal(h.c.state.cache.length,0);const restarted=new Companion(h.dir,()=> 'c'.repeat(64));assert.equal(restarted.state.computePolicy,'b'.repeat(64));assert.equal(restarted.state.calls.length,4);await restarted.close();}finally{await h.close();}
});
test('controller identity approval blocks accepted work, prepared work, reservations, and pending signing transactions',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-identity-guard-'));const store=new Store(dir,{lock:false});
 try{
  let stopped=true;const controller={requireStopped(){assert.ok(stopped,'STOP_BEFORE_CHANGING_SETTINGS');},vault:{unlocked:true},companion:{pending:null},dbRead:fn=>fn(store.db)};
  const guard=()=>Controller.prototype.requireComputeIdentityChangeReady.call(controller);
  guard();stopped=false;assert.throws(guard,/STOP_BEFORE/);stopped=true;
  store.db.prepare("INSERT INTO jobs(id,status) VALUES('one','reviewed')").run();assert.throws(guard,/ACTIVE_WORK_IDENTITY_LOCKED/);store.db.exec('DELETE FROM jobs');
  store.db.exec("CREATE TABLE admission_reservations(job TEXT,closed INTEGER); INSERT INTO admission_reservations VALUES('one',0)");assert.throws(guard,/ACTIVE_WORK_IDENTITY_LOCKED/);store.db.exec('UPDATE admission_reservations SET closed=1');guard();
  store.db.prepare("INSERT INTO txs(hash,raw,nonce,kind,bond,gas_budget,created,accounted,state) VALUES('synthetic','none',1,'test','0','0',1,1,'pending')").run();assert.throws(guard,/ACTIVE_WORK_IDENTITY_LOCKED/);store.db.exec("UPDATE txs SET state='confirmed'");guard();
  if(role==='agent'){store.db.prepare("INSERT INTO work(job,binding,spec_hash,spec,stage,updated) VALUES('one','fixture','fixture','{}','prepared',1)").run();assert.throws(guard,/ACTIVE_WORK_IDENTITY_LOCKED/);}
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('cached compute results cannot bypass identity drift or charge a second inference',async()=>{const h=fixture();try{await h.setup();await h.c.request('test',{}, {cacheMs:0});h.advance();await h.c.request('brief',{fixture:true});assert.equal((await h.c.request('brief',{fixture:true})).cached,true);const used=h.c.state.calls.length,inferences=h.calls();h.setHash('b'.repeat(64));await assert.rejects(h.c.request('brief',{fixture:true}),/COMPUTE_POLICY_CHANGED/);assert.equal(h.c.state.calls.length,used);assert.equal(h.calls(),inferences);assert.equal(h.c.state.computePolicy,'a'.repeat(64));}finally{await h.close();}});

test('cancelled initial inference cannot establish compute authority',async()=>{const h=fixture();try{await h.setup();const fetchHealth=h.c.fetch;let release;h.c.fetch=async(url,options)=>url.endsWith('/health')?fetchHealth(url,options):new Promise(resolve=>{release=()=>resolve(response({status:'ready'}));});const pending=h.c.request('test',{}, {cacheMs:0});await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');const cancelled=h.c.cancel();release();await assert.rejects(pending,/COMPANION_CANCELLED/);await cancelled;assert.equal(h.c.state.computePolicy,undefined);assert.equal(h.c.state.calls.length,1);assert.equal(JSON.parse(fs.readFileSync(h.c.stateFile)).computePolicy,undefined);}finally{await h.close();}});

test('known compute failures survive transport while arbitrary errors and secret-bearing logs stay redacted',async()=>{const h=fixture();try{await h.setup();const health=h.c.fetch,secret='SYNTHETIC_PRIVATE_CALLBACK_TOKEN';let failure={error:'COMPUTE_PUBLIC_WEB_NOT_QUALIFIED',detail:secret};h.c.fetch=async(url,options)=>url.endsWith('/health')?health(url,options):Response.json(failure,{status:503});await assert.rejects(h.c.request('test',{}, {cacheMs:0}),/COMPUTE_PUBLIC_WEB_NOT_QUALIFIED/);assert.equal(h.c.state.lastError,'COMPUTE_PUBLIC_WEB_NOT_QUALIFIED');assert.equal(fs.readFileSync(h.c.stateFile,'utf8').includes(secret),false);h.advance();failure={error:'COMPUTE_UNKNOWN_'+secret};await assert.rejects(h.c.request('test',{}, {cacheMs:0}),/COMPANION_UNAVAILABLE/);assert.equal(h.c.state.lastError,'COMPANION_UNAVAILABLE');h.advance();failure={error:'COMPUTE_DOCKER_REQUIRED',detail:secret.repeat(150)};await assert.rejects(h.c.request('test',{}, {cacheMs:0}),/COMPANION_UNAVAILABLE/);assert.equal(fs.readFileSync(h.c.stateFile,'utf8').includes(secret),false);assert.equal(h.c.state.computePolicy,undefined);}finally{await h.close();}});
