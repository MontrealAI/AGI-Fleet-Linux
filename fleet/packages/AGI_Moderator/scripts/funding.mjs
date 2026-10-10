import fs from 'node:fs';
import path from 'node:path';
import {Store} from '../ops/store.mjs';
import {acquireLock} from '../ops/common.mjs';
import {boundedFile} from '../ops/funding.mjs';
import core from '../packages/AGI_Agent/src/admission-core/economics/admission.cjs';
const args=process.argv.slice(2);let store,release;
try {
 if(args.length===0||args[0]==='--help') {
  console.log('Usage: npm run funding -- enroll EXISTING_EMPLOYER_DATA POLICY_JSON\n       npm run funding -- status EXISTING_EMPLOYER_DATA\nStop the Employer service first. Enrollment authorizes bounded intake only while normal wallet activation is valid. Read docs/FUNDING.md.');
 }else {
  const [action,dir,file]=args;if(!['enroll','status'].includes(action)||args.length!==(action==='enroll'?3:2))throw Error('Use --help.');
  const home=path.resolve(dir);if(!fs.existsSync(path.join(home,'service.sqlite')))throw Error('Use the existing Employer data directory.');
  release=acquireLock(home);store=new Store(home);
  if(action==='enroll') {
   if(store.pending())throw Error('Observe pending transactions to completion first.');
   const policy=JSON.parse(boundedFile(file));core.validatePolicy(policy);if(policy.schemaVersion!==7||policy.reviewPayment!=='operator-budget')throw Error('Calibrated schema 7 operator-budget employer policy required.');
   const identity=store.meta('identity');if(!identity||identity.role!=='employer'||identity.chain!==policy.chainId||identity.wallet.toLowerCase()!==policy.wallet||identity.manager.toLowerCase()!==policy.manager)throw Error('Policy must match this verified Employer identity.');
   const previous=store.meta('fundingPolicy');if(previous&&core.digest(previous)!==core.digest(policy)&&previous.epoch===policy.epoch)throw Error('Policy changes require a new budget epoch. Existing reservations and epoch spending are retained.');
   store.set('fundingPolicy',policy);for(const sub of ['inbox','evidence'])fs.mkdirSync(path.join(home,'funding',sub),{recursive:true,mode:0o700});
   console.log('Funding policy enrolled. Place signed offer envelopes and measured evidence in the funding folders. Resume the Employer in observation before activating intake.');
  }else {
   const table=store.db.prepare("SELECT name FROM sqlite_master WHERE name='funding_reservations'").get();
   console.log(JSON.stringify({policy:store.meta('fundingPolicy'),reservations:table?store.db.prepare('SELECT offer,job,epoch,exposure,cost,capacity,closed FROM funding_reservations').all():[]},null,2));
  }
 }
}catch(e){console.error(e.message);process.exitCode=1;}finally{store?.close();release?.();}
