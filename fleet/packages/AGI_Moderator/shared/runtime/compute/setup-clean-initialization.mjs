import {roleContract,ALL_OAUTH_ROLES} from './roles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {treeIdentity} from './setup-transaction.mjs';
import {isSQLiteFile,SQLiteSnapshots} from './setup-sqlite.mjs';
import {sqliteSchemaPreflight,sqliteSecurityProjection} from './setup-runtime-sqlite.mjs';
import {inspectExecutable,runtimeOwnerChecker} from './runtime-env.mjs';
import {verifyRuntimeArtifact,runtimeArtifactLock} from './runtime-artifacts.mjs';
import {preparePinnedControlUICache} from './setup-runtime-materialization.mjs';

const VERSION='2026.9.5',STATE='state/openclaw.sqlite',KEY='config-journal-fingerprint.key';
const CODE='SETUP_CLEAN_INITIALIZATION_FAILED',CHANGED='SETUP_CLEAN_INITIALIZATION_CHANGED';
const INTENT='clean-initialization-in-progress.json',RECEIPT='clean-initialization-receipt.json';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
let currentPredicate='context-admission';
const diagnosticPredicates=new Set(['context-admission','runtime-artifact-preservation','fingerprint-preservation','schema-preservation','records-preservation','revision-key-postcondition','device-identity-postcondition','system-jobs-postcondition','bundled-discovery-postcondition','plugin-index-postcondition','machine-state-preservation','role-store-preservation','startup-contract','worker-execution','receipt-publication','owner-profile-postcondition','control-ui-preparation']);
const discoveryFacts=new Set(['absent','compat','allowlist','invalid','duplicate','implicit-compat']);
export function safeCleanInitializationDiagnostic(value){
 if(!value||value.schema!=='agi-clean-initialization-diagnostic/v1'||value.substage!=='clean-initialization'||!diagnosticPredicates.has(value.predicate))return null;
 const safe={schema:value.schema,substage:value.substage,predicate:value.predicate};
 for(const key of ['before','legacyInput','after'])if(discoveryFacts.has(value[key]))safe[key]=value[key];
 return safe;
}
function changed(predicate,facts={}){const error=Error(CHANGED);error.cleanInitializationDiagnostic=safeCleanInitializationDiagnostic({schema:'agi-clean-initialization-diagnostic/v1',substage:'clean-initialization',predicate,...facts});throw error;}
const need=(ok,code=CODE)=>{if(!ok){const error=Error(code);error.cleanInitializationDiagnostic={schema:'agi-clean-initialization-diagnostic/v1',substage:'clean-initialization',predicate:currentPredicate};throw error;}};
const checkpoint=predicate=>{currentPredicate=predicate;};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof Uint8Array);
const canonical=value=>typeof value==='bigint'?JSON.stringify({integer:String(value)}):value instanceof Uint8Array?JSON.stringify({blob:Buffer.from(value).toString('hex')}):Array.isArray(value)?'['+value.map(canonical).join(',')+']':object(value)?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const inside=(root,file)=>root===file||file.startsWith(root+path.sep);
const modules={owner:'dist/user-profiles-sKCT5VNF.mjs',ownerName:'dist/github-user-identity-C3amE1qB.mjs',revision:'dist/config-revision-token-BE5gb7qW.mjs',fingerprint:'dist/io.audit-DN55TD84.mjs',state:'dist/openclaw-state-db-BGE_KP3L.mjs',device:'dist/device-identity-CdrRT7v7.mjs',shim:'dist/openclaw-cli-shim-DM-fPovA.mjs',invocation:'dist/openclaw-cli-invocation-z1tgVDlb.mjs',media:'dist/store-SPnAoW3B.mjs',cron:'dist/server-cron-B7KzTVIW.mjs',runtimeSnapshot:'dist/runtime-snapshot-BO88rgRX.mjs',heartbeat:'dist/heartbeat-monitor-CQ3f2qMJ.mjs',skillReview:'dist/skill-collection-review-monitor-Bzwj6Qpt.mjs',version:'dist/version-ByD9iTct.mjs',startup:'dist/state-migrations.doctor-Cmeqzmnm.mjs',pluginMetadata:'dist/io.plugin-metadata-3RuaTHG2.mjs',pluginIndexWriter:'dist/installed-plugin-index-store-write-Jlo6_IfZ.mjs'};
const allowedCodes=new Set([CODE,CHANGED,'SETUP_RUNTIME_MATERIALIZATION_INVALID','SETUP_CLEAN_INSTALL_REQUIRED','SETUP_CLEAN_INITIALIZATION_INCOMPLETE','SETUP_PROFILE_CHANGED','SETUP_STATE_OWNER_REQUIRED','SETUP_STATE_FILE_UNSUPPORTED','SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED','SETUP_RUNTIME_SQLITE_SECURITY_INVALID','OPENCLAW_ARTIFACT_MISMATCH']);
const receiptKeys=['schema','protocolVersion','openclawVersion','sourceIdentity','destinationIdentity','sourceStateSchemaSha256','destinationStateSchemaSha256','sourceStateContentSha256','destinationStateContentSha256','revisionKeyCreated','fingerprintKeyCreated','revisionSchemaCreated','deviceIdentityCreated','systemJobCount','systemJobsCreated','schedulerEnabled','cliShimSha256','runtimeArtifactsPrepared','startupCheckpointCount','bundledDiscoveryInitialized','pluginIndexPrepared','pluginIndexSha256','existingRecordsPreserved','otherFilesPreserved','verified'].sort();
function owned(file,{directory=false,optional=false}={}){
 const stat=fs.lstatSync(file,{throwIfNoEntry:!optional});if(!stat)return null;
 need(!stat.isSymbolicLink()&&(!process.getuid||stat.uid===process.getuid())&&(directory?stat.isDirectory():stat.isFile()),'SETUP_STATE_OWNER_REQUIRED');
 need(!(stat.mode&0o077)&&(directory||stat.nlink===1),'SETUP_STATE_OWNER_REQUIRED');return stat;
}
function contextFor({candidate,profileDir}){
 need(typeof candidate==='string'&&typeof profileDir==='string'&&path.isAbsolute(candidate)&&path.isAbsolute(profileDir));
 candidate=path.resolve(candidate);profileDir=path.resolve(profileDir);const directory=path.dirname(candidate);
 need(path.basename(candidate)==='candidate'&&!inside(candidate,profileDir)&&!inside(profileDir,candidate));
 owned(directory,{directory:true});owned(candidate,{directory:true});need(fs.realpathSync(directory)===directory&&fs.realpathSync(candidate)===candidate,'SETUP_STATE_OWNER_REQUIRED');
 const stateFile=path.join(directory,'transaction.json');owned(stateFile);const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 need(state.schema===1&&state.treeIdentityVersion===3&&state.stagingProtocolVersion===2&&state.preparationProtocolVersion===1&&state.state==='prepared'&&state.profileDir===profileDir&&typeof state.id==='string');
 need(state.previousExisted===false&&!fs.lstatSync(profileDir,{throwIfNoEntry:false}),'SETUP_CLEAN_INSTALL_REQUIRED');
 need(treeIdentity(profileDir)===state.baseIdentity,'SETUP_PROFILE_CHANGED');treeIdentity(candidate);
 return {candidate,profileDir,directory,transactionId:state.id};
}
function syncDirectory(directory){const fd=fs.openSync(directory,fs.constants.O_RDONLY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(file,value){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDirectory(path.dirname(file));}
function pinnedModules(packageRoot){
 need(typeof packageRoot==='string'&&path.isAbsolute(packageRoot)&&fs.realpathSync(packageRoot)===packageRoot);
 const bytes=fs.readFileSync(new URL('./openclaw-2026.9.5.inventory.json',import.meta.url));need(sha(bytes)===runtimeArtifactLock.openclaw.inventorySHA256);
 const inventory=JSON.parse(bytes),result={};
 for(const [name,relative] of Object.entries(modules)){const file=path.join(packageRoot,relative),stat=fs.lstatSync(file),expected=inventory.files[relative];need(expected&&stat.isFile()&&!stat.isSymbolicLink()&&fs.realpathSync(file)===file&&stat.size===expected.bytes&&sha(fs.readFileSync(file))===expected.sha256);result[name]=file;}
 return result;
}
const quote=value=>'"'+value.replaceAll('"','""')+'"';
function stateSnapshot(file){
 owned(path.dirname(file),{directory:true});owned(file);const db=new DatabaseSync(file,{readOnly:true,allowExtension:false});
 try{
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN');
  const objects=db.prepare('SELECT type,name,tbl_name AS tableName,sql FROM sqlite_schema ORDER BY type,name').all(),tables={};let bytes=0;
  for(const item of objects.filter(value=>value.type==='table')){const query=db.prepare('SELECT * FROM '+quote(item.name));query.setReadBigInts(true);const rows=query.all();need(rows.length<=100000);bytes+=Buffer.byteLength(canonical(rows));need(bytes<=64*1024*1024);tables[item.name]=rows.map(canonical).sort();}
  const userVersion=db.prepare('PRAGMA user_version').get().user_version;
  const revision=objects.some(item=>item.name==='config_revision_keys')?db.prepare('SELECT id,hmac_key FROM config_revision_keys').all():[];
  const read=name=>objects.some(item=>item.name===name)?db.prepare('SELECT * FROM '+quote(name)).all():[];
  const devices=read('device_identities'),jobs=read('cron_jobs'),metadata=read('schema_meta'),machine=read('config_machine_state');
  db.exec('ROLLBACK');return {objects,tables,userVersion,revision,devices,jobs,metadata,machine,schemaSha256:sha(canonical(objects)),contentSha256:sha(canonical(tables))};
 }finally{db.close();}
}
function candidateSnapshot(root){
 // Whole stopped identity detects concurrent committed writes during capture.
 // SQLite sidecars are represented by their committed logical database image.
 const fullIdentity=treeIdentity(root),entries=[],agentDatabases={},snapshots=new SQLiteSnapshots();let fingerprint=null;
 try{
  function walk(directory,relative=''){
   for(const name of fs.readdirSync(directory).sort()){
    const rel=relative?relative+'/'+name:name,file=path.join(directory,name),stat=fs.lstatSync(file);
    if(rel==='plugin-skills'){owned(file,{directory:true});continue;}
    if(stat.isDirectory()){owned(file,{directory:true});entries.push([rel,'directory',stat.mode&0o777]);walk(file,rel);continue;}
    owned(file);if(rel===KEY){need(stat.size===32&&(stat.mode&0o777)===0o600,CHANGED);fingerprint=fs.readFileSync(file);continue;}
    const sidecar=['-wal','-shm','-journal'].find(suffix=>rel.endsWith(suffix)&&fs.existsSync(file.slice(0,-suffix.length))&&isSQLiteFile(file.slice(0,-suffix.length)));
    if(sidecar||rel===STATE)continue;
    if(/^agents\/agi-(?:creator|checker|reviewer|moderator|employer|evidence|recovery)\/agent\/openclaw-agent\.sqlite$/.test(rel)){entries.push([rel,'sqlite',stat.mode&0o777]);agentDatabases[rel]=stateSnapshot(file);continue;}
    entries.push([rel,'file',stat.mode&0o777,sha(isSQLiteFile(file)?snapshots.capture(file):fs.readFileSync(file))]);
   }
  }
  walk(root);const state=stateSnapshot(path.join(root,STATE)),config=JSON.parse(fs.readFileSync(path.join(root,'openclaw.json'),'utf8'));snapshots.assertStable();need(treeIdentity(root)===fullIdentity,'SETUP_PROFILE_CHANGED');
  return {fullIdentity,entries,state,fingerprint,agentDatabases,config};
 }finally{snapshots.close();}
}
/** Match the pinned runtime's migration semantics without creating machine state.
 * Existing authorized rows are preserved, including their timestamps. */
export function assertBundledDiscoveryTransition(config,beforeRows,afterRows,{implicitCompat=false}={}){
 const key='plugins.bundledDiscovery',legacy=Object.hasOwn(config.plugins??{},'bundledDiscovery')?config.plugins.bundledDiscovery:undefined;
 const old=beforeRows.filter(row=>row.state_key===key),next=afterRows?.filter(row=>row.state_key===key);
 const describe=rows=>rows?.length>1?'duplicate':!rows?.length?'absent':['"compat"','"allowlist"'].includes(rows[0].value_json)?JSON.parse(rows[0].value_json):'invalid';
 const legacyInput=legacy===undefined?(implicitCompat?'implicit-compat':'absent'):['compat','allowlist'].includes(legacy)?legacy:'invalid';
 const facts={before:describe(old),legacyInput,...(next?{after:describe(next)}:{})};
 const valid=row=>row&&['"compat"','"allowlist"'].includes(row.value_json)&&Number.isSafeInteger(row.updated_at_ms)&&row.updated_at_ms>0;
 if(legacyInput==='invalid'||old.length>1||(old.length&&!valid(old[0])))changed('bundled-discovery-postcondition',facts);
 if(!next)return;
 if(next.length>1||(next.length&&!valid(next[0])))changed('bundled-discovery-postcondition',facts);
 if(old.length){if(next.length!==1||canonical(old[0])!==canonical(next[0]))changed('bundled-discovery-postcondition',facts);return false;}
 const expected=legacy??(implicitCompat?'compat':undefined);
 if(expected===undefined){if(next.length!==0)changed('bundled-discovery-postcondition',facts);return false;}
 if(next.length!==1||next[0].value_json!==JSON.stringify(expected))changed('bundled-discovery-postcondition',facts);
 return true;
}
function proveEffects(before,after,materialized){
 checkpoint('runtime-artifact-preservation');
 const allowedArtifacts=new Map(materialized.artifacts.map(entry=>[entry[0],entry]));
 for(const entry of before.entries)if(allowedArtifacts.has(entry[0]))need(canonical(entry)===canonical(allowedArtifacts.get(entry[0])),CHANGED);
 need(canonical(before.entries.filter(entry=>!allowedArtifacts.has(entry[0])))===canonical(after.entries.filter(entry=>!allowedArtifacts.has(entry[0])))&&before.state.userVersion===after.state.userVersion,CHANGED);
 for(const entry of materialized.artifacts)need(after.entries.some(actual=>canonical(actual)===canonical(entry)),CHANGED);
 checkpoint('fingerprint-preservation');
 need(after.fingerprint?.length===32&&(!before.fingerprint||before.fingerprint.equals(after.fingerprint)),CHANGED);
 checkpoint('schema-preservation');
 const oldObjects=before.state.objects,newObjects=after.state.objects,oldRevision=oldObjects.find(value=>value.name==='config_revision_keys');
 const additions=newObjects.filter(value=>!oldObjects.some(old=>old.type===value.type&&old.name===value.name));
 const contract=JSON.parse(fs.readFileSync(new URL('./setup-runtime-sqlite-contract.json',import.meta.url),'utf8'));
 const allowed=contract.state.objects.find(value=>value.name==='config_revision_keys');
 const sql=value=>String(value??'').replace(/\s+/g,' ').replace(/\bIF NOT EXISTS\b/ig,'').replace(/\s+/g,' ').trim().replace(/;$/,'');
 need(canonical(newObjects.filter(value=>oldObjects.some(old=>old.type===value.type&&old.name===value.name)))===canonical(oldObjects),CHANGED);
 need(additions.length===(oldRevision?0:1)&&additions.every(value=>value.type==='table'&&value.name==='config_revision_keys'&&value.tableName==='config_revision_keys'&&sql(value.sql)===sql(allowed.sql)),CHANGED);
 checkpoint('records-preservation');
 for(const name of new Set([...Object.keys(before.state.tables),...Object.keys(after.state.tables)])){
  if(['config_revision_keys','device_identities','cron_jobs','config_machine_state','user_profiles','user_profile_identities'].includes(name))continue;
  need(canonical(before.state.tables[name])===canonical(after.state.tables[name]),CHANGED);
 }
 checkpoint('owner-profile-postcondition');
 for(const name of ['user_profiles','user_profile_identities']){need(canonical(after.state.tables[name])===canonical(materialized.ownerTables[name]),CHANGED);const old=(before.state.tables[name]??[]).map(JSON.parse),next=(after.state.tables[name]??[]).map(JSON.parse);const key=name==='user_profiles'?'id':'provider';
 for(const row of old.filter(r=>name==='user_profiles'?r.id!=='gateway-owner':r.provider!=='gateway.local'))need(next.some(r=>canonical(r)===canonical(row)),CHANGED);
 need(next.filter(r=>name==='user_profiles'?r.id!=='gateway-owner':r.provider!=='gateway.local').length===old.filter(r=>name==='user_profiles'?r.id!=='gateway-owner':r.provider!=='gateway.local').length,CHANGED);}
 checkpoint('revision-key-postcondition');
 const left=before.state.revision,right=after.state.revision;
 need(left.length<=1&&right.length===1&&right[0].id===1&&right[0].hmac_key instanceof Uint8Array&&right[0].hmac_key.byteLength===32,CHANGED);
 if(left.length)need(canonical(left)===canonical(right),CHANGED);
 checkpoint('device-identity-postcondition');
 need(after.state.devices.length===1,CHANGED);const device=after.state.devices[0];
 need(device.identity_key==='primary'&&Number.isSafeInteger(device.created_at_ms)&&device.created_at_ms>0&&device.updated_at_ms===device.created_at_ms,CHANGED);
 const privateKey=crypto.createPrivateKey(device.private_key_pem),publicKey=crypto.createPublicKey(device.public_key_pem),derived=crypto.createPublicKey(privateKey);
 need(privateKey.asymmetricKeyType==='ed25519'&&publicKey.asymmetricKeyType==='ed25519'&&publicKey.export({type:'spki',format:'der'}).equals(derived.export({type:'spki',format:'der'})),CHANGED);
 need(device.device_id===sha(publicKey.export({format:'jwk'}).x?Buffer.from(publicKey.export({format:'jwk'}).x,'base64url'):Buffer.alloc(0)),CHANGED);
 if(before.state.devices.length)need(canonical(before.state.devices)===canonical(after.state.devices),CHANGED);
 checkpoint('system-jobs-postcondition');
 const expectedDeclarations=new Set(materialized.jobs.map(job=>job.declarationKey));
 need(after.state.jobs.length===expectedDeclarations.size&&new Set(after.state.jobs.map(job=>job.declaration_key)).size===expectedDeclarations.size,CHANGED);
 for(const row of after.state.jobs){
  const spec=materialized.jobs.find(job=>job.declarationKey===row.declaration_key),job=JSON.parse(row.job_json);need(spec&&row.store_key===materialized.cronStore&&row.agent_id===spec.agentId&&row.payload_kind===spec.payload.kind&&row.name===spec.name&&row.enabled===Number(spec.enabled),CHANGED);
  for(const [field,value] of Object.entries(spec))need(canonical(job[field])===canonical(value),CHANGED);
  need(job.id===row.job_id&&Number.isSafeInteger(job.createdAtMs)&&job.createdAtMs>0&&Number.isSafeInteger(row.updated_at)&&row.updated_at>=job.createdAtMs&&(job.updatedAtMs===undefined||job.updatedAtMs===row.updated_at),CHANGED);
  need(Object.keys(job).every(key=>Object.hasOwn(spec,key)||['id','createdAtMs','updatedAtMs','state','deleteAfterRun','delivery','scheduledToolPolicy'].includes(key)),CHANGED);
  if(!Object.hasOwn(spec,'delivery')&&job.delivery!==undefined)need(canonical(job.delivery)===canonical({mode:'none'}),CHANGED);
  if(job.deleteAfterRun!==undefined)need(job.deleteAfterRun===false,CHANGED);
  if(job.scheduledToolPolicy!==undefined)need(canonical(job.scheduledToolPolicy)===canonical({version:1,mode:'trusted'})&&spec.payload.kind==='agentTurn',CHANGED);
  need(canonical(job.state)===canonical({})&&row.owner_agent_id===null&&row.description===null&&row.runtime_updated_at_ms===row.updated_at&&Number.isSafeInteger(row.sort_order)&&row.sort_order>=0&&row.sort_order<expectedDeclarations.size,CHANGED);
  const timer=JSON.parse(row.state_json);need(object(timer)&&Object.keys(timer).every(key=>key==='nextRunAtMs')&&Object.values(timer).every(value=>Number.isSafeInteger(value)&&value>=0),CHANGED);
  need(canonical(JSON.parse(row.schedule_identity))===canonical({version:2,enabled:spec.enabled,schedule:spec.schedule,hasTrigger:false}),CHANGED);
 }
 if(before.state.jobs.length)need(canonical(before.state.jobs)===canonical(after.state.jobs),CHANGED);
 checkpoint('bundled-discovery-postcondition');
 const discovery='plugins.bundledDiscovery',bundledDiscoveryInitialized=assertBundledDiscoveryTransition(before.config,before.state.machine,after.state.machine,{implicitCompat:materialized.discoveryImplicitCompat});
 checkpoint('plugin-index-postcondition');
 const pluginIndex='plugins.installedIndex',indexRow=after.state.machine.find(row=>row.state_key===pluginIndex);
 need(canonical(indexRow)===canonical(materialized.pluginIndexRow),CHANGED);
 checkpoint('machine-state-preservation');
 need(canonical(before.state.machine.filter(row=>![discovery,pluginIndex].includes(row.state_key)))===canonical(after.state.machine.filter(row=>![discovery,pluginIndex].includes(row.state_key))),CHANGED);
 checkpoint('role-store-preservation');
 need(canonical(Object.keys(before.agentDatabases).sort())===canonical(Object.keys(after.agentDatabases).sort()),CHANGED);let startupCheckpointCount=0;
 for(const relative of Object.keys(before.agentDatabases)){
  const old=before.agentDatabases[relative],next=after.agentDatabases[relative],role=relative.split('/')[1],key='historical-transcript-directives-v1';
  need(old.schemaSha256===next.schemaSha256&&old.userVersion===next.userVersion,CHANGED);
  for(const table of Object.keys(old.tables))if(table!=='schema_meta')need(canonical(old.tables[table])===canonical(next.tables[table]),CHANGED);
  const existing=old.metadata.find(row=>row.meta_key===key),current=next.metadata.find(row=>row.meta_key===key);
  need(current&&current.role==='agent'&&current.agent_id===role&&current.schema_version===1&&canonical(JSON.parse(current.app_version))===canonical({phase:'complete'})&&Number.isSafeInteger(current.created_at)&&current.created_at>0&&current.updated_at>=current.created_at,CHANGED);
  if(existing)need(canonical(existing)===canonical(current),CHANGED);else startupCheckpointCount++;
  need(canonical(old.metadata.filter(row=>row.meta_key!==key))===canonical(next.metadata.filter(row=>row.meta_key!==key)),CHANGED);
 }
 return {revisionKeyCreated:left.length===0,fingerprintKeyCreated:!before.fingerprint,revisionSchemaCreated:!oldRevision,deviceIdentityCreated:before.state.devices.length===0,systemJobCount:after.state.jobs.length,systemJobsCreated:before.state.jobs.length===0&&after.state.jobs.length>0,schedulerEnabled:false,cliShimSha256:materialized.cliShimSha256,runtimeArtifactsPrepared:true,startupCheckpointCount,bundledDiscoveryInitialized,pluginIndexPrepared:true,pluginIndexSha256:sha(canonical(indexRow))};
}
export function isCleanInitializationReceipt(value){
 return object(value)&&canonical(Object.keys(value).filter(key=>key!=='runtimeMaterialization').sort())===canonical(receiptKeys)&&(value.runtimeMaterialization===undefined||object(value.runtimeMaterialization)&&canonical(Object.keys(value.runtimeMaterialization).sort())===canonical(['schema','controlUICachePrepared','ownerProfilePrepared'].sort())&&value.runtimeMaterialization.schema==='agi-clean-runtime-materialization/v1'&&value.runtimeMaterialization.controlUICachePrepared===true&&value.runtimeMaterialization.ownerProfilePrepared===true)&&value.schema==='agi-clean-initialization/v1'&&value.protocolVersion===1&&value.openclawVersion===VERSION&&['sourceIdentity','destinationIdentity','sourceStateSchemaSha256','destinationStateSchemaSha256','sourceStateContentSha256','destinationStateContentSha256','cliShimSha256','pluginIndexSha256'].every(key=>typeof value[key]==='string'&&/^[a-f0-9]{64}$/.test(value[key]))&&['revisionKeyCreated','fingerprintKeyCreated','revisionSchemaCreated','deviceIdentityCreated','systemJobsCreated','bundledDiscoveryInitialized'].every(key=>typeof value[key]==='boolean')&&Number.isSafeInteger(value.systemJobCount)&&value.systemJobCount>=0&&value.systemJobCount<=6&&Number.isSafeInteger(value.startupCheckpointCount)&&value.startupCheckpointCount>=0&&value.startupCheckpointCount<=3&&value.pluginIndexPrepared===true&&value.schedulerEnabled===false&&value.runtimeArtifactsPrepared===true&&value.existingRecordsPreserved===true&&value.otherFilesPreserved===true&&value.verified===true;
}
async function initializeRuntimeArtifacts(context,input,selected,state){
 const load=name=>import(pathToFileURL(selected[name]).href),config=JSON.parse(fs.readFileSync(path.join(context.candidate,'openclaw.json'),'utf8')),settings=JSON.parse(fs.readFileSync(path.join(context.candidate,'compute-settings.json'),'utf8'));
 need(config.cron?.enabled===false&&[undefined,path.join(context.profileDir,'cron/jobs.json')].includes(config.cron?.store));
 const profile=roleContract(settings.role).profile,heap=settings.gatewayHeapMiB??4096;
 need(profile&&settings.profileDir===context.profileDir&&Number.isInteger(heap)&&heap>=128&&heap<=16384);
 const roleIds=Object.keys(config.agents?.entries??{});need(roleIds.length>=1&&roleIds.length<=3&&roleIds.every(role=>ALL_OAUTH_ROLES.includes(role)));
 checkpoint('startup-contract');
 const version=await load('version');
 const discoveryImplicitCompat=Array.isArray(config.plugins?.allow)&&config.plugins.allow.length>0&&(typeof config.meta?.lastTouchedVersion!=='string'||version.t(config.meta.lastTouchedVersion,'2026.7.2')===-1);
 assertBundledDiscoveryTransition(config,stateSnapshot(path.join(context.candidate,STATE)).machine,undefined,{implicitCompat:discoveryImplicitCompat});
 const startup=await load('startup');const startupResult=await startup.t({cfg:config,env:process.env,homedir:()=>context.candidate,log:{info:()=>{},warn:()=>{},error:()=>{},debug:()=>{}}});need(startupResult?.mode==='automatic'&&Array.isArray(startupResult.warnings)&&startupResult.warnings.length===0);
 const device=await load('device');device.r({path:path.join(context.candidate,STATE),env:process.env});
 checkpoint('owner-profile-postcondition');
 const owner=await load('owner'),ownerName=await load('ownerName');const local=owner.n(await ownerName.r(),{path:path.join(context.candidate,STATE),env:process.env});need(local.id==='gateway-owner'&&local.mergedInto===null&&local.role===undefined,CHANGED);await state.closeOpenClawStateDatabaseAsync();
 const ownerTables=stateSnapshot(path.join(context.candidate,STATE)).tables;
 const shim=await load('shim'),invocation=await load('invocation'),node=process.execPath,entry=path.join(input.packageRoot,'openclaw.mjs');
 const args=invocation.n([],{execPath:node,argv1:entry,execArgv:['--max-old-space-size='+heap]});
 need(args.command===node&&canonical(args.args)===canonical(['--max-old-space-size='+heap,entry])&&args.env===undefined);
 const quote=value=>/^[A-Za-z0-9_@%+=:,./-]+$/u.test(value)?value:"'"+value.replaceAll("'","'\\''")+"'";
 const expectedShim='\x23!/bin/sh\nset -eu\n\nexec '+[node,'--max-old-space-size='+heap,entry,'--profile',profile].map(quote).join(' ')+' "$@"\n';
 const shimPath=path.join(context.candidate,'tmp/agent-cli/openclaw');if(fs.lstatSync(shimPath,{throwIfNoEntry:false})){owned(shimPath);need(fs.readFileSync(shimPath,'utf8')===expectedShim,CHANGED);}
 await shim.r({env:{...process.env,OPENCLAW_PROFILE:profile},stateDir:context.candidate,invocation:args,platform:process.platform});
 need(fs.readFileSync(path.join(context.candidate,'tmp/agent-cli/openclaw'),'utf8')===expectedShim,CHANGED);
 const mediaRoot=path.join(context.candidate,'media');
 if(fs.lstatSync(mediaRoot,{throwIfNoEntry:false})){owned(mediaRoot,{directory:true});for(const name of fs.readdirSync(mediaRoot)){need(['outbound','playback-transcode'].includes(name),CHANGED);const directory=path.join(mediaRoot,name);owned(directory,{directory:true});need(fs.readdirSync(directory).length===0,CHANGED);}}
 const media=await load('media');await media.a();await media.c();await media.l();
 const runtimeSnapshot=await load('runtimeSnapshot'),cronModule=await load('cron'),heartbeat=await load('heartbeat'),skillReview=await load('skillReview');
 const cronStore=path.join(context.profileDir,'cron/jobs.json'),stagedConfig=structuredClone(config);stagedConfig.cron.store=cronStore;runtimeSnapshot.O(stagedConfig,stagedConfig);
 let cron;let jobs;
 try{
  jobs=[...heartbeat.i(stagedConfig,[]).specs,...skillReview.t(stagedConfig,[])].map(spec=>spec.input);
  need(jobs.length<=6&&jobs.every(job=>roleIds.includes(job.agentId)));
  cron=cronModule.buildGatewayCronService({cfg:stagedConfig,env:process.env,broadcast:()=>{},resolveGatewayContext:()=>undefined});
  need(await cron.reconcileSystemJobs()==='converged');
 }finally{await cron?.cron.stopAndDrain();runtimeSnapshot.n();await state.closeOpenClawStateDatabaseAsync();}
 // Canonical config loading uses the config-wide registry (all configured
 // workspaces), whose primary workspace matches the pinned Gateway's selection.
 // Only exact private-root path values are rebound for the future atomic publish.
 // The complete resulting authority-bearing index remains sealed and reviewed.
 const metadata=await load('pluginMetadata'),writer=await load('pluginIndexWriter');
 const sourceIndex=metadata.r({config,env:process.env,allowCurrent:false}).registryIndex;
 need(object(sourceIndex)&&sourceIndex.version===1&&sourceIndex.hostContractVersion===VERSION&&sourceIndex.migrationVersion===1&&Array.isArray(sourceIndex.plugins)&&object(sourceIndex.installRecords)&&Array.isArray(sourceIndex.diagnostics));
 const rebase=value=>typeof value==='string'&&inside(context.candidate,value)?context.profileDir+value.slice(context.candidate.length):Array.isArray(value)?value.map(rebase):object(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,rebase(item)])):value;
 const expectedIndex=rebase(sourceIndex);
 await writer.i(expectedIndex,{env:process.env});await state.closeOpenClawStateDatabaseAsync();
 const indexDatabase=new DatabaseSync(path.join(context.candidate,STATE),{readOnly:true,allowExtension:false});let pluginIndexRow;
 try{pluginIndexRow=indexDatabase.prepare("SELECT * FROM config_machine_state WHERE state_key='plugins.installedIndex'").get();}finally{indexDatabase.close();}
 const persisted=JSON.parse(pluginIndexRow?.value_json??'null');
 need(object(persisted)&&canonical(Object.keys(persisted).sort())===canonical(['index','revision'])&&Number.isSafeInteger(persisted.revision)&&persisted.revision>0&&pluginIndexRow.updated_at_ms===persisted.revision,CHANGED);
 const warning='DO NOT EDIT. This file is generated by OpenClaw from plugin manifests, install records, and config policy. Use `openclaw plugins registry --refresh`, `openclaw plugins install/update/uninstall`, or `openclaw plugins enable/disable` instead.';
 need(canonical(persisted.index)===canonical({...expectedIndex,warning}),CHANGED);
 const uid=process.getuid?.();need(Number.isSafeInteger(uid)&&uid>=0);
 const runtimeDirectory='tmp/openclaw-'+uid,coordinators=[...new Set([context.candidate,context.profileDir].flatMap(root=>[runtimeDirectory+'/device-identity.'+sha(path.join(root,STATE)).slice(0,8)+'.lock.sqlite',runtimeDirectory+'/gateway.'+sha(path.join(root,'openclaw.json')).slice(0,8)+'.lock.sqlite'])) ,runtimeDirectory+'/gateway.state.lock.sqlite'];
 for(const relative of coordinators){const file=path.join(context.candidate,relative);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});if(!fs.existsSync(file))fs.writeFileSync(file,'',{flag:'wx',mode:0o600});need(owned(file).size===0,CHANGED);}
 const directories=['media','media/outbound','media/playback-transcode','tmp','tmp/agent-cli',runtimeDirectory],artifacts=directories.map(relative=>[relative,'directory',0o700]);
 for(const relative of directories)need((owned(path.join(context.candidate,relative),{directory:true}).mode&0o777)===0o700,CHANGED);
 checkpoint('control-ui-preparation');artifacts.push(...preparePinnedControlUICache(context.candidate,input.packageRoot));
 artifacts.push(['tmp/agent-cli/openclaw','file',0o700,sha(expectedShim)],...coordinators.map(relative=>[relative,'file',0o600,sha('')]));
 return {artifacts,jobs,cronStore,cliShimSha256:sha(expectedShim),pluginIndexRow,discoveryImplicitCompat,ownerTables};
}
async function worker(input){
 checkpoint('context-admission');
 process.umask(0o077);
 const context=contextFor(input),file=path.join(context.candidate,STATE),options={root:context.candidate,profileDir:context.profileDir,relative:STATE};
 sqliteSchemaPreflight(file,options);const before=candidateSnapshot(context.candidate);
 const artifact=verifyRuntimeArtifact(path.join(input.packageRoot,'openclaw.mjs'),{allowedOwner:runtimeOwnerChecker()});need(artifact.version===VERSION&&artifact.packageRoot===input.packageRoot);
 const selected=pinnedModules(input.packageRoot),revision=await import(pathToFileURL(selected.revision).href),fingerprint=await import(pathToFileURL(selected.fingerprint).href),state=await import(pathToFileURL(selected.state).href);
 need(typeof revision.t==='function'&&typeof fingerprint._==='function'&&typeof state.closeOpenClawStateDatabaseAsync==='function');
 let materialized;
 try{
  // The same narrow pinned functions called by Gateway startup. System job
  // definitions are reviewed while their master scheduler remains disabled;
  // no service, browser, inference, login or scheduler is started here.
  revision.t({path:file,env:process.env});
  fingerprint._(JSON.parse(fs.readFileSync(path.join(context.candidate,'openclaw.json'),'utf8')),{env:process.env,homedir:()=>context.candidate});
  materialized=await initializeRuntimeArtifacts(context,input,selected,state);
 }finally{await state.closeOpenClawStateDatabaseAsync();}
 sqliteSchemaPreflight(file,options);sqliteSecurityProjection(file,options);
 const after=candidateSnapshot(context.candidate),effects=proveEffects(before,after,materialized);contextFor(context);
 return {schema:'agi-clean-initialization/v1',protocolVersion:1,openclawVersion:VERSION,sourceIdentity:before.fullIdentity,destinationIdentity:after.fullIdentity,sourceStateSchemaSha256:before.state.schemaSha256,destinationStateSchemaSha256:after.state.schemaSha256,sourceStateContentSha256:before.state.contentSha256,destinationStateContentSha256:after.state.contentSha256,...effects,runtimeMaterialization:{schema:'agi-clean-runtime-materialization/v1',controlUICachePrepared:true,ownerProfilePrepared:true},existingRecordsPreserved:true,otherFilesPreserved:true,verified:true};
}
/** Fresh profiles only. Preparation is private and precedes the security review.
 * Interrupted initialization remains an explicit incomplete preparation; a
 * later attempt cannot silently bless its partially materialized state. */
export function prepareCleanCandidateInitialization({runtime,candidate,profileDir,run=spawnSync}){
 checkpoint('context-admission');
 try{
  const context=contextFor({candidate,profileDir}),intent=path.join(context.directory,INTENT),saved=path.join(context.directory,RECEIPT);
  need(!fs.lstatSync(intent,{throwIfNoEntry:false})&&!fs.lstatSync(saved,{throwIfNoEntry:false}),'SETUP_CLEAN_INITIALIZATION_INCOMPLETE');
  const node=inspectExecutable(runtime.node,'node',{home:runtime.home}),openclaw=inspectExecutable(runtime.openclaw,'openclaw',{home:runtime.home});
  for(const [kind,actual] of [['node',node],['openclaw',openclaw]]){const expected=runtime.executableIdentity?.[kind];need(expected&&['path','realPath','uid','gid','mode','size','sha256'].every(key=>actual[key]===expected[key]));}
  const artifact=verifyRuntimeArtifact(openclaw.realPath,{allowedOwner:runtimeOwnerChecker()});need(artifact.version===VERSION);pinnedModules(artifact.packageRoot);
  const sourceIdentity=treeIdentity(context.candidate);
  save(intent,{schema:'agi-clean-initialization-intent/v1',transactionId:context.transactionId,sourceIdentity});
  const result=run(node.realPath,[fileURLToPath(import.meta.url),'--clean-initialization-worker'],{input:JSON.stringify({...context,packageRoot:artifact.packageRoot}),env:{HOME:context.candidate,PATH:[path.dirname(node.realPath),'/usr/bin','/bin','/usr/sbin','/sbin'].join(path.delimiter),LANG:'en_US.UTF-8',NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1',OPENCLAW_STATE_DIR:context.candidate,OPENCLAW_CONFIG_PATH:path.join(context.candidate,'openclaw.json'),OPENCLAW_EXEC_SHELL_SNAPSHOT:'0'},cwd:context.candidate,encoding:'utf8',timeout:120000,maxBuffer:65536,shell:false});
  let response;try{response=JSON.parse(result.stdout);}catch{need(false);}
  if(result.status!==0||result.error||result.signal){const error=Error(allowedCodes.has(response?.code)?response.code:CODE);error.cleanInitializationDiagnostic=safeCleanInitializationDiagnostic(response?.diagnostic)??{schema:'agi-clean-initialization-diagnostic/v1',substage:'clean-initialization',predicate:'worker-execution'};throw error;}
  need(response.ok===true&&isCleanInitializationReceipt(response.receipt)&&response.receipt.sourceIdentity===sourceIdentity);
  checkpoint('receipt-publication');contextFor(context);need(treeIdentity(context.candidate)===response.receipt.destinationIdentity,'SETUP_PROFILE_CHANGED');save(saved,response.receipt);return response.receipt;
 }catch(error){const failure=Error(allowedCodes.has(error?.message)?error.message:CODE);failure.cleanInitializationDiagnostic=safeCleanInitializationDiagnostic(error?.cleanInitializationDiagnostic)??{schema:'agi-clean-initialization-diagnostic/v1',substage:'clean-initialization',predicate:'worker-execution'};throw failure;}
}
export function finishCleanCandidateInitialization({candidate,profileDir,receipt}){
 const context=contextFor({candidate,profileDir});need(isCleanInitializationReceipt(receipt));
 const stateFile=path.join(context.directory,'transaction.json'),saved=path.join(context.directory,RECEIPT),intent=path.join(context.directory,INTENT);
 for(const file of [stateFile,saved,intent])owned(file);
 const state=JSON.parse(fs.readFileSync(stateFile,'utf8')),pending=JSON.parse(fs.readFileSync(intent,'utf8'));
 need(canonical(state.cleanInitializationReceipt)===canonical(receipt)&&canonical(JSON.parse(fs.readFileSync(saved,'utf8')))===canonical(receipt));
 need(pending.schema==='agi-clean-initialization-intent/v1'&&pending.transactionId===context.transactionId&&pending.sourceIdentity===receipt.sourceIdentity);
 need(treeIdentity(context.candidate)===receipt.destinationIdentity,'SETUP_PROFILE_CHANGED');fs.unlinkSync(intent);syncDirectory(context.directory);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='--clean-initialization-worker'){
 try{process.stdout.write(JSON.stringify({ok:true,receipt:await worker(JSON.parse(fs.readFileSync(0,'utf8')))}));}
 catch(error){process.stdout.write(JSON.stringify({ok:false,code:allowedCodes.has(error?.message)?error.message:CODE,diagnostic:safeCleanInitializationDiagnostic(error?.cleanInitializationDiagnostic)}));process.exitCode=1;}
}
