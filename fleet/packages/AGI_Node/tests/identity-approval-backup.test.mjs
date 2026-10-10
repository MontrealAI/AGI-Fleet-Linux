import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {Controller} from '../src/control/controller.mjs';
const role='node',password='Synthetic approval backup regression password!';
const old='0cab1f69064a1bc37e429fa0206ad245a0ef175f0786ce8112dc52bd91165ac8',candidate='fff3d1c45e3545d38969684511b6c47b88b039e53abbc74498673f27ce8016be';
const health={policyCurrent:true,protocol:'agi-compute/v2',role,uid:(process.getuid?.()??0)+1001,auth:'chatgpt-oauth',policyHash:candidate,gatewayReady:true,configuredCapabilities:['desktop','files'],capabilities:['desktop','files']};
const fetchImpl=async url=>url.endsWith('/health')?Response.json(health):Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"status":"ready"}'}}]});
test('interrupted commit cannot become accepted authority through encrypted backup and replacement-profile restore',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-uncertain-backup-')),target=fs.mkdtempSync(path.join(os.tmpdir(),'agi-uncertain-restore-'));
 const source=new Controller(home,{companion:{fetchImpl}}),replacement=new Controller(target);let restarted;
 t.after(async()=>{await source.close();await restarted?.close();await replacement.close();fs.rmSync(home,{recursive:true,force:true});fs.rmSync(target,{recursive:true,force:true});});
 await source.createVault(password);await source.wallet('create');await source.saveCompanion({config:{...source.companion.config,enabled:true,acknowledged:true,mode:'workstation'},token:'c'.repeat(64)});
 source.companion.state.computePolicy=old;source.companion.persist();const priorBackup=await source.backup(password);
 const identity=await source.companionInspectIdentity(),input={policyHash:candidate,proposalID:identity.proposal.id,revision:identity.proposal.revision,acknowledge:true};
 const fsync=fs.fsyncSync;let failed=false;
 fs.fsyncSync=fd=>{if(!failed&&fs.fstatSync(fd).isDirectory()&&JSON.parse(fs.readFileSync(source.companion.stateFile)).computePolicy===candidate){failed=true;throw Object.assign(Error('Synthetic fsync failure'),{code:'EIO'});}return fsync(fd);};
 try{await assert.rejects(source.approveComputeIdentity(input));}finally{fs.fsyncSync=fsync;}
 assert.equal(failed,true);await source.close();restarted=new Controller(home,{companion:{fetchImpl}});assert.equal(restarted.companion.stateError,true);assert.equal(restarted.companion.state.computePolicy,candidate);
 const bytes=fs.readFileSync(restarted.companion.stateFile),marker=fs.readFileSync(restarted.companion.stateFile+'.approval-pending');
 await assert.rejects(restarted.backup(password),/COMPANION_APPROVAL_RECONCILIATION_REQUIRED/);
 await assert.rejects(restarted.verifyBackup(priorBackup,password),/COMPANION_APPROVAL_RECONCILIATION_REQUIRED/);
 await assert.rejects(restarted.restore(priorBackup,password,true),/COMPANION_APPROVAL_RECONCILIATION_REQUIRED/);
 assert.deepEqual(fs.readFileSync(restarted.companion.stateFile),bytes);assert.deepEqual(fs.readFileSync(restarted.companion.stateFile+'.approval-pending'),marker);
 // The older legitimate encrypted backup still restores only its old binding,
 // with AI disabled. No backup carrying uncertain candidate authority was issued.
 await replacement.restore(priorBackup,password,true);assert.equal(replacement.companion.state.computePolicy,old);assert.equal(replacement.companion.config.enabled,false);assert.equal(replacement.companion.state.approvalHistory?.some(x=>x.status==='committed'),undefined);
 assert.equal(fs.existsSync(path.join(target,'assistant-state.json.lease.sqlite')),false,'runtime lease must not be restored into replacement profile');
});

test('restore rechecks uncertainty created during awaited cancellation before replacing any active file',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-racing-backup-')),target=fs.mkdtempSync(path.join(os.tmpdir(),'agi-racing-restore-')),source=new Controller(home),replacement=new Controller(target);
 t.after(async()=>{await source.close();await replacement.close();fs.rmSync(home,{recursive:true,force:true});fs.rmSync(target,{recursive:true,force:true});});
 await source.createVault(password);await source.wallet('create');const backup=await source.backup(password);
 const original=replacement.companion.cancel.bind(replacement.companion),marker=replacement.companion.stateFile+'.approval-pending';
 replacement.companion.cancel=async()=>{await original();fs.writeFileSync(marker,'synthetic retained uncertainty');};
 await assert.rejects(replacement.restore(backup,password,true),/COMPANION_APPROVAL_RECONCILIATION_REQUIRED/);assert.equal(fs.readFileSync(marker,'utf8'),'synthetic retained uncertainty');assert.equal(fs.existsSync(replacement.vault.file),false);assert.equal(fs.existsSync(path.join(target,'restore-in-progress.json')),false);assert.equal(replacement.companion.state.computePolicy,undefined);
 replacement.companion.cancel=original;
});
test('backup verification cannot publish a ready receipt when uncertainty appears during async verification',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-racing-backup-verification-')),source=new Controller(home);t.after(async()=>{await source.close();fs.rmSync(home,{recursive:true,force:true});});
 await source.createVault(password);await source.wallet('create');const backup=await source.backup(password),original=source.requireCertainApprovalPersistence.bind(source);let injected=false;
 source.requireCertainApprovalPersistence=()=>{original();if(!injected){injected=true;queueMicrotask(()=>fs.writeFileSync(source.companion.stateFile+'.approval-pending','synthetic retained uncertainty'));}};
 await assert.rejects(source.verifyBackup(backup,password),/COMPANION_APPROVAL_RECONCILIATION_REQUIRED/);assert.equal(source.backupVerified,null);assert.equal(fs.readFileSync(source.companion.stateFile+'.approval-pending','utf8'),'synthetic retained uncertainty');
});
