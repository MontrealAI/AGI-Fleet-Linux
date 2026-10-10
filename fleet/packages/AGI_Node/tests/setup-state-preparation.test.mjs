import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {initializeFreshCandidateState,prepareCandidateState,finishCandidateStatePreparation,isCandidateStatePreparationReceipt,observeStateSchema} from '../compute/setup-state-preparation.mjs';
import {treeIdentity} from '../compute/setup-transaction.mjs';
import {inspectExecutable} from '../compute/runtime-env.mjs';
import {sqliteSecurityProjection,sqliteSchemaPreflight} from '../compute/setup-runtime-sqlite.mjs';

const contract=JSON.parse(fs.readFileSync(new URL('../compute/setup-runtime-sqlite-contract.json',import.meta.url),'utf8'));
const configuredPackage=process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT;
const packageRoot=configuredPackage??'/tmp/agi-auth-staging-runtime-9.5/node_modules/openclaw';
const available=fs.existsSync(path.join(packageRoot,'package.json'));
const sdkOptions={skip:available?false:'Pinned OpenClaw 2026.9.5 package is not available; set AGI_TEST_OPENCLAW_PACKAGE_ROOT',timeout:120000};
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-state-prep-'));fs.chmodSync(root,0o700);
 const profileDir=path.join(root,'live'),directory=path.join(root,'transaction'),candidate=path.join(directory,'candidate');
 for(const dir of [profileDir,directory,candidate])fs.mkdirSync(dir,{mode:0o700});
 fs.writeFileSync(path.join(candidate,'openclaw.json'),'{}',{mode:0o600});fs.writeFileSync(path.join(candidate,'compute-journal.json'),'[{"limit":10,"used":4}]',{mode:0o600});
 fs.writeFileSync(path.join(profileDir,'journal.txt'),'Original machine history',{mode:0o600});
 const record={schema:1,treeIdentityVersion:3,stagingProtocolVersion:2,preparationProtocolVersion:1,state:'prepared',id:'synthetic-state-preparation',profileDir,baseIdentity:treeIdentity(profileDir)};
 const save=()=>fs.writeFileSync(path.join(directory,'transaction.json'),JSON.stringify(record),{mode:0o600});save();
 const options={runtime:{},candidate,profileDir,run(){throw Error('SDK_MUST_NOT_RUN');}};
 return {root,profileDir,directory,candidate,record,save,options,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function runtime(f){const openclaw=path.join(packageRoot,'openclaw.mjs'),node=process.execPath;return {node,openclaw,home:f.root,executableIdentity:{node:inspectExecutable(node,'node'),openclaw:inspectExecutable(openclaw,'openclaw')}};}
function seedCurrent(f,{users=true,legacyRole=false,legacyLogin=false,owner=false}={}){
 const program=`import fs from 'node:fs';import path from 'node:path';const api=await import(${JSON.stringify(pathToFileURL(path.join(packageRoot,'dist/openclaw-state-db-BGE_KP3L.mjs')).href)});api.openOpenClawStateDatabase({path:process.env.OPENCLAW_STATE_DIR+'/state/openclaw.sqlite',env:process.env});await api.closeOpenClawStateDatabaseAsync();`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',program],{cwd:f.candidate,env:{HOME:f.candidate,PATH:'/usr/bin:/bin',NODE_NO_WARNINGS:'1',OPENCLAW_STATE_DIR:f.candidate,OPENCLAW_CONFIG_PATH:path.join(f.candidate,'openclaw.json')},encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stderr);
 const file=path.join(f.candidate,'state/openclaw.sqlite'),db=new DatabaseSync(file);
 if(users){
  for(const name of ['user_profiles','user_profile_emails','user_profile_identities']){const definition=contract.state.objects.find(entry=>entry.name===name);const legacy=name==='user_profiles'?legacyRole:name==='user_profile_identities'?legacyLogin:false;db.exec((legacy?definition.preflightLegacySqlVariants[0]:definition.sql)+';');}
  for(const name of ['idx_user_profile_emails_profile_id','idx_user_profile_identities_profile_id'])db.exec(contract.state.objects.find(entry=>entry.name===name).sql+';');
  db.prepare('INSERT INTO user_profiles(id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run('synthetic-person','Synthetic record',1,1);
  db.prepare('INSERT INTO user_profile_emails(email,profile_id,created_at) VALUES(?,?,?)').run('synthetic@example.invalid','synthetic-person',2);
  db.prepare('INSERT INTO user_profile_identities(provider,subject,profile_id,created_at) VALUES(?,?,?,?)').run('synthetic-provider','synthetic-subject','synthetic-person',3);
  if(owner){db.prepare('INSERT INTO user_profiles(id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run('gateway-owner','Existing owner',4,4);db.prepare('INSERT INTO user_profile_identities(provider,subject,profile_id,created_at) VALUES(?,?,?,?)').run('gateway.local','owner','gateway-owner',4);}
 }
 db.prepare('INSERT INTO config_machine_state(state_key,value_json,updated_at_ms) VALUES(?,?,?)').run('synthetic-history','{"committed":true}',5);db.close();
 fs.cpSync(path.join(f.candidate,'state'),path.join(f.profileDir,'state'),{recursive:true,preserveTimestamps:true});f.record.baseIdentity=treeIdentity(f.profileDir);f.save();
 return file;
}
function finish(f,receipt){f.record.preparationReceipt=receipt;f.save();finishCandidateStatePreparation({candidate:f.candidate,profileDir:f.profileDir,receipt});}
function reject(change,code='SETUP_STATE_PREPARATION_FAILED'){const f=fixture();try{change(f);assert.throws(()=>prepareCandidateState(f.options),new RegExp('^Error: '+code+'$'));assert.equal(fs.readFileSync(path.join(f.profileDir,'journal.txt'),'utf8'),'Original machine history');}finally{f.close();}}

test('state preparation requires a private v3 prepared candidate and current preparation protocol',()=>{for(const field of ['treeIdentityVersion','stagingProtocolVersion','preparationProtocolVersion'])reject(f=>{f.record[field]=0;f.save();});reject(f=>{f.record.state='approved';f.save();});});
test('state preparation rejects live-path aliasing and durable redirected candidate state',()=>{reject(f=>{f.options.candidate=f.profileDir;});reject(f=>{fs.symlinkSync(f.profileDir,path.join(f.candidate,'redirect'));},'SETUP_STATE_OWNER_REQUIRED');});
test('state preparation refuses genuine live drift before runtime selection',()=>reject(f=>{fs.writeFileSync(path.join(f.profileDir,'new-history'),'new',{mode:0o600});},'SETUP_PROFILE_CHANGED'));
test('state preparation receipt validator rejects unknown effects, paths and secret-bearing fields',()=>{
 const good={schema:'agi-candidate-state-preparation/v1',protocolVersion:1,openclawVersion:'2026.9.5',sourceSchemaSha256:'1'.repeat(64),destinationSchemaSha256:'2'.repeat(64),sourceContentSha256:'3'.repeat(64),destinationContentSha256:'4'.repeat(64),sourceObjectCount:0,destinationObjectCount:8,sourceRowCount:0,destinationRowCount:2,addedSchemaObjects:['table:user_profiles'],addedColumns:[],ownerProfileCreated:true,ownerIdentityCreated:true,ownerDisplayNameInitialized:false,ownerDisplayNameSource:'local-owner-fallback',existingRecordsPreserved:true,verified:true};
 assert.equal(isCandidateStatePreparationReceipt(good),true);for(const altered of [{...good,token:'PRIVATE'},{...good,addedColumns:['auth_profile_store.credentials']},{...good,addedSchemaObjects:['table:../../outside']},{...good,ownerDisplayNameSource:'unverified-network'}])assert.equal(isCandidateStatePreparationReceipt(altered),false);
});

test('pinned SDK prepares reported lazy user-profile family without manufacturing first-use tables',sdkOptions,()=>{
 const f=fixture();try{
  const file=seedCurrent(f,{owner:true}),before=treeIdentity(f.profileDir),receipt=prepareCandidateState({...f.options,runtime:runtime(f),run:spawnSync});
  assert.equal(receipt.sourceSchemaSha256,receipt.destinationSchemaSha256);assert.equal(receipt.sourceContentSha256,receipt.destinationContentSha256);assert.deepEqual(receipt.addedSchemaObjects,[]);assert.equal(receipt.ownerDisplayNameSource,'existing');assert.equal(treeIdentity(f.profileDir),before);assert.equal(f.record.state,'prepared');
  const db=new DatabaseSync(file,{readOnly:true});assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='execution_identity_contexts'").get(),undefined);assert.equal(db.prepare('SELECT count(*) AS n FROM user_profiles').get().n,2);db.close();
  assert.equal(fs.existsSync(path.join(f.directory,'state-preparation-in-progress.json')),true);assert.throws(()=>finishCandidateStatePreparation({candidate:f.candidate,profileDir:f.profileDir,receipt}),/^Error: SETUP_STATE_PREPARATION_FAILED$/);finish(f,receipt);assert.equal(fs.existsSync(path.join(f.directory,'state-preparation-in-progress.json')),false);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.directory,'state-preparation-receipt.json'))),receipt);
 }finally{f.close();}
});
for(const fields of [{legacyRole:true},{legacyLogin:true},{legacyRole:true,legacyLogin:true}])test('pinned SDK migrates only sourced additive user columns '+JSON.stringify(fields),sdkOptions,()=>{
 const f=fixture();try{const file=seedCurrent(f,fields),before=treeIdentity(f.profileDir),receipt=prepareCandidateState({...f.options,runtime:runtime(f),run:spawnSync});
  assert.equal(receipt.existingRecordsPreserved,true);assert.equal(receipt.ownerProfileCreated,true);assert.equal(receipt.ownerIdentityCreated,true);assert.equal(receipt.sourceRowCount+2,receipt.destinationRowCount);assert.deepEqual(receipt.addedColumns,[...(fields.legacyLogin?['user_profile_identities.canonical_login']:[]),...(fields.legacyRole?['user_profiles.role']:[])]);assert.equal(treeIdentity(f.profileDir),before);
  assert.deepEqual(sqliteSchemaPreflight(file,{root:f.candidate,profileDir:f.profileDir,relative:'state/openclaw.sqlite'}).legacyUserProfiles,[]);const db=new DatabaseSync(file,{readOnly:true});assert.equal(db.prepare("SELECT value_json FROM config_machine_state WHERE state_key='synthetic-history'").get().value_json,'{"committed":true}');assert.equal(db.prepare("SELECT role FROM user_profiles WHERE id='synthetic-person'").get().role,null);assert.equal(db.prepare("SELECT canonical_login FROM user_profile_identities WHERE provider='synthetic-provider'").get().canonical_login,null);db.close();finish(f,receipt);
 }finally{f.close();}
});
test('first-use Gateway owner is reviewed and later host-name resolution does not mutate protected state',sdkOptions,()=>{
 const f=fixture();try{const file=seedCurrent(f,{users:false}),receipt=prepareCandidateState({...f.options,runtime:runtime(f),run:spawnSync});assert.equal(receipt.ownerProfileCreated,true);assert.equal(receipt.addedSchemaObjects.length,8);finish(f,receipt);
  const options={root:f.candidate,profileDir:f.profileDir,relative:'state/openclaw.sqlite'},before=sqliteSecurityProjection(file,options).sha256;
  const program=`const state=await import(${JSON.stringify(pathToFileURL(path.join(packageRoot,'dist/openclaw-state-db-BGE_KP3L.mjs')).href)});const users=await import(${JSON.stringify(pathToFileURL(path.join(packageRoot,'dist/user-profiles-sKCT5VNF.mjs')).href)});users.n('Host name available later',{path:process.env.OPENCLAW_STATE_DIR+'/state/openclaw.sqlite',env:process.env});await state.closeOpenClawStateDatabaseAsync();`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',program],{cwd:f.candidate,env:{HOME:f.candidate,PATH:'/usr/bin:/bin',NODE_NO_WARNINGS:'1',OPENCLAW_STATE_DIR:f.candidate,OPENCLAW_CONFIG_PATH:path.join(f.candidate,'openclaw.json')},encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stderr);assert.equal(sqliteSecurityProjection(file,options).sha256,before);
 }finally{f.close();}
});
test('unrecognized state tables fail before SDK mutation and retain automatic-recovery marker',sdkOptions,()=>{
 const f=fixture();try{const file=seedCurrent(f),db=new DatabaseSync(file);db.exec('CREATE TABLE unknown_authority(permission TEXT) STRICT');db.close();const before=treeIdentity(f.candidate),liveBefore=treeIdentity(f.profileDir);assert.throws(()=>prepareCandidateState({...f.options,runtime:runtime(f),run:spawnSync}),/^Error: SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED$/);assert.equal(treeIdentity(f.candidate),before);assert.equal(treeIdentity(f.profileDir),liveBefore);assert.equal(fs.existsSync(path.join(f.directory,'state-preparation-in-progress.json')),true);assert.equal(fs.existsSync(path.join(f.directory,'state-preparation-receipt.json')),false);assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'transaction.json'))).state,'prepared');}finally{f.close();}
});

test('schema observations contain definitions hashes and names, never data or SQL literals',sdkOptions,()=>{
 const f=fixture();try{const file=seedCurrent(f),db=new DatabaseSync(file);db.exec("CREATE TABLE diagnostic_unknown(value TEXT DEFAULT 'SECRET_LITERAL') STRICT");db.prepare("INSERT INTO diagnostic_unknown(value) VALUES(?)").run('SECRET_ROW_VALUE');db.close();const before=treeIdentity(f.candidate),observation=observeStateSchema({profileDir:f.candidate});assert.equal(observation.userVersion,17);assert.ok(observation.objects.some(row=>row.name.startsWith('opaque:')));assert.doesNotMatch(JSON.stringify(observation),/SECRET_LITERAL|SECRET_ROW_VALUE|synthetic@example|diagnostic_unknown/);assert.equal(treeIdentity(f.candidate),before);}finally{f.close();}
});
test('committed WAL rows survive candidate preparation without operator checkpointing',sdkOptions,()=>{
 const f=fixture();let writer;try{const file=seedCurrent(f);writer=new DatabaseSync(file);writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');writer.prepare('INSERT INTO config_machine_state(state_key,value_json,updated_at_ms) VALUES(?,?,?)').run('synthetic-committed-wal','{"history":"retain"}',6);for(const suffix of ['-wal','-shm'])if(fs.existsSync(file+suffix))fs.chmodSync(file+suffix,0o600);assert.ok(fs.statSync(file+'-wal').size>0);const receipt=prepareCandidateState({...f.options,runtime:runtime(f),run:spawnSync});assert.equal(receipt.existingRecordsPreserved,true);assert.equal(writer.prepare("SELECT value_json FROM config_machine_state WHERE state_key='synthetic-committed-wal'").get().value_json,'{"history":"retain"}');finish(f,receipt);}finally{writer?.close();f.close();}
});

test('schema observation reads committed WAL through private copies without source sidecar changes',sdkOptions,()=>{
 const f=fixture();let writer;try{const file=seedCurrent(f);writer=new DatabaseSync(file);writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE observe_committed_wal(value TEXT) STRICT');for(const suffix of ['-wal','-shm'])if(fs.existsSync(file+suffix))fs.chmodSync(file+suffix,0o600);const capture=()=>Object.fromEntries(fs.readdirSync(path.dirname(file)).sort().map(name=>[name,fs.readFileSync(path.join(path.dirname(file),name)).toString('hex')]));const before=capture(),observation=observeStateSchema({profileDir:f.candidate});assert.ok(observation.objects.some(row=>row.name.startsWith('opaque:')));assert.deepEqual(capture(),before);}finally{writer?.close();f.close();}
});

test('private-copy source admission recognizes current and supported additive user schemas',sdkOptions,()=>{
 for(const fields of [{},{legacyRole:true},{legacyLogin:true},{legacyRole:true,legacyLogin:true}]){const f=fixture();try{seedCurrent(f,fields);const before=treeIdentity(f.candidate),observation=observeStateSchema({profileDir:f.candidate});assert.deepEqual(observation.sourceAdmission,{status:'SUPPORTED',requiredColumns:[...(fields.legacyLogin?['user_profile_identities.canonical_login']:[]),...(fields.legacyRole?['user_profiles.role']:[])]});assert.equal(treeIdentity(f.candidate),before);assert.doesNotMatch(JSON.stringify(observation),/synthetic-person|Synthetic record|synthetic@example|appVersion|schemaVersion|agentId|schema_version/);}finally{f.close();}}
});
test('private-copy source admission blocks wrong primary ownership metadata without exposing it',sdkOptions,()=>{
 for(const [column,value] of [['app_version','PRIVATE_OLD_BUILD_VALUE'],['role','PRIVATE_WRONG_OWNER'],['schema_version',16]]){const f=fixture();try{const file=seedCurrent(f),db=new DatabaseSync(file);db.prepare('UPDATE schema_meta SET '+column+'=? WHERE meta_key=\'primary\'').run(value);db.close();const before=treeIdentity(f.candidate),observation=observeStateSchema({profileDir:f.candidate});assert.deepEqual(observation.sourceAdmission,{status:'BLOCKED',code:'SETUP_RUNTIME_SQLITE_SECURITY_INVALID'});assert.equal(treeIdentity(f.candidate),before);assert.doesNotMatch(JSON.stringify(observation),/PRIVATE_OLD_BUILD_VALUE|PRIVATE_WRONG_OWNER|synthetic-person|Synthetic record|synthetic@example/);}finally{f.close();}}
});
test('private-copy source admission blocks an unsupported SQLite header',sdkOptions,()=>{
 const f=fixture();try{const file=seedCurrent(f),db=new DatabaseSync(file);db.exec('PRAGMA user_version=16');db.close();const before=treeIdentity(f.candidate),observation=observeStateSchema({profileDir:f.candidate});assert.equal(observation.userVersion,16);assert.deepEqual(observation.sourceAdmission,{status:'BLOCKED',code:'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED'});assert.equal(treeIdentity(f.candidate),before);}finally{f.close();}
});

function makeFresh(f){fs.rmSync(f.profileDir,{recursive:true});Object.assign(f.record,{installationTrack:'clean-install',baseIdentity:null,previousExisted:false});f.save();}
test('production initializer refuses an existing-profile transaction before runtime selection',()=>{const f=fixture();try{assert.throws(()=>initializeFreshCandidateState(f.options),/^Error: SETUP_CLEAN_INSTALL_REQUIRED$/);assert.equal(fs.readFileSync(path.join(f.profileDir,'journal.txt'),'utf8'),'Original machine history');}finally{f.close();}});
test('production current-schema initialization uses the pinned SDK with no predecessor',sdkOptions,()=>{const f=fixture();try{makeFresh(f);const receipt=initializeFreshCandidateState({...f.options,runtime:runtime(f),run:spawnSync});assert.equal(receipt.verified,true);assert.equal(receipt.ownerProfileCreated,true);assert.deepEqual(receipt.addedColumns,[]);assert.equal(fs.existsSync(f.profileDir),false);assert.equal(f.record.baseIdentity,null);finish(f,receipt);}finally{f.close();}});
for(const entry of [initializeFreshCandidateState,prepareCandidateState])test('clean transaction rejects legacy schema through '+entry.name+' without migrating it',sdkOptions,()=>{const f=fixture();try{const file=seedCurrent(f,{legacyRole:true,legacyLogin:true});makeFresh(f);const before=fs.readFileSync(file),identity=treeIdentity(f.candidate);assert.throws(()=>entry({...f.options,runtime:runtime(f),run:spawnSync}),/^Error: SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED$/);assert.deepEqual(fs.readFileSync(file),before);assert.equal(treeIdentity(f.candidate),identity);assert.equal(fs.existsSync(f.profileDir),false);}finally{f.close();}});
