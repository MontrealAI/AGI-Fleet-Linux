import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';

const need=(value,code)=>{if(!value)throw Error(code);};
const currentUID=()=>process.getuid?.();
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const identity=st=>({dev:st.dev,ino:st.ino,uid:st.uid,mode:st.mode});
function absolute(value){need(typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value&&!/[\0-\x1f]/.test(value),'PUBLIC_BROWSER_SOCKET_INVALID');return value;}
function ancestors(directory){for(let current=directory;;current=path.dirname(current)){const st=fs.lstatSync(current);need(!st.isSymbolicLink(),'PUBLIC_BROWSER_SOCKET_SYMLINK');need(st.isDirectory(),'PUBLIC_BROWSER_SOCKET_PERMISSIONS');if(current===path.dirname(current))break;}}
function existingAncestors(directory){for(let current=directory;;current=path.dirname(current)){try{const st=fs.lstatSync(current);need(!st.isSymbolicLink(),'PUBLIC_BROWSER_SOCKET_SYMLINK');need(st.isDirectory(),'PUBLIC_BROWSER_SOCKET_PERMISSIONS');}catch(error){if(error.code!=='ENOENT')throw error;}if(current===path.dirname(current))break;}}
function privateDirectory(directory,uid){ancestors(directory);const st=fs.lstatSync(directory);need(st.isDirectory()&&st.uid===uid&&(st.mode&0o7777)===0o700,'PUBLIC_BROWSER_SOCKET_PERMISSIONS');return st;}
function runtimeBase(platform){need(['darwin','linux'].includes(platform),'PUBLIC_BROWSER_SOCKET_INVALID');return platform==='darwin'?'/private/tmp':'/tmp';}
function checkBase(platform){const base=runtimeBase(platform);ancestors(base);const st=fs.lstatSync(base);need(st.uid===0&&(st.mode&0o1700)===0o1700,'PUBLIC_BROWSER_SOCKET_PERMISSIONS');return st;}

// A stable, short endpoint outside the sealed profile; no environment-supplied
// TMPDIR and no /tmp or /var symlink aliases on macOS.
export function publicBrowserRuntimeSocketPath(profileDir,{uid=currentUID(),platform=process.platform}={}){
 absolute(profileDir);need(Number.isSafeInteger(uid)&&uid>=0&&uid<=0xffffffff,'PUBLIC_BROWSER_SOCKET_INVALID');
 const directory=path.join(runtimeBase(platform),`agi-web-${uid}-${crypto.createHash('sha256').update(profileDir).digest('hex').slice(0,20)}`),socketPath=path.join(directory,'web.sock');
 need(!directory.startsWith(profileDir+path.sep)&&directory!==profileDir&&Buffer.byteLength(socketPath)<104,'PUBLIC_BROWSER_SOCKET_INVALID');return socketPath;
}
function scope(socketPath,{profileDir,allowLegacy=false,uid=currentUID(),platform=process.platform}={}){
 absolute(socketPath);absolute(profileDir);need(Buffer.byteLength(socketPath)<104,'PUBLIC_BROWSER_SOCKET_INVALID');
 const external=socketPath===publicBrowserRuntimeSocketPath(profileDir,{uid,platform});
 need(external||(allowLegacy&&socketPath===path.join(profileDir,'web.sock')),'PUBLIC_BROWSER_SOCKET_INVALID');
 if(external)checkBase(platform);return {directory:path.dirname(socketPath),external,uid};
}
export function ensurePublicBrowserRuntimeDirectory({profileDir,socketPath,uid=currentUID(),platform=process.platform}){
 socketPath??=publicBrowserRuntimeSocketPath(profileDir,{uid,platform});
 const {directory}=scope(socketPath,{profileDir,uid,platform});
 try{fs.mkdirSync(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 privateDirectory(directory,uid);return directory;
}
// Also usable for the exact legacy endpoint during supervised recovery. No
// unexpected object is removed or silently exempted from profile identity.
export function inspectPublicBrowserSocket(socketPath,{profileDir,allowLegacy=false,uid=currentUID(),platform=process.platform}={}){
 const {directory,external}=scope(socketPath,{profileDir,allowLegacy,uid,platform});let parent;
 try{parent=privateDirectory(directory,uid);}catch(error){if(error.code==='ENOENT'){existingAncestors(directory);return {exists:false,socketPath};}throw error;}
 let st;try{st=fs.lstatSync(socketPath);}catch(error){if(error.code==='ENOENT')return {exists:false,socketPath,directoryIdentity:identity(parent)};throw error;}
 need(st.isSocket()&&!st.isSymbolicLink()&&st.nlink===1&&st.uid===uid&&(st.mode&0o7777)===0o600,'PUBLIC_BROWSER_SOCKET_EXISTS');
 need(same(parent,privateDirectory(directory,uid)),'PUBLIC_BROWSER_SOCKET_CHANGED');
 return {exists:true,socketPath,...identity(st),directoryIdentity:identity(parent)};
}
export function inspectPrivateBrokerSocket(socketPath,{uid=currentUID()}={}){
 absolute(socketPath);need(Buffer.byteLength(socketPath)<104,'PUBLIC_BROWSER_SOCKET_INVALID');const directory=path.dirname(socketPath),parent=privateDirectory(directory,uid);
 let st;try{st=fs.lstatSync(socketPath);}catch(error){if(error.code==='ENOENT')return {exists:false,socketPath,directoryIdentity:identity(parent)};throw error;}
 need(st.isSocket()&&!st.isSymbolicLink()&&st.nlink===1&&st.uid===uid&&(st.mode&0o7777)===0o600,'PUBLIC_BROWSER_SOCKET_EXISTS');
 return {exists:true,socketPath,...identity(st),directoryIdentity:identity(parent)};
}
export async function reclaimPublicBrowserSocket(socketPath,options){
 need(!options?.signal?.aborted,'PUBLIC_BROWSER_SOCKET_CANCELLED');
 const inspect=options?.profileDir?()=>inspectPublicBrowserSocket(socketPath,options):()=>inspectPrivateBrokerSocket(socketPath),prior=inspect();if(!prior.exists)return false;
 const stale=await new Promise(resolve=>{const probe=net.connect({path:socketPath});let done=false;const finish=value=>{if(done)return;done=true;probe.destroy();resolve(value);};probe.setTimeout(1000,()=>finish(false));probe.once('connect',()=>finish(false));probe.once('error',error=>finish(error.code==='ECONNREFUSED'));});
 need(!options?.signal?.aborted,'PUBLIC_BROWSER_SOCKET_CANCELLED');const latest=inspect();need(latest.directoryIdentity&&same(prior.directoryIdentity,latest.directoryIdentity),'PUBLIC_BROWSER_SOCKET_CHANGED');if(!latest.exists)return false;need(stale,'PUBLIC_BROWSER_SOCKET_EXISTS');need(same(prior,latest),'PUBLIC_BROWSER_SOCKET_CHANGED');fs.unlinkSync(socketPath);return true;
}
// Call only after both managed service registrations and both ports are absent.
// A listener that is still alive returns false; only ECONNREFUSED plus unchanged
// owned inode/parent permits removal of a crash-left socket.
export async function publicBrowserSocketsStopped({profileDir,uid=currentUID(),platform=process.platform,signal}={}){
 const options={profileDir,uid,platform,signal,allowLegacy:true},paths=[publicBrowserRuntimeSocketPath(profileDir,{uid,platform}),path.join(profileDir,'web.sock')];
 for(const socketPath of paths){need(!signal?.aborted,'PUBLIC_BROWSER_SOCKET_CANCELLED');const value=inspectPublicBrowserSocket(socketPath,options);if(!value.exists)continue;try{await reclaimPublicBrowserSocket(socketPath,options);}catch(error){if(error.message==='PUBLIC_BROWSER_SOCKET_EXISTS'){if(inspectPublicBrowserSocket(socketPath,options).exists)return false;continue;}throw error;}}
 return paths.every(socketPath=>!inspectPublicBrowserSocket(socketPath,options).exists);
}
