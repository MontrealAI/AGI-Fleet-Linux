import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {failed182} from './fresh-oauth-continuation-fixture.mjs';import {edit} from './fresh-oauth-paused-fixture.mjs';
import {prepareCleanCandidateInitialization,finishCleanCandidateInitialization} from '../compute/setup-clean-initialization.mjs';
import {recordFreshOAuthFailure} from '../compute/setup-fresh-oauth-resume.mjs';import {inspectExecutable} from '../compute/runtime-env.mjs';
export const sdk={skip:!process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT?'Pinned OpenClaw 2026.9.5 package unavailable':false,timeout:180000};
export function realRuntime(f){const node=process.execPath,openclaw=path.join(process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT,'openclaw.mjs');return {node,openclaw,home:f.home,executableIdentity:{node:inspectExecutable(node,'node'),openclaw:inspectExecutable(openclaw,'openclaw')}};}
export async function interrupted185(t,role='agent'){
 const f=await failed182(t,role,{realState:true});f.imageAttempt=2;
 const baseline=await import('./released-clean-initialization-1.18.5-fixture.mjs');
 f.dependencies.prepareCleanCandidateInitialization=options=>baseline.prepareCleanCandidateInitialization({...options,runtime:realRuntime(f)});
 await assert.rejects(f.resume(),/SETUP_CLEAN_INITIALIZATION_CHANGED/);
 const version=role==='agent'?'1.24.5':'2.25.5';edit(path.join(f.support,'clean-install-intent.json'),v=>v.releaseVersion=version);
 edit(path.join(f.candidate,'compute-settings.json'),v=>v.executionImageVerification.releaseVersion=version);
 edit(path.join(f.support,'setup-diagnostics.json'),v=>{v.versions={fleet:'1.18.5',agent:'1.24.5',node:'2.25.5'};v.desktop.versions={...v.versions};delete v.cleanInitializationDiagnostic;});
 fs.writeFileSync(path.join(f.support,'desktop-diagnostics.json'),JSON.stringify(JSON.parse(fs.readFileSync(path.join(f.support,'setup-diagnostics.json'))).desktop),{mode:0o600});
 const state=JSON.parse(fs.readFileSync(f.txFile));recordFreshOAuthFailure({root:f.support,fileUID:process.getuid()},{directory:path.dirname(f.txFile),state});
 assert.equal(state.state,'prepared');assert.equal(state.primaryFailureCode,'SETUP_CLEAN_INITIALIZATION_CHANGED');assert.equal(state.approval,null);assert.equal(fs.existsSync(path.join(f.support,'security-review.json')),false);assert.equal(fs.existsSync(path.join(path.dirname(f.txFile),'clean-initialization-in-progress.json')),true);assert.equal(fs.existsSync(path.join(path.dirname(f.txFile),'clean-initialization-receipt.json')),false);assert.equal(f.active.size,0);
 f.dependencies.prepareCleanCandidateInitialization=options=>prepareCleanCandidateInitialization({...options,runtime:realRuntime(f)});f.dependencies.finishCleanCandidateInitialization=finishCleanCandidateInitialization;
 return f;
}
