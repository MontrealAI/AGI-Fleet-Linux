import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup } from './funding-harness.mjs';
import { Store } from '../ops/store.mjs';
import { ReviewerTimeLedger,verifyReceipt } from '../workforce/review-time.mjs';
import { sha256, now } from '../ops/common.mjs';

test('independent Node booking survives restart and cannot sell overlapping time',()=>{
 const x=setup(),dir=path.join(x.home,'independent-node'),node=new Store(dir);
 try {
  const policy=x.store.meta('reviewTimePolicy'),receipt=JSON.parse(fs.readFileSync(path.join(x.home,'funding','review-windows',x.envelope.payload.offerId+'.json')))[0];
  const {schema,issuedAt,...request}=receipt.body,clock=()=>issuedAt;
  const ledger=new ReviewerTimeLedger(node,policy,{time:clock}),first=ledger.issue(request,x.reviewers[0].keys.privateKey,x.reviewers[0].wallet);
  assert.equal(first.body.offerId,request.offerId);
  assert.deepEqual(ledger.issue(request,x.reviewers[0].keys.privateKey,x.reviewers[0].wallet),first);
  node.close();const reopened=new Store(dir),again=new ReviewerTimeLedger(reopened,policy,{time:clock});
  assert.throws(()=>again.issue({...request,offerId:sha256('overlap')},x.reviewers[0].keys.privateKey,x.reviewers[0].wallet),/OVERLAP/);
  again.bind(request.offerId,'0');assert.throws(()=>again.bind(request.offerId,'1'),/UNBOOKED_JOB/);
  assert.ok(verifyReceipt(first,policy,issuedAt));reopened.close();
 } finally {try{node.close();}catch{}x.close();}
});
test('employer refuses missing, forged and expired independent reviewer commitments before signing',async()=>{
 for(const change of [receipts=>receipts.pop(),receipts=>receipts[0].signature=receipts[1].signature,receipts=>receipts[0].body.validUntil=now()-1]){
  const x=setup();try{
   const file=path.join(x.home,'funding','review-windows',x.envelope.payload.offerId+'.json'),receipts=JSON.parse(fs.readFileSync(file));change(receipts);fs.writeFileSync(file,JSON.stringify(receipts));
   await assert.rejects(x.gate.check(x.envelope.payload.offerId),/REVIEW_TIME_/);
   assert.equal(x.counts().signed,0);
   assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM funding_reservations').get().n,0);
  }finally{x.close();}
 }
});
test('distinct signed capacity leases cannot double-book the same independent reviewers',async()=>{
 const x=setup();try{
  const first=x.envelope.payload.offerId;await x.gate.check(first);
  x.envelope.payload.offerId=sha256('new offer');x.envelope.payload.capacity.leaseId=sha256('new lease');x.save();
  await assert.rejects(x.gate.check(x.envelope.payload.offerId),/REVIEW_TIME_OVERLAP/);
  assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM funding_reservations').get().n,1);
 }finally{x.close();}
});
test('legacy open funding obligations with unknown reviewer calendars halt new intake while recovery remains available',async()=>{
 const x=setup();try{
  await x.gate.check(x.envelope.payload.offerId);
  x.store.db.prepare('UPDATE funding_reservations SET review_windows=NULL').run();
  x.envelope.payload.offerId=sha256('next offer');x.envelope.payload.capacity.leaseId=sha256('new lease');x.save();
  await assert.rejects(x.gate.check(x.envelope.payload.offerId),/REVIEW_TIME_LEGACY_WINDOW_UNKNOWN/);
  assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM funding_reservations').get().n,1);
 }finally{x.close();}
});

test('review preparation reserves its full budget; commit stays within the same signed booking',()=>{
 const x=setup(),store=new Store(path.join(x.home,'reviewer-phase'));
 try {
  const policy=x.store.meta('reviewTimePolicy'),receipt=JSON.parse(fs.readFileSync(path.join(x.home,'funding','review-windows',x.envelope.payload.offerId+'.json')))[0];
  const {schema,issuedAt,...request}=receipt.body;
  let clock=issuedAt;
  const ledger=new ReviewerTimeLedger(store,policy,{time:()=>clock});
  ledger.issue(request,x.reviewers[0].keys.privateKey,x.reviewers[0].wallet);ledger.bind(request.offerId,'1');
  const scope={specSha256:request.specSha256,employer:request.employer,chainId:request.chainId,manager:request.manager,reviewerWallet:request.reviewerWallet,reviewEnd:request.deadline};
  clock=request.start-1;
  assert.throws(()=>ledger.forJob('1',scope,{phase:'commit'}),/JOB_WINDOW/);
  clock=request.start;
  assert.ok(ledger.forJob('1',scope));
  clock++;
  assert.throws(()=>ledger.forJob('1',scope),/JOB_WINDOW/);
  assert.ok(ledger.forJob('1',scope,{phase:'commit'}));
  assert.throws(()=>ledger.forJob('1',{...scope,specSha256:sha256('other')},{phase:'commit'}),/JOB_WINDOW/);
  assert.throws(()=>ledger.forJob('1',scope,{phase:'skip'}),/PHASE/);
  clock=request.finish;
  for(const phase of ['prepare','commit'])assert.throws(()=>ledger.forJob('1',scope,{phase}),/JOB_WINDOW/);
  clock=request.start+1;store.db.prepare('UPDATE reviewer_time_bookings SET closed=1').run();
  assert.throws(()=>ledger.forJob('1',scope,{phase:'commit'}),/UNBOOKED_JOB/);
 } finally {store.close();x.close();}
});
