import {Interface,keccak256,toUtf8Bytes,getAddress,parseUnits} from 'ethers';
import {readReviewState,REVIEW_ABI} from '../packages/AGI_Agent/src/admission-core/economics/review-state.mjs';
import units from '../packages/AGI_Agent/src/admission-core/lib/usdc.js';
import core from '../packages/AGI_Agent/src/admission-core/economics/admission.cjs';
import {ensure,now,canonical,sha256} from './common.mjs';
const cash=x=>BigInt(units.parseUSDC(x)),iface=new Interface(REVIEW_ABI);
export const reviewAction=x=>['approve-review','fund-review','refund-review','claim-review'].includes(x);
export function validateReviewFundingPolicy(p){
 ensure(p&&Object.keys(p).sort().join(',')===['schemaVersion','chainId','manager','wallet','escrow','codeHash','maxFeeUSDC','startWindowSeconds'].sort().join(','),'FUNDING_REVIEW_POLICY_FIELDS');
 ensure(p.schemaVersion===1&&[1,11155111,31337].includes(p.chainId),'FUNDING_REVIEW_POLICY');
 for(const k of ['manager','wallet','escrow'])ensure(getAddress(p[k])!=='0x0000000000000000000000000000000000000000','FUNDING_REVIEW_ADDRESS');
 ensure(/^0x[0-9a-f]{64}$/.test(p.codeHash)&&cash(p.maxFeeUSDC)>0n,'FUNDING_REVIEW_PIN');
 ensure(Number.isSafeInteger(p.startWindowSeconds)&&p.startWindowSeconds>=3600&&p.startWindowSeconds<=86400,'FUNDING_REVIEW_WINDOW');return p;
}
export function reviewRequest(chain,pin,a){
 ensure(!['approve-review','fund-review'].includes(a.action),'FUNDING_NEW_RETAINERS_DISABLED');
 const o=a.offer;
 if(a.action==='approve-review')return {to:pin.token,data:chain.token.interface.encodeFunctionData('approve',[o.escrow,cash(o.feeUSDC)])};
 const method={'fund-review':'fundReview','refund-review':'refundReview','claim-review':'withdrawCredit'}[a.action];
 const args=a.action==='fund-review'?[o.job,o.reviewer,o.completionHash,cash(o.feeUSDC),o.startBy]:a.action==='refund-review'?[o.id]:[chain.c.wallet];
 return {to:o.escrow,data:iface.encodeFunctionData(method,args)};
}
export class ReviewFunding {
 constructor(funding,{readState=readReviewState}={}){this.funding=funding;Object.assign(this,funding);this.readState=readState;this.seals=new Map();}
 policy(){const p=validateReviewFundingPolicy(this.store.meta('reviewFundingPolicy'));ensure(p.chainId===this.c.chainId&&p.manager.toLowerCase()===this.c.manager.toLowerCase()&&p.wallet.toLowerCase()===this.c.wallet.toLowerCase(),'FUNDING_REVIEW_SCOPE');return p;}
 plan(payload){ensure(payload.schemaVersion===7&&payload.lifecycle.schemaVersion===1,'FUNDING_NEW_RETAINERS_DISABLED');return [];}
 intent(id){const o=this.store.meta('reviewOrder:'+id);ensure(o,'FUNDING_REVIEW_ORDER_REQUIRED');return o;}
 async state(o,confirmations=0){return this.readState({primary:this.chain.provider,secondary:this.chain.provider.witness,chainId:this.c.chainId,manager:this.c.manager,escrow:o.escrow,codeHash:o.codeHash,reviewer:o.reviewer,jobId:o.job,confirmations});}
 remaining(row){const o=JSON.parse(row.intent);return (o.reviewRetainers??[]).reduce((n,x)=>n+(this.store.meta('reviewFunded:'+sha256(row.offer+':'+x.reviewer))?0n:cash(x.feeUSDC)),0n);}
 async beforeCommit(a){
  if(!reviewAction(a.action))return;
  ensure(!['approve-review','fund-review'].includes(a.action),'FUNDING_NEW_RETAINERS_DISABLED');
  const p=this.policy(),hash=core.digest(p),o=this.intent(a.job);ensure(canonical(o)===canonical(a.offer)&&o.escrow.toLowerCase()===p.escrow.toLowerCase()&&o.codeHash===p.codeHash,'FUNDING_REVIEW_ORDER_CHANGED');
  const r=await this.state(o),s=await this.chain.snapshot(o.job);
  ensure(s.buyer.toLowerCase()===this.c.wallet.toLowerCase(),'FUNDING_REVIEW_EMPLOYER');
  if(a.action==='claim-review') {const own=await this.state({...o,reviewer:this.c.wallet});ensure(cash(own.creditUSDC)>0n,'FUNDING_REVIEW_NO_CREDIT');}
  else if(a.action==='refund-review')ensure(r.state===1&&(s.completed||s.expired||s.disputed||r.startBy<=now()),'FUNDING_REVIEW_NOT_REFUNDABLE');
  ensure(core.digest(this.policy())===hash,'FUNDING_REVIEW_POLICY_CHANGED');this.seals.set(a.job,{hash,order:canonical(o),at:r.block.timestamp});
 }
 assertCurrent(id,offer){const s=this.seals.get(id);ensure(s&&now()-s.at<=120&&s.hash===core.digest(this.policy())&&s.order===canonical(offer)&&s.order===canonical(this.intent(id)),'FUNDING_REVIEW_AUTHORITY_CHANGED');}
 async receipt(t,r){if(t.action==='fund-review'&&r.status===1)this.store.set('reviewFunded:'+t.job,true);}
 async next(){
  if(this.c.role!=='employer'||!this.store.meta('reviewFundingPolicy'))return null;
  const p=this.policy(),rows=this.store.db.prepare('SELECT * FROM funding_reservations WHERE job IS NOT NULL AND closed=0 ORDER BY offer').all();
  const start=this.store.meta('reviewFundingCursor',0)%Math.max(1,rows.length);
  for(let i=0;i<Math.min(5,rows.length);i++){
   const row=rows[(start+i)%rows.length];this.store.set('reviewFundingCursor',(start+i+1)%Math.max(1,rows.length));
   for(const item of JSON.parse(row.intent).reviewRetainers??[]){
    const key=sha256(row.offer+':'+item.reviewer),s=await this.chain.snapshot(row.job);
    let o=this.store.meta('reviewOrder:'+key);
    if(!o){if(!s.requested||s.completed||s.expired||s.disputed)continue;o={...item,job:row.job,offerId:row.offer,completionHash:keccak256(toUtf8Bytes(s.completionURI)),startBy:now()+p.startWindowSeconds};const r=await this.state(o);o.id=r.id;this.store.set('reviewOrder:'+key,o);}
    const r=await this.state(o),own=await this.state({...o,reviewer:this.c.wallet});let action;
    if(cash(own.creditUSDC)>0n)action='claim-review';
    else if(r.state===1&&(s.completed||s.expired||s.disputed||r.startBy<=now()))action='refund-review';

    if(action){const a={action,job:key,offer:o};await this.beforeCommit(a);return a;}
   }
  }
  return null;
 }
 async settled(row){for(const item of JSON.parse(row.intent).reviewRetainers??[]){const r=await this.state({...item,job:row.job},Math.max(64,this.c.confirmations)),own=await this.state({...item,job:row.job,reviewer:this.c.wallet},Math.max(64,this.c.confirmations));if(r.state===1||cash(own.creditUSDC)>0n)return false;}return true;}
}
