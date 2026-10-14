'use strict';
let credential='',language='en',prepared=null,readiness=null,recovery=null;
const $=id=>document.getElementById(id);
const english=new Map([...document.querySelectorAll('[data-i18n]')].map(e=>[e.dataset.i18n,e.textContent]));
const fr={eyebrow:'Une installation. Vos rôles. Votre travail.',title:'L’intelligence, chez vous.',lead:'Ajoutez les rôles nécessaires. Examinez chaque permission. Gardez le contrôle de chaque exécution.',preview:'Aperçu de développement',local:'Plusieurs acteurs sur un ordinateur, avec des autorisations distinctes et du travail hors ligne limité. La qualification native est requise.',dedicated:'Conservez les parcours existants : installation, signature, utilisation de l’ordinateur et protocole.',guide:'Ouvrir le guide d’installation existant ↗',connect:'Connexion à ce moteur local',tokenHelp:'Collez l’identifiant local indiqué par le lanceur. Il reste uniquement en mémoire dans cette page.',credential:'Identifiant local',connectButton:'Se connecter',computer:'1. Vérifier cet ordinateur',check:'Vérifier la disponibilité',details:'Observations techniques',add:'2. Ajouter un rôle',name:'Nom de l’acteur',role:'Rôle',create:'Ajouter l’acteur',work:'3. Préparer un travail utile',example:'L’exemple crée un véritable rapport modifiable à partir de données publiques synthétiques. Aucun appel de modèle et aucun coût en USDC.',choose:'Choisir un Agent actif',prepare:'Préparer l’exemple',authorize:'Autoriser cette exécution précise',run:'Exécuter sur cet ordinateur',outputs:'4. Examiner vos résultats',control:'Vous gardez le contrôle',pause:'Suspendre les nouveaux travaux',unpause:'Permettre de nouveaux travaux',stop:'ARRÊTER tous les acteurs',stopHelp:'L’arrêt persiste après un redémarrage. Il n’annule pas les actions passées. La reprise exige une réconciliation et une nouvelle activation.',footer:'Données publiques, sous licence ou synthétiques uniquement. Aucune qualification de production, d’examen indépendant ou de travail rémunéré n’est revendiquée.'};
const say=(en,frText=en)=>{$('status').textContent=language==='fr'?frText:en;};
Object.assign(fr,{resume:'Reprendre après examen des travaux inachevés',reconcile:'Clore cette tentative sans déclarer de réussite'});
Object.assign(fr,{pending:'Demandes en attente de votre décision',pendingHelp:'Un assistant peut préparer un travail. Vous seul pouvez en autoriser la portée précise ici.',refresh:'Actualiser les demandes et les résultats'});
async function api(action,input={}){
  const r=await fetch('/v1/'+action,{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(input),cache:'no-store',redirect:'error'});
  const v=await r.json();if(!r.ok)throw Error(v.error||'REQUEST_FAILED');return v;
}
function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',()=>attempt(fn));return b;}
async function attempt(fn){try{await fn();}catch(e){say('Blocked: '+e.message+'. Inspect readiness and the operator guide.','Bloqué : '+e.message+'. Consultez la disponibilité et le guide.');}}
function save(name,value,type='application/json'){
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function refresh(){
  const s=await api('status');$('actors').replaceChildren();$('actor').replaceChildren();$('runs').replaceChildren();$('pending').replaceChildren();
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
  }));
  if(r.state==='uncertain')row.append(button(language==='fr'?'Examiner la reprise':'Inspect recovery',async()=>{
    recovery=await api('reconciliation',{run:r.id});$('recovery').hidden=false;$('recoveryDetails').textContent=JSON.stringify(recovery,null,2);
    $('reconcile').disabled=!recovery.eligible;
    $('recoveryHelp').textContent=recovery.eligible?(language==='fr'?'La fermeture de cet environnement hors ligne a été observée. Clore conserve l’échec, la réservation et l’ARRÊT. Aucun travail ne sera répété.':'Closure of this offline environment was observed. Closing the attempt preserves failure evidence, its reservation and STOP. No work will be repeated.'):(language==='fr'?'La fermeture sûre n’est pas établie. Conservez l’ARRÊT et suivez le guide de reprise.':'Safe closure is not established. Keep STOP active and follow the recovery guide.');
    $('recoveryHelp').tabIndex=-1;$('recoveryHelp').focus();
  }));$('runs').append(row);}
  $('resume').hidden=!s.stopped;
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
$('language').onclick=()=>{language=language==='en'?'fr':'en';document.documentElement.lang=language;$('language').textContent=language==='en'?'Français':'English';for(const e of document.querySelectorAll('[data-i18n]'))e.textContent=language==='fr'?fr[e.dataset.i18n]:english.get(e.dataset.i18n);renderReadiness();if(credential)attempt(refresh);};
$('connect').onclick=()=>attempt(async()=>{credential=$('token').value.trim();$('token').value='';await refresh();$('login').hidden=true;$('connected').hidden=false;say('Connected to this computer.','Connecté à cet ordinateur.');});
$('doctor').onclick=()=>attempt(async()=>{readiness=await api('doctor');$('diagnostic').textContent=JSON.stringify(readiness,null,2);renderReadiness();});
$('add').onclick=()=>attempt(async()=>{await api('create',{role:$('role').value,name:$('name').value});await refresh();});
$('prepare').onclick=()=>attempt(async()=>{
  const actor=$('actor').value;if(!actor)throw Error('ACTIVATION_REQUIRED');
  const mission=await api('example',{kind:'analyst',language});
  prepared=await api('prepare',{actor,task:{schema:'agi-fleet/local-task/v1',action:'successor-run',workspace:'files',input:{mission,variant:'improved'},review:'none',sourceActor:null,sourceController:null}});
  $('grantDetails').textContent=JSON.stringify(prepared,null,2);$('grant').hidden=false;$('run').disabled=true;$('authorize').disabled=false;say('Inspect the input, output scope and limits before authorizing.','Examinez les données et les limites avant d’autoriser.');
});
$('authorize').onclick=()=>attempt(async()=>{await api('authorize',{grant:prepared.grant,commitment:prepared.commitment,confirm:true});$('authorize').disabled=true;$('run').disabled=prepared.preparingClient==='scoped-client';say('Authorized once. The preparing client can run within five minutes.','Autorisé une seule fois. Le client ayant préparé la tâche peut l’exécuter dans les cinq minutes.');await refresh();});
$('run').onclick=()=>attempt(async()=>{$('run').disabled=true;const v=await api('run',{actor:prepared.actor,grant:prepared.grant});$('output').textContent=JSON.stringify(v,null,2);await refresh();say('Complete. Inspect and save your real output files.','Terminé. Examinez et enregistrez les fichiers produits.');});
$('pause').onclick=()=>attempt(async()=>{await api('pause',{paused:true});say('New work paused; accepted work continues.','Nouveaux travaux suspendus; les travaux acceptés continuent.');});
$('unpause').onclick=()=>attempt(async()=>{await api('pause',{paused:false});say('New work allowed, subject to STOP and readiness.','Nouveaux travaux permis, sous réserve de l’arrêt et de la disponibilité.');});
$('stop').onclick=()=>attempt(async()=>{await api('stop',{actor:null});await refresh();});
$('refresh').onclick=()=>attempt(refresh);
$('reconcile').onclick=()=>attempt(async()=>{if(!recovery?.eligible)throw Error('RECOVERY_NOT_READY');await api('reconcile',{run:recovery.run,commitment:recovery.commitment,confirm:true});recovery=null;$('recovery').hidden=true;await refresh();say('Attempt closed without success. STOP and its reservation are preserved.','Tentative close sans réussite. L’ARRÊT et sa réservation sont conservés.');});
$('resume').onclick=()=>attempt(async()=>{await api('resume',{confirm:true});await refresh();say('Ready for fresh activation. Previous permissions were not restored.','Prêt pour une nouvelle activation. Les permissions précédentes ne sont pas rétablies.');});
