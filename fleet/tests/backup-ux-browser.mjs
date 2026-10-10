// Real local controllers + synthetic disposable wallets. No provider or chain calls.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {Controller as Fleet} from '../ops/controller.mjs';import {createServer} from '../ops/server.mjs';
import {Controller as Agent} from '../packages/AGI_Agent/src/control/controller.mjs';import {createControlServer as agentServer} from '../packages/AGI_Agent/src/control/server.mjs';
import {Controller as Node} from '../packages/AGI_Node/src/control/controller.mjs';import {createControlServer as nodeServer} from '../packages/AGI_Node/src/control/server.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)),out=process.env.BROWSER_OUTPUT;fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BIN,args:['--no-sandbox']}),results=[];
const password='PUBLIC BACKUP UX FIXTURE ONLY';
try{
 for(const role of ['agent','node','employer','moderator','recovery','evidence']){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-backup-ux-')),standalone=['agent','node'].includes(role),C=role==='agent'?Agent:role==='node'?Node:Fleet,c=new C(home,role);
  if(standalone)await c.createVault(password);else await c.unlock(password);
  if(role!=='evidence')await c.wallet('create',{wordCount:24});
  let envelope;if(standalone){await c.lock();envelope=await c.backup(password);assert.equal(c.vault.unlocked,false,'backup download must not silently unlock');}else{envelope=await c.backup(password);await c.lock();}
  const file=path.join(home,'fixture-backup.json');fs.writeFileSync(file,JSON.stringify(envelope));
  const app=role==='agent'?await agentServer(c,{port:0}):role==='node'?await nodeServer(c,{port:0}):await createServer(c);
  const ctx=await browser.newContext({viewport:{width:390,height:1000},reducedMotion:'reduce'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(app.url);await page.waitForFunction(()=>document.querySelectorAll('.genesis-gate').length===6);
   await page.locator('#genesis-backup').click();await page.locator('#verifyBackupFile').setInputFiles(file);
   const submit=page.locator('#verifyBackupForm button[type="submit"]'),result=page.locator('#backupVerificationResult'),saved=page.locator(standalone&&role==='node'?'#backup-saved':'#backupSaved');
   assert.equal(await submit.isDisabled(),true);assert.equal(await page.locator('#backupUnlock').isVisible(),true);assert.match(await page.locator('#backupPrerequisite').textContent(),/vault is locked/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await page.screenshot({path:path.join(out,'backup-locked-'+role+'.png'),fullPage:true});
   await page.locator('#backupUnlock').click();
   const unlockField=role==='node'?'#unlock-password':'#password';await page.locator(unlockField).fill(password);
   await page.locator(role==='agent'?'#vaultAction':role==='node'?'#unlock-form .primary':'#unlock').click();
   await page.waitForFunction(()=>!document.querySelector('#verifyBackupPassword').disabled&&document.activeElement.id==='verifyBackupPassword');
   assert.equal(await page.locator('#verifyBackupFile').evaluate(x=>x.files[0].name),'fixture-backup.json');assert.equal(await submit.isEnabled(),true);
   await page.locator('#verifyBackupPassword').fill('incorrect');await submit.click();await page.waitForFunction(()=>document.querySelector('#backupVerificationResult').dataset.state==='error');
   assert.match(await result.textContent(),/password or encrypted file is incorrect/);assert.equal(await page.locator('#verifyBackupPassword').inputValue(),'');assert.equal(await saved.isDisabled(),true);
   await page.locator('#verifyBackupPassword').fill(password);
   let release,requests=0;const held=new Promise(r=>release=r);
   await page.route('**/api/backup/verify',async route=>{requests++;await held;await route.continue();});
   try{
    await submit.click();await page.waitForFunction(()=>document.querySelector('#verifyBackupForm').getAttribute('aria-busy')==='true');
    await page.evaluate(async()=>{document.querySelector('#verifyBackupForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await refresh();});
    assert.equal(await submit.isDisabled(),true);assert.equal(await saved.isDisabled(),true);assert.match(await result.textContent(),/Verifying selected file/);
   }finally{release();}
   await page.waitForFunction(()=>document.querySelector('#backupVerificationResult').dataset.state==='success');assert.equal(requests,1);await page.unroute('**/api/backup/verify');
   assert.equal(await saved.isEnabled(),true);assert.equal(await page.locator('#verifyBackupPassword').inputValue(),'');await saved.click();await page.waitForFunction(()=>document.querySelector('#backupProof').textContent.includes('off-machine storage acknowledged'));
   assert.equal(await saved.isDisabled(),true,'acknowledgement must stay disabled after successful save');
   const current=await c.backup(password);await page.evaluate(()=>refresh());assert.ok(!(await result.textContent()).includes('ENCRYPTED BACKUP VERIFIED'));assert.equal(await saved.isDisabled(),true);
   // The prior valid encrypted file is now historical; it must not light up admission.
   await page.locator('#verifyBackupPassword').fill(password);await submit.click();await page.waitForFunction(()=>document.querySelector('#backupVerificationResult').textContent.includes('HISTORICAL BACKUP CHECKED'));
   assert.equal(await saved.isDisabled(),true);assert.ok(!(await result.textContent()).includes('✓ ENCRYPTED BACKUP VERIFIED'));
   await page.locator('#verifyBackupFile').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});assert.ok(!(await result.textContent()).includes('HISTORICAL BACKUP'));await page.locator('#verifyBackupPassword').fill(password);await submit.click();await page.waitForFunction(()=>document.querySelector('#backupVerificationResult').textContent.includes('not a valid JSON backup'));assert.equal(await page.locator('#verifyBackupPassword').inputValue(),'');
   fs.writeFileSync(file,JSON.stringify(current));await page.locator('#verifyBackupFile').setInputFiles(file);await page.locator('#verifyBackupPassword').fill(password);
   // Lock between the rendered prerequisite and backend request; retain the file and explain it.
   await c.lock();await submit.click();await page.waitForFunction(()=>document.querySelector('#backupVerificationResult').dataset.state==='error');assert.equal(await page.locator('#backupUnlock').isVisible(),true);assert.equal(await submit.isDisabled(),true);assert.equal(await page.locator('#verifyBackupFile').evaluate(x=>x.files[0].name),'fixture-backup.json');assert.equal(await page.locator('#verifyBackupPassword').inputValue(),'');
   assert.deepEqual(errors,[]);results.push({role,passed:true,lockedDownload:standalone,unlockPreservesSelection:true,wrongPasswordVisible:true,pendingRefreshAndDuplicateSubmit:true,currentAndHistoricalDistinct:true,staleSuccessCleared:true,malformedFileVisible:true,lateLockHandled:true,passwordCleared:true});
  }finally{await ctx.close();if(standalone)await app.close();else{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}await c.close();fs.rmSync(home,{recursive:true,force:true});}
 }
 const report={passed:true,environment:'Linux headless Chromium '+await browser.version(),scope:'Synthetic disposable local profiles; no physical Mac, live provider or settlement',results};fs.writeFileSync(path.join(out,'backup-ux-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
