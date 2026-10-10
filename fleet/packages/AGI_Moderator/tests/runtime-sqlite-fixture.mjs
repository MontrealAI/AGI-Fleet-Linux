import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const contract=JSON.parse(fs.readFileSync(new URL('../compute/setup-runtime-sqlite-contract.json',import.meta.url)));
export const runtimeAgents=['agi-creator','agi-checker','agi-reviewer'];
export const runtimeReceipt=agent=>({agent,provider:'openai',order:['openai:agi-compute-pro'],storage:'openclaw-agent-sqlite',verified:true});
export function runtimeDatabase(root,kind='agent',agent='agi-creator'){
 const file=path.join(root,kind==='agent'?`agents/${agent}/agent/openclaw-agent.sqlite`:'state/openclaw.sqlite');fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const present=fs.existsSync(file),db=new DatabaseSync(file);fs.chmodSync(file,0o600);db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
 if(!present){db.exec(contract[kind].sql);db.exec('PRAGMA user_version='+(kind==='agent'?21:17));db.prepare('INSERT INTO schema_meta VALUES(?,?,?,?,?,?,?)').run('primary',kind==='agent'?'agent':'global',kind==='agent'?21:17,kind==='agent'?agent:null,'2026.9.5',1,1);if(kind==='agent'){db.prepare('INSERT INTO auth_profile_store VALUES(?,?,?)').run('primary',JSON.stringify({version:1,profiles:{}}),1);db.prepare('INSERT INTO auth_profile_state VALUES(?,?,?)').run('primary',JSON.stringify({version:1,order:{openai:['openai:agi-compute-pro']}}),1);}else{db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('authProfiles.store',JSON.stringify({version:1,profiles:{}}),1);db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('authProfiles.state',JSON.stringify({version:1}),1);}}
 fs.chmodSync(file,0o600);return {file,db};
}
export function seedRuntime(root){for(const agent of runtimeAgents)runtimeDatabase(root,'agent',agent).db.close();runtimeDatabase(root,'state').db.close();}
export function stageRuntimeFixture({candidate,agent}){const global=runtimeDatabase(candidate,'state').db;global.exec('PRAGMA user_version=17');global.close();const {db}=runtimeDatabase(candidate,'agent',agent);db.close();return runtimeReceipt(agent);}
