import http from 'node:http';
import path from 'node:path';

const need=(v,c)=>{if(!v)throw Error(c);};
export const PUBLIC_BROWSER_TOOL='agi_public_browser';
export function validateBrowserContext(context){
 need(context&&['agi-creator','agi-reviewer'].includes(context.agentId),'PUBLIC_BROWSER_ROLE_REQUIRED');
 need(typeof context.sessionKey==='string'&&new RegExp('^agent:'+context.agentId+':agi-work-[a-f0-9-]{36}$').test(context.sessionKey),'PUBLIC_BROWSER_SESSION_REQUIRED');
 return {agentId:context.agentId,sessionKey:context.sessionKey};
}
export function validateBrowserCommand(command){
 need(command&&typeof command==='object'&&!Array.isArray(command),'PUBLIC_BROWSER_COMMAND_INVALID');
 const fields={navigate:['action','url'],snapshot:['action'],click:['action','link','ref'],type:['action','ref','text'],scroll:['action','direction'],screenshot:['action']}[command.action];
 need(fields&&Object.keys(command).every(k=>fields.includes(k)),'PUBLIC_BROWSER_COMMAND_INVALID');
 if(command.action==='navigate')need(typeof command.url==='string'&&command.url.length<=4096,'PUBLIC_BROWSER_URL_INVALID');
 if(command.action==='click')need((Number.isSafeInteger(command.link)&&command.link>=1&&command.link<=100&&command.ref===undefined)||(command.link===undefined&&typeof command.ref==='string'&&/^[a-f0-9-]{36}:[0-9]{1,3}$/.test(command.ref)),'PUBLIC_BROWSER_LINK_INVALID');
 if(command.action==='type')need(typeof command.ref==='string'&&/^[a-f0-9-]{36}:[0-9]{1,3}$/.test(command.ref)&&typeof command.text==='string'&&command.text.length<=2000&&!/[\0-\x08\x0b\x0c\x0e-\x1f]/.test(command.text),'PUBLIC_BROWSER_INPUT_INVALID');
 if(command.action==='scroll')need(['up','down'].includes(command.direction),'PUBLIC_BROWSER_SCROLL_INVALID');
 return structuredClone(command);
}
export function requestPublicBrowser({socketPath,context,command,signal,timeoutMs=25000}){
 const identity=validateBrowserContext(context),validated=validateBrowserCommand(command);
 need(typeof socketPath==='string'&&path.isAbsolute(socketPath)&&Buffer.byteLength(socketPath)<104&&!/[\0-\x1f]/.test(socketPath),'PUBLIC_BROWSER_SOCKET_INVALID');
 return new Promise((resolve,reject)=>{
  const body=Buffer.from(JSON.stringify({...identity,command:validated}));
  const request=http.request({socketPath,path:'/command',method:'POST',headers:{'Content-Type':'application/json','Content-Length':body.length},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)},response=>{
   const chunks=[];let length=0;response.on('data',chunk=>{length+=chunk.length;if(length>2*1024*1024)request.destroy(Error('PUBLIC_BROWSER_RESPONSE_LIMIT'));else chunks.push(chunk);});
   response.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks));if(response.statusCode!==200)throw Error(/^PUBLIC_[A-Z0-9_]+$/.test(value.code)?value.code:'PUBLIC_BROWSER_REQUEST_FAILED');resolve(value);}catch(error){reject(error);}});
  });
  request.on('error',error=>reject(Error(signal?.aborted?'PUBLIC_BROWSER_CANCELLED':/^PUBLIC_[A-Z0-9_]+$/.test(error.message)?error.message:'PUBLIC_BROWSER_UNAVAILABLE')));request.end(body);
 });
}
