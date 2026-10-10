import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {stageCandidateAuthOrder} from '../compute/setup-auth-store.mjs';
import {treeIdentity} from '../compute/setup-transaction.mjs';

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-auth-stage-'));fs.chmodSync(root,0o700);
 const profileDir=path.join(root,'live'),directory=path.join(root,'transaction'),candidate=path.join(directory,'candidate');
 for(const p of [profileDir,directory,candidate,path.join(candidate,'agents'),path.join(candidate,'agents/agi-creator'),path.join(candidate,'agents/agi-creator/agent')])fs.mkdirSync(p,{mode:0o700});
 fs.writeFileSync(path.join(profileDir,'journal.txt'),'keep committed work',{mode:0o600});fs.writeFileSync(path.join(candidate,'openclaw.json'),'{}',{mode:0o600});
 const record={schema:1,treeIdentityVersion:3,stagingProtocolVersion:2,state:'prepared',id:'synthetic-auth-test',profileDir,baseIdentity:treeIdentity(profileDir)};
 const save=()=>fs.writeFileSync(path.join(directory,'transaction.json'),JSON.stringify(record),{mode:0o600});save();
 const options={runtime:{},candidate,profileDir,agent:'agi-creator',run(){throw Error('CHILD_MUST_NOT_RUN');}};
 return {root,profileDir,directory,candidate,record,save,options,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function rejected(f,change){try{change(f);assert.throws(()=>stageCandidateAuthOrder(f.options),/^Error: OPENCLAW_AUTH_ORDER_FAILED$/);assert.equal(fs.readFileSync(path.join(f.profileDir,'journal.txt'),'utf8'),'keep committed work');}finally{f.close();}}
test('auth staging rejects an unknown role before loading runtime or credentials',()=>rejected(fixture(),f=>{f.options.agent='main';}));
test('auth staging requires an absolute candidate path',()=>rejected(fixture(),f=>{f.options.candidate='transaction/candidate';}));
test('auth staging cannot select the live profile as candidate',()=>rejected(fixture(),f=>{f.options.candidate=f.profileDir;}));
test('auth staging refuses a transaction bound to another live profile',()=>rejected(fixture(),f=>{f.record.profileDir=path.join(f.root,'another-live');f.save();}));
test('auth staging refuses v1 and v2 identity records',()=>{for(const v of [1,2])rejected(fixture(),f=>{f.record.treeIdentityVersion=v;f.save();});});
test('auth staging requires protocol2 automatic archival before touching legacy prepared evidence',()=>{for(const version of [undefined,1,3])rejected(fixture(),f=>{f.record.stagingProtocolVersion=version;f.save();});});
test('auth staging refuses every nonprepared transaction state',()=>{for(const state of ['preparing','approved','publishing','published','sealed','complete','rolled-back','safe-stop-required'])rejected(fixture(),f=>{f.record.state=state;f.save();});});
test('auth staging refuses a readable-by-others transaction record',()=>rejected(fixture(),f=>{fs.chmodSync(path.join(f.directory,'transaction.json'),0o644);}));
test('auth staging refuses a nonprivate candidate directory',()=>rejected(fixture(),f=>{fs.chmodSync(f.candidate,0o755);}));
test('auth staging refuses a symlink at the role database owner',()=>rejected(fixture(),f=>{const p=path.join(f.candidate,'agents/agi-creator/agent');fs.rmdirSync(p);fs.symlinkSync(f.profileDir,p);}));
test('auth staging refuses unrelated durable candidate symlinks',()=>rejected(fixture(),f=>{fs.symlinkSync(path.join(f.profileDir,'journal.txt'),path.join(f.candidate,'redirect'));}));
test('auth staging refuses genuine live profile drift',()=>rejected(fixture(),f=>{fs.writeFileSync(path.join(f.profileDir,'new-work.txt'),'new committed work',{mode:0o600});}));
test('auth staging does not reveal arbitrary runtime errors',()=>rejected(fixture(),f=>{f.options.runtime={node:'SECRET-CANARY: invalid executable',openclaw:'SECRET-CANARY'};}));
