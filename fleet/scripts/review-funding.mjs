import fs from 'node:fs';
import path from 'node:path';
import {Store} from '../ops/store.mjs';
import {acquireLock,canonical} from '../ops/common.mjs';
import {validateReviewFundingPolicy} from '../ops/review-funding.mjs';
const [action,dir,file]=process.argv.slice(2);let store,release;
try{
 if(!action||action==='--help')console.log('Usage: npm run review-funding -- enroll EXISTING_EMPLOYER_DATA POLICY_JSON\n       npm run review-funding -- status EXISTING_EMPLOYER_DATA\nStop the Employer first. Read docs/REVIEW_PROTECTION.md.');
 else{
  if(!['enroll','status'].includes(action)||!fs.existsSync(path.join(path.resolve(dir),'service.sqlite')))throw Error('Use --help.');
  release=acquireLock(path.resolve(dir));store=new Store(path.resolve(dir));
  if(action==='status')console.log(JSON.stringify({policy:store.meta('reviewFundingPolicy')},null,2));
  else{
   if(store.pending())throw Error('Reconcile the pending transaction first.');
   const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('Use a regular policy file <=64 KiB.');
   const p=validateReviewFundingPolicy(JSON.parse(fs.readFileSync(file,'utf8'))),i=store.meta('identity');
   if(i?.role!=='employer'||i.chain!==p.chainId||i.manager.toLowerCase()!==p.manager.toLowerCase()||i.wallet.toLowerCase()!==p.wallet.toLowerCase())throw Error('Policy must match the verified Employer identity.');
   const old=store.meta('reviewFundingPolicy');
   if(old&&canonical(old)!==canonical(p)&&store.db.prepare("SELECT name FROM sqlite_master WHERE name='funding_reservations'").get()&&store.db.prepare('SELECT offer FROM funding_reservations WHERE closed=0').get())throw Error('Close existing funding and review reservations before changing this escrow policy.');
   store.set('reviewFundingPolicy',p);console.log('Legacy escrow recovery policy enrolled. New retainer approval and funding are disabled.');
  }
 }
}catch(e){console.error(e.message);process.exitCode=1;}finally{store?.close();release?.();}
