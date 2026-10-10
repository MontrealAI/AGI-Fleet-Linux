import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {Controller} from '../src/control/controller.mjs';
import {openBackup,sealBackup} from '../src/control/vault.mjs';

const password='PUBLIC GENESIS TEST PASSWORD ONLY';
function disk(home){const out={};function walk(dir){for(const name of fs.readdirSync(dir).sort()){const f=path.join(dir,name);if(fs.statSync(f).isDirectory())walk(f);else out[path.relative(home,f)]=crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');}}walk(home);return out;}
async function fixture(){const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-backup-proof-')),c=new Controller(home);await c.createVault(password);await c.wallet('create',{wordCount:12});return {c,home,async close(){await c.close();fs.rmSync(home,{recursive:true,force:true});}};}
test('download alone cannot admit live backup readiness; actual file verifies read-only',async()=>{const f=await fixture(),{c,home}=f;try{const encrypted=await c.backup(password);assert.throws(()=>c.acknowledgeBackup(),/VERIFY_DOWNLOADED_BACKUP_FIRST/);const before=disk(home),report=await c.verifyBackup(JSON.parse(JSON.stringify(encrypted)),password);assert.equal(report.currentReady,true);assert.equal(report.checks.wallet,true);assert.deepEqual(disk(home),before);assert.ok(!JSON.stringify(report).includes(c.vault.get('walletRecovery').phrase));assert.ok(!JSON.stringify(report).includes(c.vault.get('privateKey')));c.acknowledgeBackup();const s=c.status();assert.equal(s.backup.safelyStored,true);assert.equal(s.backup.verified,true);await c.backup(password);assert.throws(()=>c.acknowledgeBackup(),/VERIFY_DOWNLOADED_BACKUP_FIRST/);}finally{await f.close();}});
test('wrong password, corrupted content, wrong wallet and wrong profile cannot verify',async()=>{const f=await fixture(),{c,home}=f;try{const encrypted=await c.backup(password);const before=disk(home);await c.verifyBackup(encrypted,password);await assert.rejects(c.verifyBackup(encrypted,'incorrect'),/PASSWORD_OR_FILE_INCORRECT/);assert.throws(()=>c.acknowledgeBackup(),/VERIFY_DOWNLOADED_BACKUP_FIRST/);const corrupt=structuredClone(encrypted);corrupt.data=(corrupt.data[0]==='A'?'B':'A')+corrupt.data.slice(1);await assert.rejects(c.verifyBackup(corrupt,password),/PASSWORD_OR_FILE_INCORRECT/);const original=await openBackup(encrypted,password);for(const field of ['wallet','profile','integrity']){const b=structuredClone(original);if(field==='wallet'){b.config.agent='0x1111111111111111111111111111111111111111';delete b.integrity;}if(field==='profile')b.profile.id=crypto.randomUUID();if(field==='integrity')b.integrity.records.config='0'.repeat(64);await assert.rejects(c.verifyBackup(await sealBackup(b,password),password),/BACKUP_(WALLET_MISMATCH|PROFILE_MISMATCH|INTEGRITY)/);}assert.deepEqual(disk(home),before);assert.throws(()=>c.acknowledgeBackup(),/VERIFY_DOWNLOADED_BACKUP_FIRST/);}finally{await f.close();}});
test('historical backup can be inspected but cannot substitute for a current download',async()=>{const f=await fixture(),{c}=f;try{const encrypted=await c.backup(password),old=await openBackup(encrypted,password);delete old.profile;delete old.integrity;const report=await c.verifyBackup(await sealBackup(old,password),password);assert.equal(report.valid,true);assert.equal(report.currentReady,false);assert.throws(()=>c.acknowledgeBackup(),/VERIFY_DOWNLOADED_BACKUP_FIRST/);}finally{await f.close();}});
test('public expected-address comparison reports mismatch without changing wallet',async()=>{const f=await fixture(),{c,home}=f;try{const before=disk(home),address=c.config.agent;assert.equal(c.compareUpgrade(address).match,true);assert.equal(c.compareUpgrade('0x1111111111111111111111111111111111111111').match,false);assert.deepEqual(disk(home),before);}finally{await f.close();}});

test('a replacement download revokes saved backup admission across restart',async()=>{
 const f=await fixture(),{c,home}=f;let reopened;
 try{
  const first=await c.backup(password);await c.verifyBackup(first,password);c.acknowledgeBackup();
  const replacement=await c.backup(password);
  assert.equal(c.settings.backupSaved,false);
  assert.equal(c.status().backup.safelyStored,false);
  await c.close();reopened=new Controller(home);await reopened.unlock(password);
  assert.equal(reopened.settings.backupSaved,false);
  const proof=await reopened.verifyBackup(replacement,password);assert.equal(proof.valid,true);assert.equal(proof.currentReady,false);
  const fresh=await reopened.backup(password);await reopened.verifyBackup(fresh,password);reopened.acknowledgeBackup();
  assert.equal(reopened.settings.backupSaved,true);
 }finally{await reopened?.close();await f.close();}
});

test('live restart and activation reject a missing current backup before any external work',async()=>{
 const f=await fixture(),{c}=f;
 try{
  const shown=await c.revealRecovery(password);c.confirmRecovery({token:shown.token,answers:shown.indices.map(i=>shown.phrase.split(' ')[i])});
  const first=await c.backup(password);await c.verifyBackup(first,password);c.acknowledgeBackup();
  assert.doesNotThrow(()=>c.requireBackupConfirmed());await c.backup(password);
  await assert.rejects(c.start('live'),/BACKUP_REQUIRED/);
  await assert.rejects(c.activate({acknowledgeRisk:true,independentReview:true}),/BACKUP_REQUIRED/);
  assert.equal(c.worker,null);assert.equal(c.desired,false);
 }finally{await f.close();}
});
