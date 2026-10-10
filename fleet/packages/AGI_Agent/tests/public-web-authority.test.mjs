import {createPublicWebReport} from '../src/control/public-web-report.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Controller} from '../src/control/controller.mjs';
import {Vault} from '../src/control/vault.mjs';
import {ensurePublicWebAuthority,validatePublicWebAuthority} from '../src/control/public-web-authority.mjs';
const password='PUBLIC test fixture password only';
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'agi-public-web-authority-'));}

test('capable kit creates one encrypted browser authority and exports only its public key',async()=>{
 const home=temp(),c=new Controller(home);
 try {
  await c.createVault(password);
  await c.companionKit({acknowledge:true});
  assert.equal(c.vault.get('publicWebAuthority'),undefined,'bounded setup has no browser authority');
  c.settings.backupSaved=true;
  const kit=await c.companionKit({acknowledge:true,mode:'workstation'});
  const authority=validatePublicWebAuthority(c.vault.get('publicWebAuthority'));
  assert.equal(kit.publicWebAuthority,authority.publicKey);
  assert.equal(c.settings.backupSaved,false,'new authority requires a fresh encrypted backup');
  assert.ok(!JSON.stringify(kit).includes('PRIVATE KEY'));
  assert.ok(!JSON.stringify(c.status()).includes('PRIVATE KEY'));
  assert.ok(!fs.readFileSync(c.vault.file,'utf8').includes(authority.privateKey));
  assert.equal((await c.companionKit({acknowledge:true,mode:'workstation'})).publicWebAuthority,authority.publicKey);
  await c.lock();
  await assert.rejects(c.companionKit({acknowledge:true,mode:'workstation'}),/NODE_LOCKED/);
  await c.unlock(password);
  assert.deepEqual(c.vault.get('publicWebAuthority'),authority);
 } finally {await c.close();fs.rmSync(home,{recursive:true,force:true});}
});

test('complete encrypted application backup restores the exact browser authority and wallet',async()=>{
 const home=temp(),restored=temp(),c=new Controller(home),d=new Controller(restored);
 try {
  await c.createVault(password);await c.wallet('create');
  await c.companionKit({acknowledge:true,mode:'workstation'});
  const authority=validatePublicWebAuthority(c.vault.get('publicWebAuthority'));
  const walletKey=c.vault.get('privateKey');
  const reviewer=crypto.generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'});
  c.companion.state.publicWebReviewerPublicKey=reviewer;c.companion.persist();
  const report=createPublicWebReport({completedAt:Date.now(),role:'agent',requestID:crypto.randomUUID(),fixtureSha256:'a'.repeat(64),runtimeSha256:'b'.repeat(64),policyHash:'c'.repeat(64),browserEvidence:{status:'PASS',actualBrowserInteraction:true,cleanup:'PASS',completedToolCalls:2},qualificationStatus:{status:'BLOCKED',code:'PUBLIC_WEB_QUALIFICATION_REVIEWER_REQUIRED'},qualificationExport:null});c.companion.savePublicWebReport(report);
  const backup=await c.backup(password);
  assert.ok(!JSON.stringify(backup).includes('PRIVATE KEY'));
  await d.restore(backup,password,true);
  assert.deepEqual(ensurePublicWebAuthority(d.vault),{authority,created:false});
  assert.equal(d.vault.get('privateKey'),walletKey);
  assert.equal(d.companion.state.publicWebReviewerPublicKey,reviewer);
  assert.deepEqual(d.companion.state.lastPublicWebReport,report);assert.equal(d.companionPublicWebReport().report.status,'BLOCKED');
  assert.equal((await d.companionKit({acknowledge:true,mode:'workstation'})).publicWebAuthority,authority.publicKey);
 } finally {await c.close();await d.close();fs.rmSync(home,{recursive:true,force:true});fs.rmSync(restored,{recursive:true,force:true});}
});

test('corrupt or mismatched browser authority fails without silently rotating a pinned key',async()=>{
 const home=temp(),vault=new Vault(home);
 try {
  await vault.create(password);const {authority}=ensurePublicWebAuthority(vault);
  const other=crypto.generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'});
  for(const corrupt of [{...authority,publicKey:other},{...authority,publicKey:authority.privateKey},{...authority,publicKey:authority.publicKey+authority.privateKey},{...authority,privateKey:'invalid'},null]){
   vault.set({publicWebAuthority:corrupt});
   assert.throws(()=>ensurePublicWebAuthority(vault),/PUBLIC_WEB_AUTHORITY_INVALID/);
   assert.deepEqual(vault.get('publicWebAuthority'),corrupt);
  }
 } finally {vault.lock();fs.rmSync(home,{recursive:true,force:true});}
});
