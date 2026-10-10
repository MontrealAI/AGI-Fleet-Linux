import qualified from '../src/admission-core/economics/qualification-fixture.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {Admission} from '../src/admission.mjs';
import core from '../src/admission-core/economics/admission.cjs';
import {ReviewerTimeLedger} from '../workforce/review-time.mjs';
const {canonical,digest}=core;
const sample=JSON.parse(fs.readFileSync(new URL('./admission-fixture.json',import.meta.url)));
const clone=x=>JSON.parse(JSON.stringify(x));
const addr=n=>'0x'+n.toString(16).padStart(40,'0');
const now=Math.floor(Date.now()/1000);
// Synthetic unit fixtures exercise the observed-only branch; these are not measurements.
function fixture() {
 const x=qualified.qualificationFixture({measurementKind:'observed',reviewPayment:'operator-budget'});
 x.policy.chainId=1;x.policy.maxPreparationAttempts=4;x.envelope.payload.jobId='1';
 x.observed.chainId=1;x.observed.jobId='1';x.resign();return x;
}

function setup({reviewStart=now-60,reviewFinish=now+3600}={}) {
 const x=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-admission-')),store=new Store(dir);
 const report=Buffer.from(x.evidenceReport);
 x.policy.role='reviewer';x.policy.wallet=addr(3);x.envelope.payload.participantId='reviewer1';x.envelope.payload.commitment={action:'vote',decision:'approve',completionURI:'ipfs://delivery',deliverySha256:digest('delivery')};
 x.envelope.payload.evidence.reportSha256=crypto.createHash('sha256').update(report).digest('hex');x.resign();
 fs.mkdirSync(path.join(dir,'admission','inbox'),{recursive:true});fs.mkdirSync(path.join(dir,'admission','evidence'));
 const packetFile=path.join(dir,'admission','inbox','1.json');fs.writeFileSync(packetFile,JSON.stringify(x.envelope));fs.writeFileSync(path.join(dir,'admission','evidence',x.envelope.payload.evidence.reportSha256+'.json'),report);
 store.set('admissionPolicy',x.policy);
 if(x.policy.role==='reviewer')store.putJob('1',{review:JSON.stringify({specHash:x.observed.specSha256,decision:'approve',completionURI:'ipfs://delivery',deliveryHash:digest('delivery')})});
 const c={chainId:1,validator:x.policy.wallet,manager:x.policy.manager,dataDir:dir,confirmations:12,limits:{maxTxETH:'0.0001'}};
 const state={block:{timestamp:now},specURI:x.observed.specURI,employer:addr(1),assignedAgent:addr(0),completionURI:'ipfs://delivery',completed:false,expired:false,pendingUSDC:'0',terms:x.observed.terms};
 const reviewers=x.envelope.payload.lifecycle.participants.filter(a=>a.role==='reviewer').map((a,i)=>({participantId:a.id,wallet:x.envelope.payload.identities[a.id].wallet,controllerId:x.envelope.payload.identities[a.id].controllerId,failureDomain:'domain-'+i,keys:crypto.generateKeyPairSync('ed25519')}));
 const timePolicy={schema:'agi-review-time-policy/v1',chainId:1,manager:c.manager,employer:state.employer,fundingPolicySha256:digest('funding'),minimumReviewers:3,agentSeconds:60,reviewSeconds:300,challengeSeconds:60,reserveSeconds:60,reviewers:reviewers.map(({keys,...r})=>({...r,publicKey:keys.publicKey.export({format:'pem',type:'spki'})}))};
 store.set('reviewTimePolicy',timePolicy);
 const ledger=new ReviewerTimeLedger(store,timePolicy,{time:()=>now-600});
 const receipt=ledger.issue({offerId:digest('node offer'),specSha256:x.observed.specSha256,fundingPolicySha256:timePolicy.fundingPolicySha256,chainId:1,manager:c.manager,employer:state.employer,reviewerWallet:c.validator,participantId:'reviewer1',controllerId:timePolicy.reviewers[0].controllerId,failureDomain:'domain-0',start:reviewStart,finish:reviewFinish,deadline:now+7200,validUntil:now-100},reviewers[0].keys.privateKey,c.validator);
 ledger.bind(receipt.body.offerId,'1');
 const reviewSnapshot={buyer:state.employer,specURI:state.specURI,completed:false,expired:false,disputed:false,requested:true,reviewEnd:BigInt(now+7200)};
 const gate=new Admission(c,{provider:{getBalance:async()=>10n**18n},snapshot:async()=>reviewSnapshot},store,{readState:async()=>state});
 return {...x,dir,store,gate,state,reviewSnapshot,timePolicy,packetFile,close(){this.store.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('review work requires an independently booked job window, including after restart',async()=>{const x=setup();try{
 x.store.db.prepare("UPDATE reviewer_time_bookings SET job='2'").run();await assert.rejects(x.gate.check('1',x.observed.specSha256),/REVIEW_TIME_UNBOOKED_JOB/);
 x.store.db.prepare("UPDATE reviewer_time_bookings SET job='1'").run();x.reviewSnapshot.reviewEnd=BigInt(now+60);await assert.rejects(x.gate.check('1',x.observed.specSha256),/REVIEW_TIME_JOB_WINDOW/);
 x.reviewSnapshot.reviewEnd=BigInt(now+7200);await x.gate.check('1',x.observed.specSha256);
 x.store.set('reviewTimePolicy',null);assert.throws(()=>x.gate.assertCurrent({kind:'vote',job:'1',decision:'approve',bond:'1'}),/REVIEW_TIME_POLICY_CHANGED/);
 await x.gate.beforeCommit({kind:'claim',job:'1'});
}finally{x.close();}});
test('native-USDC admission is fail closed without policy, packet or verified spec',async()=>{const x=setup();try{x.store.set('admissionPolicy',null);await assert.rejects(x.gate.check('1',x.observed.specSha256),/POLICY_REQUIRED/);x.store.set('admissionPolicy',x.policy);x.store.putJob('1',{review:null});await assert.rejects(x.gate.check('1'),/SPEC_NOT_VERIFIED/);fs.unlinkSync(x.packetFile);await assert.rejects(x.gate.check('1',x.observed.specSha256),/ADMISSION_DENIED/);}finally{x.close();}});
test('reservations are idempotent and survive a reopened SQLite journal',async()=>{const x=setup();try{await x.gate.check('1',x.observed.specSha256);await x.gate.check('1',x.observed.specSha256);const row=x.store.db.prepare('SELECT * FROM admission_reservations').get();assert.equal(row.cost,'4000000');assert.equal(row.exposure,'154000000');x.store.close();x.store=new Store(x.dir);assert.equal(x.store.db.prepare('SELECT COUNT(*) AS n FROM admission_reservations').get().n,1);}finally{x.close();}});
test('unpaid claims and corrupt evidence block new work without altering recoverable obligations',async()=>{const x=setup();try{x.state.pendingUSDC='1';await assert.rejects(x.gate.check('1',x.observed.specSha256),/UNPAID_CLAIMS/);x.state.pendingUSDC='0';const evidence=path.join(x.dir,'admission','evidence',x.envelope.payload.evidence.reportSha256+'.json');fs.writeFileSync(evidence,'changed');await assert.rejects(x.gate.check('1',x.observed.specSha256),/REPORT_CHANGED/);}finally{x.close();}});
test('admission gating never blocks claim, completion, finalization or allowance revocation',async()=>{const x=setup();try{x.store.set('admissionPolicy',null);for(const kind of ['claim','submit','finalize'])await x.gate.beforeCommit({kind,job:'1'});await x.gate.beforeCommit({kind:'approve',job:'1',bond:'0'});for(const kind of ['apply','vote'])await assert.rejects(x.gate.beforeCommit({kind,job:'1',bond:'1'}),/POLICY_REQUIRED/);}finally{x.close();}});
test('a changed snapshot or insufficient gas reserve cannot pass the gate',async()=>{const x=setup();try{x.state.terms.slashBps=9000;await assert.rejects(x.gate.check('1',x.observed.specSha256),/ECONOMIC_TERMS/);x.state.terms.slashBps=8000;await assert.rejects(x.gate.check('1',x.observed.specSha256,{gasBudget:1000000000000000n}),/JOB_GAS_BUDGET/);}finally{x.close();}});

test('concurrent candidates cannot both consume the same remaining allocation',async()=>{const x=setup();try{x.policy.maxOpenExposureUSDC=x.policy.role==='agent'?'100':'200';x.store.set('admissionPolicy',x.policy);x.resign();fs.writeFileSync(x.packetFile,JSON.stringify(x.envelope));x.envelope.payload.jobId='2';x.resign();fs.writeFileSync(path.join(x.dir,'admission','inbox','2.json'),JSON.stringify(x.envelope));const r=await Promise.allSettled([x.gate.check('1',x.observed.specSha256),x.gate.check('2',x.observed.specSha256)]);assert.equal(r.filter(v=>v.status==='fulfilled').length,1);assert.equal(x.store.db.prepare('SELECT COUNT(*) AS n FROM admission_reservations').get().n,1);}finally{x.close();}});
test('final signing seal detects policy or packet changes after awaited checks',async()=>{const x=setup();try{await x.gate.check('1',x.observed.specSha256);const scope={kind:x.policy.role==='agent'?'apply':'vote',job:'1',bond:'1',decision:'approve'};x.gate.assertCurrent(scope);fs.appendFileSync(x.packetFile,' ');assert.throws(()=>x.gate.assertCurrent(scope),/AUTHORITY_CHANGED/);}finally{x.close();}});
test('aggregate native gas reservation requires funded recovery headroom',async()=>{const x=setup();try{x.gate.chain.provider.getBalance=async()=>0n;await assert.rejects(x.gate.check('1',x.observed.specSha256),/AGGREGATE_ETH_RESERVE/);assert.equal(x.store.db.prepare('SELECT COUNT(*) AS n FROM admission_reservations').get().n,0);}finally{x.close();}});

test('preparation attempts survive packet renewal and restart and exhaust without refund',async()=>{const x=setup();try{await x.gate.check('1',x.observed.specSha256);for(let n=0;n<4;n++)x.gate.consumePreparation('1');assert.throws(()=>x.gate.consumePreparation('1'),/ATTEMPTS_EXHAUSTED/);x.resign();fs.writeFileSync(x.packetFile,JSON.stringify(x.envelope));await x.gate.check('1',x.observed.specSha256);assert.throws(()=>x.gate.consumePreparation('1'),/ATTEMPTS_EXHAUSTED/);x.store.close();x.store=new Store(x.dir);assert.equal(x.store.db.prepare('SELECT attempts FROM admission_attempts').get().attempts,4);}finally{x.close();}});
test('receipt-based cancellation release works without any valid admission policy',async()=>{const x=setup();try{await x.gate.check('1',x.observed.specSha256);x.store.set('admissionPolicy',null);x.store.set('admissionTerminal:1',{transactionHash:'0x'+'a'.repeat(64)});x.gate.readClosure=async()=>({pendingUSDC:'1'});await x.gate.reconcile();assert.equal(x.store.db.prepare('SELECT closed FROM admission_reservations').get().closed,0);x.gate.readClosure=async()=>({pendingUSDC:'0',event:'JobCancelled'});await x.gate.reconcile();const row=x.store.db.prepare('SELECT closed,cost FROM admission_reservations').get();assert.equal(row.closed,1);assert.ok(BigInt(row.cost)>0n);}finally{x.close();}});
test('invalid closure proof and pending transaction retain the reservation',async()=>{const x=setup();try{await x.gate.check('1',x.observed.specSha256);x.store.set('admissionTerminal:1',{transactionHash:'0x'+'a'.repeat(64)});x.gate.readClosure=async()=>{throw Error('CLOSURE_REORG');};await x.gate.reconcile();assert.equal(x.store.db.prepare('SELECT closed FROM admission_reservations').get().closed,0);x.store.pending=()=>({hash:'pending'});x.gate.readClosure=async()=>({pendingUSDC:'0'});await x.gate.reconcile();assert.equal(x.store.db.prepare('SELECT closed FROM admission_reservations').get().closed,0);}finally{x.close();}});

test('a completed review commits after work consumes time without renewing the preparation budget',async t=>{
 let clock=now;t.mock.method(Date,'now',()=>clock*1000);
 const x=setup({reviewStart:now,reviewFinish:now+300});
 const action={kind:'vote',job:'1',decision:'approve',bond:'1'};
 try {
  await assert.rejects(x.gate.beforeCommit(action),/REVIEW_PREPARATION_REQUIRED/);
  await x.gate.check('1',x.observed.specSha256);
  await assert.rejects(x.gate.beforeCommit(action),/REVIEW_PREPARATION_REQUIRED/);
  x.gate.consumePreparation('1');
  clock=now+60;x.state.block.timestamp=clock;
  await assert.rejects(x.gate.check('1',x.observed.specSha256),/REVIEW_TIME_JOB_WINDOW/);
  assert.throws(()=>x.gate.consumePreparation('1'),/REVIEW_TIME_JOB_WINDOW/);
  await x.gate.beforeCommit(action);x.gate.assertCurrent(action);
  x.store.close();x.store=new Store(x.dir);x.gate.store=x.store;x.gate.seals.clear();
  await x.gate.beforeCommit({...action,rebroadcast:true});x.gate.assertCurrent(action);
  clock=now+299;x.state.block.timestamp=clock;
  await x.gate.beforeCommit(action);x.gate.assertCurrent(action);
  clock=now+300;x.state.block.timestamp=clock;
  assert.throws(()=>x.gate.assertCurrent(action),/REVIEW_TIME_JOB_WINDOW/);
  await assert.rejects(x.gate.beforeCommit(action),/REVIEW_TIME_JOB_WINDOW/);
 } finally {x.close();}
});

test('commit still requires the durable review, current reservation, policy and signed booking',async t=>{
 let clock=now;t.mock.method(Date,'now',()=>clock*1000);
 const x=setup({reviewStart:now,reviewFinish:now+300}),action={kind:'vote',job:'1',decision:'approve',bond:'1'};
 try {
  await x.gate.check('1',x.observed.specSha256);x.gate.consumePreparation('1');
  clock=now+60;x.state.block.timestamp=clock;
  await x.gate.beforeCommit(action);x.gate.assertCurrent(action);
  const review=x.store.job('1').review;
  x.store.putJob('1',{review:null});
  assert.throws(()=>x.gate.assertCurrent(action),/SAVED_REVIEW_CHANGED/);
  await assert.rejects(x.gate.beforeCommit(action),/SPEC_NOT_VERIFIED/);
  x.store.putJob('1',{review});
  x.store.db.prepare('UPDATE admission_reservations SET closed=1').run();
  assert.throws(()=>x.gate.assertCurrent(action),/SAVED_REVIEW_CHANGED/);
  await assert.rejects(x.gate.beforeCommit(action),/REVIEW_PREPARATION_REQUIRED/);
  x.store.db.prepare('UPDATE admission_reservations SET closed=0').run();
  x.store.set('reviewTimePolicy',{...x.timePolicy,agentSeconds:x.timePolicy.agentSeconds+1});
  assert.throws(()=>x.gate.assertCurrent(action),/REVIEW_TIME_POLICY_CHANGED/);
  x.store.set('reviewTimePolicy',x.timePolicy);
  const row=x.store.db.prepare('SELECT signature FROM reviewer_time_bookings').get();
  x.store.db.prepare('UPDATE reviewer_time_bookings SET signature=?').run(Buffer.alloc(64).toString('base64'));
  assert.throws(()=>x.gate.assertCurrent(action),/SIGNATURE/);
  await assert.rejects(x.gate.beforeCommit(action),/SIGNATURE/);
  x.store.db.prepare('UPDATE reviewer_time_bookings SET signature=?').run(row.signature);
  x.store.db.prepare('UPDATE reviewer_time_bookings SET closed=1').run();
  assert.throws(()=>x.gate.assertCurrent(action),/UNBOOKED_JOB/);
  await assert.rejects(x.gate.beforeCommit(action),/UNBOOKED_JOB/);
 } finally {x.close();}
});
