import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {keccak256,toUtf8Bytes} from 'ethers';
import {Store} from '../src/store.mjs';
import {ReviewProtection} from '../src/review-protection.mjs';
const address=n=>'0x'+String(n).padStart(40,'0');
function setup(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-protection-')),store=new Store(dir);
 const p={schemaVersion:1,epoch:'review-1',chainId:1,manager:address(9),wallet:address(3),escrow:address(8),codeHash:'0x'+'1'.repeat(64),maxAttemptCostUSDC:'4',maxEpochCostUSDC:'12',maxJobs:2,maxAttempts:2};store.set('reviewProtectionPolicy',p);
 const snapshot={buyer:address(1),completionURI:'ipfs://delivery'},state={id:'0x'+'2'.repeat(64),reviewer:p.wallet,employer:snapshot.buyer,state:1,feeUSDC:'8',startBy:Math.floor(Date.now()/1000)+3600,creditUSDC:'0',completionHash:keccak256(toUtf8Bytes(snapshot.completionURI)),block:{timestamp:Math.floor(Date.now()/1000)}};
 const c={chainId:1,manager:p.manager,validator:p.wallet,minReviewSeconds:300,confirmations:12},reads=[];
 const gate=new ReviewProtection(c,{provider:{},snapshot:async()=>snapshot,eligible:()=>null},store,{readState:async args=>{reads.push(args);return state;}});
 return {store,gate,state,p,snapshot,reads,close(){store.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('legacy recovery still requires the original wallet-bound escrow policy',()=>{const x=setup();try{x.store.set('reviewProtectionPolicy',null);assert.throws(()=>x.gate.policy(),/POLICY_FIELDS/);x.store.set('reviewProtectionPolicy',{...x.p,wallet:address(7)});assert.throws(()=>x.gate.policy(),/POLICY_SCOPE/);}finally{x.close();}});
test('new activation is disabled while claim requests cannot redirect funds',async()=>{const x=setup();try{assert.throws(()=>x.gate.request('review-activate','1'),/NEW_RETAINERS_DISABLED/);await assert.rejects(x.gate.beforeCommit({kind:'review-activate',job:'1'}),/NEW_RETAINERS_DISABLED/);const q=x.gate.request('review-claim','0');assert.throws(()=>x.gate.assertRequest({...q,to:address(6)},'review-claim','0'),/SCOPE/);}finally{x.close();}});
test('legacy payments do not authorize new processing or votes',async()=>{const x=setup();try{for(const state of [1,2]){x.state.state=state;await assert.rejects(x.gate.consume('1',x.snapshot),/OPERATOR_BUDGET_POLICY_REQUIRED/);await assert.rejects(x.gate.beforeWorkCommit({kind:'vote',job:'1',qualification:{reviewRetainerUSDC:'8',modeledCostUSDC:'8'}}),/OPERATOR_BUDGET_POLICY_REQUIRED/);}}finally{x.close();}});
test('claims have priority without queued jobs and survive new-budget enrollment',async()=>{const x=setup();try{x.state.creditUSDC='8';x.store.set('unretainedReviewPolicy',{schemaVersion:1,epoch:'new-budget',chainId:1,manager:x.p.manager,wallet:x.p.wallet,maxAttemptCostUSDC:'2',maxEpochCostUSDC:'8',maxJobs:2,maxAttempts:2,acknowledgeUnpaidWork:true});assert.deepEqual(await x.gate.next([]),{kind:'review-claim',job:'0'});await x.gate.beforeCommit({kind:'review-claim',job:'0'});x.gate.assertCurrent({kind:'review-claim',job:'0'});x.store.set('reviewProtectionPolicy',{...x.p,maxEpochCostUSDC:'20'});assert.throws(()=>x.gate.assertCurrent({kind:'review-claim',job:'0'}),/AUTHORITY_CHANGED/);}finally{x.close();}});
test('funded legacy assignments never restart activation automatically',async()=>{const x=setup();try{assert.equal(await x.gate.next([{id:'1'}]),null);}finally{x.close();}});
