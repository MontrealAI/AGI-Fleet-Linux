import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadReleaseProfile,upgradeStatus,assertRestoreWallet} from '../src/control/release-profile.mjs';
import {Controller} from '../src/control/controller.mjs';

const role='node',field='validator',password='PUBLIC PROFILE REGRESSION FIXTURE ONLY';
const walletA='0x1111111111111111111111111111111111111111',walletB='0x2222222222222222222222222222222222222222';
test('blank historical identity pins the first wallet and rejects later substitution without rewriting it',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-profile-pin-'));
 try{
  const opts={role,version:'fixture-new',address:'',kind:'original'};
  const first=loadReleaseProfile(home,opts).profile;assert.equal(first.expectedAddress,null);
  const file=path.join(home,'release-profile.json');fs.writeFileSync(file,JSON.stringify({...first,expectedAddress:'',version:'fixture-old'}));
  const current=loadReleaseProfile(home,{...opts,address:walletA}).profile;
  assert.equal(current.expectedAddress,walletA);assert.equal(current.id,first.id);
  assert.equal(upgradeStatus(current,walletA,false).match,true);
  assert.equal(upgradeStatus({...current,expectedAddress:''},walletA,false).match,true);
  const before=fs.readFileSync(file);assert.throws(()=>loadReleaseProfile(home,{...opts,address:walletB}),/UPGRADE_WALLET_MISMATCH/);assert.deepEqual(fs.readFileSync(file),before);
  assert.throws(()=>assertRestoreWallet(current,'',walletB),/RESTORE_WALLET_PROFILE_MISMATCH/);
  assert.throws(()=>assertRestoreWallet({...current,expectedAddress:null},walletA,walletB),/RESTORE_WALLET_PROFILE_MISMATCH/);
  assert.throws(()=>assertRestoreWallet(current,walletA,''),/RESTORE_WALLET_PROFILE_MISMATCH/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('restore preserves an existing wallet on mismatch; same-wallet and fresh-profile restores survive restart',async()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'agi-profile-restore-'));
 const firstHome=path.join(parent,'first'),otherHome=path.join(parent,'other'),freshHome=path.join(parent,'fresh');
 let first,other,fresh;
 try{
  first=new Controller(firstHome);await first.createVault(password);await first.wallet('create',{wordCount:12});
  const address=first.config[field],ownBackup=await first.backup(password);await first.close();first=new Controller(firstHome);await first.unlock(password);
  assert.equal(first.releaseProfile.expectedAddress,address);
  other=new Controller(otherHome);await other.createVault(password);await other.wallet('create',{wordCount:12});const otherAddress=other.config[field],otherBackup=await other.backup(password);
  const files=['vault.json',path.basename(first.configFile),'release-profile.json'];const before=files.map(f=>fs.readFileSync(path.join(firstHome,f)));
  await assert.rejects(first.restore(otherBackup,password,true),/RESTORE_WALLET_PROFILE_MISMATCH/);
  assert.equal(first.config[field],address);assert.deepEqual(files.map(f=>fs.readFileSync(path.join(firstHome,f))),before);
  await first.restore(ownBackup,password,true);await first.close();first=new Controller(firstHome);await first.unlock(password);assert.equal(first.config[field],address);
  fresh=new Controller(freshHome);await fresh.restore(otherBackup,password,true);await fresh.close();fresh=new Controller(freshHome);await fresh.unlock(password);assert.equal(fresh.config[field],otherAddress);assert.equal(fresh.releaseProfile.expectedAddress,otherAddress);
 }finally{await first?.close();await other?.close();await fresh?.close();fs.rmSync(parent,{recursive:true,force:true});}
});
