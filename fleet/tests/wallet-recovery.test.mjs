import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Wallet, HDNodeWallet } from 'ethers';
import { Controller } from '../ops/controller.mjs';
import { createServer } from '../ops/server.mjs';
import { config, temp, addr } from './helpers.mjs';
import { openBackup, sealBackup } from '../packages/AGI_Node/src/control/vault.mjs';
import { seedProfileHome } from '../packages/AGI_Node/src/control/wallet-profile.mjs';
import { serviceLabel } from '../ops/os.mjs';
const password = 'PUBLIC wallet test fixture only 2026';
const phrase = 'abandon '.repeat(11) + 'about';
const address = HDNodeWallet.fromPhrase(phrase).address;
async function fixture(role='employer') {
  const home=temp(), c=new Controller(home,role); await c.unlock(password);
  return {home,c,async close(){await c.close();fs.rmSync(home,{recursive:true,force:true});}};
}
async function confirm(c) {
  const r=await c.revealRecovery(password);
  return c.confirmRecovery({token:r.token,answers:r.indices.map(i=>r.phrase.split(' ')[i]),passphrase:c.vault.get('walletRecovery').passphrase});
}
for(const role of ['employer','moderator','recovery']) test(`${role}: dedicated 24-word wallet, encrypted secrets and protected verification`, async()=>{
  const f=await fixture(role),{c}=f;
  try {
    const result=await c.wallet('create'),r=c.vault.get('walletRecovery');
    assert.equal(r.phrase.split(' ').length,24); assert.equal(result.address,c.config.wallet);
    for(const value of [result,c.snapshot(),fs.readFileSync(c.vault.file,'utf8')]) {
      assert.ok(!JSON.stringify(value).includes(r.phrase)); assert.ok(!JSON.stringify(value).includes(c.vault.get('privateKey')));
    }
    assert.equal(fs.statSync(c.vault.file).mode & 0o777,0o600);
    await assert.rejects(c.revealRecovery('wrong'),/PASSWORD_OR_FILE_INCORRECT/);
    assert.throws(()=>c.requireRecoveryConfirmed(),/RECOVERY_CONFIRMATION_REQUIRED/);
    c.pin={}; await assert.rejects(c.activate({}),/RECOVERY_CONFIRMATION_REQUIRED/);
    await assert.rejects(c.start('live'),/RECOVERY_CONFIRMATION_REQUIRED/); c.pin=null;
    await confirm(c); assert.throws(()=>c.requireRecoveryConfirmed(),/BACKUP_REQUIRED/);
    assert.throws(()=>c.acknowledgeBackup(),/DOWNLOAD_BACKUP_FIRST/);
    await c.verifyBackup(await c.backup(password),password); c.acknowledgeBackup(); assert.doesNotThrow(()=>c.requireRecoveryConfirmed());
    await c.lock(); await c.unlock(password); assert.equal(c.snapshot().walletRecovery.confirmed,true);
  } finally {await f.close();}
});
test('evidence remains keyless and cannot create or import seed wallets',async()=>{
  const f=await fixture('evidence'),{c}=f;
  try {
    await assert.rejects(c.wallet('create'),/EVIDENCE_HAS_NO_SIGNING_KEY/);
    await assert.rejects(c.wallet('phrase',{phrase,expectedAddress:address,acknowledgeHistory:true}),/EVIDENCE_HAS_NO_SIGNING_KEY/);
    assert.equal(c.snapshot().walletRecovery.type,'none');
    c.vault.set({privateKey:HDNodeWallet.fromPhrase(phrase).privateKey});await c.lock();
    await assert.rejects(c.unlock(password),/EVIDENCE_HAS_NO_SIGNING_KEY/);assert.equal(c.vault.unlocked,false);
  } finally {await f.close();}
});
test('fresh profile backup restores wallet before deployment setup and survives reopening',async()=>{
  const f=await fixture(), target=temp();let d=new Controller(target,'employer');
  try {
    await f.c.wallet('create',{wordCount:12});await confirm(f.c);
    const record=f.c.vault.get('walletRecovery');
    await d.restore(await f.c.backup(password),password);
    await d.unlock(password);assert.deepEqual(d.vault.get('walletRecovery'),record);
    assert.equal(d.snapshot().backupSaved,false);assert.equal(d.snapshot().paused,true);
    await d.close();d=new Controller(target,'employer');await d.unlock(password);
    assert.equal(d.config.wallet,f.c.config.wallet);assert.equal(d.config.manager,'');
  } finally {await d.close();fs.rmSync(target,{recursive:true,force:true});await f.close();}
});
test('backup retains pending signed transaction, bond reservation, claim history and identity',async()=>{
  const f=await fixture('recovery'),target=temp(),d=new Controller(target,'recovery'),{c}=f;
  try {
    await c.wallet('create');await confirm(c);
    await c.save(config('recovery',{wallet:c.config.wallet}),{});
    c.store.set('identity',{chain:c.config.chainId,manager:c.config.manager,wallet:c.config.wallet,role:'recovery'});
    c.store.set('initialNonce',3);
    c.store.reserve({hash:'0xabc',raw:'fixture signed transaction',nonce:3,action:'refund',job:'8',gas_budget:'100',bond:'5000000',created:1,binding:'fixture'});
    c.store.claim(addr(8),123456789n);
    const tx=c.store.pending(),claim=c.store.db.prepare('SELECT * FROM claims').get();
    await d.restore(await c.backup(password),password);await d.unlock(password);
    assert.deepEqual(d.store.pending(),tx);assert.deepEqual(d.store.db.prepare('SELECT * FROM claims').get(),claim);
    assert.deepEqual(d.store.meta('identity'),c.store.meta('identity'));
    assert.equal(d.store.meta('activation'),null);assert.equal(d.store.meta('autostart'),null);
    assert.equal(d.config.wallet,c.config.wallet);
  } finally {await d.close();fs.rmSync(target,{recursive:true,force:true});await f.close();}
});
test('legacy wallet and old separate-password backup retain address without invented phrase',async()=>{
  const f=await fixture(),target=temp(),d=new Controller(target,'employer'),{c}=f;
  try {
    const wallet=new Wallet('0x'+'46'.repeat(32));
    await c.save(config('employer',{wallet:wallet.address}),{privateKey:wallet.privateKey});
    assert.equal(c.snapshot().walletRecovery.type,'private-key');assert.throws(()=>c.requireRecoveryConfirmed(),/BACKUP_REQUIRED/);
    await c.verifyBackup(await c.backup(password),password);c.acknowledgeBackup();assert.doesNotThrow(()=>c.requireRecoveryConfirmed());
    await assert.rejects(c.revealRecovery(password),/RECOVERY_PHRASE_UNAVAILABLE/);
    await assert.rejects(c.wallet('create'),/WALLET_ALREADY_CONFIGURED/);
    const old=await openBackup(await c.backup(password),password);delete old.vaultPasswordMatchesBackup;delete old.configured;delete old.operational;old.schema='agi-fleet-backup/v1';
    await d.restore(await sealBackup(old,'PUBLIC DIFFERENT BACKUP PASSWORD'),'PUBLIC DIFFERENT BACKUP PASSWORD');
    await d.unlock(password);assert.equal(d.config.wallet,wallet.address);assert.equal(d.snapshot().walletRecovery.type,'private-key');
  } finally {await d.close();fs.rmSync(target,{recursive:true,force:true});await f.close();}
});
test('saved seed identity cannot be overwritten through legacy config form',async()=>{
  const f=await fixture(),{c}=f;
  try {
    await c.wallet('create');const original=c.config.wallet,key=c.vault.get('privateKey');
    await c.save(config('employer',{wallet:original}),{});
    const different=new Wallet('0x'+'46'.repeat(32));
    await assert.rejects(c.save(config('employer',{wallet:different.address}),{privateKey:different.privateKey}),/WALLET_ALREADY_CONFIGURED/);
    assert.equal(c.config.wallet,original);assert.equal(c.vault.get('privateKey'),key);
    await c.save(config('employer',{wallet:original}),{privateKey:key});assert.equal(c.snapshot().walletRecovery.type,'bip39');
  } finally {await f.close();}
});
test('phrase import validates original address and passphrase, persists history guard before key write',async()=>{
  const f=await fixture(),{c}=f;
  try {
    await assert.rejects(c.wallet('phrase',{phrase,expectedAddress:address}),/ACKNOWLEDGEMENT/);
    await assert.rejects(c.wallet('phrase',{phrase,passphrase:'wrong',expectedAddress:address,acknowledgeHistory:true}),/ADDRESS_MISMATCH/);
    const set=c.vault.set.bind(c.vault);c.vault.set=()=>{throw Error('DISK_FIXTURE');};
    await assert.rejects(c.wallet('phrase',{phrase,expectedAddress:address,acknowledgeHistory:true}),/DISK_FIXTURE/);
    assert.equal(c.store.meta('phraseRecoveryNeedsHistory'),true);assert.equal(c.vault.get('privateKey'),undefined);
    c.vault.set=set;
    await c.wallet('phrase',{phrase,expectedAddress:address,acknowledgeHistory:true});
    await confirm(c);await c.verifyBackup(await c.backup(password),password);c.acknowledgeBackup();
    assert.throws(()=>c.requireRecoveryConfirmed(),/RECOVERY_HISTORY_REQUIRED/);
    let nonce=7;
    c.openChain=async()=>({enroll:async()=>({manager:addr(10),chainId:31337}),provider:{getTransactionCount:async()=>nonce}});
    await assert.rejects(c.enroll(),/RECOVERY_HISTORY_REQUIRED/);assert.equal(c.store.meta('initialNonce'),null);
    nonce=0;await c.enroll();assert.doesNotThrow(()=>c.requireRecoveryConfirmed());
    assert.equal(c.store.meta('initialNonce'),0);
  } finally {await f.close();}
});
test('confirmation is single use, expires, and lock clears challenges',async()=>{
  const f=await fixture(),{c}=f;
  try {
    await c.wallet('create');const shown=await c.revealRecovery(password);
    assert.throws(()=>c.confirmRecovery({token:shown.token,answers:['wrong','wrong','wrong']}),/WORDS_INCORRECT/);
    assert.throws(()=>c.confirmRecovery({token:shown.token,answers:[]}),/CHALLENGE_EXPIRED/);
    await c.revealRecovery(password);c.recoveryChallenge.expiresAt=0;
    assert.throws(()=>c.confirmRecovery({token:c.recoveryChallenge.token,answers:[]}),/CHALLENGE_EXPIRED/);
    await c.revealRecovery(password);await c.lock();assert.equal(c.recoveryChallenge,null);
  } finally {await f.close();}
});
test('interrupted wallet install repairs only missing public address; mismatched seed blocks unlock',async()=>{
  const f=await fixture(),{c}=f;
  try {
    await c.wallet('create');const expected=c.config.wallet;c.config.wallet='';c.store.set('walletAddress',null);
    await c.lock();await c.unlock(password);assert.equal(c.config.wallet,expected);
    c.vault.set({walletRecovery:{...c.vault.get('walletRecovery'),address}});await c.lock();
    await assert.rejects(c.unlock(password),/RECOVERY_RECORD_MISMATCH/);assert.equal(c.vault.unlocked,false);
  } finally {await f.close();}
});
test('bad inner vault, database identity and interrupted restore are refused',async()=>{
  const f=await fixture(),target=temp(),d=new Controller(target,'employer'),{c}=f;
  try {
    await c.wallet('create');await c.save(config('employer',{wallet:c.config.wallet}),{});
    const b=await openBackup(await c.backup(password),password);b.config.wallet=addr(6);
    await assert.rejects(d.restore(await sealBackup(b,password),password),/BACKUP_WALLET_MISMATCH/);assert.equal(d.vault.exists,false);
    c.store.set('identity',{chain:31337,manager:addr(10),wallet:addr(6),role:'employer'});
    await assert.rejects(c.backup(password),/RECOVERY_RECORD_MISMATCH/);
    fs.writeFileSync(path.join(target,'restore-in-progress.json'),'{}');
    await assert.rejects(d.unlock(password),/RESTORE_INTERRUPTED_RECOVERY_REQUIRED/);
    assert.throws(()=>new Controller(target,'employer'),/RESTORE_INTERRUPTED_RECOVERY_REQUIRED/);
  } finally {await d.close();fs.rmSync(target,{recursive:true,force:true});await f.close();}
});
test('separate seed profile leaves original encrypted wallet and journal intact',async()=>{
  const f=await fixture(),{c}=f;const home=seedProfileHome(f.home),d=new Controller(home,'employer');
  try {
    await c.wallet('create');c.store.set('retainedClaim','original only');const before=fs.readFileSync(c.vault.file);
    await d.unlock(password);await d.wallet('create');
    assert.notEqual(d.config.wallet,c.config.wallet);assert.deepEqual(fs.readFileSync(c.vault.file),before);
    assert.equal(c.store.meta('retainedClaim'),'original only');assert.equal(d.store.meta('retainedClaim'),null);
    assert.notEqual(serviceLabel(home,'employer'),serviceLabel(f.home,'employer'));
    assert.notEqual(d.keychain.account,c.keychain.account);
  } finally {await d.close();fs.rmSync(home,{recursive:true,force:true});await f.close();}
});
test('a failed multi-file restore cannot unlock or start after a partial installation',async()=>{
  const f=await fixture(), target=temp(), d=new Controller(target,'employer');
  const rename=fs.renameSync;
  try {
    await f.c.wallet('create'); await f.c.save(config('employer',{wallet:f.c.config.wallet}),{});
    const backup=await f.c.backup(password);
    fs.renameSync=(from,to)=>{if(to===path.join(target,'config.json'))throw Error('FIXTURE_DISK_FAILURE');return rename(from,to);};
    await assert.rejects(d.restore(backup,password),/FIXTURE_DISK_FAILURE/);
    assert.equal(d.restoreFailed,true);
    assert.ok(fs.existsSync(path.join(target,'restore-in-progress.json')));
    const marker=JSON.parse(fs.readFileSync(path.join(target,'restore-in-progress.json')));
    assert.ok(fs.existsSync(marker.staged));assert.equal(d.vault.unlocked,false);
    await assert.rejects(d.unlock(password),/RESTORE_INTERRUPTED_RECOVERY_REQUIRED/);
    await assert.rejects(d.start('live'),/RESTORE_INTERRUPTED_RECOVERY_REQUIRED/);
    assert.throws(()=>new Controller(target,'employer'),/RESTORE_INTERRUPTED_RECOVERY_REQUIRED/);
  } finally {fs.renameSync=rename;await d.close();fs.rmSync(target,{recursive:true,force:true});await f.close();}
});
test('recovery routes require authenticated same-origin POST; monitor cannot read words; rate bounded',async()=>{
  const f=await fixture(),{c}=f;await c.wallet('create');const p=await createServer(c);
  const post=(route,body,headers={})=>fetch(p.origin+route,{method:'POST',headers:{Origin:p.origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const auth={Authorization:'Bearer '+p.token};
  try {
    assert.equal((await post('/api/wallet/reveal',{password})).status,403);
    assert.equal((await post('/api/wallet/reveal',{password},{...auth,Origin:'https://invalid.example'})).status,403);
    assert.equal((await fetch(p.origin+'/api/wallet/reveal',{headers:auth})).status,400);
    const monitor=await(await fetch(p.origin+'/api/monitor',{headers:auth})).json();
    assert.equal((await post('/api/wallet/reveal',{password},{Authorization:'Bearer '+monitor.token})).status,403);
    const r=await post('/api/wallet/reveal',{password},auth);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
    const shown=await r.json();const status=await(await fetch(p.origin+'/api/status',{headers:auth})).text();assert.ok(!status.includes(shown.phrase));
    for(let i=0;i<7;i++) await post('/api/wallet/reveal',{password:'wrong'},auth);
    assert.equal((await post('/api/wallet/reveal',{password},auth)).status,429);
  } finally {await new Promise(r=>p.server.close(r));await f.close();}
});
