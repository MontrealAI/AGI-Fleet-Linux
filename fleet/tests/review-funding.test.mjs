import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './funding-harness.mjs';
import {requestFor} from '../ops/policy.mjs';
import {sha256,canonical,now} from '../ops/common.mjs';
import {addr} from './funding-fixture.mjs';
async function legacy(){
 const x=setup(),id=x.envelope.payload.offerId;await x.gate.check(id);
 x.store.set('reviewFundingPolicy',{schemaVersion:1,chainId:1,manager:x.c.manager,wallet:x.c.wallet,escrow:addr(21),codeHash:'0x'+'1'.repeat(64),maxFeeUSDC:'10',startWindowSeconds:3600});
 const p=x.store.meta('reviewFundingPolicy'),offer=x.gate.intent(id),item={reviewer:addr(3),feeUSDC:'8',escrow:p.escrow,codeHash:p.codeHash};
 offer.reviewRetainers=[item];x.store.db.prepare("UPDATE funding_reservations SET job='7',intent=?").run(canonical(offer));
 const key=sha256(id+':'+item.reviewer),o={...item,job:'7',offerId:id,completionHash:'0x'+'3'.repeat(64),startBy:now()-1,id:'0x'+'2'.repeat(64)};x.store.set('reviewOrder:'+key,o);
 const snapshot={buyer:x.c.wallet,requested:true,completed:true,expired:false,disputed:false,completionURI:'ipfs://delivery'};
 const state={state:1,id:o.id,creditUSDC:'0',block:{timestamp:now()},startBy:o.startBy};
 x.chain.snapshot=async()=>snapshot;x.gate.reviews.readState=async()=>state;
 return Object.assign(x,{snapshot,reviewState:state,order:o,key});
}
test('no-retainer funding signs without an escrow policy or extra USDC',async()=>{const x=setup();try{assert.equal(x.store.meta('reviewFundingPolicy'),null);x.state.balanceUSDC='1000';const a=await x.gate.next();assert.equal(a.action,'approve-funding');assert.deepEqual(a.offer.reviewRetainers,[]);x.gate.assertCurrent(a.job,a.offer);await x.tx.send(requestFor(x.chain,x.pin,a),a,{beforeSign:async()=>{}});assert.equal(x.counts().signed,1);}finally{x.close();}});
test('old signed retainer offers cannot create a new reservation or signature',async()=>{const x=setup('retainer');try{await assert.rejects(x.gate.check(x.envelope.payload.offerId),/FUNDING_POLICY_REQUIRED/);assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM funding_reservations').get().n,0);assert.equal(x.counts().signed,0);}finally{x.close();}});
test('new review approvals and funding fail at both request and signing boundaries',async()=>{const x=await legacy();try{for(const action of ['approve-review','fund-review']){const a={action,job:x.key,offer:x.order};assert.throws(()=>requestFor(x.chain,x.pin,a),/NEW_RETAINERS_DISABLED/);await assert.rejects(x.gate.beforeCommit(a),/NEW_RETAINERS_DISABLED/);}}finally{x.close();}});
test('unactivated legacy retainers refund, earned payments remain preserved',async()=>{const x=await legacy();try{assert.equal((await x.gate.reviews.next()).action,'refund-review');x.reviewState.state=2;assert.equal(await x.gate.reviews.next(),null);x.reviewState.state=0;x.snapshot.completed=false;assert.equal(await x.gate.reviews.next(),null);}finally{x.close();}});
test('legacy credits still recover to the employer and authority drift blocks signing',async()=>{const x=await legacy();try{x.reviewState.creditUSDC='8';const a=await x.gate.reviews.next();assert.equal(a.action,'claim-review');assert.ok(requestFor(x.chain,x.pin,a).data.endsWith(x.c.wallet.slice(2).toLowerCase()));x.gate.assertCurrent(a.job,a.offer);x.store.set('reviewFundingPolicy',{...x.store.meta('reviewFundingPolicy'),maxFeeUSDC:'9'});assert.throws(()=>x.gate.assertCurrent(a.job,a.offer),/AUTHORITY_CHANGED/);}finally{x.close();}});
test('legacy receipt reconciliation and unresolved claims survive the upgrade',async()=>{const x=await legacy();try{const row=x.store.db.prepare('SELECT * FROM funding_reservations').get();assert.equal(x.gate.reviews.remaining(row),8000000n);await x.gate.receipt({action:'fund-review',job:x.key},{status:0});assert.equal(x.gate.reviews.remaining(row),8000000n);await x.gate.receipt({action:'fund-review',job:x.key},{status:1});assert.equal(x.gate.reviews.remaining(row),0n);assert.equal(await x.gate.reviews.settled(row),false);}finally{x.close();}});
