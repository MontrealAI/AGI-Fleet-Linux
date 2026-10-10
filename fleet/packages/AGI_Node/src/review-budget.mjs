import {getAddress} from 'ethers';
import core from './admission-core/economics/admission.cjs';
import units from './admission-core/lib/usdc.js';
const cash=x=>BigInt(units.parseUSDC(x));
const ok=(x,c)=>{if(!x)throw Error('REVIEW_BUDGET_'+c);};
export function validateReviewBudget(p){
 ok(p&&Object.keys(p).sort().join(',')===['schemaVersion','epoch','chainId','manager','wallet','maxAttemptCostUSDC','maxEpochCostUSDC','maxJobs','maxAttempts','acknowledgeUnpaidWork'].sort().join(','),'FIELDS');
 ok(p.schemaVersion===1&&p.acknowledgeUnpaidWork===true&&typeof p.epoch==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(p.epoch)&&[1,11155111,31337].includes(p.chainId),'POLICY');
 for(const k of ['wallet','manager'])ok(getAddress(p[k])!=='0x0000000000000000000000000000000000000000','ADDRESS');
 ok(cash(p.maxAttemptCostUSDC)>0n&&cash(p.maxEpochCostUSDC)>=cash(p.maxAttemptCostUSDC),'COST');
 ok(Number.isSafeInteger(p.maxJobs)&&p.maxJobs>=1&&p.maxJobs<=100&&Number.isSafeInteger(p.maxAttempts)&&p.maxAttempts>=1&&p.maxAttempts<=10,'LIMIT');return p;
}
export class ReviewBudget {
 constructor(c,store){Object.assign(this,{c,store});}
 policy(){const p=validateReviewBudget(this.store.meta('unretainedReviewPolicy'));ok(p.chainId===this.c.chainId&&p.manager.toLowerCase()===this.c.manager.toLowerCase()&&p.wallet.toLowerCase()===this.c.validator.toLowerCase(),'SCOPE');return p;}
 consume(job,snapshot){
  const p=this.policy(),policy=core.digest(p);ok(!snapshot.completed&&!snapshot.expired&&!snapshot.disputed,'JOB_CLOSED');
  this.store.db.exec('CREATE TABLE IF NOT EXISTS unretained_reviews(job TEXT PRIMARY KEY,epoch TEXT NOT NULL,policy TEXT NOT NULL,attempts INTEGER NOT NULL,cost TEXT NOT NULL,reserved TEXT NOT NULL)');
  this.store.transaction(()=>{
   const old=this.store.db.prepare('SELECT * FROM unretained_reviews WHERE job=?').get(String(job));ok(!old||old.policy===policy,'POLICY_CHANGED');ok((old?.attempts??0)<p.maxAttempts,'ATTEMPTS');
   const rows=this.store.db.prepare('SELECT reserved FROM unretained_reviews WHERE epoch=?').all(p.epoch),reserve=cash(p.maxAttemptCostUSDC)*BigInt(p.maxAttempts);
   ok(old||rows.length<p.maxJobs,'JOBS');ok(rows.reduce((n,r)=>n+BigInt(r.reserved),0n)+(old?0n:reserve)<=cash(p.maxEpochCostUSDC),'EPOCH');
   this.store.db.prepare('INSERT INTO unretained_reviews VALUES(?,?,?,?,?,?) ON CONFLICT(job) DO UPDATE SET attempts=excluded.attempts,cost=excluded.cost').run(String(job),p.epoch,policy,(old?.attempts??0)+1,((old?BigInt(old.cost):0n)+cash(p.maxAttemptCostUSDC)).toString(),reserve.toString());
  });
 }
 checkCommit(qualification,job){const p=this.policy();ok(qualification?.reviewPayment==='operator-budget'&&qualification?.reviewRetainerUSDC==='0','PAYMENT_ASSUMPTION');ok(cash(qualification.modeledCostUSDC)>=cash(p.maxAttemptCostUSDC)*BigInt(p.maxAttempts),'FORECAST_COST');const row=this.store.db.prepare('SELECT * FROM unretained_reviews WHERE job=?').get(String(job));ok(row&&row.policy===core.digest(p)&&row.epoch===p.epoch&&row.attempts>0,'RESERVATION_REQUIRED');return core.digest(p);}
}
