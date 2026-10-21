// SPDX-License-Identifier: MIT
// Disposable public source fixtures; only benign exported values/global identity flags execute.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createVerifiedModuleLoader,verifyModuleClosure} from './verify-source.mjs';

const scopes=[['source',true]],sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(files={'source/entry.mjs':"export {value} from './companion.mjs';\n",'source/companion.mjs':'export const value=1;\n'}){
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'fleet-reviewed-esm-'));
  const write=(name,source)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);};
  const git=(...args)=>execFileSync('/usr/bin/git',['--no-replace-objects','-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}).trim();
  git('init','-q');for(const [name,source]of Object.entries(files))write(name,source);git('add','.');git('-c','user.name=Public fixture','-c','user.email=fixture@example.invalid','commit','-qm','Benign immutable source fixture');
  return {root,write,git,commit:git('rev-parse','HEAD'),close:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('NUL tree paths and captured source digest preserve exact UTF8 bytes',async()=>{
  const name='source/line\nbreak é.mjs',source='export const value="public fixture";\n',f=fixture({[name]:source});let loader;
  try{
    assert.deepEqual(verifyModuleClosure(f.root,f.commit,scopes),[name]);
    loader=createVerifiedModuleLoader(f.root,f.commit,scopes);assert(Object.isFrozen(loader));
    assert.equal(loader.sourceSha256(name),sha(Buffer.from(source)));assert.equal((await loader.importModule(name)).value,'public fixture');
  }finally{loader?.dispose();f.close();}
});

for(const edge of ['entry','companion'])test('captured '+edge+' bytes execute when installed source changes and is then restored',async()=>{
  const flag='fleetReviewed_'+randomUUID(),entry="import {value} from './companion.mjs';globalThis["+JSON.stringify(flag)+"]=value;export {value};\n";
  const originals={'source/entry.mjs':entry,'source/companion.mjs':'export const value=1;\n'},f=fixture(originals);let loader;
  try{
    loader=createVerifiedModuleLoader(f.root,f.commit,scopes);
    f.write('source/'+edge+'.mjs',edge==='entry'?'globalThis['+JSON.stringify(flag)+']=2;export const value=2;\n':'export const value=2;\n');
    const loaded=await loader.importModule('source/entry.mjs');
    for(const [name,source]of Object.entries(originals))f.write(name,source);
    assert.deepEqual(verifyModuleClosure(f.root,f.commit,scopes),Object.keys(originals).sort());
    assert.equal(loaded.value,1);assert.equal(globalThis[flag],1);assert.equal(loader.sourceSha256('source/entry.mjs'),sha(Buffer.from(entry)));
  }finally{loader?.dispose();delete globalThis[flag];f.close();}
});

test('lazy relative imports retain the approved graph after entry evaluation',async()=>{
  const f=fixture({'source/entry.mjs':"export const late=()=>import('./companion.mjs');\n",'source/companion.mjs':'export const value=1;\n'});let loader;
  try{loader=createVerifiedModuleLoader(f.root,f.commit,scopes);const loaded=await loader.importModule('source/entry.mjs');f.write('source/companion.mjs','export const value=2;\n');assert.equal((await loaded.late()).value,1);}
  finally{loader?.dispose();f.close();}
});

test('concurrent private namespaces retain separate module identities and relative graphs',async()=>{
  const f=fixture({'source/entry.mjs':"import {value} from './companion.mjs';let count=0;export const next=()=>value+(count++);\n",'source/companion.mjs':'export const value=1;\n'});let first,second;
  try{
    first=createVerifiedModuleLoader(f.root,f.commit,scopes);second=createVerifiedModuleLoader(f.root,f.commit,scopes);
    const [a,b]=await Promise.all([first.importModule('source/entry.mjs'),second.importModule('source/entry.mjs')]);
    assert.notEqual(a,b);assert.equal(a.next(),1);assert.equal(b.next(),1);assert.equal(a.next(),2);
  }finally{second?.dispose();first?.dispose();f.close();}
});

test('an owning virtual parent cannot bypass relative-only admission with its absolute virtual URL',async()=>{
  const f=fixture({'source/entry.mjs':"export const late=()=>import(new URL('./companion.mjs',import.meta.url).href);\n",'source/companion.mjs':'export const value=1;\n'});let first,second;
  try{
    first=createVerifiedModuleLoader(f.root,f.commit,scopes);second=createVerifiedModuleLoader(f.root,f.commit,scopes);
    const a=await first.importModule('source/entry.mjs');await assert.rejects(a.late(),/only captured relative imports/);
  }finally{second?.dispose();first?.dispose();f.close();}
});

for(const kind of ['builtin','bare','file','data','outside'])test('reviewed graph refuses '+kind+' imports without an origin fallback',async()=>{
  const f=fixture();let loader;
  try{
    const specifier={builtin:'node:fs',bare:'public-fixture-package',file:pathToFileURL(path.join(f.root,'outside.mjs')).href,data:'data:text/javascript,export const value=2',outside:'../outside.mjs'}[kind];
    f.write('source/entry.mjs','import '+JSON.stringify(specifier)+';export const value=1;\n');f.write('outside.mjs','export const value=2;\n');f.git('add','.');f.git('-c','user.name=Public fixture','-c','user.email=fixture@example.invalid','commit','-qm','Bounded import denial fixture');
    loader=createVerifiedModuleLoader(f.root,f.git('rev-parse','HEAD'),scopes);
    await assert.rejects(loader.importModule('source/entry.mjs'),/only captured relative imports|absent from its captured snapshot/);
  }finally{loader?.dispose();f.close();}
});

test('masked tracked-byte changes refuse before a loader is created',()=>{
  const f=fixture();try{f.git('update-index','--assume-unchanged','source/entry.mjs');f.write('source/entry.mjs','export const value=2;\n');assert.equal(f.git('status','--porcelain','--untracked-files=no'),'');assert.throws(()=>createVerifiedModuleLoader(f.root,f.commit,scopes),/differs from Git object/);}finally{f.close();}
});

test('tracked executable mode is checked even when Git mode detection is disabled',()=>{
  const f=fixture();try{f.git('config','core.filemode','false');fs.chmodSync(path.join(f.root,'source/entry.mjs'),0o755);assert.equal(f.git('status','--porcelain','--untracked-files=no'),'');assert.throws(()=>createVerifiedModuleLoader(f.root,f.commit,scopes),/mode differs/);}finally{f.close();}
});

test('untracked importable files are refused',()=>{
  const f=fixture();try{f.write('source/extra.mjs','export const value=2;\n');assert.throws(()=>createVerifiedModuleLoader(f.root,f.commit,scopes),/Untracked importable/);}finally{f.close();}
});

test('linked source files are refused',()=>{
  const f=fixture();try{const file=path.join(f.root,'source/companion.mjs');fs.renameSync(file,file+'.original');fs.symlinkSync(file+'.original',file);assert.throws(()=>createVerifiedModuleLoader(f.root,f.commit,scopes),/source link/);}finally{f.close();}
});

test('linked import directories are refused',()=>{
  const f=fixture();try{fs.renameSync(path.join(f.root,'source'),path.join(f.root,'original'));fs.symlinkSync(path.join(f.root,'original'),path.join(f.root,'source'));assert.throws(()=>createVerifiedModuleLoader(f.root,f.commit,scopes),/Source parent link/);}finally{f.close();}
});

test('the loader refuses an approved module exceeding eight MiB before import',()=>{
  const f=fixture({'source/entry.mjs':' '.repeat(8*1024*1024+1)});try{assert.throws(()=>createVerifiedModuleLoader(f.root,f.commit,scopes),/regular-file bound/);}finally{f.close();}
});

test('the private module graph refuses a total above thirty-two MiB',()=>{
  const files={};for(let i=0;i<9;i++)files['source/module-'+i+'.mjs']=' '.repeat(4*1024*1024);
  const f=fixture(files);try{assert.throws(()=>createVerifiedModuleLoader(f.root,f.commit,scopes),/graph bound/);}finally{f.close();}
});

test('a growing file cannot cause a read beyond its original size plus one',()=>{
  const f=fixture(),file=path.join(f.root,'source/entry.mjs'),info=fs.statSync(file),read=fs.readSync;let changed=false,maximum=0;
  try{
    fs.readSync=function(descriptor,buffer,offset,length,position){
      const own=fs.fstatSync(descriptor).ino===info.ino;
      if(own)maximum=Math.max(maximum,buffer.length);
      const count=read.call(this,descriptor,buffer,offset,length,position);
      if(own&&!changed){changed=true;fs.appendFileSync(file,' '.repeat(100000));}return count;
    };
    assert.throws(()=>createVerifiedModuleLoader(f.root,f.commit,scopes),/grew or changed/);assert(changed);assert.equal(maximum,info.size+1);
  }finally{fs.readSync=read;f.close();}
});

test('invalid UTF8 source refuses capture rather than changing executable bytes',()=>{
  const f=fixture({'source/entry.mjs':Buffer.from([0xc3,0x28])});try{assert.throws(()=>createVerifiedModuleLoader(f.root,f.commit,scopes),/encoded data was not valid/);}finally{f.close();}
});

test('dispose is idempotent and closes both import and digest access',async()=>{
  const f=fixture();let loader;
  try{loader=createVerifiedModuleLoader(f.root,f.commit,scopes);assert.equal((await loader.importModule('source/entry.mjs')).value,1);loader.dispose();loader.dispose();assert.throws(()=>loader.importModule('source/entry.mjs'),/loader is closed/);assert.throws(()=>loader.sourceSha256('source/entry.mjs'),/loader is closed/);}
  finally{loader?.dispose();f.close();}
});
