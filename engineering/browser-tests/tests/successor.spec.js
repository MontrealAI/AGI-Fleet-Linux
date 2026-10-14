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

// Real installed UI, explicitly simulated RPC: cancellation must remain usable
// while inspection is pending, and a late reply must not restore permission.
for(const lang of ['en','fr'])for(const operation of ['stop','revoke'])for(const phase of ['inspection','context'])test(`Installed SUCCESSOR ${lang}: ${operation} interrupts pending ${phase}`,async({page})=>{
  await page.setContent('<div class="studio-shell" data-role="agent"></div>');
  await page.evaluate(phase=>{
    window.__observed=[];
    const read=File.prototype.text;
    File.prototype.text=async function(){const text=await read.call(this);if(['fixture-context.json','fixture-reviewer.json'].includes(this.name))window.__contextRead=true;return text;};
    window.api=async(url)=>{
      window.__observed.push(url);
      if(url==='/api/successor/prepare'&&phase==='inspection')return new Promise(resolve=>{window.__releaseInspection=()=>resolve({ticket:'fixture-ticket',key:'fixture-key'});});
      if(url==='/api/successor/runtime'&&phase==='context')return new Promise(resolve=>{window.__releaseInspection=()=>resolve({runtime:{}});});
      if(url==='/api/status')return {config:{manager:'0x1',chainId:31337}};
      if(url==='/api/successor')return {runs:[],studio:{runs:[],blockers:[]}};
      return {revoked:true};
    };
  },phase);
  await page.addScriptTag({content:fs.readFileSync(new URL('../../../successor/installed-ui.js',import.meta.url),'utf8')});
  if(lang==='fr')await page.locator('#omega-language').click();
  await page.locator('#omega-file').setInputFiles({name:'fixture-request.json',mimeType:'application/json',buffer:Buffer.from('{"plan":{"immutableInputs":[]}}')});
  await expect(page.locator('#omega-message')).toContainText(/File loaded|Fichier chargé/);
  if(phase==='inspection'){
    await page.locator('#omega-advanced').evaluate(el=>el.open=true);
    await page.locator('#omega-context').setInputFiles({name:'fixture-context.json',mimeType:'application/json',buffer:Buffer.from('{}')});
  }else{
    await page.locator('#omega-reviewer').setInputFiles({name:'fixture-reviewer.json',mimeType:'application/json',buffer:Buffer.from('{"role":"reviewer","authority":"none","runtime":{}}')});
    await page.locator('#omega-public').check();
  }
  // The context reader is asynchronous; wait for its action to finish.
  await page.waitForFunction(()=>window.__contextRead===true);
  await page.locator('#omega-prepare').click();
  await page.waitForFunction(()=>typeof window.__releaseInspection==='function');
  await page.locator('#omega-'+operation).click();
  await page.waitForFunction(op=>window.__observed.includes('/api/successor/'+op),operation);
  await page.evaluate(()=>window.__releaseInspection());
  if(phase==='context'){
    await page.waitForFunction(()=>window.__observed.includes('/api/status'));
    expect(await page.evaluate(()=>window.__observed.includes('/api/successor/prepare'))).toBe(false);
  }
  await page.locator('#omega-confirm').check();
  await expect(page.locator('#omega-execute')).toBeDisabled();
  await expect(page.locator('#omega-preview')).toBeEmpty();
  await expect(page.locator('#omega-message')).not.toContainText(/Review this one-minute|Examinez cette autorisation/);
});

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

for(const lang of ['en','fr'])test(`SUCCESSOR ${lang}: restored method survives changed data, mapping consent and readable numeric report`,async({page,browser},info)=>{
  await page.goto(lang==='fr'?'/successor-fr.html':'/successor.html');
  await page.locator('#data-file').setInputFiles({name:'public.csv',mimeType:'text/csv',buffer:Buffer.from('\ufeffid,category,value\na,Software,1200.5\nb,Software,-100.5\nc,Research,1000\nc,Research,1000\nd,Documentation,300')});
  await expect(page.locator('#data')).toHaveValue(/^id,category,value/);await page.locator('#rights').evaluate(el=>el.closest('details').open=true);await page.locator('#rights').fill('Synthetic nonpersonal test input, MIT.');
  await page.locator('#public-consent').check();await page.locator('#run').click();await expect(page.locator('#keep-version')).toBeEnabled();await page.locator('#keep-version').click();await page.locator('#improve-local').click();await expect(page.locator('#keep-version')).toBeEnabled();await page.locator('#keep-version').click();
  const [saved]=await Promise.all([page.waitForEvent('download'),page.locator('#download-capsule').click()]);const original=fs.readFileSync(await saved.path(),'utf8');
  const fresh=await browser.newContext({acceptDownloads:true,baseURL:'http://127.0.0.1:4173'});const restored=await fresh.newPage();await restored.goto(lang==='fr'?'/successor-fr.html':'/successor.html');
  await restored.locator('#import-file').setInputFiles({name:'saved.json',mimeType:'application/json',buffer:Buffer.from(original)});await restored.locator('#restore-consent').check();await restored.locator('#restore').click();await restored.locator('#reuse-method').click();
  await restored.locator('#data').fill('order_id,product,amount\na,Software,1400\nb,Software,-50\nc,Research,920.10\nc,Research,920.10\nd,Documentation,250');await restored.locator('#map-columns').evaluate(el=>el.closest('details').open=true);await restored.locator('#map-columns').click();
  for(const [target,source] of [['id','order_id'],['category','product'],['value','amount']])await restored.locator('#map-'+target).selectOption(source);
  await restored.locator('#preview-mapping').click();await expect(restored.locator('#mapping-preview')).toContainText('920.10');await restored.locator('#apply-mapping').click();await expect(restored.locator('#error')).toContainText('MAPPING_CONFIRMATION');await restored.locator('#mapping-consent').check();await restored.locator('#apply-mapping').click();
  await restored.locator('#public-consent').check();await restored.locator('#new-mission').check();await restored.locator('#run').click();await expect(restored.locator('#keep-version')).toBeEnabled();await restored.locator('#keep-version').click();
  const [capsule]=await Promise.all([restored.waitForEvent('download'),restored.locator('#download-capsule').click()]);const state=JSON.parse(fs.readFileSync(await capsule.path(),'utf8')).payload.state;const candidate=state.candidates.find(c=>c.id===state.active);const result=JSON.parse(candidate.files.find(f=>f.name==='result.json').content);
  expect(result.policy).toBe('identical-id-once');expect(result.groups.map(g=>g.total)).toEqual(['250','920.1','1350']);expect(state.plans).toEqual([]);expect(state.authority).toBe('none');expect(state.chronicle.map(e=>e.action)).toContain('method-reused');expect(state.chronicle.map(e=>e.action)).toContain('input-mapped');
  const [report]=await Promise.all([restored.waitForEvent('download'),restored.locator('#artifact-downloads button').filter({hasText:'report.html'}).click()]);const reportPath=info.outputPath('report.html');await report.saveAs(reportPath);const artifact=await fresh.newPage();await artifact.goto('file://'+reportPath);
  for(const width of [320,390,768,1440]){await artifact.setViewportSize({width,height:1000});expect(await artifact.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(await artifact.locator('td:not(:first-child)').evaluateAll(cells=>cells.every(cell=>getComputedStyle(cell).whiteSpace==='nowrap'))).toBe(true);await artifact.locator('.table-scroll').focus();await expect(artifact.locator('.table-scroll')).toBeFocused();await artifact.keyboard.press('ArrowRight');await artifact.screenshot({path:info.outputPath(`report-${width}.png`),fullPage:true});}
  await artifact.emulateMedia({media:'print'});await expect(artifact.locator('table')).toBeVisible();await fresh.close();
});
