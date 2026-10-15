// Pure identity/manifest checks shared by the fixed-location installer and runtime.
// A caller-provided manifest is never authority: callers need a Fleet-shipped pin.
import fs from 'node:fs';
import path from 'node:path';
import {need,keys,parseStrict,digest,canonical} from '../contracts.mjs';

const HASH=/^[a-f0-9]{64}$/, COMMIT=/^[a-f0-9]{40}$/;
export const ALPHA_INSTALL_BASE='/opt/agi-fleet-alpha';
export const ALPHA_ARCHIVE_LIMIT=128_000_000;
export const ALPHA_TREE_LIMIT=350_000_000;
export const ALPHA_MANIFEST_LIMIT=4_000_000;
export function relativePath(value){
  need(typeof value==='string'&&value.length>0&&value.length<=512&&!/[\\\x00-\x1f\x7f]/.test(value)&&!path.posix.isAbsolute(value)&&value.split('/').every(p=>p&&p!=='.'&&p!=='..'),'ALPHA_PACKAGE_PATH_INVALID');return value;
}
export function validateTarget(target,architecture,sourceCommit,adapterSha256){
  keys(target,['schema','target','sourceCommit','archiveSha256','archiveBytes','manifestSha256','manifestBytes','treeSha256','inputsSha256','adapterSha256','qualificationSha256']);
  need(target.schema==='agi-fleet/alpha-reviewed-target/v1'&&target.target===architecture&&['linux-x64','linux-arm64'].includes(architecture)&&target.sourceCommit===sourceCommit&&COMMIT.test(sourceCommit),'ALPHA_TRUST_TARGET_INVALID');
  for(const key of ['archiveSha256','manifestSha256','treeSha256','inputsSha256','adapterSha256','qualificationSha256'])need(HASH.test(target[key]),'ALPHA_TRUST_TARGET_INVALID');
  need(Number.isSafeInteger(target.archiveBytes)&&target.archiveBytes>0&&target.archiveBytes<=ALPHA_ARCHIVE_LIMIT&&Number.isSafeInteger(target.manifestBytes)&&target.manifestBytes>0&&target.manifestBytes<=ALPHA_MANIFEST_LIMIT,'ALPHA_TRUST_TARGET_INVALID');
  need(target.adapterSha256===adapterSha256,'ALPHA_ADAPTER_REQUALIFICATION_REQUIRED');return target;
}
export function validateTargetSet(targets,architecture,sourceCommit,adapterSha256){
  keys(targets,['linux-x64','linux-arm64']);need(['linux-x64','linux-arm64'].includes(architecture),'ALPHA_PLATFORM_UNSUPPORTED');
  // Both reviewed descriptors are mandatory. Installed Fleet dependency bytes
  // may differ by architecture, so only this host's closure can be measured here.
  for(const name of ['linux-x64','linux-arm64'])validateTarget(targets[name],name,sourceCommit,name===architecture?adapterSha256:targets[name]?.adapterSha256);
  return targets[architecture];
}
export function validateManifest(raw,target){
  need(Buffer.isBuffer(raw)&&raw.length===target.manifestBytes&&digest(raw)===target.manifestSha256,'ALPHA_MANIFEST_CHANGED');
  const manifest=parseStrict(raw.toString('utf8'),ALPHA_MANIFEST_LIMIT);
  need(manifest.schema==='agi-fleet/alpha-candidate-artifact/v1'&&manifest.target===target.target&&manifest.sourceCommit===target.sourceCommit&&manifest.archiveSha256===target.archiveSha256&&manifest.archiveBytes===target.archiveBytes&&manifest.treeSha256===target.treeSha256&&manifest.inputsSha256===target.inputsSha256,'ALPHA_MANIFEST_BINDING_INVALID');
  need(manifest.productionQualified===false&&manifest.settlementAuthority===false&&manifest.qualification==='NOT_RUN','ALPHA_MANIFEST_AUTHORITY_INVALID');
  // Historical build metadata remains unqualified. Separate, hash-pinned native
  // evidence proves the exact artifact/adapter; never rewrite build observations.
  need(Array.isArray(manifest.entries)&&manifest.entries.length>0&&manifest.entries.length<=20_000&&digest(canonical(manifest.entries))===target.treeSha256,'ALPHA_TREE_MANIFEST_INVALID');
  const entries=new Map();let bytes=0;
  for(const entry of manifest.entries){
    // The pinned digest binds ordering. Python Path ordering is component-wise,
    // so do not confuse it with JavaScript's flat string ordering.
    relativePath(entry.path);need(!entries.has(entry.path),'ALPHA_TREE_MANIFEST_INVALID');
    if(entry.type==='file'){
      keys(entry,['path','mode','type','bytes','sha256']);need([0o444,0o555].includes(entry.mode)&&Number.isSafeInteger(entry.bytes)&&entry.bytes>=0&&entry.bytes<=ALPHA_TREE_LIMIT&&HASH.test(entry.sha256),'ALPHA_TREE_MANIFEST_INVALID');bytes+=entry.bytes;
    }else if(entry.type==='directory'){
      keys(entry,['path','mode','type']);need(entry.mode===0o555,'ALPHA_TREE_MANIFEST_INVALID');
    }else if(entry.type==='symlink'){
      keys(entry,['path','mode','type','target']);need(entry.mode===0o777&&typeof entry.target==='string'&&!path.posix.isAbsolute(entry.target)&&!/[\\\x00-\x1f\x7f]/.test(entry.target),'ALPHA_TREE_MANIFEST_INVALID');
    }else need(false,'ALPHA_TREE_MANIFEST_INVALID');
    entries.set(entry.path,entry);
  }
  need(bytes<=ALPHA_TREE_LIMIT,'ALPHA_TREE_TOO_LARGE');
  for(const entry of entries.values()){
    const parent=path.posix.dirname(entry.path);need(parent==='.'||entries.get(parent)?.type==='directory','ALPHA_TREE_PARENT_INVALID');
    if(entry.type==='symlink')resolveEntry(entry.path,entries);
  }
  for(const required of ['opt/alpha/python/bin/python3.12','opt/alpha/launch-validate.py','opt/alpha/launch-work.py'])need(entries.get(required)?.type==='file','ALPHA_ENTRYPOINT_MISSING');
  return {manifest,entries};
}
function resolveEntry(name,entries,seen=new Set()){
  need(!seen.has(name),'ALPHA_PACKAGE_LINK_INVALID');seen.add(name);
  const entry=entries.get(name);need(entry,'ALPHA_PACKAGE_LINK_INVALID');
  if(entry.type!=='symlink')return name;
  const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(name),entry.target));relativePath(resolved);
  const parts=resolved.split('/');let current='';
  for(let i=0;i<parts.length;i++){
    current=current?current+'/'+parts[i]:parts[i];
    if(entries.get(current)?.type==='symlink'){
      const base=resolveEntry(current,entries,new Set(seen));
      return resolveEntry([base,...parts.slice(i+1)].join('/'),entries,new Set(seen));
    }
  }
  return resolveEntry(resolved,entries,seen);
}
export function validateQualification(raw,target){
  need(Buffer.isBuffer(raw)&&raw.length<=1_000_000&&digest(raw)===target.qualificationSha256,'ALPHA_QUALIFICATION_CHANGED');
  const value=parseStrict(raw.toString('utf8'),1_000_000);
  keys(value,['schema','status','target','archiveSha256','treeSha256','inputsSha256','adapterSha256','artifactNative','adapterNative','candidateEvidenceSha256','adapterEvidenceSha256','fleetCommit','settlementAuthority']);
  need(value.schema==='agi-fleet/alpha-reviewed-qualification/v1'&&value.status==='PASSED'&&value.artifactNative===true&&value.adapterNative===true&&value.settlementAuthority===false,'ALPHA_QUALIFICATION_INVALID');
  for(const key of ['target','archiveSha256','treeSha256','inputsSha256','adapterSha256'])need(value[key]===target[key],'ALPHA_QUALIFICATION_BINDING_INVALID');
  need(HASH.test(value.candidateEvidenceSha256)&&HASH.test(value.adapterEvidenceSha256)&&COMMIT.test(value.fleetCommit),'ALPHA_QUALIFICATION_INVALID');return value;
}
export function assertRootOwned(file,{directory=false,mode=null}={}){
  const stat=fs.lstatSync(file);need(!stat.isSymbolicLink()&&(directory?stat.isDirectory():stat.isFile())&&stat.uid===0&&(stat.mode&0o022)===0&&(mode===null||(stat.mode&0o7777)===mode),'ALPHA_INSTALLATION_UNTRUSTED');return stat;
}
export function assertTrustedParents(file){
  let current=path.resolve(file);
  while(true){assertRootOwned(current,{directory:true});const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
export function verifyTree(root,validated,{rootOwner=true}={}){
  // rootOwner=false is only for pure filesystem regression fixtures. The fixed
  // runtime/provisioner always use the default and never accept task options.
  const rootStat=fs.lstatSync(root);need(rootStat.isDirectory()&&!rootStat.isSymbolicLink()&&(rootStat.mode&0o7777)===0o555&&(!rootOwner||rootStat.uid===0),'ALPHA_INSTALLATION_UNTRUSTED');
  let count=0;
  function walk(relative){
    const absolute=relative?path.join(root,relative):root;
    for(const name of fs.readdirSync(absolute).sort()){
      const rel=relative?relative+'/'+name:name,expected=validated.entries.get(rel),actual=fs.lstatSync(path.join(root,rel));count++;
      need(expected&&(actual.mode&0o7777)===expected.mode&&(!rootOwner||actual.uid===0),'ALPHA_PACKAGE_TREE_CHANGED');
      if(expected.type==='directory'){need(actual.isDirectory()&&!actual.isSymbolicLink(),'ALPHA_PACKAGE_TREE_CHANGED');walk(rel);}
      else if(expected.type==='symlink'){
        need(actual.isSymbolicLink()&&fs.readlinkSync(path.join(root,rel))===expected.target,'ALPHA_PACKAGE_LINK_CHANGED');
        const target=fs.realpathSync(path.join(root,rel));need(target.startsWith(root+path.sep),'ALPHA_PACKAGE_LINK_INVALID');
      }else{
        need(actual.isFile()&&!actual.isSymbolicLink()&&actual.nlink===1&&actual.size===expected.bytes,'ALPHA_PACKAGE_FILE_CHANGED');
        const fd=fs.openSync(path.join(root,rel),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
        try{const opened=fs.fstatSync(fd);need(opened.dev===actual.dev&&opened.ino===actual.ino&&digest(fs.readFileSync(fd))===expected.sha256,'ALPHA_PACKAGE_FILE_CHANGED');}finally{fs.closeSync(fd);}
      }
    }
  }
  walk('');need(count===validated.entries.size,'ALPHA_PACKAGE_TREE_CHANGED');return true;
}
