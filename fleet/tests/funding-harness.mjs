import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Wallet,Interface} from 'ethers';
import {fixture,addr} from './funding-fixture.mjs';
import {config,temp,spec} from './helpers.mjs';
import {Store} from '../ops/store.mjs';
import {Funding} from '../ops/funding.mjs';
import {Transactions} from '../ops/transactions.mjs';
import {requestFor} from '../ops/policy.mjs';
import {binding} from '../ops/config.mjs';
import {sha256,canonical,now} from '../ops/common.mjs';
import {AUTONOMY_DECLARATION} from '../packages/AGI_Node/src/autonomy.mjs';
import crypto from 'node:crypto';
import {canonical as reviewCanonical} from '../workforce/review-time.mjs';
export function setup(reviewPayment='operator-budget') {
 const x=fixture(reviewPayment),home=temp(),store=new Store(home),wallet=Wallet.createRandom(),p=x.envelope.payload;
 x.policy.wallet=wallet.address.toLowerCase();p.identities.employer.wallet=x.policy.wallet;p.commitment.details=AUTONOMY_DECLARATION;
 const bytes=Buffer.from(JSON.stringify(spec));p.specSha256=sha256(bytes);
 p.commitment.durationSeconds='3600';
 fs.mkdirSync(path.join(home,'funding','inbox'),{recursive:true});fs.mkdirSync(path.join(home,'funding','evidence'));
 fs.mkdirSync(path.join(home,'funding','review-windows'));
 for(const [object,key] of [[p.evidence,'reportSha256'],[p.valueEvidence,'baselineSha256'],[p.valueEvidence,'outcomesSha256']]) {const b=Buffer.from(key==='reportSha256'?x.evidenceReport:key+' synthetic test fixture');object[key]=sha256(b);fs.writeFileSync(path.join(home,'funding','evidence',object[key]+'.json'),b);}
 if(reviewPayment==='retainer')store.set('reviewFundingPolicy',{schemaVersion:1,chainId:1,manager:x.policy.manager,wallet:x.policy.wallet,escrow:addr(21),codeHash:'0x'+'1'.repeat(64),maxFeeUSDC:'10',startWindowSeconds:3600});
 const c=config('employer',{chainId:1,wallet:wallet.address,manager:x.policy.manager,trustedBuyers:[wallet.address]});c.limits.maxTxETH='0.0001';
 let signed=0,broadcast=0;const provider={verified:true,getBalance:async()=>10n**18n,getTransactionCount:async()=>0,getFeeData:async()=>({maxFeePerGas:100000000n,maxPriorityFeePerGas:10000000n}),call:async()=> '0x',estimateGas:async()=>21000n,broadcastTransaction:async()=>{broadcast++;throw Error('uncertain transport');},getTransactionReceipt:async()=>null};
 const chain={c,provider,verify:async()=>{},snapshot:async()=>{},token:{interface:new Interface(['function approve(address,uint256)'])}},pin={token:addr(20)};
 const state={block:{timestamp:now()},paused:false,settlementPaused:false,pendingUSDC:'0',balanceUSDC:'5000',allowanceUSDC:'0',terms:structuredClone(p.lifecycle.terms)};
 const gate=new Funding(c,chain,store,{read:async()=>({bytes,sha256:sha256(bytes)})},{readState:async()=>state});
 gate.reviews.readState=async()=>({state:0,creditUSDC:'0'});
 const reviewers=p.lifecycle.participants.filter(a=>a.role==='reviewer').map(a=>({participantId:a.id,...p.identities[a.id],keys:crypto.generateKeyPairSync('ed25519')}));
 const save=()=>{
  x.resign();fs.writeFileSync(path.join(home,'funding','inbox',p.offerId+'.json'),JSON.stringify(x.envelope));store.set('fundingPolicy',x.policy);
  const policy={schema:'agi-review-time-policy/v1',chainId:1,manager:x.policy.manager,employer:x.policy.wallet,fundingPolicySha256:p.policyDigest,minimumReviewers:3,agentSeconds:60,reviewSeconds:300,challengeSeconds:60,reserveSeconds:60,reviewers:reviewers.map((r,i)=>({participantId:r.participantId,wallet:r.wallet,controllerId:r.controllerId,failureDomain:'domain-'+i,publicKey:r.keys.publicKey.export({format:'pem',type:'spki'})}))};store.set('reviewTimePolicy',policy);
  const current=now(),receipts=reviewers.map((r,i)=>{const body={schema:'agi-review-time/v1',offerId:p.offerId,specSha256:p.specSha256,fundingPolicySha256:p.policyDigest,chainId:1,manager:x.policy.manager,employer:x.policy.wallet,reviewerWallet:r.wallet,participantId:r.participantId,controllerId:r.controllerId,failureDomain:'domain-'+i,start:current+900,finish:current+1200,deadline:current+3000,issuedAt:current,validUntil:current+300};return {body,signature:crypto.sign(null,Buffer.from(reviewCanonical(body)),r.keys.privateKey).toString('base64')};});
  fs.writeFileSync(path.join(home,'funding','review-windows',p.offerId+'.json'),JSON.stringify(receipts));
 };save();
 const bound=binding(c,pin);store.set('activation',{binding:bound,wallet:c.wallet,expires:now()+3600});store.set('initialNonce',0);
 const tx=new Transactions(c,chain,store,pin,{getAddress:async()=>wallet.address,signTransaction:async(t)=>{signed++;return wallet.signTransaction(t);}},bound);tx.funding=gate;
 return {...x,home,store,c,chain,gate,state,save,tx,pin,reviewers,counts:()=>({signed,broadcast}),close(){this.store.close();fs.rmSync(home,{recursive:true,force:true});}};
}
