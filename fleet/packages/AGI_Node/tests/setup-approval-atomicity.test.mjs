import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beginSetupTransaction,securityReview,treeIdentity,transactionStatus} from '../compute/setup-transaction.mjs';
const preparationReceipt=()=>({schema:'agi-candidate-state-preparation/v1',protocolVersion:1,openclawVersion:'2026.9.5',sourceSchemaSha256:'a'.repeat(64),destinationSchemaSha256:'b'.repeat(64),sourceContentSha256:'c'.repeat(64),destinationContentSha256:'d'.repeat(64),sourceObjectCount:2,destinationObjectCount:3,sourceRowCount:4,destinationRowCount:6,addedSchemaObjects:['table:user_profiles'],addedColumns:['user_profiles.role'],ownerProfileCreated:true,ownerIdentityCreated:true,ownerDisplayNameInitialized:true,ownerDisplayNameSource:'local-owner-fallback',existingRecordsPreserved:true,verified:true});
const get=(root,name)=>fs.readFileSync(path.join(root,name),'utf8');
const put=(root,name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});};
const evidence=root=>{const result={};const visit=dir=>{for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),s=fs.lstatSync(file);if(s.isDirectory())visit(file);else{assert.equal(s.isFile(),true);result[path.relative(root,file)]=fs.readFileSync(file).toString('base64');}}};visit(root);return result;};
async function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-approval-atomicity-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const profileDir=path.join(root,'profile'),directory=path.join(root,'transaction');put(profileDir,'openclaw.json',{profile:'original'});let stopCalls=0;const stop=async()=>{stopCalls++;},tx=await beginSetupTransaction({profileDir,directory,stop});put(tx.candidate,'openclaw.json',{profile:'reviewed'});tx.state.preparationReceipt=preparationReceipt();tx.save();return{root,profileDir,directory,stop,tx,get stopCalls(){return stopCalls;}};}
const review=tx=>tx.bindReview(securityReview({},{},{},{},{statePreparation:tx.state.preparationReceipt}));

test('a rejected security projection leaves every prior approval field unchanged in memory and on disk',async t=>{
 const f=await fixture(t);put(f.tx.candidate,'state/openclaw.sqlite','invalid SQLite fixture');const r=review(f.tx),before=structuredClone(f.tx.state),receipt=get(f.directory,'transaction.json');let failure;
 assert.throws(()=>f.tx.approve(r),error=>{failure=error;assert.equal(error.message,'SETUP_STATE_FILE_UNSUPPORTED');return true;});assert.deepEqual(f.tx.state,before);assert.equal(get(f.directory,'transaction.json'),receipt);assert.equal(fs.existsSync(path.join(f.directory,'approval-write-intent.json')),false);f.tx.recordFailure(failure);const saved=JSON.parse(get(f.directory,'transaction.json'));assert.equal(saved.state,'prepared');assert.equal(saved.approval,null);assert.equal(saved.approvedIdentity,null);assert.equal(saved.approvedSecurityRecord,undefined);assert.equal(transactionStatus(f.directory).approved,false);
});

test('approval becomes visible in memory only after the full receipt is durably saved',async t=>{
 const f=await fixture(t),r=review(f.tx),rename=fs.renameSync;let observed=false;
 t.mock.method(fs,'renameSync',(source,target)=>{if(target===f.tx.file&&JSON.parse(fs.readFileSync(source,'utf8')).state==='approved'){observed=true;assert.equal(f.tx.state.state,'prepared');assert.equal(f.tx.state.approval,null);assert.equal(fs.existsSync(path.join(f.directory,'approval-write-intent.json')),true);}return rename(source,target);});
 f.tx.approve(r);assert.equal(observed,true);assert.equal(f.tx.state.state,'approved');assert.equal(f.tx.state.approval,r.digest);assert.deepEqual(JSON.parse(get(f.directory,'transaction.json')),f.tx.state);assert.equal(fs.existsSync(path.join(f.directory,'approval-write-intent.json')),false);assert.equal(transactionStatus(f.directory).approved,true);
});

for(const boundary of ['before-receipt-rename','after-receipt-rename','after-receipt-fsync','after-intent-removal','intent-write'])test(`approval I/O failure at ${boundary} blocks publication and archives the exact failed attempt`,async t=>{
 const f=await fixture(t),r=review(f.tx),rename=fs.renameSync,unlink=fs.unlinkSync,fsync=fs.fsyncSync,live=treeIdentity(f.profileDir);let injected=false,committed=false;
 t.mock.method(fs,'renameSync',(source,target)=>{const approval=target===f.tx.file&&JSON.parse(fs.readFileSync(source,'utf8')).state==='approved';if(!injected&&(boundary==='before-receipt-rename'&&approval||boundary==='intent-write'&&target===path.join(f.directory,'approval-write-intent.json'))){injected=true;throw Error('PRIVATE_APPROVAL_IO_CANARY');}const value=rename(source,target);if(approval)committed=true;if(!injected&&boundary==='after-receipt-rename'&&approval){injected=true;throw Error('PRIVATE_APPROVAL_IO_CANARY');}return value;});
 t.mock.method(fs,'fsyncSync',fd=>{if(!injected&&boundary==='after-receipt-fsync'&&committed){injected=true;throw Error('PRIVATE_APPROVAL_IO_CANARY');}return fsync(fd);});
 t.mock.method(fs,'unlinkSync',file=>{const value=unlink(file);if(!injected&&boundary==='after-intent-removal'&&file===path.join(f.directory,'approval-write-intent.json')){injected=true;throw Error('PRIVATE_APPROVAL_IO_CANARY');}return value;});
 assert.throws(()=>f.tx.approve(r),error=>error.message==='SETUP_APPROVAL_WRITE_FAILED');assert.equal(injected,true);assert.equal(f.tx.state.state,'prepared');assert.equal(f.tx.state.approval,null);assert.equal(f.tx.state.approvedIdentity,null);assert.equal(f.tx.state.approvalWriteFailed,true);assert.equal(fs.existsSync(path.join(f.directory,'approval-write-intent.json')),true);assert.equal(transactionStatus(f.directory).approved,false);const calls=f.stopCalls;
 await assert.rejects(f.tx.publish({review:r,validate:()=>assert.fail(),seal:()=>assert.fail()}),/SETUP_APPROVAL_WRITE_FAILED/);assert.equal(f.stopCalls,calls);assert.equal(treeIdentity(f.profileDir),live);assert.equal(get(f.directory,'transaction.json').includes('PRIVATE_APPROVAL_IO_CANARY'),false);const retained=JSON.parse(get(f.directory,'approval-evidence/transaction-after-write-failure.json'));assert.equal(retained.state,committed?'approved':'prepared');assert.equal(fs.statSync(path.join(f.directory,'approval-evidence/transaction-after-write-failure.json')).mode&0o777,0o600);t.mock.restoreAll();
 const original=evidence(f.directory),next=await beginSetupTransaction({...f,stop:f.stop});assert.notEqual(next.state.id,f.tx.state.id);assert.equal(next.state.preparationProtocolVersion,1);assert.equal(next.state.approval,null);assert.equal(treeIdentity(f.profileDir),live);assert.deepEqual(evidence(f.directory+'-archive-'+f.tx.state.id),original);
});

test('persistent receipt write failure retains the intent and cannot resume an apparently prepared attempt',async t=>{
 const f=await fixture(t),r=review(f.tx),rename=fs.renameSync;
 t.mock.method(fs,'renameSync',(source,target)=>{if(target===f.tx.file)throw Error('PRIVATE_PERSISTENT_IO_CANARY');return rename(source,target);});assert.throws(()=>f.tx.approve(r),error=>error.message==='SETUP_APPROVAL_WRITE_FAILED'&&error.failureRecordingFailed===true);assert.equal(JSON.parse(get(f.directory,'transaction.json')).approvalWriteFailed,undefined);assert.equal(fs.existsSync(path.join(f.directory,'approval-write-intent.json')),true);assert.equal(transactionStatus(f.directory).approved,false);t.mock.restoreAll();const before=evidence(f.directory),next=await beginSetupTransaction({...f,stop:f.stop});assert.notEqual(next.state.id,f.tx.state.id);assert.deepEqual(evidence(f.directory+'-archive-'+f.tx.state.id),before);
});

for(const phase of ['prepared','approved'])test(`a prior-protocol ${phase} receipt is preserved intact and receives a fresh preparation transaction`,async t=>{
 const f=await fixture(t);if(phase==='approved')f.tx.approve(review(f.tx));else{f.tx.state.approval='a'.repeat(64);f.tx.state.approvedIdentity='b'.repeat(64);f.tx.state.authStaging=[];put(f.tx.candidate,'partial-approval-evidence.json',{preserved:true});}delete f.tx.state.preparationProtocolVersion;delete f.tx.state.preparationReceipt;f.tx.save();const before=evidence(f.directory),live=treeIdentity(f.profileDir);const next=await beginSetupTransaction({...f,stop:f.stop});assert.notEqual(next.state.id,f.tx.state.id);assert.equal(next.state.preparationProtocolVersion,1);assert.equal(next.state.approval,null);assert.deepEqual(evidence(f.directory+'-archive-'+f.tx.state.id),before);assert.equal(treeIdentity(f.profileDir),live);
});

test('an unknown preparation protocol fails before services or evidence can be changed',async t=>{
 const f=await fixture(t);f.tx.state.preparationProtocolVersion=99;f.tx.save();const before=evidence(f.directory),calls=f.stopCalls;await assert.rejects(beginSetupTransaction({...f,stop:f.stop}),/SETUP_PREPARATION_PROTOCOL_VERSION/);assert.equal(f.stopCalls,calls);assert.deepEqual(evidence(f.directory),before);
});



test('the security review binds preparation effects and rejects omitted, changed or credential-bearing receipts',async t=>{
 const f=await fixture(t),receipt=preparationReceipt();f.tx.state.preparationReceipt=receipt;f.tx.save();
 assert.throws(()=>f.tx.bindReview(securityReview({},{},{},{})),/SETUP_STATE_PREPARATION_REVIEW_INVALID/);assert.throws(()=>securityReview({},{},{},{},{statePreparation:{...receipt,secret:'PRIVATE_REVIEW_CANARY'}}),/SETUP_STATE_PREPARATION_REVIEW_INVALID/);
 const unbound=securityReview({},{},{},{},{statePreparation:receipt}),r=f.tx.bindReview(unbound);assert.deepEqual(r.statePreparation,receipt);const change=r.changes.find(value=>value.path==='preparation.sharedState');assert.equal(change.afterValue.addedSchemaObjects,1);assert.deepEqual(change.afterValue.addedColumns,['user_profiles.role']);assert.equal(change.afterValue.existingRecordsPreserved,true);assert.equal(change.afterValue.ownerDisplayNameSource,'local-owner-fallback');
 const altered=structuredClone(r);altered.statePreparation.destinationRowCount++;assert.throws(()=>f.tx.approve(altered),/SETUP_REVIEW_STALE/);assert.equal(f.tx.state.approval,null);f.tx.state.preparationReceipt={...receipt,destinationRowCount:7};assert.throws(()=>f.tx.approve(r),/SETUP_REVIEW_STALE/);f.tx.state.preparationReceipt=receipt;f.tx.approve(r);assert.equal(f.tx.state.approval,r.digest);
 f.tx.state.preparationReceipt={...receipt,destinationRowCount:7};await assert.rejects(f.tx.publish({review:r,validate:()=>assert.fail(),seal:()=>assert.fail()}),/SETUP_REVIEW_STALE/);
});

for(const retained of ['in-progress-marker','successful-receipt','approved-receipt'])test(`a ${retained} preserves first preparation effects by archiving the entire candidate before a new attempt`,async t=>{
 const f=await fixture(t);put(f.tx.candidate,'preparation-only-evidence.json',{preserved:true});
 if(retained==='in-progress-marker'){delete f.tx.state.preparationReceipt;f.tx.save();put(f.directory,'state-preparation-in-progress.json',{schema:'preparation-test-fixture',transactionId:f.tx.state.id});}
 else{f.tx.state.preparationReceipt=preparationReceipt();f.tx.save();if(retained==='approved-receipt')f.tx.approve(f.tx.bindReview(securityReview({},{},{},{},{statePreparation:f.tx.state.preparationReceipt})));}
 const before=evidence(f.directory),live=treeIdentity(f.profileDir),next=await beginSetupTransaction({...f,stop:f.stop});assert.notEqual(next.state.id,f.tx.state.id);assert.equal(next.state.preparationProtocolVersion,1);assert.equal(next.state.preparationReceipt,undefined);assert.equal(next.state.approval,null);assert.equal(fs.existsSync(path.join(next.candidate,'preparation-only-evidence.json')),false);assert.equal(treeIdentity(f.profileDir),live);assert.deepEqual(evidence(f.directory+'-archive-'+f.tx.state.id),before);
});

test('preparation protocol 1 cannot bind an approval without its verified preparation receipt',async t=>{
 const f=await fixture(t);delete f.tx.state.preparationReceipt;f.tx.save();const before=get(f.directory,'transaction.json');assert.throws(()=>f.tx.bindReview(securityReview({},{},{},{})),/SETUP_STATE_PREPARATION_REVIEW_INVALID/);assert.equal(get(f.directory,'transaction.json'),before);assert.equal(f.tx.state.approval,null);
});
for(const phase of ['bind','approve','publish'])test(`an unfinished preparation marker blocks ${phase} even when its receipt was saved`,async t=>{
 const f=await fixture(t),unbound=securityReview({},{},{},{},{statePreparation:f.tx.state.preparationReceipt}),bound=f.tx.bindReview(unbound);if(phase==='publish')f.tx.approve(bound);put(f.directory,'state-preparation-in-progress.json',{transactionId:f.tx.state.id,unfinished:true});const before=get(f.directory,'transaction.json'),live=treeIdentity(f.profileDir),calls=f.stopCalls;
 if(phase==='bind')assert.throws(()=>f.tx.bindReview(unbound),/SETUP_STATE_PREPARATION_REVIEW_INVALID/);else if(phase==='approve')assert.throws(()=>f.tx.approve(bound),/SETUP_STATE_PREPARATION_REVIEW_INVALID/);else await assert.rejects(f.tx.publish({review:bound,validate:()=>assert.fail(),seal:()=>assert.fail()}),/SETUP_STATE_PREPARATION_REVIEW_INVALID/);assert.equal(get(f.directory,'transaction.json'),before);assert.equal(treeIdentity(f.profileDir),live);assert.equal(f.stopCalls,calls);
});
