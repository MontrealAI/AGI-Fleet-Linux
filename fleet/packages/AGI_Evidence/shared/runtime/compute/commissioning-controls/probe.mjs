import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex'),run=promisify(execFile);
function check(v,code){if(!v)throw Error(code);}
export async function browserProbe(input,{spawnImpl=spawn,outputRoot='/workspace/proof',pauseImpl=pause}={}){
 const events=[],effects=[],html='<!doctype html><meta charset="utf-8"><title>AGI controlled browser fixture</title><h1>Offline control verification</h1><p id="challenge">'+input.browserChallenge+'</p><form id="fixture"><input id="answer" autocomplete="off"><button id="submit">Submit</button></form><output id="result"></output><script>document.querySelector("form").onsubmit=async e=>{e.preventDefault();const r=await fetch("/submit",{method:"POST",body:document.querySelector("input").value});document.querySelector("output").textContent=await r.text();};</script>';
 const server=http.createServer(async(req,res)=>{if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}if(req.method==='POST'&&req.url==='/submit'){let body='';for await(const chunk of req){body+=chunk;if(body.length>128){res.writeHead(413);res.end();return;}}effects.push({action:'submit',value:body,at:Date.now()});res.end(body===input.browserChallenge?'accepted':'rejected');return;}res.writeHead(404);res.end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/`;
 const child=spawnImpl('chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-extensions','--no-first-run','--remote-debugging-pipe','--user-data-dir=/tmp/agi-controlled-browser','about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
 let serial=0,partial='',sessionId,failure;const pending=new Map();
 const fail=code=>{failure=code;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(code));}pending.clear();};
 child.once('error',()=>fail('CONTROLS_BROWSER_UNAVAILABLE'));child.once('close',()=>fail('CONTROLS_CDP_CLOSED'));
 child.stdio[3].on('error',()=>fail('CONTROLS_CDP_CLOSED'));child.stdio[4].on('error',()=>fail('CONTROLS_CDP_CLOSED'));
 child.stdio[4].on('data',b=>{try{partial+=b.toString();check(partial.length<=4194304,'CONTROLS_CDP_LIMIT');let end;while((end=partial.indexOf('\0'))>=0){const raw=partial.slice(0,end);partial=partial.slice(end+1);if(!raw)continue;const msg=JSON.parse(raw),p=pending.get(msg.id);if(p){pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Error('CONTROLS_CDP_ERROR')):p.resolve(msg.result);}}}catch{fail('CONTROLS_CDP_FORMAT');child.kill('SIGKILL');}});
 const send=(method,params={},session=sessionId)=>new Promise((resolve,reject)=>{if(failure)return reject(Error(failure));const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CONTROLS_CDP_TIMEOUT'));},20000);pending.set(id,{resolve,reject,timer});child.stdio[3].write(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})})+'\0');events.push({source:'chromium-cdp-controller',method,at:Date.now()});});
 const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true})).result?.value;
 try{
  const target=await send('Target.createTarget',{url:'about:blank'},null);sessionId=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url});
  let value;for(let n=0;n<100;n++){value=await evaluate('document.getElementById("challenge")?.textContent');if(value)break;await pauseImpl(50);}check(value===input.browserChallenge,'CONTROLS_BROWSER_DOM');
  const click=async selector=>{const rect=await evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});};
  await click('#answer');await send('Input.insertText',{text:value});await click('#submit');
  for(let n=0;n<100&&!effects.length;n++)await pauseImpl(50);check(effects.length===1&&effects[0].value===value,'CONTROLS_BROWSER_EFFECT');
  const dom=await evaluate('document.documentElement.outerHTML'),screenshot=Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64');fs.writeFileSync(path.join(outputRoot,'browser.png'),screenshot);
  return {status:'PASS',capability:'local-browser-controls',fixtureSHA256:sha(html),domSHA256:sha(dom),domBytes:dom,observedValue:value,effect:effects[0],events,screenshotSHA256:sha(screenshot),modelDriven:false,normalAgentPipeline:false,publicWeb:false};
 }finally{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CONTROLS_CDP_CLOSED'));}pending.clear();child.kill('SIGKILL');await new Promise(resolve=>server.close(resolve));}
}
async function main(){
const input=JSON.parse(fs.readFileSync('/proof-input/input.json'));fs.mkdirSync('/workspace/proof',{recursive:true});
const report={schema:'agi-local-controls/v1',runID:input.runID,startedAt:Date.now(),network:'none',normalAgentPipeline:false,modelDriven:false,providerCalls:0};
try{report.browser=await browserProbe(input);}catch(e){report.browser={status:'FAIL',code:/^CONTROLS_[A-Z_]+$/.test(e.message)?e.message:'CONTROLS_BROWSER_UNAVAILABLE'};}
try{const result=await run('python3',['/proof/desktop-probe.py'],{timeout:120000,maxBuffer:1048576});report.desktop=JSON.parse(result.stdout);}catch{report.desktop={status:'FAIL',code:'CONTROLS_DESKTOP_UNAVAILABLE'};}
report.finishedAt=Date.now();fs.writeFileSync('/workspace/proof/report.json',JSON.stringify(report));console.log('AGI_CONTROLS_COMPLETE');setInterval(()=>{},1000);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{process.exitCode=1;});
