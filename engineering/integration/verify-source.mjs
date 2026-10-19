// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
export const INSPECTOR_SCOPES={
  alpha:[['.',false],['examples/successor-alpha',true],['examples/successor-workbench',true],['examples/build-successor',true],['examples/alpha-discovery',true],['docs/assets/successor',true],['docs/successor/alpha',true]],
  jobs:[['.',false],['packages/successor-core/src',true],['scripts/pages',false],['website/assets',false],['integrations/alpha-agent',false],['integrations/alpha-agent/vendor/alpha-computer',true]],
  manager:[['.',false],['scripts/integrations',false],['scripts/site',false],['scripts/successor',true],['site',false],['site/assets/successor',true],['site/assets/computer-receipt',true]],
};
// Explicit source scopes cover the installed inspectors and their reviewed relative imports.
// No parsing of arbitrary JavaScript or task-supplied module paths is involved.
const MODULE_BYTES=8*1024*1024,GRAPH_BYTES=32*1024*1024;
function snapshotModuleClosure(root,commit,scopes,capture){
  assert.equal(fs.realpathSync(root),root);
  assert(/^[a-f0-9]{40}$/.test(commit),'Installed inspector requires an exact commit');
  const git=(...args)=>execFileSync('/usr/bin/git',['--no-replace-objects','-c','core.fsmonitor=false','-C',root,...args],{encoding:'utf8',maxBuffer:16_000_000,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'}});
  assert.equal(git('rev-parse','HEAD').trim(),commit,'Installed inspector commit differs');
  const tracked=new Map(git('ls-tree','-r','-z',commit).split('\0').filter(Boolean).map(entry=>{
    const separator=entry.indexOf('\t'),header=/^([0-7]{6}) (blob|commit) ([a-f0-9]{40})$/.exec(entry.slice(0,separator));
    assert(header,'Installed source tree entry is invalid');return [entry.slice(separator+1),{mode:header[1],type:header[2],blob:header[3]}];
  })),visited=[],modules=new Map();let total=0;
  const walk=(directory,recursive)=>{assert.equal(fs.realpathSync(directory),directory,'Source parent link');for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);assert(!entry.isSymbolicLink(),'Importable source link');
    if(entry.isDirectory()){if(recursive&&entry.name!=='__pycache__')walk(file,true);continue;}
    if(!/\.(?:mjs|js|json|html|css)$/.test(entry.name))continue;const relative=path.relative(root,file);assert(entry.isFile(),'Source type');assert(tracked.has(relative),'Untracked importable source');
    const expected=tracked.get(relative);assert(expected.type==='blob'&&['100644','100755'].includes(expected.mode),'Source requires a tracked regular file');
    const descriptor=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try{
      const before=fs.fstatSync(descriptor),maximum=capture&&entry.name.endsWith('.mjs')?MODULE_BYTES:16_000_000;
      assert(before.isFile()&&before.size<=maximum,'Reviewed source exceeds its regular-file bound');
      assert.equal(Boolean(before.mode&0o111),expected.mode==='100755','Importable source mode differs from Git object');
      // Retain exactly the FD bytes whose object identity is verified below.
      // A growing file can consume at most its original size plus one byte.
      const bytes=Buffer.alloc(before.size+1);let length=0;
      while(length<bytes.length){const count=fs.readSync(descriptor,bytes,length,bytes.length-length,null);if(count===0)break;length+=count;}
      const after=fs.fstatSync(descriptor);
      assert(length===before.size&&['dev','ino','mode','size','mtimeMs','ctimeMs'].every(key=>before[key]===after[key]),'Importable source grew or changed during bounded read');
      const verified=bytes.subarray(0,length);
      assert.equal(createHash('sha1').update('blob '+length+'\0').update(verified).digest('hex'),expected.blob,'Importable source differs from Git object');
      if(capture&&entry.name.endsWith('.mjs')&&!modules.has(relative)){
        total+=length;assert(total<=GRAPH_BYTES&&modules.size<4096,'Reviewed module snapshot exceeds its graph bound');
        modules.set(relative,{source:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(verified),sha256:createHash('sha256').update(verified).digest('hex')});
      }
    }finally{fs.closeSync(descriptor);}
    visited.push(relative);
  }};
  for(const [relative,recursive] of scopes){const directory=path.resolve(root,relative);assert(directory===root||directory.startsWith(root+path.sep),'Source scope escaped its checkout');walk(directory,recursive);}
  assert.equal(git('status','--porcelain','--untracked-files=no').trim(),'','Tracked source changed');
  assert.equal(git('rev-parse','HEAD').trim(),commit,'Installed inspector commit changed');return {visited:visited.sort(),modules};
}
export function verifyModuleClosure(root,commit,scopes){return snapshotModuleClosure(root,commit,scopes,false).visited;}

/** Execute only the captured, verified pure ESM graph; no mutable origin URL is supplied to Node. */
export function createVerifiedModuleLoader(root,commit,scopes){
  const {modules}=snapshotModuleClosure(root,commit,scopes,true);
  const base='fleet-reviewed://'+randomUUID()+'/'+commit+'/';let disposed=false;
  const urlFor=relative=>base+relative.split('/').map(encodeURIComponent).join('/');
  const keyFor=url=>{
    const value=new URL(url);assert(url.startsWith(base)&&!value.search&&!value.hash,'Reviewed import escaped its snapshot');
    const relative=decodeURIComponent(value.pathname.slice(('/'+commit+'/').length));
    assert(urlFor(relative)===url&&modules.has(relative),'Reviewed import is absent from its captured snapshot');return relative;
  };
  const entry=relative=>{assert(!disposed,'Reviewed module loader is closed');assert(typeof relative==='string','Reviewed entry requires a relative path');const url=urlFor(relative);keyFor(url);return url;};
  const hook=registerHooks({
    resolve(specifier,context,nextResolve){
      // Let each other private namespace enforce its own parent boundary first.
      if(context.parentURL?.startsWith('fleet-reviewed://')){
        if(!context.parentURL.startsWith(base))return nextResolve(specifier,context);
        assert(specifier.startsWith('./')||specifier.startsWith('../'),'Reviewed modules permit only captured relative imports');
        const url=new URL(specifier,context.parentURL).href;keyFor(url);return {url,shortCircuit:true};
      }
      if(specifier.startsWith(base)){keyFor(specifier);return {url:specifier,shortCircuit:true};}
      return nextResolve(specifier,context);
    },
    load(url,context,nextLoad){if(!url.startsWith(base))return nextLoad(url,context);const relative=keyFor(url);return {format:'module',source:modules.get(relative).source,shortCircuit:true};},
  });
  return Object.freeze({importModule:relative=>import(entry(relative)),sourceSha256:relative=>modules.get(keyFor(entry(relative))).sha256,
    dispose:()=>{if(!disposed){disposed=true;hook.deregister();modules.clear();}}});
}
