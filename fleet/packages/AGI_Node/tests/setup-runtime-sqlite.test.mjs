import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {sqliteSecurityProjection,sqliteSchemaPreflight} from '../compute/setup-runtime-sqlite.mjs';
const contract=JSON.parse(fs.readFileSync(new URL('../compute/setup-runtime-sqlite-contract.json',import.meta.url),'utf8'));
function fixture(t,kind='agent',agent='agi-creator'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-runtime-security-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const relative=kind==='agent'?`agents/${agent}/agent/openclaw-agent.sqlite`:'state/openclaw.sqlite',file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 fs.writeFileSync(file,'',{mode:0o600});const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');db.exec(contract[kind].sql);db.exec(`PRAGMA user_version=${kind==='agent'?21:17}`);
 db.prepare('INSERT INTO schema_meta VALUES(?,?,?,?,?,?,?)').run('primary',kind==='agent'?'agent':'global',kind==='agent'?21:17,kind==='agent'?agent:null,'2026.9.5',1,1);
 const auth={version:1,order:{openai:['openai:agi-compute-pro']}};const store={version:1,profiles:{'openai:agi-compute-pro':{type:'oauth',provider:'openai',access:'synthetic-access',refresh:'synthetic-refresh',expires:2000000000000,accountId:'synthetic-account',email:'fixture@example.invalid'}}};
 if(kind==='agent'){db.prepare('INSERT INTO auth_profile_state VALUES(?,?,?)').run('primary',JSON.stringify(auth),1);db.prepare('INSERT INTO auth_profile_store VALUES(?,?,?)').run('primary',JSON.stringify(store),1);}
 else{db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('authProfiles.state',JSON.stringify(auth),1);db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('authProfiles.store',JSON.stringify(store),1);}
 t.after(()=>db.close());const options={relative,profileDir:root,root,requiredOpenAIOrder:kind==='agent'};
 return {root,file,relative,db,auth,store,options,read:()=>sqliteSecurityProjection(file,options)};
}
function updateAuth(f,auth=f.auth){const table=f.relative.startsWith('state/')?'config_machine_state':'auth_profile_state',column=table==='config_machine_state'?'value_json':'state_json',key=table==='config_machine_state'?'state_key':'state_key',id=table==='config_machine_state'?'authProfiles.state':'primary';f.db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`).run(JSON.stringify(auth),id);}
function updateStore(f,store=f.store){f.db.prepare(f.relative.startsWith('state/')?"UPDATE config_machine_state SET value_json=? WHERE state_key='authProfiles.store'":"UPDATE auth_profile_store SET store_json=? WHERE store_key='primary'").run(JSON.stringify(store));}
for(const kind of ['agent','state']){
 test(`${kind}: coherent security digest permits usage and same-identity OAuth refresh only`,t=>{
  const f=fixture(t,kind),first=f.read();assert.deepEqual(Object.keys(first).sort(),['kind','schema','schemaObjects','sha256']);assert.match(first.sha256,/^[a-f0-9]{64}$/);
  f.auth.lastGood={openai:'openai:agi-compute-pro'};f.auth.usageStats={'openai:agi-compute-pro':{lastUsed:100,cooldownUntil:120}};updateAuth(f);
  Object.assign(f.store.profiles['openai:agi-compute-pro'],{access:'refreshed-access',refresh:'refreshed-refresh',expires:2100000000000,idToken:'refreshed-id-token'});updateStore(f);
  assert.deepEqual(f.read(),first);assert.equal(JSON.stringify(f.read()).includes('synthetic'),false);
  f.store.profiles['openai:agi-compute-pro'].accountId='different-account';updateStore(f);assert.notEqual(f.read().sha256,first.sha256);
 });
 test(`${kind}: provider orders and unknown security JSON fields remain protected`,t=>{
  const f=fixture(t,kind),first=f.read().sha256;f.auth.order.anthropic=['some-other-profile'];updateAuth(f);assert.notEqual(f.read().sha256,first);
  delete f.auth.order.anthropic;f.auth.unrecognizedSecuritySetting=true;updateAuth(f);assert.notEqual(f.read().sha256,first);
 });
 test(`${kind}: schema changes, unknown tables and substituted views fail closed`,t=>{
  const f=fixture(t,kind);f.db.exec('CREATE TABLE extra_security(value TEXT)');assert.throws(f.read,/SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED/);f.db.exec('DROP TABLE extra_security');
  const target=kind==='agent'?'auth_profile_state':'config_machine_state';f.db.exec(`ALTER TABLE ${target} RENAME TO old_target;CREATE VIEW ${target} AS SELECT * FROM old_target`);assert.throws(f.read,/SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED/);
 });
 test(`${kind}: known canonical lazy empty table creation leaves projection unchanged`,t=>{
  const f=fixture(t,kind),name=kind==='agent'?'session_goal_operations':'operator_approval_standing_grants';
  const objects=contract[kind].objects.filter(o=>o.tableName===name);for(const o of objects.filter(o=>o.type==='trigger'))f.db.exec(`DROP TRIGGER "${o.name}"`);f.db.exec(`DROP TABLE "${name}"`);
  const first=f.read().sha256;for(const o of objects.filter(o=>o.sql).sort((a,b)=>(a.type==='table'?-1:1)-(b.type==='table'?-1:1)))f.db.exec(o.sql);assert.equal(f.read().sha256,first);
 });
}
test('required local OpenAI order rejects missing, wrong, malformed and shared-only order',t=>{
 const f=fixture(t);for(const order of [[],['other'],['openai:agi-compute-pro','other'],null]){f.auth.order.openai=order;updateAuth(f);assert.throws(f.read,/SETUP_RUNTIME_SQLITE_SECURITY_INVALID/);}
 f.db.prepare("DELETE FROM auth_profile_state WHERE state_key='primary'").run();assert.throws(f.read,/SETUP_RUNTIME_SQLITE_SECURITY_INVALID/);
});
test('schema owner, schema version and credential routing are immutable',t=>{
 const f=fixture(t),first=f.read().sha256;f.db.prepare("UPDATE schema_meta SET agent_id='agi-checker' WHERE meta_key='primary'").run();assert.throws(f.read,/SETUP_RUNTIME_SQLITE_SECURITY_INVALID/);
 f.db.prepare("UPDATE schema_meta SET agent_id='agi-creator',schema_version=22 WHERE meta_key='primary'").run();assert.throws(f.read,/SETUP_RUNTIME_SQLITE_SECURITY_INVALID/);
 f.db.prepare("UPDATE schema_meta SET schema_version=21 WHERE meta_key='primary'").run();f.store.profiles['openai:agi-compute-pro'].tokenEndpoint='https://different.invalid/token';updateStore(f);assert.notEqual(f.read().sha256,first);
});
test('shared approval/config/pairing values remain protected',t=>{
 const f=fixture(t,'state'),first=f.read().sha256;f.db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('auth.sharedStore','{"mode":"agent"}',1);assert.notEqual(f.read().sha256,first);
 f.db.prepare("DELETE FROM config_machine_state WHERE state_key='auth.sharedStore'").run();f.db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('plugin.bindingAuthority','{"approved":true}',1);assert.notEqual(f.read().sha256,first);
});
test('startup checkpoints, leases, registry statistics, and typed config observations are runtime state',t=>{
 const f=fixture(t,'state'),first=f.read().sha256;
 f.db.prepare('INSERT INTO schema_meta VALUES(?,?,?,?,?,?,?)').run('startup-migrations','global',3,null,'2026.9.5\n3\n2026-09-05\none\ntwo\nthree',1,2);
 f.db.prepare('INSERT INTO state_leases VALUES(?,?,?,?,?,?,?,?)').run('startup-migrations','global','process:123',100,10,'{"pid":123}',1,2);
 f.db.prepare('INSERT INTO agent_databases VALUES(?,?,?,?,?)').run('agi-creator','agents/agi-creator/agent/openclaw-agent.sqlite',21,42,100);
 f.db.prepare('INSERT INTO config_health_entries VALUES(?,?,?,?,?)').run(path.join(f.root,'openclaw.json'),JSON.stringify({hash:'a'.repeat(64),bytes:100,hasMeta:true,gatewayMode:'local',observedAt:'2026-10-03'}),null,null,10);
 assert.equal(f.read().sha256,first);
 f.db.prepare("UPDATE agent_databases SET path='../../other.sqlite'").run();assert.notEqual(f.read().sha256,first);
});
test('unknown fields in config fingerprints stay protected',t=>{
 const f=fixture(t,'state'),first=f.read().sha256;f.db.prepare('INSERT INTO config_health_entries VALUES(?,?,?,?,?)').run(path.join(f.root,'openclaw.json'),JSON.stringify({hash:'a'.repeat(64),bytes:100,unexpectedAuthority:true}),null,null,10);assert.notEqual(f.read().sha256,first);
});
test('exact recognized path, private owner, type, hardlink, and symlink checks fail closed',t=>{
 const f=fixture(t);assert.throws(()=>sqliteSecurityProjection(f.file,{...f.options,relative:'other.sqlite'}),/SETUP_RUNTIME_SQLITE_PATH_UNSUPPORTED/);
 fs.chmodSync(f.file,0o644);assert.throws(f.read,/SETUP_STATE_OWNER_REQUIRED/);fs.chmodSync(f.file,0o600);
 const alias=path.join(f.root,'alias');fs.linkSync(f.file,alias);assert.throws(f.read,/SETUP_STATE_OWNER_REQUIRED/);fs.unlinkSync(alias);
 const getuid=process.getuid;process.getuid=()=>getuid()+1;try{assert.throws(f.read,/SETUP_STATE_OWNER_REQUIRED/);}finally{process.getuid=getuid;}
 fs.renameSync(f.file,alias);fs.symlinkSync(alias,f.file);assert.throws(f.read,/SETUP_STATE_OWNER_REQUIRED/);fs.unlinkSync(f.file);fs.renameSync(alias,f.file);
});
test('read-only projection includes committed WAL and does not checkpoint or alter database bytes',t=>{
 const f=fixture(t),digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');const before={main:digest(f.file),wal:digest(f.file+'-wal')};const old=f.read().sha256;
 assert.deepEqual({main:digest(f.file),wal:digest(f.file+'-wal')},before);
 f.auth.order.anthropic=['committed-in-wal'];updateAuth(f);assert.notEqual(f.read().sha256,old);assert.equal(digest(f.file),before.main);
});
test('real concurrent WAL commits do not destabilize security reads or lose committed rows',async t=>{
 const f=fixture(t),first=f.read().sha256;
 const code=`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA busy_timeout=2000;PRAGMA wal_autocheckpoint=0');let count=0;const timer=setInterval(()=>{count++;db.exec('BEGIN IMMEDIATE');db.prepare('INSERT INTO memory_session_tombstones VALUES(?,?,?,?)').run('session-'+count,'agi-creator','runtime',count);db.prepare("UPDATE auth_profile_state SET state_json=?,updated_at=? WHERE state_key='primary'").run(JSON.stringify({version:1,order:{openai:['openai:agi-compute-pro']},usageStats:{'openai:agi-compute-pro':{lastUsed:count}}}),count);db.exec('COMMIT');if(count===1)process.stdout.write('ready\\n');},1);process.on('SIGTERM',()=>{clearInterval(timer);process.stdout.write('commits='+count+'\\n');db.close();process.exit(0);});setTimeout(()=>{db.close();process.exit(2)},20000).unref();`;
 const child=spawn(process.execPath,['--input-type=module','-e',code,f.file],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('writer readiness timeout: '+stderr)),5000);const onData=()=>{if(stdout.includes('ready')){clearTimeout(timeout);child.stdout.off('data',onData);resolve();}};child.stdout.on('data',onData);child.once('error',reject);onData();});
 for(let i=0;i<50;i++)assert.equal(f.read().sha256,first);
 const done=once(child,'close');child.kill('SIGTERM');assert.equal((await done)[0],0,stderr);const count=Number(/commits=(\d+)/.exec(stdout)?.[1]);assert.ok(count>1);assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_session_tombstones').get().n,count);assert.equal(f.read().sha256,first);
 f.auth.order.openai=['different'];updateAuth(f);assert.throws(f.read,/SETUP_RUNTIME_SQLITE_SECURITY_INVALID/);
});

test('sealed schema guards reject removed table, index, and trigger while canonical additions remain allowed',t=>{
 const f=fixture(t),original=f.read();const options={...f.options,requiredSchemaObjects:original.schemaObjects};
 const index=contract.agent.objects.find(o=>o.type==='index'&&o.sql);f.db.exec(`DROP INDEX "${index.name}"`);assert.throws(()=>sqliteSecurityProjection(f.file,options),/SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED/);f.db.exec(index.sql);
 const trigger=contract.agent.objects.find(o=>o.type==='trigger'&&o.sql);f.db.exec(`DROP TRIGGER "${trigger.name}"`);assert.throws(()=>sqliteSecurityProjection(f.file,options),/SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED/);f.db.exec(trigger.sql);
 f.db.exec('DROP TABLE session_goal_operations');assert.throws(()=>sqliteSecurityProjection(f.file,options),/SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED/);
});
test('explicit registry aliases remain stable through candidate publication and unknown aliases stay protected',t=>{
 const f=fixture(t,'state'),live=path.join(f.root,'logical-live'),alias=path.join(f.root,'private-candidate');const options={...f.options,profileDir:live,allowedProfileRoots:[live,alias]};const read=()=>sqliteSecurityProjection(f.file,options).sha256;const before=read();
 f.db.prepare('INSERT INTO agent_databases VALUES(?,?,?,?,?)').run('agi-creator',path.join(alias,'agents/agi-creator/agent/openclaw-agent.sqlite'),21,1,10);assert.equal(read(),before);f.db.prepare("UPDATE agent_databases SET path=?").run(path.join(f.root,'arbitrary','agents/agi-creator/agent/openclaw-agent.sqlite'));assert.notEqual(read(),before);
});

test('only typed primary restart intent and handoff are ephemeral; unknown rows remain protected',t=>{
 const f=fixture(t,'state'),before=f.read().sha256;
 f.db.prepare('INSERT INTO gateway_restart_intent VALUES(?,?,?,?,?,?,?,?)').run('gateway-restart','gateway-restart',123,100,'gateway.restart',1,1000,100);
 f.db.prepare('INSERT INTO gateway_restart_handoff VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('current','gateway-supervisor-restart-handoff',1,'synthetic-intent',123,null,100,1000,'gateway.restart',null,null,'operator-restart','full-process','launchd',100);
 assert.equal(f.read().sha256,before);f.db.prepare("UPDATE gateway_restart_intent SET intent_key='unknown'").run();assert.notEqual(f.read().sha256,before);
 f.db.prepare("DELETE FROM gateway_restart_intent").run();f.db.prepare("UPDATE gateway_restart_handoff SET supervisor_mode='shell-command'").run();assert.throws(f.read,/SETUP_RUNTIME_SQLITE_SECURITY_INVALID/);
});
test('restart sentinel continuation remains protected',t=>{
 const f=fixture(t,'state'),before=f.read().sha256;
 f.db.prepare('INSERT INTO gateway_restart_sentinel(sentinel_key,version,kind,status,ts,payload_json,updated_at_ms) VALUES(?,?,?,?,?,?,?)').run('restart',1,'restart','pending',1,'{"continuation":{"task":"fixture"}}',1);
 assert.notEqual(f.read().sha256,before);
});

function userFamily(db,{legacyRole=false,legacyLogin=false,appendRole=false,appendLogin=false}={}){
 for(const name of ['user_profile_identities','user_profile_emails','user_profiles'])db.exec(`DROP TABLE IF EXISTS "${name}"`);
 for(const name of ['user_profiles','user_profile_emails','user_profile_identities']){
  const object=contract.state.objects.find(item=>item.name===name&&item.type==='table');
  db.exec((name==='user_profiles'&&legacyRole||name==='user_profile_identities'&&legacyLogin)?object.preflightLegacySqlVariants[0]:object.sql);
 }
 for(const object of contract.state.objects.filter(item=>item.type==='index'&&item.sql&&['user_profile_emails','user_profile_identities'].includes(item.tableName)))db.exec(object.sql);
 if(appendRole)db.exec('ALTER TABLE user_profiles ADD COLUMN role TEXT');
 if(appendLogin)db.exec('ALTER TABLE user_profile_identities ADD COLUMN canonical_login TEXT');
}
function userRows(db){
 db.prepare('INSERT INTO user_profiles(id,display_name,merged_into,role,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('fixture-profile','Fixture',null,'member',1,1);
 db.prepare('INSERT INTO user_profile_emails(email,profile_id,created_at) VALUES(?,?,?)').run('fixture@example.invalid','fixture-profile',1);
 db.prepare('INSERT INTO user_profile_identities(provider,subject,profile_id,canonical_login,created_at) VALUES(?,?,?,?,?)').run('google','fixture-subject','fixture-profile','fixture@example.invalid',1);
}
test('the pinned lazy user-profile family adds exactly eight explicitly protected schema objects',t=>{
 const f=fixture(t,'state'),family=contract.state.objects.filter(object=>['user_profiles','user_profile_emails','user_profile_identities'].includes(object.tableName));
 assert.equal(family.length,8);assert.equal(family.filter(o=>o.type==='table').length,3);assert.equal(family.filter(o=>o.type==='index'&&o.sql).length,2);assert.equal(family.filter(o=>o.type==='index'&&o.sql===null).length,3);
 const before=f.read().sha256;userRows(f.db);assert.notEqual(f.read().sha256,before);const sealed=f.read().sha256;
 const mutations=[['user_profiles','role','admin'],['user_profiles','merged_into','different-owner'],['user_profiles','display_name','Different'],['user_profile_emails','email','other@example.invalid'],['user_profile_emails','profile_id','different-profile'],['user_profile_identities','provider','different-provider'],['user_profile_identities','subject','different-subject'],['user_profile_identities','profile_id','different-profile'],['user_profile_identities','canonical_login','other@example.invalid']];
 for(const [table,column,value] of mutations){const previous=f.db.prepare(`SELECT "${column}" AS value FROM "${table}"`).get().value;const update=f.db.prepare(`UPDATE "${table}" SET "${column}"=?`);update.run(value);assert.notEqual(f.read().sha256,sealed,table+'.'+column);update.run(previous);assert.equal(f.read().sha256,sealed);}
});
for(const [role,login] of [[true,false],[false,true],[true,true]])test(`exact pinned ALTER completion accepted: role=${role}, canonical_login=${login}`,t=>{
 const f=fixture(t,'state');userRows(f.db);const expected=f.read().sha256;
 userFamily(f.db,{legacyRole:role,legacyLogin:login,appendRole:role,appendLogin:login});userRows(f.db);
 assert.equal(f.read().sha256,expected);const status=sqliteSchemaPreflight(f.file,{...f.options,allowSupportedLegacyUserProfiles:true});assert.deepEqual(status.legacyUserProfiles,[]);assert.equal(status.owner.schemaVersion,17);
});
for(const [role,login] of [[true,false],[false,true],[true,true]])test(`legacy admission is preflight-only: role=${role}, canonical_login=${login}`,t=>{
 const f=fixture(t,'state');userFamily(f.db,{legacyRole:role,legacyLogin:login});
 assert.throws(f.read,/SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED/);assert.throws(()=>sqliteSchemaPreflight(f.file,f.options),/SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED/);
 const status=sqliteSchemaPreflight(f.file,{...f.options,allowSupportedLegacyUserProfiles:true});assert.deepEqual(status.legacyUserProfiles,[...(role?['user_profiles.role']:[]),...(login?['user_profile_identities.canonical_login']:[])].sort());
 if(role)f.db.exec('ALTER TABLE user_profiles ADD COLUMN role TEXT');if(login)f.db.exec('ALTER TABLE user_profile_identities ADD COLUMN canonical_login TEXT');assert.match(f.read().sha256,/^[a-f0-9]{64}$/);
});
test('missing optional lazy family remains supported; owner initialization must precede the security seal',t=>{
 const f=fixture(t,'state');for(const table of ['user_profile_identities','user_profile_emails','user_profiles'])f.db.exec(`DROP TABLE "${table}"`);
 const before=f.read(),status=sqliteSchemaPreflight(f.file,{...f.options,allowSupportedLegacyUserProfiles:true});assert.deepEqual(status.legacyUserProfiles,[]);
 userFamily(f.db);assert.equal(f.read().sha256,before.sha256);f.db.prepare('INSERT INTO user_profiles(id,created_at,updated_at) VALUES(?,?,?)').run('gateway-owner',1,1);assert.notEqual(f.read().sha256,before.sha256);
});
test('unknown user-profile columns, altered types, indexes and triggers are refused even by migration preflight',t=>{
 const cases=["ALTER TABLE user_profiles ADD COLUMN superuser INTEGER","DROP INDEX idx_user_profile_emails_profile_id; CREATE UNIQUE INDEX idx_user_profile_emails_profile_id ON user_profile_emails(profile_id)","CREATE TRIGGER extra_user_authority AFTER INSERT ON user_profiles BEGIN UPDATE user_profiles SET role='admin' WHERE id=NEW.id;END"];
 for(const sql of cases){const f=fixture(t,'state');f.db.exec(sql);assert.throws(f.read,/SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED/);assert.throws(()=>sqliteSchemaPreflight(f.file,{...f.options,allowSupportedLegacyUserProfiles:true}),/SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED/);}
 const f=fixture(t,'state');userFamily(f.db,{legacyRole:true});f.db.exec('ALTER TABLE user_profiles ADD COLUMN role INTEGER');assert.throws(f.read,/SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED/);assert.throws(()=>sqliteSchemaPreflight(f.file,{...f.options,allowSupportedLegacyUserProfiles:true}),/SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED/);
});
test('schema preflight is read-only including committed WAL, validates ownership/header and returns no profile data',t=>{
 const f=fixture(t,'state');userRows(f.db);const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),before={main:hash(f.file),wal:hash(f.file+'-wal')};
 const result=sqliteSchemaPreflight(f.file,{...f.options,allowSupportedLegacyUserProfiles:true});assert.equal(result.userVersion,17);assert.equal(result.owner.appVersion,'2026.9.5');assert.match(result.schemaDigest,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(result).includes('fixture@example.invalid'),false);
 assert.deepEqual({main:hash(f.file),wal:hash(f.file+'-wal')},before);f.db.exec('PRAGMA user_version=16');assert.throws(()=>sqliteSchemaPreflight(f.file,{...f.options,allowSupportedLegacyUserProfiles:true}),/SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED/);
});

// Standard reads the same pinned lazy grant store without invoking Verified initialization.
import {sqliteStandardAuthority} from '../compute/setup-runtime-sqlite.mjs';
const standardRead=f=>sqliteStandardAuthority(f.file,f.options);
const grantsObjects=contract.state.objects.filter(o=>o.tableName==='operator_approval_standing_grants'&&o.sql).sort((a,b)=>(a.type==='table'?-1:1)-(b.type==='table'?-1:1));
test('Standard lazy standing-grants absence and canonical empty table have identical authority',t=>{
 const f=fixture(t,'state');f.db.exec('DROP TABLE operator_approval_standing_grants');const before=standardRead(f);for(const object of grantsObjects)f.db.exec(object.sql);assert.equal(standardRead(f),before);
 f.db.exec("INSERT INTO operator_approvals(approval_id,resolution_ref,kind,status,presentation_json,reviewer_device_ids_json,audience_session_keys_json,runtime_epoch,created_at_ms,expires_at_ms,updated_at_ms) VALUES('grant-source','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','exec','pending','{}','[]','[]','test',1,2,1)");
 f.db.exec("INSERT INTO operator_approval_standing_grants(grant_id,minted_by_approval_id,agent_id,cron_job_id,job_config_revision,operation_binding,created_at_ms) VALUES('grant','grant-source','agi-checker','cron','revision','binding',1)");
 const nonempty=standardRead(f);assert.notEqual(nonempty,before);f.db.exec("UPDATE operator_approval_standing_grants SET use_count=42,last_used_at_ms=100");assert.equal(standardRead(f),nonempty);
 f.db.exec("UPDATE operator_approval_standing_grants SET expires_at_ms=999,revoked_at_ms=100,revoked_by='operator'");assert.notEqual(standardRead(f),nonempty);
});
for(const mutation of [
 'DROP TABLE operator_approval_standing_grants;CREATE VIEW operator_approval_standing_grants AS SELECT 1',
 'DROP TABLE operator_approval_standing_grants;CREATE TABLE operator_approval_standing_grants(grant_id TEXT)',
 'DROP INDEX idx_operator_approval_standing_grants_binding',
 'CREATE INDEX unexpected_grants_index ON operator_approval_standing_grants(agent_id)',
 'CREATE TRIGGER unexpected_grants_trigger AFTER INSERT ON operator_approval_standing_grants BEGIN SELECT 1;END',
 'PRAGMA user_version=18',
 "UPDATE schema_meta SET agent_id='wrong-owner' WHERE meta_key='primary'",
 'DROP TABLE config_machine_state','DROP TABLE exec_approvals_config','DROP TABLE plugin_binding_approvals','DROP TABLE mcp_oauth_stores'
])test('Standard lazy admission fails closed for '+mutation.split(';')[0],t=>{const f=fixture(t,'state');f.db.exec(mutation);assert.throws(()=>standardRead(f),/SETUP_RUNTIME_SQLITE_(SCHEMA_UNSUPPORTED|SECURITY_INVALID)/);});
test('Standard rejects malformed grant records even when SQLite CHECK constraints were bypassed',t=>{
 const f=fixture(t,'state');f.db.exec('PRAGMA foreign_keys=OFF;PRAGMA ignore_check_constraints=ON');f.db.exec("INSERT INTO operator_approval_standing_grants(grant_id,minted_by_approval_id,agent_id,cron_job_id,job_config_revision,operation_binding,created_at_ms,use_count) VALUES('grant','approval','','cron','revision','binding',-1,-1)");assert.throws(()=>standardRead(f),/SETUP_RUNTIME_SQLITE_SECURITY_INVALID/);
});
