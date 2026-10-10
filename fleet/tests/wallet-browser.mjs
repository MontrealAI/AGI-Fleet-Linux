import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Wallet } from 'ethers';
import { Controller } from '../ops/controller.mjs';
import { createServer } from '../ops/server.mjs';
import { Controller as NodeController } from '../packages/AGI_Node/src/control/controller.mjs';
import { createControlServer } from '../packages/AGI_Node/src/control/server.mjs';
import { config, temp } from './helpers.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const output=process.env.BROWSER_OUTPUT;fs.mkdirSync(output,{recursive:true});
const password='PUBLIC BROWSER FIXTURE ONLY 2026',checks=[];
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BIN,args:['--no-sandbox']});

async function pendingRevealCheck(page,c,password,noticeSelector) {
  let release,observed,requests=0;
  const gate=new Promise(resolve=>{release=resolve;}),received=new Promise(resolve=>{observed=resolve;});
  const route='**/api/wallet/reveal';
  await page.route(route,async request=>{requests++;const response=await request.fetch();observed();await gate;await request.fulfill({response});});
  try {
    await page.locator('#revealPassword').fill('wrong');
    await page.locator('#revealPhraseForm button').click();await received;
    await page.evaluate(()=>refresh());
    assert.equal(await page.locator('#revealPhraseForm button').isDisabled(),true,'polling must not re-enable a pending secret request');
    await page.evaluate(()=>{for(let i=0;i<2;i++)document.querySelector('#revealPhraseForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    await c.lock();await page.evaluate(()=>refresh());
    assert.equal(await page.locator('#revealPhraseForm button').isDisabled(),true);
    release();
    await page.waitForFunction(selector=>document.querySelector(selector).textContent.toLowerCase().includes('did not unlock'),noticeSelector);
    assert.equal(requests,1,'duplicate synthetic submits must not dispatch');
    assert.equal(await page.locator('#revealPassword').inputValue(),'');
    assert.equal(await page.locator('#phraseDialog').evaluate(e=>e.open),false);
    assert.equal(await page.locator('#revealPhraseForm button').isDisabled(),true,'settlement must retain fresh locked state');
    await c.unlock(password);await page.evaluate(()=>refresh());
    assert.equal(await page.locator('#revealPhraseForm button').isDisabled(),false);
  } finally {release();await page.unroute(route);}
}

async function scenario(role,mode='create24') {
  const home=temp(),node=role==='node',c=node ? new NodeController(home) : new Controller(home,role);
  await(node ? c.createVault(password) : c.unlock(password));
  if(mode==='legacy') {
    const wallet=new Wallet('0x'+'46'.repeat(32));
    if(node) {c.vault.set({privateKey:wallet.privateKey});c.config.validator=wallet.address;}
    else await c.save(config(role,{wallet:wallet.address}),{privateKey:wallet.privateKey});
  }
  const panel=node ? await createControlServer(c,{port:0}) : await createServer(c);
  const ctx=await browser.newContext({viewport:{width:1360,height:1000},permissions:['clipboard-read','clipboard-write'],acceptDownloads:true}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.goto(panel.url);
    await page.waitForFunction(()=>document.querySelector('#walletProfile').textContent.includes('profile'));
    if(!node) await page.locator('[data-fleet-view="wallet"]').click();
    if(node) { await page.locator('nav [data-view="setup"]').click(); await page.locator('[data-step="3"]').first().click(); }
    if(role==='evidence') {
      assert.equal(await page.locator('#walletPanel').isVisible(),false);
      assert.equal(await page.locator('#keylabel').isVisible(),false);
      checks.push('evidence: wallet controls and key import hidden');return;
    }
    if(mode==='legacy') {
      assert.equal(await page.locator('#legacyRecovery').isVisible(),true);
      assert.equal(await page.locator('#walletNew').isVisible(),false);
      assert.equal(await page.locator('#seedRecovery').isVisible(),false);
      checks.push(role+': legacy wallet retained without invented phrase');return;
    }
    if(mode==='import12') {
      await page.locator('#walletNew > details > summary').click();
      await page.locator('#importPhrase').fill('abandon '.repeat(11)+'about');
      await page.locator('#importAddress').fill('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
      await page.locator('#importHistory').check();
      await page.locator('#phraseImportForm button[type="submit"]').click();
    } else {
      await page.locator('#walletWords').selectOption(mode==='create12'?'12':'24');
      await page.locator('#walletCreate').click();
    }
    await page.locator('#seedRecovery').waitFor({state:'visible'});
    const record=c.vault.get('walletRecovery');assert.equal(record.phrase.split(' ').length,mode==='create24'?24:12);
    assert.equal(await page.locator('#importPhrase').inputValue(),'');
    await page.locator('#copyAddress').click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),record.address);
    if(mode==='create24'&&['node','employer'].includes(role)){await pendingRevealCheck(page,c,password,node?'#feedback':'#message');checks.push(role+': pending reveal, refresh, duplicate submit and lock regression');}
    await page.locator('#revealPassword').fill('wrong');await page.locator('#revealPhraseForm button').click();
    await page.waitForFunction(()=>!document.querySelector('#revealPhraseForm button').disabled);
    assert.equal(await page.locator('#phraseDialog').evaluate(e=>e.open),false);
    assert.equal(await page.locator('#revealPassword').inputValue(),'');
    await page.locator('#revealPassword').fill(password);await page.locator('#revealPhraseForm button').click();
    await page.locator('#phraseDialog').waitFor({state:'visible'});
    assert.equal(await page.locator('#phraseWords li').count(),record.phrase.split(' ').length);
    await page.locator('#phraseVerify').click();assert.equal(await page.locator('#phraseWords li').count(),0);
    for(let i=0;i<3;i++) await page.locator('#recoveryAnswer'+i).fill(record.phrase.split(' ')[c.recoveryChallenge.indices[i]]);
    await page.locator('#confirmPhraseForm button').click();await page.locator('#phraseComplete').waitFor({state:'visible'});
    assert.equal(await page.locator('#phraseWords li').count(),0);assert.equal(await page.locator('#phraseQuestions input').count(),0);
    assert.equal(await page.locator('#phraseDialog').evaluate(e=>e.open),true);
    await page.locator('#phraseContinue').click();
    if(node){await page.locator('nav [data-view="setup"]').click();await page.locator('[data-step="3"]').first().click();}else await page.locator('[data-fleet-view="wallet"]').click();
    assert.equal(c.vault.get('walletRecovery').confirmed,true);
    if(mode==='import12') assert.equal(node?c.settings.restored:c.store.meta('phraseRecoveryNeedsHistory'),true);
    if(mode==='create24') {
      await page.screenshot({path:path.join(output,role+'-wallet-desktop.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1));
      await page.screenshot({path:path.join(output,role+'-wallet-mobile.png'),fullPage:true});
      await page.setViewportSize({width:1360,height:1000});
      await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('fixture');};document.execCommand=()=>false;});
      await page.locator('#copyAddress').click();assert.match(await page.locator('#copyAddressStatus').textContent(),/⌘C/);
      await page.locator('#revealPassword').fill(password);await page.locator('#revealPhraseForm button').click();await page.locator('#phraseDialog').waitFor({state:'visible'});
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});
      assert.equal(await page.locator('#phraseWords li').count(),0);assert.equal(await page.locator('#phraseDialog').evaluate(e=>e.open),false);
      await page.clock.install();await page.locator('#revealPassword').fill(password);await page.locator('#revealPhraseForm button').click();await page.locator('#phraseDialog').waitFor({state:'visible'});
      await page.clock.fastForward(120001);assert.equal(await page.locator('#phraseWords li').count(),0);
      await page.clock.resume();
      if(node) await page.locator('nav [data-view="wallet"]').click();else await page.locator('[data-fleet-view="backup"]').click();
      await page.locator(node?'#backup-password':'#backupPassword').fill(password);
      const wait=page.waitForEvent('download');await page.locator(node?'#backup-form button':'#backup').click();
      const download=await wait;assert.ok(download.suggestedFilename().includes(record.address.slice(0,10)));
      assert.equal(await page.locator(node?'#backup-saved':'#backupSaved').isDisabled(),true);
      const backupFile=path.join(home,'downloaded-backup.json');await download.saveAs(backupFile);
      await page.locator('#verifyBackupFile').setInputFiles(backupFile);await page.locator('#verifyBackupPassword').fill(password);
      await page.locator('#verifyBackupForm button').click();await page.waitForFunction(()=>document.querySelector('#backupVerificationResult').textContent.includes('ENCRYPTED BACKUP VERIFIED'));
      await page.locator(node?'#backup-saved':'#backupSaved').click();
      assert.equal(node?c.settings.backupSaved:c.snapshot().backupSaved,true);
      const storage=await page.evaluate(()=>JSON.stringify({local:localStorage,session:sessionStorage}));assert.ok(!storage.includes(record.phrase));
    }
    checks.push(`${role}: ${mode}, copy, fresh password, phrase confirmation, secret clearing${mode==='create24'?', responsive layout, copy fallback, timeout and backup acknowledgement':''}`);
  } finally {
    assert.deepEqual(errors,[]);
    await ctx.close();if(node)await panel.close();else await new Promise(r=>panel.server.close(r));
    await c.close();fs.rmSync(home,{recursive:true,force:true});
  }
}
try {
  for(const role of ['node','employer','moderator','recovery']) await scenario(role);
  for(const role of ['node','employer']) for(const mode of ['create12','import12','legacy']) await scenario(role,mode);
  await scenario('evidence');
  const result={passed:true,browser:await browser.version(),checks};fs.writeFileSync(path.join(output,'wallet-browser.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
