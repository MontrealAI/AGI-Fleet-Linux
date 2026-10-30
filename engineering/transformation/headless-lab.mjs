// SPDX-License-Identifier: MIT
// Deliberately separate test lab; never imported by the product CLI/backend.
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {canonical,decodeUTF8,need} from '../../local-runtime/primitives.mjs';
import {openInstalledTI} from '../../local-runtime/transformation/installed.mjs';
import {appendTIProject,inspectTIProject,summaryHTML} from '../../local-runtime/transformation/project.mjs';
import {TIProjectStore} from '../../local-runtime/transformation/store.mjs';
const options=Object.fromEntries(['project','sources','python','chromium','state','output'].map(name=>[name,{type:'string'}]));
options['confirm-test-only-host-browser']={type:'boolean',default:false};
const {values:v}=parseArgs({options});
need(v['confirm-test-only-host-browser'],'TEST_ONLY_HOST_BROWSER_CONFIRMATION_REQUIRED');
for(const name of ['project','sources','python','chromium','state','output'])need(path.isAbsolute(v[name]??''),'TEST_EXPLICIT_ABSOLUTE_PATH_REQUIRED');
need(!fs.existsSync(v.state)&&!fs.existsSync(v.output),'TEST_NEW_STATE_AND_OUTPUT_REQUIRED');
fs.mkdirSync(v.state,{mode:0o700});
const installed=await openInstalledTI(JSON.parse(decodeUTF8(fs.readFileSync(v.sources))),path.join(v.state,'captured'));
const history={...installed.receivers,manager:undefined,jobs:undefined};let store;
try {
  const prior=decodeUTF8(fs.readFileSync(v.project)),checked=await inspectTIProject(prior,history);
  need(checked.handoffRaw&&checked.native?.phase==='completed','TEST_COMPLETED_SUMMARY_HANDOFF_REQUIRED');
  need(JSON.parse(checked.handoffRaw).task.html===await summaryHTML(checked.nativeRaw,installed.receivers.native),'TEST_EXACT_FIXED_HTML_REQUIRED');
  const handoff=path.join(v.state,'handoff.json'),records=path.join(v.state,'records.json'),artifacts=path.join(v.state,'artifacts');
  fs.writeFileSync(handoff,checked.handoffRaw,{mode:0o600});fs.writeFileSync(records,canonical(installed.records),{mode:0o600});
  const source=fileURLToPath(new URL('./headless_lab.py',import.meta.url));
  execFileSync(v.python,['-B',source,'--alpha-root',installed.alphaRoot,'--handoff',handoff,'--records',records,
    '--chromium',v.chromium,'--home',path.join(v.state,'journal'),'--output',artifacts,'--confirm-test-only-host-browser'],
    {env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:90_000,maxBuffer:1_000_000});
  const returnRaw=decodeUTF8(fs.readFileSync(path.join(artifacts,'computer-return.json')));
  const extended=await appendTIProject(prior,'computer-return',returnRaw,history);
  const final=await inspectTIProject(extended,history);need(final.summaries.find(row=>row.kind==='computer-return')?.state==='review','TEST_REAL_RETURN_REQUIRED');
  store=new TIProjectStore(path.join(v.state,'project-state'),history,{create:true});await store.import(prior);await store.save(extended,prior);
  fs.mkdirSync(v.output,{mode:0o700});
  const publicFiles=['computer-return.json','receipt.json','signed-receipt.json','visible-text.txt','test-only-evidence.json',
    ...fs.readdirSync(artifacts).filter(name=>/^screen-[0-9]{3}\.png$/.test(name))];
  for(const name of publicFiles)fs.copyFileSync(path.join(artifacts,name),path.join(v.output,name),fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(v.output,'source-provenance.json'),canonical({sources:installed.records,
    labFiles:Object.fromEntries([fileURLToPath(import.meta.url),source].map(file=>[path.basename(file),createHash('sha256').update(fs.readFileSync(file)).digest('hex')])),
    pythonExecutableSha256:createHash('sha256').update(fs.readFileSync(v.python)).digest('hex'),
    pythonDependencies:'ambient-test-laboratory-only-not-isolated-production-closure',
    networkObservation:'page-context-requests-observed-and-blocked; no whole-process network-isolation claim'}),{mode:0o600,flag:'wx'});
  fs.writeFileSync(path.join(v.output,'project.json'),extended,{mode:0o600,flag:'wx'});
  fs.writeFileSync(path.join(v.output,'summary.html'),await summaryHTML(checked.nativeRaw,installed.receivers.native),{mode:0o600,flag:'wx'});
  const files=fs.readdirSync(v.output).sort().map(name=>{const bytes=fs.readFileSync(path.join(v.output,name));return {name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
  fs.writeFileSync(path.join(v.output,'checksums.json'),canonical({files,authority:'none',productionQualified:false}),{mode:0o600,flag:'wx'});
  process.stdout.write(canonical({projectId:checked.project.projectId,output:v.output,executionClass:'TEST_ONLY_HOST_PLAYWRIGHT_NO_DOCKER',
    nativeState:'review',independentReview:false,productionQualified:false,authority:'none'})+'\n');
} finally {store?.close();installed.close();}
