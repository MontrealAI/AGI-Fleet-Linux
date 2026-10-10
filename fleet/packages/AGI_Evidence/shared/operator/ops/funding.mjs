import {ReviewFunding,reviewAction} from './review-funding.mjs';
import { QualificationService } from '../packages/AGI_Agent/src/admission-core/economics/qualification-service.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { parseUnits,Interface } from 'ethers';
import core from '../packages/AGI_Agent/src/admission-core/economics/admission.cjs';
import units from '../packages/AGI_Agent/src/admission-core/lib/usdc.js';
import { readFundingState } from '../packages/AGI_Agent/src/admission-core/economics/funding-state.mjs';
import { readClosureState } from '../packages/AGI_Agent/src/admission-core/economics/closure-state.mjs';
import {ensure,sha256,canonical,now} from './common.mjs';
import {boundedJSON,validateSpec} from '../packages/AGI_Node/src/review.mjs';
import {autonomySpec,AUTONOMY_DECLARATION} from '../packages/AGI_Node/src/autonomy.mjs';
import {validatePolicy as validateReviewTimePolicy,verifyFundingWindows,assertNoOverlap,digest as reviewTimeDigest} from '../workforce/review-time.mjs';
const cash=x=>BigInt(units.parseUSDC(x));
const events=new Interface(['event JobCreated(uint256 indexed jobId,string jobSpecURI,uint256 indexed payout,uint256 indexed duration,string details)']);
export function boundedFile(file) {
 const s=fs.lstatSync(file);ensure(s.isFile()&&!s.isSymbolicLink()&&s.size<=1048576,'FUNDING_FILE_LIMIT');return fs.readFileSync(file);
}
export class Funding {
 constructor(c,chain,store,reader,{readState=readFundingState,readClosure=readClosureState}={}) {Object.assign(this,{c,chain,store,reader,readState,readClosure});this.seals=new Map();this.service=new QualificationService();this.init();this.reviews=new ReviewFunding(this);}
 init() {
  this.store.db.exec(`CREATE TABLE IF NOT EXISTS funding_reservations(offer TEXT PRIMARY KEY,epoch TEXT NOT NULL,policy TEXT NOT NULL,packet TEXT NOT NULL,intent TEXT NOT NULL,lease TEXT UNIQUE NOT NULL,capacity TEXT NOT NULL,exposure TEXT NOT NULL,cost TEXT NOT NULL,gas TEXT NOT NULL,job TEXT,closed INTEGER NOT NULL DEFAULT 0,review_windows TEXT);`);
  if(!this.store.db.prepare('PRAGMA table_info(funding_reservations)').all().some(x=>x.name==='review_windows'))this.store.db.exec('ALTER TABLE funding_reservations ADD COLUMN review_windows TEXT');
 }
 intent(id) {if(this.store.meta('reviewOrder:'+id))return this.reviews.intent(id);const r=this.store.db.prepare('SELECT intent FROM funding_reservations WHERE offer=?').get(id);ensure(r,'FUNDING_RESERVATION_REQUIRED');return JSON.parse(r.intent);}
 async check(id,options={}) {
  try{return await this.service.run('fund:'+id,signal=>this.checkNow(id,{...options,signal}));}
  finally{this.store.set('qualificationService',this.service.snapshot());}
 }
 async checkNow(id,{gasBudget=0n,rebroadcast=false,signal}={}) {
  ensure(this.c.role==='employer','FUNDING_EMPLOYER_ONLY');ensure(/^[0-9a-f]{64}$/.test(id),'FUNDING_OFFER_ID');
  const policy=this.store.meta('fundingPolicy');ensure(policy?.schemaVersion===7&&policy.reviewPayment==='operator-budget','FUNDING_POLICY_REQUIRED');core.validatePolicy(policy);
  ensure(this.c.chainId!==1||policy.calibration.allowedKinds.every(x=>x==='observed'),'FUNDING_MAINNET_OBSERVED_EVIDENCE');
  const policyHash=core.digest(policy);ensure(policy.role==='employer'&&policy.chainId===this.c.chainId&&policy.wallet===this.c.wallet.toLowerCase()&&policy.manager===this.c.manager.toLowerCase(),'FUNDING_POLICY_SCOPE');
  const reviewPolicy=validateReviewTimePolicy(this.store.meta('reviewTimePolicy'));ensure(reviewPolicy.fundingPolicySha256===policyHash,'FUNDING_REVIEW_TIME_POLICY_CHANGED');
  const file=path.join(this.store.home,'funding','inbox',id+'.json'),bytes=boundedFile(file),envelope=JSON.parse(bytes),p=envelope.payload;
  ensure(p?.offerId===id,'FUNDING_OFFER_BINDING');
  const windowFile=path.join(this.store.home,'funding','review-windows',id+'.json'),windowBytes=boundedFile(windowFile),receipts=JSON.parse(windowBytes);
  for(const hash of [p.evidence?.reportSha256,p.valueEvidence?.baselineSha256,p.valueEvidence?.outcomesSha256]) {
   ensure(/^[0-9a-f]{64}$/.test(hash??''),'FUNDING_EVIDENCE_HASH');ensure(sha256(boundedFile(path.join(this.store.home,'funding','evidence',hash+'.json')))===hash,'FUNDING_EVIDENCE_CHANGED');
  }
  const offer={specURI:p.specURI,payoutUSDC:p.lifecycle?.terms?.jobCostUSDC,durationSeconds:p.commitment?.durationSeconds,details:p.commitment?.details,reviewRetainers:this.reviews.plan(p)};
  ensure(offer.details===AUTONOMY_DECLARATION,'FUNDING_SUPPORTED_JOB_REQUIRED');
  ensure(cash(offer.payoutUSDC)<=parseUnits(this.c.limits.maxJobUSDC,6),'FUNDING_JOB_LIMIT');
  const spec=await this.reader.read(offer.specURI);
  autonomySpec(boundedJSON(spec.bytes),validateSpec);
  const s=await this.readState({primary:this.chain.provider,secondary:this.chain.provider.witness,chainId:this.c.chainId,manager:this.c.manager,wallet:this.c.wallet,offer});
  ensure(!s.paused&&!s.settlementPaused&&s.pendingUSDC==='0','FUNDING_PAUSED_OR_UNPAID');
  // No hidden legacy employer escrow may be ignored when a policy is enrolled.
  for(const row of this.store.db.prepare("SELECT id FROM jobs WHERE status!='terminal'").all()) {
   const old=await this.chain.snapshot(row.id);
   if(old.buyer.toLowerCase()===this.c.wallet.toLowerCase()&&!old.completed&&!old.expired)ensure(this.store.db.prepare('SELECT offer FROM funding_reservations WHERE job=? AND closed=0').get(row.id),'FUNDING_LEGACY_OBLIGATION');
  }
  const observed={chainId:this.c.chainId,manager:this.c.manager.toLowerCase(),wallet:this.c.wallet.toLowerCase(),offerId:id,specURI:offer.specURI,specSha256:spec.sha256,terms:s.terms,observedAt:s.block.timestamp,commitment:{action:'createJob',durationSeconds:offer.durationSeconds,details:offer.details}};
  const native=await this.chain.provider.getBalance(this.c.wallet);
  ensure(!signal?.aborted,'FUNDING_QUALIFICATION_DEADLINE');
  const r=this.store.transaction(()=>{
   ensure(core.digest(this.store.meta('fundingPolicy'))===policyHash,'FUNDING_POLICY_CHANGED');
   ensure(reviewTimeDigest(this.store.meta('reviewTimePolicy'))===reviewTimeDigest(reviewPolicy),'FUNDING_REVIEW_TIME_POLICY_CHANGED');
   const prior=this.store.db.prepare('SELECT * FROM funding_reservations WHERE offer=?').get(id);
   ensure(!prior||(!prior.closed&&prior.job===null&&prior.policy===policyHash&&prior.intent===canonical(offer)&&prior.lease===p.capacity?.leaseId&&prior.capacity===canonical(p.capacity)),'FUNDING_RESERVATION_SCOPE');
   const rows=this.store.db.prepare('SELECT * FROM funding_reservations WHERE closed=0 AND offer!=?').all(id);
   const windows=verifyFundingWindows({policy:reviewPolicy,fundingPolicy:policy,payload:p,durationSeconds:offer.durationSeconds,receipts, time:now()});
   assertNoOverlap(windows,rows);
   ensure(!prior||prior.review_windows===canonical(windows),'FUNDING_REVIEW_WINDOWS_CHANGED');
   const epoch=this.store.db.prepare('SELECT cost FROM funding_reservations WHERE epoch=? AND offer!=?').all(policy.epoch,id);
   const capacity={agentSlots:0,reviewerSlots:0,providerUnits:0};for(const row of rows){const c=JSON.parse(row.capacity);for(const k of Object.keys(capacity))capacity[k]+=c[k];}
   const portfolio={openExposureUSDC:units.formatUSDC(rows.reduce((n,x)=>n+BigInt(x.exposure),0n)),epochCostUSDC:units.formatUSDC(epoch.reduce((n,x)=>n+BigInt(x.cost),0n)),openJobs:rows.length,capacity};
   const result=core.checkNewWork({policy,envelope,observed,portfolio,evidenceReport:boundedFile(path.join(this.store.home,'funding','evidence',p.evidence.reportSha256+'.json')).toString()});
   if(prior)ensure(cash(result.reserveExposureUSDC)>=BigInt(prior.exposure)&&cash(result.reserveCostUSDC)>=BigInt(prior.cost)&&BigInt(result.gasBudgetWei)>=BigInt(prior.gas),'FUNDING_RESERVATION_CANNOT_SHRINK');
   const spent=this.store.db.prepare('SELECT gas_budget FROM txs WHERE job=?').all(id).reduce((n,t)=>n+BigInt(t.gas_budget),0n);
   ensure(spent+(rebroadcast?0n:gasBudget)+2n*parseUnits(this.c.limits.maxTxETH,18)<=BigInt(result.gasBudgetWei),'FUNDING_GAS_LIMIT');
   ensure(native>=rows.reduce((n,x)=>n+BigInt(x.gas),0n)+BigInt(result.gasBudgetWei),'FUNDING_ETH_RESERVE');
   // Existing escrow is already outside this wallet. Unsent offers still share its balance.
   const unsent=rows.filter(x=>x.job===null).reduce((n,x)=>n+cash(JSON.parse(x.intent).payoutUSDC),0n);
   const fees=rows.reduce((n,x)=>n+this.reviews.remaining(x),0n)+offer.reviewRetainers.reduce((n,x)=>n+cash(x.feeUSDC),0n);
   ensure(cash(s.balanceUSDC)>=unsent+cash(offer.payoutUSDC)+fees,'FUNDING_USDC_RESERVE');
   ensure(s.allowanceUSDC==='0'||cash(s.allowanceUSDC)===cash(offer.payoutUSDC),'FUNDING_ALLOWANCE_REVIEW');
   this.store.db.prepare('INSERT INTO funding_reservations(offer,epoch,policy,packet,intent,lease,capacity,exposure,cost,gas,review_windows) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(offer) DO UPDATE SET packet=excluded.packet,exposure=excluded.exposure,cost=excluded.cost,gas=excluded.gas').run(id,policy.epoch,policyHash,result.packetDigest,canonical(offer),p.capacity.leaseId,canonical(p.capacity),cash(result.reserveExposureUSDC).toString(),cash(result.reserveCostUSDC).toString(),result.gasBudgetWei,canonical(windows));
   return result;
  });
  ensure(sha256(boundedFile(file))===sha256(bytes)&&sha256(boundedFile(windowFile))===sha256(windowBytes)&&now()<r.expiresAt&&now()-s.block.timestamp<=120,'FUNDING_AUTHORITY_CHANGED');
  ensure(!signal?.aborted,'FUNDING_QUALIFICATION_DEADLINE');
  this.seals.set(id,{file,hash:sha256(bytes),windowFile,windowHash:sha256(windowBytes),reviewTimePolicyHash:reviewTimeDigest(reviewPolicy),policyHash,expires:r.expiresAt,observed:s.block.timestamp,intent:canonical(offer),reviewPolicy:null});
  return {result:r,offer,state:s};
 }
 assertCurrent(id,offer) {
  if(this.store.meta('reviewOrder:'+id))return this.reviews.assertCurrent(id,offer);
  const seal=this.seals.get(id);ensure(seal&&now()<seal.expires&&now()-seal.observed<=120,'FUNDING_SEAL_REQUIRED');
  ensure(seal.reviewPolicy===null&&offer.reviewRetainers.length===0,'FUNDING_RETAINER_DISABLED');
  ensure(reviewTimeDigest(this.store.meta('reviewTimePolicy'))===seal.reviewTimePolicyHash&&sha256(boundedFile(seal.windowFile))===seal.windowHash,'FUNDING_REVIEW_TIME_CHANGED');
  const saved=this.store.db.prepare('SELECT review_windows FROM funding_reservations WHERE offer=? AND closed=0').get(id);
  ensure(saved?.review_windows&&JSON.parse(saved.review_windows).length>=this.store.meta('reviewTimePolicy').minimumReviewers&&JSON.parse(saved.review_windows).every(x=>now()<x.validUntil),'FUNDING_REVIEW_TIME_EXPIRED');
  ensure(seal.intent===canonical(offer)&&core.digest(this.store.meta('fundingPolicy'))===seal.policyHash&&sha256(boundedFile(seal.file))===seal.hash,'FUNDING_AUTHORITY_CHANGED');
 }
 async beforeCommit(action,{gasBudget=0n,rebroadcast=false}={}) {
  if(reviewAction(action.action))return this.reviews.beforeCommit(action);
  if(!['fund','approve-funding'].includes(action.action))return;
  const r=await this.check(action.job,{gasBudget,rebroadcast});
  ensure(canonical(action.offer)===canonical(r.offer),'FUNDING_INTENT_CHANGED');
  ensure(action.action==='fund'?cash(r.state.allowanceUSDC)===cash(r.offer.payoutUSDC):r.state.allowanceUSDC==='0','FUNDING_ALLOWANCE_CHANGED');
 }
 async receipt(t,r) {
  if(reviewAction(t.action))return this.reviews.receipt(t,r);
  if(!['fund','approve-funding'].includes(t.action)||r.status!==1)return;
  if(t.action==='fund') {
   const offer=this.intent(t.job),found=r.logs.filter(l=>l.address.toLowerCase()===this.c.manager.toLowerCase()).map(l=>{try{return events.parseLog(l);}catch{return null;}}).filter(Boolean);
   ensure(found.length===1,'FUNDING_RECEIPT_EVENT');const e=found[0];
   ensure(e.args.jobSpecURI===offer.specURI&&e.args.payout===cash(offer.payoutUSDC)&&String(e.args.duration)===offer.durationSeconds&&e.args.details===offer.details,'FUNDING_RECEIPT_MISMATCH');
   this.store.db.prepare('UPDATE funding_reservations SET job=? WHERE offer=? AND job IS NULL').run(String(e.args.jobId),t.job);
  }
 }
 async reconcile() {
  const rows=this.store.db.prepare('SELECT * FROM funding_reservations WHERE closed=0 ORDER BY offer').all();
  const cursor=this.store.meta('fundingReconcileCursor',0)%Math.max(1,rows.length);
  for(let i=0;i<Math.min(5,rows.length);i++) {
   const row=rows[(cursor+i)%rows.length];
   if(row.job===null) {
    if(JSON.parse(row.capacity).expiresAt<now()&&!this.store.db.prepare('SELECT hash FROM txs WHERE job=?').get(row.offer))this.store.transaction(()=>{
      ensure(!this.store.pending(),'TRANSACTION_PENDING');this.store.db.prepare('UPDATE funding_reservations SET closed=1 WHERE offer=?').run(row.offer);this.store.set('fundingClosure:'+row.offer,{reason:'EXPIRED_UNSIGNED_RESERVATION',at:now()});
    });
    continue;
   }
   const ref=this.store.meta('fundingTerminal:'+row.job);if(!ref)continue;
   try {
    const proof=await this.readClosure({primary:this.chain.provider,secondary:this.chain.provider.witness,chainId:this.c.chainId,manager:this.c.manager,wallet:this.c.wallet,jobId:row.job,transactionHash:ref.transactionHash,confirmations:Math.max(64,this.c.confirmations)});
    ensure(proof.pendingUSDC==='0','FUNDING_UNPAID_CLAIMS');
    ensure(await this.reviews.settled(row),'FUNDING_REVIEW_CLAIMS_PENDING');
    this.store.transaction(()=>{ensure(!this.store.pending(),'TRANSACTION_PENDING');this.store.db.prepare('UPDATE funding_reservations SET closed=1 WHERE offer=?').run(row.offer);this.store.set('fundingClosure:'+row.offer,proof);});
   }catch(e){this.store.set('fundingReconcileError:'+row.offer,{at:now(),code:String(e.message).slice(0,160)});}
  }
  this.store.set('fundingReconcileCursor',(cursor+5)%Math.max(1,rows.length));
 }
 async next() {
  if(this.c.role!=='employer'||!this.store.meta('fundingPolicy'))return null;
  const dir=path.join(this.store.home,'funding','inbox');if(!fs.existsSync(dir))return null;
  const files=fs.readdirSync(dir).filter(x=>/^[0-9a-f]{64}\.json$/.test(x)).sort();
  ensure(files.length<=1000,'FUNDING_INBOX_LIMIT');
  const start=this.store.meta('fundingInboxCursor',0)%Math.max(1,files.length);
  for(let i=0;i<Math.min(5,files.length);i++) {
   const index=(start+i)%files.length,id=files[index].slice(0,-5);this.store.set('fundingInboxCursor',(index+1)%files.length);
   const old=this.store.db.prepare('SELECT job,closed FROM funding_reservations WHERE offer=?').get(id);if(old?.job!==undefined&&(old.job!==null||old.closed))continue;
   try {const r=await this.check(id);this.store.resolveIncident('service','funding:'+id,'QUALIFIED');return {action:r.state.allowanceUSDC==='0'?'approve-funding':'fund',job:id,offer:r.offer};}
   catch(e){this.store.incident('service','funding:'+id,String(e.message).slice(0,100));}
  }
  return null;
 }
}
