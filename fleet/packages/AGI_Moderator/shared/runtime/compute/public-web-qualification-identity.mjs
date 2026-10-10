import {consumerRoot,consumerCompute,consumerFile} from './consumer.mjs';
import {assertLinuxHost,assertRootlessInfo} from './linux-host.mjs';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,sha256,ensure} from '../src/util.mjs';
import {executionSettings} from './policy.mjs';
import {runtimeEnvironment} from './runtime-env.mjs';
import {publicBrowserPluginDigest} from './public-browser-config.mjs';
import {SKILLS,WORKSTATION_SKILLS} from './profile.mjs';
const ROOT=path.resolve(consumerCompute,'..');
export const QUALIFICATION_POLICY_METADATA=Object.freeze(['qualificationEvidenceSha256','qualificationReceiptSha256','qualificationReceiptFile','qualificationImportedAt','qualificationCandidatePolicyHash']);
function read(file,max=8*1024*1024){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const st=fs.fstatSync(fd);ensure(st.isFile()&&st.size<=max,'PUBLIC_WEB_QUALIFICATION_IDENTITY_FILE');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}}
export function publicWebQualificationSources(root=ROOT){
 const files=[];function visit(dir){const st=fs.lstatSync(dir);ensure(st.isDirectory()&&!st.isSymbolicLink(),'PUBLIC_WEB_QUALIFICATION_SOURCE');for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),s=fs.lstatSync(file);ensure(!s.isSymbolicLink(),'PUBLIC_WEB_QUALIFICATION_SOURCE');if(s.isDirectory())visit(file);else if(s.isFile()&&(/\.(?:mjs|cjs|py|sh|json)$/.test(name)||name==='Dockerfile'))files.push(file);}}
 visit(path.join(root,'compute'));
 for(const name of ['package.json','package-lock.json','src/util.mjs','src/review.mjs','src/work.mjs','src/artifacts.mjs','src/public-web-admission.mjs','src/admission-core/economics/computer-work.cjs','src/admission-core/economics/execution-window.cjs'])files.push(path.join(root,name));
 ensure(files.length>20&&files.length<256,'PUBLIC_WEB_QUALIFICATION_SOURCE_LIMIT');
 return Object.fromEntries([...new Set(files)].sort().map(file=>[path.relative(root,file).split(path.sep).join('/'),sha256(read(file))]));
}
export function publicWebMachineIdentity(c,{run=spawnSync,platform=process.platform,arch=process.arch,release=os.release(),env}={}){
 if(platform==='linux'){ensure(c.deploymentPlatform==='linux'&&['x64','arm64'].includes(arch),'PUBLIC_WEB_QUALIFICATION_LINUX_REQUIRED');assertLinuxHost(c);const machine=read('/etc/machine-id',128).toString().trim();ensure(/^[a-f0-9]{32}$/.test(machine),'PUBLIC_WEB_QUALIFICATION_MACHINE_UNAVAILABLE');const r=run(c.docker,['info','--format','{{json .}}'],{env,encoding:'utf8',timeout:5000,maxBuffer:262144,shell:false});ensure(r.status===0&&!r.error&&!r.signal,'PUBLIC_WEB_QUALIFICATION_MACHINE_UNAVAILABLE');const d=JSON.parse(r.stdout);assertRootlessInfo(d);ensure(typeof d.ID==='string'&&d.ID.length>0&&typeof d.KernelVersion==='string','PUBLIC_WEB_QUALIFICATION_MACHINE_UNAVAILABLE');return {platform,arch,hostSHA256:sha256(machine),osRelease:release,osBuild:'Ubuntu-24.04',engineIDSHA256:sha256(d.ID),engineVersion:d.ServerVersion,engineKernel:d.KernelVersion,engineArch:d.Architecture};}
 ensure(platform==='darwin'&&arch==='arm64','PUBLIC_WEB_QUALIFICATION_PHYSICAL_MAC_REQUIRED');
 const command=(exe,args)=>{const r=run(exe,args,{encoding:'utf8',timeout:5000,maxBuffer:262144,env,shell:false});ensure(r.status===0&&!r.error&&!r.signal&&Buffer.byteLength(r.stdout??'')<=262144,'PUBLIC_WEB_QUALIFICATION_MACHINE_UNAVAILABLE');return String(r.stdout).trim();};
 const hardware=command('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice']),match=/"IOPlatformUUID"\s*=\s*"([A-Fa-f0-9-]{36})"/.exec(hardware);
 ensure(match&&/^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$/.test(match[1]),'PUBLIC_WEB_QUALIFICATION_MACHINE_UNAVAILABLE');
 const build=command('/usr/bin/sw_vers',['-buildVersion']);ensure(/^[A-Za-z0-9.]{4,40}$/.test(build)&&typeof release==='string'&&release.length<100,'PUBLIC_WEB_QUALIFICATION_MACHINE_UNAVAILABLE');
 const engine=JSON.parse(command(c.docker,['info','--format','{{json .}}']));
 ensure(typeof engine.ID==='string'&&engine.ID.length>0&&engine.ID.length<256&&/^29\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(engine.ServerVersion??'')&&engine.OSType==='linux'&&['aarch64','arm64'].includes(engine.Architecture)&&typeof engine.KernelVersion==='string','PUBLIC_WEB_QUALIFICATION_MACHINE_UNAVAILABLE');
 return {platform,arch,hostSHA256:sha256(match[1].toLowerCase()),osRelease:release,osBuild:build,engineIDSHA256:sha256(engine.ID),engineVersion:engine.ServerVersion,engineKernel:engine.KernelVersion,engineArch:engine.Architecture};
}
// Receipt metadata and the single reviewed mode transition do not affect this
// identity. Every executable setting, credential hash, source byte, installed
// plugin, config, bootstrap, skill and wrapper still does. No raw credential or
// local account path is exported.
export function publicWebQualificationIdentity(c,{root=ROOT,checkRuntime=runtimeEnvironment,machineIdentity=publicWebMachineIdentity}={}){
 const env=checkRuntime(c),machine=machineIdentity(c,{env});const settings=structuredClone(executionSettings(c)),policy=settings.publicWebPolicy;
 ensure(policy?.enabled===true&&['commissioning','qualified'].includes(policy.mode)&&typeof policy.reviewerPublicKey==='string','PUBLIC_WEB_QUALIFICATION_REVIEWER_REQUIRED');
 policy.mode='commissioning';for(const key of QUALIFICATION_POLICY_METADATA)delete policy[key];
 const sourceHashes=publicWebQualificationSources(root),manifest={schema:'agi-public-web-execution-identity/v1',machine,settingsSHA256:sha256(canonical(settings)),sourceHashes,gatewayConfigSHA256:sha256(read(c.gatewayConfig)),pluginSHA256:publicBrowserPluginDigest(c.publicWebPolicy.pluginDirectory),bootstrapSHA256:sha256(read(path.join(c.workspace,'AGENTS.md'))),skills:Object.fromEntries((c.workstation?WORKSTATION_SKILLS:SKILLS).map(name=>[name,sha256(read(path.join(c.workspace,'skills',name,'SKILL.md')))])),wrapperSHA256:c.gatewayWrapper?sha256(read(c.gatewayWrapper,1048576)):null};
 return {...(machine.platform==='linux'?{platform:machine.platform,arch:machine.arch}:{}),executionFingerprint:sha256(canonical(manifest)),sourceHashes,candidatePolicyHash:c.publicWebPolicy.qualificationCandidatePolicyHash??c.policyHash,operatorPublicKey:c.publicWebPolicy.operatorPublicKey,reviewerPublicKey:c.publicWebPolicy.reviewerPublicKey,browserImageID:c.publicWebPolicy.browserImageID,proxyImageID:c.publicWebPolicy.proxyImageID};
}

// New measurements bind the policy currently executing them. Installed receipt
// verification keeps the saved pre-import policy hash across the reviewed seal.
export function publicWebQualificationCandidateIdentity(c,{identity=publicWebQualificationIdentity}={}){
 ensure(['commissioning','qualified'].includes(c.publicWebPolicy?.mode)&&/^[a-f0-9]{64}$/.test(c.policyHash??''),'PUBLIC_WEB_QUALIFICATION_COMMISSIONING_REQUIRED');
 return {...identity(c),candidatePolicyHash:c.policyHash};
}
