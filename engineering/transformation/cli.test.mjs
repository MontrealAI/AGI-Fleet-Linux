import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {canonical} from '../../local-runtime/primitives.mjs';
import {createTIProject} from '../../local-runtime/transformation/project.mjs';
import {openInstalledTI,nativeCLI} from '../../local-runtime/transformation/installed.mjs';
import {TIProjectStore} from '../../local-runtime/transformation/store.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ti-product-cli-'));
const installed=await openInstalledTI(JSON.parse(fs.readFileSync(process.env.TI_INSTALLED_SOURCES,'utf8')),path.join(root,'captured'));
const fixture=JSON.parse(fs.readFileSync(path.join(installed.alphaRoot,'examples/transformational-intelligence/campaign.json'),'utf8'));
const cli=fileURLToPath(new URL('../../local-runtime/transformation/cli.mjs',import.meta.url));
test.after(()=>{installed.close();fs.rmSync(root,{recursive:true,force:true});});
function run(state,args,preload=null) {
  return spawnSync(process.execPath,[...(preload?['--import',preload]:[]),cli,...args,'--state',state,
    '--sources',process.env.TI_INSTALLED_SOURCES,'--python',process.env.TI_PYTHON],{encoding:'utf8',timeout:60_000,maxBuffer:1_000_000});
}
test('actual EIO after native initialization resumes exact project and journal identity',async()=>{
  const request=structuredClone(fixture.bindings.request);request.campaign_id=crypto.randomUUID();
  const project=await createTIProject(canonical(request),installed.receivers),input=path.join(root,'start.json');fs.writeFileSync(input,project);
  const state=path.join(root,'start-state'),preload=path.join(root,'write-fault.mjs');
  fs.writeFileSync(preload,"import fs from 'node:fs';const real=fs.writeFileSync;fs.writeFileSync=function(file,...args){if(String(file).endsWith('/ti-request.json'))throw Object.assign(Error('synthetic EIO'),{code:'EIO'});return real.call(this,file,...args)};");
  const failed=run(state,['start','--file',input],preload);assert.equal(failed.status,1);assert.match(failed.stderr,/EIO/);
  const home=path.join(state,'native-'+request.campaign_id),before=nativeCLI(installed,process.env.TI_PYTHON,home,['verify']).identity;
  const resumed=run(state,['start','--file',input]);assert.equal(resumed.status,0,resumed.stderr);
  assert.equal(nativeCLI(installed,process.env.TI_PYTHON,home,['verify']).identity,before);
  const again=run(state,['start','--file',input]);assert.equal(again.status,0,again.stderr);
  assert.equal(JSON.parse(again.stdout).binding,JSON.parse(resumed.stdout).binding);
});
test('malformed UTF8 is rejected without normalization or project retention',async()=>{
  const request=structuredClone(fixture.bindings.request);request.campaign_id=crypto.randomUUID();request.configuration.marker='\uFFFD';
  const project=await createTIProject(canonical(request),installed.receivers),bytes=Buffer.from(project),at=bytes.indexOf(Buffer.from('\uFFFD'));
  assert.ok(at>=0);const malformed=Buffer.concat([bytes.subarray(0,at),Buffer.from([255]),bytes.subarray(at+3)]);
  const input=path.join(root,'invalid-utf8.json'),state=path.join(root,'invalid-state');fs.writeFileSync(input,malformed);
  const result=run(state,['import','--file',input]);assert.equal(result.status,1);assert.match(result.stderr,/UTF8_REQUIRED/);
  const store=new TIProjectStore(state,{...installed.receivers,manager:undefined,jobs:undefined});
  try{assert.equal(store.store.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n,0);}finally{store.close();}
});
test('existing output is rejected before a demo creates a native campaign',()=>{
  const output=path.join(root,'existing-output'),state=path.join(root,'output-state');fs.mkdirSync(output);
  const result=run(state,['demo','--output',output,'--confirm-public-demo']);
  assert.equal(result.status,1);assert.match(result.stderr,/TI_NEW_OUTPUT_REQUIRED/);
  assert.equal(fs.readdirSync(state).some(name=>name.startsWith('native-')),false);
});
test('actual non-demo controls, frozen confirmation, recovery refresh and handoff remain one project',async()=>{
  const request=structuredClone(fixture.bindings.request);request.campaign_id=crypto.randomUUID();
  const project=await createTIProject(canonical(request),installed.receivers),input=path.join(root,'lifecycle.json');fs.writeFileSync(input,project);
  const state=path.join(root,'lifecycle-state'),id=request.campaign_id;
  const success=args=>{const result=run(state,args);assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
  const started=success(['start','--file',input]);
  assert.equal(run(state,['step','--project',id,'--operation','unauthorized']).status,1);
  success(['approve','--project',id,'--binding',started.binding]);
  success(['pause','--project',id]);
  assert.equal(run(state,['step','--project',id,'--operation','paused']).status,1);
  success(['resume','--project',id]);
  for(let phase=0;phase<3;phase++)success(['step','--project',id,'--operation','phase-'+phase]);
  const home=path.join(state,'native-'+id),frozen=nativeCLI(installed,process.env.TI_PYTHON,home,['successor-transform','show',id]);
  assert.equal(frozen.state,'frozen');
  const confirmation=path.join(root,'fresh-confirmation.json');
  fs.writeFileSync(confirmation,canonical({documents:fixture.result.fresh_sources}));
  success(['confirm','--project',id,'--file',confirmation,'--freeze',frozen.freeze.digest]);
  const before=success(['show','--project',id]);assert.equal(before.summaries.at(-1).state,'completed');
  const refresh=success(['refresh','--project',id]);assert.deepEqual(refresh.summaries,before.summaries);
  assert.match(refresh.recovery,/no-control-or-replay/);
  success(['inspect-routes','--project',id]);
  const output=path.join(root,'completed-handoff');success(['prepare-handoff','--project',id,'--output',output]);
  const result=JSON.parse(fs.readFileSync(path.join(output,'project.json'),'utf8'));
  assert.equal(result.projectId,id);assert.equal(result.history.at(-1).kind,'computer-handoff');
  assert.equal(result.history.filter(event=>event.kind.endsWith('-inspection')).length,2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output,'computer-handoff.json'),'utf8')).task.html,
    fs.readFileSync(path.join(output,'summary.html'),'utf8'));
  for(const row of JSON.parse(fs.readFileSync(path.join(output,'checksums.json'),'utf8')).files) {
    const bytes=fs.readFileSync(path.join(output,row.name));assert.equal(row.bytes,bytes.length);
    assert.equal(row.sha256,createHash('sha256').update(bytes).digest('hex'));
  }
  const completed=JSON.parse(fs.readFileSync(path.join(output,'native-result.json'),'utf8'));
  const identity=nativeCLI(installed,process.env.TI_PYTHON,home,['verify']).identity;
  const trust=path.join(root,'lifecycle-trust.json'),conditions=path.join(root,'lifecycle-conditions.json');
  fs.writeFileSync(trust,canonical({schema_version:1,principals:{'test-local-producer':{public_key:identity.split(':').at(-1),
    roles:['producer'],provenance:'local',independence_attestation:''}}}));
  fs.writeFileSync(conditions,canonical({method_id:'public-summary-closure',version:1,producer:'test-local-producer',
    supported_scope:['fixed-summary-public-source'],prerequisites:['audited-acyclic-annotations'],
    failure_conditions:['unreliable-annotations'],retirement_triggers:['source or code changed'],
    costs:{setup_units:completed.result.costs.search_units,per_use_units:completed.result.costs.execution_units},
    evidence_digests:[completed.freeze.digest,createHash('sha256').update('successor-omega/v1:ti-library-result\0'+canonical(completed.result)).digest('hex')],
    evidence_scope:'local-structural-only'}));
  const archiveOutput=path.join(root,'archived');
  success(['archive-reuse','--project',id,'--file',conditions,'--trust',trust,'--producer','test-local-producer',
    '--operation','archive-test','--output',archiveOutput]);
  assert.equal(success(['show','--project',id]).summaries.at(-1).state,'pending-review');
  const archived=JSON.parse(fs.readFileSync(path.join(archiveOutput,'project.json'),'utf8'));
  const entry=JSON.parse(archived.history.find(event=>event.kind==='reuse-archive').raw),keys=generateKeyPairSync('ed25519');
  const registry=JSON.parse(fs.readFileSync(trust,'utf8'));
  registry.principals['local-verifier']={public_key:keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex'),
    roles:['verifier'],provenance:'local',independence_attestation:''};fs.writeFileSync(trust,canonical(registry));
  const payload={journal_identity:identity,archive_digest:entry.archive_digest,supported_scope:entry.conditions.supported_scope,
    bindings_digest:entry.envelope.bindings_digest,behavior_digest:entry.behavior_digest,evidence_digests:entry.conditions.evidence_digests,
    evidence_scope:'local-structural-only',outcome_claim:'structural-coverage-only',operation_id:'credential-refusal',verdict:'supported',
    limitations:'{"api_key":"synthetic-review-secret"}'};
  const domain='ti-library-review',principal='local-verifier';
  const commitment=createHash('sha256').update('successor-omega/v1:'+domain+'\0'+canonical({principal,payload})).digest();
  const signed=path.join(root,'credential-review.json');fs.writeFileSync(signed,canonical({domain,principal,payload,
    signature:sign(null,commitment,keys.privateKey).toString('base64')}));
  const rejected=run(state,['library-review','--project',id,'--trust',trust,'--producer','test-local-producer',
    '--signed',signed,'--operation','credential-refusal']);assert.equal(rejected.status,1);assert.equal(rejected.stderr.includes('synthetic-review-secret'),false);
  const snapshot=path.join(root,'library-after-refusal.json');
  nativeCLI(installed,process.env.TI_PYTHON,home,['successor-library','--trust',trust,'--producer','test-local-producer','--output',snapshot,'show']);
  const nativeSnapshot=fs.readFileSync(snapshot,'utf8');assert.equal(nativeSnapshot.includes('synthetic-review-secret'),false);
  assert.equal(JSON.parse(nativeSnapshot).entries.find(item=>item.archive_digest===entry.archive_digest).state,'pending-review');
  const unsigned=path.join(root,'not-a-signed-review.json');fs.writeFileSync(unsigned,'{}');
  assert.equal(run(state,['library-review','--project',id,'--trust',trust,'--producer','test-local-producer',
    '--signed',unsigned,'--operation','refused-unsigned']).status,1);
  assert.equal(success(['show','--project',id]).summaries.at(-1).state,'pending-review');
  const importedState=path.join(root,'imported-state');
  const screenedPayload={...payload,operation_id:'swap-review',limitations:'Structural-only local test; no independent outcome claim.'};
  const signReview=value=>({domain,principal,payload:value,signature:sign(null,createHash('sha256')
    .update('successor-omega/v1:'+domain+'\0'+canonical({principal,payload:value})).digest(),keys.privateKey).toString('base64')});
  const mutable=path.join(root,'mutable-review.json'),replacement=path.join(root,'replacement-review.json'),swap=path.join(root,'swap-review.mjs');
  fs.writeFileSync(mutable,canonical(signReview(screenedPayload)));
  fs.writeFileSync(replacement,canonical(signReview({...screenedPayload,limitations:'{"api_key":"synthetic-swap-secret"}'})));
  fs.writeFileSync(swap,`import cp from 'node:child_process';import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const real=cp.execFileSync;cp.execFileSync=function(file,args,...rest){if(args.includes('successor-library')&&args.includes('review'))fs.writeFileSync(${JSON.stringify(mutable)},fs.readFileSync(${JSON.stringify(replacement)}));return real.call(this,file,args,...rest)};syncBuiltinESMExports();`);
  const raced=run(state,['library-review','--project',id,'--trust',trust,'--producer','test-local-producer','--signed',mutable,'--operation','swap-review'],swap);
  assert.equal(raced.status,0,raced.stderr);assert.match(fs.readFileSync(mutable,'utf8'),/synthetic-swap-secret/);
  const afterSwap=path.join(root,'library-after-swap.json');
  nativeCLI(installed,process.env.TI_PYTHON,home,['successor-library','--trust',trust,'--producer','test-local-producer','--output',afterSwap,'show']);
  const retainedSwap=fs.readFileSync(afterSwap,'utf8');assert.equal(retainedSwap.includes('synthetic-swap-secret'),false);
  assert.equal(JSON.parse(retainedSwap).entries.find(item=>item.archive_digest===entry.archive_digest).state,'supported');
  assert.equal(run(importedState,['import','--file',path.join(output,'project.json')]).status,0);
  const refused=run(importedState,['step','--project',id,'--operation','imported-replay']);
  assert.equal(refused.status,1);assert.match(refused.stderr,/TI_NATIVE_LOCAL_HISTORY_REQUIRED/);
});
