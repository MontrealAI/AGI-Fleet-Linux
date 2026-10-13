import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
for(const lang of ['en','fr'])for(const width of [320,390,768,1440])test(`SUCCESSOR ${lang} ${width}: useful work, Fleet export, offline restore`,async({page,browser},testInfo)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(lang==='fr'?'/successor-fr.html':'/successor.html');
  await expect(page.locator('#run')).toBeEnabled();
  await page.locator('#public-consent').check();await page.locator('#run').click();await expect(page.locator('#keep-version')).toBeEnabled();await page.locator('#keep-version').click();
  await page.locator('#budget').evaluate(el=>el.closest('details').open=true);await page.locator('#budget').fill('100');await page.locator('#prepare-job').click();await expect(page.locator('#job-results')).toBeVisible();
  const [request]=await Promise.all([page.waitForEvent('download'),page.locator('#fleet-export').click()]);const raw=JSON.parse(fs.readFileSync(await request.path(),'utf8'));expect(raw.schema).toBe('agi-fleet/successor-request/v1');expect(raw.plan.payment).toBe('unfunded');
  await page.locator('#improve-local').click();await expect(page.locator('#comparison')).not.toHaveText('');await page.locator('#keep-version').click();
  const [capsule]=await Promise.all([page.waitForEvent('download'),page.locator('#download-capsule').click()]);const capsulePath=await capsule.path();
  const [offline]=await Promise.all([page.waitForEvent('download'),page.locator('#download-html').click()]);const htmlPath=testInfo.outputPath('My-SUCCESSOR-Omega.html');await offline.saveAs(htmlPath);
  const fresh=await browser.newContext({acceptDownloads:true});const restored=await fresh.newPage();await restored.goto('file://'+htmlPath);
  await expect(restored.locator('#restore-preview')).toBeVisible();await restored.locator('#restore-consent').check();await restored.locator('#restore').click();await restored.locator('#public-consent').check();await restored.locator('#run').click();await expect(restored.locator('#result-summary')).toContainText(/Checks passed|Vérifications réussies/);await expect(restored.locator('#error')).toBeHidden();await expect(restored.locator('#keep-version')).toBeDisabled();
  await fresh.close();expect(JSON.parse(fs.readFileSync(capsulePath,'utf8')).payload.state.active).toBeTruthy();
  await page.locator('#language').click();await expect(page.locator('#fleet-export')).toBeEnabled();
  const results=await new AxeBuilder({page}).setLegacyMode(true).exclude('#preview').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(results.violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('builder.png'),fullPage:true});await page.emulateMedia({media:'print'});expect(await page.locator('#results').isVisible()).toBe(true);
});
test.use({acceptDownloads:true});

test('SUCCESSOR preserves text on errors and unavailable storage; keyboard focus and isolated preview',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.setItem=()=>{throw Error('denied');};});await page.goto('/successor.html');
  await page.locator('#run').click();await expect(page.locator('#error')).toBeFocused();
  await page.locator('#public-consent').check();await page.locator('#run').click();await page.locator('#keep-version').click();
  await page.locator('#save').evaluate(el=>el.closest('details').open=true);await page.locator('#save').click();await expect(page.locator('#error')).toContainText('STORAGE');await expect(page.locator('#data')).not.toHaveValue('');
  expect(await page.locator('#preview').getAttribute('sandbox')).toBe('');expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toContain("connect-src 'none'");
});

for(const lang of ['en','fr'])test(`SUCCESSOR ${lang}: stale restore consent and stopped work preserve the selected version`,async({page})=>{
  await page.goto(lang==='fr'?'/successor-fr.html':'/successor.html');
  await page.locator('#public-consent').check();await page.locator('#run').click();
  await expect(page.locator('#keep-version')).toBeEnabled();await page.locator('#keep-version').click();
  async function capsule(){const [file]=await Promise.all([page.waitForEvent('download'),page.locator('#download-capsule').click()]);return JSON.parse(fs.readFileSync(await file.path(),'utf8'));}
  const before=await capsule();
  await page.locator('#import-file').setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(before))});
  await expect(page.locator('#restore-preview')).toBeVisible();await page.locator('#restore-consent').check();
  await page.locator('#import-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{invalid')});
  await expect(page.locator('#error')).toBeVisible();await expect(page.locator('#restore-preview')).toBeHidden();
  await expect(page.locator('#restore-consent')).not.toBeChecked();
  await page.evaluate(()=>{
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker{set onmessage(callback){super.onmessage=event=>{window.__deliverWorker=()=>callback(event);};}};
  });
  await page.locator('#improve-local').click();await page.waitForFunction(()=>typeof window.__deliverWorker==='function');
  for(const id of ['fleet-version','fleet-export','run','keep-version','restore','import-file','language'])await expect(page.locator('#'+id)).toBeDisabled();
  await page.locator('#stop').click();await expect(page.locator('#error')).toContainText('STOPPED');
  await page.evaluate(()=>window.__deliverWorker());
  expect((await capsule()).payload.state).toEqual(before.payload.state);
  await expect(page.locator('#fleet-version')).toBeEnabled();await expect(page.locator('#rollback')).toBeDisabled();
});
