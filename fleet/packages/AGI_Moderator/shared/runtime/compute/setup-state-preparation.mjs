import {withPrivateTemporary} from './setup-private-temp.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {inspectExecutable,runtimeOwnerChecker} from './runtime-env.mjs';
import {verifyRuntimeArtifact,runtimeArtifactLock} from './runtime-artifacts.mjs';
import {treeIdentity} from './setup-transaction.mjs';
import {sqliteSchemaPreflight,sqliteSecurityProjection} from './setup-runtime-sqlite.mjs';

const VERSION='2026.9.5',RELATIVE='state/openclaw.sqlite',CODE='SETUP_STATE_PREPARATION_FAILED';
const MARKER='state-preparation-in-progress.json',SAVED_RECEIPT='state-preparation-receipt.json';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const need=(value,code=CODE)=>{if(!value)throw Error(code);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof Uint8Array);
const canonical=value=>typeof value==='bigint'?JSON.stringify({integer:String(value)}):value instanceof Uint8Array?JSON.stringify({blob:Buffer.from(value).toString('hex')}):Array.isArray(value)?'['+value.map(canonical).join(',')+']':object(value)?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const within=(parent,child)=>parent===child||child.startsWith(parent+path.sep);
const present=file=>fs.existsSync(file);
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const modules={state:'dist/openclaw-state-db-BGE_KP3L.mjs',userSchema:'dist/user-profiles-internal-Cxw4xGme.mjs',users:'dist/user-profiles-sKCT5VNF.mjs',host:'dist/github-user-identity-C3amE1qB.mjs'};
const receiptKeys=['schema','protocolVersion','openclawVersion','sourceSchemaSha256','destinationSchemaSha256','sourceContentSha256','destinationContentSha256','sourceObjectCount','destinationObjectCount','sourceRowCount','destinationRowCount','addedSchemaObjects','addedColumns','ownerProfileCreated','ownerIdentityCreated','ownerDisplayNameInitialized','ownerDisplayNameSource','existingRecordsPreserved','verified'].sort();
const sourceOnlyCodes=new Set(['SETUP_CLEAN_INSTALL_REQUIRED','SETUP_RUNTIME_SQLITE_PATH_UNSUPPORTED','SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED','SETUP_RUNTIME_SQLITE_SECURITY_INVALID','SETUP_RUNTIME_SQLITE_READ_FAILED','SETUP_STATE_OWNER_REQUIRED','SETUP_STATE_FILE_UNSUPPORTED','SETUP_PROFILE_CHANGED',CODE,'SETUP_STATE_PREPARATION_RECORDS_CHANGED']);
function owned(file,{directory=false}={}){const s=fs.lstatSync(file);need(!s.isSymbolicLink()&&(!process.getuid||s.uid===process.getuid())&&(directory?s.isDirectory():s.isFile()),'SETUP_STATE_OWNER_REQUIRED');need(!(s.mode&0o077)&&(directory||s.nlink===1),'SETUP_STATE_OWNER_REQUIRED');return s;}
function candidateContext(input){
 need(typeof input.candidate==='string'&&typeof input.profileDir==='string'&&path.isAbsolute(input.candidate)&&path.isAbsolute(input.profileDir));
 const candidate=path.resolve(input.candidate),profileDir=path.resolve(input.profileDir),directory=path.dirname(candidate);
 need(!within(candidate,profileDir)&&!within(profileDir,candidate)&&path.basename(candidate)==='candidate');
 owned(directory,{directory:true});owned(candidate,{directory:true});need(fs.realpathSync(directory)===directory&&fs.realpathSync(candidate)===candidate);
 const file=path.join(directory,'transaction.json');owned(file);const state=JSON.parse(fs.readFileSync(file,'utf8'));
 need(state.schema===1&&state.treeIdentityVersion===3&&state.stagingProtocolVersion===2&&state.preparationProtocolVersion===1&&state.state==='prepared'&&state.profileDir===profileDir&&typeof state.id==='string'&&(!input.transactionId||input.transactionId===state.id));
 owned(path.join(candidate,'openclaw.json'));treeIdentity(candidate);
 const fresh=['clean-install','standard-install'].includes(state.installationTrack);
 if(fresh)need(state.previousExisted===false&&state.baseIdentity===null&&!fs.lstatSync(profileDir,{throwIfNoEntry:false}),'SETUP_CLEAN_INSTALL_REQUIRED');
 return {candidate,profileDir,transactionId:state.id,baseIdentity:state.baseIdentity,fresh};
}
function syncDirectory(directory){const fd=fs.openSync(directory,fs.constants.O_RDONLY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function savePrivate(file,value){const bytes=JSON.stringify(value)+'\n',fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDirectory(path.dirname(file));}
function readPrivate(file){owned(file);return JSON.parse(fs.readFileSync(file,'utf8'));}
function pinnedModules(packageRoot){
 need(typeof packageRoot==='string'&&path.isAbsolute(packageRoot)&&fs.realpathSync(packageRoot)===packageRoot);
 const manifest=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));need(manifest.name==='openclaw'&&manifest.version===VERSION&&manifest.openclaw?.schemaVersions?.state===17);
 const bytes=fs.readFileSync(new URL('./openclaw-2026.9.5.inventory.json',import.meta.url));need(sha(bytes)===runtimeArtifactLock.openclaw.inventorySHA256);const inventory=JSON.parse(bytes),resolved={};
 for(const [name,relative] of Object.entries(modules)){const file=path.join(packageRoot,relative),stat=fs.lstatSync(file),expected=inventory.files[relative];need(expected&&stat.isFile()&&!stat.isSymbolicLink()&&fs.realpathSync(file)===file&&stat.size===expected.bytes&&sha(fs.readFileSync(file))===expected.sha256);resolved[name]=file;}
 return resolved;
}
function childEnvironment(runtime,context){return {HOME:context.candidate,PATH:[path.dirname(runtime.node),'/usr/bin','/bin','/usr/sbin','/sbin'].join(path.delimiter),LANG:'en_US.UTF-8',NODE_NO_WARNINGS:'1',OPENCLAW_STATE_DIR:context.candidate,OPENCLAW_CONFIG_PATH:path.join(context.candidate,'openclaw.json'),OPENCLAW_EXEC_SHELL_SNAPSHOT:'0'};}
function nonStateIdentity(root){
 const rows=[];function walk(directory){for(const name of fs.readdirSync(directory).sort()){const file=path.join(directory,name),relative=path.relative(root,file),s=fs.lstatSync(file);
  if(directory===root&&name==='plugin-skills'){need(s.isDirectory()&&!s.isSymbolicLink(),'SETUP_STATE_OWNER_REQUIRED');continue;}
  if(relative===RELATIVE||['-wal','-shm','-journal'].some(suffix=>relative===RELATIVE+suffix))continue;
  need(!s.isSymbolicLink()&&(s.isFile()||s.isDirectory()),'SETUP_STATE_FILE_UNSUPPORTED');
  if(s.isDirectory()){if(relative!=='state')rows.push([relative,'directory']);walk(file);}else rows.push([relative,s.mode&0o777,sha(fs.readFileSync(file))]);
 }}walk(root);return sha(canonical(rows));
}
function snapshot(file){
 if(!present(file))return {objects:[],tables:{},schemaDigest:sha(canonical([])),contentDigest:sha(canonical({})),rowCount:0};
 owned(path.dirname(file),{directory:true});owned(file);const db=new DatabaseSync(file,{readOnly:true,allowExtension:false});
 try{db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN');const objects=db.prepare('SELECT type,name,tbl_name AS tableName,sql FROM sqlite_schema ORDER BY type,name').all(),tables={};let bytes=0,rowCount=0;
  for(const {name} of objects.filter(entry=>entry.type==='table')){const columns=db.prepare('PRAGMA table_xinfo('+quote(name)+')').all().map(column=>column.name);const query=db.prepare('SELECT * FROM '+quote(name));query.setReadBigInts(true);const rows=query.all();need(rows.length<=100000);rowCount+=rows.length;bytes+=Buffer.byteLength(canonical(rows));need(bytes<=64*1024*1024);tables[name]={columns,rows};}
  db.exec('ROLLBACK');return {objects,tables,schemaDigest:sha(canonical(objects)),contentDigest:sha(canonical(tables)),rowCount};
 }finally{db.close();}
}
function rowOrder(rows){return rows.map(canonical).sort();}
function provePreserved(before,after,displayName){
 const profilesBefore=before.tables.user_profiles?.rows??[],identitiesBefore=before.tables.user_profile_identities?.rows??[];
 const ownerBefore=profilesBefore.find(row=>row.id==='gateway-owner'),ownerIdentityBefore=identitiesBefore.find(row=>row.provider==='gateway.local'&&row.subject==='owner');
 const identifiedBefore=ownerIdentityBefore?profilesBefore.find(row=>row.id===ownerIdentityBefore.profile_id):undefined;
 need(!ownerIdentityBefore||identifiedBefore,'SETUP_STATE_PREPARATION_RECORDS_CHANGED');
 need(!ownerBefore?.merged_into&&!identifiedBefore?.merged_into&&(!ownerBefore||!identifiedBefore||ownerBefore.id===identifiedBefore.id),'SETUP_STATE_PREPARATION_RECORDS_CHANGED');
 const existingOwner=ownerBefore??identifiedBefore,ownerId=existingOwner?.id??'gateway-owner';
 const expectedDisplay=existingOwner?(existingOwner.display_name?.trim()||!displayName?existingOwner.display_name:displayName):displayName;
 const changedDisplay=Boolean(existingOwner&&expectedDisplay!==existingOwner.display_name);
 for(const [table,original] of Object.entries(before.tables)){
  const destination=after.tables[table];need(destination,'SETUP_STATE_PREPARATION_RECORDS_CHANGED');const newColumns=destination.columns.filter(column=>!original.columns.includes(column));
  need(newColumns.every(column=>(table==='user_profiles'&&column==='role')||(table==='user_profile_identities'&&column==='canonical_login')),'SETUP_STATE_PREPARATION_RECORDS_CHANGED');
  need(original.columns.every(column=>destination.columns.includes(column)),'SETUP_STATE_PREPARATION_RECORDS_CHANGED');
  for(const row of destination.rows)for(const column of newColumns)need(row[column]===null,'SETUP_STATE_PREPARATION_RECORDS_CHANGED');
  let relevant=destination.rows;
  if(table==='user_profiles'&&!existingOwner)relevant=relevant.filter(row=>row.id!==ownerId);
  if(table==='user_profile_identities'&&!ownerIdentityBefore)relevant=relevant.filter(row=>!(row.provider==='gateway.local'&&row.subject==='owner'));
  const projected=relevant.map(row=>{const copy=Object.fromEntries(original.columns.map(column=>[column,row[column]]));if(table==='user_profiles'&&changedDisplay&&row.id===ownerId){need(row.display_name===expectedDisplay&&typeof row.updated_at==='bigint'&&row.updated_at>=existingOwner.updated_at,'SETUP_STATE_PREPARATION_RECORDS_CHANGED');copy.display_name=existingOwner.display_name;copy.updated_at=existingOwner.updated_at;}return copy;});
  need(canonical(rowOrder(projected))===canonical(rowOrder(original.rows)),'SETUP_STATE_PREPARATION_RECORDS_CHANGED');
 }
 for(const [table,destination] of Object.entries(after.tables))if(!before.tables[table]){
  const allowed=table==='user_profiles'?destination.rows.filter(row=>row.id!=='gateway-owner'):table==='user_profile_identities'?destination.rows.filter(row=>!(row.provider==='gateway.local'&&row.subject==='owner')):destination.rows;
  // A genuinely absent shared DB receives the pinned runtime's primary owner metadata.
  const filtered=before.objects.length===0&&table==='schema_meta'?allowed.filter(row=>row.meta_key!=='primary'):allowed;
  need(filtered.length===0,'SETUP_STATE_PREPARATION_RECORDS_CHANGED');
 }
 const owner=after.tables.user_profiles?.rows.find(row=>row.id===ownerId),identity=after.tables.user_profile_identities?.rows.find(row=>row.provider==='gateway.local'&&row.subject==='owner');
 need(owner&&identity&&identity.profile_id===ownerId&&owner.merged_into===null&&owner.display_name===expectedDisplay,'SETUP_STATE_PREPARATION_RECORDS_CHANGED');
 if(!existingOwner)need(owner.id==='gateway-owner'&&owner.role===null&&owner.avatar===null&&owner.avatar_mime===null&&owner.avatar_sha256===null&&typeof owner.created_at==='bigint'&&owner.created_at===owner.updated_at,'SETUP_STATE_PREPARATION_RECORDS_CHANGED');
 if(!ownerIdentityBefore)need(identity.canonical_login===null&&typeof identity.created_at==='bigint','SETUP_STATE_PREPARATION_RECORDS_CHANGED');
 return {ownerProfileCreated:!existingOwner,ownerIdentityCreated:!ownerIdentityBefore,ownerDisplayNameInitialized:changedDisplay};
}
/** Snapshot only file bytes for diagnostics; SQLite never opens the installed source. */
export function observeStateSchema({profileDir}){
 need(typeof profileDir==='string'&&path.isAbsolute(profileDir));const root=path.resolve(profileDir),file=path.join(root,RELATIVE);
 owned(root,{directory:true});need(fs.realpathSync(root)===root,'SETUP_STATE_OWNER_REQUIRED');
 if(!fs.lstatSync(file,{throwIfNoEntry:false}))return {schema:'agi-state-schema-observation/v1',present:false};
 owned(path.dirname(file),{directory:true});
 const stateNames=new Set(JSON.parse(fs.readFileSync(new URL('./setup-runtime-sqlite-contract.json',import.meta.url),'utf8')).state.objects.map(row=>row.name));
 const snapshotStats=()=>['','-wal','-journal'].map(suffix=>{const target=file+suffix,exists=fs.lstatSync(target,{throwIfNoEntry:false});if(!exists)return {suffix,stat:null};owned(target);const stat=fs.statSync(target,{bigint:true});return {suffix,stat:Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeNs','ctimeNs'].map(key=>[key,stat[key]]))};});
 const initial=snapshotStats();need(initial[0].stat,'SETUP_PROFILE_CHANGED');for(const suffix of ['-shm'])if(fs.lstatSync(file+suffix,{throwIfNoEntry:false}))owned(file+suffix);
 need(initial.reduce((total,entry)=>total+Number(entry.stat?.size??0n),0)<=128*1024*1024);
 return withPrivateTemporary('agi-state-schema-observation-',temporary=>{let db;
 try{
  fs.mkdirSync(path.join(temporary,'state'),{mode:0o700});const copy=path.join(temporary,RELATIVE);
  for(const entry of initial){if(!entry.stat)continue;const source=file+entry.suffix,fd=fs.openSync(source,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const stat=fs.fstatSync(fd,{bigint:true});need(stat.dev===entry.stat.dev&&stat.ino===entry.stat.ino,'SETUP_PROFILE_CHANGED');fs.writeFileSync(copy+entry.suffix,fs.readFileSync(fd),{mode:0o600,flag:'wx'});}finally{fs.closeSync(fd);}}
  need(canonical(initial)===canonical(snapshotStats()),'SETUP_PROFILE_CHANGED');
  let sourceAdmission;try{const preflight=sqliteSchemaPreflight(copy,{root:temporary,profileDir:temporary,relative:RELATIVE,allowSupportedLegacyUserProfiles:true});sourceAdmission={status:'SUPPORTED',requiredColumns:preflight.legacyUserProfiles};}
  catch(error){sourceAdmission={status:'BLOCKED',code:['SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED','SETUP_RUNTIME_SQLITE_SECURITY_INVALID','SETUP_RUNTIME_SQLITE_READ_FAILED'].includes(error?.message)?error.message:'SETUP_RUNTIME_SQLITE_READ_FAILED'};}
  db=new DatabaseSync(copy,{readOnly:true,allowExtension:false});db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN');
  const rows=db.prepare('SELECT type,name,tbl_name AS tableName,sql FROM sqlite_schema ORDER BY type,name').all();need(rows.length<=2000);
  const safeName=value=>stateNames.has(value)?value:'opaque:'+sha(String(value));
  const objects=rows.map(row=>({type:['table','index','view','trigger'].includes(row.type)?row.type:'unsupported',name:safeName(row.name),tableName:safeName(row.tableName),sqlSha256:sha(row.sql??'')}));
  const userVersion=db.prepare('PRAGMA user_version').get().user_version;db.exec('ROLLBACK');
  return {schema:'agi-state-schema-observation/v1',present:true,userVersion,schemaSha256:sha(canonical(objects)),objects,sourceAdmission};
 }finally{db?.close();}
 });
}
export function isCandidateStatePreparationReceipt(receipt){
 return object(receipt)&&canonical(Object.keys(receipt).sort())===canonical(receiptKeys)&&receipt.schema==='agi-candidate-state-preparation/v1'&&receipt.protocolVersion===1&&receipt.openclawVersion===VERSION&&['sourceSchemaSha256','destinationSchemaSha256','sourceContentSha256','destinationContentSha256'].every(key=>typeof receipt[key]==='string'&&/^[a-f0-9]{64}$/.test(receipt[key]))&&['sourceObjectCount','destinationObjectCount','sourceRowCount','destinationRowCount'].every(key=>Number.isSafeInteger(receipt[key])&&receipt[key]>=0)&&Array.isArray(receipt.addedSchemaObjects)&&receipt.addedSchemaObjects.length<=1000&&new Set(receipt.addedSchemaObjects).size===receipt.addedSchemaObjects.length&&receipt.addedSchemaObjects.every(key=>/^(?:table|index):[A-Za-z0-9_]+$/.test(key))&&Array.isArray(receipt.addedColumns)&&receipt.addedColumns.length<=2&&new Set(receipt.addedColumns).size===receipt.addedColumns.length&&receipt.addedColumns.every(key=>['user_profiles.role','user_profile_identities.canonical_login'].includes(key))&&['ownerProfileCreated','ownerIdentityCreated','ownerDisplayNameInitialized'].every(key=>typeof receipt[key]==='boolean')&&['existing','host-account','local-owner-fallback'].includes(receipt.ownerDisplayNameSource)&&receipt.existingRecordsPreserved===true&&receipt.verified===true;
}
async function worker(input){
 const context=candidateContext(input);need(treeIdentity(context.profileDir)===context.baseIdentity,'SETUP_PROFILE_CHANGED');
 const file=path.join(context.candidate,RELATIVE),options={root:context.candidate,profileDir:context.profileDir,relative:RELATIVE};
 // Production accepts only the pinned current schema. Legacy admission is experimental.
 if(present(file))sqliteSchemaPreflight(file,{...options,allowSupportedLegacyUserProfiles:!context.fresh});
 const before=snapshot(file),outside=nonStateIdentity(context.candidate);
 const artifact=verifyRuntimeArtifact(path.join(input.packageRoot,'openclaw.mjs'),{allowedOwner:runtimeOwnerChecker()});need(artifact.version===VERSION&&artifact.packageRoot===input.packageRoot);
 const selected=pinnedModules(input.packageRoot),state=await import(pathToFileURL(selected.state).href),schema=await import(pathToFileURL(selected.userSchema).href),users=await import(pathToFileURL(selected.users).href),host=await import(pathToFileURL(selected.host).href);
 need(typeof state.openOpenClawStateDatabase==='function'&&typeof state.closeOpenClawStateDatabaseAsync==='function'&&typeof schema.g==='function'&&typeof schema.h==='function'&&typeof users.n==='function'&&typeof host.r==='function');
 const sdkOptions={path:file,env:{...process.env,OPENCLAW_STATE_DIR:context.candidate,OPENCLAW_CONFIG_PATH:path.join(context.candidate,'openclaw.json')}};
 let displayName,ownerDisplayNameSource;try{
  // The same bounded local account-name read is used by authenticated Gateway health.
  // No provider login, broad doctor command or service operation is invoked here.
  const hostName=await host.r();need(hostName===null||typeof hostName==='string'&&hostName.trim().length>0&&hostName.length<=256);
  displayName=hostName??'Local Gateway owner';
  const rows=before.tables.user_profiles?.rows??[],binding=before.tables.user_profile_identities?.rows.find(row=>row.provider==='gateway.local'&&row.subject==='owner');
  const existingOwner=rows.find(row=>row.id==='gateway-owner')??(binding?rows.find(row=>row.id===binding.profile_id):undefined);
  ownerDisplayNameSource=existingOwner?.display_name?.trim()?'existing':hostName?'host-account':'local-owner-fallback';
  const db=state.openOpenClawStateDatabase(sdkOptions);schema.g(sdkOptions,db);schema.h(sdkOptions,db);users.n(displayName,sdkOptions);
 }finally{await state.closeOpenClawStateDatabaseAsync();}
 const destination=sqliteSchemaPreflight(file,options);sqliteSecurityProjection(file,options);
 const after=snapshot(file),effects=provePreserved(before,after,displayName);
 need(nonStateIdentity(context.candidate)===outside,'SETUP_STATE_PREPARATION_RECORDS_CHANGED');need(treeIdentity(context.profileDir)===context.baseIdentity,'SETUP_PROFILE_CHANGED');candidateContext(context);
 const oldNames=new Set(before.objects.map(entry=>entry.type+':'+entry.name));
 const receipt={schema:'agi-candidate-state-preparation/v1',protocolVersion:1,openclawVersion:VERSION,sourceSchemaSha256:before.schemaDigest,destinationSchemaSha256:after.schemaDigest,sourceContentSha256:before.contentDigest,destinationContentSha256:after.contentDigest,sourceObjectCount:before.objects.length,destinationObjectCount:after.objects.length,sourceRowCount:before.rowCount,destinationRowCount:after.rowCount,addedSchemaObjects:after.objects.map(entry=>entry.type+':'+entry.name).filter(key=>!oldNames.has(key)).sort(),addedColumns:Object.entries(after.tables).flatMap(([table,value])=>before.tables[table]?value.columns.filter(column=>!before.tables[table].columns.includes(column)).map(column=>table+'.'+column):[]).sort(),...effects,ownerDisplayNameSource,existingRecordsPreserved:true,verified:true};
 need(destination.userVersion===17&&isCandidateStatePreparationReceipt(receipt));return receipt;
}

/** Prepare only a stopped private candidate through the pinned runtime's owner-aware APIs. */
export function finishCandidateStatePreparation({candidate,profileDir,receipt}){
 const context=candidateContext({candidate,profileDir}),directory=path.dirname(context.candidate),marker=path.join(directory,MARKER);
 need(isCandidateStatePreparationReceipt(receipt));const state=readPrivate(path.join(directory,'transaction.json'));
 need(canonical(state.preparationReceipt)===canonical(receipt)&&canonical(readPrivate(path.join(directory,SAVED_RECEIPT)))===canonical(receipt));
 const pending=readPrivate(marker);need(pending.schema==='agi-state-preparation-intent/v1'&&pending.transactionId===context.transactionId&&pending.candidate===context.candidate);
 need(treeIdentity(context.profileDir)===context.baseIdentity,'SETUP_PROFILE_CHANGED');fs.unlinkSync(marker);syncDirectory(directory);
}
export function initializeFreshCandidateState(options){
 const context=candidateContext(options);need(context.fresh===true,'SETUP_CLEAN_INSTALL_REQUIRED');
 return prepareCandidateState(options);
}
export function prepareCandidateState({runtime,candidate,profileDir,run=spawnSync}){
 try{
  const context=candidateContext({candidate,profileDir});need(treeIdentity(context.profileDir)===context.baseIdentity,'SETUP_PROFILE_CHANGED');
  const node=inspectExecutable(runtime.node,'node',{home:runtime.home}),openclaw=inspectExecutable(runtime.openclaw,'openclaw',{home:runtime.home});
  for(const [kind,actual] of [['node',node],['openclaw',openclaw]]){const expected=runtime.executableIdentity?.[kind];need(expected&&['path','realPath','uid','gid','mode','size','sha256'].every(key=>expected[key]===actual[key]));}
  const artifact=verifyRuntimeArtifact(openclaw.realPath,{allowedOwner:runtimeOwnerChecker()});need(artifact.version===VERSION);pinnedModules(artifact.packageRoot);
  const directory=path.dirname(context.candidate),marker=path.join(directory,MARKER),saved=path.join(directory,SAVED_RECEIPT);
  need(!present(marker));
  need(!present(saved));
  savePrivate(marker,{schema:'agi-state-preparation-intent/v1',transactionId:context.transactionId,candidate:context.candidate,candidateIdentity:treeIdentity(context.candidate)});
  const result=run(node.realPath,[fileURLToPath(import.meta.url),'--state-preparation-worker'],{input:JSON.stringify({...context,packageRoot:artifact.packageRoot}),env:childEnvironment({...runtime,node:node.realPath},context),cwd:context.candidate,encoding:'utf8',timeout:120000,maxBuffer:65536,shell:false});
  let response;try{response=JSON.parse(result.stdout);}catch{need(false);}
  if(result.status!==0||result.error||result.signal){const code=sourceOnlyCodes.has(response?.code)?response.code:CODE;throw Error(code);}
  need(response.ok===true&&isCandidateStatePreparationReceipt(response.receipt));candidateContext(context);need(treeIdentity(context.profileDir)===context.baseIdentity,'SETUP_PROFILE_CHANGED');savePrivate(saved,response.receipt);return response.receipt;
 }catch(error){throw Error(sourceOnlyCodes.has(error?.message)?error.message:CODE);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='--state-preparation-worker'){
 try{process.stdout.write(JSON.stringify({ok:true,receipt:await worker(JSON.parse(fs.readFileSync(0,'utf8')))}));}
 catch(error){process.stdout.write(JSON.stringify({ok:false,code:sourceOnlyCodes.has(error?.message)?error.message:CODE}));process.exitCode=1;}
}
