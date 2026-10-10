import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {Controller} from '../src/control/controller.mjs';
import {createControlServer} from '../src/control/server.mjs';
import {imageSpec,png} from './image-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-capable-browser-'));
const output=process.env.BROWSER_OUTPUT??home;fs.mkdirSync(output,{recursive:true});
let clock=Date.now();
const response=value=>Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
const c=new Controller(home,{companion:{now:()=>clock,fetchImpl:async(url,opts)=>{
 if(url.endsWith('/health'))return Response.json({policyCurrent:true,protocol:'agi-compute/v1',uid:1001+(process.getuid?.()??0),policyHash:'a'.repeat(64),tools:true,gatewayReady:true,auth:'chatgpt-oauth'});
 const kind=opts.headers['x-agi-kind'];
 if(kind==='generate')return response({status:'complete',content:png().toString('base64')});
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
 await page.selectOption('#workMode','tools');assert.equal(await page.inputValue('#workMode'),'tools');await page.check('#kitConsent');
 const kitEvent=page.waitForEvent('download');await page.click('#kit');const kit=await kitEvent;const kitPath=path.join(home,'kit.json');await kit.saveAs(kitPath);
 const data=JSON.parse(fs.readFileSync(kitPath));assert.equal(data.mode,'tools');assert.equal(data.signerUID,process.getuid());assert.equal(data.port,18894);
 await page.waitForFunction(()=>!document.getElementById('kit').disabled);
 await page.click('#testAI');await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('valid model response'));
 clock+=31000;
 const imageEvent=page.waitForEvent('download');await page.click('#testImage');const image=await imageEvent;const imagePath=path.join(home,'actual-download.png');await image.saveAs(imagePath);assert.deepEqual(fs.readFileSync(imagePath),png());
 await page.waitForFunction(()=>!document.getElementById('testImage').disabled);
 await page.screenshot({path:path.join(output,'capable-studio-desktop.png'),fullPage:true});
 await page.click('[data-view="policy"]');await page.fill('#buyers','0x1111111111111111111111111111111111111111');await page.check('#imageJobs');await page.locator('#policyForm > button').click();
 await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Policy saved'));assert.equal(c.config.execution.allowImages,true);
 await page.setViewportSize({width:390,height:844});
 for(const id of ['intelligence','policy','help']){await page.click(`[data-view="${id}"]`);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overflow '+id);}
 await page.click('[data-view="intelligence"]');await page.screenshot({path:path.join(output,'capable-studio-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({role:'agent',browser:await browser.version(),capableSetupKit:true,mockedSeparateCompute:true,actualPNGDownload:true,imageScopeSaved:true,mobileNoOverflow:true,javascriptErrors:errors,liveInference:false,macOrDockerQualification:false},null,2));
}finally{await browser?.close();await c.close();await app.close();fs.rmSync(home,{recursive:true,force:true});}
