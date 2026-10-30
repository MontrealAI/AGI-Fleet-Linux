// SPDX-License-Identifier: MIT
// One private project history; every execution/review control remains explicit.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {parseArgs} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {canonical,parseStrict,need,uuid,decodeUTF8} from '../primitives.mjs';
import {readPrivate} from '../private-file.mjs';
import {Store,privateDirectory} from '../supervisor/store.mjs';
import {TIProjectStore} from './store.mjs';
import {openInstalledTI,nativeCLI} from './installed.mjs';
import {createTIProject,appendTIProject,inspectTIProject,summaryHTML,createSummaryHandoff} from './project.mjs';

const sha=value=>createHash('sha256').update(typeof value==='string'||ArrayBuffer.isView(value)?value:canonical(value)).digest('hex');
const options={};
for(const name of ['state','sources','python','project','file','output','binding','operation','freeze','trust','producer','behavior','signed','context','profile','grant','commitment'])options[name]={type:'string'};
for(const name of ['confirm-public-demo','confirm-native-browser','recover-interrupted-browser'])options[name]={type:'boolean',default:false};
const {values:v,positionals}=parseArgs({options,allowPositionals:true});
const action=positionals[0];
function raw(file,max=12_000_000) {
  need(path.isAbsolute(file??'')&&fs.realpathSync(file)===file,'TI_ABSOLUTE_REGULAR_INPUT');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try {const stat=fs.fstatSync(fd);need(stat.isFile()&&stat.size<=max,'TI_INPUT_SIZE');return decodeUTF8(fs.readFileSync(fd));}
  finally {fs.closeSync(fd);}
}
function write(file,value) {fs.writeFileSync(file,typeof value==='string'?value:canonical(value),{mode:0o600,flag:'wx'});}
async function openBrowserRuntime(directory,options={}) {
  // Own the same private endpoint used by normal service recovery before
  // opening or changing its ledger. A live CLI must never look abandoned.
  privateDirectory(directory,{create:options.create===true});
  const fence=net.createServer(connection=>connection.destroy());let runtime;
  try {
    await new Promise((resolve,reject)=>{fence.once('error',reject);fence.listen(path.join(directory,'control.sock'),resolve);});
    fs.chmodSync(path.join(directory,'control.sock'),0o600);
    const {LocalRuntime}=await import('../supervisor/runtime.mjs');
    runtime=new LocalRuntime(directory,options);
    return {runtime,close:async()=>{try{await new Promise(resolve=>fence.close(resolve));}finally{runtime.close();}}};
  } catch(error) {
    try{runtime?.close();}finally{if(fence.listening)await new Promise(resolve=>fence.close(resolve));}
    throw error;
  }
}
let installed,store;
try {
  need(path.isAbsolute(v.state??'')&&path.isAbsolute(v.sources??''),'TI_EXPLICIT_INSTALLATION_REQUIRED');
  // Create the existing private ledger first; it rejects checkout state and symlinks.
  privateDirectory(v.state,{create:true});
  const sources=parseStrict(raw(v.sources,100_000));
  installed=await openInstalledTI(sources,path.join(v.state,'capture-'+randomUUID()));
  const r=installed.receivers,history={...r,manager:undefined,jobs:undefined};
  store=new TIProjectStore(v.state,history,{create:!fs.existsSync(path.join(v.state,'ledger.sqlite'))});
  if(['demo','export','attach-computer','browser-run','browser-capture','prepare-handoff','archive-reuse'].includes(action)) {
    need(path.isAbsolute(v.output??'')&&fs.realpathSync(path.dirname(v.output))===path.dirname(v.output),'TI_NEW_OUTPUT_REQUIRED');
    let exists=false;try{fs.lstatSync(v.output);exists=true;}catch(error){need(error.code==='ENOENT','TI_OUTPUT_PREFLIGHT');}
    need(!exists,'TI_NEW_OUTPUT_REQUIRED');
  }
  const homeKey=id=>'ti-native-home:'+id;
  const home=id=>{uuid(id);const file=store.store.meta(homeKey(id));need(typeof file==='string','TI_NATIVE_LOCAL_HISTORY_REQUIRED');return file;};
  function publicSnapshot(id,file,label,max=100_000) {
    const checkedRaw=raw(file,max);r.public(parseStrict(checkedRaw,max));
    const snapshot=path.join(home(id),label+'-'+randomUUID()+'.json');write(snapshot,checkedRaw);return snapshot;
  }
  async function current(id) {
    const value=nativeCLI(installed,v.python,home(id),['current-binding',id]);
    need(value.matches_retained===true,'TI_NATIVE_CURRENT_BINDING_REQUIRED');
    installed.trustRuntimeBinding(id,value.bindings_digest);return value;
  }
  async function saveExtension(prior,kind,eventRaw) {
    const next=await appendTIProject(prior,kind,eventRaw,history);await store.save(next,prior);return next;
  }
  async function capture(id) {
    const prior=await store.get(id);need(prior,'TI_PROJECT_UNKNOWN');
    const destination=path.join(home(id),'project-export-'+randomUUID()+'.json');
    nativeCLI(installed,v.python,home(id),['successor-transform','export',id,'--output',destination]);
    const eventRaw=raw(destination),checked=await inspectTIProject(prior,history);
    if(checked.nativeRaw===eventRaw)return prior;
    return saveExtension(prior,checked.native===null?'native-result':'native-update',eventRaw);
  }
  async function publish(project,browserRecovery=null) {
    need(path.isAbsolute(v.output??'')&&fs.realpathSync(path.dirname(v.output))===path.dirname(v.output),'TI_NEW_OUTPUT_REQUIRED');
    const checked=await inspectTIProject(project,history);
    fs.mkdirSync(v.output,{mode:0o700});
    write(path.join(v.output,'project.json'),project);
    write(path.join(v.output,'native-request.json'),checked.project.history[0].raw);
    if(checked.nativeRaw)write(path.join(v.output,'native-result.json'),checked.nativeRaw);
    if(checked.native?.phase==='completed')write(path.join(v.output,'summary.html'),await summaryHTML(checked.nativeRaw,r.native));
    if(checked.handoffRaw)write(path.join(v.output,'computer-handoff.json'),checked.handoffRaw);
    const selection=store.store.meta('ti-library-route:'+checked.project.projectId);
    if(selection)write(path.join(v.output,'reuse-selection.json'),selection);
    write(path.join(v.output,'sources.json'),installed.records);
    if(browserRecovery!==null)write(path.join(v.output,'browser-recovery.json'),browserRecovery);
    const files=fs.readdirSync(v.output).sort().map(name=>({name,sha256:sha(fs.readFileSync(path.join(v.output,name))),bytes:fs.statSync(path.join(v.output,name)).size}));
    write(path.join(v.output,'checksums.json'),{files,authority:'none',independentReview:false,productionQualified:false});
    return {projectId:checked.project.projectId,revision:checked.project.revision,output:v.output,
      summaries:checked.summaries,authority:'none',independentReview:false,settlement:'not-connected'};
  }
  let result;
  if(action==='demo') {
    need(v['confirm-public-demo']===true,'TI_PUBLIC_DEMO_CONFIRMATION_REQUIRED');
    let directory=path.join(v.state,'native-'+randomUUID());const nativeOutput=path.join(v.state,'native-'+randomUUID()+'.json');
    nativeCLI(installed,v.python,directory,['successor-transform','demo','--output',nativeOutput]);
    const nativeRaw=raw(nativeOutput),native=await r.native(nativeRaw),id=native.campaign_id;
    const retainedHome=path.join(v.state,'native-'+id);fs.renameSync(directory,retainedHome);directory=retainedHome;
    let project=await createTIProject(canonical(native.bindings.request),r);
    await store.save(project,null,{nativeHome:directory});
    project=await saveExtension(project,'native-result',nativeRaw);await current(id);
    for(const [kind,name] of [['manager-inspection','manager'],['jobs-inspection','jobs']])
      project=await saveExtension(project,kind,canonical(await r[name](nativeRaw)));
    const handoff=await createSummaryHandoff(nativeRaw,{inspectNative:r.native,...installed.project,...installed.computer});
    project=await saveExtension(project,'computer-handoff',handoff);
    const identity=nativeCLI(installed,v.python,directory,['verify']).identity;
    const trust=path.join(directory,'ti-producer-trust.json'),conditions=path.join(directory,'ti-reuse-conditions.json'),archive=path.join(directory,'ti-reuse-archive.json');
    write(trust,{schema_version:1,principals:{'ti-project-producer':{public_key:identity.split(':').at(-1),roles:['producer'],provenance:'local',independence_attestation:''}}});
    write(conditions,{method_id:'public-summary-closure',version:1,producer:'ti-project-producer',supported_scope:['fixed-summary-public-source'],
      prerequisites:['audited-acyclic-annotations'],failure_conditions:['unreliable-annotations'],retirement_triggers:['code, source or instrument changes'],
      costs:{setup_units:native.result.costs.search_units,per_use_units:native.result.costs.execution_units},
      evidence_digests:[native.freeze.digest,sha('successor-omega/v1:ti-library-result\0'+canonical(native.result))],evidence_scope:'local-structural-only'});
    nativeCLI(installed,v.python,directory,['successor-library','--trust',trust,'--producer','ti-project-producer','--output',archive,
      'archive',nativeOutput,conditions,'--operation-id','project-archive']);
    project=await saveExtension(project,'reuse-archive',raw(archive));result=await publish(project);
    result.browserExecution='pending-separate-native-grant';result.reuse='pending-separately-signed-review';
  } else if(action==='start') {
    const project=raw(v.file),checked=await inspectTIProject(project,history);
    need(checked.project.revision===0,'TI_INITIAL_REQUEST_REQUIRED');
    const id=checked.project.projectId,directory=path.join(v.state,'native-'+id);
    const existing=await store.get(id);need(existing===null||existing===project,'TI_NEW_PROJECT_REQUIRED');
    await store.save(project,existing,{nativeHome:directory});
    if(!fs.existsSync(directory))nativeCLI(installed,v.python,directory,['init']);
    else nativeCLI(installed,v.python,directory,['verify']);
    const request=path.join(directory,'ti-request.json');
    if(fs.existsSync(request))need(raw(request)===checked.project.history[0].raw,'TI_RETAINED_REQUEST_CHANGED');
    else write(request,checked.project.history[0].raw);
    const created=nativeCLI(installed,v.python,directory,['successor-transform','create',request]);
    result={projectId:id,state:'queued',binding:created.binding_digest,next:'Inspect the exact charter/costs and separately approve this binding.',authority:'none'};
  } else if(action==='refresh') {
    const id=uuid(v.project),project=await capture(id);
    result={projectId:id,summaries:(await inspectTIProject(project,history)).summaries,
      recovery:'retained-native-history-only-no-control-or-replay',authority:'none'};
  } else if(['approve','step','confirm','pause','resume','cancel'].includes(action)) {
    const id=uuid(v.project),args=['successor-transform',action,id];
    if(!['pause','cancel'].includes(action)) {
      const retained=await store.get(id);need(retained,'TI_PROJECT_UNKNOWN');
      need((await inspectTIProject(retained,history)).project.history.length<24,'TI_PROJECT_HISTORY_CAPACITY');
    }
    if(action==='approve'){need(/^[a-f0-9]{64}$/.test(v.binding??''),'TI_EXACT_BINDING_REQUIRED');args.push('--binding',v.binding);}
    if(action==='step'){need(typeof v.operation==='string'&&v.operation.length>0,'TI_OPERATION_REQUIRED');args.push('--operation-id',v.operation);}
    if(action==='confirm')args.push(publicSnapshot(id,v.file,'confirmation',2_000_000),'--freeze',v.freeze);
    nativeCLI(installed,v.python,home(id),args);const project=await capture(id);
    result={projectId:id,summaries:(await inspectTIProject(project,history)).summaries,authority:'none'};
  } else if(action==='inspect-routes') {
    const id=uuid(v.project);await current(id);let project=await store.get(id);need(project,'TI_PROJECT_UNKNOWN');
    const checked=await inspectTIProject(project,history);need(checked.native?.phase==='completed','TI_COMPLETED_RESULT_REQUIRED');
    for(const [kind,name] of [['manager-inspection','manager'],['jobs-inspection','jobs']]) {
      const next=await appendTIProject(project,kind,canonical(await r[name](checked.nativeRaw)),r);
      await store.save(next,project);project=next;
    }
    result={projectId:id,summaries:(await inspectTIProject(project,r)).summaries,authority:'none'};
  } else if(action==='prepare-handoff') {
    const id=uuid(v.project),project=await store.get(id);need(project,'TI_PROJECT_UNKNOWN');
    const checked=await inspectTIProject(project,history);need(checked.native?.phase==='completed','TI_COMPLETED_RESULT_REQUIRED');
    if(checked.handoffRaw)result=await publish(project);
    else {
      const handoff=await createSummaryHandoff(checked.nativeRaw,{inspectNative:r.native,...installed.project,...installed.computer});
      result=await publish(await saveExtension(project,'computer-handoff',handoff));
    }
  } else if(action==='archive-reuse') {
    const id=uuid(v.project);await current(id);const project=await store.get(id);need(project,'TI_PROJECT_UNKNOWN');
    const checked=await inspectTIProject(project,history);need(checked.native?.phase==='completed'&&checked.archive===null,'TI_NEW_COMPLETED_ARCHIVE_REQUIRED');
    need(typeof v.producer==='string'&&v.producer.length>0,'TI_EXPLICIT_LIBRARY_PRODUCER_REQUIRED');
    const conditions=publicSnapshot(id,v.file,'reuse-conditions'),trust=publicSnapshot(id,v.trust,'library-trust');
    const nativeFile=path.join(home(id),'archive-envelope-'+randomUUID()+'.json'),archive=path.join(home(id),'archive-'+randomUUID()+'.json');
    write(nativeFile,checked.nativeRaw);
    nativeCLI(installed,v.python,home(id),['successor-library','--trust',trust,'--producer',v.producer,'--output',archive,
      'archive',nativeFile,conditions,'--operation-id',v.operation]);
    result=await publish(await saveExtension(project,'reuse-archive',raw(archive)));
  } else if(action==='attach-computer') {
    const id=uuid(v.project),project=await store.get(id);need(project,'TI_PROJECT_UNKNOWN');
    const next=await saveExtension(project,'computer-return',raw(v.file));result=await publish(next);
  } else if(action==='browser-prepare') {
    const id=uuid(v.project),project=await store.get(id);need(project,'TI_PROJECT_UNKNOWN');
    const checked=await inspectTIProject(project,history);need(checked.handoffRaw,'TI_BROWSER_HANDOFF_REQUIRED');
    const {LinuxSandbox}=await import('../platforms/linux.mjs');
    const readiness=new LinuxSandbox({computerConfigFile:v.profile}).inspect();
    need(readiness.supported,readiness.code);need(readiness.alphaComputer?.supported,readiness.alphaComputer?.code??'TI_BROWSER_PROFILE_REQUIRED');
    const directory=path.join(v.state,'browser-'+id);
    const opened=await openBrowserRuntime(directory,{create:!fs.existsSync(directory),computerConfigFile:v.profile}),{runtime}=opened;
    try {
      need(runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n===0,'TI_BROWSER_EXISTING_ATTEMPT_REVIEW_REQUIRED');
      let credential=runtime.store.meta('ti-browser-credential'),principal;
      if(credential)principal=runtime.authenticate(decodeUTF8(readPrivate(credential)));
      else {
        const issued=runtime.issueClient();credential=path.join(directory,'operator-'+randomUUID()+'.credential');
        write(credential,issued.token);runtime.store.set('ti-browser-credential',credential);principal=issued.principal;
      }
      const actors=runtime.store.listActors();need(actors.length<=1,'TI_BROWSER_ACTOR_REVIEW_REQUIRED');
      const actor=actors[0]??runtime.addActor({role:'agent',name:'TI summary browser'},principal);
      const prior=runtime.store.meta('ti-browser-session');
      let grant;
      if(prior?.prepared?.expiresAt>Date.now()) {
        runtime.ready(actor);const row=runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(prior.grant);
        need(row?.state==='prepared','TI_BROWSER_EXISTING_GRANT_REVIEW_REQUIRED');grant=prior.prepared;
      } else {
        runtime.activate({actor:actor.id,confirm:true},principal);
        grant=runtime.prepare({actor:actor.id,task:{schema:'agi-fleet/local-task/v1',action:'alpha-computer-run',workspace:'files',
          input:{handoffRaw:checked.handoffRaw,publicNonpersonal:true},review:'none',sourceActor:null,sourceController:null}},principal);
        runtime.store.set('ti-browser-session',{projectId:id,actor:actor.id,grant:grant.grant,commitment:grant.commitment,prepared:grant});
      }
      result={projectId:id,prepared:grant,executed:false,next:'Inspect this exact task/profile/limits, then separately authorize its grant and commitment.',authority:'none'};
    } finally {await opened.close();}
  } else if(action==='browser-run') {
    need(v['confirm-native-browser']===true,'TI_NATIVE_BROWSER_CONFIRMATION_REQUIRED');
    const id=uuid(v.project),project=await store.get(id);need(project,'TI_PROJECT_UNKNOWN');
    const directory=path.join(v.state,'browser-'+id);
    const opened=await openBrowserRuntime(directory,{computerConfigFile:v.profile}),{runtime}=opened;
    try {
      const session=runtime.store.meta('ti-browser-session');
      need(session?.projectId===id&&session.grant===v.grant&&session.commitment===v.commitment,'TI_EXACT_BROWSER_GRANT_REQUIRED');
      const principal=runtime.authenticate(decodeUTF8(readPrivate(runtime.store.meta('ti-browser-credential'))));
      need(runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(session.grant)?.state==='prepared','GRANT_UNAVAILABLE');
      runtime.store.transaction(()=>{
        const marker={schema:'agi-fleet/ti-browser-endpoint-fence/v1',grant:session.grant,sourceSha256:runtime.source};
        runtime.store.set('ti-browser-run-fence',marker);runtime.store.event('ti-browser-endpoint-fenced',marker);
      });
      runtime.authorize({grant:session.grant,commitment:session.commitment,confirm:true},principal);
      const completed=await runtime.run({actor:session.actor,grant:session.grant},principal);
      const returned=await runtime.dispatch('computer-export',{actor:session.actor,run:completed.run},principal);
      const next=await saveExtension(project,'computer-return',returned.content);
      result=await publish(next);result.nativeState=completed.state;
      result.executionClass='existing-native-scripted-browser-route';
    } finally {await opened.close();}
  } else if(action==='browser-capture') {
    const id=uuid(v.project),project=await store.get(id);need(project,'TI_PROJECT_UNKNOWN');
    const directory=path.join(v.state,'browser-'+id);
    // A durable restart transition is explicit; it never resumes or replays.
    if(v['recover-interrupted-browser']) {
      // Legacy raw commands had no endpoint: absence alone cannot establish
      // that one of those writers stopped. Retain them for explicit review.
      const observed=new Store(directory);
      try {
        const marker=observed.meta('ti-browser-run-fence');
        const running=observed.db.prepare("SELECT grant_id,value FROM runs WHERE state='running'").all();
        need(running.every(row=>marker?.schema==='agi-fleet/ti-browser-endpoint-fence/v1'
          &&marker.grant===row.grant_id&&marker.sourceSha256===parseStrict(row.value).sourceSha256),
          'TI_BROWSER_UNFENCED_RECOVERY_REVIEW_REQUIRED');
      } finally {observed.close();}
      const {recoverService}=await import('../supervisor/recover-service.mjs');
      await recoverService(directory,{confirm:true});
    }
    const opened=await openBrowserRuntime(directory),{runtime}=opened;
    try {
      const session=runtime.store.meta('ti-browser-session');need(session?.projectId===id,'TI_BROWSER_SESSION_REQUIRED');
      const row=runtime.store.db.prepare('SELECT id,state,result FROM runs WHERE actor=? AND grant_id=?').get(session.actor,session.grant);
      need(row&&row.state!=='running','TI_BROWSER_CLOSED_RUN_REQUIRED');
      const principal=runtime.authenticate(decodeUTF8(readPrivate(runtime.store.meta('ti-browser-credential'))));
      const missingOutcome=row.state==='uncertain'&&row.result===null;
      need(!missingOutcome||runtime.store.meta('stopped')===true,'TI_BROWSER_RECOVERY_STOP_REQUIRED');
      let retained=project;
      if(!missingOutcome) {
        const returned=await runtime.dispatch('computer-export',{actor:session.actor,run:row.id},principal);
        retained=await saveExtension(project,'computer-return',returned.content);
      }
      const recovery=v['recover-interrupted-browser']||missingOutcome?{
        schema:'agi-fleet/ti-browser-recovery/v1',projectId:id,run:row.id,retainedState:row.state,
        stopped:runtime.store.meta('stopped')===true,replayAllowed:false,nativeReturnRecovered:!missingOutcome,
        cleanupReestablished:false,authority:'none',next:'Inspect retained native files and obtain positive closure evidence before reconciliation; never reset or replay the consumed grant.'}:null;
      result=await publish(retained,recovery);
      result.recovery=missingOutcome?'interrupted-attempt-retained-no-replay':'retained-history-only-no-replay';
      result.nativeState=row.state;result.nativeReturnRecovered=!missingOutcome;
      if(recovery)result.recoveryStopped=recovery.stopped;
    } finally {await opened.close();}
  } else if(['library-review','library-control','library-route'].includes(action)) {
    const id=uuid(v.project);await current(id);let project=await store.get(id);need(project,'TI_PROJECT_UNKNOWN');
    const checked=await inspectTIProject(project,history);need(checked.archive,'TI_LOCAL_ARCHIVE_REQUIRED');
    need(typeof v.producer==='string'&&v.producer.length>0,'TI_EXPLICIT_LIBRARY_PRODUCER_REQUIRED');
    const output=path.join(home(id),'library-command-'+randomUUID()+'.json');
    const trust=publicSnapshot(id,v.trust,'library-trust');
    const args=['successor-library','--trust',trust,'--producer',v.producer,'--output',output];
    if(action==='library-review')args.push('review',checked.archive.archive_digest,publicSnapshot(id,v.signed,'signed-review'),'--operation-id',v.operation);
    else if(action==='library-control')args.push('control',checked.archive.archive_digest,publicSnapshot(id,v.signed,'signed-control'),'--behavior-digest',v.behavior,'--operation-id',v.operation);
    else args.push('route',publicSnapshot(id,v.context,'router-context'));
    nativeCLI(installed,v.python,home(id),args);
    if(action==='library-route') {
      const selected=parseStrict(raw(output));
      need(selected.authority_granted===false&&selected.execution_approved===false&&selected.spending_approved===false,'TI_LIBRARY_AUTHORITY');
      result={projectId:id,basedOnProjectSha256:sha(project),selection:selected,authority:'none'};
      store.store.transaction(()=>{store.store.set('ti-library-route:'+id,result);store.store.event('ti-local-route-observed',result);});
    } else {
      project=await saveExtension(project,'reuse-update',raw(output));
      result={projectId:id,summaries:(await inspectTIProject(project,history)).summaries,authority:'none',independentReview:false};
    }
  } else if(action==='import') {
    const project=raw(v.file);await store.import(project);const checked=await inspectTIProject(project,history);
    result={projectId:checked.project.projectId,summaries:checked.summaries,runAuthorized:false,authority:'none',nativeLocalContextRestored:false};
  } else if(action==='export') {
    const project=await store.get(uuid(v.project));need(project,'TI_PROJECT_UNKNOWN');result=await publish(project);
  } else if(action==='show') {
    const project=await store.get(uuid(v.project));need(project,'TI_PROJECT_UNKNOWN');const checked=await inspectTIProject(project,history);
    result={projectId:checked.project.projectId,summaries:checked.summaries,authority:'none',runAuthorized:false,independentReview:false};
  } else need(false,'TI_COMMAND_UNKNOWN');
  process.stdout.write(canonical(result)+'\n');
} catch(error) {
  const code=error.code??error.message;
  process.stderr.write(/^[A-Z][A-Z0-9_]{0,100}$/.test(code)?code+'\n':'TI_COMMAND_FAILED\n');process.exitCode=1;
} finally {store?.close();installed?.close();}
