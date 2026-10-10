import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createComputeServer} from '../compute/server.mjs';
import {runtimeManifest,checkWorkRuntime} from '../compute/runtime.mjs';
import {readPublicWebQualification} from '../compute/public-web-qualified-runtime.mjs';
import {canonical,sha256} from '../src/util.mjs';
import {qualificationFixture} from './helpers/public-web-qualification-fixture.mjs';
import {harness} from './helpers/public-web-harness.mjs';
function installReceipt(h,receipt){const directory=path.join(h.c.profileDir,'public-web-qualification'),file=path.join(directory,'receipt.json');fs.mkdirSync(directory,{mode:0o700});fs.writeFileSync(file,JSON.stringify(receipt),{mode:0o600});const digest=sha256(canonical(receipt));Object.assign(h.c.publicWebPolicy,{mode:'qualified',qualificationReceiptFile:file,qualificationReceiptSha256:digest,qualificationEvidenceSha256:digest,qualificationCandidatePolicyHash:receipt.payload.candidatePolicyHash});}
test('a sealed qualified profile can prepare the fixed commissioning fixture for renewal without accepting a browser job',async()=>{const h=harness();try{h.c.publicWebPolicy.mode='qualified';const request=h.request();const prepared=await h.worker.preparePublicWeb(request);assert.equal(prepared.purpose,'commissioning');assert.equal(prepared.approvalPayload.runtimePolicyHash,h.c.policyHash);assert.equal(h.state.prepared,1);assert.throws(()=>h.worker.publicWeb.policy('accepted-job'));await h.worker.publicWeb.close(request.id);}finally{await h.close();}});
test('expired browser receipt leaves offline v1/v2 execution identity usable and stable while browser jobs fail closed',async()=>{const f=await qualificationFixture({now:Date.now()-7200000});try{const h=f.h,expected=runtimeManifest(h.c,'agent',{commissioning:true});installReceipt(h,f.receipt);const now=Date.now();h.setClock(now);assert.throws(()=>readPublicWebQualification(h.c,{now,identity:()=>f.options}),/STALE/);
 const runtime=runtimeManifest(h.c,'agent');assert.deepEqual(runtime,expected,'receipt time must not rewrite an accepted offline job runtime identity');
 const legacy=JSON.parse(fs.readFileSync(new URL('../examples/computer-smoke.json',import.meta.url)));assert.ok(checkWorkRuntime(h.worker,legacy,'agent').legacyOffline);
 const offline=structuredClone(h.plan.specification);offline.deadline=Math.floor(now/1000)+600;offline.publicWeb={agent:null,reviewer:null};offline.environment.capabilities={agent:['files'],reviewer:['files','independent-review']};offline.authority.agent.resources=['job-workspace'];offline.authority.reviewer.resources=['job-workspace'];offline.environment.runtimeSha256.agent=sha256(canonical(expected));assert.ok(checkWorkRuntime(h.worker,offline,'agent'));
 const web=structuredClone(h.plan.specification);web.deadline=offline.deadline;assert.throws(()=>checkWorkRuntime(h.worker,web,'agent'));assert.throws(()=>h.worker.publicWeb.policy('accepted-job'));
 }finally{await f.close();}});

test('qualified expired health preserves offline availability and renewal runtime hashes while withholding browser authority',async()=>{
 const f=await qualificationFixture({now:Date.now()-7200000}),h=f.h;installReceipt(h,f.receipt);h.setClock(Date.now());const server=createComputeServer(h.worker);
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});h.c.port=server.address().port;
  const response=await fetch('http://127.0.0.1:'+h.c.port+'/health',{headers:{Authorization:'Bearer '+h.c.token}}),health=await response.json();
  assert.equal(response.status,200);assert.ok(health.capabilities.includes('files'));assert.ok(!health.capabilities.includes('browser'));assert.equal(health.qualification.browser.status,'BLOCKED');
  const runtime=runtimeManifest(h.c,'agent');assert.deepEqual(health.runtime,runtime);assert.equal(health.publicWeb.runtimeSha256.agent,sha256(canonical(runtime)));assert.ok(health.publicWeb.candidateRuntime.agent.capabilities.includes('browser'));
 }finally{await new Promise(resolve=>server.close(resolve));await f.close();}
});
