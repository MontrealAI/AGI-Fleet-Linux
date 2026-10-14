import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {builderArtifacts} from './vendor/manager/scripts/successor/build.mjs';
import {sourceZip} from './vendor/manager/site/assets/successor/archive.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const hash=(s,format='hex')=>createHash('sha256').update(s).digest(format);
const inert=v=>JSON.stringify(v).replace(/</g,'\\u003c');
function once(s,a,b){if(s.split(a).length!==2)throw Error('UPSTREAM_ADAPTATION_DRIFT: '+a.slice(0,60));return s.replace(a,b);}
export function verifyUpstream(){
  const p=JSON.parse(fs.readFileSync(path.join(root,'vendor/manager-provenance.json')));
  for(const row of p.files)if(hash(fs.readFileSync(path.join(root,'vendor/manager',row.path)))!==row.sha256)throw Error('UPSTREAM_CHANGED: '+row.path);
  return p;
}
function layout(text,lang){
  const t=(en,fr)=>lang==='fr'?fr:en;
  text=text.replace('<span>AGI Jobs<small>SUCCESSOR BUILDER</small>','<span>AGI Fleet<small>SUCCESSOR Ω + FLEET</small>');
  text=text.replace('class="brand" href="../"','class="brand" href="https://montrealai.github.io/AGI-Fleet-Linux/"');
  text=text.replace('href="../employers/"','href="https://montrealai.github.io/AGIJobManager/employers/"');
  text=text.replace(/<div class="steps"[\s\S]*?<\/div>/,`<nav class="steps" aria-label="${t('Your workspace','Votre espace')}">${[['create','My Ω','Mon Ω'],['connect','Do work','Travailler'],['improve','Improve','Améliorer'],['results','Results','Résultats'],['keep','Save and restore','Sauvegarder et restaurer']].map(([id,en,fr])=>`<a href="#${id}">${t(en,fr)}</a>`).join('')}</nav>`);
  const section=`<section id="connect" class="workspace"><div class="section-heading"><span class="number">Ω</span><div><h2>${t('Give your Ω a computer.','Donnez un ordinateur à votre Ω.')}</h2><p>${t('One mission. Real files. A version you choose.','Une mission. De vrais fichiers. Une version que vous choisissez.')}</p></div></div>
  <div class="two-col"><div><h3>${t('Try my Ω','Essayer mon Ω')}</h3><p>${t('The two local methods above work offline, free. Edit the inputs, inspect the files, and keep your chosen version.','Les deux méthodes locales ci-dessus fonctionnent gratuitement, hors ligne. Adaptez les données, examinez les fichiers et conservez la version choisie.')}</p><a href="#create">${t('Make my first result','Créer mon premier résultat')}</a></div>
  <div><h3>${t('Connect my computer','Connecter mon ordinateur')}</h3><p>${t('Prepare an improvement below, then download its Fleet request. In your installed Agent, open Work Studio → SUCCESSOR Ω + Fleet. Inspect the public inputs and real runtime, then approve one bounded attempt.','Préparez une amélioration ci-dessous, puis téléchargez sa demande Fleet. Dans l’Agent installé, ouvrez Work Studio → SUCCESSOR Ω + Fleet. Examinez les données publiques et l’environnement réel, puis autorisez un essai limité.')}</p><button type="button" id="fleet-export" disabled>${t('Download my Fleet request','Télécharger ma demande Fleet')}</button></div></div>
  <h3>${t('Check. Choose. Keep.','Vérifiez. Choisissez. Conservez.')}</h3><ol><li>${t('Agent creates actual files through Fleet compute. Download its review handoff.','L’Agent crée les fichiers par le calcul Fleet. Téléchargez le transfert de revue.')}</li><li>${t('A Node opens those same bytes and records each criterion. Download the Node receipt.','Un Node ouvre ces mêmes octets et consigne chaque critère. Téléchargez le reçu Node.')}</li><li>${t('Back in the Agent, import the Node receipt and download the checked capsule. Restore it below, compare, and explicitly keep the version you want. A failed candidate keeps the incumbent.','Dans l’Agent, importez le reçu Node et téléchargez la capsule vérifiée. Restaurez-la ci-dessous, comparez et choisissez explicitement votre version. Un échec conserve la version actuelle.')}</li></ol>
  <p class="notice">${t('This page stays offline: it never contacts your computer or holds credentials. Connection, provider competence, independent review, payment and permission are separate. Large files travel with a verified sidecar, outside wallet backups.','Cette page reste hors ligne : elle ne contacte jamais votre ordinateur et ne détient aucun identifiant secret. Connexion, compétence fournisseur, revue indépendante, paiement et permission restent distincts. Les fichiers volumineux utilisent un dossier vérifié distinct des sauvegardes du portefeuille.')}</p>
  <p><a href="https://montrealai.github.io/AGI-Fleet-Linux/start${lang==='fr'?'-fr':''}.html">${t('Set up Fleet on my computer','Configurer Fleet sur mon ordinateur')}</a> · <a href="https://github.com/MontrealAI/AGI-Fleet-Linux/blob/main/successor/docs/GUIDE.md">${t('Step-by-step guide','Guide pas à pas')}</a></p></section>`;
  text=once(text,'<section id="improve"',section+'<section id="improve"');
  return once(text,'id="result-content"',`id="fleet-version-wrap"><label for="fleet-version">${t('Inspect a saved version (selection does not activate it)','Examiner une version conservée (sans l’activer)')}</label><select id="fleet-version"></select></div><div id="result-content"`);
}
export function fleetArtifacts(){
  const upstream=verifyUpstream(),built=builderArtifacts();
  const sources=[];
  function visit(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name),rel=path.relative(root,p).split(path.sep).join('/');if(item.isSymbolicLink())throw Error('SOURCE_SYMLINK');if(item.isDirectory())visit(p);else if(!['My-SUCCESSOR-Omega-en.html','My-SUCCESSOR-Omega-fr.html','SOURCE_MANIFEST.json'].includes(rel)&&!rel.endsWith('.zip'))sources.push({path:rel,content:fs.readFileSync(p,'utf8')});}}
  visit(root);sources.sort((a,b)=>a.path.localeCompare(b.path));
  const layouts={};
  for(const lang of ['en','fr']){const match=built.pages[lang].match(/<div id="interface">([\s\S]*?)<\/div><script id="successor-source"/);if(!match)throw Error('UPSTREAM_LAYOUT_DRIFT');layouts[lang]=layout(match[1],lang);}
  const pages={};
  for(const lang of ['en','fr']){
    let html=built.pages[lang];const match=html.match(/<script>([\s\S]*?)<\/script><\/body>/);if(!match)throw Error('UPSTREAM_SCRIPT_DRIFT');let script=match[1];
    script=once(script,"const STORAGE_KEY = 'agijobmanager_successor_capsule_v1';","const STORAGE_KEY = 'agi_fleet_successor_capsule_v1';");
    script=once(script,'  function redraw() {',`  function redraw() {
    $('fleet-export').disabled = !state?.active;
    $('fleet-version-wrap').hidden = !state?.candidates.length;
    $('fleet-version').replaceChildren();
    for (const saved of state?.candidates || []) { const option=document.createElement('option'); option.value=saved.id; option.textContent=(saved.id===state.active?t('Current · ','Actuelle · '):t('Candidate · ','Candidat · '))+saved.manifest.variant+' · '+saved.id.slice(0,12); $('fleet-version').append(option); }
    if(candidate)$('fleet-version').value=candidate.id;
`);
    script=once(script,"    bind('keep-version',",`    bind('fleet-version', () => { candidate=state.candidates.find(c=>c.id===$('fleet-version').value); redraw(); const active=state.candidates.find(c=>c.id===state.active); if(active && candidate && candidate.id!==active.id){const comparison=compareCandidates(active,candidate); $('comparison').textContent=t('Compared with the current version: ','Comparaison avec la version actuelle : ')+comparison.outcome; if(comparison.outcome!=='improvement')$('keep-version').disabled=true;} }, 'change');
    bind('keep-version',`);
    script=once(script,"    bind('download-capsule',",`    bind('fleet-export', async () => { fail(state?.active, 'SELECT_VERSION'); fail(plan, 'FLEET_PLAN_REQUIRED'); download('My-SUCCESSOR-Omega-Fleet-request.json', JSON.stringify({schema:'agi-fleet/successor-request/v1',capsule:await exportCapsule(state, source),plan},null,2)); });\n    bind('download-capsule',`);
    script=once(script,'      FIELD_REQUIRED:',"      FLEET_PLAN_REQUIRED: ['Prepare the optional AGI Jobs improvement request below with a USDC planning allowance, then download your Fleet request. No money is sent.', 'Préparez la demande d’amélioration AGI Jobs ci-dessous avec un budget USDC indicatif, puis téléchargez votre demande Fleet. Aucun argent n’est envoyé.'],\n      FIELD_REQUIRED:");
    html=once(html,match[1],script).replace("script-src 'sha256-"+hash(match[1],'base64')+"'","script-src 'sha256-"+hash(script,'base64')+"'");
    html=html.replace(/(<div id="interface">)[\s\S]*?(<\/div><script id="successor-source")/,(_,a,b)=>a+layouts[lang]+b);
    html=html.replace(/(<script id="successor-layouts" type="application\/json">)[\s\S]*?(<\/script>)/,(_,a,b)=>a+inert(layouts)+b);
    html=html.replace(/(<script id="successor-sources" type="application\/json">)[\s\S]*?(<\/script>)/,(_,a,b)=>a+inert(sources)+b);
    html=html.replace('<title>SUCCESSOR Ω ·','<title>SUCCESSOR Ω + Fleet ·');
    const style=html.match(/<style>([\s\S]*?)<\/style>/)[1],fleetStyle=style+'#fleet-version{width:100%;min-width:0;max-width:100%}#connect .two-col>div{min-width:0}#connect button{white-space:normal;max-width:100%}';
    html=html.replace('<style>'+style+'</style>','<style>'+fleetStyle+'</style>').replace("style-src 'sha256-"+hash(style,'base64')+"'","style-src 'sha256-"+hash(fleetStyle,'base64')+"'");
    pages[lang]=html;
  }
  return {pages,sourceManifest:built.sourceManifest,upstream,zip:sourceZip(sources)};
}
export function buildFleet(output){fs.mkdirSync(output,{recursive:true});const result=fleetArtifacts();for(const lang of ['en','fr'])fs.writeFileSync(path.join(output,'My-SUCCESSOR-Omega-'+lang+'.html'),result.pages[lang]);fs.writeFileSync(path.join(output,'SUCCESSOR-Omega-Fleet-source.zip'),result.zip);return result;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--out')throw Error('Usage: node build.mjs --out NEW_DIRECTORY');buildFleet(path.resolve(args[1]));}
