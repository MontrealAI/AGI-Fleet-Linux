import {roleContract,COMPUTE_ROLES,OPERATOR_ROLES,setupRole} from './roles.mjs';
import {consumerRoot,consumerCompute,consumerFile} from './consumer.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT=consumerCompute;
const need=(value,code)=>{if(!value)throw Error(code);};
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// LaunchAgent plists are public-readable on macOS. Bearer tokens and OAuth
// belong only in the private settings/auth files referenced by this service.
export function servicePlist(c,environment={}){
 const profile=roleContract(c.role).profile;
 const allowed={HOME:c.home,LANG:'en_US.UTF-8',NODE_DISABLE_COMPILE_CACHE:'1',OPENCLAW_EXEC_SHELL_SNAPSHOT:'0',OPENCLAW_PROFILE:profile,OPENCLAW_STATE_DIR:c.profileDir,OPENCLAW_CONFIG_PATH:c.gatewayConfig,OPENCLAW_GATEWAY_PORT:String(c.gatewayPort)};
 need(environment&&typeof environment==='object'&&!Array.isArray(environment),'COMPUTE_SERVICE_ENVIRONMENT_INVALID');
 for(const [key,value]of Object.entries(environment)){
  need(typeof value==='string'&&!/[\x00-\x1f\x7f]/.test(value),'COMPUTE_SERVICE_ENVIRONMENT_INVALID');
  if(key==='PATH')need(value.split(':').every(part=>part&&path.isAbsolute(part)),'COMPUTE_SERVICE_ENVIRONMENT_INVALID');
  else need(Object.hasOwn(allowed,key)&&value===allowed[key],'COMPUTE_SERVICE_PUBLIC_SECRET_FORBIDDEN');
  need(value!==c.token&&value!==c.gatewayToken,'COMPUTE_SERVICE_PUBLIC_SECRET_FORBIDDEN');
 }
 const args=[c.node,path.join(ROOT,'server.mjs'),path.join(c.profileDir,'compute-settings.json')];
 return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>ai.montreal.${profile}</string><key>ProgramArguments</key><array>${args.map(x=>'<string>'+xml(x)+'</string>').join('')}</array><key>EnvironmentVariables</key><dict>${Object.entries(environment).map(([key,value])=>'<key>'+xml(key)+'</key><string>'+xml(value)+'</string>').join('')}</dict><key>WorkingDirectory</key><string>${xml(c.profileDir)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer><key>StandardOutPath</key><string>${xml(path.join(c.profileDir,'service.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(c.profileDir,'service-error.log'))}</string></dict></plist>`;
}
export function writeComputeLaunchAgent(c,environment,{uid=process.getuid?.()}={}){
 const contents=servicePlist(c,environment);need(Number.isSafeInteger(uid)&&path.isAbsolute(c.home)&&COMPUTE_ROLES.includes(c.role),'COMPUTE_SERVICE_PATH_INVALID');
 const profile=roleContract(c.role).profile;need(c.profileDir===path.join(c.home,'.openclaw-'+profile),'COMPUTE_SERVICE_PATH_INVALID');
 const directory=path.join(c.home,'Library/LaunchAgents'),file=path.join(directory,'ai.montreal.'+profile+'.plist');
 const present=target=>{try{fs.lstatSync(target);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 const safe=(target,directory)=>{const s=fs.lstatSync(target);need(!s.isSymbolicLink()&&s.uid===uid&&!(s.mode&0o022)&&(directory?s.isDirectory():s.isFile()&&s.nlink===1),'COMPUTE_SERVICE_PATH_UNSAFE');};
 safe(c.home,true);
 for(const target of [path.join(c.home,'Library'),directory]){if(!present(target))fs.mkdirSync(target,{mode:target===directory?0o755:0o700});safe(target,true);}
 if(present(file))safe(file,false);
 fs.chmodSync(directory,0o755);
 const temporary=file+'.'+crypto.randomUUID()+'.tmp';let fd;
 try{
  fd=fs.openSync(temporary,'wx',0o644);fs.fchmodSync(fd,0o644);fs.writeFileSync(fd,contents);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  // Recheck the public destination immediately before atomic publication.
  safe(directory,true);if(present(file))safe(file,false);fs.renameSync(temporary,file);
  const parent=fs.openSync(directory,'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  return file;
 }finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true});}
}
