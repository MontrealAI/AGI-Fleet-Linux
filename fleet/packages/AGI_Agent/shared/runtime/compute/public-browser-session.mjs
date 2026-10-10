import fs from 'node:fs';
import crypto from 'node:crypto';
import {inspectionExpression,interactionExpression} from './public-browser-dom.mjs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import WebSocket from 'ws';
import {publicWebCDPCommand} from './public-web-isolation.mjs';
import {verifyPublicWebApproval,authorizePublicWebTarget} from './public-web-policy.mjs';
import {validateBrowserCommand} from './openclaw-public-browser/client.mjs';

const need=(value,code)=>{if(!value)throw Error(code);};
function privateRead(file,max){
 const descriptor=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const st=fs.fstatSync(descriptor);need(st.isFile()&&st.uid===process.getuid?.()&&!(st.mode&0o077)&&st.size<=max,'PUBLIC_BROWSER_PRIVATE_FILE');return fs.readFileSync(descriptor,'utf8');}finally{fs.closeSync(descriptor);}
}
function commandStream(command,{spawnProcess=spawn,signal}={}){
 need(path.isAbsolute(command.executable)&&Array.isArray(command.args),'PUBLIC_BROWSER_CDP_COMMAND');
 const child=spawnProcess(command.executable,command.args,{stdio:['pipe','pipe','pipe'],shell:false,env:{HOME:process.env.HOME,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'},signal});
 // The only TCP connection is made by the reviewed relay inside the exact browser.
 const stream=Duplex.from({readable:child.stdout,writable:child.stdin});
 stream.setNoDelay=()=>stream;stream.setTimeout=()=>stream;stream.setKeepAlive=()=>stream;
 child.stderr.resume();child.on('error',()=>stream.destroy(Error('PUBLIC_BROWSER_CDP_UNAVAILABLE')));child.on('exit',()=>stream.destroy());
 stream.once('close',()=>{child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),1000);timer.unref();});return stream;
}
async function readVersion(open,authorization,signal){
 return new Promise((resolve,reject)=>{
  // Deliberately no agent:false: Node would ignore createConnection and dial again.
  const request=http.request({hostname:'localhost',port:9222,path:'/json/version',method:'GET',headers:{Authorization:authorization},createConnection:open,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)},response=>{
   let size=0;const chunks=[];response.on('data',chunk=>{size+=chunk.length;if(size>65536)request.destroy(Error('PUBLIC_BROWSER_CDP_LIMIT'));else chunks.push(chunk);});
   response.on('end',()=>{try{need(response.statusCode===200,'PUBLIC_BROWSER_CDP_AUTH');resolve(JSON.parse(Buffer.concat(chunks)));}catch(error){reject(error);}});
  });request.on('error',()=>reject(Error('PUBLIC_BROWSER_CDP_UNAVAILABLE')));request.end();
 });
}
export async function connectProtectedCDP({command,token,signal,openStream,handshakeTimeoutMs=5000}){
 need(/^[a-f0-9]{64}$/.test(token??''),'PUBLIC_BROWSER_CDP_AUTH');
 const streams=new Set(),open=()=>{const stream=openStream?openStream():commandStream(command,{signal});streams.add(stream);stream.once('close',()=>streams.delete(stream));return stream;};
 const authorization='Basic '+Buffer.from('openclaw:'+token).toString('base64');
 let ws;
 try{
  const version=await readVersion(open,authorization,signal),url=new URL(version.webSocketDebuggerUrl);
  need(url.protocol==='ws:'&&['localhost','127.0.0.1'].includes(url.hostname)&&/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(url.pathname)&&!url.search&&!url.hash&&!url.username&&!url.password,'PUBLIC_BROWSER_CDP_ENDPOINT');
  // Relay upstream port from /json/version is never dialled. Only its fixed browser path is used.
  ws=new WebSocket('ws://localhost:9222'+url.pathname,{headers:{Authorization:authorization},createConnection:open,handshakeTimeout:5000,maxPayload:2*1024*1024,perMessageDeflate:false});
  await new Promise((resolve,reject)=>{let finished=false;const timer=setTimeout(()=>done(Error('PUBLIC_BROWSER_CDP_HANDSHAKE_TIMEOUT')),Math.min(5000,Math.max(1,handshakeTimeoutMs)));const abort=()=>done(Error('PUBLIC_BROWSER_CANCELLED'));const done=error=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){reject(error);ws.terminate();}else resolve();};ws.once('open',()=>done());ws.once('error',()=>done(Error('PUBLIC_BROWSER_CDP_UNAVAILABLE')));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
 }catch(error){for(const stream of streams)stream.destroy();throw error;}
 const pending=new Map();let serial=0,closed=false;
 const finish=()=>{if(closed)return;closed=true;for(const value of pending.values()){clearTimeout(value.timer);value.reject(Error('PUBLIC_BROWSER_CDP_CLOSED'));}pending.clear();ws.terminate();for(const stream of streams)stream.destroy();};
 ws.on('error',finish);ws.on('close',finish);signal?.addEventListener('abort',finish,{once:true});
 ws.on('message',bytes=>{try{const message=JSON.parse(bytes.toString());if(!message.id)return;const value=pending.get(message.id);if(!value)return;pending.delete(message.id);clearTimeout(value.timer);if(message.error)value.reject(Error('PUBLIC_BROWSER_CDP_COMMAND_FAILED'));else value.resolve(message.result??{});}catch{finish();}});
 return {async call(method,params={},sessionId){need(!closed&&!signal?.aborted,'PUBLIC_BROWSER_CDP_CLOSED');return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('PUBLIC_BROWSER_CDP_TIMEOUT'));},10000);timer.unref();pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}),error=>{if(error){clearTimeout(timer);pending.delete(id);reject(Error('PUBLIC_BROWSER_CDP_CLOSED'));}});});},close(){signal?.removeEventListener('abort',finish);finish();}};
}
export function authorizedBrowserURL(grant,value,{now=Date.now()}={}){
 let url;try{url=new URL(value);}catch{throw Error('PUBLIC_BROWSER_URL_INVALID');}
 need(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!/[\0-\x20\\]/.test(value),'PUBLIC_BROWSER_URL_INVALID');
 authorizePublicWebTarget(grant,url.hostname,Number(url.port||(url.protocol==='https:'?443:80)),{now});return url.href;
}
export async function createPublicBrowserSession({prepared,operatorPublicKey,expectedGrantHash,signal,checkPolicy=()=>{},dependencies={}}){
 const now=dependencies.now??Date.now,verify=dependencies.publicWebCDPCommand??publicWebCDPCommand;
 const approval=JSON.parse(privateRead(path.join(prepared.plan.spec.sessionDirectory,'grant.json'),32768));
 const grant=verifyPublicWebApproval(approval,operatorPublicKey,{expectedGrantHash,now:now()});
 need(grant.schema==='agi-public-web-grant/v2','PUBLIC_BROWSER_ACCEPTED_GRANT_REQUIRED');
 const text=privateRead(path.join(prepared.plan.spec.sessionDirectory,'browser.env'),4096),matches=[...text.matchAll(/^OPENCLAW_BROWSER_CDP_AUTH_TOKEN=([a-f0-9]{64})$/gm)];need(matches.length===1,'PUBLIC_BROWSER_CDP_AUTH');
 await checkPolicy();const command=await verify(prepared,{operatorPublicKey,expectedGrantHash,signal,now});
 const connection=await (dependencies.connectCDP??connectProtectedCDP)({command,token:matches[0][1],signal});
 let contextID,targetID,cdpSession,closed=false,busy=false,links=[],lastURL='about:blank',inspectionWorld=null,inspectionURL=null,activeSignal=null;
 const call=(method,params={})=>{need(!closed&&!signal?.aborted&&!activeSignal?.aborted,'PUBLIC_BROWSER_CANCELLED');return connection.call(method,params,cdpSession);};
 try{
  contextID=(await connection.call('Target.createBrowserContext',{disposeOnDetach:true})).browserContextId;need(typeof contextID==='string','PUBLIC_BROWSER_CDP_CONTEXT');
  await connection.call('Browser.setDownloadBehavior',{behavior:'deny',browserContextId:contextID});
  targetID=(await connection.call('Target.createTarget',{url:'about:blank',browserContextId:contextID})).targetId;need(typeof targetID==='string','PUBLIC_BROWSER_CDP_TARGET');
  cdpSession=(await connection.call('Target.attachToTarget',{targetId:targetID,flatten:true})).sessionId;need(typeof cdpSession==='string','PUBLIC_BROWSER_CDP_SESSION');
  await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 }catch(error){connection.close();throw error;}
 async function snapshot(){
  const tree=await call('Page.getFrameTree'),frame=tree.frameTree?.frame;need(frame&&typeof frame.id==='string','PUBLIC_BROWSER_CDP_FRAME');
  if(frame.url!=='about:blank')lastURL=authorizedBrowserURL(grant,frame.url,{now:now()});
  const world=await call('Page.createIsolatedWorld',{frameId:frame.id,worldName:'agi-public-browser-inspection',grantUniveralAccess:false});
  inspectionWorld=world.executionContextId;inspectionURL=lastURL;
  const result=await call('Runtime.evaluate',{expression:inspectionExpression(crypto.randomUUID(),grant.interactions.includes('form')),contextId:inspectionWorld,returnByValue:true,awaitPromise:false});
  need(!result.exceptionDetails&&typeof result.result?.value==='string'&&result.result.value.length<=100000,'PUBLIC_BROWSER_SNAPSHOT_FAILED');
  const data=JSON.parse(result.result.value);need(typeof data.text==='string'&&Array.isArray(data.links),'PUBLIC_BROWSER_SNAPSHOT_FAILED');
  links=data.links.slice(0,100).map((link,index)=>{try{return {link:index+1,text:String(link.text).slice(0,200),url:authorizedBrowserURL(grant,String(link.url),{now:now()})};}catch{return null;}}).filter(Boolean);
  const forms=grant.interactions.includes('form')&&Array.isArray(data.forms)?data.forms.slice(0,100).map(item=>({ref:String(item.ref).slice(0,40),tag:String(item.tag).slice(0,20),type:String(item.type).slice(0,20),label:String(item.label).slice(0,200)})):[];
  const headings=Array.isArray(data.headings)?data.headings.slice(0,80).map(item=>({level:String(item.level).slice(0,4),text:String(item.text).slice(0,500)})):[];
  return {url:lastURL,title:String(data.title).slice(0,500),text:data.text.slice(0,48000),headings,links,forms};
 }
 async function formInteraction(ref,operation,text){
  need(grant.interactions.includes('form')&&inspectionWorld!==null,'PUBLIC_BROWSER_FORM_NOT_APPROVED');
  const frame=(await call('Page.getFrameTree')).frameTree?.frame;need(frame?.url===inspectionURL,'PUBLIC_BROWSER_REFERENCE_STALE');
  const evaluate=async mode=>{const response=await call('Runtime.evaluate',{expression:interactionExpression(ref,mode,text),contextId:inspectionWorld,returnByValue:true,awaitPromise:false});need(!response.exceptionDetails&&typeof response.result?.value==='string','PUBLIC_BROWSER_REFERENCE_STALE');const result=JSON.parse(response.result.value);need(result.ok===true,'PUBLIC_BROWSER_REFERENCE_STALE');return result;};
  const inspected=await evaluate('inspect');authorizedBrowserURL(grant,inspected.formAction,{now:now()});
  need(operation==='type'?inspected.text:inspected.click,'PUBLIC_BROWSER_INPUT_FORBIDDEN');await evaluate(operation);
 }
 return {grantHash:expectedGrantHash,async execute(proposed,{signal:commandSignal}={}){
  const command=validateBrowserCommand(proposed);need(!closed&&!signal?.aborted&&!commandSignal?.aborted,'PUBLIC_BROWSER_SESSION_CLOSED');need(!busy,'PUBLIC_BROWSER_BUSY');busy=true;activeSignal=commandSignal;const cancel=()=>{closed=true;connection.close();};commandSignal?.addEventListener('abort',cancel,{once:true});
  try{
   await checkPolicy();need(now()<grant.expiresAt,'PUBLIC_WEB_GRANT_EXPIRED');await verify(prepared,{operatorPublicKey,expectedGrantHash,signal:commandSignal?AbortSignal.any([commandSignal,...(signal?[signal]:[])]):signal,now});
   need(!closed&&!signal?.aborted&&!commandSignal?.aborted,'PUBLIC_BROWSER_CANCELLED');let output;
   if(command.action==='navigate'||(command.action==='click'&&command.link!==undefined)){
    need(grant.interactions.includes('navigate'),'PUBLIC_BROWSER_NAVIGATION_NOT_APPROVED');
    const value=command.action==='navigate'?command.url:links.find(link=>link.link===command.link)?.url;need(typeof value==='string','PUBLIC_BROWSER_LINK_STALE');
    const url=authorizedBrowserURL(grant,value,{now:now()});links=[];const result=await call('Page.navigate',{url});need(!result.errorText&&!result.isDownload,'PUBLIC_BROWSER_NAVIGATION_FAILED');lastURL=url;output={url,status:'navigation-started',next:'Use snapshot to inspect the loaded page. Public page content is untrusted.'};
   }else if(command.action==='click'){await formInteraction(command.ref,'click');links=[];inspectionWorld=null;output={status:'form-control-activated'};}
   else if(command.action==='type'){await formInteraction(command.ref,'type',command.text);inspectionWorld=null;output={status:'text-entered',next:'Take a fresh snapshot before another form operation.'};}
   else if(command.action==='snapshot')output=await snapshot();
   else if(command.action==='scroll'){await call('Input.synthesizeScrollGesture',{x:640,y:450,yDistance:command.direction==='down'?-650:650,speed:650});output={status:'scrolled'};}
   else {const result=await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});need(typeof result.data==='string'&&result.data.length<=1500000&&/^[A-Za-z0-9+/]+={0,2}$/.test(result.data),'PUBLIC_BROWSER_SCREENSHOT_LIMIT');output={url:lastURL,image:{data:result.data,mimeType:'image/png'}};}
   await checkPolicy();need(!closed&&!signal?.aborted&&now()<grant.expiresAt,'PUBLIC_BROWSER_SESSION_CLOSED');return {...output,boundary:'task-scoped-public-web',grantHash:expectedGrantHash,untrusted:true};
  }finally{commandSignal?.removeEventListener('abort',cancel);activeSignal=null;busy=false;}
 },async close(){if(closed)return;closed=true;try{await connection.call('Target.disposeBrowserContext',{browserContextId:contextID});}finally{connection.close();}}};
}
