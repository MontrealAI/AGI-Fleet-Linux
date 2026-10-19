// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
// Explicit source scopes cover the installed inspectors and their reviewed relative imports.
// No parsing of arbitrary JavaScript or task-supplied module paths is involved.
export function verifyModuleClosure(root,commit,scopes){
  assert.equal(fs.realpathSync(root),root);
  const git=(...args)=>execFileSync('/usr/bin/git',['--no-replace-objects','-c','core.fsmonitor=false','-C',root,...args],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1'}});
  assert.equal(git('rev-parse','HEAD').trim(),commit,'Installed inspector commit differs');
  const tracked=new Set(git('ls-tree','-r','--name-only',commit).trim().split('\n')),visited=[];
  const walk=(directory,recursive)=>{assert.equal(fs.realpathSync(directory),directory,'Source parent link');for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);assert(!entry.isSymbolicLink(),'Importable source link');
    if(entry.isDirectory()){if(recursive&&entry.name!=='__pycache__')walk(file,true);continue;}
    if(!/\.(?:mjs|js|json)$/.test(entry.name))continue;const relative=path.relative(root,file);assert(entry.isFile(),'Source type');assert(tracked.has(relative),'Untracked importable source');assert.equal(fs.readFileSync(file,'utf8'),git('show',commit+':'+relative),'Importable source differs from Git object');visited.push(relative);
  }};
  for(const [relative,recursive] of scopes)walk(path.join(root,relative),recursive);
  assert.equal(git('status','--porcelain','--untracked-files=no').trim(),'','Tracked source changed');return visited.sort();
}
