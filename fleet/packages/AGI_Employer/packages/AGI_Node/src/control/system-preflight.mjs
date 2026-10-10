import os from 'node:os';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const finite=v=>v===null||v===undefined?null:Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
const version=s=>String(s??'').replace(/^v(?=\d)/,'').match(/\b\d{1,4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?\b/)?.[0]??null;
const osVersion=s=>String(s??'').trim().match(/^\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/)?.[0]??null;
// A support export is constructed from known scalar facts. Raw commands, paths,
// config, environment, logs, tasks, auth stores and free-form errors never enter it.
export function sanitizeDiagnostics(value={}) {
  const facts=value.facts??value;
  const out={schema:'agi-sanitized-diagnostics/v1',createdAt:new Date().toISOString(),facts:{},limitations:['No wallet, vault, recovery words, credentials, task content or raw logs included.','Local measurements do not qualify real-Mac operation.']};
  for(const k of ['totalMemoryBytes','freeMemoryBytes','availableDiskBytes','dockerMemoryBytes','cpuCount','uid','swapUsedMiB','openclawRSSKiB','containerPeakBytes','browserPeakRSSKiB','officePeakRSSKiB','durationSeconds','exitCode','sleepMinutes','displaySleepMinutes'])if(facts[k]!==undefined)out.facts[k]=finite(facts[k]);
  for(const k of ['nodeVersion','npmVersion','openclawVersion','dockerEngineVersion','dockerDesktopVersion','osVersion'])if(facts[k]!==undefined)out.facts[k]=k==='osVersion'?osVersion(facts[k]):version(facts[k]);
  const enums={platform:['darwin','linux','win32'],architecture:['arm64','x64','ia32'],account:['root','admin','standard','unknown'],fileVault:['on','off','unknown'],docker:['ready','unavailable','starting','unknown'],memoryPressure:['normal','warning','critical','unknown'],status:['unverified','caution','blocked'],role:['agent','node','employer','moderator','recovery','evidence'],stage:['preflight','docker','images','desktop','profile','oauth','services'],failure:['NONE','DOCKER_UNAVAILABLE','BUILD_FAILED','DESKTOP_FAILED','OOM','SIGN_IN_INCOMPLETE','SERVICE_FAILED','PROFILE_CONFLICT','UNKNOWN']};
  for(const [k,values]of Object.entries(enums))if(values.includes(facts[k]))out.facts[k]=facts[k];
  for(const k of ['oomKilled','walletAccessed','paidProviderCall','productionFrameRuleUnchanged'])if(typeof facts[k]==='boolean')out.facts[k]=facts[k];
  return out;
}
export function collectPreflight({home=os.homedir(),run=(exe,args)=>spawnSync(exe,args,{encoding:'utf8',timeout:5000,maxBuffer:128*1024,env:{HOME:os.homedir(),PATH:process.env.PATH,LANG:'C'}})}={}) {
  const text=(exe,args)=>{try{const r=run(exe,args);return r.status===0?String(r.stdout??''):'';}catch{return '';}};
  const facts={platform:process.platform,architecture:process.arch,nodeVersion:process.version,cpuCount:os.cpus().length,totalMemoryBytes:os.totalmem(),freeMemoryBytes:os.freemem(),uid:process.getuid?.()??null,account:'unknown',fileVault:'unknown',memoryPressure:'unknown',docker:'unavailable',walletAccessed:false,paidProviderCall:false,productionFrameRuleUnchanged:true};
  facts.account=facts.uid===0?'root':'unknown';
  try{const s=fs.statfsSync(home);facts.availableDiskBytes=s.bavail*s.bsize;}catch{facts.availableDiskBytes=null;}
  facts.npmVersion=version(text('npm',['--version']));facts.openclawVersion=version(text('openclaw',['--version']));
  try{const d=JSON.parse(text('docker',['info','--format','{{json .}}']));facts.docker='ready';facts.dockerMemoryBytes=finite(d.MemTotal);facts.dockerEngineVersion=version(d.ServerVersion);}catch{}
  if(process.platform==='darwin'){
    facts.osVersion=osVersion(text('/usr/bin/sw_vers',['-productVersion']));
    const groups=text('/usr/bin/id',['-Gn']).trim().split(/\s+/);if(facts.uid>0&&groups.length&&groups[0])facts.account=groups.includes('admin')?'admin':'standard';
    const power=text('/usr/bin/pmset',['-g','custom']);for(const [key,label] of [['sleepMinutes','sleep'],['displaySleepMinutes','displaysleep']]){const m=power.match(new RegExp('^\\s*'+label+'\\s+(\\d+)','m'));facts[key]=m?Number(m[1]):null;}
    const fv=text('/usr/bin/fdesetup',['status']);facts.fileVault=/FileVault is On/.test(fv)?'on':/FileVault is Off/.test(fv)?'off':'unknown';
    const mp=text('/usr/sbin/sysctl',['-n','kern.memorystatus_vm_pressure_level']).trim();facts.memoryPressure=({'1':'normal','2':'warning','4':'critical'})[mp]??'unknown';
    const swap=text('/usr/sbin/sysctl',['-n','vm.swapusage']).match(/used\s*=\s*([\d.]+)M/);facts.swapUsedMiB=swap?Number(swap[1]):null;
    facts.dockerDesktopVersion=version(text('/usr/bin/defaults',['read','/Applications/Docker.app/Contents/Info','CFBundleShortVersionString']));
  }
  if(process.platform==='linux'&&facts.uid>0){const groups=text('/usr/bin/id',['-Gn']).trim().split(/\s+/);if(groups.length&&groups.every(g=>/^[a-zA-Z0-9_.-]+$/.test(g)))facts.account=groups.some(g=>['root','sudo','wheel','admin','docker','lxd','incus','incus-admin','disk','shadow','kmem'].includes(g))?'admin':'standard';}
  // Numeric RSS aggregate only: never expose command lines or user names.
  const ps=text('/bin/ps',['-axo','rss=,comm=']);facts.openclawRSSKiB=ps.split('\n').reduce((n,line)=>/openclaw/i.test(line)?n+Number(line.trim().split(/\s+/)[0]||0):n,0)||null;
  facts.status=(facts.uid===0||facts.availableDiskBytes!==null&&facts.availableDiskBytes<2*1024**3)?'blocked':'unverified';
  const report=sanitizeDiagnostics({facts});
  report.schema='agi-machine-preflight/v1';
  report.gates=[
    {id:'runtime',state:/^v24\./.test(process.version)&&Number(process.versions.node.split('.')[1])>=19?'passed':'blocked',detail:'Supported runtime: Node >=24.19.0 <25; preferred Node 24.21.0 LTS.'},
    {id:'compute-account',state:facts.account==='standard'?'measured':'unverified',detail:'A separate standard compute account is required. This report cannot prove wallet-file isolation.'},
    {id:'docker',state:facts.docker==='ready'?'measured':'blocked',detail:'Docker must remain running in the logged-in compute account.'},
    process.platform==='linux'?{id:'docker-engine-baseline',state:facts.dockerEngineVersion==='29.8.2'?'measured':'unverified',detail:'Linux compute requires rootless Docker 29.8.2, systemd and enforced cgroup v2 limits. Inspect.sh in the separate compute account verifies these independently.'}:{id:'docker-desktop-baseline',state:facts.dockerDesktopVersion==='4.93.0'?'measured':'unverified',detail:'Requested Apple Silicon qualification target: Docker Desktop 4.93.0. A version match does not establish operational qualification.'},
    {id:'openclaw',state:facts.openclawVersion==='2026.9.5'?'measured':'blocked',detail:'Pinned OpenClaw 2026.9.5; provider authentication is checked separately.'},
    {id:'memory',state:'unverified',detail:process.platform==='linux'?'Native Linux resource qualification remains pending. Workstation limit: 4 GiB per sandbox; gateway heap: 4 GiB. 16 GiB host RAM is recommended.':'8-GB M1 support is not yet qualified. Workstation limit: 4 GiB per sandbox; tools mode: 2 GiB. Docker VM memory is a separate measured value.'},
    process.platform==='linux'?{id:'linux-commissioning',state:'unverified',detail:'Native Ubuntu installation, desktop keyring, real OAuth/inference, document cleanup, reboot identity persistence and endurance require separate evidence. Follow Linux-Guide.html.'}:{id:'mac-commissioning',state:'unverified',detail:'Physical Mac, Safari, Screen Sharing, reboot and 50 consecutive workstation checks still require operator evidence.'}
  ];
  return report;
}
