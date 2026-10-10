import {validateReviewBudget} from '../src/review-budget.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {validateReviewPolicy} from '../src/review-protection.mjs';
import core from '../src/admission-core/economics/admission.cjs';
const [action,dir,file]=process.argv.slice(2);let store;
try {
 if(!action||action==='--help')console.log('Usage: npm run review-protection -- enroll EXISTING_DATA_DIRECTORY POLICY_JSON\n       npm run review-protection -- status EXISTING_DATA_DIRECTORY\n       npm run review-protection -- enroll-budget EXISTING_DATA_DIRECTORY POLICY_JSON\nStop the Node first. See docs/REVIEW_PROTECTION.md. Enrollment does not activate the wallet.');
 else {
  if(!['enroll','enroll-budget','status'].includes(action)||!fs.existsSync(path.resolve(dir)))throw Error('Use --help.');
  store=new Store(path.resolve(dir));
  if(action==='status')console.log(JSON.stringify({policy:store.meta('reviewProtectionPolicy'),unretainedReviewPolicy:store.meta('unretainedReviewPolicy'),qualificationService:store.meta('qualificationService')},null,2));
  else {
   if(store.pending())throw Error('Observe pending transactions to completion first.');
   const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('Use a regular policy file <=64 KiB.');
   if(action==='enroll-budget'){
    const p=validateReviewBudget(JSON.parse(fs.readFileSync(file,'utf8'))),old=store.meta('unretainedReviewPolicy');

    if(old&&core.digest(old)!==core.digest(p)&&old.epoch===p.epoch)throw Error('Changed policy requires a new epoch; spending history is retained.');
    store.set('unretainedReviewPolicy',p);console.log('Operator-funded review budget enrolled. Review costs may be unrewarded; signed schema 6 qualification is still required for votes.');
   }else{

   const p=validateReviewPolicy(JSON.parse(fs.readFileSync(file,'utf8'))),old=store.meta('reviewProtectionPolicy');
   if(old&&core.digest(p)!==core.digest(old)&&p.epoch===old.epoch)throw Error('Changed policy requires a new epoch; prior spending remains charged.');
   if(old&&(old.escrow.toLowerCase()!==p.escrow.toLowerCase()||old.codeHash!==p.codeHash)&&store.db.prepare("SELECT name FROM sqlite_master WHERE name='protected_review_capacity'").get()&&store.db.prepare('SELECT job FROM protected_review_capacity LIMIT 1').get())throw Error('Preserve the original escrow policy for recorded assignments; use a separately commissioned wallet for a new escrow.');
   store.set('reviewProtectionPolicy',p);
   console.log('Legacy recovery policy enrolled. New retainer activation is disabled.');
   }
  }
 }
}catch(e){console.error(e.message);process.exitCode=1;}finally{store?.close();}
