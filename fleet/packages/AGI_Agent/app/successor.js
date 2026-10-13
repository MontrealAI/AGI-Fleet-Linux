(() => {
  'use strict';
  const studio=document.querySelector('.studio-shell');if(!studio)return;
  const role=studio.dataset.role,call=(url,input)=>role==='agent'?api(url,input):request(url,input);
  const panel=document.createElement('section');panel.className='card';panel.setAttribute('aria-labelledby','omega-title');
  panel.innerHTML=`<h2 id="omega-title">SUCCESSOR Ω + Fleet</h2><button type="button" id="omega-language">Français</button><p id="omega-intro"></p>
  <p><a href="https://montrealai.github.io/AGI-Fleet-Linux/successor.html" target="_blank" rel="noopener noreferrer" id="omega-builder">Build my Ω</a></p>
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
  <pre id="omega-preview" tabindex="0"></pre><label><input id="omega-confirm" type="checkbox"><span id="omega-confirm-label"></span></label>
  <div class="actions"><button id="omega-execute" type="button" disabled></button><button id="omega-revoke" type="button"></button><button id="omega-stop" type="button"></button></div>
  <label for="omega-review" id="omega-review-label"></label><input id="omega-review" type="file" accept=".json,application/json">
  <div class="actions"><button id="omega-refresh" type="button"></button><button id="omega-download" type="button"></button></div>
  <label for="omega-run" id="omega-run-label"></label><select id="omega-run"></select><p id="omega-message" role="status" aria-live="polite"></p>`;
  studio.prepend(panel);
  const $=name=>document.getElementById('omega-'+name);let fr=false,prepared=null,loaded=null,context=null,review=null,reviewer=null,busy=false;
  const t=(en,french)=>fr?french:en;
  function words(){
    const texts={intro:t('Try your Ω free in the Builder. Import its Fleet request here to inspect, authorize, create and check real files. Provider costs require your separate approval.','Essayez votre Ω gratuitement dans le Builder. Importez sa demande ici pour examiner, autoriser, créer et vérifier de vrais fichiers. Les coûts fournisseur nécessitent votre accord distinct.'),
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
  function invalidate(){prepared=null;$('confirm').checked=false;$('execute').disabled=true;}
  async function action(fn){if(busy)return;busy=true;try{await fn();}catch(e){$('message').textContent=(e.code?e.code+': ':'')+e.message;$('message').setAttribute('role','alert');}finally{busy=false;}}
  async function readInput(id,max){const f=$(id).files[0];if(!f||f.size>max)throw Error(t('Choose a JSON file within the stated limit.','Choisissez un fichier JSON respectant la limite.'));const text=await f.text();return text;}
  $('language').onclick=()=>{fr=!fr;words();};
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
  $('prepare').onclick=()=>action(async()=>{invalidate();prepared=await call('/api/successor/prepare',role==='agent'?{request:loaded,context:context??await guidedContext()}:{handoff:loaded});const {ticket,...safe}=prepared;$('preview').textContent=JSON.stringify(safe,null,2);$('message').textContent=t('Review this one-minute authorization. No work has started.','Examinez cette autorisation d’une minute. Aucun travail n’a démarré.');});
  $('confirm').onchange=()=>{$('execute').disabled=!prepared||!$('confirm').checked;};
  $('execute').onclick=()=>action(async()=>{const grant=prepared;invalidate();const answer=await call('/api/successor/execute',{ticket:grant.ticket,key:grant.key,confirm:true});$('message').textContent=t('Work started. Use Refresh results to see observed progress.','Travail démarré. Actualisez pour voir la progression observée.');await refresh();$('run').value=answer.key;});
  $('revoke').onclick=()=>action(async()=>{invalidate();await call('/api/successor/revoke',{});$('message').textContent=t('Pending authorizations revoked.','Autorisations en attente révoquées.');});
  $('stop').onclick=()=>action(async()=>{invalidate();await call('/api/successor/stop',{});await refresh();});
  async function refresh(){const s=await call('/api/successor');const selected=$('run').value;$('run').replaceChildren();for(const r of s.runs){const o=document.createElement('option');o.value=r.key;const run=s.studio.runs.find(x=>x.id===r.run);o.textContent=new Date(r.at).toLocaleString()+' · '+(run?.status??r.status);$('run').append(o);}if(s.runs.some(r=>r.key===selected))$('run').value=selected;$('message').textContent=s.studio.blockers.join(' ')||t('Status refreshed. Each result retains its actual scope.','État actualisé. Chaque résultat conserve sa portée réelle.');}
  $('refresh').onclick=()=>action(refresh);
  $('download').onclick=()=>action(async()=>{const result=await call('/api/successor/result',{key:$('run').value,review});download(role==='node'?'fleet-node-review.json':'fleet-result.json',result);if(result.capsule)download('My-SUCCESSOR-Omega-returned.json',result.capsule);});
  words();
})();
