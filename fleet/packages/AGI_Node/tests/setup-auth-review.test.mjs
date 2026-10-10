import {statePreparationFixture,bindPreparedReviewFixture} from './state-preparation-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {runtimeDatabase} from './runtime-sqlite-fixture.mjs';
import {beginSetupTransaction,securityReview} from '../compute/setup-transaction.mjs';
import {canonical,sha256} from '../src/util.mjs';

const receipt=agent=>({agent,provider:'openai',order:['openai:agi-compute-pro'],storage:'openclaw-agent-sqlite',verified:true});
const review=authStaging=>securityReview({},{},{},{},{authStaging});
const preparedReview=authStaging=>securityReview({},{},{},{},{authStaging,statePreparation:statePreparationFixture()});

test('three verified SQLite auth-order receipts are secret-free and included in the review digest',()=>{
 const receipts=['agi-creator','agi-checker','agi-reviewer'].map(receipt),value=review(receipts);
 assert.equal(value.schema,'agi-setup-security-review/v1');assert.equal(value.secretsIncluded,false);assert.equal(value.authStaging.length,3);assert.equal(value.changes.length,3);assert.equal(value.digest,sha256(canonical(value.changes)));assert.notEqual(value.digest,review([]).digest);
 for(const item of receipts){const change=value.changes.find(entry=>entry.path==='authentication.'+item.agent);assert.equal(change.after,sha256(canonical(item)));assert.equal(change.values,'redacted');assert.equal(change.before,null);}
 assert.deepEqual(review([...receipts].reverse()),value);
 receipts[0].order[0]='secret-after-return';assert.equal(value.authStaging.find(item=>item.agent==='agi-creator').order[0],'openai:agi-compute-pro');assert.equal(JSON.stringify(value).includes('secret-after-return'),false);
});

test('a changed verified role set changes the approval digest',()=>{
 assert.notEqual(review([receipt('agi-checker')]).digest,review([receipt('agi-reviewer')]).digest);
 assert.notEqual(review([receipt('agi-checker')]).digest,review([receipt('agi-checker'),receipt('agi-reviewer')]).digest);
});

test('review rejects unknown, unverified, duplicate and credential-bearing auth receipts',()=>{
 const valid=receipt('agi-creator');
 const invalid=[null,{},'not-an-array',[null],[{}],[{...valid,verified:false}],[{...valid,storage:'manual-sqlite-edit'}],[{...valid,agent:'other-agent'}],[{...valid,provider:'other-provider'}],[{...valid,order:['unapproved-profile']}],[{...valid,order:['openai:agi-compute-pro','fallback']}],[{...valid,credential:'PRIVATE-CANARY'}],[{...valid,token:'PRIVATE-CANARY'}],[{...valid,profile:'PRIVATE-CANARY'}],[valid,valid],[valid,receipt('agi-checker'),receipt('agi-reviewer'),valid]];
 for(const value of invalid)assert.throws(()=>review(value),error=>error.message==='SETUP_AUTH_STAGING_REVIEW_INVALID'&&!error.message.includes('PRIVATE-CANARY'));
});

test('candidate SQLite auth-order changes after approval prevent publication despite unchanged public receipt',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-auth-review-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const profileDir=path.join(root,'live'),directory=path.join(root,'transaction');fs.mkdirSync(profileDir);fs.writeFileSync(path.join(profileDir,'openclaw.json'),'{}');
 const tx=await beginSetupTransaction({profileDir,directory,stop:async()=>{}}),{file:dbFile,db}=runtimeDatabase(tx.candidate,'agent','agi-creator');
 
 const value=preparedReview([receipt('agi-creator')]);Object.assign(value,bindPreparedReviewFixture(tx,value));tx.approve(value);db.prepare('UPDATE auth_profile_state SET state_json=?').run(JSON.stringify({version:1,order:{openai:['unauthorized-profile']}}));db.close();
 await assert.rejects(tx.publish({review:value,validate:()=>assert.fail('must reject before validation'),seal:()=>assert.fail('must reject before seal')}),/SETUP_REVIEW_STALE/);
 assert.equal(fs.readFileSync(path.join(profileDir,'openclaw.json'),'utf8'),'{}');assert.equal(fs.existsSync(path.join(profileDir,'agents/agi-creator/agent/openclaw-agent.sqlite')),false);
});

for(const change of ['sqlite-order','configuration'])test(`${change} changed while operator approval is pending cannot be silently approved`,async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-pending-auth-review-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const profileDir=path.join(root,'live'),directory=path.join(root,'transaction');fs.mkdirSync(profileDir);fs.writeFileSync(path.join(profileDir,'openclaw.json'),'{}');
 const tx=await beginSetupTransaction({profileDir,directory,stop:async()=>{}}),{file:dbFile,db}=runtimeDatabase(tx.candidate,'agent','agi-creator');
 db.close();
 const unbound=preparedReview([receipt('agi-creator')]),originalReview=structuredClone(unbound),bound=bindPreparedReviewFixture(tx,unbound),record=fs.readFileSync(tx.file);
 assert.deepEqual(unbound,originalReview);assert.equal(bound.candidateIdentity,tx.identity(tx.candidate));assert.notEqual(bound.digest,unbound.digest);
 // This awaited callback models the gap between presenting security-review.json
 // and receiving APPROVE; the write is a real committed SQLite transaction.
 await new Promise(resolve=>setImmediate(()=>{
  if(change==='sqlite-order'){const writer=new DatabaseSync(dbFile);writer.prepare('UPDATE auth_profile_state SET state_json=?').run(JSON.stringify({version:1,order:{openai:['changed-after-review']}}));writer.close();}
  else fs.writeFileSync(path.join(tx.candidate,'openclaw.json'),'{"gateway":{"bind":"all"}}');
  resolve();
 }));
 assert.throws(()=>tx.approve(bound),/SETUP_REVIEW_STALE/);assert.deepEqual(fs.readFileSync(tx.file),record);assert.equal(tx.state.state,'prepared');assert.equal(tx.state.approval,null);assert.equal(fs.readFileSync(path.join(profileDir,'openclaw.json'),'utf8'),'{}');assert.equal(fs.existsSync(path.join(profileDir,'agents/agi-creator/agent/openclaw-agent.sqlite')),false);
});

test('protocol2 refuses unbound approval and tampered review identity, changes or auth receipts',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-bound-review-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const tx=await beginSetupTransaction({profileDir:path.join(root,'live'),directory:path.join(root,'transaction'),stop:async()=>{}});
 runtimeDatabase(tx.candidate,'agent','agi-creator').db.close();const unbound=preparedReview([receipt('agi-creator')]),bound=bindPreparedReviewFixture(tx,unbound);
 assert.throws(()=>tx.approve(unbound),/SETUP_REVIEW_REQUIRED/);
 for(const mutate of [value=>value.candidateIdentity='a'.repeat(64),value=>value.changes[0].after='b'.repeat(64),value=>value.authStaging[0].agent='agi-reviewer',value=>value.digest='c'.repeat(64)]){
  const modified=structuredClone(bound);mutate(modified);assert.throws(()=>tx.approve(modified),/SETUP_REVIEW_STALE/);assert.equal(tx.state.approval,null);
 }
 tx.approve(bound);assert.equal(tx.state.approvedIdentity,bound.candidateIdentity);assert.equal(tx.state.approval,bound.digest);
});
