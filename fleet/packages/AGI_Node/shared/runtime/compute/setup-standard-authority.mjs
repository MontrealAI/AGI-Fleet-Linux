import {roleContract,COMPUTE_ROLES} from './roles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {canonical,sha256} from '../src/util.mjs';
import {sqliteStandardAuthority} from './setup-runtime-sqlite.mjs';
import {validateManagedGatewayAuthority} from './setup-managed-service.mjs';
import {validatePinnedControlUICache} from './setup-runtime-materialization.mjs';
import {verifyRuntimeArtifact} from './runtime-artifacts.mjs';
import {runtimeOwnerChecker,inspectExecutable} from './runtime-env.mjs';

const need=(ok,code='SETUP_PROFILE_CHANGED')=>{if(!ok)throw Error(code);};
const owned=(file,optional=false)=>{
 const s=fs.lstatSync(file,{throwIfNoEntry:!optional});if(!s)return null;
 need(!s.isSymbolicLink()&&(!process.getuid||s.uid===process.getuid())&&!(s.mode&0o022)&&(s.isDirectory()||s.isFile())&&(s.isDirectory()||s.nlink===1),'SETUP_STATE_OWNER_REQUIRED');return s;
};
function fileBytes(file){
 const before=owned(file);need(before.isFile()&&before.size<=16*1024*1024);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const a=fs.fstatSync(fd),bytes=fs.readFileSync(fd),b=fs.fstatSync(fd),after=owned(file);need(['dev','ino','uid','mode','size','mtimeMs','ctimeMs'].every(k=>a[k]===before[k]&&a[k]===b[k]&&a[k]===after[k]));return bytes;}finally{fs.closeSync(fd);}
}
/** Validate runtime object safety without hashing membership or cache contents.
 * A disappearing runtime entry is allowed; a redirected/writable object is not.
 * Generated plugin-skills is a pinned runtime rebuild tree, never followed.
 * All executable/plugin authority is bound separately below. */
function runtimeObjects(root){
 let count=0;
 const walk=(dir,relative='')=>{
  for(const name of fs.readdirSync(dir)){
   need(++count<=100000,'SETUP_STATE_FILE_UNSUPPORTED');
   const rel=relative?relative+'/'+name:name,file=path.join(dir,name);let s;
   try{s=owned(file,true);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(!s)continue;
   if(rel==='plugin-skills'){need(s.isDirectory(),'SETUP_GENERATED_RUNTIME_DIRECTORY_REQUIRED');continue;}
   if(s.isFile()&&(['service.log','service-error.log'].includes(rel)||/agents\/agi-(creator|checker|reviewer|moderator|employer|evidence|recovery)\/sessions\//.test(rel)))need(!(s.mode&0o111),'SETUP_STATE_FILE_UNSUPPORTED');
   if(s.isDirectory()){try{walk(file,rel);}catch(error){if(error.code!=='ENOENT')throw error;}}
  }
 };walk(root);
}
/** Fallback and root model caches can be interpreted as configuration inputs.
 * Cache presence/metadata is mutable; their effective authority is not. */
export function assertStandardDerivedAuthority(root){
 const file=path.join(root,'openclaw.json'),config=JSON.parse(fileBytes(file));
 const project=value=>{const copy=structuredClone(value);if(copy.meta){for(const key of ['lastTouchedAt','lastTouchedVersion']){if(copy.meta[key]!==undefined){need(typeof copy.meta[key]==='string'&&copy.meta[key].length<=128);delete copy.meta[key];}}if(!Object.keys(copy.meta).length)delete copy.meta;}return copy;};
 const cached=path.join(root,'openclaw.json.last-good');
 if(owned(cached,true))need(canonical(project(JSON.parse(fileBytes(cached))))===canonical(project(config)));
 for(const agent of Object.keys(config.agents?.entries??{})){
  const models=path.join(root,'agents',agent,'agent/models.json');if(!owned(models,true))continue;
  const value=JSON.parse(fileBytes(models));need(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>k==='providers')&&value.providers&&typeof value.providers==='object'&&!Array.isArray(value.providers)&&Object.keys(value.providers).length===0);
 }
 return true;
}
export function captureStandardOAuthAuthority(root,settings){
 const agents=roleContract(settings.role).oauth.slice().sort();
 const databases=['state/openclaw.sqlite',...agents.map(agent=>`agents/${agent}/agent/openclaw-agent.sqlite`)];
 const auth=Object.fromEntries(databases.map(relative=>[relative,sqliteStandardAuthority(path.join(root,relative),{root,profileDir:settings.profileDir,relative,requiredOpenAIOrder:relative!=='state/openclaw.sqlite'})]));
 return {schema:'agi-standard-oauth-authority/v1',auth};
}
export function assertStandardOAuthAuthority(c){
 need(c.standardOAuthAuthority?.schema==='agi-standard-oauth-authority/v1','COMPUTE_POLICY_CHANGED');
 need(canonical(c.standardOAuthAuthority)===canonical(captureStandardOAuthAuthority(c.profileDir,c)),'COMPUTE_POLICY_CHANGED');return true;
}
/** Security is defined by inputs actually consumed as execution authority,
 * not by an exhaustive profile inventory. Runtime state cannot expand the
 * approved config, plugin sources, models, sandbox, images, signer or limits. */
export function captureStandardAuthority(root,{phase='sealed',authStaging=[]}={}){
 need(['reviewed','sealed'].includes(phase));need(owned(root).isDirectory()&&!(owned(root).mode&0o077)&&fs.realpathSync(root)===root,'SETUP_STATE_OWNER_REQUIRED');
 runtimeObjects(root);assertStandardDerivedAuthority(root);
 const directories=[],entries=[],config=JSON.parse(fileBytes(path.join(root,'openclaw.json'))),settings=JSON.parse(fileBytes(path.join(root,'compute-settings.json')));
 const add=(relative,optional=false)=>{
  const file=path.join(root,relative),s=owned(file,optional);if(!s)return;
  if(s.isDirectory()){const members=fs.readdirSync(file).sort();directories.push({file,members});entries.push([relative,'directory']);for(const name of members)add(relative+'/'+name);}
  else {let bytes=fileBytes(file);if(relative==='compute-settings.json'&&phase==='reviewed'){const value=JSON.parse(bytes);delete value.policyHash;bytes=canonical(value);}entries.push([relative,'file',Boolean(s.mode&0o111),sha256(bytes)]);}
 };
 for(const name of ['openclaw.json','compute-settings.json','agi-compute-profile.json','workspace/AGENTS.md','workspace/skills','agi-runtime','agi-openclaw-gateway-wrapper'])add(name,!['openclaw.json','compute-settings.json'].includes(name));
 // Managed launch inputs are independently derived from the approved pinned
 // installer. Their post-install bytes are sealed; no arbitrary env is allowed.
 if(phase==='sealed'&&settings.managedGatewayServiceAuthority){validateManagedGatewayAuthority(settings,root);add('service-env');}
 if(fs.existsSync(path.join(root,'cache/control-ui-assets'))){
  const artifact=verifyRuntimeArtifact(settings.openclaw,{allowedOwner:runtimeOwnerChecker()});
  need(artifact.version==='2026.9.5','COMPUTE_POLICY_CHANGED');
  const expected=settings.executableIdentity?.openclaw,actual=inspectExecutable(settings.openclaw,'openclaw',{home:settings.home});
  need(expected&&['path','realPath','uid','gid','mode','size','sha256'].every(key=>expected[key]===actual[key])&&artifact.packageRoot===path.dirname(expected.realPath),'COMPUTE_RUNTIME_EXECUTABLE_CHANGED');
  try{validatePinnedControlUICache(root,artifact.packageRoot);}catch(error){
   if(['SETUP_RUNTIME_MATERIALIZATION_INVALID','SETUP_STATE_OWNER_REQUIRED'].includes(error.message))throw error;
   throw Error('SETUP_RUNTIME_MATERIALIZATION_INVALID',{cause:error});
  }
 }
 const agents=Object.keys(config.agents?.entries??{}).sort();
 need(canonical(agents)===canonical(roleContract(settings.role).oauth.slice().sort()),'SETUP_AUTH_STAGING_REVIEW_INVALID');
 need(authStaging.length===agents.length&&authStaging.every(r=>agents.includes(r.agent)),'SETUP_AUTH_STAGING_REVIEW_INVALID');
 const databases=['state/openclaw.sqlite',...agents.map(agent=>`agents/${agent}/agent/openclaw-agent.sqlite`)];
 const auth=Object.fromEntries(databases.map(relative=>[relative,sqliteStandardAuthority(path.join(root,relative),{root,profileDir:settings.profileDir,relative,requiredOpenAIOrder:relative!=='state/openclaw.sqlite'})]));
 // Recheck the authority projections, not SQLite data_version. Token rotation,
 // history writes and telemetry may proceed without changing these projections.
 for(const relative of databases)need(auth[relative]===sqliteStandardAuthority(path.join(root,relative),{root,profileDir:settings.profileDir,relative,requiredOpenAIOrder:relative!=='state/openclaw.sqlite'}));
 for(const entry of entries.filter(e=>e[1]==='file')){let bytes=fileBytes(path.join(root,entry[0]));if(entry[0]==='compute-settings.json'&&phase==='reviewed'){const value=JSON.parse(bytes);delete value.policyHash;bytes=canonical(value);}need(sha256(bytes)===entry[3]);}
 for(const {file,members} of directories)need(canonical(fs.readdirSync(file).sort())===canonical(members));
 const record={schema:'agi-standard-authority/v1',phase,entries:entries.sort((a,b)=>a[0].localeCompare(b[0])),auth};
 return {...record,digest:sha256(canonical(record))};
}
export function assertStandardAuthority(root,record,options={}){
 need(record?.schema==='agi-standard-authority/v1'&&record.digest===sha256(canonical(Object.fromEntries(Object.entries(record).filter(([key])=>key!=='digest')))));
 const current=captureStandardAuthority(root,{...options,phase:record.phase});need(current.digest===record.digest);return current;
}
