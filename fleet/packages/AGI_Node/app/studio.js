(() => {
  'use strict';
  const root = document.querySelector('.studio-shell');
  if (!root) return;
  const role = root.dataset.role, byId = id => document.getElementById('studio-' + id);
  let snapshot = null, template = null, imported = null, handoff = null, revision = null, runsStamp = '', loading = false, busyAction = false;
  const call = (url,body) => role === 'agent' ? api(url,body) : request(url,body);
  const element = (tag,text,className) => {const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;};
  const label = value => ({checked:role === 'agent'?'Self-check complete':'Review complete','needs-review':'Needs review',running:'In progress',failed:'Did not finish',cancelled:'Stopped',declined:'Task declined',interrupted:'Interrupted'})[value] ?? value;
  const phases = {starting:'Preparing the workspace',waiting:'Waiting for the next allowed workflow',creating:'Creating with isolated tools','checking-files':'Checking the actual files',reviewing:'Reviewing against your criteria',checked:'Checks complete','needs-review':'Review needs attention',failed:'Task did not finish',cancelled:'Task stopped',declined:'Task declined',interrupted:'Task interrupted'};
  const message = (text,bad=false) => {byId('message').textContent = text; byId('message').hidden = !text; byId('message').setAttribute('role',bad?'alert':'status');};
  function blobDownload(name,data,type='application/json') {
    const blob = new Blob([typeof data === 'string' || data instanceof Uint8Array ? data : JSON.stringify(data,null,2)],{type});
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  async function action(work) {
    if (busyAction) return;
    busyAction = true; byId('run').disabled = true; message('');
    try {await work(); await refresh();} catch(e) {message(e.message,true);} finally {busyAction = false; renderReady();}
  }
  function selectTemplate(t) {
    template = t; imported = null; revision = null; byId('import-note').hidden = true;
    for (const id of ['title','brief','outputs','criteria']) byId(id).disabled = false;
    for (const b of byId('templates').querySelectorAll('button')) b.setAttribute('aria-pressed',String(b.dataset.template === t.id));
    byId('title').value = t.title; byId('brief').value = t.prompt; byId('outputs').value = t.outputs.join('\n'); byId('criteria').value = t.criteria.join('\n');
    const details=document.getElementById('studio-template-details');
    if(details)details.textContent=t.environment?`TOOL ENVIRONMENT · ${t.environment}\nPUBLIC INPUTS · ${t.publicInputs}\nFILES · ${t.outputs.join(', ')}\nCHECK METHOD · ${t.checkMethod}`:'Format practice. Replace the example brief with your own public, bounded task.';
    byId('outputs').readOnly = t.id === 'image'; renderReady();
  }
  function renderTemplates() {
    if (role !== 'agent' || template) return;
    for (const t of snapshot.templates) {
      const b = element('button',undefined,'studio-template'); b.type = 'button'; b.dataset.template = t.id; b.setAttribute('aria-pressed','false');
      b.append(element('span',t.icon),element('strong',t.label),element('small',t.description)); b.onclick = () => selectTemplate(t); (t.category==='format'?document.getElementById('studio-format-templates')??byId('templates'):byId('templates')).append(b);
    }
    selectTemplate(snapshot.templates.find(t => t.id === 'performance'));
  }
  function renderReady() {
    if (!snapshot) return;
    byId('run').disabled = busyAction || !snapshot.ready || (role === 'node' && !handoff);
    byId('cancel').hidden = !snapshot.busy;
    if(role==='agent')byId('run').textContent=revision?'Improve & check the work':'Create & check the work';
    byId('connection').textContent = snapshot.connection.mode === 'workstation' ? 'Computer mode configured' : 'Computer setup needed';
    byId('quota').textContent = `${snapshot.connection.remaining24h} workflow starts left`;
    byId('shelf-count').textContent = `${snapshot.runs.length} of ${snapshot.maxRecords} saved runs`;
    byId('blockers').replaceChildren(...snapshot.blockers.map(v => element('li',v)));
    byId('setup-note').hidden = snapshot.blockers.length === 0;
    const active = snapshot.runs.find(r => r.id === snapshot.active);
    byId('progress-label').textContent = active ? phases[active.phase] ?? active.phase : 'Ready for your next task';
    const phaseSteps = role==='node'?{starting:0,waiting:active?.hasFiles?1:0,'checking-files':1,reviewing:2,checked:3,'needs-review':2}:{starting:0,waiting:active?.hasFiles?2:0,creating:1,'checking-files':2,reviewing:3,checked:4,'needs-review':3};
    const step = active ? phaseSteps[active.phase] ?? 0 : -1;
    byId('steps').querySelectorAll('li').forEach((li,i) => li.dataset.state = i < step ? 'done' : i === step ? 'current' : 'future');
    byId('elapsed').textContent = active ? `${Math.max(0,Math.floor((Date.now()-Date.parse(active.startedAt))/1000))} seconds elapsed · you can leave this page open or return later.` : 'Progress is saved locally. Reopening the app shows interrupted runs; it does not silently repeat them.';
  }
  async function exportRun(run,kind) {
    const data = await call(`/api/studio/export?id=${encodeURIComponent(run.id)}&kind=${encodeURIComponent(kind)}`);
    if (kind === 'files' || kind === 'original-files') {
      const binary = atob(data.content), bytes = Uint8Array.from(binary,c => c.charCodeAt(0));
      blobDownload(data.name,bytes,data.mediaType);
    } else blobDownload(`agi-${kind}-${run.id}.json`,data);
  }
  function renderRuns() {
    const stamp = JSON.stringify(snapshot.runs);
    if (stamp === runsStamp) return;
    runsStamp = stamp; byId('runs').replaceChildren();
    if (!snapshot.runs.length) {byId('runs').append(element('div',role === 'agent'?'Your completed work will appear here, with files and check results.':'Your reviewed handoffs will appear here, with a result for each criterion.','studio-empty')); return;}
    for (const r of snapshot.runs) {
      const card = element('div',undefined,'studio-run'), header = element('div',undefined,'studio-run-head'), heading = element('div');
      heading.append(element('h4',r.title),element('small',new Date(r.startedAt).toLocaleString() + ' · ' + r.requests + ' workflow starts','studio-muted'));
      const badge = element('span',label(r.status),'studio-state'); badge.dataset.state = r.status; header.append(heading,badge); card.append(header);
      if (!r.currentScope) card.append(element('p','Recorded under a different software or compute configuration. These checks are not current for this setup.','studio-note'));
      if (r.isRevision) card.append(element('p','Revision run: the original files are preserved separately. The job and its criteria are unchanged.','studio-note'));
      if (r.error) card.append(element('p',r.error.title + ' ' + r.error.action,'studio-note'));
      if (r.status === 'declined') card.append(element('p','The model declined this task. Check access, required tools and the brief before trying a new run.','studio-note'));
      if (r.hasFiles) {
        const files = element('div',undefined,'studio-files');
        for (const file of r.files) files.append(element('span',`${file.name} · ${Math.ceil(file.bytes/1024)} KiB`));
        card.append(files);
        if (r.status !== 'checked') card.append(element('p','Saved files are available for inspection; they have not passed a complete positive review.','studio-muted'));
      }
      if (r.review) {
        const details = element('details',undefined,'studio-advanced'); details.append(element('summary','View the review evidence'));
        details.append(element('p','These are model-reported checks of the files. A local Studio review does not establish an unrelated operator or authorize an on-chain vote.','studio-muted'));
        if (r.review.note) details.append(element('p',r.review.note));
        for (const check of r.review.checks ?? []) {
          const row = element('div',undefined,'studio-check'), criterion = r.criteria.find(c => c.id === check.id);
          row.append(element('strong',`${check.status} · ${criterion?.requirement ?? check.id}`));
          if (check.method) row.append(element('p','Method: '+check.method));
          if (check.observed) row.append(element('p','Observed: '+check.observed));
          if (check.files?.length) row.append(element('small','Files: '+check.files.join(', ')));
          details.append(row);
        }
        card.append(details);
      }
      const buttons = element('div',undefined,'studio-actions');
      for (const [kind,text] of [['files','Download files'],['handoff','Review handoff'],['receipt','Run receipt'],['specification','Job specification']]) {
        if (['files','handoff'].includes(kind) && !r.hasFiles) continue;
        const b = element('button',text,'studio-button'); b.type = 'button'; b.onclick = () => action(() => exportRun(r,kind)); buttons.append(b);
      }
      if (r.isRevision) {
        const original = element('button','Download original files','studio-button'); original.type='button';
        original.onclick=()=>action(()=>exportRun(r,'original-files')); buttons.append(original);
      }
      if (r.currentScope && r.hasFiles && r.profile === 'computer-work/v1' && r.review?.safeToReview === true && r.review.verdict === 'concern') {
        const feedback=element('button','Revision feedback','studio-button');feedback.type='button';feedback.onclick=()=>action(()=>exportRun(r,'revision'));buttons.append(feedback);
        if(role==='agent') {
          const improve=element('button','Improve & check again','studio-button primary');improve.type='button';improve.disabled=!snapshot.ready;
          improve.onclick=()=>action(async()=>{const rev=await call(`/api/studio/export?id=${encodeURIComponent(r.id)}&kind=revision`);await call('/api/studio/start',{revision:rev});message('Revision started: two workflow starts, original files preserved, same acceptance criteria.');});buttons.append(improve);
        }
      }
      const remove = element('button','Remove local copy','studio-button danger'); remove.type = 'button'; remove.disabled = snapshot.busy;
      remove.onclick = () => {
        const confirm = element('div',undefined,'studio-note'); confirm.append(element('p','Remove this saved Studio run and its files? Download anything you need first. Wallet and transaction history are separate.'));
        const yes = element('button','Remove this run','studio-button danger'), no = element('button','Keep it','studio-button');
        yes.onclick = () => action(() => call('/api/studio/remove',{id:r.id})); no.onclick = () => confirm.remove(); confirm.append(yes,document.createTextNode(' '),no); card.append(confirm); yes.focus();
      };
      buttons.append(remove); card.append(buttons); byId('runs').append(card);
    }
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    try {snapshot = await call('/api/studio'); renderTemplates(); renderReady(); renderRuns();}
    catch(e) {message(e.message,true); byId('run').disabled = true;}
    finally {loading = false;}
  }
  const lines = id => byId(id).value.split('\n').map(s => s.trim()).filter(Boolean);
  function displaySpec(spec) {byId('title').value=spec.title;byId('brief').value=spec.prompt;byId('outputs').value=spec.outputs?spec.outputs.map(f=>f.name).join('\n'):'image.png';byId('criteria').value=spec.criteria.map(c=>c.requirement).join('\n');}
  function supportedBrief(spec) {
    return spec?.schema === 'agi-node-job/v1' && ['computer-work/v1','image-png/v1'].includes(spec.profile) && spec.dataPolicy === 'public'
      && typeof spec.title === 'string' && spec.title.length > 0 && spec.title.length <= 160
      && typeof spec.prompt === 'string' && spec.prompt.length > 0 && spec.prompt.length <= 6000
      && Array.isArray(spec.criteria) && spec.criteria.length > 0 && spec.criteria.length <= 16
      && spec.criteria.every(c => typeof c?.requirement === 'string' && c.requirement.length > 0 && c.requirement.length <= 500);
  }
  byId('form').addEventListener('submit',e => {e.preventDefault(); action(async () => {
    let input;
    if (role === 'agent') input = revision ? {revision} : imported ? {specification:imported} : {brief:{template:template.id,title:byId('title').value,prompt:byId('brief').value,outputs:lines('outputs'),criteria:lines('criteria')}};
    else input = {handoff};
    await call('/api/studio/start',input); message('Task started. Its progress and completed files will appear below.');
  });});
  byId('cancel').onclick = () => action(async () => {await call('/api/studio/cancel',{}); message('Task stopped. Any completed files are retained.');});
  byId('open-setup').onclick = () => role === 'agent' ? show('intelligence') : showView('companion');
  if (role === 'agent') {
    byId('revision-file').onchange = () => action(async () => {
      revision=null; imported=null; byId('import-note').hidden=true;
      for(const id of ['title','brief','outputs','criteria'])byId(id).disabled=false;
      const file=byId('revision-file').files[0];if(!file)return;
      if(file.size>7*1024*1024)throw Error('The revision feedback exceeds 7 MiB.');
      const value=JSON.parse(await file.text());
      if(value.schema!=='agi-studio-revision/v1'||!supportedBrief(value.handoff?.specification)||value.handoff.specification.profile!=='computer-work/v1'||typeof value.handoff.delivery!=='string'||value.handoff.delivery.length>6291456||value.review?.safeToReview!==true||!Array.isArray(value.review.checks)||value.review.checks.length>16)throw Error('Choose the complete Revision feedback JSON from an Agent or Node review.');
      revision=value;displaySpec(value.handoff.specification);for(const id of ['title','brief','outputs','criteria'])byId(id).disabled=true;
      byId('import-note').hidden=false;byId('import-note').textContent='Revise: '+value.handoff.specification.title+'. The original files will be preserved. Two workflow starts create and check a new result against the unchanged job. Feedback is editable evidence, not a verified reviewer identity.';
    });
    byId('spec-file').onchange = () => action(async () => {
      imported = null; revision = null; byId('import-note').hidden = true;
      for (const id of ['title','brief','outputs','criteria']) byId(id).disabled = false;
      const file = byId('spec-file').files[0]; if (!file) return;
      if (file.size > 20000) throw Error('The job specification must be smaller than 20 KB.');
      const spec = JSON.parse(await file.text());
      if (!supportedBrief(spec)) throw Error('Choose a valid public computer-work/v1 or image-png/v1 job specification with 1–16 criteria.');
      imported = spec; displaySpec(spec); for (const id of ['title','brief','outputs','criteria']) byId(id).disabled = true; byId('import-note').hidden = false; byId('import-note').textContent = `Imported task: ${spec.title}. The original specification, including inputs and byte limits, will be used unchanged. Choose a task tile to return to the editor.`;
    });
  } else {
    byId('handoff-file').onchange = () => action(async () => {
      handoff = null; byId('handoff-preview').replaceChildren();
      const file = byId('handoff-file').files[0]; if (!file) return;
      if (file.size > 7*1024*1024) throw Error('This handoff exceeds the 7 MiB upload limit.');
      const value = JSON.parse(await file.text());
      if (value.schema !== 'agi-studio-handoff/v1' || !supportedBrief(value.specification) || typeof value.delivery !== 'string' || value.delivery.length > 6291456) throw Error('Choose the complete review handoff JSON downloaded from the Agent Studio.');
      const spec = value.specification, preview = byId('handoff-preview');
      preview.append(element('h3',spec.title),element('p',spec.prompt));
      const checks = element('ol'); for (const c of spec.criteria ?? []) checks.append(element('li',c.requirement)); preview.append(checks);
      preview.append(element('p','Before inference, the Node independently checks the file hashes, format and binding to this specification. The Agent’s verdict is not sent to the reviewer.','studio-muted'));
      handoff = value;
    });
  }
  document.querySelector('[data-view=studio]').addEventListener('click',refresh);
  setInterval(() => {if (!root.hidden || snapshot?.busy) void refresh();},2500);
})();
