// Synthetic filesystem/archive fixtures. These do not qualify a native artifact.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {canonical,digest} from '../contracts.mjs';
import {validateTarget,validateTargetSet,validateManifest,validateQualification,verifyTree,relativePath} from '../alpha/trust.mjs';
import {decodePinnedArchive,extractVerifiedArchive} from '../alpha/archive.mjs';
import {inspectAlphaPackage,requireAlphaRuntime,ALPHA_SOURCE_COMMIT} from '../alpha/package.mjs';
import {provisionAlpha} from '../alpha/provision.mjs';
const hash='a'.repeat(64);
function fixture(change=()=>{}){
  const contents=new Map([
    ['opt/alpha/python/bin/python3.12',Buffer.from('synthetic interpreter, never executed')],
    ['opt/alpha/launch-validate.py',Buffer.from('synthetic validator, never executed')],
    ['opt/alpha/launch-work.py',Buffer.from('synthetic work, never executed')],
    ['opt/alpha/a/file',Buffer.from('a')],['opt/alpha/a-b',Buffer.from('b')],
  ]);
  const entries=['opt','opt/alpha','opt/alpha/python','opt/alpha/python/bin','opt/alpha/a'].map(p=>({path:p,type:'directory',mode:0o555}));
  for(const [p,bytes] of contents)entries.push({path:p,type:'file',mode:0o444,bytes:bytes.length,sha256:digest(bytes)});
  entries.push({path:'opt/alpha/link',type:'symlink',mode:0o777,target:'a/file'});
  change(entries);
  const manifest={schema:'agi-fleet/alpha-candidate-artifact/v1',target:'linux-x64',sourceCommit:ALPHA_SOURCE_COMMIT,archiveSha256:hash,archiveBytes:1,treeSha256:digest(canonical(entries)),inputsSha256:hash,productionQualified:false,settlementAuthority:false,qualification:'NOT_RUN',entries};
  const raw=Buffer.from(canonical(manifest));
  const target={schema:'agi-fleet/alpha-reviewed-target/v1',target:manifest.target,sourceCommit:manifest.sourceCommit,archiveSha256:hash,archiveBytes:1,manifestSha256:digest(raw),manifestBytes:raw.length,treeSha256:manifest.treeSha256,inputsSha256:hash,adapterSha256:hash,qualificationSha256:hash};
  return {contents,entries,manifest,raw,target};
}
function header(name,{type='0',mode=0o444,size=0,link=''}={}){
  const h=Buffer.alloc(512);h.write(name,0,100);h.write(mode.toString(8).padStart(7,'0')+'\0',100,8);h.write(size.toString(8).padStart(11,'0')+'\0',124,12);h.fill(32,148,156);h.write(type,156,1);h.write(link,157,100);h.write('ustar\0',257,6);let sum=0;for(const b of h)sum+=b;h.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8);return h;
}
function archive(f,transform=x=>x){
  const parts=[header('rootfs/',{type:'5',mode:0o555})];
  for(const e of f.entries){const data=f.contents.get(e.path)||Buffer.alloc(0);parts.push(header('rootfs/'+e.path,{type:{file:'0',directory:'5',symlink:'2'}[e.type],mode:e.mode,size:e.type==='file'?data.length:0,link:e.target||''}));if(e.type==='file')parts.push(data,Buffer.alloc((512-data.length%512)%512));}
  parts.push(Buffer.alloc(1024));const raw=gzipSync(transform(Buffer.concat(parts))),target={...f.target,archiveSha256:digest(raw),archiveBytes:raw.length};return {raw,target};
}
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-alpha-trust-'));t.after(()=>{function writable(p){if(fs.lstatSync(p).isDirectory()){fs.chmodSync(p,0o700);for(const n of fs.readdirSync(p))writable(path.join(p,n));}}writable(dir);fs.rmSync(dir,{recursive:true,force:true});});return dir;}
const code=c=>e=>e.code===c||e.message===c;

test('null production pins refuse runtime and provisioner before opening caller paths',()=>{
  assert.equal(inspectAlphaPackage().code,'ALPHA_PACKAGE_UNPROVISIONED');
  assert.throws(()=>requireAlphaRuntime(),code('ALPHA_PACKAGE_UNPROVISIONED'));
  assert.throws(()=>provisionAlpha({archive:'/no/input',manifest:'/no/input',qualification:'/no/input',confirm:true}),code('ALPHA_PACKAGE_UNPROVISIONED'));
});
test('synthetic reviewed descriptor binds exact architecture, source and adapter',()=>{
  const {target}=fixture();assert.equal(validateTarget(target,'linux-x64',ALPHA_SOURCE_COMMIT,hash),target);
  const targets={'linux-x64':target,'linux-arm64':{...target,target:'linux-arm64',adapterSha256:'b'.repeat(64)}};
  assert.equal(validateTargetSet(targets,'linux-x64',ALPHA_SOURCE_COMMIT,hash),target);
  assert.throws(()=>validateTargetSet(targets,'linux-arm64',ALPHA_SOURCE_COMMIT,hash),code('ALPHA_ADAPTER_REQUALIFICATION_REQUIRED'));
  assert.throws(()=>validateTargetSet({...targets,'linux-arm64':null},'linux-x64',ALPHA_SOURCE_COMMIT,hash));
  for(const bad of [{...target,adapterSha256:'b'.repeat(64)},{...target,archiveBytes:128_000_001},{...target,target:'linux-arm64'},{...target,extra:true}])assert.throws(()=>validateTarget(bad,'linux-x64',ALPHA_SOURCE_COMMIT,hash));
});
test('manifest requires pinned raw bytes and independently bound tree digest',()=>{
  const f=fixture();assert.equal(validateManifest(f.raw,f.target).entries.size,f.entries.length);
  assert.throws(()=>validateManifest(Buffer.concat([f.raw,Buffer.from(' ')]),f.target),code('ALPHA_MANIFEST_CHANGED'));
  assert.throws(()=>validateManifest(f.raw,{...f.target,treeSha256:'b'.repeat(64)}),code('ALPHA_MANIFEST_BINDING_INVALID'));
});
test('pinned manifest ordering is not confused with flat JS path ordering',()=>{
  const f=fixture();const paths=f.entries.map(e=>e.path);assert.ok(paths.indexOf('opt/alpha/a/file')<paths.indexOf('opt/alpha/a-b'));assert.ok('opt/alpha/a/file'>'opt/alpha/a-b');validateManifest(f.raw,f.target);
});
test('manifest refuses duplicate paths, unlisted parents and privileged modes',()=>{
  for(const change of [e=>e.push({...e[0]}),e=>e.find(x=>x.path==='opt/alpha/a/file').path='missing/file',e=>e.find(x=>x.type==='file').mode=0o4755]){const f=fixture(change);assert.throws(()=>validateManifest(f.raw,f.target));}
});
test('manifest refuses escaping, dangling, cyclic and absolute symlinks',()=>{
  for(const target of ['../../../outside','missing','link','/etc/passwd']){const f=fixture(e=>e.find(x=>x.type==='symlink').target=target);assert.throws(()=>validateManifest(f.raw,f.target));}
  for(const bad of ['../x','/x','x/../y','x//y','x\\y','x\0y'])assert.throws(()=>relativePath(bad));
});
test('native qualification must be separately hash pinned and exact artifact/adapter bound',()=>{
  const f=fixture(),q={schema:'agi-fleet/alpha-reviewed-qualification/v1',status:'PASSED',target:f.target.target,archiveSha256:hash,treeSha256:f.target.treeSha256,inputsSha256:hash,adapterSha256:hash,artifactNative:true,adapterNative:true,candidateEvidenceSha256:hash,adapterEvidenceSha256:hash,fleetCommit:'a'.repeat(40),settlementAuthority:false},raw=Buffer.from(canonical(q)),target={...f.target,qualificationSha256:digest(raw)};
  validateQualification(raw,target);assert.throws(()=>validateQualification(raw,f.target),code('ALPHA_QUALIFICATION_CHANGED'));
  for(const patch of [{adapterNative:false},{settlementAuthority:true},{archiveSha256:'b'.repeat(64)}]){const b=Buffer.from(canonical({...q,...patch}));assert.throws(()=>validateQualification(b,{...target,qualificationSha256:digest(b)}));}
});
test('strict archive extracts only manifest nodes and verifies every byte/mode/link',t=>{
  const f=fixture(),v=validateManifest(f.raw,f.target),a=archive(f),dir=path.join(temporary(t),'rootfs');
  assert.equal(decodePinnedArchive(a.raw,a.target,v).length,f.entries.length);extractVerifiedArchive(a.raw,a.target,v,dir,{rootOwner:false});assert.equal(verifyTree(dir,v,{rootOwner:false}),true);
});
test('archive rejects changed compressed bytes before decompression',()=>{
  const f=fixture(),v=validateManifest(f.raw,f.target),a=archive(f);a.raw[a.raw.length-1]^=1;assert.throws(()=>decodePinnedArchive(a.raw,a.target,v),code('ALPHA_ARCHIVE_CHANGED'));
});
test('archive rejects checksums, special nodes, nonzero padding and trailing data',()=>{
  const f=fixture(),v=validateManifest(f.raw,f.target);
  for(const transform of [b=>{b[0]^=1;return b;},b=>Buffer.concat([header('rootfs/',{type:'3',mode:0o555}),b.subarray(512)]),b=>{const index=b.indexOf(Buffer.from('synthetic interpreter, never executed'));b[index+36]=1;return b;},b=>Buffer.concat([b,Buffer.from('x')])]){const a=archive(f,transform);assert.throws(()=>decodePinnedArchive(a.raw,a.target,v));}
});
test('tree detects changed file bytes, extra files, mode drift and hardlinks',t=>{
  for(const mutate of [dir=>{const p=path.join(dir,'opt/alpha/a/file');fs.chmodSync(p,0o644);fs.writeFileSync(p,'z');fs.chmodSync(p,0o444);},dir=>{fs.chmodSync(dir,0o755);fs.writeFileSync(path.join(dir,'extra'),'x');fs.chmodSync(dir,0o555);},dir=>fs.chmodSync(path.join(dir,'opt/alpha/a/file'),0o644),dir=>fs.linkSync(path.join(dir,'opt/alpha/a/file'),path.join(path.dirname(dir),'outside-hardlink'))]){
    const f=fixture(),v=validateManifest(f.raw,f.target),a=archive(f),dir=path.join(temporary(t),'rootfs');extractVerifiedArchive(a.raw,a.target,v,dir,{rootOwner:false});mutate(dir);assert.throws(()=>verifyTree(dir,v,{rootOwner:false}));
  }
});
test('tree rejects link replacement and non-root ownership in production verification',t=>{
  const f=fixture(),v=validateManifest(f.raw,f.target),a=archive(f),dir=path.join(temporary(t),'rootfs');extractVerifiedArchive(a.raw,a.target,v,dir,{rootOwner:false});
  if(process.getuid()!==0)assert.throws(()=>verifyTree(dir,v),code('ALPHA_INSTALLATION_UNTRUSTED'));
  fs.chmodSync(path.join(dir,'opt/alpha'),0o755);fs.unlinkSync(path.join(dir,'opt/alpha/link'));fs.symlinkSync('/etc/passwd',path.join(dir,'opt/alpha/link'));fs.chmodSync(path.join(dir,'opt/alpha'),0o555);assert.throws(()=>verifyTree(dir,v,{rootOwner:false}),code('ALPHA_PACKAGE_LINK_CHANGED'));
});
