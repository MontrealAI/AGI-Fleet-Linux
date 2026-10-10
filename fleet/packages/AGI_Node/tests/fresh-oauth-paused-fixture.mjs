import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {releaseIdentity} from '../compute/desktop-evidence.mjs';
import {fixture} from './fresh-oauth-fixture.mjs';import {cleanInitializationFixture} from './clean-initialization-fixture.mjs';import {runtimeDatabase,runtimeReceipt} from './runtime-sqlite-fixture.mjs';
import {setupCapable} from '../compute/setup.mjs';import {assertAuthorizedOAuthChanges} from '../compute/setup-oauth-delta.mjs';import {inspectFreshOAuthResume,archiveFreshOAuthAttempt,seedFreshOAuthRoles} from '../compute/setup-fresh-oauth-resume.mjs';import {readSetupArguments} from '../compute/setup-ledger.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export function records(root){const rows={};function walk(dir,rel=''){for(const n of fs.readdirSync(dir).sort()){const p=path.join(dir,n),r=rel?rel+'/'+n:n,s=fs.lstatSync(p);if(s.isSymbolicLink())rows[r]={kind:'symlink',target:fs.readlinkSync(p)};else if(s.isDirectory())walk(p,r);else rows[r]={kind:'file',sha256:sha(fs.readFileSync(p)),mode:s.mode&0o777};}}walk(root);return rows;}
export function edit(file,change){const v=JSON.parse(fs.readFileSync(file));change(v);fs.writeFileSync(file,JSON.stringify(v),{mode:0o600});}
export function freshOAuthFixture(t,role='agent',options={}){
 const f=fixture(t,role);if(options.imagePlan)f.imagePlan=options.imagePlan;f.dependencies.desktopCheck=(_run,_docker,imageID)=>({passed:true,imageID,...releaseIdentity(path.resolve(new URL('..',import.meta.url).pathname)),detail:{passed:true,schema:'agi-workstation-check/v3'},oomKilled:false});const spawn=f.dependencies.spawnSync;f.roles=role==='agent'?['agi-creator','agi-checker','agi-reviewer']:['agi-checker','agi-reviewer'];
 f.dependencies.cleanInstallGroups=()=>({status:0,stdout:'staff everyone localaccounts\n'});
 const syntheticPrepare=f.dependencies.prepareCandidateState;f.dependencies.initializeFreshCandidateState=options=>{const {db}=runtimeDatabase(options.candidate,'state');db.exec('PRAGMA user_version=17');db.close();return syntheticPrepare(options);};f.dependencies.prepareCandidateState=()=>{throw Error('LEGACY_MUST_NOT_RUN');};
 f.dependencies.finishCandidateStatePreparation=({candidate,receipt})=>fs.writeFileSync(path.join(path.dirname(candidate),'state-preparation-receipt.json'),JSON.stringify(receipt),{mode:0o600});
 f.dependencies.prepareCleanCandidateInitialization=()=>cleanInitializationFixture();f.dependencies.finishCleanCandidateInitialization=()=>{};
 f.dependencies.assertAuthorizedOAuthChanges=(before,after)=>assertAuthorizedOAuthChanges(before,after); // The deployed 1.18.1 admission behavior.
 f.dependencies.stageCandidateAuthOrder=({candidate,agent})=>{const {db}=runtimeDatabase(candidate,'agent',agent);db.exec('PRAGMA user_version=21');const v={version:1,profiles:{'openai:agi-compute-pro':{provider:'openai',type:'oauth',access:'PRIVATE-ACCESS-'+agent,refresh:'PRIVATE-REFRESH-'+agent,expires:4102444800000}}};db.prepare('UPDATE auth_profile_store SET store_json=?').run(JSON.stringify(v));db.close();return runtimeReceipt(agent);};
 f.dependencies.spawnSync=(exe,args,opts)=>{
  if(args.includes('models')&&args.includes('status')){const agent=args[args.indexOf('--agent')+1],p=path.join(opts.env.OPENCLAW_STATE_DIR,'agents',agent,'agent/openclaw-agent.sqlite');if(fs.existsSync(p)){const db=new DatabaseSync(p,{readOnly:true});try{const v=JSON.parse(db.prepare('SELECT store_json FROM auth_profile_store').get().store_json);return {status:v.profiles?.['openai:agi-compute-pro']?.access?0:1};}finally{db.close();}}}
  const result=spawn(exe,args,opts);
  if(args.includes('models')&&args.includes('login'))edit(opts.env.OPENCLAW_CONFIG_PATH,v=>{v.agents.defaults.modelPolicy={allow:['openai/gpt-6-astra','openai/*']};v.meta={migrations:{modelPolicyAllowlist:true,utilityModelSeparation:true},lastTouchedVersion:'2026.9.5'};});
  return result;
 };
 return f;
}
export async function paused(t,role='agent',options={}){
 const f=freshOAuthFixture(t,role,options);
 await assert.rejects(setupCapable(f.kit,f.rl,{cleanInstall:true,assuranceMode:'verified',dependencies:f.dependencies}),/OPENCLAW_OAUTH_SECURITY_CHANGED/);
 delete f.dependencies.assertAuthorizedOAuthChanges;
 f.support=path.join(f.home,'.agi-genesis-setup-'+role);f.txFile=path.join(f.support,'transaction/transaction.json');f.candidate=path.join(f.support,'transaction/candidate');
 edit(path.join(f.support,'clean-install-intent.json'),v=>{v.releaseVersion=role==='agent'?'1.24.1':'2.25.1';});
 edit(path.join(f.support,'setup-diagnostics.json'),v=>{v.versions={...v.versions,fleet:'1.18.1',agent:'1.24.1',node:'2.25.1'};v.desktop.versions=Object.fromEntries(['fleet','agent','node'].map(k=>[k,v.versions[k]]));delete v.executionImages;});
 fs.writeFileSync(path.join(f.support,'desktop-diagnostics.json'),JSON.stringify(JSON.parse(fs.readFileSync(path.join(f.support,'setup-diagnostics.json'))).desktop),{mode:0o600});
 // Reconstruct the released 1.18.1 authority, including its historical limits.
 edit(path.join(f.candidate,'compute-settings.json'),v=>{delete v.executionImageVerification;v.maxRuns24h=48;v.maxImages24h=8;});
 // Ordinary generated runtime links are preserved as evidence, never traversed or copied to the next candidate.
 fs.mkdirSync(path.join(f.candidate,'plugin-skills'),{mode:0o700});fs.symlinkSync('/synthetic/pinned/browser-skill',path.join(f.candidate,'plugin-skills/browser-automation'));
 f.options={home:f.home,role,uid:f.dependencies.uid,signerUID:503,fileUID:process.getuid(),kit:f.kit,platform:'darwin',runtimePlatform:process.platform,listen:f.dependencies.listen,spawn:f.dependencies.spawnSync};
 f.resume=()=>setupCapable(f.kit,f.rl,{cleanInstall:true,assuranceMode:'verified',cleanOAuthResume:true,dependencies:f.dependencies});
 return f;
}
