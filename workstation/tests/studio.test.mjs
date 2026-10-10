import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Contract and persistence tests; no live model or rendered browser is implied.
const root = fileURLToPath(new URL('../..', import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-studio-v2-'));
after(() => fs.rmSync(temporary, {recursive:true, force:true}));
let fixture = process.env.AGI_WORKSTATION_FIXTURE;
if (!fixture) {
  fixture = path.join(temporary, 'candidate');
  for (const role of ['AGI_Agent','AGI_Node']) {
    const dest = path.join(fixture, 'packages', role);
    fs.mkdirSync(dest, {recursive:true});
    fs.copyFileSync(path.join(root, 'fleet/packages', role, 'package.json'), path.join(dest, 'package.json'));
    for(const source of ['src','compute','shared','config','contract']) fs.cpSync(path.join(root, 'fleet/packages', role, source), path.join(dest, source), {recursive:true});
    fs.cpSync(path.join(root, 'workstation/studio-overlay/packages', role), dest, {recursive:true});
  }
  const dependencies = process.env.AGI_STUDIO_NODE_MODULES ?? path.join(root, 'fleet/node_modules');
  assert.ok(fs.existsSync(path.join(dependencies, 'ajv/package.json')), 'Install the frozen fleet dependencies with npm ci --ignore-scripts, or set AGI_STUDIO_NODE_MODULES to its existing node_modules.');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dependencies, 'ajv/package.json'))).version, '8.20.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dependencies, 'ethers/package.json'))).version, '6.17.0');
  fs.symlinkSync(dependencies, path.join(fixture, 'node_modules'), 'dir');
}
const modules = {};
for (const role of ['AGI_Agent','AGI_Node']) {
  const directory = path.join(fixture, 'packages', role);
  const load = file => import(pathToFileURL(path.join(directory, file)));
  modules[role] = {studio:await load('src/studio.mjs'), artifacts:await load('src/artifacts.mjs'), control:await load('src/control/studio.mjs'), controller:await load('src/control/controller.mjs'), vault:await load('src/control/vault.mjs'), operational:await load('src/control/operational-state.mjs')};
}
const general = () => {
  const value = JSON.parse(fs.readFileSync(path.join(root, 'fleet/examples/computer-work-v2.json')));
  value.outputs = [{name:'dataset.custom',mediaType:'application/octet-stream',maxBytes:16*1024*1024,requirement:'Synthetic byte fixture for contract tests.'}];
  value.criteria = [{id:'exact',requirement:'Preserve the supplied byte fixture.',verification:'Compare the complete bytes.',evidence:['dataset.custom']}];
  return value;
};
const review = (status='pass') => ({safeToReview:true,checks:[{id:'exact',status,method:'Synthetic fixture comparison, no live model.',observed:'Fixture bytes compared in the test.',files:['dataset.custom']}]});
const raw = Buffer.alloc(11*1024*1024, 42);
const spec = general();
const delivery = modules.AGI_Agent.artifacts.buildBundle(spec, new Map([['dataset.custom', raw]]));

for (const [role, {studio, artifacts, control}] of Object.entries(modules)) {
  test(`${role}: general imports preserve exact bindings and accept arbitrary declared formats`, () => {
    const imported = general(), before = JSON.stringify(imported);
    assert.equal(studio.studioSpec(imported), imported);
    assert.equal(JSON.stringify(imported), before);
    const h = studio.makeHandoff(imported, delivery);
    assert.equal(studio.validateHandoff(h).delivery, delivery);
    assert.equal(studio.deliveryInfo(imported, delivery).files[0].bytes, raw.length);
    const downloaded = Buffer.from(studio.studioDownload(h).content, 'base64');
    assert.ok(downloaded.includes(raw));
    assert.equal(studio.validateStudioRevision(studio.makeRevision(h, review('fail'))).handoff.deliveryHash, h.deliveryHash);
    assert.throws(() => studio.validateHandoff({...h, deliveryHash:'0'.repeat(64)}));
    assert.throws(() => studio.makeRevision(h, review('uncertain')));
    assert.throws(() => studio.makeRevision(h, review('pass')));
  });

  test(`${role}: accepts 64 outputs and criteria, rejects over-budget and private authority`, () => {
    const large = general();
    large.outputs = Array.from({length:64}, (_, i) => ({name:`part-${i}.custom`,mediaType:'application/octet-stream',maxBytes:1024,requirement:'One fixture part.'}));
    large.criteria = large.outputs.map((f,i) => ({id:`check-${i}`,requirement:'Check this part.',verification:'Compare bytes.',evidence:[f.name]}));
    assert.equal(studio.studioSpec(large).outputs.length,64);
    for (const change of [
      s => s.outputs.push({...s.outputs[0],name:'extra.custom'}),
      s => s.outputs[0].maxBytes = 32*1024*1024+1,
      s => {s.outputs[0].maxBytes=32*1024*1024;s.outputs[1].maxBytes=32*1024*1024;},
      s => s.outputs[0].name = '../private.key',
      s => s.outputs[1].name = 'PART-0.custom',
      s => {s.dataPolicy='scoped';for(const r of ['agent','reviewer'])s.authority[r].scope='dedicated-account';},
      s => s.authority.agent.scope='dedicated-account',
    ]) {const changed=structuredClone(large);change(changed);assert.throws(() => studio.studioSpec(changed));}
    const legacy = studio.composeStudio({template:'data',title:'Legacy task',prompt:'Write a result.',outputs:['answer.txt'],criteria:['Correct result.']});
    assert.equal(legacy.profile,'computer-work/v1');
    assert.equal(studio.studioSpec(legacy),legacy);
    assert.throws(() => studio.composeStudio({template:'data',title:'Legacy task',prompt:'Write.',outputs:['answer.custom'],criteria:['Correct.']}));
  });

  test(`${role}: large completed work and revision originals survive reopening without replay`, async () => {
    const home = fs.mkdtempSync(path.join(temporary, `${role}-`));
    let calls=0;
    const c = {home, vault:{unlocked:true}, config:{}, worker:null, desired:null, status:()=>({pending:null}), requireStopped(){}, companion:{
      config:{enabled:true,mode:'workstation',maxCalls24h:100}, state:{computePolicy:'a'.repeat(64),calls:[],nextAt:0}, now:()=>Date.now(), pending:false,
      status:()=>({connected:true,calls24h:0}),
      async request(kind) {calls++;return kind==='generate'?{status:'complete',content:delivery}:review();},
    }};
    const computerRole = role==='AGI_Agent'?'agent':'node';
    const instance = new control.Studio(c, computerRole, '1.1.0-preview');
    const h = studio.makeHandoff(spec,delivery);
    const input = computerRole==='agent'?{specification:spec}:{handoff:h};
    const run = instance.start(input);await instance.task;
    assert.equal(instance.record(run.id).status,'checked');
    assert.ok(fs.statSync(path.join(home,'work-studio',run.id+'.json')).size > 14*1024*1024, 'Exercises the former shelf ceiling.');
    const reopened = new control.Studio(c,computerRole,'1.1.0-preview');
    assert.equal(reopened.historyError,null);
    assert.equal(reopened.export(run.id,'handoff').delivery,delivery);
    assert.equal(calls,computerRole==='agent'?2:1);
    assert.equal(reopened.status().limits.imports.files,64);
    if (computerRole==='agent') {
      const revision=studio.makeRevision(h,review('fail'));
      const revised=reopened.start({revision});await reopened.task;
      const again=new control.Studio(c,computerRole,'1.1.0-preview');
      assert.equal(again.historyError,null);
      assert.equal(again.export(revised.id,'handoff').delivery,delivery);
      assert.equal(again.export(revised.id,'receipt').revisionSource.deliveryHash,h.deliveryHash);
      assert.ok(Buffer.from(again.export(revised.id,'original-files').content,'base64').includes(raw));
      assert.equal(calls,4,'Reopening never replays inference.');
    }
  });
}

test('actual browser import rules admit v2 handoffs/revisions and retain legacy/private boundaries', () => {
  for (const role of ['AGI_Agent','AGI_Node']) {
    const context=vm.createContext({document:{querySelector:()=>null},TextEncoder});
    vm.runInContext(fs.readFileSync(path.join(fixture,'packages',role,'app/studio.js'),'utf8'),context);
    const rules=vm.runInContext('AGIStudioImport',context), h=modules[role].studio.makeHandoff(spec,delivery);
    assert.equal(rules.supportedBrief(spec),true);
    assert.equal(rules.supportedHandoff(h),true);
    assert.equal(rules.supportedRevision(modules[role].studio.makeRevision(h,review('fail'))),true);
    assert.equal(rules.supportedBrief({...spec,dataPolicy:'scoped'}),false);
    assert.equal(rules.supportedBrief({...spec,profile:'computer-work/v3'}),false);
    const legacy=modules[role].studio.composeStudio({template:'data',title:'Old import',prompt:'Write a result.',outputs:['answer.txt'],criteria:['Correct.']});
    assert.equal(rules.supportedBrief(legacy),true);
    assert.equal(rules.supportedHandoff({...h,specification:legacy}),false,'Large payload cannot use the smaller legacy contract.');
    assert.equal(rules.supportedBrief({...spec,criteria:Array(65).fill(spec.criteria[0])}),false);
    assert.equal(rules.supportedBrief({...spec,prompt:'x'.repeat(12001)}),false);
    for (const outputs of [{},null,[],[null],[{}]]) assert.equal(rules.supportedBrief({...spec,outputs}),false,'Malformed outputs get friendly import rejection.');
  }
});

for (const [role, modulesForRole] of Object.entries(modules)) {
  test(`${role}: explicit Studio exclusion keeps encrypted wallet backup and recovery available`, async () => {
    const {Controller}=modulesForRole.controller,{openBackup}=modulesForRole.vault;
    const home=fs.mkdtempSync(path.join(temporary,'backup-')), target=fs.mkdtempSync(path.join(temporary,'restore-'));
    const source=new Controller(home), restored=new Controller(target), password='Synthetic wallet backup fixture 2026!';
    const computerRole=role==='AGI_Agent'?'agent':'node';
    try {
      await source.createVault(password);await source.wallet('create');
      const evidence=path.join(source.config.dataDir,'admission/evidence/fixture.json');fs.mkdirSync(path.dirname(evidence),{recursive:true});fs.writeFileSync(evidence,'{"synthetic":"must survive"}');
      fs.writeFileSync(path.join(home,'pilot.json'),'{"schema":"agi-pilot-book/v1","runs":[]}');
      const id='12345678-1234-4123-8123-123456789abc';
      const h=modulesForRole.studio.makeHandoff(spec,delivery);
      const record={schema:'agi-studio-run/v1',id,role:computerRole,status:'checked',startedAt:new Date().toISOString(),specification:spec,delivery,deliveryHash:h.deliveryHash,specHash:h.specHash};
      const saved=path.join(home,'work-studio',id+'.json');fs.writeFileSync(saved,JSON.stringify(record));
      assert.ok(fs.statSync(saved).size>14*1024*1024);
      await assert.rejects(source.backup(password),/BACKUP_STUDIO_EXPORT_REQUIRED/);
      assert.ok(fs.existsSync(saved),'Full-backup refusal never deletes large Studio work.');
      const envelope=await source.backup(password,{excludeStudio:true}), decoded=await openBackup(envelope,password);
      assert.ok(Buffer.byteLength(JSON.stringify(envelope))<64*1024*1024);
      assert.deepEqual(decoded.operational.excludedTrees,['work-studio']);
      assert.ok(decoded.operational.files.some(f=>f.path==='data/admission/evidence/fixture.json'));
      assert.ok(decoded.operational.files.some(f=>f.path==='pilot.json'));
      assert.ok(decoded.operational.files.every(f=>!f.path.startsWith('work-studio/')));
      const verification=await source.verifyBackup(envelope,password);
      assert.equal(verification.currentReady,true);assert.equal(verification.checks.studioWork,'excluded-by-operator');assert.match(verification.note,/Studio work was excluded/);
      await restored.restore(envelope,password,true);
      assert.equal(restored.vault.get('privateKey'),source.vault.get('privateKey'));
      assert.equal(fs.readFileSync(path.join(target,'data/admission/evidence/fixture.json'),'utf8'),'{"synthetic":"must survive"}');
      assert.equal(restored.studio.records.length,0);
      assert.ok(fs.existsSync(saved),'The source Studio file stays intact after backup and restore elsewhere.');
      assert.throws(()=>modulesForRole.operational.validateOperational({...decoded.operational,excludedTrees:['data/admission']},computerRole),/BACKUP_STATE_FORMAT/);
      assert.throws(()=>modulesForRole.operational.validateOperational({...decoded.operational,files:[{path:'work-studio/fixture.json'}]},computerRole),/BACKUP_STATE_FORMAT/);
      // Default full backups still include ordinary saved work within old limits.
      fs.writeFileSync(saved,'{}');
      const capture=modulesForRole.operational.captureOperational({home,dataDir:source.config.dataDir,kind:computerRole});
      assert.ok(capture.files.some(f=>f.path==='work-studio/'+id+'.json'));assert.equal(capture.excludedTrees,undefined);
    } finally {await restored.close();await source.close();}
  });
}
