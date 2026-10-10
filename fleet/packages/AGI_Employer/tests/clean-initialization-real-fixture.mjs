import {roleContract,OPERATOR_ROLES} from '../compute/roles.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {prepareCleanCandidateInitialization,finishCleanCandidateInitialization,isCleanInitializationReceipt} from '../compute/setup-clean-initialization.mjs';
import {treeIdentity} from '../compute/setup-transaction.mjs';
import {inspectExecutable} from '../compute/runtime-env.mjs';
import {captureRuntimeSecurityIdentity,assertRuntimeSecurityIdentity} from '../compute/setup-runtime-identity.mjs';
import {computeProfile} from '../compute/profile.mjs';
import {prepareCandidateState,finishCandidateStatePreparation} from '../compute/setup-state-preparation.mjs';
import {makePublicBrowserPolicy,installPublicBrowserPlugin,applyPublicBrowserProfile} from '../compute/public-browser-config.mjs';

const packageRoot=process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT??'/tmp/agi-auth-staging-runtime-9.5/node_modules/openclaw';
const available=fs.existsSync(path.join(packageRoot,'package.json'));
const contract=JSON.parse(fs.readFileSync(new URL('../compute/setup-runtime-sqlite-contract.json',import.meta.url)));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function realCleanInitializationFixture({role='employer'}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'agi-clean-init-')));fs.chmodSync(root,0o700);
 const profileDir=path.join(root,'live'),directory=path.join(root,'transaction'),candidate=path.join(directory,'candidate');
 fs.mkdirSync(directory,{mode:0o700});fs.mkdirSync(candidate,{mode:0o700});
 const generated=computeProfile({token:'a'.repeat(64),port:roleContract(role).gatewayPort,model:'openai/gpt-5.2',workspace:path.join(candidate,'workspace'),imageID:'sha256:'+'b'.repeat(64),workstation:true,jobRoot:path.join(candidate,'jobs'),inputRoot:path.join(candidate,'workspace/job-input'),browserImageID:'sha256:'+'c'.repeat(64),role});
 const policy=makePublicBrowserPolicy({profileDir}),candidatePolicy={...policy,pluginDirectory:path.join(candidate,'agi-runtime/public-browser-plugin')};installPublicBrowserPlugin(candidatePolicy.pluginDirectory);const config=OPERATOR_ROLES.includes(role)?generated:applyPublicBrowserProfile(generated,candidatePolicy);if(OPERATOR_ROLES.includes(role))fs.rmSync(path.join(candidate,'agi-runtime'),{recursive:true,force:true});
 config.cron={enabled:false};fs.writeFileSync(path.join(candidate,'openclaw.json'),JSON.stringify(config),{mode:0o600});
 fs.writeFileSync(path.join(candidate,'compute-settings.json'),JSON.stringify({role,profileDir,gatewayHeapMiB:4096,publicWebPolicy:OPERATOR_ROLES.includes(role)?null:policy}),{mode:0o600});
 fs.writeFileSync(path.join(candidate,'compute-journal.json'),'[{"spent":5,"limit":10}]',{mode:0o600});
 fs.mkdirSync(path.join(candidate,'state'),{mode:0o700});const file=path.join(candidate,'state/openclaw.sqlite');fs.writeFileSync(file,'',{mode:0o600});
 const db=new DatabaseSync(file);db.exec(contract.state.sql+'; PRAGMA user_version=17');
 db.prepare('INSERT INTO schema_meta VALUES(?,?,?,?,?,?,?)').run('primary','global',17,null,'2026.9.5',1,1);
 db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('auth.sharedStore','{"location":"state-db"}',1);db.close();
 for(const agent of Object.keys(config.agents.entries)){const file=path.join(candidate,'agents',agent,'agent','openclaw-agent.sqlite');fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,'',{mode:0o600});const db=new DatabaseSync(file);db.exec(contract.agent.sql+'; PRAGMA user_version=21');db.prepare('INSERT INTO schema_meta VALUES(?,?,?,?,?,?,?)').run('primary','agent',21,agent,'2026.9.5',1,1);db.prepare('INSERT INTO auth_profile_state VALUES(?,?,?)').run('primary',JSON.stringify({version:1,order:{openai:['openai:agi-compute-pro']}}),1);db.prepare('INSERT INTO auth_profile_store VALUES(?,?,?)').run('primary',JSON.stringify({version:1,profiles:{'openai:agi-compute-pro':{type:'oauth',provider:'openai',access:'test-no-authority',refresh:'test-no-authority',expires:4102444800000,accountId:'test-account'}}}),1);db.close();}
 const state={schema:1,treeIdentityVersion:3,stagingProtocolVersion:2,preparationProtocolVersion:1,state:'prepared',id:'fresh-clean-test',profileDir,previousExisted:false,baseIdentity:treeIdentity(profileDir)};
 const save=()=>fs.writeFileSync(path.join(directory,'transaction.json'),JSON.stringify(state),{mode:0o600});save();
 const runtime=available?{node:process.execPath,openclaw:path.join(packageRoot,'openclaw.mjs'),home:root,executableIdentity:{node:inspectExecutable(process.execPath,'node'),openclaw:inspectExecutable(path.join(packageRoot,'openclaw.mjs'),'openclaw')}}:{};
 const args={runtime,candidate,profileDir};
 return {root,profileDir,directory,candidate,file,state,save,args,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
