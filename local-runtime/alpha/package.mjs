import fs from 'node:fs';
import path from 'node:path';
import {ROOT,need,keys,parseStrict,digest} from '../contracts.mjs';
import {ALPHA_INSTALL_BASE,validateTargetSet,validateManifest,validateQualification,verifyTree,assertRootOwned,assertTrustedParents} from './trust.mjs';

export const ALPHA_SOURCE_COMMIT='2355b3cb198a6fb2c948744d283f108ab6ce5ebc';
export const ALPHA_VALIDATOR='alpha_factory_v1.core.runtime.work_spec';
export const ALPHA_ENTRYPOINT='alpha_factory_v1.core.runtime.fleet_work';
export const ALPHA_MARKET='agijobsv0-jobregistry-v2';
export const ALPHA_PACKAGE_HELP='Alpha execution is not provisioned. A reviewed per-architecture interpreter/source/dependency package and exact-byte native bubblewrap qualification are required. Provision only the Fleet-pinned artifact at /opt/agi-fleet-alpha; never use host Python, task-selected paths or a shell fallback.';
const REQUIRED_SOURCE={repository:'https://github.com/MontrealAI/AGI-Alpha-Agent-v0',commit:ALPHA_SOURCE_COMMIT,requirementsSha256:'807e9de36cff92e1cecd7a6f1d651760f66ea4f8346dd799a139269f48c75790',entrypoint:ALPHA_ENTRYPOINT,validator:ALPHA_VALIDATOR};
// Bind the complete existing supervisor/worker dependency trees, not merely
// direct imports. The trust lock itself is excluded to avoid a circular pin;
// runtimeIdentity separately binds its exact bytes. Qualification harnesses and
// test fixtures cannot change production authority and are excluded explicitly.
const ADAPTER_ROOTS=['local-runtime','role-skills','fleet/shared','fleet/successor','fleet/node_modules','fleet/packages/AGI_Agent/src/admission-core','fleet/packages/AGI_Node/src'];
const EXCLUDED=['local-runtime/tests','local-runtime/alpha/candidate','local-runtime/alpha/native-qualification'];
export function alphaAdapterIdentity(){
  const entries=[];
  function walk(relative){
    if(relative==='local-runtime/alpha/package-lock.json'||EXCLUDED.some(x=>relative===x||relative.startsWith(x+'/')))return;
    const file=path.join(ROOT,relative),stat=fs.lstatSync(file);
    if(stat.isSymbolicLink()){
      const target=fs.realpathSync(file);need(relative.startsWith('fleet/node_modules/')&&target.startsWith(path.join(ROOT,'fleet/node_modules/')),'ALPHA_ADAPTER_SOURCE_INVALID');
      entries.push([relative,'symlink',fs.readlinkSync(file)]);
    }else if(stat.isDirectory())for(const name of fs.readdirSync(file).sort())walk(relative+'/'+name);
    else{need(stat.isFile()&&stat.size<=8_000_000,'ALPHA_ADAPTER_SOURCE_INVALID');entries.push([relative,stat.mode&0o7777,digest(fs.readFileSync(file))]);}
  }
  for(const relative of ADAPTER_ROOTS)walk(relative);
  entries.push(['fleet/package-lock.json',digest(fs.readFileSync(path.join(ROOT,'fleet/package-lock.json')))]);
  return digest(entries);
}

// Pins come exclusively from this shipped lock. There is no caller/environment
// path, executable, manifest or qualification override in the runtime API.
export function readReviewedAlphaTarget(){
  const raw=fs.readFileSync(new URL('./package-lock.json',import.meta.url),'utf8'),lock=parseStrict(raw,32768);
  keys(lock,['schema','state','source','dependencySubsetSha256','targets','qualification','settlementAuthority']);
  keys(lock.source,Object.keys(REQUIRED_SOURCE));keys(lock.targets,['linux-x64','linux-arm64']);
  need(lock.schema==='agi-fleet/alpha-package-lock/v1'&&lock.settlementAuthority===false&&Object.entries(REQUIRED_SOURCE).every(([k,v])=>lock.source[k]===v),'ALPHA_TRUST_LOCK_INVALID');
  need(digest(fs.readFileSync(new URL('./requirements-fleet.lock',import.meta.url)))===lock.dependencySubsetSha256,'ALPHA_DEPENDENCY_LOCK_CHANGED');
  if(lock.state==='UNPROVISIONED'){
    need(lock.qualification==='NOT_RUN'&&Object.values(lock.targets).every(v=>v===null),'ALPHA_PACKAGE_REVIEW_REQUIRED');
    throw Object.assign(new Error('ALPHA_PACKAGE_UNPROVISIONED'),{code:'ALPHA_PACKAGE_UNPROVISIONED',trustLockSha256:digest(raw)});
  }
  need(lock.state==='REVIEWED_NATIVE'&&lock.qualification==='EXACT_ARTIFACT_AND_ADAPTER_NATIVE','ALPHA_PACKAGE_REVIEW_REQUIRED');
  need(process.platform==='linux'&&['x64','arm64'].includes(process.arch),'ALPHA_PLATFORM_UNSUPPORTED');
  const adapterSha256=alphaAdapterIdentity();
  // A partial architecture qualification cannot silently enable the other one.
  const target=validateTargetSet(lock.targets,'linux-'+process.arch,ALPHA_SOURCE_COMMIT,adapterSha256);
  return {target,adapterSha256,trustLockSha256:digest(raw),directory:path.join(ALPHA_INSTALL_BASE,target.target,target.archiveSha256)};
}
export function requireAlphaRuntime(){
  const trusted=readReviewedAlphaTarget();assertTrustedParents(trusted.directory);
  need(JSON.stringify(fs.readdirSync(trusted.directory).sort())===JSON.stringify(['manifest.json','qualification.json','rootfs']),'ALPHA_INSTALLATION_CONTENTS_CHANGED');
  const manifestFile=path.join(trusted.directory,'manifest.json'),qualificationFile=path.join(trusted.directory,'qualification.json');
  assertRootOwned(manifestFile,{mode:0o444});assertRootOwned(qualificationFile,{mode:0o444});
  const validated=validateManifest(fs.readFileSync(manifestFile),trusted.target);
  validateQualification(fs.readFileSync(qualificationFile),trusted.target);
  const rootfs=path.join(trusted.directory,'rootfs');verifyTree(rootfs,validated);
  const runtimeIdentity=digest({target:trusted.target,trustLockSha256:trusted.trustLockSha256,adapterSha256:trusted.adapterSha256});
  return {...trusted,rootfs,runtimeIdentity,packageSha256:trusted.target.archiveSha256,manifestSha256:trusted.target.manifestSha256,treeSha256:trusted.target.treeSha256};
}
export function inspectAlphaPackage(){
  try{
    const runtime=requireAlphaRuntime();
    return {supported:true,sourceCommit:ALPHA_SOURCE_COMMIT,trustLockSha256:runtime.trustLockSha256,packageSha256:runtime.packageSha256,runtimeIdentity:runtime.runtimeIdentity,manifestSha256:runtime.manifestSha256,treeSha256:runtime.treeSha256,adapterSha256:runtime.adapterSha256,qualification:'EXACT_ARTIFACT_AND_ADAPTER_NATIVE',settlementAuthority:false};
  }catch(e){
    return {supported:false,code:e.code==='ENOENT'?'ALPHA_PACKAGE_MISSING':/^ALPHA_/.test(e.code||e.message)?e.code||e.message:'ALPHA_TRUST_LOCK_INVALID',sourceCommit:ALPHA_SOURCE_COMMIT,trustLockSha256:e.trustLockSha256??null,packageSha256:null,runtimeIdentity:null,qualification:'NOT_RUN',help:ALPHA_PACKAGE_HELP};
  }
}
export function refuseUnprovisionedAlpha(){
  const state=inspectAlphaPackage();
  // Generic Node worker execution is never an Alpha fallback, even if installed.
  const code=state.supported?'ALPHA_NATIVE_DISPATCH_REQUIRED':state.code;
  throw Object.assign(new Error(code),{code,observation:{backend:'linux-bwrap-alpha/v1',launchAttempted:false,processGroupGone:true,network:'none',providerCalls:0,qualification:'NOT_RUN'}});
}
