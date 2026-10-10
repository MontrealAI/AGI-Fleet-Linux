import {ALL_OAUTH_ROLES} from './roles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {canonical,sha256} from '../src/util.mjs';
import {isSQLiteFile,SQLiteSnapshots} from './setup-sqlite.mjs';
import {sqliteSecurityProjection,runtimeSQLiteDiagnosticTableNames} from './setup-runtime-sqlite.mjs';

const need=(ok,code)=>{if(!ok)throw Error(code);};
const ROLES=ALL_OAUTH_ROLES;
const DATABASES=['state/openclaw.sqlite',...ROLES.map(role=>`agents/${role}/agent/openclaw-agent.sqlite`)];
const FILES=['cleanup-archive-head.json','compute-journal.json','service.log','service-error.log'];
const DIRECTORIES=['cleanup-evidence','cleanup-history','jobs','workspace/job-input','logs','outputs','commissioning-observations','public-web-sessions',...ROLES.map(role=>`agents/${role}/sessions`)];
// launchd and the pinned runtime may create non-secret logs/history with 0644
// or 0755 permissions. The enclosing profile remains 0700; these exact paths
// still enforce the baseline owner/no-other-writer/type/link constraints.
export const isRuntimeMutableFilesystemPath=relative=>FILES.includes(relative)||DIRECTORIES.some(root=>relative===root||relative.startsWith(root+'/'));
const CONTAINERS=new Set(['workspace','state','agents',...ROLES.flatMap(role=>[`agents/${role}`,`agents/${role}/agent`])]);
const derivedConfig='openclaw.json.last-good';
const cleanEmptyTransfer='tmp/node-workspace-transfer';
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const DIAGNOSTIC_SCHEMA='agi-runtime-identity-diagnostic/v1';
const DIAGNOSTIC_PHASES=new Set(['unspecified','publish-reviewed','sealed-before-readiness','completion-after-readiness','rollback-before-restore','rollback-current','rollback-restored','report-only','post-failure-stopped-observation']);
const KNOWN_PATHS=new Set([...DATABASES,...FILES,...DIRECTORIES,...CONTAINERS,'openclaw.json',derivedConfig,'compute-settings.json','agi-compute-profile.json','agi-runtime/gateway-wrapper','agi-openclaw-gateway-wrapper','agi-runtime','COMPUTE_STOP','SETUP_PENDING','plugin-skills',cleanEmptyTransfer]);
const KNOWN_TABLES=new Set(runtimeSQLiteDiagnosticTableNames());
const KNOWN_RECORDS=new Set(['primary','startup-migrations','state-migrations','authProfiles.store','authProfiles.state','auth.sharedStore','update.checkState','modelCatalog.remote','telemetry.updateCheck','gateway-restart','current']);
const DIAGNOSTIC_KINDS=new Set(['immutable-tree','config-json','executable-identity','protected-file','protected-directory','file-metadata','filesystem-object','directory-membership','derived-config','sqlite-security-projection','sqlite-logical-record','sqlite-schema','runtime-security-record']);
const DIAGNOSTIC_REASONS=new Set(['digest-mismatch','added','removed','type-changed','executable-bit-changed','derived-cache-not-equal','capture-validation-failed','projection-validation-failed','changed-during-capture','baseline-invalid','baseline-detail-unavailable','baseline-detail-invalid','restored-security-mismatch']);
const DIAGNOSTIC_FAILURES=new Set(['SETUP_AUTH_STAGING_REVIEW_INVALID','SETUP_GENERATED_RUNTIME_DIRECTORY_REQUIRED','SETUP_PROFILE_CHANGED','SETUP_ROLLBACK_PLAN_INVALID','SETUP_ROLLBACK_RUNTIME_CHANGED','SETUP_ROLLBACK_RUNTIME_INCOMPATIBLE','SETUP_RUNTIME_GATEWAY_LOCK_INVALID','SETUP_RUNTIME_SECURITY_VERSION','SETUP_RUNTIME_SQLITE_SECURITY_INVALID','SETUP_RUNTIME_SQLITE_PATH_UNSUPPORTED','SETUP_RUNTIME_SQLITE_READ_FAILED','SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED','SETUP_STATE_FILE_UNSUPPORTED','SETUP_STATE_OWNER_REQUIRED','SETUP_SQLITE_SNAPSHOT_FAILED','SETUP_SQLITE_SNAPSHOT_UNSUPPORTED','SETUP_RUNTIME_IDENTITY_CAPTURE_FAILED','SETUP_RUNTIME_MODEL_CATALOG_INVALID','SETUP_RUNTIME_TELEMETRY_STATE_INVALID','SETUP_RUNTIME_PLUGIN_CATALOG_INVALID']);
const safePath=relative=>KNOWN_PATHS.has(relative)?{path:relative}:{pathSha256:sha256(String(relative))};
function sanitizedDelta(value){
 if(!value||typeof value!=='object'||!DIAGNOSTIC_KINDS.has(value.kind)||!DIAGNOSTIC_REASONS.has(value.reason))return null;
 const result={kind:value.kind,reason:value.reason,beforeSha256:hex(value.beforeSha256)?value.beforeSha256:null,afterSha256:hex(value.afterSha256)?value.afterSha256:null};
 if(typeof value.path==='string')Object.assign(result,safePath(value.path));else if(hex(value.pathSha256))result.pathSha256=value.pathSha256;
 if(typeof value.table==='string'){if(KNOWN_TABLES.has(value.table))result.table=value.table;else result.tableSha256=sha256(value.table);}else if(hex(value.tableSha256))result.tableSha256=value.tableSha256;
 if(KNOWN_RECORDS.has(value.logicalRecord))result.logicalRecord=value.logicalRecord;
 if(hex(value.recordKeySha256))result.recordKeySha256=value.recordKeySha256;
 if(['bound','advisory-unbound','observed-same-capture','unavailable'].includes(value.baselineTrust))result.baselineTrust=value.baselineTrust;
 if(value.comparisonBasis==='current-config-versus-current-cache')result.comparisonBasis=value.comparisonBasis;
 return result;
}
function safeAggregate(value){
 if(!value||typeof value!=='object')return null;
 const sqliteSecurityDigests={};for(const relative of DATABASES)if(hex(value.sqliteSecurityDigests?.[relative]))sqliteSecurityDigests[relative]=value.sqliteSecurityDigests[relative];
 return {digest:hex(value.digest)?value.digest:null,immutableDigest:hex(value.immutableDigest)?value.immutableDigest:null,sqliteSecurityDigests};
}
/** Whitelist diagnostics before saving or exporting. No contract, raw paths,
 * file contents, SQL, SQLite values, error text or credentials are admitted. */
export function safeRuntimeIdentityDiagnostic(value){
 if(!value||value.schema!==DIAGNOSTIC_SCHEMA)return null;
 return {schema:DIAGNOSTIC_SCHEMA,phase:DIAGNOSTIC_PHASES.has(value.phase)?value.phase:'unspecified',expected:safeAggregate(value.expected),actual:safeAggregate(value.actual),deltas:Array.isArray(value.deltas)?value.deltas.slice(0,256).map(sanitizedDelta).filter(Boolean):[],captureFailureCode:DIAGNOSTIC_FAILURES.has(value.captureFailureCode)?value.captureFailureCode:value.captureFailureCode?'SETUP_RUNTIME_IDENTITY_CAPTURE_FAILED':null,legacyBaselineDetailAvailable:value.legacyBaselineDetailAvailable===true,componentBaselineTrust:['immutable-bound-sqlite-advisory','unavailable','invalid'].includes(value.componentBaselineTrust)?value.componentBaselineTrust:'unavailable',captureComplete:value.captureComplete===true,deltasTruncated:value.deltasTruncated===true};
}
function immutableDetails(record){
 const entries=record?.diagnosticDetails?.immutableEntries;
 if(!Array.isArray(entries)||entries.length>100000)return null;
 const valid=entries.every(entry=>Array.isArray(entry)&&typeof entry[0]==='string'&&entry[0].length>0&&entry[0].length<=4096&&!path.isAbsolute(entry[0])&&!entry[0].split('/').some(part=>!part||part==='.'||part==='..')&&(entry.length===2&&entry[1]==='directory'||entry.length===4&&entry[1]==='file'&&typeof entry[2]==='boolean'&&hex(entry[3])));
 if(!valid||new Set(entries.map(entry=>entry[0])).size!==entries.length||sha256(canonical([...entries].sort((a,b)=>a[0].localeCompare(b[0]))))!==record.immutableDigest)return null;
 return entries;
}
function entryKind(entry){return entry?.[1]==='directory'?'protected-directory':entry?.[2]?'executable-identity':['openclaw.json','compute-settings.json','agi-compute-profile.json'].includes(entry?.[0])?'config-json':'protected-file';}
function entrySha(entry){return entry?.[1]==='file'?entry[3]:entry?sha256(canonical(entry)):null;}
function boundedDetails(entries,sqlite){
 const details={schema:'agi-runtime-identity-components/v1',immutableEntries:entries,sqlite};
 const fits=()=>Buffer.byteLength(JSON.stringify(details))<=64*1024;
 if(fits())return details;
 details.sqlite=Object.fromEntries(Object.entries(sqlite).map(([relative,item])=>[relative,{...item,tableDigests:Object.fromEntries(Object.entries(item.tableDigests??{}).map(([table,value])=>[table,{...value,records:[],recordsTruncated:value.recordCount>0}]))}]));
 if(fits())return details;
 details.sqlite={};if(fits())return details;
 // An optional explanation must never make a previously recoverable profile
 // exceed the transaction receipt limit or become inadmissible.
 return undefined;
}
function immutableDeltas(expected,actual){
 const a=new Map(expected.map(entry=>[entry[0],entry])),b=new Map(actual.map(entry=>[entry[0],entry])),result=[];
 for(const relative of [...new Set([...a.keys(),...b.keys()])].sort()){
  const before=a.get(relative),after=b.get(relative);if(canonical(before??null)===canonical(after??null))continue;
  result.push({...safePath(relative),kind:entryKind(after??before),reason:!before?'added':!after?'removed':before[1]!==after[1]?'type-changed':before[2]!==after[2]?'executable-bit-changed':'digest-mismatch',beforeSha256:entrySha(before),afterSha256:entrySha(after),baselineTrust:'bound'});
 }
 return result;
}
function sqliteDetailDeltas(relative,before,after,{baselineTrust='advisory-unbound'}={}){
 const result=[],a=before?.tableDigests,b=after?.tableDigests;if(!a||!b)return result;
 for(const table of [...KNOWN_TABLES].sort()){
  const left=a[table],right=b[table];if(!left||!right||!hex(left.sha256)||!hex(right.sha256)||left.sha256===right.sha256)continue;
  result.push({path:relative,kind:'sqlite-security-projection',reason:'digest-mismatch',table,beforeSha256:left.sha256,afterSha256:right.sha256,baselineTrust});
  if(!Array.isArray(left.records)||!Array.isArray(right.records)||left.recordsTruncated||right.recordsTruncated||left.records.length>2048||right.records.length>2048)continue;
  const valid=rows=>rows.every(row=>row&&hex(row.keySha256)&&hex(row.sha256));if(!valid(left.records)||!valid(right.records))continue;
  const l=new Map(left.records.map(row=>[row.keySha256,row])),r=new Map(right.records.map(row=>[row.keySha256,row]));
  if(l.size!==left.records.length||r.size!==right.records.length)continue;
  for(const key of [...new Set([...l.keys(),...r.keys()])].sort()){
   const old=l.get(key),next=r.get(key);if(old?.sha256===next?.sha256)continue;
   result.push({path:relative,kind:'sqlite-logical-record',reason:!old?'added':!next?'removed':'digest-mismatch',table,recordKeySha256:key,logicalRecord:next?.logicalRecord??old?.logicalRecord,beforeSha256:old?.sha256??null,afterSha256:next?.sha256??null,baselineTrust});
  }
 }
 return result;
}
function diagnosticFor(record,actual,error,{phase='unspecified'}={}){
 const baseline=immutableDetails(record),current=immutableDetails(actual),deltas=[];
 if(error?.runtimeIdentityDetail)deltas.push(error.runtimeIdentityDetail);
 if(Array.isArray(error?.runtimeIdentityDeltas))deltas.push(...error.runtimeIdentityDeltas);
 if(record&&actual?.immutableDigest&&actual.immutableDigest!==record?.immutableDigest){
  deltas.push({kind:'immutable-tree',reason:'digest-mismatch',beforeSha256:record?.immutableDigest,afterSha256:actual.immutableDigest,baselineTrust:'bound'});
  if(baseline&&current)deltas.push(...immutableDeltas(baseline,current));
 }
 for(const relative of record?DATABASES:[]){const before=record?.sqliteSecurityDigests?.[relative],after=actual?.sqliteSecurityDigests?.[relative];if(before===after||!hex(before)&&!hex(after)||!hex(after)&&!actual?.digest)continue;
  deltas.push({path:relative,kind:'sqlite-security-projection',reason:!before?'added':!after&&actual?.digest?'removed':'digest-mismatch',beforeSha256:before,afterSha256:after,baselineTrust:'bound'});
  if(hex(before)&&hex(after))deltas.push(...sqliteDetailDeltas(relative,record?.diagnosticDetails?.sqlite?.[relative],actual?.diagnosticDetails?.sqlite?.[relative]));
 }
 if(error?.message==='SETUP_RUNTIME_SECURITY_VERSION')deltas.push({kind:'runtime-security-record',reason:'baseline-invalid',beforeSha256:null,afterSha256:null,baselineTrust:'unavailable'});
 if(record?.diagnosticDetails&&!baseline)deltas.push({kind:'immutable-tree',reason:'baseline-detail-invalid',beforeSha256:record?.immutableDigest,afterSha256:null,baselineTrust:'unavailable'});
 return safeRuntimeIdentityDiagnostic({schema:DIAGNOSTIC_SCHEMA,phase,expected:record,actual,deltas,captureFailureCode:error?.message??null,legacyBaselineDetailAvailable:Boolean(baseline),componentBaselineTrust:baseline?'immutable-bound-sqlite-advisory':record?.diagnosticDetails?'invalid':'unavailable',captureComplete:Boolean(actual?.digest),deltasTruncated:deltas.length>256});
}
const inside=(root,file)=>file===root||file.startsWith(root+path.sep);
const sidecar=relative=>DATABASES.find(base=>['-wal','-shm','-journal'].some(suffix=>relative===base+suffix));
const dynamicDirectory=relative=>DIRECTORIES.some(base=>relative===base||relative.startsWith(base+'/'));
const ignoredName=(relative,phase,cleanInstallVersion,lockNames=[])=>cleanInstallVersion===1&&(relative===cleanEmptyTransfer||lockNames.includes(relative))||FILES.includes(relative)||dynamicDirectory(relative)||relative==='COMPUTE_STOP'||relative===derivedConfig||DATABASES.includes(relative)||Boolean(sidecar(relative))||(phase==='reviewed'&&relative==='SETUP_PENDING')||relative==='plugin-skills'||CONTAINERS.has(relative);
function owned(file,{optional=false}={}){
 const s=fs.lstatSync(file,{throwIfNoEntry:!optional});if(!s)return null;
 need(!s.isSymbolicLink()&&(!process.getuid||s.uid===process.getuid()),'SETUP_STATE_OWNER_REQUIRED');
 need(s.isDirectory()||s.isFile(),'SETUP_STATE_FILE_UNSUPPORTED');
 if(s.isFile())need(s.nlink===1,'SETUP_STATE_OWNER_REQUIRED');
 need(!(s.mode&0o022),'SETUP_STATE_OWNER_REQUIRED');return s;
}
function sameFile(a,b){return a&&b&&a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid&&a.mode===b.mode&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;}
function metadataSha(stat){return stat?sha256(canonical(Object.fromEntries(['dev','ino','uid','mode','size','mtimeMs','ctimeMs'].map(key=>[key,stat[key]])))):null;}
function requireSameFile(before,after){if(sameFile(before,after))return;const error=Error('SETUP_PROFILE_CHANGED');error.runtimeIdentityDetail={kind:'file-metadata',reason:'changed-during-capture',beforeSha256:metadataSha(before),afterSha256:metadataSha(after),baselineTrust:'observed-same-capture'};throw error;}
function readStable(file){
 const before=owned(file);need(before.isFile(),'SETUP_STATE_FILE_UNSUPPORTED');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const opened=fs.fstatSync(fd);requireSameFile(before,opened);const bytes=fs.readFileSync(fd);requireSameFile(opened,fs.fstatSync(fd));requireSameFile(opened,owned(file));return {bytes,stat:opened};}
 finally{fs.closeSync(fd);}
}
function receipts(value){
 need(Array.isArray(value)&&value.length<=3,'SETUP_AUTH_STAGING_REVIEW_INVALID');const seen=new Set();
 return value.map(v=>{need(v&&Object.keys(v).sort().join(',')==='agent,order,provider,storage,verified'&&ROLES.includes(v.agent)&&!seen.has(v.agent)&&v.provider==='openai'&&canonical(v.order)===canonical(['openai:agi-compute-pro'])&&v.storage==='openclaw-agent-sqlite'&&v.verified===true,'SETUP_AUTH_STAGING_REVIEW_INVALID');seen.add(v.agent);return structuredClone(v);}).sort((a,b)=>a.agent.localeCompare(b.agent));
}
function contractFor({profileDir,authStaging=[],phase='sealed',registryAliases=[],sqliteSchemaGuards={},cleanInstallVersion,runtimeMutabilityVersion,pluginCatalogCacheVersion}){
 need(pluginCatalogCacheVersion===undefined||pluginCatalogCacheVersion===1&&runtimeMutabilityVersion===1,'SETUP_RUNTIME_SECURITY_VERSION');
 need(runtimeMutabilityVersion===undefined||runtimeMutabilityVersion===1,'SETUP_RUNTIME_SECURITY_VERSION');
 need(cleanInstallVersion===undefined||cleanInstallVersion===1,'SETUP_RUNTIME_SECURITY_VERSION');
 need(typeof profileDir==='string'&&path.isAbsolute(profileDir)&&path.resolve(profileDir)===profileDir&&['reviewed','sealed'].includes(phase),'SETUP_RUNTIME_SECURITY_VERSION');
 need(Array.isArray(registryAliases)&&registryAliases.length<=1&&registryAliases.every(alias=>typeof alias==='string'&&path.isAbsolute(alias)&&path.resolve(alias)===alias&&path.basename(alias)==='candidate'&&!inside(profileDir,alias)&&!inside(alias,profileDir)),'SETUP_RUNTIME_SECURITY_VERSION');
 need(sqliteSchemaGuards&&typeof sqliteSchemaGuards==='object'&&!Array.isArray(sqliteSchemaGuards)&&Object.keys(sqliteSchemaGuards).every(relative=>DATABASES.includes(relative)),'SETUP_RUNTIME_SECURITY_VERSION');
 const guards={};for(const relative of Object.keys(sqliteSchemaGuards).sort()){const objects=sqliteSchemaGuards[relative];need(Array.isArray(objects)&&objects.length<=2048&&objects.every(value=>typeof value==='string'&&/^(?:table|index|view|trigger):[A-Za-z0-9_]+$/.test(value))&&new Set(objects).size===objects.length&&canonical(objects)===canonical([...objects].sort()),'SETUP_RUNTIME_SECURITY_VERSION');guards[relative]=[...objects];}
 return {version:1,...(pluginCatalogCacheVersion===1?{pluginCatalogCacheVersion}:{}),...(runtimeMutabilityVersion===1?{runtimeMutabilityVersion}:{}),...(cleanInstallVersion===1?{cleanInstallVersion}:{}),profileDir,authStaging:receipts(authStaging),phase,registryAliases:[...registryAliases],sqliteSchemaGuards:guards};
}
function parseContract(value){
 need(value&&Object.keys(value).filter(key=>!['runtimeMutabilityVersion','pluginCatalogCacheVersion'].includes(key)).sort().join(',')===(value.cleanInstallVersion===undefined?'authStaging,phase,profileDir,registryAliases,sqliteSchemaGuards,version':'authStaging,cleanInstallVersion,phase,profileDir,registryAliases,sqliteSchemaGuards,version')&&value.version===1,'SETUP_RUNTIME_SECURITY_VERSION');
 const result=contractFor(value);need(canonical(result)===canonical(value),'SETUP_RUNTIME_SECURITY_VERSION');return result;
}
function requiredAuth(contract,relative){return contract.authStaging.some(receipt=>relative===`agents/${receipt.agent}/agent/openclaw-agent.sqlite`);}
function validateRuntimeTree(root){
 const s=owned(root);need(s.isDirectory(),'SETUP_STATE_FILE_UNSUPPORTED');
 for(const name of fs.readdirSync(root)){const file=path.join(root,name),item=owned(file,{optional:true});if(!item)continue;if(item.isDirectory())validateRuntimeTree(file);else need(!(item.mode&0o111),'SETUP_STATE_FILE_UNSUPPORTED');}
}
function cleanGatewayLockNames(contract){
 if(contract.cleanInstallVersion!==1)return [];
 need(typeof process.getuid==='function','SETUP_RUNTIME_GATEWAY_LOCK_INVALID');
 const prefix='tmp/openclaw-'+process.getuid()+'/';return [prefix+'gateway.'+sha256(path.join(contract.profileDir,'openclaw.json')).slice(0,8)+'.lock',prefix+'gateway.state.lock'];
}
function validateCleanGatewayLocks(root,contract,names){
 const records=[];
 for(const relative of names){
  const file=path.join(root,relative),stat=owned(file,{optional:true});if(!stat)continue;
  need(stat.isFile()&&(stat.mode&0o777)===0o600&&stat.size>0&&stat.size<=4096,'SETUP_RUNTIME_GATEWAY_LOCK_INVALID');
  const parent=owned(path.dirname(file));need(parent.isDirectory()&&(parent.mode&0o777)===0o700,'SETUP_RUNTIME_GATEWAY_LOCK_INVALID');
  let value;try{value=JSON.parse(readStable(file).bytes);}catch(error){if(/^SETUP_/.test(error?.message))throw error;throw Error('SETUP_RUNTIME_GATEWAY_LOCK_INVALID');}
  need(value&&Object.keys(value).sort().join(',')===(Object.hasOwn(value,'startTime')?'configPath,createdAt,cronOwnerProjection,ownerId,pid,port,startTime,stateDir':'configPath,createdAt,cronOwnerProjection,ownerId,pid,port,stateDir'),'SETUP_RUNTIME_GATEWAY_LOCK_INVALID');
  if(Object.hasOwn(value,'startTime'))need(typeof value.startTime==='number'&&Number.isFinite(value.startTime)&&value.startTime>0,'SETUP_RUNTIME_GATEWAY_LOCK_INVALID');
  need(Number.isSafeInteger(value.pid)&&value.pid>0&&value.pid<=2147483647&&typeof value.ownerId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.ownerId)&&value.cronOwnerProjection==='dynamic-default-v1'&&typeof value.createdAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt)&&Number.isFinite(Date.parse(value.createdAt)),'SETUP_RUNTIME_GATEWAY_LOCK_INVALID');
  need(value.configPath===path.join(contract.profileDir,'openclaw.json')&&value.stateDir===contract.profileDir&&Number.isSafeInteger(value.port)&&value.port>=1&&value.port<=65535,'SETUP_RUNTIME_GATEWAY_LOCK_INVALID');
  let config;try{config=JSON.parse(readStable(path.join(root,'openclaw.json')).bytes);}catch{throw Error('SETUP_RUNTIME_GATEWAY_LOCK_INVALID');}
  need(config?.gateway?.port===value.port,'SETUP_RUNTIME_GATEWAY_LOCK_INVALID');records.push(value);
 }
 if(records.length===2&&records.every(value=>Object.hasOwn(value,'startTime')))need(records[0].startTime===records[1].startTime,'SETUP_RUNTIME_GATEWAY_LOCK_INVALID');
 if(records.length===2)need(['pid','ownerId','cronOwnerProjection','configPath','stateDir','port'].every(key=>records[0][key]===records[1][key]),'SETUP_RUNTIME_GATEWAY_LOCK_INVALID');
}
function validateCleanEmptyTransfer(root){
 const file=path.join(root,cleanEmptyTransfer),stat=owned(file,{optional:true});if(!stat)return;
 need(stat.isDirectory()&&(stat.mode&0o777)===0o700,'SETUP_STATE_OWNER_REQUIRED');
 need(fs.readdirSync(file).length===0,'SETUP_PROFILE_CHANGED');
 const after=owned(file,{optional:true});if(after){requireSameFile(stat,after);need(after.isDirectory()&&(after.mode&0o777)===0o700,'SETUP_PROFILE_CHANGED');}
}

function validateDerived(root){
 const file=path.join(root,derivedConfig),s=owned(file,{optional:true});if(!s)return;
 need(s.isFile()&&!(s.mode&0o111),'SETUP_STATE_FILE_UNSUPPORTED');
 const cache=readStable(file),config=readStable(path.join(root,'openclaw.json'));
 if(!cache.bytes.equals(config.bytes)){const error=Error('SETUP_PROFILE_CHANGED');error.runtimeIdentityDetail={kind:'derived-config',reason:'derived-cache-not-equal',path:derivedConfig,beforeSha256:sha256(config.bytes),afterSha256:sha256(cache.bytes),baselineTrust:'observed-same-capture',comparisonBasis:'current-config-versus-current-cache'};throw error;}
}

// This identity is deliberately separate from the v3 stopped full snapshot.
// Only named runtime paths are mutable. Every other file stays immutable;
// recognized SQLite stores retain an explicit pinned logical security contract.
function captureIdentity(root,{profileDir=root,authStaging=[],phase='sealed',registryAliases=[],sqliteSchemaGuards,cleanInstallVersion,runtimeMutabilityVersion,pluginCatalogCacheVersion}={}, {restorationBase=false,componentSink,completeDiagnostics=false}={}){
 root=path.resolve(root);const contract=contractFor({profileDir,authStaging,phase,registryAliases,sqliteSchemaGuards,cleanInstallVersion,runtimeMutabilityVersion,pluginCatalogCacheVersion}),top=owned(root);need(top.isDirectory(),'SETUP_STATE_FILE_UNSUPPORTED');if(!restorationBase)need(!(top.mode&0o077),'SETUP_STATE_OWNER_REQUIRED');
 const lockNames=cleanGatewayLockNames(contract);
 const immutable=[],checkedFiles=[],checkedDirectories=[],checkedSQLiteFiles=[],sqliteSecurityDigests={},sqliteDetails={},snapshots=new SQLiteSnapshots();let currentRelative='',captureKind='filesystem-object';
 const projection=(relative)=>{
  if(sqliteSchemaGuards!==undefined)need(Object.hasOwn(contract.sqliteSchemaGuards,relative),'SETUP_PROFILE_CHANGED');
  currentRelative=relative;captureKind='sqlite-security-projection';
  const projected=sqliteSecurityProjection(path.join(root,relative),{root,relative,profileDir:contract.profileDir,allowedProfileRoots:[contract.profileDir,...contract.registryAliases],requiredSchemaObjects:contract.sqliteSchemaGuards[relative]??[],requiredOpenAIOrder:requiredAuth(contract,relative),diagnostics:true,completeDiagnostics,runtimeMutabilityVersion:contract.runtimeMutabilityVersion,pluginCatalogCacheVersion:contract.pluginCatalogCacheVersion,...(contract.runtimeMutabilityVersion===1?{approvedConfig:JSON.parse(readStable(path.join(root,'openclaw.json')).bytes)}:{})});
  if(!Object.hasOwn(contract.sqliteSchemaGuards,relative))contract.sqliteSchemaGuards[relative]=projected.schemaObjects;
  return projected;
 };
 const visit=(dir,relative='')=>{
  const names=fs.readdirSync(dir).sort();checkedDirectories.push({dir,relative,names:names.filter(name=>!ignoredName(relative?relative+'/'+name:name,phase,cleanInstallVersion,lockNames))});
  for(const name of names){
   const rel=relative?relative+'/'+name:name,file=path.join(dir,name);currentRelative=rel;captureKind='filesystem-object';const s=owned(file,{optional:true});
   if(!s){need(ignoredName(rel,phase,cleanInstallVersion,lockNames),'SETUP_PROFILE_CHANGED');continue;}
   if(lockNames.includes(rel)){validateCleanGatewayLocks(root,contract,lockNames);continue;}
   if(contract.runtimeMutabilityVersion===1&&s&&rel!=='plugin-skills'&&!isRuntimeMutableFilesystemPath(rel))need(!(s.mode&0o077),'SETUP_STATE_OWNER_REQUIRED');
   if(cleanInstallVersion===1&&rel===cleanEmptyTransfer){validateCleanEmptyTransfer(root);continue;}
   if(rel==='plugin-skills'){need(s.isDirectory(),'SETUP_GENERATED_RUNTIME_DIRECTORY_REQUIRED');continue;}
   if(rel==='COMPUTE_STOP'||phase==='reviewed'&&rel==='SETUP_PENDING'){need(s.isFile(),'SETUP_STATE_FILE_UNSUPPORTED');continue;}
   if(rel===derivedConfig)continue;
   if(DIRECTORIES.includes(rel)){need(s.isDirectory(),'SETUP_STATE_FILE_UNSUPPORTED');validateRuntimeTree(file);continue;}
   if(FILES.includes(rel)){need(s.isFile()&&!(s.mode&0o111),'SETUP_STATE_FILE_UNSUPPORTED');continue;}
   const base=sidecar(rel);if(base){need(s.isFile()&&!(s.mode&0o111),'SETUP_STATE_FILE_UNSUPPORTED');const db=owned(path.join(root,base));need(db.isFile()&&isSQLiteFile(path.join(root,base)),'SETUP_STATE_FILE_UNSUPPORTED');continue;}
   if(DATABASES.includes(rel)){need(s.isFile()&&!(s.mode&0o111)&&isSQLiteFile(file),'SETUP_STATE_FILE_UNSUPPORTED');checkedSQLiteFiles.push({file,stat:s});if(!restorationBase){const projected=projection(rel);sqliteSecurityDigests[rel]=projected.sha256;sqliteDetails[rel]=projected.diagnosticDetails;need(hex(sqliteSecurityDigests[rel]),'SETUP_RUNTIME_SQLITE_SECURITY_INVALID');}continue;}
   if(s.isDirectory()){if(!CONTAINERS.has(rel))immutable.push([rel,'directory']);visit(file,rel);continue;}
   let digest;
   if(isSQLiteFile(file))digest=sha256(snapshots.capture(file));
   else {captureKind='file-metadata';const read=readStable(file);checkedFiles.push({file,stat:read.stat});if(phase==='reviewed'&&rel==='compute-settings.json'){captureKind='config-json';let value;try{value=JSON.parse(read.bytes);}catch{throw Error('SETUP_PROFILE_CHANGED');}need(value&&typeof value==='object'&&!Array.isArray(value),'SETUP_PROFILE_CHANGED');delete value.policyHash;digest=sha256(canonical(value));}else digest=sha256(read.bytes);}
   immutable.push([rel,'file',Boolean(s.mode&0o111),digest]);
  }
 };
 try{
  visit(root);if(!restorationBase){currentRelative=derivedConfig;captureKind='derived-config';validateDerived(root);need(canonical(Object.keys(sqliteSecurityDigests).sort())===canonical(Object.keys(contract.sqliteSchemaGuards).sort()),'SETUP_PROFILE_CHANGED');}
  for(const receipt of restorationBase?[]:contract.authStaging)need(Object.hasOwn(sqliteSecurityDigests,`agents/${receipt.agent}/agent/openclaw-agent.sqlite`),'SETUP_RUNTIME_SQLITE_SECURITY_INVALID');
  // Check security projections again, not whole-database data_version: ordinary
  // committed history/usage changes may continue between these read snapshots.
  for(const [relative,digest] of Object.entries(sqliteSecurityDigests)){const second=projection(relative);if(second.sha256!==digest){const error=Error('SETUP_PROFILE_CHANGED');error.runtimeIdentityDetail={path:relative,kind:'sqlite-security-projection',reason:'changed-during-capture',beforeSha256:digest,afterSha256:second.sha256,baselineTrust:'observed-same-capture'};error.runtimeIdentityDeltas=sqliteDetailDeltas(relative,sqliteDetails[relative],second.diagnosticDetails,{baselineTrust:'observed-same-capture'});throw error;}}
  snapshots.assertStable();
  for(const {file,stat}of checkedSQLiteFiles){currentRelative=path.relative(root,file);captureKind='file-metadata';const after=owned(file);need(after.isFile()&&after.dev===stat.dev&&after.ino===stat.ino&&after.uid===stat.uid&&after.mode===stat.mode,'SETUP_PROFILE_CHANGED');}
  for(const {file,stat}of checkedFiles){currentRelative=path.relative(root,file);captureKind='file-metadata';requireSameFile(stat,owned(file,{optional:true}));}
  for(const {dir,relative,names}of checkedDirectories){currentRelative=relative;captureKind='directory-membership';need(owned(dir).isDirectory(),'SETUP_STATE_FILE_UNSUPPORTED');const current=fs.readdirSync(dir).sort().filter(name=>!ignoredName(relative?relative+'/'+name:name,phase,cleanInstallVersion,lockNames));need(canonical(current)===canonical(names),'SETUP_PROFILE_CHANGED');}
  // Recheck the type and presence of every named exception: a new or replaced
  // runtime entry must not hide behind the filtered directory listing.
  for(const relative of DATABASES){currentRelative=relative;captureKind='filesystem-object';const s=owned(path.join(root,relative),{optional:true});need(Boolean(s)===checkedSQLiteFiles.some(item=>item.file===path.join(root,relative)),'SETUP_PROFILE_CHANGED');}
  for(const relative of [...FILES,'COMPUTE_STOP',...(phase==='reviewed'?['SETUP_PENDING']:[])]){currentRelative=relative;captureKind='filesystem-object';const s=owned(path.join(root,relative),{optional:true});if(s)need(s.isFile()&&!(s.mode&0o111),'SETUP_STATE_FILE_UNSUPPORTED');}
  for(const relative of DIRECTORIES){currentRelative=relative;captureKind='filesystem-object';const file=path.join(root,relative),s=owned(file,{optional:true});if(s)validateRuntimeTree(file);}
  if(cleanInstallVersion===1){currentRelative=cleanEmptyTransfer;captureKind='filesystem-object';validateCleanEmptyTransfer(root);currentRelative='tmp/openclaw-'+process.getuid();validateCleanGatewayLocks(root,contract,lockNames);}
  currentRelative='plugin-skills';captureKind='filesystem-object';const generated=owned(path.join(root,'plugin-skills'),{optional:true});if(generated)need(generated.isDirectory(),'SETUP_GENERATED_RUNTIME_DIRECTORY_REQUIRED');
  if(!restorationBase){currentRelative=derivedConfig;captureKind='derived-config';validateDerived(root);}
  const immutableDigest=sha256(canonical(immutable.sort((a,b)=>a[0].localeCompare(b[0]))));
  if(componentSink)componentSink({immutableEntries:structuredClone(immutable),sqlite:structuredClone(sqliteDetails)});
  const diagnosticDetails=boundedDetails(immutable,sqliteDetails);
  return {version:1,digest:sha256(canonical({contract,immutableDigest,sqliteSecurityDigests})),immutableDigest,sqliteSecurityDigests,contract,...(diagnosticDetails?{diagnosticDetails}:{})};
 }catch(error){
  if(!error.runtimeIdentityDetail)error.runtimeIdentityDetail={...safePath(currentRelative),kind:captureKind,reason:error?.message==='SETUP_PROFILE_CHANGED'?'changed-during-capture':'capture-validation-failed',beforeSha256:null,afterSha256:null,baselineTrust:'unavailable'};
  else if(!error.runtimeIdentityDetail.path&&!error.runtimeIdentityDetail.pathSha256)Object.assign(error.runtimeIdentityDetail,safePath(currentRelative));
  // This is incomplete capture evidence, never an identity accepted by assert.
  error.runtimeIdentityCapture={digest:null,immutableDigest:null,sqliteSecurityDigests:{...sqliteSecurityDigests},diagnosticDetails:{schema:'agi-runtime-identity-components/v1',immutableEntries:[...immutable],sqlite:sqliteDetails}};throw error;
 }finally{snapshots.close();}
}
export function captureRuntimeSecurityIdentity(root,options={}){return captureIdentity(root,options);}
/** Internal component capture. The diagnostic worker uses disposable copies;
 * clean setup requests complete hashes for its separate private durable artifact.
 * Raw values never leave projection reads. Acceptance semantics are unchanged. */
export function captureRuntimeSecurityComponents(root,options={}, {completeDiagnostics=false}={}){
 let components;const identity=captureIdentity(root,options,{completeDiagnostics,componentSink:value=>{components=value;}});
 return {identity,components};
}
/** A pre-upgrade copy is an investigative artifact, not the sealed baseline.
 * Reuse restoration filesystem semantics without current SQLite-schema admission.
 * Consumers must bind reconstructed tuples to the saved sealed immutable digest. */
export function captureRuntimeImmutableComponents(root){
 let components;const identity=captureIdentity(root,{profileDir:path.resolve(root),phase:'sealed'},{restorationBase:true,componentSink:value=>{components=value;}});
 return {immutableDigest:identity.immutableDigest,immutableEntries:components.immutableEntries};
}
function validatedRecord(record){
 need(record?.version===1&&hex(record.digest)&&hex(record.immutableDigest)&&record.sqliteSecurityDigests&&Object.values(record.sqliteSecurityDigests).every(hex),'SETUP_RUNTIME_SECURITY_VERSION');
 const contract=parseContract(record.contract);need(record.digest===sha256(canonical({contract,immutableDigest:record.immutableDigest,sqliteSecurityDigests:record.sqliteSecurityDigests})),'SETUP_RUNTIME_SECURITY_VERSION');
 return contract;
}
export function assertRuntimeSecurityIdentity(root,record,options={}){
 let actual;
 try{const contract=validatedRecord(record);if(options.captureSink){need(typeof options.captureSink==='function','SETUP_COMPONENT_EVIDENCE_INVALID');const captured=captureRuntimeSecurityComponents(root,contract,{completeDiagnostics:true});actual=captured.identity;actual.diagnosticDetails={schema:'agi-runtime-identity-components/v1',...captured.components};options.captureSink(captured);}else actual=captureRuntimeSecurityIdentity(root,contract);need(actual.digest===record.digest,'SETUP_PROFILE_CHANGED');return actual;}
 catch(error){error.runtimeIdentityDiagnostic=diagnosticFor(record,actual??error.runtimeIdentityCapture,error,options);throw error;}
}
/** Inspect exactly once. This never approves, repairs, retries, or substitutes
 * a later observation for the capture that failed an assertion. */
export function inspectRuntimeSecurityIdentity(root,record,options={}){
 try{const actual=assertRuntimeSecurityIdentity(root,record,options);return diagnosticFor(record,actual,null,options);}
 catch(error){return safeRuntimeIdentityDiagnostic(error.runtimeIdentityDiagnostic)??diagnosticFor(record,null,error,options);}
}
export function runtimeMutablePaths(){return {files:[...FILES],directories:[...DIRECTORIES],databases:[...DATABASES],lifecycle:['COMPUTE_STOP'],derived:[derivedConfig]};}
function safeParents(root,file){
 need(inside(root,file),'SETUP_ROLLBACK_PLAN_INVALID');let dir=path.dirname(file),parts=[];while(dir!==root){parts.push(dir);dir=path.dirname(dir);}
 need(owned(root).isDirectory(),'SETUP_STATE_FILE_UNSUPPORTED');
 for(const parent of parts.reverse()){const s=owned(parent,{optional:true});if(s)need(s.isDirectory(),'SETUP_STATE_FILE_UNSUPPORTED');else fs.mkdirSync(parent,{mode:0o700});}
}
function removeOwned(file){const s=owned(file,{optional:true});if(!s)return;if(s.isDirectory()){validateRuntimeTree(file);fs.rmSync(file,{recursive:true});}else fs.unlinkSync(file);}
function copyRuntime(source,target){
 const s=owned(source);if(s.isDirectory()){fs.mkdirSync(target,{mode:0o700});for(const name of fs.readdirSync(source).sort())copyRuntime(path.join(source,name),path.join(target,name));return;}
 need(!(s.mode&0o111),'SETUP_STATE_FILE_UNSUPPORTED');const read=readStable(source);fs.writeFileSync(target,read.bytes,{flag:'wx',mode:s.mode&0o777});
}

function requireCompatibleRuntime(root){
 if(!DATABASES.some(relative=>owned(path.join(root,relative),{optional:true})))return;
 const versions=[];
 for(const name of ['agi-compute-profile.json','compute-settings.json']){
  const file=path.join(root,name);if(!owned(file,{optional:true}))continue;
  let value;try{value=JSON.parse(readStable(file).bytes);}catch{throw Error('SETUP_ROLLBACK_RUNTIME_INCOMPATIBLE');}
  const candidates=name==='agi-compute-profile.json'?[value.openclaw]:[value.versions?.openclaw,value.runtimeDependencies?.openclaw];
  for(const version of candidates)if(version!==undefined)versions.push(version);
 }
 need(versions.length>0&&versions.every(version=>version==='2026.9.5'),'SETUP_ROLLBACK_RUNTIME_INCOMPATIBLE');
}

// Caller has already stopped services, taken coherent full snapshots of current
// and previous, and populated target with the exact previous snapshot. It owns
// the durable rename intent. This helper never writes the live profile.
export function carryForwardRuntimeState({previous,current,target,contract,setupTransactionId}){
 contract=parseContract(contract);need(contract.phase==='sealed','SETUP_RUNTIME_SECURITY_VERSION');
 need(typeof setupTransactionId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(setupTransactionId),'SETUP_ROLLBACK_PLAN_INVALID');
 for(const value of [previous,current,target])need(path.isAbsolute(value)&&path.resolve(value)===value,'SETUP_ROLLBACK_PLAN_INVALID');
 need(new Set([previous,current,target,contract.profileDir]).size===4&&!inside(previous,target)&&!inside(current,target),'SETUP_ROLLBACK_PLAN_INVALID');
 requireCompatibleRuntime(previous);requireCompatibleRuntime(current);
 let expectedRestored=null,observedRestored=null,diagnosticPhase='rollback-current';
 try{
 const before=captureIdentity(previous,{...contract,authStaging:[]},{restorationBase:true}),latest=captureRuntimeSecurityIdentity(current,contract);
 const expectedImmutable=before.immutableDigest,expectedSQLite=latest.sqliteSecurityDigests;
 expectedRestored={version:1,contract,immutableDigest:expectedImmutable,sqliteSecurityDigests:expectedSQLite,digest:sha256(canonical({contract,immutableDigest:expectedImmutable,sqliteSecurityDigests:expectedSQLite})),...(before.diagnosticDetails?{diagnosticDetails:{schema:'agi-runtime-identity-components/v1',immutableEntries:before.diagnosticDetails.immutableEntries,sqlite:latest.diagnosticDetails?.sqlite??{}}}:{})};
 // A stopped snapshot contains coherent main DBs and no WAL/SHM. A missing
 // source runtime item removes a stale counterpart, never resurrecting it.
 for(const relative of [...DIRECTORIES,...FILES,...DATABASES,'COMPUTE_STOP']){
  let src=path.join(current,relative);const dst=path.join(target,relative);
  if(relative==='COMPUTE_STOP'&&owned(src,{optional:true})){const value=readStable(src).bytes.toString('utf8');if(value===`AGI setup transaction ${setupTransactionId} pending readiness\n`||value==='Setup could not verify service shutdown. Preserve this profile and use the repair workflow.\n')src=path.join(previous,relative);}
  if(!owned(src,{optional:true})&&!owned(dst,{optional:true}))continue;
  safeParents(target,dst);removeOwned(dst);
  if(DATABASES.includes(relative))for(const suffix of ['-wal','-shm','-journal'])removeOwned(dst+suffix);
  if(owned(src,{optional:true}))copyRuntime(src,dst);
 }
 // Last-good is a derived cache, never an alternate unreviewed configuration.
 removeOwned(path.join(target,derivedConfig));
 diagnosticPhase='rollback-restored';const restored=captureRuntimeSecurityIdentity(target,contract);observedRestored=restored;
 need(restored.immutableDigest===before.immutableDigest&&canonical(restored.sqliteSecurityDigests)===canonical(latest.sqliteSecurityDigests),'SETUP_ROLLBACK_RUNTIME_CHANGED');
 return restored;
 }catch(error){if(!error.runtimeIdentityDiagnostic)error.runtimeIdentityDiagnostic=diagnosticFor(expectedRestored,observedRestored??error.runtimeIdentityCapture,error,{phase:diagnosticPhase});throw error;}
}
