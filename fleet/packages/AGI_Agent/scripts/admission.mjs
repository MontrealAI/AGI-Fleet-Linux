#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import core from '../src/admission-core/economics/admission.cjs';
const args=process.argv.slice(2);
if(args.length===0||args[0]==='--help') {console.log('Usage: npm run admission -- status DATA_DIRECTORY\n       npm run admission -- enroll DATA_DIRECTORY POLICY_JSON\nStop the worker first. Enrollment records a scoped public-key policy; it never activates a wallet. See docs/ADMISSION.md.');process.exit(0);}
let store;
try {
 const [action,dir,file]=args;if(!['status','enroll'].includes(action)||args.length!==(action==='enroll'?3:2))throw new Error('Use --help.');
 if(!fs.existsSync(path.resolve(dir)))throw new Error('Existing data directory required.');
 store=new Store(path.resolve(dir));
 if(action==='enroll') {
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576)throw new Error('Use a regular policy JSON file <=1 MiB.');
  const policy=JSON.parse(fs.readFileSync(file,'utf8'));core.validatePolicy(policy);if(policy.schemaVersion!==6||policy.reviewPayment!=='operator-budget')throw Error('Live workers require calibrated schema 6 with operator-budget review payment.');
  if(store.pending())throw new Error('Observe the pending transaction to completion first.');
  const previous=store.meta('admissionPolicy');if(previous&&core.digest(previous)!==core.digest(policy)) {
   if(previous.epoch===policy.epoch)throw new Error('Changed policy requires a new epoch.');
  }
  store.set('admissionPolicy',policy);fs.mkdirSync(path.join(dir,'admission','inbox'),{recursive:true,mode:0o700});fs.mkdirSync(path.join(dir,'admission','evidence'),{recursive:true,mode:0o700});
  console.log('Existing reservations are retained across policy epochs. Policy enrolled: '+core.digest(policy)+'. New work also requires valid qualification packets and normal activation.');
 } else {console.log(JSON.stringify({policy:store.meta('admissionPolicy'),runtime:store.meta('runtime'),reservations:store.db.prepare("SELECT name FROM sqlite_master WHERE name='admission_reservations'").get()?store.db.prepare('SELECT job,epoch,exposure,cost,closed FROM admission_reservations').all():[]},null,2));}
} catch(e) {console.error(e.message);process.exitCode=1;} finally {store?.close();}
