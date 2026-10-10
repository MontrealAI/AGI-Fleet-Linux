import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {ensurePublicBrowserRuntimeDirectory,inspectPublicBrowserSocket,inspectPrivateBrokerSocket,reclaimPublicBrowserSocket} from './public-browser-runtime.mjs';
import {validateBrowserContext,validateBrowserCommand} from './openclaw-public-browser/client.mjs';
export {requestPublicBrowser} from './openclaw-public-browser/client.mjs';
const need=(value,code)=>{if(!value)throw Error(code);};
export async function startPublicBrowserBroker({socketPath,profileDir,execute,checkPolicy=()=>{}}){
 need(typeof socketPath==='string'&&path.isAbsolute(socketPath)&&Buffer.byteLength(socketPath)<104&&!/[\0-\x1f]/.test(socketPath),'PUBLIC_BROWSER_SOCKET_INVALID');
 if(profileDir)ensurePublicBrowserRuntimeDirectory({profileDir,socketPath});
 const inspect=profileDir?()=>inspectPublicBrowserSocket(socketPath,{profileDir}):()=>inspectPrivateBrokerSocket(socketPath);
 await reclaimPublicBrowserSocket(socketPath,profileDir?{profileDir}:undefined);const parent=inspect().directoryIdentity;
 const sockets=new Set(),server=http.createServer(async(request,response)=>{
  const controller=new AbortController();let complete=false;response.on('close',()=>{if(!complete)controller.abort();});
  const send=(status,value)=>{if(!response.destroyed){complete=true;response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(value));}};
  try{
   need(request.method==='POST'&&request.url==='/command'&&request.headers['content-type']==='application/json','PUBLIC_BROWSER_REQUEST_INVALID');
   need(!request.headers['transfer-encoding']&&/^\d+$/.test(request.headers['content-length']??'')&&Number(request.headers['content-length'])<=8192,'PUBLIC_BROWSER_REQUEST_LIMIT');
   let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;need(size<=8192,'PUBLIC_BROWSER_REQUEST_LIMIT');chunks.push(chunk);}
   const body=JSON.parse(Buffer.concat(chunks));need(Object.keys(body).every(key=>['agentId','sessionKey','command'].includes(key)),'PUBLIC_BROWSER_REQUEST_INVALID');
   const context=validateBrowserContext(body),command=validateBrowserCommand(body.command);await checkPolicy();
   const result=await execute({...context,command,signal:controller.signal});await checkPolicy();send(200,result);
  }catch(error){send(403,{code:/^PUBLIC_[A-Z0-9_]+$/.test(error.message)?error.message:'PUBLIC_BROWSER_DENIED'});}
 });
 server.requestTimeout=30000;server.headersTimeout=5000;server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 const before=inspect().directoryIdentity;need(before.ino===parent.ino&&before.dev===parent.dev,'PUBLIC_BROWSER_SOCKET_CHANGED');
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
 const bound=fs.lstatSync(socketPath),boundParent=fs.lstatSync(path.dirname(socketPath));
 if(!bound.isSocket()||bound.nlink!==1||bound.uid!==process.getuid?.()||!boundParent.isDirectory()||boundParent.ino!==parent.ino||boundParent.dev!==parent.dev){server.unref();throw Error('PUBLIC_BROWSER_SOCKET_CHANGED');}
 fs.chmodSync(socketPath,0o600);const identity=inspect();let closed=false;
 return {socketPath,async close(){
  if(closed)return;for(const socket of sockets)socket.destroy();let actual;try{actual=inspect();}catch{server.unref();throw Error('PUBLIC_BROWSER_SOCKET_CHANGED');}
  // Node's native close unlinks its pathname. Do not call it when that pathname
  // has been replaced: preserve the unexpected object and let process exit close
  // the detached listener. The owned 0700 directory excludes other-UID writers.
  if(!actual.exists||actual.ino!==identity.ino||actual.dev!==identity.dev||actual.directoryIdentity.ino!==identity.directoryIdentity.ino||actual.directoryIdentity.dev!==identity.directoryIdentity.dev){server.unref();throw Error('PUBLIC_BROWSER_SOCKET_CHANGED');}
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));closed=true;
  need(!inspect().exists,'PUBLIC_BROWSER_SOCKET_CHANGED');
 }};
}
