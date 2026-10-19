'use strict';
let credential='',language='en',prepared=null,readiness=null,recovery=null,supportReport=null,stopped=false;
const $=id=>document.getElementById(id);
const english=new Map([...document.querySelectorAll('[data-i18n]')].map(e=>[e.dataset.i18n,e.textContent]));
const fr={eyebrow:'Une installation. Vos rôles. Votre travail.',title:'L’intelligence, chez vous.',lead:'Ajoutez les rôles nécessaires. Examinez chaque permission. Gardez le contrôle de chaque exécution.',preview:'Aperçu de développement',local:'Plusieurs acteurs sur un ordinateur, avec des autorisations distinctes et du travail hors ligne limité. La qualification native est requise.',dedicated:'Conservez les parcours existants : installation, signature, utilisation de l’ordinateur et protocole.',guide:'Ouvrir le guide d’installation existant ↗',connect:'Connexion à ce moteur local',tokenHelp:'Collez l’identifiant local indiqué par le lanceur. Il reste uniquement en mémoire dans cette page.',credential:'Identifiant local',connectButton:'Se connecter',computer:'1. Vérifier cet ordinateur',check:'Vérifier la disponibilité',details:'Observations techniques',add:'2. Ajouter un rôle',name:'Nom de l’acteur',role:'Rôle',create:'Ajouter l’acteur',work:'3. Préparer un travail utile',example:'L’exemple crée un véritable rapport modifiable à partir de données publiques synthétiques. Aucun appel de modèle et aucun coût en USDC.',choose:'Choisir un Agent actif',prepare:'Préparer l’exemple',authorize:'Autoriser cette exécution précise',run:'Exécuter sur cet ordinateur',outputs:'4. Examiner vos résultats',control:'Vous gardez le contrôle',pause:'Suspendre les nouveaux travaux',unpause:'Permettre de nouveaux travaux',stop:'ARRÊTER tous les acteurs',stopHelp:'L’arrêt persiste après un redémarrage. Il n’annule pas les actions passées. La reprise exige une réconciliation et une nouvelle activation.',footer:'Données publiques, sous licence ou synthétiques uniquement. Aucune qualification de production, d’examen indépendant ou de travail rémunéré n’est revendiquée.'};
const say=(en,frText=en)=>{$('status').textContent=language==='fr'?frText:en;};
Object.assign(fr,{resume:'Reprendre après examen des travaux inachevés',reconcile:'Clore cette tentative sans déclarer de réussite'});
Object.assign(fr,{pending:'Demandes en attente de votre décision',pendingHelp:'Un assistant peut préparer un travail. Vous seul pouvez en autoriser la portée précise ici.',refresh:'Actualiser les demandes et les résultats'});
Object.assign(fr,{support:'Besoin d’aide ?',supportHelp:'Prévisualisez un rapport contenant uniquement la disponibilité et des compteurs. Il exclut les identifiants, les noms et identités des acteurs, les données des tâches et leurs résultats. Examinez-le avant de choisir de le partager; rien n’est téléversé.',supportPreview:'Prévisualiser le rapport d’assistance',supportSave:'Enregistrer ce rapport'});
Object.assign(fr,{journeyTitle:'Conserver l’historique d’un même projet Alpha',journeyHelp:'Importez une demande Fleet provenant de votre projet Alpha guidé. La route USDC ou $AGIALPHA choisie reste liée au projet. L’importation ne donne aucune permission. Autorisez l’exécution puis une vérification interne distincte par un Node. Enregistrez le retour pour Alpha. Les propositions de marché restent non financées.',journeyFile:'Fichier de demande de projet Fleet',journeyImport:'Importer sans exécuter',journeyChoose:'Projet enregistré',journeyInspect:'Examiner le projet conservé',journeyPrepare:'Préparer avec l’Agent sélectionné',journeyExecution:'Exécution Agent terminée',journeyNode:'Node actif pour une vérification interne distincte',journeyReviewPrepare:'Préparer la vérification Node',journeyReview:'Vérification Node terminée',journeyExport:'Vérifier et enregistrer le retour pour Alpha',journeyScope:'Cette vérification locale limitée porte sur les fichiers de cette tâche. Les historiques Manager/Jobs joints ne sont pas vérifiés ici; leurs récepteurs natifs doivent les valider. Cet examen reste interne et ne prouve ni réussite du projet, ni affectation, ni paiement, ni qualification de production. Les retours importés restent historiques.'});
Object.assign(fr,{alphaComputerTitle:'Utiliser votre projet Alpha dans un navigateur',alphaComputerBadge:'Répétition scénarisée facultative',alphaComputerHelp:'Exécutez une répétition limitée et sans frais à partir de votre demande Alpha. Ce parcours facultatif exige un moteur local configuré séparément. Aucun appel à un modèle réel ni permission de portefeuille ou de règlement n’est accordé. Vos autorisations et l’ARRÊT restent en vigueur.',alphaComputerUnchecked:'Vérifiez la disponibilité ci-dessus pour savoir si ce parcours facultatif est configuré.',alphaComputerFile:'Fichier de demande Alpha Computer Use',alphaComputerPublic:'Je confirme que cette demande utilise uniquement des données publiques non personnelles.',alphaComputerPrepare:'Préparer avec l’Agent sélectionné',alphaComputerNext:'Examinez la tâche exacte et ses limites, puis autorisez et exécutez une seule fois avec les commandes ci-dessus. Enregistrez le retour natif et examinez les captures avant de l’importer dans le même projet Alpha. Une répétition réussie ne prouve ni acceptation indépendante ni revenu.',footer:'Données publiques non personnelles uniquement. Aucune qualification de production, d’examen indépendant ou de travail rémunéré n’est revendiquée.'});
async function api(action,input={}){
  const r=await fetch('/v1/'+action,{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(input),cache:'no-store',redirect:'error'});
  const v=await r.json();if(!r.ok)throw Object.assign(Error(v.error||'REQUEST_FAILED'),{action});return v;
}
function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',()=>attempt(fn));return b;}
function journeyAdmissionMessage(code,action){
  if(['JOURNEY_STORAGE_LIMIT','JOURNEY_LIMIT'].includes(code)&&action==='journey-import')return [
    'Import refused: there is not enough history space to reserve the complete return. The 32 MB history budget includes reserved complete returns for pending and completed projects, with at most 32 rows. This import saved no project, started no execution and created or consumed no grant. Keep the original file and history. There is no room for this additional complete return; nothing was deleted or truncated.',
    'Import refusé : l’espace d’historique ne suffit pas à réserver le retour complet. Le budget d’historique de 32 Mo comprend les retours complets réservés des projets en attente et terminés, avec au plus 32 entrées. Cet import n’a enregistré aucun projet, lancé aucune exécution, créé ni consommé aucune autorisation. Conservez le fichier original et l’historique. La place manque pour ce retour complet supplémentaire; rien n’a été supprimé ni tronqué.'
  ];
  if(!['journey-import','journey-prepare','journey-review-prepare'].includes(action)
    ||!['PROJECT_RETURN_CAPACITY','PROJECT_TRANSFER_SIZE','OUTPUT_SIZE'].includes(code))return null;
  const imported=action==='journey-import';
  return [
    'This request cannot fit its complete report, receipts and retained return. '+(imported?'This import saved no project, started no execution and created or consumed no grant. ':'No new grant was prepared or consumed and no execution started. ')+
      'Keep the original file and existing history. Choose a smaller supported export or input; no history was truncated.',
    'Cette demande ne peut pas contenir le rapport complet, les reçus et le retour conservé. '+(imported?"Cet import n’a enregistré aucun projet, lancé aucune exécution, créé ni consommé aucune autorisation. ":"Aucune nouvelle autorisation n’a été préparée ou consommée; aucune exécution n’a commencé. ")+
      'Conservez le fichier original et l’historique existant. Choisissez un export ou des données plus petits et pris en charge; aucun historique n’a été tronqué.'
  ];
}
async function attempt(fn){try{await fn();}catch(e){const message=journeyAdmissionMessage(e.message,e.action);if(message)say(...message);else say('Blocked: '+e.message+'. Inspect readiness and the operator guide.','Bloqué : '+e.message+'. Consultez la disponibilité et le guide.');}}
function save(name,value,type='application/json'){
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob([typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value,null,2)],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function refresh(){
  const selectedJourney=$('journey').value,selectedExecution=$('journeyExecution').value,selectedReview=$('journeyReview').value;
  const s=await api('status');stopped=Boolean(s.stopped);$('actors').replaceChildren();$('actor').replaceChildren();$('runs').replaceChildren();$('pending').replaceChildren();
  $('journeyNode').replaceChildren();$('journeyExecution').replaceChildren();$('journeyReview').replaceChildren();
  const option=(select,value,text)=>{const o=document.createElement('option');o.value=value;o.textContent=text;$(select).append(o);};
  for(const a of s.actors)if(a.role==='node'&&a.active)option('journeyNode',a.id,a.name);
  for(const r of s.runs)if(r.state==='complete'&&['agent','node'].includes(r.value.role))option(r.value.role==='agent'?'journeyExecution':'journeyReview',r.id,r.id);
  if([...$('journeyExecution').options].some(o=>o.value===selectedExecution))$('journeyExecution').value=selectedExecution;
  if([...$('journeyReview').options].some(o=>o.value===selectedReview))$('journeyReview').value=selectedReview;
  const retained=await api('journey-list');$('journey').replaceChildren();for(const item of retained.journeys)option('journey',item.journey,item.project.projectId+' · '+item.project.cycleId+' · '+item.route.asset);
  if([...$('journey').options].some(o=>o.value===selectedJourney))$('journey').value=selectedJourney;
  for(const g of s.pending){const row=document.createElement('div');row.className='run';row.textContent=g.action+' · '+g.actor+' · '+g.state+' ';
    row.append(button(language==='fr'?'Examiner cette demande':'Inspect this request',async()=>{
      prepared=await api('grant-inspect',{grant:g.grant});$('grantDetails').textContent=JSON.stringify(prepared,null,2);$('grant').hidden=false;
      $('authorize').disabled=prepared.state!=='prepared';$('run').disabled=!(prepared.state==='authorized'&&prepared.preparingClient==='this-operator');$('grantDetails').focus();
    }),button(language==='fr'?'Révoquer':'Revoke',async()=>{await api('revoke',{grant:g.grant});await refresh();}));$('pending').append(row);
  }
  for(const a of s.actors){
    const row=document.createElement('div');row.className='actor';const title=document.createElement('strong');title.textContent=`${a.name} · AGI ${a.role}`;row.append(title);
    const p=document.createElement('p');p.textContent=`${a.active?(language==='fr'?'Actif':'Active'):(language==='fr'?'Activation requise':'Activation required')} · ${a.id}`;row.append(p);
    row.append(button(language==='fr'?'Activer':'Activate',async()=>{await api('activate',{actor:a.id,confirm:true});await refresh();}),button(language==='fr'?'Exporter le rôle':'Export role',async()=>save('fleet-role-'+a.role+'.json',await api('export',{actor:a.id}))),button(language==='fr'?'ARRÊTER cet acteur':'STOP actor',async()=>{await api('stop',{actor:a.id});await refresh();}));$('actors').append(row);
    if(a.role==='agent'&&a.active){const o=document.createElement('option');o.value=a.id;o.textContent=a.name;$('actor').append(o);}
  }
  for(const r of s.runs){const row=document.createElement('div');row.className='run';row.textContent=`${r.state} · ${r.value.role} · ${r.id} `;row.append(button(language==='fr'?'Voir le résultat':'View output',async()=>{
    const value=await api('output',{actor:r.actor,run:r.id});$('output').textContent=JSON.stringify(value,null,2);
    const files=value.receipt?.result?.files||[];for(const f of files){row.append(button((language==='fr'?'Enregistrer ':'Save ')+f.name,()=>save(f.name,f.content,f.mediaType)));}
    appendComputerOutputs(row,r,value.receipt?.result);
  }));
  if(r.state==='uncertain')row.append(button(language==='fr'?'Examiner la reprise':'Inspect recovery',async()=>{
    recovery=await api('reconciliation',{run:r.id});$('recovery').hidden=false;$('recoveryDetails').textContent=JSON.stringify(recovery,null,2);
    $('reconcile').disabled=!recovery.eligible;
    $('recoveryHelp').textContent=recovery.eligible?(language==='fr'?'La fermeture de cet environnement hors ligne a été observée. Clore conserve l’échec, la réservation et l’ARRÊT. Aucun travail ne sera répété.':'Closure of this offline environment was observed. Closing the attempt preserves failure evidence, its reservation and STOP. No work will be repeated.'):(language==='fr'?'La fermeture sûre n’est pas établie. Conservez l’ARRÊT et suivez le guide de reprise.':'Safe closure is not established. Keep STOP active and follow the recovery guide.');
    $('recoveryHelp').tabIndex=-1;$('recoveryHelp').focus();
  }));$('runs').append(row);}
  $('resume').hidden=!s.stopped;
  renderComputerReadiness();
  if(s.stopped)say('STOP is active. Inspect outstanding runs before recovery.','ARRÊT actif. Examinez les travaux avant la reprise.');
}
function renderReadiness(){
  if(!readiness)return;
  const messages={
    ready:['Ready for bounded offline tasks.','Disponible pour les tâches hors ligne limitées.'],
    SANDBOX_NAMESPACE_DENIED:['This computer is blocking the required isolation. Execution remains stopped. An administrator must review the supported platform setup; keep operating-system security enabled.','Cet ordinateur bloque l’isolation requise. L’exécution reste arrêtée. Un administrateur doit vérifier la configuration prise en charge; conservez les protections du système.'],
    SANDBOX_EXECUTABLE_UNTRUSTED:['A required runtime executable has an untrusted owner or permissions. Use a verified installation before activating actors.','Un exécutable requis a un propriétaire ou des permissions non fiables. Utilisez une installation vérifiée avant d’activer les acteurs.'],
    SANDBOX_PREREQUISITE_MISSING:['Required isolation software is missing. Follow the engineering setup guide, then check this computer again.','Le logiciel d’isolation requis est absent. Suivez le guide de configuration, puis vérifiez de nouveau cet ordinateur.'],
    blocked:['This computer has not passed the isolation check. Execution stays blocked. Review the observations and setup guide.','Cet ordinateur n’a pas réussi la vérification d’isolation. L’exécution reste bloquée. Consultez les observations et le guide.']
  };
  const pair=messages[readiness.supported?'ready':readiness.code]||messages.blocked;
  $('readiness').textContent=pair[language==='fr'?1:0];
}
$('language').onclick=()=>{language=language==='en'?'fr':'en';document.documentElement.lang=language;$('language').textContent=language==='en'?'Français':'English';for(const e of document.querySelectorAll('[data-i18n]'))e.textContent=language==='fr'?fr[e.dataset.i18n]:english.get(e.dataset.i18n);renderReadiness();renderComputerReadiness();if(credential)attempt(refresh);};
$('connect').onclick=()=>attempt(async()=>{credential=$('token').value.trim();$('token').value='';await refresh();$('login').hidden=true;$('connected').hidden=false;say('Connected to this computer.','Connecté à cet ordinateur.');});
$('doctor').onclick=()=>attempt(async()=>{readiness=await api('doctor');$('diagnostic').textContent=JSON.stringify(readiness,null,2);renderReadiness();renderComputerReadiness();});
$('add').onclick=()=>attempt(async()=>{await api('create',{role:$('role').value,name:$('name').value});await refresh();});
$('prepare').onclick=()=>attempt(async()=>{
  const actor=$('actor').value;if(!actor)throw Error('ACTIVATION_REQUIRED');
  const mission=await api('example',{kind:'analyst',language});
  prepared=await api('prepare',{actor,task:{schema:'agi-fleet/local-task/v1',action:'successor-run',workspace:'files',input:{mission,variant:'improved'},review:'none',sourceActor:null,sourceController:null}});
  $('grantDetails').textContent=JSON.stringify(prepared,null,2);$('grant').hidden=false;$('run').disabled=true;$('authorize').disabled=false;say('Inspect the input, output scope and limits before authorizing.','Examinez les données et les limites avant d’autoriser.');
});
$('authorize').onclick=()=>attempt(async()=>{await api('authorize',{grant:prepared.grant,commitment:prepared.commitment,confirm:true});$('authorize').disabled=true;$('run').disabled=prepared.preparingClient==='scoped-client';say('Authorized once. The preparing client can run within five minutes.','Autorisé une seule fois. Le client ayant préparé la tâche peut l’exécuter dans les cinq minutes.');await refresh();});
$('run').onclick=()=>attempt(async()=>{$('run').disabled=true;const v=await api('run',{actor:prepared.actor,grant:prepared.grant});$('output').textContent=JSON.stringify(v,null,2);await refresh();if(prepared.journey){$('journey').value=prepared.journey;$(prepared.task.action==='successor-check'?'journeyReview':'journeyExecution').value=v.run;}say('Execution recorded. Inspect its state and save the output files before accepting the work.','Exécution enregistrée. Examinez son état et enregistrez les fichiers avant d’accepter le travail.');});
$('pause').onclick=()=>attempt(async()=>{await api('pause',{paused:true});say('New work paused; accepted work continues.','Nouveaux travaux suspendus; les travaux acceptés continuent.');});
$('unpause').onclick=()=>attempt(async()=>{await api('pause',{paused:false});say('New work allowed, subject to STOP and readiness.','Nouveaux travaux permis, sous réserve de l’arrêt et de la disponibilité.');});
$('stop').onclick=()=>attempt(async()=>{await api('stop',{actor:null});await refresh();});
$('refresh').onclick=()=>attempt(refresh);
$('reconcile').onclick=()=>attempt(async()=>{if(!recovery?.eligible)throw Error('RECOVERY_NOT_READY');await api('reconcile',{run:recovery.run,commitment:recovery.commitment,confirm:true});recovery=null;$('recovery').hidden=true;await refresh();say('Attempt closed without success. STOP and its reservation are preserved.','Tentative close sans réussite. L’ARRÊT et sa réservation sont conservés.');});
$('resume').onclick=()=>attempt(async()=>{await api('resume',{confirm:true});await refresh();say('Ready for fresh activation. Previous permissions were not restored.','Prêt pour une nouvelle activation. Les permissions précédentes ne sont pas rétablies.');});

$('supportPreview').onclick=()=>attempt(async()=>{supportReport=await api('diagnostics');$('supportDetails').textContent=JSON.stringify(supportReport,null,2);$('supportReport').hidden=false;$('supportDetails').focus();say('Review the report, then save it only if you want to share it.','Examinez le rapport, puis enregistrez-le seulement si vous souhaitez le partager.');});
$('supportSave').onclick=()=>{if(supportReport)save('fleet-local-support.json',supportReport);};

function showJourneyGrant(value){prepared=value;$('grantDetails').textContent=JSON.stringify(value,null,2);$('grant').hidden=false;$('authorize').disabled=false;$('run').disabled=true;$('grantDetails').focus();say('Inspect the exact project task and limits, then authorize this run.','Examinez la tâche du projet et ses limites, puis autorisez cette exécution.');}
$('journeyImport').onclick=()=>attempt(async()=>{const file=$('journeyFile').files[0];if(!file)throw Error('PROJECT_FILE_REQUIRED');if(file.size>4_000_000)throw Object.assign(Error('PROJECT_TRANSFER_SIZE'),{action:'journey-import'});let raw;try{raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());}catch{throw Error('PROJECT_UTF8_REQUIRED');}const result=await api('journey-import',{request:raw,confirm:true});await refresh();$('journey').value=result.journey;$('journeyDetails').textContent=JSON.stringify(result,null,2);say('Project retained. Execution requires a fresh explicit grant.','Projet conservé. Une nouvelle autorisation explicite est requise pour exécuter.');});
$('journeyInspect').onclick=()=>attempt(async()=>{const result=await api('journey-inspect',{journey:$('journey').value});$('journeyDetails').textContent=JSON.stringify(result,null,2);$('journeyDetails').focus();});
$('journeyPrepare').onclick=()=>attempt(async()=>showJourneyGrant(await api('journey-prepare',{journey:$('journey').value,actor:$('actor').value})));
$('journeyReviewPrepare').onclick=()=>attempt(async()=>showJourneyGrant(await api('journey-review-prepare',{journey:$('journey').value,execution:$('journeyExecution').value,actor:$('journeyNode').value})));
$('journeyExport').onclick=()=>attempt(async()=>{const result=await api('journey-export',{journey:$('journey').value,execution:$('journeyExecution').value,review:$('journeyReview').value,confirm:true});save('alpha-fleet-project-return.json',result.returned);$('journeyDetails').textContent=JSON.stringify({journey:result.journey,authority:result.authority,independentReview:false,productionQualified:false,settlement:result.settlement},null,2);say('Return saved. Import it into the same Alpha project as historical internal evidence.','Retour enregistré. Importez-le dans le même projet Alpha comme preuve interne historique.');});

function renderComputerReadiness(){
  const computer=readiness?.alphaComputer,available=computer?.supported===true;
  $('computerPrepare').disabled=!available||stopped||!$('computerFile').files.length||!$('computerPublic').checked||!$('actor').value;
  const pair=!readiness?[
    'Check readiness above to see whether this optional route is configured.',
    'Vérifiez la disponibilité ci-dessus pour savoir si ce parcours facultatif est configuré.'
  ]:available?[
    'The scripted, zero-cost browser route is configured. Choose a public Alpha handoff and an active Agent; preparation creates no execution authority.',
    'Le parcours de navigateur scénarisé et sans frais est configuré. Choisissez une demande Alpha publique et un Agent actif; la préparation ne donne aucune permission d’exécuter.'
  ]:[
    'This optional browser route is unavailable. Follow the operator guide to configure its reviewed local executor, then check readiness again. Existing offline work remains separate.',
    'Ce parcours facultatif de navigateur est indisponible. Suivez le guide opérateur pour configurer le moteur local examiné, puis revérifiez la disponibilité. Le travail hors ligne existant reste distinct.'
  ];
  $('computerReadiness').textContent=pair[language==='fr'?1:0];
}
async function checkedComputerBytes(bytes,expected){
  if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))throw Error('COMPUTER_ARTIFACT_INTEGRITY');
  const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(actual!==expected)throw Error('COMPUTER_ARTIFACT_INTEGRITY');
  return bytes;
}
function appendComputerOutputs(row,run,result){
  if(!result||!Array.isArray(result.files)||!result.files.some(file=>file.name==='computer-return.json'))return;
  row.append(button(language==='fr'?'Enregistrer le retour natif pour Alpha':'Save native return for Alpha',async()=>{
    const value=await api('computer-export',{actor:run.actor,run:run.id});
    if(value.name!=='computer-return.json'||typeof value.content!=='string')throw Error('COMPUTER_RETURN_INVALID');
    const bytes=new TextEncoder().encode(value.content);if(bytes.length>4_000_000)throw Error('COMPUTER_RETURN_LIMIT');
    await checkedComputerBytes(bytes,value.sha256);save(value.name,value.content);
    say('Native return saved. Import it into the same Alpha project and review its evidence before accepting any result.','Retour natif enregistré. Importez-le dans le même projet Alpha et examinez ses preuves avant d’accepter un résultat.');
  }));
  for(const artifact of (Array.isArray(result.artifacts)?result.artifacts:[]).slice(0,64)){
    if(artifact.mediaType!=='image/png'||typeof artifact.name!=='string'||artifact.name.length>160||!artifact.name.split('/').every(part=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)&&part!=='.'&&part!=='..'))continue;
    row.append(button((language==='fr'?'Enregistrer la capture ':'Save screenshot ')+artifact.name,async()=>{
      const value=await api('computer-artifact',{actor:run.actor,run:run.id,name:artifact.name});
      if(value.name!==artifact.name||value.mediaType!=='image/png'||value.sha256!==artifact.sha256||typeof value.contentBase64!=='string'||value.contentBase64.length>4_000_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.contentBase64))throw Error('COMPUTER_ARTIFACT_INVALID');
      const bytes=Uint8Array.from(atob(value.contentBase64),c=>c.charCodeAt(0));
      if(bytes.length!==artifact.bytes||![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))throw Error('COMPUTER_ARTIFACT_INVALID');
      await checkedComputerBytes(bytes,artifact.sha256);save(artifact.name.split('/').at(-1),bytes,'image/png');
    }));
  }
}
$('computerFile').onchange=()=>{$('computerPublic').checked=false;renderComputerReadiness();};
$('computerPublic').onchange=renderComputerReadiness;
$('actor').onchange=renderComputerReadiness;
$('computerPrepare').onclick=()=>attempt(async()=>{
  if(readiness?.alphaComputer?.supported!==true||stopped)throw Error('COMPUTER_RUNTIME_UNAVAILABLE');
  const actor=$('actor').value,file=$('computerFile').files[0];
  if(!actor)throw Error('ACTIVATION_REQUIRED');if(!file)throw Error('COMPUTER_FILE_REQUIRED');
  if(!$('computerPublic').checked)throw Error('PUBLIC_NONPERSONAL_CONFIRMATION_REQUIRED');
  if(file.size>1_000_000)throw Error('COMPUTER_HANDOFF_LIMIT');
  let handoffRaw;try{handoffRaw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());}catch{throw Error('COMPUTER_UTF8_REQUIRED');}
  const task={schema:'agi-fleet/local-task/v1',action:'alpha-computer-run',workspace:'files',input:{handoffRaw,publicNonpersonal:true},review:'none',sourceActor:null,sourceController:null};
  const value=await api('prepare',{actor,task});showJourneyGrant(value);$('computerPublic').checked=false;renderComputerReadiness();
  say('Browser rehearsal prepared without running. Inspect the exact handoff and limits above before authorizing once.','Répétition de navigateur préparée sans exécution. Examinez la demande exacte et ses limites ci-dessus avant d’autoriser une seule fois.');
});

for(const id of ['language','token','connect'])$(id).disabled=false;
