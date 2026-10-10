import {ReviewBudget} from './review-budget.mjs';
import { Interface, AbiCoder, keccak256, toUtf8Bytes, getAddress } from 'ethers';
import { readReviewState, REVIEW_ABI } from './admission-core/economics/review-state.mjs';
import core from './admission-core/economics/admission.cjs';
import units from './admission-core/lib/usdc.js';
const cash=x=>BigInt(units.parseUSDC(x)), iface=new Interface(REVIEW_ABI);
const ensure=(x,m)=>{if(!x)throw Error('REVIEW_'+m);};
export function validateReviewPolicy(p) {
 ensure(p&&Object.keys(p).sort().join(',')===['schemaVersion','epoch','chainId','manager','wallet','escrow','codeHash','maxAttemptCostUSDC','maxEpochCostUSDC','maxJobs','maxAttempts'].sort().join(','),'POLICY_FIELDS');
 ensure(p.schemaVersion===1&&typeof p.epoch==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(p.epoch),'POLICY_SCHEMA');
 ensure([1,11155111,31337].includes(p.chainId),'CHAIN');
 for(const k of ['manager','wallet','escrow'])ensure(getAddress(p[k])!=='0x0000000000000000000000000000000000000000','ADDRESS');
 ensure(/^0x[0-9a-f]{64}$/.test(p.codeHash),'CODE_PIN');
 ensure(cash(p.maxAttemptCostUSDC)>0n&&cash(p.maxEpochCostUSDC)>=cash(p.maxAttemptCostUSDC),'COST_LIMIT');
 ensure(Number.isSafeInteger(p.maxJobs)&&p.maxJobs>0&&p.maxJobs<=100&&Number.isSafeInteger(p.maxAttempts)&&p.maxAttempts>0&&p.maxAttempts<=10,'ATTEMPT_LIMIT');
 return p;
}
export class ReviewProtection {
 constructor(c,chain,store,{readState=readReviewState}={}) {Object.assign(this,{c,chain,store,readState});this.seals=new Map();this.budget=new ReviewBudget(c,store);}
 unretained(){return !!this.store.meta('unretainedReviewPolicy');}
 enabled(){return this.c.chainId!==31337||!!this.store.meta('reviewProtectionPolicy')||this.unretained();}
 policy(){const p=validateReviewPolicy(this.store.meta('reviewProtectionPolicy'));ensure(p.chainId===this.c.chainId&&p.manager.toLowerCase()===this.c.manager.toLowerCase()&&p.wallet.toLowerCase()===this.c.validator.toLowerCase(),'POLICY_SCOPE');return p;}
 async state(job,confirmations=0){const p=this.policy();return this.readState({primary:this.chain.provider,secondary:this.chain.provider.witness,chainId:p.chainId,manager:p.manager,escrow:p.escrow,codeHash:p.codeHash,reviewer:p.wallet,jobId:String(job),confirmations});}
 id(job){const p=this.policy();return keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address','address','uint256','address'],[p.chainId,p.escrow,p.manager,job,p.wallet]));}
 request(kind,job){ensure(kind==='review-claim','NEW_RETAINERS_DISABLED');const p=this.policy();ensure(['review-activate','review-claim'].includes(kind),'ACTION');return {to:p.escrow,data:iface.encodeFunctionData(kind==='review-claim'?'withdrawCredit':'activateReview',kind==='review-claim'?[p.wallet]:[this.id(job)])};}
 assertRequest(request,kind,job){const expected=this.request(kind,job);ensure(getAddress(request.to)===getAddress(expected.to)&&request.data===expected.data&&(!request.value||BigInt(request.value)===0n),'TRANSACTION_SCOPE');}
 async beforeCommit({kind,job}) {
  if(!['review-activate','review-claim'].includes(kind))return;
  ensure(kind==='review-claim','NEW_RETAINERS_DISABLED');
  const p=this.policy(),hash=core.digest(p),r=await this.state(job);
  if(kind==='review-claim')ensure(cash(r.creditUSDC)>0n,'NO_CREDIT');
  ensure(core.digest(this.policy())===hash,'POLICY_CHANGED');
  this.seals.set(kind+':'+job,{hash,at:r.block.timestamp});
 }
 assertCurrent({kind,job,bond='0'}) {
  if(!['review-activate','review-claim'].includes(kind)&&!(this.enabled()&&(kind==='vote'||kind==='approve'&&BigInt(bond)>0n)))return;
  const s=this.seals.get(kind+':'+job);ensure(s&&Math.floor(Date.now()/1000)-s.at<=120&&core.digest(kind==='review-claim'?this.policy():this.budget.policy())===s.hash,'AUTHORITY_CHANGED');
 }
 async next(queue) {
  if(this.unretained())this.budget.policy();
  if(!this.store.meta('reviewProtectionPolicy'))return null;
  const credit=await this.state('0');
  return cash(credit.creditUSDC)>0n?{kind:'review-claim',job:'0'}:null;
 }
 async beforeWorkCommit({kind,job,bond='0',qualification}) {
  if(!this.enabled()||!(kind==='vote'||kind==='approve'&&BigInt(bond)>0n))return;
  ensure(this.unretained(),'OPERATOR_BUDGET_POLICY_REQUIRED');
  const hash=this.budget.checkCommit(qualification,job);this.seals.set(kind+':'+job,{hash,at:Math.floor(Date.now()/1000)});
 }
 async consume(job,snapshot) {
  if(!this.enabled())return;
  ensure(this.unretained(),'OPERATOR_BUDGET_POLICY_REQUIRED');
  return this.budget.consume(job,snapshot);
 }
}
