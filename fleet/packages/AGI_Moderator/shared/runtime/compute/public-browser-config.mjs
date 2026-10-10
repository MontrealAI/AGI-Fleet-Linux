import {computeSourceIdentity} from './source-identity.mjs';
import {consumerRoot,consumerCompute,consumerFile} from './consumer.mjs';
import fs from 'node:fs';
import {readPublicWebQualification} from './public-web-qualified-runtime.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {publicBrowserRuntimeSocketPath} from './public-browser-runtime.mjs';
const need=(v,c)=>{if(!v)throw Error(c);};
export const PUBLIC_BROWSER_VERSION='agi-public-browser/v1';
export const PUBLIC_BROWSER_PLUGIN_FILES=['client.mjs','index.mjs','openclaw.plugin.json','package.json'];
export const PUBLIC_BROWSER_ADAPTER_FILES=['public-browser-dom.mjs','public-browser-session.mjs','public-browser-broker.mjs','public-browser-runtime.mjs','public-browser-config.mjs','public-web-policy.mjs','public-web-proxy.mjs','public-web-isolation.mjs','public-web-coordinator.mjs'];
const image=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
function read(file){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const st=fs.fstatSync(fd);need(st.isFile()&&st.size<=2*1024*1024,'PUBLIC_BROWSER_SOURCE_FILE');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}}
export function publicBrowserPluginDigest(directory){const h=crypto.createHash('sha256');for(const name of PUBLIC_BROWSER_PLUGIN_FILES){h.update(name+'\0');h.update(read(path.join(directory,name)));h.update('\0');}return h.digest('hex');}
export function publicBrowserAdapterDigest(directory=consumerCompute){if(fs.existsSync(path.join(directory,'../shared/runtime/compute'))){return computeSourceIdentity(path.resolve(directory,'..'));}const h=crypto.createHash('sha256'),files=[];const visit=dir=>{for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),st=fs.lstatSync(file);need(!st.isSymbolicLink(),'PUBLIC_BROWSER_SOURCE_SYMLINK');if(st.isDirectory())visit(file);else if(st.isFile()&&(/\.(mjs|cjs|py|sh|json)$/.test(name)||name==='Dockerfile'))files.push(file);}};visit(directory);need(files.length<256,'PUBLIC_BROWSER_SOURCE_LIMIT');for(const file of files.sort()){h.update(path.relative(directory,file)+'\0');h.update(read(file));h.update('\0');}return h.digest('hex');}
function publicAuthority(value,code){need(typeof value==='string'&&value.length<=4096,code);let key;try{key=crypto.createPublicKey(value);}catch{throw Error(code);}const canonical=key.export({type:'spki',format:'pem'});need(key.asymmetricKeyType==='ed25519'&&value.replaceAll('\r\n','\n').trim()===canonical.trim(),code);return canonical;}
export function makePublicBrowserPolicy({profileDir,uid=process.getuid?.(),platform=process.platform,operatorPublicKey,previous,proposal,sourceDirectory=path.join(consumerCompute,'openclaw-public-browser')}){
 const selected=proposal??previous??{};
 if(proposal)need(Object.keys(proposal).every(k=>['schema','mode','browserImageID','proxyImageID','reviewerPublicKey'].includes(k))&&proposal.schema==='agi-public-browser-policy-proposal/v1','PUBLIC_BROWSER_PROPOSAL_INVALID');
 const mode=!proposal&&selected.mode==='qualified'?'commissioning':selected.mode??'disabled';need(['disabled','commissioning'].includes(mode),'PUBLIC_BROWSER_QUALIFICATION_IMPORT_REQUIRED');
 const proposedAuthority=operatorPublicKey??previous?.operatorPublicKey??null,authority=proposedAuthority===null?null:publicAuthority(proposedAuthority,'PUBLIC_BROWSER_AUTHORITY_INVALID');
 const proposedReviewer=selected.reviewerPublicKey??previous?.reviewerPublicKey??null,reviewerPublicKey=proposedReviewer===null?null:publicAuthority(proposedReviewer,'PUBLIC_BROWSER_REVIEWER_INVALID');if(reviewerPublicKey!==null&&authority)need(reviewerPublicKey!==authority,'PUBLIC_BROWSER_INDEPENDENT_REVIEWER_REQUIRED');
 const enabled=mode!=='disabled';need(!enabled||(authority&&image(selected.browserImageID)&&image(selected.proxyImageID)),'PUBLIC_BROWSER_PINNED_CONFIGURATION_REQUIRED');
 const brokerSocketPath=publicBrowserRuntimeSocketPath(profileDir,{uid,platform});
 return {enabled,mode,reviewerPublicKey,operatorPublicKey:authority,brokerSocketPath,pluginDirectory:path.join(profileDir,'agi-runtime','public-browser-plugin'),pluginSha256:publicBrowserPluginDigest(sourceDirectory),adapterVersion:PUBLIC_BROWSER_VERSION,browserImageID:selected.browserImageID??null,proxyImageID:selected.proxyImageID??null,qualificationEvidenceSha256:null};
}
export function installPublicBrowserPlugin(directory,{sourceDirectory=path.join(consumerCompute,'openclaw-public-browser')}={}){
 fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.chmodSync(directory,0o700);
 for(const file of PUBLIC_BROWSER_PLUGIN_FILES)fs.writeFileSync(path.join(directory,file),read(path.join(sourceDirectory,file)),{mode:0o600});
 return publicBrowserPluginDigest(directory);
}
export function applyPublicBrowserProfile(config,policy,{grantTool=false,grantRoles,explicitApproval=false,existing}={}){
 const next=structuredClone(config);next.plugins??={};if(existing?.plugins?.enabled===false)next.plugins.enabled=false;if(existing?.plugins?.deny)next.plugins.deny=structuredClone(existing.plugins.deny);next.plugins.load??={};next.plugins.load.paths=[...new Set([...(next.plugins.load.paths??[]),policy.pluginDirectory])];
 next.plugins.allow=[...new Set([...(next.plugins.allow??[]),'agi-public-browser'])];next.plugins.entries??={};next.plugins.entries['agi-public-browser']={enabled:explicitApproval||existing?.plugins?.entries?.['agi-public-browser']?.enabled!==false,config:{socketPath:policy.brokerSocketPath}};
 for(const [id,entry] of Object.entries(next.agents.entries)){
  if(id==='agi-checker')continue;
  entry.tools??={};entry.tools.deny=[...new Set([...(entry.tools.deny??[]),'browser','web_fetch','web_search'])];
  if(policy.enabled&&grantTool&&(!grantRoles||grantRoles.includes(id))){entry.tools.allow=[...new Set([...(entry.tools.allow??[]),'agi_public_browser'])];entry.tools.sandbox??={};entry.tools.sandbox.tools??={};entry.tools.sandbox.tools.allow=[...new Set([...(entry.tools.sandbox.tools.allow??entry.tools.allow),'agi_public_browser'])];if(explicitApproval)entry.tools.deny=entry.tools.deny.filter(t=>t!=='agi_public_browser');}
  if(!policy.enabled)entry.tools.deny=[...new Set([...entry.tools.deny,'agi_public_browser'])];
 }
 return next;
}
export function publicBrowserPolicyReady(c,{commissioning=false}={}){
 const p=c.publicWebPolicy;if(!p?.enabled)return false;
 need(p.adapterVersion===PUBLIC_BROWSER_VERSION&&image(p.browserImageID)&&image(p.proxyImageID)&&typeof p.operatorPublicKey==='string','COMPUTE_PUBLIC_WEB_CONFIGURATION');
 if(commissioning)need(['commissioning','qualified'].includes(p.mode),'COMPUTE_PUBLIC_WEB_NOT_QUALIFIED');else{need(p.mode==='qualified','COMPUTE_PUBLIC_WEB_NOT_QUALIFIED');readPublicWebQualification(c);}
 need(publicBrowserPluginDigest(p.pluginDirectory)===p.pluginSha256,'COMPUTE_PUBLIC_WEB_PLUGIN_CHANGED');
 const plugins=JSON.parse(read(c.gatewayConfig)).plugins;need(plugins&&plugins.enabled!==false&&Array.isArray(plugins.allow)&&plugins.allow.includes('agi-public-browser')&&!plugins.deny?.includes('agi-public-browser')&&plugins.load?.paths?.includes(p.pluginDirectory)&&plugins.entries?.['agi-public-browser']?.enabled===true&&plugins.entries['agi-public-browser'].config?.socketPath===p.brokerSocketPath,'COMPUTE_PUBLIC_WEB_PLUGIN_DISABLED');return true;
}
