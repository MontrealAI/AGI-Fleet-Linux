import {initializeFreshCandidateState,finishCandidateStatePreparation} from '../compute/setup-state-preparation.mjs';
import {inspectExecutable} from '../compute/runtime-env.mjs';
import {setupCapable} from '../compute/setup.mjs';
import {syncBuiltinESMExports,createRequire} from 'node:module';
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';
import {paused,records,edit,freshOAuthFixture} from './fresh-oauth-paused-fixture.mjs';
import {seedFreshOAuthRoles as releasedSeed} from './released-1.18.2-transfer-fixture.mjs';
import {inspectFreshOAuthResume,archiveFreshOAuthAttempt,seedFreshOAuthRoles,recoverFreshOAuthLock} from '../compute/setup-fresh-oauth-resume.mjs';
import {withPrivateTemporary} from '../compute/setup-private-temp.mjs';
export function aliasFixture(t){const root=fs.mkdtempSync('/tmp/agi-alias-case-'),real=path.join(root,'private'),alias=path.join(root,'alias');fs.mkdirSync(real,{mode:0o700});fs.symlinkSync(real,alias);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,real,alias};}
export async function failed182(t,role='agent',{realState=false,imagePlan}={}){
 const f=await paused(t,role,{imagePlan}),alias=aliasFixture(t),tmpdir=os.tmpdir;
 if(realState){const node=process.execPath,openclaw=path.join(process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT,'openclaw.mjs');f.dependencies.initializeFreshCandidateState=options=>initializeFreshCandidateState({...options,runtime:{node,openclaw,home:f.home,executableIdentity:{node:inspectExecutable(node,'node'),openclaw:inspectExecutable(openclaw,'openclaw')}}});f.dependencies.finishCandidateStatePreparation=finishCandidateStatePreparation;}
 f.imageAttempt=1;
 // Exercise the shipped transfer with a genuine alias, after the real new transaction/preparation ordering.
 f.dependencies.seedFreshOAuthRoles=(...args)=>{os.tmpdir=()=>alias.alias;try{return releasedSeed(...args);}finally{os.tmpdir=tmpdir;}};
 await assert.rejects(f.resume(),/SETUP_STATE_OWNER_REQUIRED/);delete f.dependencies.seedFreshOAuthRoles;
 // Fixture represents released 1.18.2 persistence, which had no v2 continuation binding.
 fs.unlinkSync(path.join(f.support,'fresh-oauth-continuation.json'));
 edit(path.join(f.support,'clean-install-intent.json'),v=>{v.releaseVersion=role==='node'?'2.25.2':'1.24.2';});
 edit(path.join(f.support,'setup-diagnostics.json'),v=>{v.versions={...v.versions,fleet:'1.18.2',agent:'1.24.2',node:'2.25.2'};v.desktop.versions=Object.fromEntries(['fleet','agent','node'].map(k=>[k,v.versions[k]]));delete v.executionImages;});
 fs.writeFileSync(path.join(f.support,'desktop-diagnostics.json'),JSON.stringify(JSON.parse(fs.readFileSync(path.join(f.support,'setup-diagnostics.json'))).desktop),{mode:0o600});
 edit(path.join(f.candidate,'compute-settings.json'),v=>delete v.executionImageVerification);
 const report=JSON.parse(fs.readFileSync(path.join(f.support,'setup-diagnostics.json'))),state=JSON.parse(fs.readFileSync(f.txFile));
 assert.equal(state.state,'prepared');assert.equal(state.freshOAuthResume,undefined);assert.equal(fs.existsSync(path.join(f.candidate,'agents')),false);assert.equal(report.stages.profile,'failed');assert.equal(report.stages.oauth,'not-attempted');assert.equal(report.stages.services,'not-attempted');assert.equal(report.statePreparation.verified,true);return f;
}
