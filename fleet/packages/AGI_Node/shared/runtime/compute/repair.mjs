import {roleContract,COMPUTE_ROLES,OPERATOR_ROLES,setupRole} from './roles.mjs';
import {consumerRoot,consumerCompute,consumerFile} from './consumer.mjs';
import fs from 'node:fs';
import {stopManagedServices, classifyLaunchctlPrint} from './service-stop.mjs';
import {publicBrowserSocketsStopped, publicBrowserRuntimeSocketPath, inspectPublicBrowserSocket} from './public-browser-runtime.mjs';
import {safeTransactionRuntimeObservation, safeRuntimeObservationFailure} from './setup-runtime-observation.mjs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {serviceFilePaths, restoreServiceFiles} from './repair-backup.mjs';
import {acquireSetupLock, clearInterruptedLock} from './setup-ledger.mjs';
import {readSavedSetupReport, safeSavedSetupReport} from './setup-failure-report.mjs';
import {completionText, nextSetupAction} from './setup-completion.mjs';
import {readCleanupEvidence,evidenceBlocksWork,safeCleanupEvidence} from './cleanup-evidence.mjs';

const ROOT = consumerCompute;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const requireValue = (ok, code) => { if (!ok) throw Error(code); };
const STATUS = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT TESTED']);
const check = (id, status, code, remediation = '', facts = {}) => ({id, status, code, remediation, facts});
const errorCode = error => /^[A-Z][A-Z0-9_]{2,79}$/.test(error?.message ?? '') ? error.message : 'REPAIR_CHECK_FAILED';
export const exitCodeFor = report => report.checks.some(c => c.status === 'FAIL') ? 1 : report.checks.some(c => c.status === 'BLOCKED') ? 2 : 0;

export function boundedCommand(executable, args, {timeoutMs = 5000, maxBytes = 262144, signal, env, cwd, input = '', captureStderr = false} = {}) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve({status: null, code: 'CANCELLED', stdout: ''});
    let child, timer, killTimer, done = false, size = 0, output = [], errors = [], termination = null;
    const finish = result => {
      if (done) return; done = true; clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort); resolve(result);
    };
    const stop = reason => {
      if (termination) return; termination = reason;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child?.kill('SIGTERM'); }
      killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child?.kill('SIGKILL'); } }, 500);
    };
    const abort = () => stop('CANCELLED');
    try { child = spawn(executable, args, {env: env ?? {HOME: os.homedir(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8'}, cwd, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe']}); }
    catch { return finish({status: null, code: 'UNAVAILABLE', stdout: ''}); }
    child.stdout.on('data', bytes => { size += bytes.length; if (size > maxBytes) stop('OUTPUT_LIMIT'); else output.push(bytes); });
    child.stderr.on('data', bytes => { size += bytes.length; if (size > maxBytes) stop('OUTPUT_LIMIT'); else if(captureStderr) errors.push(bytes); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
    child.once('error', () => finish({status: null, code: 'UNAVAILABLE', stdout: ''}));
    child.once('close', status => finish({status, code: termination ?? (status === 0 ? 'OK' : 'FAILED'), stdout: termination ? '' : Buffer.concat(output).toString('utf8'), ...(captureStderr?{stderr:termination?'':Buffer.concat(errors).toString('utf8')}:{})}));
    timer = setTimeout(() => stop('TIMEOUT'), Math.max(1, timeoutMs));
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
  });
}

export function startLogWindow(files, {now = () => new Date().toISOString(), runID = crypto.randomUUID()} = {}) {
  return {runID, startedAt: now(), files: files.map(file => {
    try { const s = fs.lstatSync(file); requireValue(s.isFile() && !s.isSymbolicLink(), 'REPAIR_LOG_UNSAFE'); return {file, dev: s.dev, ino: s.ino, offset: s.size}; }
    catch (e) { return {file, missing: e.code === 'ENOENT', unavailable: e.code !== 'ENOENT'}; }
  })};
}
export function finishLogWindow(window, {maxBytes = 131072} = {}) {
  return {runID: window.runID, startedAt: window.startedAt, finishedAt: new Date().toISOString(), source: 'byte offsets captured before this run; no historical tail', files: window.files.map(cursor => {
    const name = path.basename(cursor.file);
    try {
      const stat = fs.lstatSync(cursor.file);
      if (!stat.isFile() || stat.isSymbolicLink() || cursor.unavailable) return {name, status: 'BLOCKED', code: 'LOG_UNSAFE_OR_UNAVAILABLE'};
      if (!cursor.missing && (stat.dev !== cursor.dev || stat.ino !== cursor.ino || stat.size < cursor.offset)) return {name, status: 'BLOCKED', code: 'LOG_ROTATED_CURRENT_RUN_NOT_ATTRIBUTABLE'};
      const offset = cursor.missing ? 0 : cursor.offset, length = stat.size - offset;
      const bytes = Buffer.alloc(Math.min(length, maxBytes)), fd = fs.openSync(cursor.file, 'r');
      try { fs.readSync(fd, bytes, 0, bytes.length, offset); } finally { fs.closeSync(fd); }
      const codes = [...new Set(bytes.toString('utf8').match(/\b(?:COMPUTE|OPENCLAW|SETUP|REPAIR)_[A-Z_]{2,64}\b/g) ?? [])].slice(0, 30);
      return {name, status: length > maxBytes ? 'BLOCKED' : 'PASS', code: length > maxBytes ? 'CURRENT_LOG_OUTPUT_LIMIT' : 'CURRENT_LOG_WINDOW_READ', startOffset: offset, endOffset: stat.size, bytesObserved: length, errorCodes: codes, rawTextExported: false};
    } catch (e) { return {name, status: e.code === 'ENOENT' ? 'NOT TESTED' : 'BLOCKED', code: e.code === 'ENOENT' ? 'NO_LOG_CREATED_DURING_RUN' : 'LOG_UNAVAILABLE'}; }
  })};
}

function jsonFile(file, home) {
  requireValue(path.resolve(file).startsWith(path.resolve(home) + path.sep), 'REPAIR_PROFILE_PATH_INVALID');
  let current = path.resolve(home);
  for (const component of path.relative(home, file).split(path.sep)) {
    current = path.join(current, component);
    requireValue(!fs.lstatSync(current).isSymbolicLink(), 'REPAIR_PROFILE_SYMLINK');
  }
  const stat = fs.statSync(file);
  requireValue(stat.isFile() && stat.size <= 2 * 1024 * 1024, 'REPAIR_FILE_INVALID');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
export function existingSetupKit(settings, role) {
  requireValue((settings.role ?? 'agent') === role && COMPUTE_ROLES.includes(role), 'REPAIR_ROLE_MISMATCH');
  requireValue(/^[a-f0-9]{64}$/.test(settings.token ?? '') && Number.isSafeInteger(settings.signerUID), 'REPAIR_SETTINGS_INVALID');
  requireValue(/^openai\/[a-zA-Z0-9._-]{1,100}$/.test(settings.model ?? ''), 'REPAIR_MODEL_REQUIRED');
  return {...(settings.publicWebPolicy?.operatorPublicKey?{publicWebAuthority:settings.publicWebPolicy.operatorPublicKey}:{}),...(OPERATOR_ROLES.includes(role)?{schema:roleContract(role).schema,role}:{schema:roleContract(role).schema}), openclawVersion: '2026.9.5', token: settings.token, port: roleContract(role).port, agent: role === 'agent' ? 'agi-creator' : 'agi-reviewer', model: settings.model, mode: settings.workstation ? 'workstation' : 'tools', signerUID: settings.signerUID};
}
function listening(port, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve(false);
    const socket = net.connect({host: '127.0.0.1', port}); let finished = false;
    const done = result => { if (finished) return; finished = true; signal?.removeEventListener('abort', abort); socket.destroy(); resolve(result); };
    const abort = () => done(false);
    socket.setTimeout(1000); socket.once('connect', () => done(true)); socket.once('timeout', () => done(false)); socket.once('error', () => done(false)); signal?.addEventListener('abort', abort, {once: true});
  });
}

const stateSchemaContract = JSON.parse(fs.readFileSync(new URL('./setup-runtime-sqlite-contract.json', import.meta.url), 'utf8')).state;
const knownStateObjectNames = new Set(stateSchemaContract.objects.map(item => item.name));
const knownStateTableNames = new Set(stateSchemaContract.objects.map(item => item.tableName));
const stateSchemaKeys = ['schema', 'present', 'userVersion', 'schemaSha256', 'objects', 'sourceAdmission'].sort();
const objectKeys = ['type', 'name', 'tableName', 'sqlSha256'].sort();
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('\0') === keys.join('\0');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
/** Whitelist schema signatures. Unknown identifiers are irreversible labels, never raw strings. */
export function safeStateSchemaObservation(value) {
  if (value?.schema !== 'agi-state-schema-observation/v1') return null;
  if (value.present === false) return exactKeys(value, ['present', 'schema']) ? {schema: value.schema, present: false} : null;
  if (!exactKeys(value, stateSchemaKeys) || value.present !== true || !Number.isSafeInteger(value.userVersion) || value.userVersion < 0 || value.userVersion > 2147483647 || !hash(value.schemaSha256) || !Array.isArray(value.objects) || value.objects.length > 2000) return null;
  const admission = value.sourceAdmission;
  const requiredColumns = ['user_profile_identities.canonical_login', 'user_profiles.role'];
  const blockedCodes = ['SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED', 'SETUP_RUNTIME_SQLITE_SECURITY_INVALID', 'SETUP_RUNTIME_SQLITE_READ_FAILED'];
  let sourceAdmission;
  if (exactKeys(admission, ['requiredColumns', 'status']) && admission.status === 'SUPPORTED' && Array.isArray(admission.requiredColumns) && admission.requiredColumns.length <= 2 && new Set(admission.requiredColumns).size === admission.requiredColumns.length && admission.requiredColumns.every(column => requiredColumns.includes(column))) sourceAdmission = {status: 'SUPPORTED', requiredColumns: [...admission.requiredColumns].sort()};
  else if (exactKeys(admission, ['code', 'status']) && admission.status === 'BLOCKED' && blockedCodes.includes(admission.code)) sourceAdmission = {status: 'BLOCKED', code: admission.code};
  else return null;
  const names = new Set(), objects = [];
  const safeName = (name, known) => known.has(name) || /^opaque:[a-f0-9]{64}$/.test(name) ? name : 'opaque:' + sha(name);
  for (const item of value.objects) {
    if (!exactKeys(item, objectKeys) || !['table', 'index', 'view', 'trigger', 'unsupported'].includes(item.type) || !hash(item.sqlSha256) || ![item.name, item.tableName].every(name => typeof name === 'string' && /^(?:[A-Za-z0-9_]{1,128}|opaque:[a-f0-9]{64})$/.test(name))) return null;
    const key = item.type + ':' + item.name;
    if (names.has(key)) return null;
    names.add(key);
    objects.push({type: item.type, name: safeName(item.name, knownStateObjectNames), tableName: safeName(item.tableName, knownStateTableNames), sqlSha256: item.sqlSha256});
  }
  return {schema: value.schema, present: true, userVersion: value.userVersion, schemaSha256: value.schemaSha256, objects, sourceAdmission};
}
/** The worker reads only a private schema copy; the installed profile is never opened by SQLite. */
export async function collectStateSchema({profileDir, signal, run = boundedCommand} = {}) {
  requireValue(typeof profileDir === 'string' && path.isAbsolute(profileDir), 'REPAIR_STATE_SCHEMA_UNAVAILABLE');
  const moduleURL = new URL('./setup-state-preparation.mjs', import.meta.url).href;
  const worker = `import {observeStateSchema} from ${JSON.stringify(moduleURL)};let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>8192)throw Error('INPUT_LIMIT');}try{const result=observeStateSchema(JSON.parse(input));process.stdout.write(JSON.stringify({ok:true,result}));}catch{process.stdout.write(JSON.stringify({ok:false}));process.exitCode=1;}`;
  const result = await run(process.execPath, ['--input-type=module', '--eval', worker], {timeoutMs: 5000, maxBytes: 1048576, signal, cwd: ROOT, input: JSON.stringify({profileDir}), env: {HOME: os.homedir(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8', NODE_NO_WARNINGS: '1'}});
  requireValue(result?.status === 0 && result.code === 'OK' && typeof result.stdout === 'string' && result.stdout.length <= 1048576, 'REPAIR_STATE_SCHEMA_UNAVAILABLE');
  let response; try { response = JSON.parse(result.stdout); } catch { throw Error('REPAIR_STATE_SCHEMA_UNAVAILABLE'); }
  requireValue(exactKeys(response, ['ok', 'result']) && response.ok === true, 'REPAIR_STATE_SCHEMA_UNAVAILABLE');
  const observed = safeStateSchemaObservation(response.result);
  requireValue(observed !== null, 'REPAIR_STATE_SCHEMA_UNAVAILABLE');
  return observed;
}

const RUNTIME_COLLECTION_STAGES=new Set(['input-validation','quiescence-before','temporary-create','worker-execution','worker-envelope','worker-observation','quiescence-after','temporary-cleanup','complete']);
const COMMAND_CODES=new Set(['OK','FAILED','TIMEOUT','CANCELLED','OUTPUT_LIMIT','UNAVAILABLE']);
const COLLECTION_CODES=new Set(['REPAIR_RUNTIME_OBSERVATION_STOP_REQUIRED','REPAIR_RUNTIME_OBSERVATION_PATH','REPAIR_RUNTIME_OBSERVATION_CANCELLED','REPAIR_RUNTIME_TEMPORARY_CREATE_FAILED','REPAIR_RUNTIME_WORKER_FAILED','REPAIR_RUNTIME_WORKER_TIMEOUT','REPAIR_RUNTIME_WORKER_CANCELLED','REPAIR_RUNTIME_WORKER_OUTPUT_LIMIT','REPAIR_RUNTIME_WORKER_UNAVAILABLE','REPAIR_RUNTIME_WORKER_JSON_INVALID','REPAIR_RUNTIME_WORKER_ENVELOPE_INVALID','REPAIR_RUNTIME_WORKER_EVIDENCE_INVALID','REPAIR_RUNTIME_TEMPORARY_CLEANUP_FAILED']);
const safeErrno=error=>new Set(['EACCES','EPERM','ENOENT','ENOTDIR','EISDIR','ELOOP','ENOSPC','EMFILE','ENFILE','EIO','EBUSY','ENOTEMPTY','EINVAL','EROFS']).has(error?.code)?error.code:null;
function collectionFailure(error,stage,fallback='REPAIR_RUNTIME_WORKER_FAILED'){
  return {code:COLLECTION_CODES.has(error?.message)?error.message:fallback,stage:RUNTIME_COLLECTION_STAGES.has(stage)?stage:'input-validation',errno:safeErrno(error)};
}
function safeRuntimeIdentityCollection(value){
  if(value?.schema!=='agi-runtime-identity-collection/v1'||!['COLLECTING','OBSERVED','BLOCKED'].includes(value.status)||!RUNTIME_COLLECTION_STAGES.has(value.stage))return null;
  const failure=value=>value&&COLLECTION_CODES.has(value.code)&&RUNTIME_COLLECTION_STAGES.has(value.stage)?{code:value.code,stage:value.stage,errno:safeErrno({code:value.errno})}:null;
  const worker=value.worker??{},temporary=value.temporary??{};
  return {schema:value.schema,status:value.status,stage:value.stage,failure:failure(value.failure),afterFailure:failure(value.afterFailure),cleanupFailure:failure(value.cleanupFailure),workerFailure:value.workerFailure?safeRuntimeObservationFailure(value.workerFailure):null,worker:{started:worker.started===true,status:Number.isSafeInteger(worker.status)&&worker.status>=0&&worker.status<=255?worker.status:null,code:COMMAND_CODES.has(worker.code)?worker.code:null,envelope:['not-read','invalid-json','invalid-envelope','invalid-evidence','accepted-success','accepted-failure'].includes(worker.envelope)?worker.envelope:'not-read'},temporary:{created:temporary.created===true,parentBaseShared:temporary.parentBaseShared===true,removed:typeof temporary.removed==='boolean'?temporary.removed:null}};
}
/** Report-only proof of quiescence. Never bootout, reclaim a socket or open source SQLite. */
export async function collectRuntimeIdentity({home, role, profileDir, uid=process.getuid?.(), platform=process.platform, signal, run=boundedCommand, workerRun=boundedCommand, probePort=listening, inspectSocket=inspectPublicBrowserSocket, removeTemporary=directory=>fs.rmSync(directory,{recursive:true,force:true,maxRetries:0})}={}) {
  const collection={schema:'agi-runtime-identity-collection/v1',status:'COLLECTING',stage:'input-validation',failure:null,afterFailure:null,cleanupFailure:null,workerFailure:null,worker:{started:false,status:null,code:null,envelope:'not-read'},temporary:{created:false,parentBaseShared:false,removed:null}};
  const quiescence={before:null,after:null};let observation=null,temporaryRoot=null,temporaryBase=null,primary=null;
  const remember=(error,stage=collection.stage,fallback)=>{const value=collectionFailure(error,stage,fallback??(stage.startsWith('quiescence-')?'REPAIR_RUNTIME_OBSERVATION_STOP_REQUIRED':'REPAIR_RUNTIME_WORKER_FAILED'));if(!primary){primary=error;collection.failure=value;}return value;};
  const stopped=async(phase,suffix,ports)=>{
    collection.stage='quiescence-'+phase;
    const evidence={servicesAbsent:null,portsClosed:null,socketsAbsent:null,launchctlPrint:{compute:null,gateway:null},portsClosedByRole:{compute:null,gateway:null},socketsAbsentByKind:{runtime:null,legacy:null}};
    quiescence[phase]=evidence;
    for(const [index,label] of ['ai.montreal.'+suffix,'ai.openclaw.'+suffix].entries()) {
      const name=index===0?'compute':'gateway';let result;
      evidence.launchctlPrint[name]={status:null,classification:'command-failed',badRequestPrefix:false};
      try{result=await run('/bin/launchctl',['print',`gui/${uid}/${label}`],{timeoutMs:5000,signal,captureStderr:true});}catch(error){throw Error('REPAIR_RUNTIME_OBSERVATION_STOP_REQUIRED',{cause:error});}
      evidence.launchctlPrint[name]=classifyLaunchctlPrint(result,label,uid,1);
      if(evidence.launchctlPrint[name].classification!=='absent'){evidence.servicesAbsent=false;throw Error('REPAIR_RUNTIME_OBSERVATION_STOP_REQUIRED');}
    }
    evidence.servicesAbsent=true;
    for(const [index,port] of ports.entries()){
      const result=await probePort(port,signal);evidence.portsClosedByRole[index===0?'compute':'gateway']=typeof result==='boolean'?!result:null;
      if(result!==false){evidence.portsClosed=false;throw Error('REPAIR_RUNTIME_OBSERVATION_STOP_REQUIRED');}
    }
    evidence.portsClosed=true;
    const socketPaths=[publicBrowserRuntimeSocketPath(profileDir,{uid,platform}),path.join(profileDir,'web.sock')];
    for(const [index,socketPath] of socketPaths.entries()){
      const result=inspectSocket(socketPath,{profileDir,allowLegacy:true,uid,platform});
      evidence.socketsAbsentByKind[index===0?'runtime':'legacy']=typeof result?.exists==='boolean'?!result.exists:null;
      if(result?.exists!==false){evidence.socketsAbsent=false;throw Error('REPAIR_RUNTIME_OBSERVATION_STOP_REQUIRED');}
    }
    evidence.socketsAbsent=true;
    requireValue(!signal?.aborted,'REPAIR_RUNTIME_OBSERVATION_CANCELLED');
  };
  try {
    requireValue(platform==='darwin'&&COMPUTE_ROLES.includes(role)&&Number.isSafeInteger(uid)&&uid>0,'REPAIR_RUNTIME_OBSERVATION_STOP_REQUIRED');
    const suffix=roleContract(role).profile;
    requireValue(typeof home==='string'&&path.isAbsolute(home)&&profileDir===path.join(home,'.openclaw-'+suffix),'REPAIR_RUNTIME_OBSERVATION_PATH');
    const ports=[roleContract(role).port,roleContract(role).gatewayPort];
    await stopped('before',suffix,ports);
    collection.stage='temporary-create';
    try{
      temporaryBase=fs.realpathSync(os.tmpdir());const baseStat=fs.lstatSync(temporaryBase);
      for(const protectedRoot of [profileDir,path.join(home,'.agi-genesis-setup-'+role)]){let canonical;try{canonical=fs.realpathSync(protectedRoot);}catch(error){if(error.code!=='ENOENT')throw error;canonical=path.resolve(protectedRoot);}requireValue(temporaryBase!==canonical&&!temporaryBase.startsWith(canonical+path.sep),'REPAIR_RUNTIME_TEMPORARY_CREATE_FAILED');}
      requireValue(baseStat.isDirectory()&&!baseStat.isSymbolicLink(),'REPAIR_RUNTIME_TEMPORARY_CREATE_FAILED');
      temporaryRoot=fs.mkdtempSync(path.join(temporaryBase,'agi-runtime-observation-'));collection.temporary.created=true;
      fs.chmodSync(temporaryRoot,0o700);const stat=fs.lstatSync(temporaryRoot);
      requireValue(stat.isDirectory()&&!stat.isSymbolicLink()&&(!process.getuid||stat.uid===process.getuid())&&(stat.mode&0o777)===0o700&&fs.realpathSync(temporaryRoot)===temporaryRoot,'REPAIR_RUNTIME_TEMPORARY_CREATE_FAILED');
    }catch(error){remember(error,collection.stage,'REPAIR_RUNTIME_TEMPORARY_CREATE_FAILED');throw error;}
    const moduleURL=new URL('./setup-runtime-observation.mjs',import.meta.url).href;
    const worker=`import {observeTransactionRuntimeIdentity,safeRuntimeObservationFailure} from ${JSON.stringify(moduleURL)};let input='';try{for await(const chunk of process.stdin){input+=chunk;if(input.length>8192)throw Error('REPAIR_RUNTIME_OBSERVATION_LIMIT');}const result=observeTransactionRuntimeIdentity(JSON.parse(input));process.stdout.write(JSON.stringify({ok:true,result}));}catch(error){process.stdout.write(JSON.stringify({ok:false,error:safeRuntimeObservationFailure(error),result:error.runtimeObservationEvidence??null}));process.exitCode=1;}`;
    try{
      collection.stage='worker-execution';collection.worker.started=true;collection.temporary.parentBaseShared=true;
      const result=await workerRun(process.execPath,['--input-type=module','--eval',worker],{timeoutMs:30000,maxBytes:2*1024*1024,signal,cwd:ROOT,input:JSON.stringify({home,role,profileDir,temporaryRoot}),env:{HOME:home,TMPDIR:temporaryBase,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',NODE_NO_WARNINGS:'1'}});
      collection.worker.status=result?.status;collection.worker.code=result?.code;
      if(!result||!['OK','FAILED'].includes(result.code)||!Number.isSafeInteger(result.status)||result.status<0||result.status>255){throw Error('REPAIR_RUNTIME_WORKER_'+(COMMAND_CODES.has(result?.code)&&result.code!=='OK'?result.code:'UNAVAILABLE'));}
      collection.stage='worker-envelope';
      requireValue(typeof result.stdout==='string'&&Buffer.byteLength(result.stdout)<=2*1024*1024,'REPAIR_RUNTIME_WORKER_OUTPUT_LIMIT');
      let response;try{response=JSON.parse(result.stdout);}catch{collection.worker.envelope='invalid-json';throw Error('REPAIR_RUNTIME_WORKER_JSON_INVALID');}
      const good=response?.ok===true&&exactKeys(response,['ok','result']),failed=response?.ok===false&&exactKeys(response,['error','ok','result']);
      if(!good&&!failed){collection.worker.envelope='invalid-envelope';throw Error('REPAIR_RUNTIME_WORKER_ENVELOPE_INVALID');}
      const parsed=safeTransactionRuntimeObservation(response.result);
      if(response.result!==null&&!parsed||good&&!parsed){collection.worker.envelope='invalid-evidence';throw Error('REPAIR_RUNTIME_WORKER_EVIDENCE_INVALID');}
      observation=parsed;collection.worker.envelope=good?'accepted-success':'accepted-failure';
      collection.stage='worker-observation';
      if(failed){collection.workerFailure=safeRuntimeObservationFailure(response.error);throw Error('REPAIR_RUNTIME_WORKER_FAILED');}
      requireValue(result.status===0&&result.code==='OK'&&observation.status==='OBSERVED','REPAIR_RUNTIME_WORKER_FAILED');
    }catch(error){remember(error);}
    try{await stopped('after',suffix,ports);}catch(error){collection.afterFailure=remember(error,'quiescence-after','REPAIR_RUNTIME_OBSERVATION_STOP_REQUIRED');}
  }catch(error){remember(error);}
  finally{
    if(temporaryRoot){
      collection.stage='temporary-cleanup';
      try{
        const stat=fs.lstatSync(temporaryRoot);
        requireValue(path.dirname(temporaryRoot)===temporaryBase&&stat.isDirectory()&&!stat.isSymbolicLink()&&(!process.getuid||stat.uid===process.getuid())&&(stat.mode&0o777)===0o700&&fs.realpathSync(temporaryRoot)===temporaryRoot,'REPAIR_RUNTIME_TEMPORARY_CLEANUP_FAILED');
        removeTemporary(temporaryRoot);requireValue(!fs.existsSync(temporaryRoot),'REPAIR_RUNTIME_TEMPORARY_CLEANUP_FAILED');collection.temporary.removed=true;
      }catch(error){collection.temporary.removed=false;collection.cleanupFailure=remember(error,'temporary-cleanup','REPAIR_RUNTIME_TEMPORARY_CLEANUP_FAILED');}
    }
  }
  collection.status=primary?'BLOCKED':'OBSERVED';collection.stage=primary?collection.failure.stage:'complete';
  const result={observation,quiescence:safeRuntimeObservationQuiescence(quiescence),collection:safeRuntimeIdentityCollection(collection)};
  if(primary){const error=Error(collection.failure.code);Object.assign(error,{runtimeIdentity:result.observation,runtimeIdentityQuiescence:result.quiescence,runtimeIdentityCollection:result.collection});throw error;}
  return result;
}

export async function inventoryCompute({role = 'agent', home = os.homedir(), platform = process.platform, uid = process.getuid?.(), run = boundedCommand, probePort = listening, signal, dependencies = true, network = false, policyCheck, runtimeProbe, schemaRun = boundedCommand, runtimeIdentityRun = boundedCommand, runtimeIdentitySocketInspect = inspectPublicBrowserSocket} = {}) {
  requireValue(COMPUTE_ROLES.includes(role), 'REPAIR_ROLE_INVALID');
  const profile = roleContract(role).profile, profileDir = path.join(home, '.openclaw-' + profile);
  const window = startLogWindow(['service.log', 'service-error.log'].map(file => path.join(profileDir, file)));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, '../package.json'), 'utf8'));
  const report = {schema: 'agi-compute-repair/v1', runID: window.runID, startedAt: window.startedAt, build: {name: pkg.name, version: pkg.version}, role, action: 'read-only inventory', checks: [], services: {}, currentLogs: null, qualification: {physicalMac: 'NOT TESTED', liveProviders: 'NOT TESTED', toolExecution: 'NOT TESTED', buyerUse: 'NOT TESTED', independentReview: 'NOT TESTED', paidSettlements: 'NOT TESTED', soak72Hours: 'NOT TESTED'}, walletAccessed: false, settingsChanged: false, budgetsChanged: false, paidProviderCall: false};
  report.cleanupEvidence=readCleanupEvidence(profileDir);
  report.checks.push(check('cleanup-evidence',evidenceBlocksWork(report.cleanupEvidence)?'BLOCKED':report.cleanupEvidence.status==='ABSENT'?'NOT TESTED':'PASS',evidenceBlocksWork(report.cleanupEvidence)?'COMPUTE_CLEANUP_REQUIRES_RECONCILIATION':report.cleanupEvidence.status==='ABSENT'?'HISTORICAL_CLEANUP_EVIDENCE_UNAVAILABLE':'DURABLE_CLEANUP_EVIDENCE_RETAINED','Historical cleanup evidence is independent of the current log window. Missing legacy evidence is not proof of successful cleanup; inventory never clears STOP.'));
  report.checks.push(check('platform', platform === 'darwin' ? 'PASS' : 'BLOCKED', platform === 'darwin' ? 'MACOS_DETECTED' : 'PHYSICAL_MAC_REQUIRED', platform === 'darwin' ? '' : 'Run Repair-Compute.command in the existing dedicated Standard compute account on the Mac.'));
  if (platform === 'darwin') {
    const groups = await run('/usr/bin/id', ['-Gn'], {signal});
    const standard = groups.status === 0 && uid !== 0 && !groups.stdout.trim().split(/\s+/).includes('admin');
    report.checks.push(check('account', standard ? 'PASS' : 'BLOCKED', standard ? 'STANDARD_COMPUTE_ACCOUNT' : 'STANDARD_COMPUTE_ACCOUNT_REQUIRED', standard ? '' : 'Switch to the dedicated Standard compute account. Administrator DNS work uses the separate administrator launcher.'));
  }
  let settings, config;
  try {
    settings = jsonFile(path.join(profileDir, 'compute-settings.json'), home);
    requireValue(settings.profileDir === profileDir && settings.home === home && settings.gatewayConfig === path.join(profileDir, 'openclaw.json') && settings.workspace === path.join(profileDir, 'workspace'), 'REPAIR_PROFILE_PATH_MISMATCH');
    requireValue((settings.role ?? 'agent') === role && settings.port === (roleContract(role).port) && settings.gatewayPort === (roleContract(role).gatewayPort), 'REPAIR_PROFILE_ROLE_MISMATCH');
    config = jsonFile(settings.gatewayConfig, home);
    const marker = jsonFile(path.join(profileDir, 'agi-compute-profile.json'), home);
    report.checks.push(check('profile', 'PASS', 'EXISTING_PROFILE_PRESERVED', '', {installedVersion: /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(marker.version ?? '') ? marker.version : 'unknown', workstation: settings.workstation === true}));
    report.checks.push(check('account-separation', uid === settings.signerUID || settings.isolationAcknowledged !== true ? 'BLOCKED' : 'PASS', uid === settings.signerUID || settings.isolationAcknowledged !== true ? 'SIGNER_COMPUTE_SEPARATION_REQUIRED' : 'DISTINCT_SIGNER_UID_RECORDED', 'Wallet, recovery phrase, and encrypted signer backups must remain in the signer account.'));
    report.checks.push(check('allowances', 'PASS', 'EXISTING_LIMITS_OBSERVED_UNCHANGED', '', {maxRuns24h: Number.isSafeInteger(settings.maxRuns24h) ? settings.maxRuns24h : null, maxImages24h: Number.isSafeInteger(settings.maxImages24h) ? settings.maxImages24h : null, journalPresent: fs.existsSync(path.join(profileDir, 'compute-journal.json'))}));
    let policyStatus = 'FAIL', policyCode = 'COMPUTE_POLICY_CHANGED', observedCandidatePolicyHash=null;
    try {
      if (policyCheck) { observedCandidatePolicyHash=policyCheck(settings); if (observedCandidatePolicyHash === settings.policyHash) { policyStatus = 'PASS'; policyCode = 'POLICY_MATCHES_RECORDED_SEAL'; } }
      else {
        const policy = await import('./policy.mjs');
        if (settings.policySealVersion !== 2) {
          observedCandidatePolicyHash=policy.legacyPolicyHash(settings);
          if (observedCandidatePolicyHash === settings.policyHash) { policyStatus = 'BLOCKED'; policyCode = 'COMPUTE_POLICY_MIGRATION_REQUIRED'; }
        } else { observedCandidatePolicyHash=policy.policyHash(settings); policy.assertComputePolicy(settings); policyStatus = 'PASS'; policyCode = 'POLICY_MATCHES_RECORDED_SEAL'; }
      }
    } catch (error) { policyCode = errorCode(error); }
    report.checks.push(check('policy', policyStatus, policyCode, policyStatus === 'PASS' ? '' : policyCode === 'COMPUTE_POLICY_MIGRATION_REQUIRED' ? 'The old seal matches. Review the candidate migration to add execution-setting integrity before running this release.' : 'Keep work stopped. This evaluation uses the diagnostic candidate source; a candidate adapter change alone can differ from the installed seal. Review the stopped-profile runtime identity evidence before any repair; no automatic re-sealing is permitted.', {policySealVersion:settings.policySealVersion??1,policyHash:/^[a-f0-9]{64}$/.test(settings.policyHash??'')?settings.policyHash:null,recordedPolicyHash:/^[a-f0-9]{64}$/.test(settings.policyHash??'')?settings.policyHash:null,observedCandidatePolicyHash:/^[a-f0-9]{64}$/.test(observedCandidatePolicyHash??'')?observedCandidatePolicyHash:null,policyEvaluationScope:'candidate-source'}));
    const globalAllow = Array.isArray(config.tools?.allow) && config.tools.allow.length > 0;
    report.checks.push(check('role-tools', globalAllow ? 'FAIL' : 'PASS', globalAllow ? 'GLOBAL_ALLOW_CONFLICTS_WITH_TOOLLESS_CHECKER' : 'NO_GLOBAL_ALLOWLIST_CONFLICT', globalAllow ? 'Apply the reviewed repair to move allowed tools to creator/reviewer while preserving narrower role restrictions.' : '', {effectiveRegisteredTools: 'NOT TESTED'}));
    const badBrowserKey = Object.hasOwn(config.browser?.ssrfPolicy ?? {}, 'hostnameAllowlist');
    const privateBrowser = config.browser?.ssrfPolicy?.dangerouslyAllowPrivateNetwork === true;
    report.checks.push(check('browser-policy', badBrowserKey || privateBrowser ? 'FAIL' : 'PASS', badBrowserKey ? 'UNSUPPORTED_BROWSER_SCHEMA_KEY' : privateBrowser ? 'PRIVATE_BROWSER_NETWORK_ENABLED' : 'BROWSER_STATIC_POLICY_INSPECTED', badBrowserKey || privateBrowser ? 'Use the version-validated candidate; retain private-network blocking.' : '', {navigationVerified: false}));
    report.checks.push(check('stop-marker', fs.existsSync(path.join(profileDir, 'COMPUTE_STOP')) ? 'BLOCKED' : 'PASS', fs.existsSync(path.join(profileDir, 'COMPUTE_STOP')) ? 'COMPUTE_STOP_REQUIRES_RECONCILIATION' : 'NO_COMPUTE_STOP_MARKER', 'A stop marker must be reconciled explicitly; repair does not remove it.'));
  } catch (error) { report.checks.push(check('profile', 'BLOCKED', error.code === 'ENOENT' ? 'EXISTING_COMPUTE_PROFILE_NOT_FOUND' : errorCode(error), 'Use the existing compute account and correct role. For a new installation use Setup-OpenClaw.command with its private setup handoff.')); }
  if (fs.existsSync(profileDir)) {
    try {
      report.stateSchema = await collectStateSchema({profileDir, signal, run: schemaRun});
      const unknown = report.stateSchema.objects?.some(item => item.name.startsWith('opaque:') || item.tableName.startsWith('opaque:') || !['table', 'index'].includes(item.type));
      report.checks.push(check('state-schema', unknown ? 'BLOCKED' : report.stateSchema.present ? 'PASS' : 'NOT TESTED', unknown ? 'REPAIR_STATE_SCHEMA_UNKNOWN_OBJECTS' : report.stateSchema.present ? 'STATE_SCHEMA_SIGNATURES_OBSERVED' : 'STATE_DATABASE_NOT_PRESENT', 'Signature collection is diagnostic evidence; read the separate source-admission result. No installed database is migrated by inventory.'));
      if (report.stateSchema.present) {
        const admission = report.stateSchema.sourceAdmission, supported = !unknown && admission.status === 'SUPPORTED';
        report.checks.push(check('state-schema-source', supported ? 'PASS' : 'BLOCKED', supported ? 'STATE_SCHEMA_SOURCE_SUPPORTED' : admission.code ?? 'REPAIR_STATE_SCHEMA_UNKNOWN_OBJECTS', supported ? 'Private-copy schema and core ownership metadata match a supported source. Technical review and fresh candidate approval remain required before repair.' : 'The private-copy source check refused schema or core ownership metadata. Keep the profile unchanged and return the sanitized report for technical review.'));
      }
    } catch {
      report.checks.push(check('state-schema', 'BLOCKED', 'REPAIR_STATE_SCHEMA_UNAVAILABLE', 'Schema signatures could not be collected safely within the bounded read-only check. Keep the databases and transaction evidence intact; do not run manual SQLite cleanup.'));
    }
  }
  for (const file of serviceFilePaths(home, role)) {
    try { const stat = fs.lstatSync(file); const safe = stat.isFile() && !stat.isSymbolicLink() && stat.uid === uid && !(stat.mode & 0o022); report.checks.push(check('service-file:' + path.basename(file), safe ? 'PASS' : 'FAIL', safe ? 'EXISTING_SERVICE_FILE_INVENTORIED' : 'SERVICE_FILE_PERMISSIONS_UNSAFE', safe ? '' : 'Review ownership and write permissions before migration.', {present: true, sha256: safe ? sha(fs.readFileSync(file)) : null, mode: (stat.mode & 0o777).toString(8)})); }
    catch (error) { report.checks.push(check('service-file:' + path.basename(file), error.code === 'ENOENT' ? 'NOT TESTED' : 'BLOCKED', error.code === 'ENOENT' ? 'SERVICE_FILE_NOT_PRESENT' : 'SERVICE_FILE_UNREADABLE', '', {present: false})); }
  }
  if (settings) for (const [name, port, label] of [['compute', settings.port, 'ai.montreal.' + profile], ['gateway', settings.gatewayPort, 'ai.openclaw.' + profile]]) {
    const service = {port, listening: await probePort(port, signal), state: 'unknown', pid: null, processStartedAt: null};
    if (platform === 'darwin') {
      const found = await run('/bin/launchctl', ['print', `gui/${uid}/${label}`], {signal});
      if (found.status === 0) {
        service.state = /state = running/.test(found.stdout) ? 'running' : 'loaded-stopped';
        const pid = /\bpid = (\d+)\b/.exec(found.stdout); if (pid) service.pid = Number(pid[1]);
        if (service.pid) { const started = await run('/bin/ps', ['-p', String(service.pid), '-o', 'lstart='], {signal, env: {PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC'}}); const date = started.status === 0 ? Date.parse(started.stdout.trim() + ' UTC') : NaN; if (Number.isFinite(date)) service.processStartedAt = new Date(date).toISOString(); }
      } else service.state = found.code === 'TIMEOUT' ? 'unknown' : 'not-loaded';
    }
    report.services[name] = service;
    report.checks.push(check(name + '-service', service.listening ? 'PASS' : 'BLOCKED', service.listening ? 'LOOPBACK_PORT_LISTENING_ONLY' : 'SERVICE_STOPPED_OR_UNAVAILABLE', service.listening ? 'A listening port is not live job or tool-execution proof.' : 'Keep services stopped while commissioning evidence is under review. A stopped service is expected during report-only diagnosis.'));
  }
  if (dependencies) {
    try {
      const runtime = runtimeProbe ?? await import('./runtime-env.mjs');
      const found = runtime.discoverRuntime({home, node: process.execPath, docker: settings?.docker, uid});
      const exact = found.versions?.openclaw === '2026.9.5';
      const version=value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value)?value:null;
      report.checks.push(check('openclaw', exact ? 'PASS' : 'BLOCKED', exact ? 'OPENCLAW_2026_9_5' : 'OPENCLAW_VERSION_UNVERIFIED', exact ? '' : 'Use the supported OpenClaw 2026.9.5 package; do not upgrade the installed profile implicitly.',{nodeVersion:version(found.versions?.node),openclawVersion:version(found.versions?.openclaw),recordedOpenclawVersion:version(settings?.runtimeDependencies?.openclaw??settings?.versions?.openclaw),runtimeSelection:'candidate-target'}));
      const docker = await run(found.docker, ['info', '--format', '{{.ServerVersion}}'], {timeoutMs: 5000, signal, env: runtime.runtimeEnvironment(found)});
      const ready = docker.status === 0 && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9_.-]+)?$/.test(docker.stdout.trim());
      report.checks.push(check('docker', ready ? 'PASS' : 'BLOCKED', ready ? 'DOCKER_ENGINE_READY' : docker.code === 'TIMEOUT' ? 'COMPUTE_DOCKER_TIMEOUT' : 'COMPUTE_DOCKER_ENGINE_UNAVAILABLE', ready ? '' : 'Keep Docker Desktop running in the compute account and verify this account can access its engine.',{dockerVersion:ready?docker.stdout.trim():null}));
    } catch (error) { report.checks.push(check('dependencies', 'BLOCKED', errorCode(error), 'Install/launch the supported local dependencies, then resume. Existing services and OAuth were not changed.')); }
  }
  let observeRuntimeIdentity=false;
  try {
    const {transactionStatus} = await import('./setup-transaction.mjs');
    const transaction = transactionStatus(path.join(home, '.agi-genesis-setup-' + role, 'transaction'));
    const states = new Set(['none', 'preparing', 'prepared', 'approved', 'publishing', 'published', 'sealed', 'complete', 'rolled-back', 'safe-stop-required']);
    const state = states.has(transaction.state) ? transaction.state : 'unknown';
    report.checks.push(check('repair-transaction', ['none', 'complete', 'rolled-back'].includes(state) ? 'PASS' : 'BLOCKED', state === 'none' ? 'NO_PREVIOUS_REPAIR' : state === 'complete' ? 'PREVIOUS_REPAIR_COMPLETED' : state === 'rolled-back' ? 'PREVIOUS_REPAIR_ROLLED_BACK' : 'INTERRUPTED_REPAIR_REQUIRES_RESUME', ['none', 'complete', 'rolled-back'].includes(state) ? '' : state==='safe-stop-required' ? 'Keep services stopped and return option 6 diagnostics for technical review before Apply, Restart or Rollback.' : 'Choose Apply / resume repair only after technical confirmation. The transaction preserves interrupted evidence before requesting fresh approval.', {transactionState: state}));
    observeRuntimeIdentity=state==='safe-stop-required'||(['none','unknown'].includes(state)&&fs.existsSync(path.join(home,'.agi-genesis-setup-'+role,'transaction')));
  } catch (error) {
    observeRuntimeIdentity=fs.existsSync(path.join(home,'.agi-genesis-setup-'+role,'transaction'));
    report.checks.push(check('repair-transaction', 'BLOCKED', errorCode(error), 'Preserve the existing recovery files; the repair transaction must be inspected before any changes.'));
  }
    if(observeRuntimeIdentity) {
      try {
        const result=await collectRuntimeIdentity({home,role,profileDir,uid,platform,signal,run,workerRun:runtimeIdentityRun,probePort,inspectSocket:runtimeIdentitySocketInspect});
        report.runtimeIdentity=result.observation;
        report.runtimeIdentityQuiescence=result.quiescence;
        report.runtimeIdentityCollection=result.collection;
        report.checks.push(check('runtime-identity','BLOCKED','RUNTIME_IDENTITY_EVIDENCE_COLLECTED','Return this stopped-profile observation for technical review. It does not authorize Apply, Restart or Rollback and does not reconstruct unrecorded historical per-file hashes.'));
      } catch(error) {
        report.runtimeIdentity=error.runtimeIdentity??null;
        report.runtimeIdentityQuiescence=error.runtimeIdentityQuiescence??null;
        report.runtimeIdentityCollection=error.runtimeIdentityCollection??null;
        report.checks.push(check('runtime-identity','BLOCKED',COLLECTION_CODES.has(error.message)?error.message:'REPAIR_RUNTIME_OBSERVATION_UNAVAILABLE','Preserve the stopped profile and all transaction evidence. No repair was applied; return this report for technical review.'));
      }
    }
  try {
    report.savedSetup = readSavedSetupReport({home, role, uid});
    if (report.savedSetup) report.checks.push(check('saved-setup-report', 'PASS', 'SAVED_SETUP_EVIDENCE_RETAINED', 'The exported report includes the previous attempt, its primary and rollback failures, and bounded service-readiness diagnostics. Keep the profile and transaction archives intact.'));
  } catch (error) { report.checks.push(check('saved-setup-report', 'BLOCKED', errorCode(error), 'The saved attempt could not be read safely. Preserve it for technical review; do not edit or delete the profile or transaction evidence.')); }
  if (network) {
    try { const {inspectNetwork} = await import('./network-preflight.mjs'); const networkRun = async (file, args, options) => { const r = await run(file, args, {...options, signal}); return {code: r.status, stdout: r.stdout, stderr: '', error: r.code === 'OK' ? null : r.code}; }; const result = await inspectNetwork({hostname: 'example.com', run: networkRun, platform}); report.checks.push(check('network', result.status ?? 'BLOCKED', result.administratorActionRequired ? 'ADMINISTRATOR_NETWORK_ACTION_REQUIRED' : 'NETWORK_PREFLIGHT', 'If an administrator action is required, use Administrator-DNS.command from the administrator account.', result)); }
    catch (error) { report.checks.push(check('network', 'BLOCKED', errorCode(error), 'Run the separate read-only network diagnostic; administrator consent is required for any DNS change.')); }
  } else report.checks.push(check('network', 'NOT TESTED', 'DNS_CHECK_OPT_IN', 'Use Check network in this repair tool to run bounded read-only DNS diagnostics.'));
  report.currentLogs = finishLogWindow(window);
  if (signal?.aborted) report.checks.push(check('cancel', 'BLOCKED', 'REPAIR_CANCELLED', 'The inventory changed no settings. Reopen this tool to resume.'));
  report.finishedAt = new Date().toISOString(); report.exitCode = exitCodeFor(report);
  return report;
}

function safeRuntimeObservationQuiescence(value) {
  if(!value||typeof value!=='object')return null;
  const boolean=value=>typeof value==='boolean'?value:null;
  const result={};
  for(const key of ['before','after']){
    const item=value[key];if(!item){result[key]=null;continue;}
    const launchctlPrint={};
    for(const role of ['compute','gateway']){
      const evidence=item.launchctlPrint?.[role];
      launchctlPrint[role]=evidence&&['absent','loaded','rejected','invalid-result','command-failed'].includes(evidence.classification)?{status:Number.isSafeInteger(evidence.status)&&evidence.status>=0&&evidence.status<=255?evidence.status:null,classification:evidence.classification,badRequestPrefix:evidence.badRequestPrefix===true}:null;
    }
    result[key]={servicesAbsent:boolean(item.servicesAbsent),portsClosed:boolean(item.portsClosed),socketsAbsent:boolean(item.socketsAbsent),launchctlPrint,portsClosedByRole:{compute:boolean(item.portsClosedByRole?.compute),gateway:boolean(item.portsClosedByRole?.gateway)},socketsAbsentByKind:{runtime:boolean(item.socketsAbsentByKind?.runtime),legacy:boolean(item.socketsAbsentByKind?.legacy)}};
  }
  return result;
}

export function safeSupportReport(report) {
  const factKeys = new Set(['installedVersion', 'workstation', 'maxRuns24h', 'maxImages24h', 'journalPresent', 'effectiveRegisteredTools', 'navigationVerified', 'present', 'sha256', 'mode', 'transactionState','policySealVersion','policyHash','nodeVersion','openclawVersion','dockerVersion','recordedOpenclawVersion','runtimeSelection','recordedPolicyHash','observedCandidatePolicyHash','policyEvaluationScope']);
  const facts = value => Object.fromEntries(Object.entries(value ?? {}).filter(([key, v]) => factKeys.has(key) && (v === null || ['string', 'boolean', 'number'].includes(typeof v))));
  const networkFacts = value => {
    if(value?.schema !== 'agi-network-preflight/v1')return {};
    const safeStatus=s=>STATUS.has(s)?s:'BLOCKED', address=a=>typeof a==='string'&&net.isIP(a)?a:null;
    const inventory=value.inventory;
    return {scope:'Native public DNS diagnostics only; not browser qualification',hostname:value.hostname==='example.com'?'example.com':'omitted',status:safeStatus(value.status),administratorActionRequired:value.administratorActionRequired===true,
      inventory:inventory?{interface:/^[a-z][a-z0-9]{0,15}$/.test(inventory.service?.interface??'')?inventory.service.interface:null,configuredDNSMode:['automatic','manual'].includes(inventory.configuredDNS?.mode)?inventory.configuredDNS.mode:'unknown',configuredResolvers:(inventory.configuredDNS?.servers??[]).slice(0,16).map(address).filter(Boolean),effectiveResolvers:(inventory.effectiveDNS??[]).slice(0,16).map(address).filter(Boolean),managementKnown:inventory.managementKnown===true,mdmEnrolled:typeof inventory.mdmEnrolled==='boolean'?inventory.mdmEnrolled:null,splitDNS:inventory.splitDNS===true}:null,
      checks:(value.checks??[]).slice(0,16).map(c=>({id:/^[a-z-]{1,60}$/.test(c.id??'')?c.id:'unknown',status:safeStatus(c.status),code:/^[A-Z][A-Z0-9_]{1,100}$/.test(c.code??'')?c.code:null,dnsStatus:/^[A-Z]{1,30}$/.test(c.dnsStatus??'')?c.dnsStatus:null,resolver:c.resolver==='configured'?'configured':address(c.resolver),answers:(c.answers??c.addresses??[]).slice(0,16).map(address).filter(Boolean)}))};
  };
  const safe = {schema: 'agi-compute-repair-support/v1', runID: report.runID, startedAt: report.startedAt, finishedAt: report.finishedAt, build: report.build, role: report.role, action: report.action, checks: report.checks.map(item => ({id: item.id, status: STATUS.has(item.status) ? item.status : 'BLOCKED', code: /^[A-Z][A-Z0-9_]{1,100}$/.test(item.code ?? '') ? item.code : 'CHECK_RESULT_UNAVAILABLE', remediation: item.remediation, facts: item.id==='network'?networkFacts(item.facts):facts(item.facts)})), services: report.services, currentLogs: report.currentLogs, qualification: report.qualification, walletAccessed: false, settingsChanged: report.settingsChanged === true, budgetsChanged: false, paidProviderCall: false};
  const redact = (value, key = '') => {
    if (/token|secret|password|mnemonic|phrase|private.?key|authorization|oauth|email|account|callback|stdout|stderr|raw|credential|url|cookie/i.test(key)) return '[redacted]';
    if (typeof value === 'string') return value.replace(/(?:https?:\/\/|file:\/\/)[^\s"<>]+/gi, '[URL redacted]').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[account redacted]').replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]').replace(/\b(?:sk-|sess-|eyJ)[A-Za-z0-9._-]{12,}\b/g, '[credential redacted]').replace(/\/(?:Users|home)\/[^/\s]+/g, '/[user]');
    if (Array.isArray(value)) return value.map(item => redact(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
    return value;
  };
  return {...redact(safe), cleanupEvidence:safeCleanupEvidence(report.cleanupEvidence), runtimeIdentity: safeTransactionRuntimeObservation(report.runtimeIdentity), runtimeIdentityQuiescence: safeRuntimeObservationQuiescence(report.runtimeIdentityQuiescence), runtimeIdentityCollection: safeRuntimeIdentityCollection(report.runtimeIdentityCollection), stateSchema: safeStateSchemaObservation(report.stateSchema), savedSetup: safeSavedSetupReport(report.savedSetup)};
}
export function exportSupportReport(report, file) {
  file = path.resolve(file);
  const parent = fs.lstatSync(path.dirname(file)); requireValue(parent.isDirectory() && !parent.isSymbolicLink(), 'REPAIR_EXPORT_DIRECTORY_INVALID');
  fs.writeFileSync(file, JSON.stringify(safeSupportReport(report), null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  return file;
}
function printReport(report) {
  console.log(`\nAGI Compute · Repair and recovery\n${report.build.name} ${report.build.version} · ${report.role} compute\nRead-only inventory ${report.runID}\n`);
  for (const item of report.checks) { console.log(`${item.status.padEnd(10)} ${item.id}: ${item.code}`); if (['FAIL', 'BLOCKED'].includes(item.status) && item.remediation) console.log('           ' + item.remediation); }
  console.log('\nLive provider, tool execution, buyer use, independent review, settlement and 72-hour soak: NOT TESTED.');
}
export async function repairExisting({role = 'agent', home = os.homedir(), rl, signal, setup} = {}) {
  requireValue(process.platform === 'darwin' || setup, 'PHYSICAL_MAC_REQUIRED');
  const profileDir = path.join(home, '.openclaw-'+roleContract(role).profile);
  const settings = jsonFile(path.join(profileDir, 'compute-settings.json'), home), config = jsonFile(path.join(profileDir, 'openclaw.json'), home);
  requireValue(settings.profileDir === profileDir && settings.home === home && settings.gatewayConfig === path.join(profileDir, 'openclaw.json'), 'REPAIR_PROFILE_PATH_MISMATCH');
  const kit = existingSetupKit({...settings, model: config.agents?.defaults?.model?.primary}, role);
  const apply = setup ?? (await import('./setup.mjs')).setupCapable;
  const files = ['service.log', 'service-error.log'].map(file => path.join(profileDir, file));
  let window = startLogWindow(files), serviceLogs = null;
  const onServicesStarting = () => { window = startLogWindow(files); serviceLogs = null; };
  const onServicesFinished = () => { serviceLogs ??= finishLogWindow(window); };
  try { const result = await apply(kit, rl, {repair: true, recoverLock: true, signal, onServicesStarting, onServicesFinished}); return {...result, repairLogs: serviceLogs ?? finishLogWindow(window)}; }
  catch (error) { error.repairLogs = serviceLogs ?? finishLogWindow(window); throw error; }
}
export async function rollbackExisting({role = 'agent', home = os.homedir(), platform = process.platform, uid = process.getuid?.(), run = boundedCommand, probePort = listening, transactionAPI, fileUID = uid, runtimePlatform = platform, stopTimeoutMs, stopPollIntervalMs} = {}) {
  requireValue(COMPUTE_ROLES.includes(role), 'REPAIR_ROLE_INVALID');
  requireValue(platform === 'darwin', 'PHYSICAL_MAC_REQUIRED');
  const groups = await run('/usr/bin/id', ['-Gn']);
  requireValue(uid !== 0 && groups.status === 0 && !groups.stdout.trim().split(/\s+/).includes('admin'), 'STANDARD_COMPUTE_ACCOUNT_REQUIRED');
  const profile = roleContract(role).profile, profileDir = path.join(home, '.openclaw-' + profile), directory = path.join(home, '.agi-genesis-setup-' + role, 'transaction');
  const support = path.dirname(directory); clearInterruptedLock(support); const releaseLock = acquireSetupLock(support);
  try {
  const settings = jsonFile(path.join(profileDir, 'compute-settings.json'), home);
  requireValue(settings.signerUID !== uid && settings.isolationAcknowledged === true, 'SIGNER_COMPUTE_SEPARATION_REQUIRED');
  const api = transactionAPI ?? await import('./setup-transaction.mjs'), status = api.transactionStatus(directory);
  requireValue(status.state !== 'none' && status.profileDir === profileDir && status.previousExisted, 'REPAIR_ROLLBACK_UNAVAILABLE');
  const stop = async () => {
    return stopManagedServices({uid,labels:['ai.montreal.'+profile,'ai.openclaw.'+profile],ports:[roleContract(role).port,roleContract(role).gatewayPort],run,probePort,timeoutMs:stopTimeoutMs,pollIntervalMs:stopPollIntervalMs,checkSockets:signal=>publicBrowserSocketsStopped({profileDir,uid:fileUID,platform:runtimePlatform,signal})});
  };
  requireValue(await stop(), 'REPAIR_STOP_UNCONFIRMED');
  await api.restoreSetupTransaction(directory, {stop: async () => { requireValue(await stop(), 'REPAIR_STOP_UNCONFIRMED'); return true; }});
  const marker = path.join(profileDir, 'COMPUTE_STOP');
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, 'Explicit repair rollback completed. Services are stopped. Preserve journals and requalify this runtime before authorizing new work.\n', {mode: 0o600, flag: 'wx'});
  if (status.serviceBackup) await restoreServiceFiles(status.serviceBackup, {home, stop});
  return {status: 'PASS', code: 'PREVIOUS_PROFILE_RESTORED_SERVICES_STOPPED', automaticRestart: false, paidProviderCall: false};
  } finally { releaseLock(); }
}
export async function repairMain(args = process.argv.slice(2)) {
  const packageName = JSON.parse(fs.readFileSync(path.join(ROOT, '../package.json'), 'utf8')).name;
  let role = JSON.parse(fs.readFileSync(consumerFile('config/companion-releases.json'))).role, output = null, interactive = false, apply = false, rollback = false, restart = false, network = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--role') { role = args[++i]; requireValue(COMPUTE_ROLES.includes(role), 'REPAIR_ROLE_INVALID'); }
    else if (args[i] === '--export') { output = args[++i]; requireValue(Boolean(output), 'REPAIR_EXPORT_PATH_REQUIRED'); }
    else if (args[i] === '--interactive') interactive = true;
    else if (args[i] === '--apply' || args[i] === '--resume') apply = true;
    else if (args[i] === '--rollback') rollback = true;
    else if (args[i] === '--restart') restart = true;
    else if (args[i] === '--network') network = true;
    else if (args[i] === '--help') { console.log('Repair-Compute.command [--role agent|node] [--network] [--export NEW_FILE.json] [--apply|--resume|--rollback|--restart]\nDefault: bounded read-only inventory. Menu 6 collects a sanitized commissioning report including public DNS checks. Restart preserves the current installed configuration and receipt; legacy profiles require reviewed repair. Mutating actions require the Standard compute account and interactive approval. Ctrl+C cancels safely; reopen to resume.'); return 0; }
    else throw Error('REPAIR_ARGUMENT_UNSUPPORTED');
  }
  requireValue([apply,rollback,restart].filter(Boolean).length<=1, 'REPAIR_ARGUMENT_CONFLICT');
  const controller = new AbortController(), cancel = () => controller.abort(Error('REPAIR_CANCELLED'));
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  const rl = (interactive || apply || rollback || restart) && process.stdin.isTTY ? createInterface({input: process.stdin, output: process.stdout}) : null;
  try {
    console.log('Checking this compute profile, service state, dependency versions and policy integrity. No profile settings are changed by this inventory. Each probe is bounded; Ctrl+C cancels.');
    let report = await inventoryCompute({role, signal: controller.signal, network}); printReport(report);
    if (output) console.log('Sanitized support report: ' + exportSupportReport(report, output));
    if (controller.signal.aborted) return 130;
    while (interactive && !apply && !rollback && !restart && rl && !controller.signal.aborted) {
      const choice = (await rl.question('\n1  Export current sanitized report   2  Apply / resume repair   3  Check network\n4  Roll back last repair             5  Restart existing services\n6  Collect commissioning report (includes public DNS checks)\nEnter  Close\nChoose: ', {signal: controller.signal})).trim();
      if (choice === '1') { const file = path.join(os.homedir(), `AGI-${role}-support-${report.runID}-${crypto.randomBytes(3).toString('hex')}.json`); console.log('Sanitized support report: ' + exportSupportReport(report, file)); }
      else if (choice === '2') apply = true;
      else if (choice === '3') { network = true; report = await inventoryCompute({role, signal: controller.signal, network}); printReport(report); }
      else if (choice === '4') rollback = true;
      else if (choice === '5') restart = true;
      else if (choice === '6') { report=await inventoryCompute({role,signal:controller.signal,network:true});printReport(report);requireValue(!controller.signal.aborted,'REPAIR_CANCELLED');console.log('Sanitized commissioning report: '+exportSupportReport(report,path.join(os.homedir(),`AGI-${role}-support-${report.runID}.json`))); }
      else break;
    }
    if (restart) {
      requireValue(rl,'REPAIR_INTERACTIVE_APPROVAL_REQUIRED');
      console.log('Restart preserves this installed configuration, qualification receipt and history. It checks the policy seal and managed services. Earlier stop markers remain paused. Legacy profiles need reviewed repair first.');
      requireValue((await rl.question('Type RESTART to continue, or press Return to cancel: ',{signal:controller.signal})).trim()==='RESTART','REPAIR_CANCELLED');
      const {restartExisting}=await import('./restart.mjs');const result=await restartExisting({role,signal:controller.signal});console.log(JSON.stringify(result,null,2));return result.status==='PASS'?0:2;
    }
    if (apply) {
      requireValue(rl, 'REPAIR_INTERACTIVE_APPROVAL_REQUIRED');
      console.log('\nRepair preserves this profile, wallet separation, authentication, budgets and journals. It privately snapshots configuration and service files, coordinates service interruption, then asks you to review the candidate security changes. Failure leaves the previous profile or an explicit stopped state.');
      requireValue((await rl.question('Type APPLY to begin, or press Return to cancel: ', {signal: controller.signal})).trim() === 'APPLY', 'REPAIR_CANCELLED');
      const result = await repairExisting({role, rl, signal: controller.signal});
      report = await inventoryCompute({role, signal: controller.signal, network}); printReport(report);
      report.action = 'post-repair inventory'; report.settingsChanged = true;
      report.currentLogs = result.repairLogs;
      if (rl && (await rl.question('Save a sanitized support report for this repair? [Y/n]: ', {signal: controller.signal})).trim().toLowerCase() !== 'n') console.log('Sanitized support report: ' + exportSupportReport(report, path.join(os.homedir(), `AGI-${role}-support-${report.runID}.json`)));
    }
    if (rollback) {
      requireValue(rl, 'REPAIR_INTERACTIVE_APPROVAL_REQUIRED');
      console.log('Rollback stops both services and restores the private snapshot. It refuses to erase runtime history created after a completed repair. Services remain stopped; they are not automatically restarted.');
      requireValue((await rl.question('Type ROLLBACK to restore the last repair, or press Return to cancel: ', {signal: controller.signal})).trim() === 'ROLLBACK', 'REPAIR_CANCELLED');
      const result = await rollbackExisting({role}); console.log(result.code);
      report = await inventoryCompute({role, signal: controller.signal, network}); printReport(report);
    }
    return report.exitCode;
  } finally { rl?.close(); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
export function repairFailureText(error, {home = os.homedir()} = {}) {
  if (!error?.supportReport) return `Repair stopped: ${errorCode(error)}. Preserve the existing profile and transaction evidence for technical review.`;
  const report = error.supportReport, lines = ['Repair stopped.', completionText(report)];
  if (report.diagnosticsSaved !== false) {
    const allowed = COMPUTE_ROLES.map(role => path.join(path.resolve(home), '.agi-genesis-setup-' + role));
    if (typeof error.supportDirectory === 'string' && allowed.includes(path.resolve(error.supportDirectory))) lines.push('Saved support report: ' + path.join(error.supportDirectory, 'setup-diagnostics.json'));
    lines.push('Option 6 collects the saved attempt with a fresh read-only commissioning inventory.');
  }
  lines.push(nextSetupAction(report));
  return lines.join('\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  repairMain().then(code => { process.exitCode = code; }).catch(error => { const code = errorCode(error); console.error(repairFailureText(error)); process.exitCode = code === 'REPAIR_CANCELLED' || error.name === 'AbortError' ? 130 : 1; });
}
