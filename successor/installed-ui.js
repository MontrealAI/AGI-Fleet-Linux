(() => {
  'use strict';
  const studio=document.querySelector('.studio-shell');if(!studio)return;
  const role=studio.dataset.role,call=(url,input)=>role==='agent'?api(url,input):request(url,input);
  const panel=document.createElement('section');panel.className='card';panel.setAttribute('aria-labelledby','omega-title');
  panel.innerHTML=`<h2 id="omega-title">SUCCESSOR Ω + Fleet</h2><button type="button" id="omega-language">Français</button><p id="omega-intro"></p>
  <div id="omega-project" role="status" aria-live="polite"></div><p><a href="https://montrealai.github.io/AGI-Fleet-Linux/successor.html" target="_blank" rel="noopener noreferrer" id="omega-builder">Build my Ω</a></p>
  <label for="omega-file" id="omega-file-label"></label><input id="omega-file" type="file" accept=".json,application/json">
  <fieldset id="omega-guided"><legend id="omega-guided-label"></legend>
  <label for="omega-reviewer" id="omega-reviewer-label"></label><input id="omega-reviewer" type="file" accept=".json,application/json">
  <div id="omega-inputs"></div>
  <label for="omega-seconds" id="omega-seconds-label"></label><input id="omega-seconds" type="number" min="1" max="600" value="60">
  <label for="omega-agent-cost" id="omega-agent-cost-label"></label><input id="omega-agent-cost" inputmode="decimal" placeholder="0.00">
  <label for="omega-review-cost" id="omega-review-cost-label"></label><input id="omega-review-cost" inputmode="decimal" placeholder="0.00">
  <label><input id="omega-public" type="checkbox"><span id="omega-public-label"></span></label>
  <p id="omega-guided-note"></p></fieldset>
  <details id="omega-advanced"><summary id="omega-advanced-label"></summary><label for="omega-context" id="omega-context-label"></label><input id="omega-context" type="file" accept=".json,application/json"></details>
  <div class="actions"><button id="omega-runtime" type="button"></button><button id="omega-prepare" type="button"></button></div>
  <div id="omega-preview"></div><details><summary id="omega-preview-details-label"></summary><pre id="omega-preview-details" tabindex="0"></pre></details><label><input id="omega-confirm" type="checkbox"><span id="omega-confirm-label"></span></label>
  <div class="actions"><button id="omega-execute" type="button" disabled></button><button id="omega-revoke" type="button"></button><button id="omega-stop" type="button"></button></div>
  <label for="omega-review" id="omega-review-label"></label><input id="omega-review" type="file" accept=".json,application/json">
  <div class="actions"><button id="omega-refresh" type="button"></button><button id="omega-download" type="button"></button></div>
  <label for="omega-run" id="omega-run-label"></label><select id="omega-run"></select><p id="omega-message" role="status" aria-live="polite"></p>`;
  studio.prepend(panel);
  const $=name=>document.getElementById('omega-'+name);let fr=false,prepared=null,loaded=null,context=null,review=null,reviewer=null,busy=false,status=null,activeActions=0,revision=0;
  const t=(en,french)=>fr?french:en;
  function words(){
    const texts={intro:t('Try your Ω free in the Builder. Import its Fleet request here to inspect, authorize, create and check real files. Provider costs require your separate approval.','Essayez votre Ω gratuitement dans le Builder. Importez sa demande ici pour examiner, autoriser, créer et vérifier de vrais fichiers. Les coûts fournisseur nécessitent votre accord distinct.'),
      'preview-details-label':t('Exact technical authorization details','Détails techniques exacts de l’autorisation'),
      'guided-label':t('2. Connect this mission','2. Connecter cette mission'),
      'reviewer-label':t('Runtime file from the reviewing Node','Descripteur fourni par le Node de revue'),
      'seconds-label':t('Maximum seconds per creation or review (up to 600)','Durée maximale de création ou de revue (600 secondes au plus)'),
      'agent-cost-label':t('Maximum creator cost (USDC planning limit)','Coût maximal de création (limite indicative USDC)'),
      'review-cost-label':t('Maximum review cost (USDC planning limit)','Coût maximal de revue (limite indicative USDC)'),
      'public-label':t('I own or have permission to use and publish these nonpersonal inputs.','Je possède les droits d’utiliser et de publier ces données non personnelles.'),
      'guided-note':t('Download each exact input, place it at an immutable public HTTPS address you control, then enter its URL. Fleet fetches and checks its hash before work. Your Agent’s existing deployment configuration supplies the settlement identity; this does not post, fund or sign a job. Provider limits also remain enforced by the existing compute policy.','Téléchargez chaque entrée exacte, placez-la à une adresse HTTPS publique immuable sous votre contrôle et indiquez son URL. Fleet vérifie son empreinte avant de travailler. La configuration existante de l’Agent fournit l’identité de règlement ; aucun travail n’est publié, financé ou signé. La politique de calcul continue de limiter les appels fournisseur.'),
      'advanced-label':t('Advanced: import a complete runtime context','Avancé : importer un contexte complet'),
      'file-label':role==='agent'?t('1. Fleet request from your Builder','1. Demande Fleet provenant du Builder'):t('1. Agent review handoff','1. Transfert de revue provenant de l’Agent'),
      'context-label':t('2. Runtime context: exact Agent and Node descriptors, public inputs, deadline and budget','2. Contexte : descripteurs Agent et Node exacts, données publiques, échéance et budget'),
      runtime:t('Download this computer’s runtime','Télécharger le descripteur de cet ordinateur'),prepare:t('Inspect the exact work','Examiner le travail exact'),
      'confirm-label':t('I checked the inputs, files, runtime and bounded call/time allowance. I understand the USDC amounts are planning estimates, not a verified provider billing limit. Authorize this one attempt.','J’ai vérifié les données, fichiers, environnement et limites d’appels et de durée. Les montants USDC sont indicatifs, sans limite de facturation fournisseur vérifiée. Autoriser cet essai unique.'),
      execute:t('Authorize & start','Autoriser et démarrer'),revoke:t('Revoke pending authorization','Révoquer l’autorisation en attente'),stop:t('Stop work','Arrêter le travail'),
      'review-label':t('3. Node receipt to check an improvement (Agent only)','3. Reçu Node pour vérifier une amélioration (Agent seulement)'),refresh:t('Refresh results','Actualiser les résultats'),download:t('Download selected result','Télécharger le résultat choisi'),'run-label':t('Saved attempts','Essais conservés'),builder:t('Build my Ω','Créer mon Ω')};
    for(const [id,word] of Object.entries(texts))$(id).textContent=word;$('language').textContent=fr?'English':'Français';
    $('guided').hidden=$('advanced').hidden=role!=='agent';$('context').hidden=$('context-label').hidden=role!=='agent';$('review').hidden=$('review-label').hidden=role!=='agent';
  }
  function download(name,value){const u=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),30000);}
  function invalidate(){revision++;prepared=null;$('confirm').checked=false;$('execute').disabled=true;}
  async function action(fn,urgent=false){if(busy&&!urgent)return;activeActions++;busy=true;try{await fn();}catch(e){$('message').textContent=(e.code?e.code+': ':'')+e.message;$('message').setAttribute('role','alert');}finally{activeActions--;busy=activeActions>0;}}
  async function readInput(id,max){const f=$(id).files[0];if(!f||f.size>max)throw Error(t('Choose a JSON file within the stated limit.','Choisissez un fichier JSON respectant la limite.'));const text=await f.text();return text;}
  $('language').onclick=()=>{fr=!fr;words();if(status)renderProject();if(prepared)renderPreview();};
  $('file').onchange=()=>action(async()=>{invalidate();loaded=await readInput('file',96*1024*1024);showInputs();$('message').textContent=t('File loaded. Inspect before authorizing.','Fichier chargé. Examinez-le avant d’autoriser.');});
  $('context').onchange=()=>action(async()=>{invalidate();context=await readInput('context',100000);});
  $('review').onchange=()=>action(async()=>{review=await readInput('review',1000000);});
  function showInputs(){
    $('inputs').replaceChildren();if(role!=='agent')return;const value=JSON.parse(loaded);
    for(const [i,f] of (value.plan?.immutableInputs??[]).entries()){
      const label=document.createElement('label');label.htmlFor='omega-input-'+i;label.textContent=t('Public URL for ','URL publique de ')+f.name;
      const input=document.createElement('input');input.id='omega-input-'+i;input.type='url';input.placeholder='https://';input.oninput=invalidate;
      const button=document.createElement('button');button.type='button';button.textContent=t('Download exact input: ','Télécharger l’entrée exacte : ')+f.name;button.onclick=()=>download(f.name,f.content);
      $('inputs').append(label,input,button);
    }
  }
  $('reviewer').onchange=()=>action(async()=>{invalidate();reviewer=JSON.parse(await readInput('reviewer',100000));});
  for(const id of ['seconds','agent-cost','review-cost','public'])$(id).oninput=invalidate;
  async function guidedContext(){
    if(!loaded||!reviewer||!$('public').checked)throw Error(t('Choose the request and Node runtime, then review the public-input permission.','Choisissez la demande et le descripteur Node, puis vérifiez les droits des données publiques.'));
    if(reviewer.role!=='reviewer'||reviewer.authority!=='none')throw Error('FLEET_REVIEWER_DESCRIPTOR');
    const req=JSON.parse(loaded),runtime=await call('/api/successor/runtime'),status=await call('/api/status');
    const config=status.config;if(!config?.manager)throw Error(t('Set and verify the existing Agent deployment configuration first.','Configurez et vérifiez d’abord le déploiement existant de l’Agent.'));
    const seconds=Number($('seconds').value);
    return {schema:'successor-runtime-context/v1',runtimes:{agent:runtime.runtime,reviewer:reviewer.runtime},inputs:req.plan.immutableInputs.map((f,i)=>({name:f.name,uri:$('input-'+i).value,sha256:f.sha256,maxBytes:new TextEncoder().encode(f.content).length})),deadline:Math.floor(Date.now()/1000)+3600,settlement:{chainId:config.chainId,manager:config.manager.toLowerCase(),recovery:'Unfunded local Studio attempt. Preserve evidence; no automatic submission, settlement or reauthorization.'},budget:{maxAgentSeconds:seconds,maxReviewSeconds:seconds,maxAgentCostUSDC:$('agent-cost').value,maxReviewCostUSDC:$('review-cost').value},publicConsent:true};
  }
  $('runtime').onclick=()=>action(async()=>download('fleet-runtime-'+role+'.json',await call('/api/successor/runtime')));
  $('prepare').onclick=()=>action(async()=>{invalidate();const version=revision;const input=role==='agent'?{request:loaded,context:context??await guidedContext()}:{handoff:loaded};if(version!==revision)return;const inspected=await call('/api/successor/prepare',input);if(version!==revision)return;prepared=inspected;renderPreview();$('message').textContent=t('Review this one-minute authorization. No work has started.','Examinez cette autorisation d’une minute. Aucun travail n’a démarré.');});
  $('confirm').onchange=()=>{$('execute').disabled=!prepared||!$('confirm').checked;};
  $('execute').onclick=()=>action(async()=>{const grant=prepared;invalidate();const version=revision;const answer=await call('/api/successor/execute',{ticket:grant.ticket,key:grant.key,confirm:true});if(version!==revision)return;$('message').textContent=t('Work started. Use Refresh results to see observed progress.','Travail démarré. Actualisez pour voir la progression observée.');await refresh();$('run').value=answer.key;renderProject();});
  $('revoke').onclick=()=>action(async()=>{invalidate();await call('/api/successor/revoke',{});$('message').textContent=t('Pending authorizations revoked.','Autorisations en attente révoquées.');},true);
  $('stop').onclick=()=>action(async()=>{invalidate();await call('/api/successor/stop',{});await refresh();},true);
  function line(container,label,value){const p=document.createElement('p'),strong=document.createElement('strong');strong.textContent=label+': ';p.append(strong,document.createTextNode(value));container.append(p);}
  function stateLabel(value){const labels={reserved:t('Reserved; dispatch is not confirmed','Réservé ; envoi non confirmé'),dispatched:t('Started; inspect current Studio progress','Démarré ; consulter la progression Studio'),'blocked-or-uncertain':t('Blocked or uncertain; reconcile before another attempt','Bloqué ou incertain ; vérifier avant tout nouvel essai'),stopped:t('Stopped; earlier effects and charges may remain','Arrêté ; des effets et des frais antérieurs peuvent subsister'),paused:t('Paused','En pause'),abandoned:t('Abandoned','Abandonné'),completed:t('Files observed; acceptance is separate','Fichiers observés ; acceptation distincte'),checked:t('Internal checks completed; independent acceptance unverified','Vérifications internes terminées ; acceptation indépendante non vérifiée'),'needs-review':t('Needs review or repair','Revue ou réparation requise')};return labels[value]??value??t('Not observed','Non observé');}
  function renderPreview(){
    const spec=prepared.specification,box=$('preview');box.replaceChildren();
    line(box,t('Goal','Objectif'),spec.prompt);
    line(box,t('Selected inputs','Entrées choisies'),spec.inputs.map(f=>f.name).join(', ')||t('None','Aucune'));
    line(box,t('Required outputs','Fichiers attendus'),spec.outputs.map(f=>f.name).join(', '));
    line(box,t('Runtime and model','Environnement et modèle'),prepared.observation.runtime.model);
    line(box,t('Approval','Autorisation'),t('One attempt, exact files and runtime. Expires at ','Un essai, fichiers et environnement exacts. Expiration : ')+new Date(prepared.expiresAt).toLocaleString());
    line(box,t('Declared bounds','Limites déclarées'),bounds(spec.budget));
    line(box,t('Billing and review','Facturation et revue'),t('Provider charges unknown; USDC planning amounts do not verify a billing cap. Review control remains unverified.','Frais fournisseur inconnus ; les montants USDC indicatifs ne garantissent pas un plafond de facturation. Contrôle de revue non vérifié.'));
    const {ticket,...safe}=prepared;$('preview-details').textContent=JSON.stringify(safe,null,2);
  }
  function bounds(budget){return budget?t('Creator: ','Création : ')+budget.maxAgentSeconds+t(' seconds; reviewer: ',' secondes ; revue : ')+budget.maxReviewSeconds+t(' seconds. USDC planning amounts: ',' secondes. Montants USDC indicatifs : ')+budget.maxAgentCostUSDC+' / '+budget.maxReviewCostUSDC:t('Not retained in this historical attempt; inspect the original request.','Non conservées dans cet essai historique ; consulter la demande originale.');}
  function renderProject(){
    const box=$('project');box.replaceChildren();const r=status?.runs.find(x=>x.key===$('run').value);
    line(box,t('Saved attempts','Essais conservés'),String(status?.runs.length??0));
    if(!r){line(box,t('Next action','Prochaine étape'),t('Choose a request and inspect its exact work before authorizing.','Choisissez une demande et examinez le travail exact avant d’autoriser.'));return;}
    const view=r.projectView??{},observed=status.studio.runs.find(x=>x.id===r.run),summary=r.outcomeSummary??{};
    line(box,t('Goal','Objectif'),view.goal??t('Not retained; inspect the original request.','Non conservé ; consulter la demande originale.'));
    line(box,t('Selected inputs','Entrées choisies'),(view.inputs??[]).join(', ')||t('Not recorded','Non consignées'));
    line(box,t('Required outputs','Fichiers attendus'),(view.outputs??[]).join(', ')||t('Not recorded; inspect the original handoff','Non consignés ; consulter le transfert original'));
    line(box,t('Current observed state','État observé actuel'),stateLabel(observed?.status??r.status));
    line(box,t('Runtime and provider route','Environnement et route fournisseur'),r.observation?.runtime?.model??t('Not recorded','Non consigné'));
    line(box,t('Declared approval bounds','Limites déclarées de l’autorisation'),bounds(view.budget));
    line(box,t('Current authority','Autorisation actuelle'),t('No reusable authorization. A new attempt requires fresh inspection and confirmation.','Aucune autorisation réutilisable. Un nouvel essai exige un examen et une confirmation.'));
    const assertions=summary.acceptanceAssertionsByControl??{};
    line(box,t('Review','Revue'),t('Internal/unverified accepted assertions: ','Déclarations d’acceptation internes/non vérifiées : ')+((assertions.internal??0)+(assertions.unverified??0))+t('. Independent control and useful business acceptance require external evidence audit.','. Le contrôle indépendant et l’acceptation utile exigent un audit des preuves externes.'));
    const selected=Object.entries(summary.selectedExpenseMicrosByCurrency??{}).map(([currency,micros])=>currency+' '+String(BigInt(micros)/1000000n)+'.'+String(BigInt(micros)%1000000n).padStart(6,'0')).join('; ');
    line(box,t('Recorded expense observations','Observations de coûts consignées'),(selected||t('No measured amount recorded','Aucun montant mesuré consigné'))+t('; unresolved charges: ',' ; frais non résolus : ')+(summary.unknownCosts?.length??0)+t('. Selected bases may mix estimates, metering and invoices; total cost is not established.','. Les bases retenues peuvent mêler estimations, mesures et factures ; le coût total n’est pas établi.'));
    const times=Object.values(summary.humanTimeByStage??{}),active=times.reduce((n,row)=>n+row.activeSeconds,0),waiting=times.reduce((n,row)=>n+row.waitingSeconds,0);
    line(box,t('Human effort','Effort humain'),times.length?t('Recorded active seconds: ','Secondes actives consignées : ')+active+t('; waiting seconds: ',' ; secondes d’attente : ')+waiting:t('Not measured. Support, founder and engineer interventions must also be recorded.','Non mesuré. Les interventions de support, du fondateur et des ingénieurs doivent aussi être consignées.'));
    line(box,t('Safe recovery','Reprise sûre'),t('Stop further work if needed, preserve this result and the original capsule, and inspect Studio evidence. Reconcile uncertain remote effects and billing before reauthorizing. Restore preserves work, never prior permission.','Arrêtez si nécessaire, conservez ce résultat et le fichier original, puis examinez les preuves Studio. Vérifiez les effets distants et la facturation incertains avant de réautoriser. La restauration conserve le travail, jamais l’autorisation.'));
    const details=document.createElement('details'),label=document.createElement('summary'),raw=document.createElement('pre');label.textContent=t('Technical history and measurement details','Historique technique et détails des mesures');raw.tabIndex=0;raw.textContent=JSON.stringify({attempt:r,aggregate:status.outcomeSummary},null,2);details.append(label,raw);box.append(details);
  }
  async function refresh(){status=await call('/api/successor');const selected=$('run').value;$('run').replaceChildren();for(const r of status.runs){const o=document.createElement('option');o.value=r.key;const run=status.studio.runs.find(x=>x.id===r.run);o.textContent=new Date(r.at).toLocaleString()+' · '+stateLabel(run?.status??r.status);$('run').append(o);}if(status.runs.some(r=>r.key===selected))$('run').value=selected;renderProject();$('message').textContent=status.studio.blockers.join(' ')||t('Status refreshed. Each result retains its actual scope.','État actualisé. Chaque résultat conserve sa portée réelle.');}
  $('run').onchange=renderProject;
  $('refresh').onclick=()=>action(refresh);
  $('download').onclick=()=>action(async()=>{const result=await call('/api/successor/result',{key:$('run').value,review});download(role==='node'?'fleet-node-review.json':'fleet-result.json',result);if(result.capsule)download('My-SUCCESSOR-Omega-returned.json',result.capsule);await refresh();});
  words();
})();
