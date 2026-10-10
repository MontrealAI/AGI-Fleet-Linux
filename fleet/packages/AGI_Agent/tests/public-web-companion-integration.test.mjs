import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {harness} from './helpers/public-web-harness.mjs';
import {verifyPublicWebCommissioningEvidence} from '../compute/public-web-evidence.mjs';
import {createComputeServer} from '../compute/server.mjs';
import {Companion,COMPANION_DEFAULT} from '../src/control/companion.mjs';
const role='agent';
test('actual local HTTP Companion to Compute commissioning handshake retains scope, one charge, and blocked production status',async()=>{
 const h=harness({role}),home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-web-http-signer-'));
 // Identity metadata is a synthetic fixture; this test is not OS account-isolation qualification.
 const realUID=process.getuid;let server;
 try{process.getuid=()=>((realUID?.()??0)+1001);server=createComputeServer(h.worker);}finally{process.getuid=realUID;}
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));h.c.port=server.address().port;
 const authority={schema:'agi-public-web-authority/v1',privateKey:h.keys.privateKey.export({format:'pem',type:'pkcs8'}),publicKey:h.keys.publicKey.export({format:'pem',type:'spki'})},companion=new Companion(home,()=>h.c.token,{now:h.clock,publicWebAuthority:()=>authority});
 try{
  await companion.configure({...COMPANION_DEFAULT,enabled:true,acknowledged:true,mode:'workstation',port:h.c.port});companion.state.computePolicy=h.c.policyHash;
  const health=await companion.inspectComputeIdentity();assert.equal(health.qualification.browser.status,'BLOCKED');assert.equal(health.capabilities.includes('browser'),false);const r=h.request();assert.equal(health.publicWeb.runtimeSha256[r.executionAdmission.role],r.executionAdmission.runtimeSha256);
  const answer=await companion.request(r.kind,r.input,{cacheMs:0,executionAdmission:r.executionAdmission,purpose:'commissioning',allowPublicWebCommissioning:true,commissioningFixture:r.commissioningFixture});
  assert.equal(role==='agent'?answer.status:answer.checks[0].status,role==='agent'?'complete':'pass');
  assert.equal(companion.state.calls.length,1);assert.equal(h.worker.state.calls.length,1);assert.equal(h.worker.state.requests[0].status,'complete');assert.equal(h.state.prepared,1);assert.equal(h.state.activated,1);assert.equal(h.state.cleaned,1);assert.equal(h.state.sessionsClosed,1);assert.equal(h.worker.publicWeb.entries.size,0);
  const observed=await companion.readPublicWebEvidence(answer.requestID);const evidence=verifyPublicWebCommissioningEvidence(observed,{requestID:answer.requestID,executionAdmission:r.executionAdmission,policyHash:h.c.policyHash,operatorPublicKey:authority.publicKey});assert.equal(evidence.status,'BLOCKED');assert.equal(evidence.actualBrowserInteraction,false);
  const projected=await companion.readPublicWebEvidence(answer.requestID,{includeQualification:true});assert.equal(projected.qualificationStatus.status,'BLOCKED');assert.equal(projected.qualificationStatus.code,'PUBLIC_WEB_QUALIFICATION_REVIEWER_REQUIRED');assert.equal(projected.qualification,null);
  const after=await companion.inspectComputeIdentity();assert.equal(after.qualification.browser.status,'BLOCKED');assert.equal(after.capabilities.includes('browser'),false);
 }finally{await companion.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await h.close();fs.rmSync(home,{recursive:true,force:true});}
});

test('actual local HTTP cancellation waits for late allocation and retains both charged allowances',async t=>{
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
 const allocation=deferred(),entered=deferred(),cleanupRequested=deferred();let spec,signatures=0,inference=0;
 const h=harness({role,dependencies:{prepare:async value=>{spec=value;h.state.prepared++;entered.resolve();return allocation.promise;}}}),home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-web-http-cancel-'));
 // UID metadata and allocated resources are synthetic fixtures, not real OS, browser, or provider qualification.
 const realUID=process.getuid;let server;
 try{process.getuid=()=>((realUID?.()??0)+1001);server=createComputeServer(h.worker);}finally{process.getuid=realUID;}
 server.on('request',req=>{if(req.method==='DELETE'&&req.url.startsWith('/v1/public-web/requests/'))cleanupRequested.resolve(req.url.split('/').at(-1));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));h.c.port=server.address().port;
 const authority={schema:'agi-public-web-authority/v1',privateKey:h.keys.privateKey.export({format:'pem',type:'pkcs8'}),publicKey:h.keys.publicKey.export({format:'pem',type:'spki'})},companion=new Companion(home,()=>h.c.token,{now:h.clock,publicWebAuthority:()=>authority});
 t.mock.method(crypto,'sign',()=>{signatures++;throw Error('Unexpected grant signing after cancellation');});
 h.worker.chat=async()=>{inference++;throw Error('Unexpected inference after cancellation');};
 let running,cancelled,allocated;
 try{
  await companion.configure({...COMPANION_DEFAULT,enabled:true,acknowledged:true,mode:'workstation',port:h.c.port});companion.state.computePolicy=h.c.policyHash;
  const identity=companion.state.computePolicy,r=h.request();
  running=companion.request(r.kind,r.input,{cacheMs:0,executionAdmission:r.executionAdmission,purpose:'commissioning',allowPublicWebCommissioning:true,commissioningFixture:r.commissioningFixture});
  const rejected=assert.rejects(running,/COMPANION_CANCELLED/);
  await entered.promise;
  assert.equal(companion.state.calls.length,1);assert.equal(h.worker.state.calls.length,1);
  cancelled=companion.cancel();const requestID=await cleanupRequested.promise;
  assert.equal(h.worker.state.requests[0].id,requestID);assert.equal(h.worker.publicWeb.entries.size,1);assert.ok(h.worker.publicWeb.entries.get(requestID).closing);assert.ok(companion.pending);assert.equal(h.state.cleaned,0);
  allocated=h.resource(spec);allocation.resolve(allocated);await cancelled;await rejected;
  assert.equal(signatures,0);assert.equal(inference,0);assert.equal(h.state.activated,0);assert.equal(h.state.commands.length,0);assert.equal(h.state.sessionsClosed,0);
  assert.equal(h.state.prepared,1);assert.equal(h.state.cleaned,1);assert.equal(h.worker.publicWeb.entries.size,0);assert.equal(h.worker.busy,false);
  assert.equal(companion.state.calls.length,1);assert.equal(h.worker.state.calls.length,1);assert.equal(h.worker.state.requests.length,1);assert.notEqual(h.worker.state.requests[0].status,'complete');assert.equal(h.worker.state.requests[0].publicWeb.cleanup,'PASS');
  assert.equal(companion.pending,null);assert.equal(companion.abort,null);assert.equal(companion.state.lastError,'COMPANION_CANCELLED');assert.equal(companion.state.computePolicy,identity);assert.equal(h.c.policyHash,identity);
  assert.equal(JSON.parse(fs.readFileSync(companion.stateFile)).calls.length,1);
  assert.equal(JSON.parse(fs.readFileSync(h.worker.stateFile)).calls.length,1);
  const evidence=JSON.parse(fs.readFileSync(path.join(h.c.profileDir,'public-web-sessions',requestID,'browser-observation.json')));
  assert.equal(evidence.grant,null);assert.equal(evidence.events.length,0);assert.equal(evidence.cleanup.status,'PASS');
 }finally{
  if(!allocated)allocation.resolve(spec?h.resource(spec):null);
  await running?.catch(()=>{});await cancelled?.catch(()=>{});await companion.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await h.close();fs.rmSync(home,{recursive:true,force:true});
 }
});
