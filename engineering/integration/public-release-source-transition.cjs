// SPDX-License-Identifier: MIT
// Static Git/source metadata only. No scanners, fixtures, native work or publication.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const [inputFile,jobsRoot,profileAsset,output]=process.argv.slice(2);
for(const value of [inputFile,jobsRoot,profileAsset,output])assert(path.isAbsolute(value??''));
const input=JSON.parse(fs.readFileSync(inputFile)),selected=input.repositories.jobs;
assert.equal(fs.realpathSync(jobsRoot),jobsRoot);
const env={PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
 GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',
 GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
const git=(...args)=>execFileSync('/usr/bin/git',['--no-replace-objects','-c','core.fsmonitor=false',
 '-c','core.hooksPath=/dev/null','-C',jobsRoot,...args],{env,maxBuffer:32*1024*1024,timeout:30000});
const text=(...args)=>git(...args).toString('utf8').trim();
assert.equal(text('rev-parse','HEAD'),selected.released.commit);
assert.equal(text('rev-parse','HEAD^{tree}'),selected.released.tree);
assert.equal(text('rev-parse',selected.reviewed.commit+'^{tree}'),selected.reviewed.tree);
git('merge-base','--is-ancestor',selected.reviewed.commit,selected.released.commit);
const metadata=require(path.join(jobsRoot,'scripts/release/source-profile-rc16.cjs'));
const historical=require(path.join(jobsRoot,'scripts/release/qualify-source-release-rc16.cjs'));
const read=name=>JSON.parse(fs.readFileSync(path.join(jobsRoot,name)));
const asset=fs.readFileSync(profileAsset);
assert.equal(crypto.createHash('sha256').update(asset).digest('hex'),selected.assets.sourceProfile.sha256);
assert.deepEqual(JSON.parse(asset),metadata.profile);
const context={git,sha:selected.released.commit,version:read('package.json').version,
 lock:read('package-lock.json'),policy:read('config/solidity-compiler.json')};
const scope=metadata.verifySourceScope(context);
const compilerScope=historical.verifySourceScope({git,sha:context.sha,version:context.version,policy:context.policy});
assert.equal(text('status','--porcelain','--untracked-files=no'),'');
fs.writeFileSync(output,JSON.stringify({
 schema:'agi-fleet/derived-jobs-source-transition/v1',
 reviewedSource:selected.reviewed,releasedSource:selected.released,
 sourceProfileAsset:selected.assets.sourceProfile,sourceContinuity:selected.sourceContinuity,
 jobsSourceTransition:selected.jobsSourceTransition,scope,compilerScope,
 source:'ORIGINAL_STRICT_JOBS_STATIC_VERIFIERS_AGAINST_GENUINE_GIT_OBJECTS',
 scannersExecuted:false,nativeExecuted:false,publicationQualifiedByThisCheck:false,
 productionApproved:false
},null,2)+'\n',{flag:'wx',mode:0o600});
