import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Companion,COMPANION_DEFAULT} from '../src/control/companion.mjs';
import {publicWebReviewerFingerprint} from '../src/control/public-web-signing.mjs';

async function approve(c,policyHash){const h=await c.inspectComputeIdentity();return c.approveComputeIdentity({policyHash,proposalID:h.proposal.id,revision:h.proposal.revision,acknowledge:true});}
const role='node';
const key=()=>crypto.generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
function fixture(t){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-reviewer-pin-')),old=key(),next=key();let now=1800000000000,policyHash='a'.repeat(64),reviewerPublicKey=old.publicKey,fail=false;
 const c=new Companion(home,()=> 'a'.repeat(64),{now:()=>now,fetchImpl:async url=>url.endsWith('/health')?Response.json({policyCurrent:true,protocol:'agi-compute/v2',role,uid:(process.getuid?.()??0)+1001,auth:'chatgpt-oauth',policyHash,gatewayReady:true,configuredCapabilities:['desktop','files'],capabilities:['desktop','files'],publicWeb:{enabled:true,mode:'commissioning',reviewerPublicKey}}):fail?Response.json({error:'SYNTHETIC_PRIVATE_ERROR'},{status:503}):Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"status":"ready"}'}}]})});
 t.after(async()=>{await c.close();fs.rmSync(home,{recursive:true,force:true});});
 return {c,home,old,next,setup:()=>c.configure({...COMPANION_DEFAULT,enabled:true,acknowledged:true,mode:'workstation'}),advance(){now+=3600001;},set({hash=policyHash,reviewer=reviewerPublicKey,failure=fail}={}){policyHash=hash;reviewerPublicKey=reviewer;fail=failure;}};
}
test('reviewer key pins only after explicit successful identity approval and survives reload',async t=>{
 const h=fixture(t);await h.setup();const inspected=await h.c.inspectComputeIdentity();assert.equal(inspected.publicWeb.reviewerFingerprint,publicWebReviewerFingerprint(h.old.publicKey));assert.equal(inspected.boundPublicWebReviewerFingerprint,null);
 await h.c.request('test',{}, {cacheMs:0});assert.equal(h.c.state.publicWebReviewerPublicKey,undefined);h.advance();
 await approve(h.c,'a'.repeat(64));assert.equal(h.c.state.publicWebReviewerPublicKey,h.old.publicKey);assert.equal((await h.c.inspectComputeIdentity()).boundPublicWebReviewerFingerprint,publicWebReviewerFingerprint(h.old.publicKey));
 const restored=new Companion(h.home,()=>null);assert.equal(restored.stateError,undefined);assert.equal(restored.state.publicWebReviewerPublicKey,h.old.publicKey);await restored.close();
 h.advance();h.set({reviewer:h.next.publicKey});await h.c.request('test',{}, {cacheMs:0});assert.equal(h.c.state.publicWebReviewerPublicKey,h.old.publicKey,'ordinary test cannot rotate a reviewed key');
 h.advance();h.set({hash:'b'.repeat(64),failure:true});await assert.rejects(approve(h.c,'b'.repeat(64)),/COMPANION_UNAVAILABLE/);assert.equal(h.c.state.publicWebReviewerPublicKey,h.old.publicKey);
 h.advance();h.set({failure:false});await approve(h.c,'b'.repeat(64));assert.equal(h.c.state.publicWebReviewerPublicKey,h.next.publicKey);
 h.advance();h.set({hash:'c'.repeat(64),reviewer:null});await approve(h.c,'c'.repeat(64));assert.equal(h.c.state.publicWebReviewerPublicKey,null,'explicit removal clears obsolete independent authority');
 assert.equal(fs.readFileSync(h.c.stateFile,'utf8').includes('PRIVATE'),false);
});
test('cancellation preserves reviewed key even if changed identity health succeeded',async t=>{
 const h=fixture(t);await h.setup();await approve(h.c,'a'.repeat(64));h.advance();h.set({hash:'b'.repeat(64),reviewer:h.next.publicKey});const fetchHealth=h.c.fetch;let release;
 h.c.fetch=async(url,options)=>url.endsWith('/health')?fetchHealth(url,options):new Promise(resolve=>{release=()=>resolve(Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"status":"ready"}'}}]}));});
 const pending=approve(h.c,'b'.repeat(64));await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');const cancel=h.c.cancel();release();await assert.rejects(pending,/COMPANION_CANCELLED/);await cancel;assert.equal(h.c.state.computePolicy,'a'.repeat(64));assert.equal(h.c.state.publicWebReviewerPublicKey,h.old.publicKey);
});
test('state loading rejects private or non-Ed25519 reviewer keys',async t=>{
 const h=fixture(t);await h.setup();h.c.state.publicWebReviewerPublicKey=h.old.privateKey;h.c.persist();assert.equal(new Companion(h.home,()=>null).stateError,true);
 h.c.state.publicWebReviewerPublicKey=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1',publicKeyEncoding:{format:'pem',type:'spki'}}).publicKey;h.c.persist();assert.equal(new Companion(h.home,()=>null).stateError,true);
});
