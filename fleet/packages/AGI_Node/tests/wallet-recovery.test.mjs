import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet, Mnemonic, HDNodeWallet } from 'ethers';
import { createSeedWallet, importSeedWallet, checkRecovery, ETHEREUM_PATH, normalizePhrase } from '../src/control/wallet-recovery.mjs';
import { Controller } from '../src/control/controller.mjs';
import { Vault } from '../src/control/vault.mjs';
import { atomicWrite } from '../src/util.mjs';
import { createControlServer } from '../src/control/server.mjs';
import { seedProfileHome, profilePort, profileService } from '../src/control/wallet-profile.mjs';
import { Keychain, launchAgent } from '../src/control/os-integration.mjs';
const password = 'PUBLIC TEST FIXTURE ONLY 2026';
const phrase = 'abandon '.repeat(11) + 'about';
const expectedAddress = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agi-wallet-test-'));
async function fixture() { const home = dir(), c = new Controller(home); await c.createVault(password); return {home,c,async close(){await c.close(); fs.rmSync(home,{recursive:true,force:true});}}; }
async function confirm(c) { const r = await c.revealRecovery(password); return c.confirmRecovery({token:r.token,answers:r.indices.map(i=>r.phrase.split(' ')[i]),passphrase:c.vault.get('walletRecovery').passphrase}); }

test('12 and 24 word generation uses valid English BIP-39 and the standard Ethereum path', () => {
  const addresses = new Set();
  for (const count of [12,24,12,24]) {
    const {wallet,recovery:r} = createSeedWallet(count);
    assert.equal(r.phrase.split(' ').length,count);
    assert.ok(Mnemonic.isValidMnemonic(r.phrase));
    assert.equal(r.path,ETHEREUM_PATH); assert.equal(r.passphrase,''); assert.equal(r.confirmed,false);
    assert.equal(HDNodeWallet.fromPhrase(r.phrase).address,wallet.address);
    assert.equal(checkRecovery(r,wallet.privateKey,wallet.address),r);
    addresses.add(wallet.address);
  }
  assert.equal(addresses.size,4);
  for (const v of [0,15,18,21,25,'24',null]) assert.throws(()=>createSeedWallet(v),/RECOVERY_WORD_COUNT/);
});
test('published BIP-39 entropy and seed vectors and known Ethereum address', () => {
  const m = Mnemonic.fromEntropy('0x'+'00'.repeat(16),'TREZOR');
  assert.equal(m.phrase,phrase);
  assert.equal(m.computeSeed(),'0xc55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04');
  const m24=Mnemonic.fromEntropy('0x'+'00'.repeat(32),'TREZOR');
  assert.equal(m24.phrase,'abandon '.repeat(23)+'art');
  assert.equal(m24.computeSeed(),'0xbda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8');
  assert.equal(importSeedWallet({phrase,expectedAddress}).wallet.address,expectedAddress);
  assert.equal(normalizePhrase('  '+phrase.toUpperCase().replaceAll(' ','\n  ')+'  '),phrase);
});
test('restore checks checksum, optional passphrase, expected address and bounded paths', () => {
  assert.throws(()=>importSeedWallet({phrase:'abandon '.repeat(12),expectedAddress}),/RECOVERY_PHRASE_INVALID/);
  assert.throws(()=>importSeedWallet({phrase}),/RECOVERY_EXPECTED_ADDRESS_REQUIRED/);
  assert.throws(()=>importSeedWallet({phrase,passphrase:'wrong',expectedAddress}),/RECOVERY_ADDRESS_MISMATCH/);
  for (const path of ["m/44'/60'/0'/0/2147483648", "m/44'/60'/2147483648'/0/0", "m/44'/0'/0'/0/0", "m/44'/60'/0'/0/0/0"]) assert.throws(()=>importSeedWallet({phrase,path,expectedAddress}),/RECOVERY_PATH_INVALID/);
  const passphrase='café', target=HDNodeWallet.fromPhrase(phrase,passphrase, "m/44'/60'/2'/0/3");
  const restored=importSeedWallet({phrase,passphrase:'cafe\u0301',path:target.path,expectedAddress:target.address});
  assert.equal(restored.wallet.address,target.address); assert.equal(restored.recovery.passphrase,'cafe\u0301');
});
test('recovery phrase is encrypted on disk, absent from status/report, and needs fresh password', async () => {
  const f=await fixture(); const {c}=f;
  try {
    const created=await c.wallet('create',{wordCount:24}); const r=c.vault.get('walletRecovery');
    for (const value of [created,c.status(),c.report(),fs.readFileSync(c.vault.file,'utf8'),fs.readFileSync(c.configFile,'utf8'),fs.readFileSync(c.stateFile,'utf8')]) {
      const s=JSON.stringify(value); assert.ok(!s.includes(r.phrase)); assert.ok(!s.includes(c.vault.get('privateKey')));
    }
    assert.equal(fs.statSync(c.vault.file).mode & 0o777,0o600);
    await assert.rejects(c.revealRecovery('wrong'),/PASSWORD_OR_FILE_INCORRECT/);
    assert.throws(()=>c.requireRecoveryConfirmed(),/RECOVERY_CONFIRMATION_REQUIRED/);
    const shown=await c.revealRecovery(password);
    assert.equal(shown.wordCount,24); assert.equal(new Set(shown.indices).size,3);
    assert.throws(()=>c.confirmRecovery({token:shown.token,answers:['bad','bad','bad']}),/RECOVERY_WORDS_INCORRECT/);
    assert.throws(()=>c.confirmRecovery({token:shown.token,answers:[]}),/RECOVERY_CHALLENGE_EXPIRED/);
    await confirm(c); assert.doesNotThrow(()=>c.requireRecoveryConfirmed());
    await c.lock(); assert.equal(c.recoveryChallenge,null);
    await assert.rejects(c.revealRecovery(password),/NODE_LOCKED/);
    await c.unlock(password); assert.equal(c.status().walletRecovery.confirmed,true);
  } finally {await f.close();}
});
test('expired checks, running worker and unconfirmed live authority are rejected', async () => {
  const f=await fixture(),{c}=f;
  try {
    await c.wallet('create'); await c.revealRecovery(password); c.recoveryChallenge.expiresAt=0;
    assert.throws(()=>c.confirmRecovery({token:'0'.repeat(64),answers:[]}),/RECOVERY_CHALLENGE_EXPIRED/);
    c.desired=true; await assert.rejects(c.revealRecovery(password),/STOP_BEFORE_CHANGING_SETTINGS/); c.desired=false;
    c.assertOperationsReady=()=>{}; c.settings.backupSaved=true;
    await assert.rejects(c.activationChallenge(),/RECOVERY_CONFIRMATION_REQUIRED/);
  } finally {await f.close();}
});
test('full encrypted backup restores phrase, exact address and confirmed state', async () => {
  const f=await fixture(),target=dir(),r=new Controller(target);
  try {
    await f.c.wallet('create',{wordCount:12}); await confirm(f.c);
    const seed=f.c.vault.get('walletRecovery'), sealed=await f.c.backup(password);
    assert.ok(!JSON.stringify(sealed).includes(seed.phrase));
    await r.restore(sealed,password,true); await r.unlock(password);
    assert.equal(r.config.validator,f.c.config.validator); assert.deepEqual(r.vault.get('walletRecovery'),seed);
    assert.equal((await r.revealRecovery(password)).phrase,seed.phrase);
    assert.equal(r.settings.restored,true); assert.equal(r.settings.backupSaved,false);
    assert.ok(!fs.existsSync(path.join(r.config.dataDir,'activation.json')));
  } finally { await r.close();fs.rmSync(target,{recursive:true,force:true});await f.close();}
});
test('phrase-only recovery requires expected address, flags missing history and verifies extra passphrase', async () => {
  const f=await fixture(),{c}=f;
  try {
    await assert.rejects(c.wallet('phrase',{phrase,expectedAddress}),/RECOVERY_HISTORY_ACKNOWLEDGEMENT/);
    const passphrase='fixture extra secret',expected=HDNodeWallet.fromPhrase(phrase,passphrase).address;
    await c.wallet('phrase',{phrase,passphrase,expectedAddress:expected,acknowledgeHistory:true});
    assert.equal(c.settings.restored,true); assert.equal(c.config.validator,expected);
    const shown=await c.revealRecovery(password);
    assert.equal(shown.hasPassphrase,true); assert.ok(!JSON.stringify(shown).includes(passphrase));
    assert.throws(()=>c.confirmRecovery({token:shown.token,answers:shown.indices.map(i=>phrase.split(' ')[i])}),/RECOVERY_PASSPHRASE_INCORRECT/);
    await confirm(c); assert.equal(c.status().walletRecovery.confirmed,true);
  } finally {await f.close();}
});
test('legacy wallet, backup and journal remain usable without invented seed words', async () => {
  const f=await fixture(),{c}=f,target=dir(),r=new Controller(target);
  try {
    const wallet=new Wallet('0x'+'46'.repeat(32)); c.vault.set({privateKey:wallet.privateKey}); c.config.validator=wallet.address;
    atomicWrite(c.configFile,JSON.stringify(c.config));
    await c.lock();await c.unlock(password);
    assert.equal(c.status().walletRecovery.type,'private-key'); assert.doesNotThrow(()=>c.requireRecoveryConfirmed());
    await assert.rejects(c.wallet('create'),/WALLET_ALREADY_CONFIGURED/);
    await assert.rejects(c.wallet('phrase',{phrase,expectedAddress,acknowledgeHistory:true}),/WALLET_ALREADY_CONFIGURED/);
    await assert.rejects(c.revealRecovery(password),/RECOVERY_PHRASE_UNAVAILABLE/);
    const oldVault=fs.readFileSync(c.vault.file); await r.restore(await c.backup(password),password,true);await r.unlock(password);
    assert.equal(r.config.validator,wallet.address);assert.equal(r.status().walletRecovery.type,'private-key');
    assert.deepEqual(fs.readFileSync(c.vault.file),oldVault);
  } finally {await r.close();fs.rmSync(target,{recursive:true,force:true});await f.close();}
});
test('interrupted wallet installation recovers its address; mismatched recovery blocks unlock', async () => {
  const f=await fixture(),{c}=f;
  try {
    await c.wallet('create');const original=c.config.validator;
    c.config.validator=''; atomicWrite(c.configFile,JSON.stringify(c.config));await c.lock();await c.unlock(password);
    assert.equal(c.config.validator,original);
    c.vault.set({walletRecovery:{...c.vault.get('walletRecovery'),address:expectedAddress}});await c.lock();
    await assert.rejects(c.unlock(password),/RECOVERY_RECORD_MISMATCH/);assert.equal(c.vault.unlocked,false);
  } finally {await f.close();}
});
test('separate seed profile preserves original bytes, has distinct Keychain account, startup service and port', async () => {
  const f=await fixture(),{c,home}=f,seedHome=seedProfileHome(home),r=new Controller(seedHome);
  try {
    await c.wallet('create');const vault=fs.readFileSync(c.vault.file),config=fs.readFileSync(c.configFile);
    await r.createVault(password);await r.wallet('create');
    assert.notEqual(r.config.validator,c.config.validator);assert.deepEqual(fs.readFileSync(c.vault.file),vault);assert.deepEqual(fs.readFileSync(c.configFile),config);
    assert.equal(seedProfileHome(seedHome),seedHome);assert.notEqual(profilePort(home),profilePort(seedHome));assert.notEqual(profileService(home),profileService(seedHome));
    assert.notEqual(new Keychain(home).account,new Keychain(seedHome).account);
    assert.ok(launchAgent(seedHome).includes('<string>8790</string>'));assert.ok(launchAgent(seedHome).includes('ai.montreal.agi-node.seed-wallet'));
  } finally {await r.close();fs.rmSync(seedHome,{recursive:true,force:true});await f.close();}
});
test('recovery HTTP API requires session, CSRF, password; never reveals via GET; returns no-store', async () => {
  const f=await fixture();await f.c.wallet('create');const app=await createControlServer(f.c,{port:0}),origin=`http://127.0.0.1:${app.port}`;
  const post=(route,body,headers={})=>fetch(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  try {
    assert.equal((await post('/api/wallet/reveal',{password})).status,401);
    const session=await post('/api/session',{token:app.url.split('#')[1]}),cookie=session.headers.get('set-cookie').split(';')[0],csrf=(await session.json()).csrf,headers={Cookie:cookie,'X-AGI-CSRF':csrf};
    assert.equal((await post('/api/wallet/reveal',{password},{Cookie:cookie})).status,403);
    assert.equal((await fetch(origin+'/api/wallet/reveal',{headers})).status,404);
    const wrong=await post('/api/wallet/reveal',{password:'wrong'},headers);assert.equal(wrong.status,400);
    const response=await post('/api/wallet/reveal',{password},headers);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const shown=await response.json(),status=JSON.stringify(await(await fetch(origin+'/api/status',{headers})).json());assert.ok(!status.includes(shown.phrase));
    const confirmed=await post('/api/wallet/confirm',{token:shown.token,answers:shown.indices.map(i=>shown.phrase.split(' ')[i])},headers);assert.equal(confirmed.status,200);
    for(let i=0;i<5;i++) await post('/api/wallet/reveal',{password:'wrong'},headers);
    assert.equal((await post('/api/wallet/reveal',{password},headers)).status,429);
  } finally {await app.close();await f.close();}
});
test('phrase import records its history guard before installing key material, including a failed write', async () => {
  const f=await fixture(),{c}=f;
  try {
    const original=c.vault.set.bind(c.vault);
    c.vault.set=()=>{throw Error('SIMULATED_DISK_FAILURE');};
    await assert.rejects(c.wallet('phrase',{phrase,expectedAddress,acknowledgeHistory:true}),/SIMULATED_DISK_FAILURE/);
    assert.equal(JSON.parse(fs.readFileSync(c.stateFile)).restored,true);
    assert.equal(Boolean(c.config.validator),false);
    c.vault.set=original;
    assert.equal(c.vault.get('privateKey'),undefined);
  } finally {await f.close();}
});
