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
import {canonical as reviewCanonical} from '../workforce/review-time.mjs';
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

function setup() {
 const x=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-admission-')),store=new Store(dir);
 const report=Buffer.from(x.evidenceReport);
 x.envelope.payload.evidence.reportSha256=crypto.createHash('sha256').update(report).digest('hex');x.resign();
 fs.mkdirSync(path.join(dir,'admission','inbox'),{recursive:true});fs.mkdirSync(path.join(dir,'admission','evidence'));
 fs.mkdirSync(path.join(dir,'admission','review-windows'));
 const packetFile=path.join(dir,'admission','inbox','1.json');fs.writeFileSync(packetFile,JSON.stringify(x.envelope));fs.writeFileSync(path.join(dir,'admission','evidence',x.envelope.payload.evidence.reportSha256+'.json'),report);
 store.set('admissionPolicy',x.policy);
 if(x.policy.role==='reviewer')store.putJob('1',{review:JSON.stringify({specHash:x.observed.specSha256,decision:'approve',completionURI:'ipfs://delivery',deliveryHash:digest('delivery')})});
 const c={chainId:1,agent:x.policy.wallet,manager:x.policy.manager,dataDir:dir,confirmations:12,limits:{maxTxETH:'0.0001'}};
 const state={block:{timestamp:now},specURI:x.observed.specURI,employer:addr(1),assignedAgent:addr(0),completionURI:'ipfs://delivery',completed:false,expired:false,pendingUSDC:'0',terms:x.observed.terms};
 const reviewers=x.envelope.payload.lifecycle.participants.filter(a=>a.role==='reviewer').map((a,i)=>({participantId:a.id,wallet:x.envelope.payload.identities[a.id].wallet,controllerId:x.envelope.payload.identities[a.id].controllerId,failureDomain:'domain-'+i,keys:crypto.generateKeyPairSync('ed25519')}));
 const timePolicy={schema:'agi-review-time-policy/v1',chainId:1,manager:c.manager,employer:state.employer,fundingPolicySha256:digest('funding policy'),minimumReviewers:3,agentSeconds:60,reviewSeconds:300,challengeSeconds:60,reserveSeconds:60,reviewers:reviewers.map(({keys,...r})=>({...r,publicKey:keys.publicKey.export({format:'pem',type:'spki'})}))};
 store.set('reviewTimePolicy',timePolicy);
 const offerId=digest('test offer'),receipts=reviewers.map(r=>{const body={schema:'agi-review-time/v1',offerId,specSha256:x.observed.specSha256,fundingPolicySha256:timePolicy.fundingPolicySha256,chainId:1,manager:c.manager,employer:state.employer,reviewerWallet:r.wallet,participantId:r.participantId,controllerId:r.controllerId,failureDomain:r.failureDomain,start:now+900,finish:now+1200,deadline:now+3000,issuedAt:now,validUntil:now+300};return {body,signature:crypto.sign(null,Buffer.from(reviewCanonical(body)),r.keys.privateKey).toString('base64')};});
 const windowFile=path.join(dir,'admission','review-windows','1.json');fs.writeFileSync(windowFile,JSON.stringify({offerId,receipts}));
 const reviewJob={buyer:state.employer,specURI:state.specURI,completed:false,expired:false,requested:false,agent:addr(0),now,duration:3600n,deadline:0n};
 const gate=new Admission(c,{provider:{getBalance:async()=>10n**18n},snapshot:async()=>reviewJob},store,{readState:async()=>state});
 return {...x,dir,store,gate,state,reviewJob,timePolicy,windowFile,packetFile,close(){this.store.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('Agent declines new work without independently signed reviewer windows and preserves recovery',async()=>{const x=setup();try{
 fs.unlinkSync(x.windowFile);await assert.rejects(x.gate.check('1',x.observed.specSha256),/ADMISSION_DENIED/);
 await x.gate.beforeCommit({kind:'claim',job:'1'});
}finally{x.close();}});
test('Agent rejects review time lost to late admission or changed reviewer evidence',async()=>{const x=setup();try{
 x.reviewJob.duration=1000n;await assert.rejects(x.gate.check('1',x.observed.specSha256),/REVIEW_TIME_AGENT_DEADLINE/);
 x.reviewJob.duration=3600n;await x.gate.check('1',x.observed.specSha256);
 fs.appendFileSync(x.windowFile,' ');assert.throws(()=>x.gate.assertCurrent({kind:'apply',job:'1',bond:'1'}),/REVIEW_TIME_CHANGED_BEFORE_SIGNING/);
}finally{x.close();}});
test('pre-assignment projection rejects inconsistent or insufficient chain state',async()=>{const x=setup();try{
 x.reviewJob.agent=addr(2);await assert.rejects(x.gate.check('1',x.observed.specSha256),/REVIEW_TIME_AGENT_JOB_STATE/);
 x.reviewJob.agent=addr(0);x.reviewJob.now=undefined;await assert.rejects(x.gate.check('1',x.observed.specSha256),/REVIEW_TIME_AGENT_JOB_STATE/);
 x.reviewJob.now=now;x.reviewJob.duration=3600n;await x.gate.check('1',x.observed.specSha256);
}finally{x.close();}});
test('native-USDC admission is fail closed without policy, packet or verified spec',async()=>{const x=setup();try{x.store.set('admissionPolicy',null);await assert.rejects(x.gate.check('1',x.observed.specSha256),/POLICY_REQUIRED/);x.store.set('admissionPolicy',x.policy);await assert.rejects(x.gate.check('1'),/SPEC_NOT_VERIFIED/);fs.unlinkSync(x.packetFile);await assert.rejects(x.gate.check('1',x.observed.specSha256),/ADMISSION_DENIED/);}finally{x.close();}});
test('reservations are idempotent and survive a reopened SQLite journal',async()=>{const x=setup();try{await x.gate.check('1',x.observed.specSha256);await x.gate.check('1',x.observed.specSha256);const row=x.store.db.prepare('SELECT * FROM admission_reservations').get();assert.equal(row.cost,'20000000');assert.equal(row.exposure,'70000000');x.store.close();x.store=new Store(x.dir);assert.equal(x.store.db.prepare('SELECT COUNT(*) AS n FROM admission_reservations').get().n,1);}finally{x.close();}});
test('unpaid claims and corrupt evidence block new work without altering recoverable obligations',async()=>{const x=setup();try{x.state.pendingUSDC='1';await assert.rejects(x.gate.check('1',x.observed.specSha256),/UNPAID_CLAIMS/);x.state.pendingUSDC='0';const evidence=path.join(x.dir,'admission','evidence',x.envelope.payload.evidence.reportSha256+'.json');fs.writeFileSync(evidence,'changed');await assert.rejects(x.gate.check('1',x.observed.specSha256),/REPORT_CHANGED/);}finally{x.close();}});
test('admission gating never blocks claim, completion, finalization or allowance revocation',async()=>{const x=setup();try{x.store.set('admissionPolicy',null);for(const kind of ['claim','submit','finalize'])await x.gate.beforeCommit({kind,job:'1'});await x.gate.beforeCommit({kind:'approve',job:'1',bond:'0'});for(const kind of ['apply','vote'])await assert.rejects(x.gate.beforeCommit({kind,job:'1',bond:'1'}),/POLICY_REQUIRED/);}finally{x.close();}});
test('a changed snapshot or insufficient gas reserve cannot pass the gate',async()=>{const x=setup();try{x.state.terms.slashBps=9000;await assert.rejects(x.gate.check('1',x.observed.specSha256),/ECONOMIC_TERMS/);x.state.terms.slashBps=8000;await assert.rejects(x.gate.check('1',x.observed.specSha256,{gasBudget:1000000000000000n}),/JOB_GAS_BUDGET/);}finally{x.close();}});

test('concurrent candidates cannot both consume the same remaining allocation',async()=>{const x=setup();try{x.policy.maxOpenExposureUSDC=x.policy.role==='agent'?'100':'200';x.store.set('admissionPolicy',x.policy);x.resign();fs.writeFileSync(x.packetFile,JSON.stringify(x.envelope));x.envelope.payload.jobId='2';x.resign();fs.writeFileSync(path.join(x.dir,'admission','inbox','2.json'),JSON.stringify(x.envelope));const r=await Promise.allSettled([x.gate.check('1',x.observed.specSha256),x.gate.check('2',x.observed.specSha256)]);assert.equal(r.filter(v=>v.status==='fulfilled').length,1);assert.equal(x.store.db.prepare('SELECT COUNT(*) AS n FROM admission_reservations').get().n,1);}finally{x.close();}});
test('final signing seal detects policy or packet changes after awaited checks',async()=>{const x=setup();try{await x.gate.check('1',x.observed.specSha256);const scope={kind:x.policy.role==='agent'?'apply':'vote',job:'1',bond:'1',decision:'approve'};x.gate.assertCurrent(scope);fs.appendFileSync(x.packetFile,' ');assert.throws(()=>x.gate.assertCurrent(scope),/AUTHORITY_CHANGED/);}finally{x.close();}});
test('aggregate native gas reservation requires funded recovery headroom',async()=>{const x=setup();try{x.gate.chain.provider.getBalance=async()=>0n;await assert.rejects(x.gate.check('1',x.observed.specSha256),/AGGREGATE_ETH_RESERVE/);assert.equal(x.store.db.prepare('SELECT COUNT(*) AS n FROM admission_reservations').get().n,0);}finally{x.close();}});

test('preparation attempts survive packet renewal and restart and exhaust without refund',async()=>{const x=setup();try{await x.gate.check('1',x.observed.specSha256);for(let n=0;n<4;n++)x.gate.consumePreparation('1');assert.throws(()=>x.gate.consumePreparation('1'),/ATTEMPTS_EXHAUSTED/);x.resign();fs.writeFileSync(x.packetFile,JSON.stringify(x.envelope));await x.gate.check('1',x.observed.specSha256);assert.throws(()=>x.gate.consumePreparation('1'),/ATTEMPTS_EXHAUSTED/);x.store.close();x.store=new Store(x.dir);assert.equal(x.store.db.prepare('SELECT attempts FROM admission_attempts').get().attempts,4);}finally{x.close();}});
test('receipt-based cancellation release works without any valid admission policy',async()=>{const x=setup();try{await x.gate.check('1',x.observed.specSha256);x.store.set('admissionPolicy',null);x.store.set('admissionTerminal:1',{transactionHash:'0x'+'a'.repeat(64)});x.gate.readClosure=async()=>({pendingUSDC:'1'});await x.gate.reconcile();assert.equal(x.store.db.prepare('SELECT closed FROM admission_reservations').get().closed,0);x.gate.readClosure=async()=>({pendingUSDC:'0',event:'JobCancelled'});await x.gate.reconcile();const row=x.store.db.prepare('SELECT closed,cost FROM admission_reservations').get();assert.equal(row.closed,1);assert.ok(BigInt(row.cost)>0n);}finally{x.close();}});
test('invalid closure proof and pending transaction retain the reservation',async()=>{const x=setup();try{await x.gate.check('1',x.observed.specSha256);x.store.set('admissionTerminal:1',{transactionHash:'0x'+'a'.repeat(64)});x.gate.readClosure=async()=>{throw Error('CLOSURE_REORG');};await x.gate.reconcile();assert.equal(x.store.db.prepare('SELECT closed FROM admission_reservations').get().closed,0);x.store.pending=()=>({hash:'pending'});x.gate.readClosure=async()=>({pendingUSDC:'0'});await x.gate.reconcile();assert.equal(x.store.db.prepare('SELECT closed FROM admission_reservations').get().closed,0);}finally{x.close();}});
