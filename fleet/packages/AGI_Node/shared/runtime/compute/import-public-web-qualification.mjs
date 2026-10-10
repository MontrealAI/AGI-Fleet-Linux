import {stopLinuxServices,assertLinuxHost} from './linux-host.mjs';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {atomicWrite,canonical,sha256,ensure,privateDir} from '../src/util.mjs';
import {assertComputePolicy,policyHash} from './policy.mjs';
import {publicWebQualificationIdentity,publicWebQualificationCandidateIdentity} from './public-web-qualification-identity.mjs';
import {verifyPublicWebQualification} from './public-web-qualification.mjs';
import {beginSetupTransaction,securityReview,transactionStatus,restoreSetupTransaction} from './setup-transaction.mjs';
import {acquireSetupLock,clearInterruptedLock} from './setup-ledger.mjs';
import {stopManagedServices} from './service-stop.mjs';
import {publicBrowserSocketsStopped} from './public-browser-runtime.mjs';
import {boundedCommand} from './repair.mjs';
import {prepareCandidateState,finishCandidateStatePreparation,isCandidateStatePreparationReceipt} from './setup-state-preparation.mjs';
function read(file,max=1048576){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const st=fs.fstatSync(fd);ensure(st.isFile()&&st.nlink===1&&st.uid===process.getuid?.()&&!(st.mode&0o077)&&st.size<=max,'PUBLIC_WEB_QUALIFICATION_PRIVATE_FILE');return JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}}
const listening=port=>new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.setTimeout(1000);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false);});});
export async function importPublicWebQualification({role,receiptFile,rl,home=os.homedir(),signal,dependencies={}}){
 ensure(['agent','node'].includes(role),'PUBLIC_WEB_QUALIFICATION_ROLE');
 const platform=dependencies.platform??process.platform,arch=dependencies.arch??process.arch,uid=dependencies.uid??process.getuid?.();
 ensure((platform==='darwin'&&arch==='arm64'||platform==='linux'&&['x64','arm64'].includes(arch))&&Number.isSafeInteger(uid)&&uid>0,'PUBLIC_WEB_QUALIFICATION_PHYSICAL_MAC_REQUIRED');
 const profileDir=path.join(home,role==='node'?'.openclaw-agi-node-compute':'.openclaw-agi-compute'),settingsFile=path.join(profileDir,'compute-settings.json');
 const supportDir=path.join(home,'.agi-genesis-setup-'+role),directory=path.join(supportDir,'qualification-transaction');
 clearInterruptedLock(supportDir);const release=acquireSetupLock(supportDir);let transaction;
 const stop=dependencies.stop??(platform==='linux'?()=>stopLinuxServices({home,role,probePort:dependencies.probePort??listening,checkSockets:signal=>publicBrowserSocketsStopped({profileDir,uid,platform,signal})}):()=>stopManagedServices({uid,labels:[role==='node'?'ai.montreal.agi-node-compute':'ai.montreal.agi-compute',role==='node'?'ai.openclaw.agi-node-compute':'ai.openclaw.agi-compute'],ports:role==='node'?[18898,18900]:[18894,18896],run:dependencies.run??boundedCommand,probePort:dependencies.probePort??listening,timeoutMs:dependencies.stopTimeoutMs,pollIntervalMs:dependencies.stopPollIntervalMs,checkSockets:signal=>publicBrowserSocketsStopped({profileDir,uid:dependencies.fileUID??uid,platform:dependencies.runtimePlatform??platform,signal})}));
 try{
  // Recover a interrupted directory swap before reading the potentially missing
  // or not-yet-sealed live settings. Cleanup shutdown is never cancelled midway.
  if(['publishing','published','sealed','safe-stop-required'].includes(transactionStatus(directory).state))await restoreSetupTransaction(directory,{stop});
  const c=read(settingsFile),receipt=read(path.resolve(receiptFile),2*1024*1024),assertPolicy=dependencies.assertPolicy??assertComputePolicy,identity=dependencies.identity??publicWebQualificationIdentity,verify=dependencies.verifyReceipt??verifyPublicWebQualification;
  ensure(c.profileDir===profileDir&&c.role===role&&c.signerUID!==uid&&c.isolationAcknowledged===true&&c.publicWebPolicy?.enabled===true&&['commissioning','qualified'].includes(c.publicWebPolicy.mode)&&c.port===(role==='node'?18898:18894)&&c.gatewayPort===(role==='node'?18900:18896),'PUBLIC_WEB_QUALIFICATION_COMMISSIONING_REQUIRED');
  ensure(!fs.existsSync(path.join(profileDir,'COMPUTE_STOP'))&&!fs.existsSync(path.join(profileDir,'SETUP_PENDING')),'PUBLIC_WEB_QUALIFICATION_RECONCILIATION_REQUIRED');
  assertPolicy(c,{settingsFile});const candidateIdentity=settings=>publicWebQualificationCandidateIdentity(settings,{identity}),expected=candidateIdentity(c),summary=verify(receipt,{...expected,now:Date.now()});
  // STOP is explicit and independently verified; no KeepAlive watcher survives it.
  await stop();assertPolicy(c,{settingsFile});ensure(canonical(candidateIdentity(c))===canonical(expected),'PUBLIC_WEB_QUALIFICATION_IDENTITY_CHANGED');
  const journalFile=path.join(profileDir,'compute-journal.json');if(fs.existsSync(journalFile)){const journal=read(journalFile,4*1024*1024);ensure(Array.isArray(journal.requests)&&!journal.requests.some(r=>['started','web-preparing','web-prepared','web-active','web-closing','cleanup-required'].includes(r.status)||r.publicWeb?.cleanup==='BLOCKED'),'PUBLIC_WEB_QUALIFICATION_RECONCILIATION_REQUIRED');}
  transaction=await beginSetupTransaction({profileDir,directory,stop,signal});
  const next=structuredClone(c),receiptSHA256=sha256(canonical(receipt));
  Object.assign(next.publicWebPolicy,{mode:'qualified',qualificationReceiptFile:path.join(profileDir,'public-web-qualification','receipt.json'),qualificationReceiptSha256:receiptSHA256,qualificationEvidenceSha256:receiptSHA256,qualificationImportedAt:Date.now(),qualificationCandidatePolicyHash:c.policyHash});
  privateDir(path.join(transaction.candidate,'public-web-qualification'));atomicWrite(path.join(transaction.candidate,'public-web-qualification','receipt.json'),JSON.stringify(receipt));
  atomicWrite(path.join(transaction.candidate,'compute-settings.json'),JSON.stringify(next));
  const statePreparation=await (dependencies.prepareCandidateState??prepareCandidateState)({runtime:c,candidate:transaction.candidate,profileDir});
  ensure(isCandidateStatePreparationReceipt(statePreparation),'SETUP_STATE_PREPARATION_RECEIPT_INVALID');
  transaction.state.preparationReceipt=statePreparation;transaction.save();
  (dependencies.finishCandidateStatePreparation??finishCandidateStatePreparation)({candidate:transaction.candidate,profileDir,receipt:statePreparation});
  // A signed technical receipt cannot silently authorize schema or owner changes.
  // Those changes need the full repair review and a newly qualified runtime first.
  ensure(statePreparation.sourceSchemaSha256===statePreparation.destinationSchemaSha256&&statePreparation.sourceContentSha256===statePreparation.destinationContentSha256,'PUBLIC_WEB_QUALIFICATION_REPAIR_REQUIRED');
  const gateway=read(c.gatewayConfig,8*1024*1024),review=transaction.bindReview(securityReview(gateway,gateway,c,next,{statePreparation}));
  console.log(JSON.stringify({scope:'Limited technical browser commissioning',receiptSHA256,executionFingerprint:expected.executionFingerprint,reviewerKeySHA256:sha256(expected.reviewerPublicKey),expiresAt:receipt.payload.expiresAt,residuals:summary.residuals,reviewDigest:review.digest,statePreparation,productionQualified:false,paidSettlementQualified:false},null,2));
  signal?.throwIfAborted();ensure(rl&&(await rl.question('Services are stopped. Review the exact technical qualification transition above. Type IMPORT '+review.digest.slice(0,12)+' to apply: ',{signal})).trim()==='IMPORT '+review.digest.slice(0,12),'PUBLIC_WEB_QUALIFICATION_IMPORT_CANCELLED');
  signal?.throwIfAborted();ensure(canonical(candidateIdentity(c))===canonical(expected),'PUBLIC_WEB_QUALIFICATION_IDENTITY_CHANGED');verify(receipt,{...expected,now:Date.now()});transaction.approve(review);
  await transaction.publish({review,validate:()=>{const current=identity(next);ensure(current.executionFingerprint===expected.executionFingerprint&&canonical(current.sourceHashes)===canonical(expected.sourceHashes),'PUBLIC_WEB_QUALIFICATION_IDENTITY_CHANGED');verify(receipt,{...current,now:Date.now()});},seal:()=>{next.policyHash=(dependencies.policyHash??policyHash)(next);atomicWrite(settingsFile,JSON.stringify(next));}});
  await transaction.complete(()=>{assertPolicy(next,{settingsFile});verify(receipt,{...identity(next),now:Date.now()});});
  return {status:'IMPORTED',scope:'Limited technical browser commissioning',policyHash:next.policyHash,executionFingerprint:expected.executionFingerprint,receiptSHA256,residuals:summary.residuals,services:'STOPPED',productionQualified:false,paidSettlementQualified:false,next:'Restart the existing compute services explicitly, then approve their new identity in the signer account. Existing accepted jobs must retain their original runtime or be re-admitted.'};
 }catch(error){if(transaction&&['publishing','published','sealed','safe-stop-required'].includes(transaction.state.state))await transaction.rollback();throw error;}finally{release();}
}
export async function importPublicWebQualificationMain(args=process.argv.slice(2)){
 if(args.includes('--help')){console.log('Import-Public-Browser-Qualification.command --receipt REVIEWED_RECEIPT.json\nRun in the separate Standard compute account on Apple silicon. Imports or renews an independently signed, current-runtime-bound technical receipt, stops both services, shows the precise review digest, and requires explicit import. No provider call, transaction, automatic restart or production qualification.');return;}
 let role,receiptFile;for(let i=0;i<args.length;i++){if(args[i]==='--role')role=args[++i];else if(args[i]==='--receipt')receiptFile=args[++i];else throw Error('PUBLIC_WEB_QUALIFICATION_ARGUMENT');}ensure(receiptFile,'PUBLIC_WEB_QUALIFICATION_RECEIPT_REQUIRED');
 const abort=new AbortController(),cancel=()=>abort.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);const rl=createInterface({input:process.stdin,output:process.stdout});
 try{console.log(JSON.stringify(await importPublicWebQualification({role,receiptFile,rl,signal:abort.signal}),null,2));}finally{rl.close();process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))importPublicWebQualificationMain().catch(error=>{console.error(/^[A-Z0-9_]+$/.test(error.code??error.message)?error.code??error.message:'PUBLIC_WEB_QUALIFICATION_IMPORT_FAILED');process.exitCode=1;});
