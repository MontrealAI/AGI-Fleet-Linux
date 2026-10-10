// Run against the exact prior distribution: BASELINE_FLEET=/path/to/prior-release node tests/genesis-upgrade.mjs
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),baseline=process.env.BASELINE_FLEET;
assert.ok(baseline,'BASELINE_FLEET must point to the extracted prior Fleet distribution');
const baselineVersion=JSON.parse(fs.readFileSync(path.join(baseline,'package.json'))).version;
assert.ok(['1.13.0','1.14.0','1.14.1','1.14.2','1.14.3','1.15.0','1.15.1','1.15.2','1.16.0','1.17.0','1.17.1','1.17.2','1.17.3','1.17.4','1.17.5','1.17.6','1.17.7','1.17.8','1.17.9'].includes(baselineVersion),'Use a preserved delivered baseline');
const baselineMap=JSON.parse(fs.readFileSync(path.join(baseline,'config/companion-releases.json')));
const currentMap=JSON.parse(fs.readFileSync(path.join(root,'config/companion-releases.json')));
const password='PUBLIC UPGRADE TEST FIXTURE ONLY 2026',checks=[];
const load=async(base,file)=>await import(pathToFileURL(path.join(base,file)));
for(const role of ['agent','node','employer','moderator','recovery','evidence'])for(const profile of ['original','seed']){
 console.error('Testing baseline upgrade:',role,profile);
 const standalone=['agent','node'].includes(role),sub=role==='agent'?'AGI_Agent':'AGI_Node';
 const module=standalone?`packages/${sub}/src/control/controller.mjs`:'ops/controller.mjs';
 const Old=(await load(baseline,module)).Controller,Current=(await load(root,module)).Controller;
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'agi-genesis-upgrade-')),home=path.join(parent,'profile'+(profile==='seed'?' — Seed Wallet':''));let old,current;
 const field=role==='agent'?'agent':role==='node'?'validator':'wallet';
 const file=standalone?'data/admission/review-windows/42.json':'funding/review-windows/42.json';
 const bytes=JSON.stringify({fixture:true,reviewerMinutes:90,source:'public synthetic regression'});
 try{
  old=new Old(home,role);if(standalone)await old.createVault(password);else await old.unlock(password);
  if(role!=='evidence'){
   await old.wallet('create',{wordCount:profile==='seed'?24:12});const reveal=await old.revealRecovery(password);
   old.confirmRecovery({token:reveal.token,answers:reveal.indices.map(i=>reveal.phrase.split(' ')[i])});
  }
  fs.mkdirSync(path.dirname(path.join(home,file)),{recursive:true});fs.writeFileSync(path.join(home,file),bytes);
  let store=old.store;
  if(standalone){const Store=(await load(baseline,`packages/${sub}/src/store.mjs`)).Store;store=new Store(old.config.dataDir);}
  store.set('reviewTimePolicy',{fixture:true,minutes:90});
  store.db.exec("INSERT INTO jobs(id,"+(standalone?"created_block":"created")+",details,spec_uri,status) VALUES ('42',1,'{}','fixture://public','terminal')");
  if(standalone)store.close();
  const address=old.config[field],key=old.vault.get('privateKey'),recovery=old.vault.get('walletRecovery');
  const oldBackup=await old.backup(password);if(['1.14.0','1.14.1','1.14.2','1.14.3','1.15.0','1.15.1','1.15.2','1.16.0','1.17.0','1.17.1','1.17.2','1.17.3','1.17.4','1.17.5','1.17.6','1.17.7','1.17.8','1.17.9'].includes(baselineVersion))await old.verifyBackup(oldBackup,password);old.acknowledgeBackup();await old.close();old=null;
  current=new Current(home,role);await current.unlock(password);
  assert.equal(current.config[field],address);assert.equal(current.vault.get('privateKey'),key);
  assert.deepEqual(current.vault.get('walletRecovery'),recovery);assert.equal(fs.readFileSync(path.join(home,file),'utf8'),bytes);
  let nextStore=current.store;
  if(standalone){const Store=(await load(root,`packages/${sub}/src/store.mjs`)).Store;nextStore=new Store(current.config.dataDir);}
  assert.deepEqual(nextStore.meta('reviewTimePolicy'),{fixture:true,minutes:90});assert.equal(nextStore.db.prepare("SELECT status FROM jobs WHERE id='42'").get().status,'terminal');if(standalone)nextStore.close();
  assert.equal(standalone?current.settings.backupSaved:current.snapshot().backupSaved,false);
  if(role!=='evidence'){assert.equal(current.compareUpgrade(address).match,true);assert.equal(current.releaseProfile.previousVersion,standalone?baselineMap[role]:baselineMap.fleet);}
  const historical=await current.verifyBackup(oldBackup,password);assert.equal(historical.valid,true);assert.equal(historical.currentReady,false);
  const backup=await current.backup(password),proof=await current.verifyBackup(backup,password);assert.equal(proof.currentReady,true);current.acknowledgeBackup();
  assert.equal(standalone?current.settings.backupSaved:current.snapshot().backupSaved,true);
  await current.close();current=new Current(home,role);await current.unlock(password);
  assert.equal(current.config[field],address);assert.equal(standalone?current.settings.backupSaved:current.snapshot().backupSaved,true);
  checks.push({role,profile,wordCount:role==='evidence'?0:profile==='seed'?24:12,passed:true,checks:['wallet identity and recovery record preserved','review reservation bytes and job history preserved','old backup readable','current backup required and verified','receipt survives restart']});
 }finally{await old?.close();await current?.close();fs.rmSync(parent,{recursive:true,force:true});}
}
console.log(JSON.stringify({passed:true,baseline:baselineMap,current:currentMap,environment:process.platform,scope:'Synthetic signer-wallet, backup and journal profiles from the exact recorded prior package. Does not exercise the manually repaired v1.15.2 compute profile, OAuth state, wrapper, LaunchAgents, or physical Mac. No real operator data or network transactions.',checks},null,2));
