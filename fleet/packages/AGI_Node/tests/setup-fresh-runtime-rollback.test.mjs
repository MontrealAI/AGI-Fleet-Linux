import {preparedSecurityReviewFixture as securityReview,bindPreparedReviewFixture} from './state-preparation-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beginSetupTransaction,restoreSetupTransaction,treeIdentity} from '../compute/setup-transaction.mjs';
const put=(root,name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value),{mode:0o600});
async function fresh(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-fresh-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const profileDir=path.join(root,'profile'),directory=path.join(root,'transaction'),stop=async()=>{},tx=await beginSetupTransaction({profileDir,directory,stop});put(tx.candidate,'openclaw.json',{profile:'reviewed'});put(tx.candidate,'compute-journal.json',{calls:[],requests:[]});const review=bindPreparedReviewFixture(tx,securityReview({},{},{},{}));tx.approve(review);await tx.publish({review,validate:()=>{},seal:()=>{}});return{root,profileDir,directory,stop,tx};}
test('explicit rollback of a completed first installation cannot uninstall and reset accepted work',async t=>{
 const f=await fresh(t);await f.tx.complete(()=>{});put(f.profileDir,'compute-journal.json',{calls:[1],requests:['accepted-after-completion'],remainingAllowance:6});const before=treeIdentity(f.profileDir);
 await assert.rejects(restoreSetupTransaction(f.directory,{stop:f.stop}),/SETUP_ROLLBACK_BACKUP_MISSING/);assert.equal(treeIdentity(f.profileDir),before);assert.equal(fs.existsSync(f.tx.candidate),false);assert.equal(JSON.parse(fs.readFileSync(f.tx.file,'utf8')).state,'safe-stop-required');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.profileDir,'compute-journal.json'),'utf8')),{calls:[1],requests:['accepted-after-completion'],remainingAllowance:6});
 await assert.rejects(beginSetupTransaction({profileDir:f.profileDir,directory:f.directory,stop:f.stop}),/SETUP_ROLLBACK_BACKUP_MISSING/);assert.equal(treeIdentity(f.profileDir),before);
});
test('an interrupted first-install activation-failure rollback retains its whole candidate and resumes automatically',async t=>{
 const f=await fresh(t),rename=fs.renameSync;let interrupted=false;const before=treeIdentity(f.profileDir);
 t.mock.method(fs,'renameSync',(source,target)=>{const result=rename(source,target);if(!interrupted&&source===f.profileDir&&target===f.tx.candidate){interrupted=true;throw Error('INTERRUPTED_NEW_PROFILE_RETENTION');}return result;});
 await assert.rejects(f.tx.complete(()=>{},()=>{throw Error('COMPUTE_POLICY_CHANGED');}),/COMPUTE_POLICY_CHANGED/);assert.equal(interrupted,true);assert.equal(fs.existsSync(f.profileDir),false);assert.equal(treeIdentity(f.tx.candidate),before);t.mock.restoreAll();
 const recovered=await restoreSetupTransaction(f.directory,{stop:f.stop});assert.equal(recovered.state,'rolled-back');assert.equal(recovered.primaryFailureCode,'COMPUTE_POLICY_CHANGED');assert.equal(treeIdentity(f.tx.candidate),before);assert.equal(fs.existsSync(f.profileDir),false);
});
