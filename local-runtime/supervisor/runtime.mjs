import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT,VERSION,need,id,uuid,label,keys,integer,digest,canonical,parseStrict,packagePolicy,validateTask} from '../contracts.mjs';
import {publicOnly} from '../../fleet/successor/vendor/manager/site/assets/successor/safe.mjs';
import {Store} from './store.mjs';
import {LinuxSandbox} from '../platforms/linux.mjs';
import {defaultMission} from '../../fleet/successor/vendor/manager/site/assets/successor/missions.mjs';
import {successorOperation} from './successor.mjs';
import {validateTaskInput} from '../worker.mjs';

const ASSISTANT_ACTIONS=['status','inspect','prepare','run','cancel','output'];
export function sourceIdentity() {
  const entries=[];
  function walk(rel) {
    const file=path.join(ROOT,rel),s=fs.lstatSync(file);
    if(s.isSymbolicLink()) { const target=fs.realpathSync(file);need(rel.startsWith('fleet/node_modules/')&&target.startsWith(path.join(ROOT,'fleet/node_modules/')),'SOURCE_LINK_FORBIDDEN');entries.push([rel,fs.readlinkSync(file)]);return; }
    if(s.isDirectory()) for(const name of fs.readdirSync(file).sort())walk(rel+'/'+name);
    else {need(s.isFile()&&s.size<=8_000_000,'SOURCE_FILE_INVALID');entries.push([rel,digest(fs.readFileSync(file))]);}
  }
  // Bind the facade plus every reused business/security module; never modify Fleet seals.
  for(const rel of ['local-runtime','role-skills','local-dashboard','fleet/shared','fleet/successor','fleet/node_modules'])walk(rel);
  entries.push(['fleet/package-lock.json',digest(fs.readFileSync(path.join(ROOT,'fleet/package-lock.json')))]);
  return digest(entries);
}
export class LocalRuntime {
  constructor(directory,{create=false,backend=new LinuxSandbox(),now=Date.now}={}) {
    this.store=new Store(directory,{create});this.backend=backend;this.now=now;this.active=new Map();this.stoppedActors=new Set();this.source=sourceIdentity();this.directory=directory;
    fs.mkdirSync(path.join(directory,'runs'),{recursive:true,mode:0o700});
  }
  issueClient(actor=null) {
    if(actor!==null)this.store.actor(uuid(actor));
    const token=crypto.randomBytes(32).toString('hex'),hash=digest(token),principal={hash,actor,operator:actor===null,actions:actor?ASSISTANT_ACTIONS:null,createdAt:this.now()};
    this.store.db.prepare('INSERT INTO clients VALUES(?,?)').run(hash,canonical(principal));return {token,principal};
  }
  authenticate(token) {
    need(typeof token==='string'&&/^[a-f0-9]{64}$/.test(token),'AUTH_REQUIRED');
    const r=this.store.db.prepare('SELECT value FROM clients WHERE hash=?').get(digest(token));need(r,'AUTH_REQUIRED');return parseStrict(r.value);
  }
  scope(p,action,actor=null) {need(p&&this.store.db.prepare('SELECT 1 FROM clients WHERE hash=?').get(p.hash),'AUTH_REQUIRED');need(p.operator||(p.actions.includes(action)&&actor===p.actor),'CLIENT_SCOPE_DENIED');}
  doctor(){return {...this.backend.inspect(),runtime:VERSION,sourceSha256:this.source,roles:['agent','node','moderator','employer','evidence','recovery'],economicAuthority:'disabled',liveProvider:'NOT_RUN',supportedClient:'CLI v1; assistant integration NOT_RUN'};}
  addActor(input,p) {
    this.scope(p,'create');keys(input,['role','name']);label(input.name);const pkg=packagePolicy(input.role);
    need(this.store.listActors().length<64,'ACTOR_LIMIT');
    const actor={schema:'agi-fleet/local-actor/v1',id:id(),name:input.name,role:input.role,controller:this.store.meta('controller'),packageSha256:pkg.sha256,registrySha256:pkg.registry,host:null,generation:0,active:false,stopped:false,sourceActor:null,maxRuns:64};
    this.store.transaction(()=>{this.store.saveActor(actor);this.store.event('actor-created',{id:actor.id,role:actor.role});});return actor;
  }
  activate(input,p) {
    this.scope(p,'activate');keys(input,['actor','confirm']);need(input.confirm===true,'CONFIRM_REQUIRED');
    const host=this.doctor();need(host.supported,host.code);need(sourceIdentity()===this.source,'RUNTIME_CHANGED_RESTART_REQUIRED');
    return this.store.transaction(()=>{
      const actor=this.store.actor(uuid(input.actor));need(!actor.stopped&&!this.store.meta('stopped'),'STOP_RECONCILIATION_REQUIRED');
      const pkg=packagePolicy(actor.role);actor.packageSha256=pkg.sha256;actor.registrySha256=pkg.registry;
      actor.host={schema:'agi-fleet/local-binding/v1',host:this.store.meta('host'),backend:host.backend,identity:host.identity,sourceSha256:this.source,authority:'bounded-offline-only'};
      actor.generation++;actor.active=true;this.store.saveActor(actor);
      this.store.db.prepare("UPDATE grants SET state='revoked' WHERE actor=? AND state IN ('prepared','authorized')").run(actor.id);
      this.store.event('actor-activated',{actor:actor.id,generation:actor.generation});return actor;
    });
  }
  ready(actor) {
    need(!this.emergency&&!this.stoppedActors.has(actor.id),'STOP_RECONCILIATION_REQUIRED');
    need(!this.store.meta('stopped')&&!actor.stopped,'STOP_RECONCILIATION_REQUIRED');
    need(actor.active&&actor.host?.host===this.store.meta('host'),'ACTIVATION_REQUIRED');
    const pkg=packagePolicy(actor.role);need(pkg.sha256===actor.packageSha256&&pkg.registry===actor.registrySha256,'PACKAGE_REBIND_REQUIRED');
    need(sourceIdentity()===this.source&&actor.host.sourceSha256===this.source,'RUNTIME_REBIND_REQUIRED');
    const h=this.backend.inspect();need(h.supported,h.code);need(h.identity===actor.host.identity,'HOST_REBIND_REQUIRED');return h;
  }
  prepare(input,p) {
    keys(input,['actor','task']);this.scope(p,'prepare',input.actor);const actor=this.store.actor(uuid(input.actor));this.ready(actor);
    need(!this.store.meta('paused'),'INTAKE_PAUSED');validateTaskInput(actor.role,input.task);
    const publicView=structuredClone(input.task);
    if(input.task.action==='protocol-inspect') {
      // This inert, schema-required field belongs to the existing config format;
      // it is never fetched or passed to a model by the offline inspector.
      need(/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(publicView.input?.config?.gatewayURL),'GATEWAY_LOOPBACK_REQUIRED');
      delete publicView.input.config.gatewayURL;
    }
    publicOnly(canonical(publicView));
    need(this.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n<4096,'GRANT_HISTORY_FULL');
    if(actor.role==='node'&&input.task.review==='independent'){
      need(input.task.sourceActor!==actor.id&&input.task.sourceController!==actor.controller,'KNOWN_REVIEW_CONFLICT');
      need(false,'INDEPENDENT_REVIEW_NOT_QUALIFIED');
    }
    const at=this.now();const grant={schema:'agi-fleet/local-grant/v1',id:id(),actor:actor.id,principal:p.hash,task:input.task,inputSha256:digest(input.task),packageSha256:actor.packageSha256,host:actor.host,generation:actor.generation,createdAt:at,expiresAt:at+300000,limits:{wallMs:15000,cpuSeconds:10,heapMiB:128,outputBytes:2000000,modelCalls:0,spendUSDC:'0',actions:1},review:input.task.review,authority:'bounded-offline-only'};
    this.store.transaction(()=>{const used=this.store.db.prepare('SELECT COALESCE(SUM(length(value)),0) AS bytes FROM grants').get().bytes;need(used+Buffer.byteLength(canonical(grant))<=32_000_000,'GRANT_HISTORY_FULL');this.store.db.prepare('INSERT INTO grants VALUES(?,?,?,?)').run(grant.id,actor.id,canonical(grant),'prepared');});
    return {grant:grant.id,commitment:digest(grant),actor:actor.id,task:grant.task,limits:grant.limits,expiresAt:grant.expiresAt,confirmationRequired:true};
  }
  authorize(input,p) {
    this.scope(p,'authorize');keys(input,['grant','commitment','confirm']);need(input.confirm===true,'CONFIRM_REQUIRED');
    return this.store.transaction(()=>{
      const row=this.store.db.prepare('SELECT * FROM grants WHERE id=?').get(uuid(input.grant));need(row&&row.state==='prepared','GRANT_NOT_PREPARED');
      const g=parseStrict(row.value);need(digest(g)===input.commitment,'GRANT_CHANGED');need(this.now()>=g.createdAt&&this.now()<g.expiresAt,'GRANT_EXPIRED');
      const actor=this.store.actor(g.actor);this.ready(actor);need(g.generation===actor.generation,'GRANT_REVOKED');
      this.store.db.prepare("UPDATE grants SET state='authorized' WHERE id=?").run(g.id);this.store.event('grant-authorized',{id:g.id,commitment:input.commitment});return {grant:g.id,state:'authorized'};
    });
  }
  async run(input,p) {
    keys(input,['actor','grant']);this.scope(p,'run',input.actor);const actor=this.store.actor(uuid(input.actor));this.ready(actor);
    const g=this.store.transaction(()=>{
      const row=this.store.db.prepare('SELECT * FROM grants WHERE id=?').get(uuid(input.grant));need(row&&row.actor===actor.id&&row.state==='authorized','GRANT_UNAVAILABLE');
      const grant=parseStrict(row.value),now=this.now();need(grant.principal===p.hash,'GRANT_PRINCIPAL');
      need(now>=grant.createdAt&&now<grant.expiresAt&&now>=this.store.meta('clock'),'GRANT_EXPIRED_OR_CLOCK_CHANGED');
      need(grant.generation===actor.generation&&canonical(grant.host)===canonical(actor.host)&&grant.packageSha256===actor.packageSha256,'GRANT_REVOKED');
      const active=this.store.db.prepare("SELECT actor FROM runs WHERE state='running'").all();
      need(active.length<this.store.meta('maxConcurrent')&&!active.some(x=>x.actor===actor.id),'QUEUE_CAPACITY');
      const recent=this.store.db.prepare('SELECT actor,value FROM runs').all().filter(r=>parseStrict(r.value).reservedAt>now-86400000);
      need(recent.length<this.store.meta('maxRuns')&&recent.filter(r=>r.actor===actor.id).length<actor.maxRuns,'DAILY_BUDGET_EXHAUSTED');
      const total=this.store.db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(length(value)+length(COALESCE(result,\'\'))),0) AS bytes FROM runs').get();
      need(total.count<4096&&total.bytes<64_000_000,'HISTORY_CAPACITY_EXPORT_REQUIRED');
      this.store.db.prepare("UPDATE grants SET state='consumed' WHERE id=?").run(grant.id);
      this.store.set('clock',now);const run={id:id(),grant:grant.id,inputSha256:grant.inputSha256,reservedAt:now,role:actor.role,review:grant.review,sourceSha256:this.source,packageSha256:actor.packageSha256,host:actor.host,authority:'none',inference:'none',spendUSDC:'0'};
      this.store.db.prepare("INSERT INTO runs VALUES(?,?,?,'running',?,NULL)").run(run.id,actor.id,grant.id,canonical(run));this.store.event('run-reserved',{id:run.id,actor:actor.id,grant:grant.id});return {...grant,run};
    });
    const abort=new AbortController();this.active.set(g.run.id,{abort,actor:actor.id,grant:g.id,principal:p.hash});
    let directory;
    try {
      directory=fs.mkdtempSync(path.join(this.directory,'runs',g.run.id+'-'));fs.chmodSync(directory,0o700);
      const result=await this.backend.execute({role:actor.role,task:g.task,directory,signal:abort.signal});
      abort.signal.throwIfAborted();need(result.observation?.processGroupGone===true,'CLEANUP_UNCONFIRMED');
      need(Buffer.byteLength(canonical(result))<=2_100_000,'OUTPUT_LIMIT');
      const receipt={...result,outputSha256:digest(result.result),inputSha256:g.inputSha256,independentReview:false,sourceActor:actor.id,sourceController:actor.controller,authority:'none'};
      this.store.transaction(()=>{this.store.db.prepare("UPDATE runs SET state='complete',result=? WHERE id=?").run(canonical(receipt),g.run.id);this.store.event('run-complete',{id:g.run.id,outputSha256:receipt.outputSha256});});
      return {run:g.run.id,state:'complete',receipt};
    } catch(e) {
      this.emergency=true;
      const code=/^[A-Z0-9_]{1,100}$/.test(e.code||e.message)?e.code||e.message:'FAILED_OR_UNCERTAIN';
      this.store.transaction(()=>{
        this.store.db.prepare("UPDATE runs SET state='uncertain',result=? WHERE id=?").run(canonical({error:code,observation:e.observation??null}),g.run.id);
        this.store.set('stopped',true);this.store.event('run-uncertain',{id:g.run.id,code});
      });throw Object.assign(new Error(code),{code,run:g.run.id});
    } finally {this.active.delete(g.run.id);}
  }
  stop(input,p) {
    this.scope(p,'stop');keys(input,['actor']);if(input.actor!==null)uuid(input.actor);
    if(input.actor===null)this.emergency=true;else {this.store.actor(input.actor);this.stoppedActors.add(input.actor);}
    try {this.store.transaction(()=>{
      if(input.actor===null)this.store.set('stopped',true);else {const a=this.store.actor(input.actor);a.stopped=true;a.active=false;this.store.saveActor(a);}
      this.store.db.prepare("UPDATE grants SET state='revoked' WHERE state IN ('prepared','authorized')"+(input.actor?' AND actor=?':'')).run(...(input.actor?[input.actor]:[]));
      this.store.event('stop-requested',{actor:input.actor});
    });} finally {for(const r of this.active.values())if(input.actor===null||r.actor===input.actor)r.abort.abort();}
    return {state:'STOP',cleanup:this.active.size?'in-progress':'no-active-worker',obligations:'Inspect uncertain runs; STOP does not undo external actions.'};
  }
  cancel(input,p) {
    keys(input,['actor','run']);this.scope(p,'cancel',input.actor);const row=this.store.db.prepare('SELECT actor FROM runs WHERE id=?').get(uuid(input.run));need(row?.actor===input.actor,'RUN_UNKNOWN');
    this.active.get(input.run)?.abort.abort();return {run:input.run,cancellationRequested:true};
  }
  revoke(input,p) {
    this.scope(p,'revoke');keys(input,['grant']);uuid(input.grant);
    const r=this.store.db.prepare('SELECT state FROM grants WHERE id=?').get(input.grant);need(r,'GRANT_UNAVAILABLE');
    try{this.store.db.prepare("UPDATE grants SET state='revoked' WHERE id=? AND state IN ('prepared','authorized')").run(input.grant);}
    catch(e){this.emergency=true;throw e;}
    finally{for(const x of this.active.values())if(x.grant===input.grant)x.abort.abort();}
    return {revoked:true,priorState:r.state,replayAllowed:false};
  }
  revokeClient(input,p) {
    this.scope(p,'revoke-client');keys(input,['client']);need(/^[a-f0-9]{64}$/.test(input.client),'CLIENT_INVALID');
    try{this.store.transaction(()=>{this.store.db.prepare('DELETE FROM clients WHERE hash=?').run(input.client);const rows=this.store.db.prepare("SELECT id,value FROM grants WHERE state IN ('prepared','authorized')").all();for(const r of rows)if(parseStrict(r.value).principal===input.client)this.store.db.prepare("UPDATE grants SET state='revoked' WHERE id=?").run(r.id);});}
    catch(e){this.emergency=true;throw e;}
    finally{for(const x of this.active.values())if(x.principal===input.client)x.abort.abort();}
    return {revoked:true};
  }
  pause(input,p) {this.scope(p,'pause');keys(input,['paused']);need(typeof input.paused==='boolean','FIELDS_INVALID');this.store.set('paused',input.paused);return {paused:input.paused,acceptedWork:'continues until completed or explicitly stopped'};}
  resume(input,p) {
    this.scope(p,'resume');keys(input,['confirm']);need(input.confirm===true,'CONFIRM_REQUIRED');
    need(!this.active.size,'CLEANUP_PENDING');need(!this.store.db.prepare("SELECT 1 FROM runs WHERE state IN ('running','uncertain')").get(),'UNCERTAIN_RUN_RECONCILIATION_REQUIRED');
    const h=this.doctor();need(h.supported,h.code);
    this.store.transaction(()=>{this.store.set('stopped',false);for(const a of this.store.listActors()){a.stopped=false;a.active=false;a.host=null;this.store.saveActor(a);}this.store.event('resume-requires-reactivation',{});});this.emergency=false;this.stoppedActors.clear();return {state:'reactivation-required',grantsRestored:false};
  }
  status(p) {
    this.scope(p,'status',p.actor);const actors=this.store.listActors().filter(a=>p.operator||a.id===p.actor);
    const runs=this.store.db.prepare('SELECT id,actor,state,value FROM runs ORDER BY rowid DESC LIMIT 100').all().filter(r=>p.operator||r.actor===p.actor).map(r=>({...r,value:parseStrict(r.value)}));
    return {schema:'agi-fleet/local-status/v1',stopped:this.emergency===true||this.store.meta('stopped'),paused:this.store.meta('paused'),actors,runs,productionQualified:false,economicAuthority:false};
  }
  output(input,p) {keys(input,['actor','run']);this.scope(p,'output',input.actor);const r=this.store.db.prepare('SELECT actor,state,result FROM runs WHERE id=?').get(uuid(input.run));need(r&&r.actor===input.actor,'RUN_UNKNOWN');return {state:r.state,receipt:r.result?parseStrict(r.result):null};}
  exportActor(input,p) {
    this.scope(p,'export');keys(input,['actor']);const a=this.store.actor(uuid(input.actor));
    need(!this.store.db.prepare("SELECT 1 FROM runs WHERE actor=? AND state IN ('running','uncertain')").get(a.id),'EXPORT_QUIESCE_REQUIRED');
    // Positive allowlist: no live database, host binding, token, grant or credential fields.
    const payload={schema:'agi-fleet/portable-role/v1',role:a.role,name:a.name,sourceActor:a.id,packageSha256:a.packageSha256,authority:'none'};
    publicOnly(canonical(payload));return {payload,sha256:digest(payload)};
  }
  importActor(input,p) {
    this.scope(p,'import');keys(input,['capsule','confirm']);need(input.confirm===true,'CONFIRM_REQUIRED');keys(input.capsule,['payload','sha256']);
    const v=input.capsule.payload;keys(v,['schema','role','name','sourceActor','packageSha256','authority']);
    need(v.schema==='agi-fleet/portable-role/v1'&&v.authority==='none'&&digest(v)===input.capsule.sha256,'PORTABLE_IDENTITY');uuid(v.sourceActor);publicOnly(canonical(v));need(v.packageSha256===packagePolicy(v.role).sha256,'PACKAGE_REBIND_REQUIRED');
    const a=this.addActor({role:v.role,name:v.name},p);a.sourceActor=v.sourceActor;this.store.saveActor(a);this.store.event('portable-import-inert',{actor:a.id,sourceActor:v.sourceActor});return a;
  }
  async dispatch(action,input,p) {
    if(['project-assemble','project-select','project-export','project-import'].includes(action))return successorOperation(this,action,input,p);
    const methods={create:'addActor',activate:'activate',prepare:'prepare',authorize:'authorize',run:'run',stop:'stop',cancel:'cancel',revoke:'revoke','revoke-client':'revokeClient',pause:'pause',resume:'resume',output:'output',export:'exportActor',import:'importActor'};
    if(action==='status')return this.status(p);
    if(action==='doctor'){this.scope(p,'doctor');return this.doctor();}
    if(action==='example'){this.scope(p,'example');keys(input,['kind','language']);need(['analyst','website'].includes(input.kind)&&['en','fr'].includes(input.language),'EXAMPLE_INVALID');return defaultMission(input.kind,input.language);}
    if(action==='client'){this.scope(p,'client');keys(input,['actor']);return this.issueClient(uuid(input.actor));}
    if(action==='inspect'){this.scope(p,'inspect',input.actor);return this.store.actor(uuid(input.actor));}
    need(Object.hasOwn(methods,action),'ACTION_UNKNOWN');return await this[methods[action]](input,p);
  }
  close(){need(this.active.size===0,'WORKERS_ACTIVE');this.store.close();}
}
