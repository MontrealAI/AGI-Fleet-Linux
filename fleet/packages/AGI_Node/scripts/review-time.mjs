#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import { Store } from '../src/store.mjs';
import { validatePolicy, ReviewerTimeLedger, verifyFundingWindows, digest, canonical } from '../workforce/review-time.mjs';
import core from '../src/admission-core/economics/admission.cjs';
import companion from '../config/companion-releases.json' with {type:'json'};

const args=process.argv.slice(2),usage='Usage: npm run review-time -- enroll DATA_DIR POLICY.json | status DATA_DIR\nFleet only: policy-digest DATA_DIR | assemble DATA_DIR OFFER_ID RECEIPT1.json RECEIPT2.json RECEIPT3.json | export-agent DATA_DIR OFFER_ID JOB_ID OUTPUT.json\nNode only: keygen PRIVATE_DIR | reserve DATA_DIR REVIEWER_WALLET PRIVATE_KEY.pem REQUEST.json RECEIPT.json | export DATA_DIR OFFER_ID RECEIPT.json | bind DATA_DIR OFFER_ID JOB_ID';
const read=file=>{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>1048576)throw Error('REVIEW_TIME_REGULAR_FILE_REQUIRED');return fs.readFileSync(file);};
let store;
try {
 const [action,dir,...rest]=args;
 if(action==='--help'||!action){console.log(usage);process.exit(0);}
 if(action==='keygen'&&companion.role==='node'&&args.length===2){
  const root=path.resolve(dir),application=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  if(root===application||root.startsWith(application+path.sep))throw Error('REVIEW_TIME_KEY_OUTSIDE_APPLICATION_REQUIRED');
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const priv=path.join(root,'reviewer-time-private.pem'),pub=path.join(root,'reviewer-time-public.pem');
  if(fs.existsSync(priv)||fs.existsSync(pub))throw Error('REVIEW_TIME_KEY_EXISTS');
  const pair=crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(priv,pair.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600,flag:'wx'});
  fs.writeFileSync(pub,pair.publicKey.export({format:'pem',type:'spki'}),{mode:0o644,flag:'wx'});
  console.log('Reviewer key created; put only the public key in the independently reviewed reviewer-time policy.');
 } else {
  if(!['enroll','status','reserve','bind','export','policy-digest','assemble','export-agent'].includes(action)||!fs.existsSync(path.resolve(dir)))throw Error(usage);
  store=new Store(path.resolve(dir));
  if(action==='enroll'&&args.length===3){
   const policy=validatePolicy(JSON.parse(read(rest[0]))),prior=store.meta('reviewTimePolicy');
   if(companion.role==='fleet'){
    const funding=store.meta('fundingPolicy');if(!funding||core.digest(funding)!==policy.fundingPolicySha256||funding.wallet!==policy.employer||funding.manager!==policy.manager||funding.chainId!==policy.chainId)throw Error('REVIEW_TIME_FUNDING_POLICY_SCOPE');
    if(prior&&digest(prior)!==digest(policy)&&store.db.prepare("SELECT name FROM sqlite_master WHERE name='funding_reservations'").get()&&store.db.prepare('SELECT offer FROM funding_reservations WHERE closed=0 LIMIT 1').get())throw Error('REVIEW_TIME_OPEN_FUNDING');
    fs.mkdirSync(path.join(dir,'funding','review-windows'),{recursive:true,mode:0o700});
   } else if(companion.role==='node'){
    const admission=store.meta('admissionPolicy');if(!admission||admission.role!=='reviewer'||admission.chainId!==policy.chainId||admission.manager!==policy.manager||!policy.reviewers.some(x=>x.wallet===admission.wallet))throw Error('REVIEW_TIME_NODE_SCOPE');
    if(prior&&digest(prior)!==digest(policy)&&store.db.prepare("SELECT name FROM sqlite_master WHERE name='reviewer_time_bookings'").get()&&store.db.prepare('SELECT body FROM reviewer_time_bookings WHERE closed=0').all().some(row=>JSON.parse(row.body).finish>Math.floor(Date.now()/1000)))throw Error('REVIEW_TIME_OPEN_BOOKING');
   } else if(companion.role==='agent'){
   const admission=store.meta('admissionPolicy');if(!admission||admission.role!=='agent'||admission.chainId!==policy.chainId||admission.manager!==policy.manager||admission.wallet===policy.employer||policy.reviewers.some(x=>x.wallet===admission.wallet))throw Error('REVIEW_TIME_AGENT_SCOPE');
    if(prior&&digest(prior)!==digest(policy)&&store.db.prepare("SELECT name FROM sqlite_master WHERE name='admission_reservations'").get()&&store.db.prepare('SELECT job FROM admission_reservations WHERE closed=0 LIMIT 1').get())throw Error('REVIEW_TIME_OPEN_APPLICATION');
   } else throw Error('REVIEW_TIME_ROLE');
   if(store.pending())throw Error('REVIEW_TIME_PENDING_TRANSACTION');
   store.set('reviewTimePolicy',policy);console.log('Reviewer-time policy enrolled: '+digest(policy));
  } else if(action==='status'&&args.length===2){
   const policy=store.meta('reviewTimePolicy'),table=companion.role==='node'?'reviewer_time_bookings':'funding_reservations';
   console.log(JSON.stringify({policy,bookings:companion.role==='agent'?[]:store.db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table)?companion.role==='node'?store.db.prepare('SELECT offer,job,body,closed FROM reviewer_time_bookings').all():store.db.prepare('SELECT offer,job,review_windows,closed FROM funding_reservations').all():[]},null,2));
  } else if(action==='policy-digest'&&companion.role==='fleet'&&args.length===2){
   const p=store.meta('fundingPolicy');if(!p)throw Error('REVIEW_TIME_FUNDING_POLICY_REQUIRED');console.log(core.digest(p));
  } else if(action==='assemble'&&companion.role==='fleet'&&args.length>=6&&args.length<=53){
   const [offerId,...files]=rest,policy=store.meta('reviewTimePolicy'),funding=store.meta('fundingPolicy');
   if(!policy||!funding||!(/^[0-9a-f]{64}$/.test(offerId)))throw Error('REVIEW_TIME_FUNDING_SCOPE');
   const packet=JSON.parse(read(path.join(dir,'funding','inbox',offerId+'.json'))).payload;
   const receipts=files.map(file=>JSON.parse(read(file)));
   verifyFundingWindows({policy,fundingPolicy:funding,payload:packet,durationSeconds:packet.commitment.durationSeconds,receipts});
   fs.writeFileSync(path.join(dir,'funding','review-windows',offerId+'.json'),JSON.stringify(receipts,null,2)+'\n',{mode:0o600,flag:'wx'});
   console.log('Reviewer windows assembled; employer funding still rechecks canonical chain state and all other admission limits.');
  } else if(action==='export-agent'&&companion.role==='fleet'&&args.length===5){
   const [offerId,jobId,outFile]=rest;
   const row=store.db.prepare('SELECT job,review_windows FROM funding_reservations WHERE offer=? AND closed=0').get(offerId);
   if(!row||row.job!==jobId||!row.review_windows)throw Error('REVIEW_TIME_JOB_NOT_FUNDED');
   const receipts=JSON.parse(read(path.join(dir,'funding','review-windows',offerId+'.json')));
   if(canonical(receipts.map(x=>x.body))!==row.review_windows)throw Error('REVIEW_TIME_BOOKINGS_CHANGED');
   fs.writeFileSync(outFile,JSON.stringify({offerId,receipts},null,2)+'\n',{mode:0o600,flag:'wx'});
   console.log('Job-specific reviewer evidence exported; deliver to the Agent admission/review-windows directory.');
  } else if(action==='reserve'&&companion.role==='node'&&args.length===6){
   const policy=store.meta('reviewTimePolicy');if(!policy)throw Error('REVIEW_TIME_POLICY_REQUIRED');
   const [wallet,keyFile,requestFile,outFile]=rest;
   const key=crypto.createPrivateKey(read(keyFile)),request=JSON.parse(read(requestFile));
   const receipt=new ReviewerTimeLedger(store,policy).issue(request,key,wallet.toLowerCase());
   fs.writeFileSync(outFile,JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});
   console.log('Signed reviewer booking: '+receipt.body.offerId+'; transfer the receipt to the employer, then bind the confirmed job ID before review.');
  } else if(action==='bind'&&companion.role==='node'&&args.length===4){
   const policy=store.meta('reviewTimePolicy');if(!policy)throw Error('REVIEW_TIME_POLICY_REQUIRED');
   new ReviewerTimeLedger(store,policy).bind(rest[0],rest[1]);
   console.log('Job bound to existing reviewer window; chain and specification are rechecked before review and signing.');
  } else if(action==='export'&&companion.role==='node'&&args.length===4){
   const row=store.db.prepare("SELECT name FROM sqlite_master WHERE name='reviewer_time_bookings'").get()?store.db.prepare('SELECT body,signature FROM reviewer_time_bookings WHERE offer=? AND closed=0').get(rest[0]):null;
   if(!row)throw Error('REVIEW_TIME_UNBOOKED_OFFER');
   fs.writeFileSync(rest[1],JSON.stringify({body:JSON.parse(row.body),signature:row.signature},null,2)+'\n',{mode:0o600,flag:'wx'});
   console.log('Existing signed receipt exported without changing its original booking.');
  } else throw Error(usage);
 }
} catch(e){console.error(e.message);process.exitCode=1;} finally {store?.close();}
