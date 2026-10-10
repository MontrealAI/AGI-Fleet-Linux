import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Wallet } from 'ethers';
import { Controller } from '../src/control/controller.mjs';
import { createControlServer } from '../src/control/server.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const output=process.env.BROWSER_OUTPUT;fs.mkdirSync(output,{recursive:true});
const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-seed-ui-')),c=new Controller(home),app=await createControlServer(c,{port:0}),checks=[];
const password='BROWSER FIXTURE ONLY PASSWORD';
let browser;

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

try {
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BIN,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1120},permissions:['clipboard-read','clipboard-write'],acceptDownloads:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.url);await page.waitForFunction(()=>document.getElementById('vaultState').textContent==='No vault yet.');
  await page.locator('[data-view="setup"]').click();await page.locator('#password').fill(password);await page.locator('#vaultForm button').click();
  await page.waitForFunction(()=>document.getElementById('vaultState').textContent==='Unlocked on this Mac.');
  await page.screenshot({path:path.join(output,'wallet-create.png'),fullPage:true});await page.locator('#wallet').click();await page.waitForFunction(()=>!document.getElementById('seedRecovery').hidden);
  assert.equal(c.vault.get('walletRecovery').phrase.split(' ').length,24);
  await page.locator('#copyAddress').click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),c.config.agent);checks.push('24-word wallet creation and address copy');
  await pendingRevealCheck(page,c,password,'#notice');checks.push('pending reveal survives refresh, rejects duplicate submits and stays disabled after lock');
  await page.locator('#revealPassword').fill('wrong');await page.locator('#revealPhraseForm button').click();await page.waitForFunction(()=>!document.getElementById('revealPhraseForm').querySelector('button').disabled);
  assert.equal(await page.locator('#phraseDialog').evaluate(e=>e.open),false);assert.equal(await page.locator('#revealPassword').inputValue(),'');
  await page.locator('#revealPassword').fill(password);await page.locator('#revealPhraseForm button').click();await page.waitForFunction(()=>document.getElementById('phraseDialog').open);
  assert.equal(await page.locator('#phraseWords li').count(),24);
  await page.locator('#phraseVerify').click();assert.equal(await page.locator('#phraseWords li').count(),0);
  const words=c.vault.get('walletRecovery').phrase.split(' ');
  for(let i=0;i<3;i++) await page.locator('#recoveryAnswer'+i).fill(words[c.recoveryChallenge.indices[i]]);
  await page.locator('#confirmPhraseForm button').click();await page.locator('#phraseComplete').waitFor({state:'visible'});
  assert.equal(await page.locator('#phraseWords li').count(),0);assert.equal(await page.locator('#phraseQuestions input').count(),0);assert.equal(await page.locator('#phraseDialog').evaluate(e=>e.open),true);
  await page.screenshot({path:path.join(output,'recovery-verified.png'),fullPage:true});
  await page.locator('#phraseContinue').click();await page.locator('[data-view="setup"]').click();
  assert.equal(c.vault.get('walletRecovery').confirmed,true);checks.push('password re-entry, secret clearing, offline-copy word check');
  await page.screenshot({path:path.join(output,'wallet-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(output,'wallet-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));checks.push('desktop and mobile layout');
  await page.setViewportSize({width:1440,height:1120});
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('fixture denial');};document.execCommand=()=>false;});
  await page.locator('#copyAddress').click();assert.ok((await page.locator('#copyAddressStatus').innerText()).includes('⌘C'));checks.push('copy fallback selects only the address');
  await page.locator('#revealPassword').fill(password);await page.locator('#revealPhraseForm button').click();await page.waitForFunction(()=>document.getElementById('phraseDialog').open);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await page.locator('#phraseWords li').count(),0);assert.equal(await page.locator('#phraseDialog').evaluate(e=>e.open),false);
  await page.evaluate(()=>{delete document.hidden;});checks.push('leaving tab removes secret words');
  await page.clock.install();
  await page.locator('#revealPassword').fill(password);await page.locator('#revealPhraseForm button').click();await page.waitForFunction(()=>document.getElementById('phraseDialog').open);
  await page.clock.fastForward(120001);assert.equal(await page.locator('#phraseWords li').count(),0);checks.push('two-minute display timeout');
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).length),0);
  assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).length),0);
  assert.deepEqual(errors,[]);checks.push('no browser storage of secrets or uncaught errors');
  await context.close();
  const legacyHome=fs.mkdtempSync(path.join(os.tmpdir(),'agi-legacy-ui-')),old=new Controller(legacyHome);await old.createVault(password);
  const w=new Wallet('0x'+'46'.repeat(32));old.vault.set({privateKey:w.privateKey});old.config.agent=w.address;
  const legacy=await createControlServer(old,{port:0});
  try {
    const ctx=await browser.newContext({viewport:{width:1440,height:1120}}),pg=await ctx.newPage();await pg.goto(legacy.url);await pg.waitForFunction(()=>document.getElementById('vaultState').textContent==='Unlocked on this Mac.');await pg.locator('[data-view="setup"]').click();
    assert.equal(await pg.locator('#legacyRecovery').isVisible(),true);assert.equal(await pg.locator('#walletNew').isVisible(),false);assert.equal(await pg.locator('#seedRecovery').isVisible(),false);
    await pg.locator('#legacyRecovery summary').click();await pg.screenshot({path:path.join(output,'wallet-existing-upgrade.png'),fullPage:true});checks.push('existing wallet clearly retains backup recovery and separate-profile instructions');await ctx.close();
  } finally {await legacy.close();await old.close();fs.rmSync(legacyHome,{recursive:true,force:true});}
  for (const mode of ['create12','import12']) {
    const h=fs.mkdtempSync(path.join(os.tmpdir(),'agi-more-wallet-ui-')),actor=new Controller(h);await actor.createVault(password);
    const api=await createControlServer(actor,{port:0});
    try {
      const ctx=await browser.newContext(),pg=await ctx.newPage();await pg.goto(api.url);await pg.waitForFunction(()=>document.getElementById('vaultState').textContent==='Unlocked on this Mac.');await pg.locator('[data-view="setup"]').click();
      if(mode==='create12') {await pg.locator('#walletWords').selectOption('12');await pg.locator('#wallet').click();}
      else {
        const words='abandon '.repeat(11)+'about';await pg.locator('#phraseImportDetails summary').first().click();await pg.locator('#importPhrase').fill(words);await pg.locator('#importAddress').fill('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');await pg.locator('#importHistory').check();await pg.locator('#phraseImportForm button').click();
      }
      await pg.waitForFunction(()=>!document.getElementById('seedRecovery').hidden);
      assert.equal(actor.vault.get('walletRecovery').phrase.split(' ').length,12);assert.equal(await pg.locator('#importPhrase').inputValue(),'');
      if(mode==='import12') {assert.equal(actor.settings.restored,true);assert.equal(actor.config.agent,'0x9858EfFD232B4033E47d90003D41EC34EcaEda94');}
      await ctx.close();checks.push(mode==='create12'?'12-word creation through the UI':'phrase import through the UI with exact-address and history guard');
    } finally {await api.close();await actor.close();fs.rmSync(h,{recursive:true,force:true});}
  }
  fs.writeFileSync(path.join(output,'wallet-browser.json'),JSON.stringify({passed:true,environment:'Linux headless Chromium; fixture wallets only; no real funds',checks},null,2));
  console.log(JSON.stringify({passed:true,checks}));
} finally {await browser?.close();await app.close();await c.close();fs.rmSync(home,{recursive:true,force:true});}
