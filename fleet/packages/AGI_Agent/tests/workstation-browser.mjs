import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {Controller} from '../src/control/controller.mjs';
import {createControlServer} from '../src/control/server.mjs';
import {bundleZIP} from '../src/artifacts.mjs';
const spec=JSON.parse(fs.readFileSync(new URL('../examples/computer-smoke.json',import.meta.url))),bundle=fs.readFileSync(new URL('../examples/computer-smoke.bundle.json',import.meta.url));
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-capable-browser-'));
const output=process.env.BROWSER_OUTPUT??home;fs.mkdirSync(output,{recursive:true});
let clock=Date.now();
const response=value=>Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
const c=new Controller(home,{companion:{now:()=>clock,fetchImpl:async(url,opts)=>{
 if(url.endsWith('/health'))return Response.json({policyCurrent:true,protocol:'agi-compute/v2',role:'agent',capabilities:['browser','desktop','files'],uid:1001+(process.getuid?.()??0),policyHash:'a'.repeat(64),tools:true,gatewayReady:true,auth:'chatgpt-oauth'});
 const kind=opts.headers['x-agi-kind'];
 if(kind==='generate')return response({status:'complete',content:bundle.toString()});
 return response({status:'ready'});
}}});
await c.createVault('Fixture-only browser password 123!');await c.wallet('create');
const app=await createControlServer(c,{port:0});let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);
 await page.waitForFunction(()=>document.getElementById('vaultState').textContent.includes('Unlocked'));
 await page.click('[data-view="intelligence"]');
 assert.equal(await page.inputValue('#workMode'),'workstation');await page.check('#kitConsent');
 const kitEvent=page.waitForEvent('download');await page.click('#kit');const kit=await kitEvent;const kitPath=path.join(home,'kit.json');await kit.saveAs(kitPath);
 const data=JSON.parse(fs.readFileSync(kitPath));assert.equal(data.mode,'workstation');assert.equal(data.signerUID,process.getuid());assert.equal(data.port,18894);
 await page.waitForFunction(()=>!document.getElementById('kit').disabled);
 await page.click('#testAI');await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('valid model response'));
 clock+=31000;
 const imageEvent=page.waitForEvent('download');await page.click('#testComputer');const image=await imageEvent;const imagePath=path.join(home,'actual-download.zip');await image.saveAs(imagePath);assert.deepEqual(fs.readFileSync(imagePath),bundleZIP(spec,bundle));
 await page.waitForFunction(()=>!document.getElementById('testComputer').disabled);
 await page.screenshot({path:path.join(output,'computer-studio-desktop.png'),fullPage:true});
 await page.click('[data-view="policy"]');await page.fill('#buyers','0x1111111111111111111111111111111111111111');await page.check('#computerJobs');await page.locator('#policyForm > button').click();
 await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Policy saved'));assert.equal(c.config.execution.allowComputerWork,true);
 await page.setViewportSize({width:390,height:844});
 for(const id of ['intelligence','policy','help']){await page.click(`[data-view="${id}"]`);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overflow '+id);}
 await page.click('[data-view="intelligence"]');await page.screenshot({path:path.join(output,'computer-studio-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({role:'agent',browser:await browser.version(),capableSetupKit:true,mockedSeparateCompute:true,actualOfficeZIPDownload:true,computerScopeSaved:true,mobileNoOverflow:true,javascriptErrors:errors,liveInference:false,macOrDockerQualification:false},null,2));
}finally{await browser?.close();await c.close();await app.close();fs.rmSync(home,{recursive:true,force:true});}
