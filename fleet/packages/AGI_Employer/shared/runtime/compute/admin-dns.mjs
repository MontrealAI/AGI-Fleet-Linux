import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {NETWORK_COMMANDS,networkRun,networkInventory,inspectNetwork,publicDiagnosticHostname} from './network-preflight.mjs';

const ensure=(ok,code)=>{if(!ok)throw Error(code);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const validateServers=x=>ensure(Array.isArray(x)&&x.length>0&&x.length<=3&&x.every(y=>typeof y==='string'&&net.isIP(y))&&new Set(x).size===x.length,'DNS_SERVERS_INVALID');
const validateDNS=x=>{ensure(x&&['automatic','manual'].includes(x.mode)&&Array.isArray(x.servers),'DNS_PLAN_INVALID');if(x.mode==='automatic')ensure(x.servers.length===0,'DNS_PLAN_INVALID');else ensure(x.servers.length>0&&x.servers.length<=16&&x.servers.every(y=>typeof y==='string'&&net.isIP(y)),'DNS_PLAN_INVALID');};
const checkPolicy=x=>{ensure(x?.managementKnown===true&&x.mdmEnrolled===false,'MANAGED_NETWORK_ADMINISTRATOR_REQUIRED');ensure(x.splitDNS===false,'SPLIT_DNS_ADMINISTRATOR_REQUIRED');};
export async function administratorIdentity({run=networkRun,uid=process.getuid?.(),env=process.env,privileged=false,platform=process.platform}={}){
  ensure(platform==='darwin','MACOS_REQUIRED');
  let administratorUID=uid,administratorName=null;
  if(privileged){
    ensure(uid===0&&/^\d+$/.test(env.SUDO_UID??'')&&Number(env.SUDO_UID)>0&&/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(env.SUDO_USER??''),'SEPARATE_ADMINISTRATOR_REQUIRED');
    administratorUID=Number(env.SUDO_UID);administratorName=env.SUDO_USER;
    const id=await run(NETWORK_COMMANDS.id,['-u',administratorName]);ensure(id.code===0&&Number(id.stdout.trim())===administratorUID,'ADMINISTRATOR_IDENTITY_MISMATCH');
  }else{ensure(Number.isSafeInteger(uid)&&uid>0,'SEPARATE_ADMINISTRATOR_REQUIRED');}
  const groups=await run(NETWORK_COMMANDS.id,['-Gn',...(administratorName?[administratorName]:[])]);
  ensure(groups.code===0&&groups.stdout.trim().split(/\s+/).includes('admin'),'SEPARATE_ADMINISTRATOR_REQUIRED');
  return {administratorUID,administratorName,privileged};
}
export function createDNSPlan({inventory,servers,hostname='example.com',administratorUID,now=Date.now()}){
  validateServers(servers);hostname=publicDiagnosticHostname(hostname);checkPolicy(inventory);
  ensure(Number.isSafeInteger(administratorUID)&&administratorUID>0,'SEPARATE_ADMINISTRATOR_REQUIRED');
  const plan={schema:'agi-admin-dns-plan/v1',id:crypto.randomUUID(),createdAt:new Date(now).toISOString(),expiresAt:new Date(now+24*60*60*1000).toISOString(),administratorUID,hostname,service:inventory.service,before:inventory.configuredDNS,after:{mode:'manual',servers:[...servers]},effectiveDNSAtReview:inventory.effectiveDNS??[],notice:'A separate administrator must approve this service and these resolver addresses under local network policy. Automatic means DHCP/system policy; it does not mean DNS is absent. This changes macOS DNS only, not OpenClaw or browser network security.'};
  validateDNSPlan(plan,{now});return plan;
}
export function validateDNSPlan(plan,{now=Date.now(),allowExpired=false}={}){
  ensure(plan?.schema==='agi-admin-dns-plan/v1'&&uuid(plan.id),'DNS_PLAN_INVALID');
  ensure(Number.isSafeInteger(plan.administratorUID)&&plan.administratorUID>0,'DNS_PLAN_INVALID');
  const s=plan.service;ensure(s&&uuid(s.id)&&typeof s.name==='string'&&s.name.length>0&&s.name.length<=128&&!/[\r\n\0]/.test(s.name)&&/^(en|bridge|bond)[a-z0-9]{0,12}$/.test(s.interface),'DNS_PLAN_SERVICE_INVALID');
  publicDiagnosticHostname(plan.hostname);validateDNS(plan.before);validateDNS(plan.after);ensure(plan.after.mode==='manual','DNS_PLAN_INVALID');validateServers(plan.after.servers);
  const start=Date.parse(plan.createdAt),end=Date.parse(plan.expiresAt);ensure(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=86400000&&start<=now+60000,'DNS_PLAN_INVALID');
  ensure(allowExpired||now<=end,'DNS_PLAN_EXPIRED');return plan;
}
export function validateAdminPath(file,{administratorUID,exists=true,directory=false,lstat=fs.lstatSync}={}){
  file=path.resolve(file);let cursor=exists?file:path.dirname(file);
  while(true){const stat=lstat(cursor);ensure(!stat.isSymbolicLink(),'ADMIN_PATH_SYMLINK');ensure([0,administratorUID].includes(stat.uid),'ADMIN_PATH_OWNER');ensure(!(stat.mode&0o022),'ADMIN_PATH_WRITABLE');if(cursor===path.dirname(cursor))break;cursor=path.dirname(cursor);}
  if(exists){const s=lstat(file);ensure(directory?s.isDirectory():s.isFile(),'ADMIN_PATH_TYPE');ensure(!(s.mode&0o077),'ADMIN_PATH_NOT_PRIVATE');}
  return file;
}
function readPrivate(file,administratorUID){validateAdminPath(file,{administratorUID});const stat=fs.statSync(file);ensure(stat.size<=32768,'DNS_PLAN_TOO_LARGE');return JSON.parse(fs.readFileSync(file,'utf8'));}
function writePrivate(file,data,administratorUID){
  validateAdminPath(path.dirname(file),{administratorUID,directory:true});
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify(data,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function replacePrivate(file,data,administratorUID){
  validateAdminPath(file,{administratorUID});const temp=file+'.'+crypto.randomUUID()+'.tmp';writePrivate(temp,data,administratorUID);fs.renameSync(temp,file);
}
const setDNS=async(run,service,dns)=>{const r=await run(NETWORK_COMMANDS.networksetup,['-setdnsservers',service.name,...(dns.mode==='automatic'?['Empty']:dns.servers)]);ensure(r.code===0&&!r.error,'DNS_WRITE_FAILED');};
const assertSameService=(a,b)=>ensure(a.id===b.id&&a.name===b.name&&a.interface===b.interface,'ACTIVE_NETWORK_SERVICE_CHANGED');
// The injected adapters make failure and rollback behavior testable without changing a Mac.
export async function applyDNSPlan({plan,confirmation,policyReviewed=false,identity,run=networkRun,inventory=networkInventory,persist,verify=inspectNetwork,now=Date.now()}){
  identity??=await administratorIdentity({run,privileged:true});ensure(identity.privileged===true,'SEPARATE_ADMINISTRATOR_REQUIRED');
  validateDNSPlan(plan,{now});ensure(identity.administratorUID===plan.administratorUID,'ADMINISTRATOR_IDENTITY_MISMATCH');ensure(confirmation===plan.id&&policyReviewed===true,'DNS_PLAN_CONFIRMATION_REQUIRED');ensure(typeof persist==='function','DURABLE_ROLLBACK_RECEIPT_REQUIRED');
  const current=await inventory({run});checkPolicy(current);assertSameService(current.service,plan.service);ensure(same(current.configuredDNS,plan.before),'DNS_SETTINGS_CHANGED_SINCE_REVIEW');
  // An interrupted APPLYING receipt cannot establish whether networksetup ran.
  const receipt={schema:'agi-admin-dns-receipt/v1',plan,at:new Date(now).toISOString(),state:'APPLYING',dnsWriteAttempted:null,checks:[]};
  await persist(receipt); // Must exist before the first system mutation.
  let writeAttempted=false;
  try{
    const beforeWrite=await inventory({run});checkPolicy(beforeWrite);assertSameService(beforeWrite.service,plan.service);ensure(same(beforeWrite.configuredDNS,plan.before),'DNS_SETTINGS_CHANGED_SINCE_REVIEW');
    writeAttempted=true;receipt.dnsWriteAttempted=true;
    await setDNS(run,plan.service,plan.after);
    const updated=await inventory({run});checkPolicy(updated);assertSameService(updated.service,plan.service);ensure(same(updated.configuredDNS,plan.after),'DNS_WRITE_VERIFICATION_FAILED');
    const report=await verify({hostname:plan.hostname,run});receipt.checks=report.checks??[];ensure(report.status==='PASS','DNS_RESOLUTION_STILL_BLOCKED');
    const verified=await inventory({run});checkPolicy(verified);assertSameService(verified.service,plan.service);ensure(same(verified.configuredDNS,plan.after),'DNS_WRITE_VERIFICATION_FAILED');
    receipt.state='APPLIED';receipt.conclusion='macOS DNS and native lookup verified for this hostname. Gateway, Docker and browser qualification remain separate.';await persist(receipt);return receipt;
  }catch(error){
    receipt.failure=error.message;receipt.dnsWriteAttempted=writeAttempted;
    if(!writeAttempted){receipt.state='BLOCKED';receipt.conclusion='Network policy or settings changed before apply. No DNS write was attempted. Prepare a new plan after separate administrator review.';await persist(receipt);return receipt;}
    try{const latest=await inventory({run});assertSameService(latest.service,plan.service);ensure(same(latest.configuredDNS,plan.before)||same(latest.configuredDNS,plan.after),'DNS_SETTINGS_CHANGED_DURING_REPAIR');if(!same(latest.configuredDNS,plan.before)){checkPolicy(latest);await setDNS(run,plan.service,plan.before);}const restored=await inventory({run});assertSameService(restored.service,plan.service);ensure(same(restored.configuredDNS,plan.before),'DNS_ROLLBACK_VERIFICATION_FAILED');receipt.state='ROLLED_BACK';}
    catch(rollback){receipt.state='ROLLBACK_FAILED';receipt.rollbackFailure=rollback.message;}
    await persist(receipt);return receipt;
  }
}
export async function rollbackDNSReceipt({receipt,confirmation,identity,run=networkRun,inventory=networkInventory,persist,now=Date.now()}){
  identity??=await administratorIdentity({run,privileged:true});ensure(identity.privileged===true,'SEPARATE_ADMINISTRATOR_REQUIRED');
  ensure(receipt?.schema==='agi-admin-dns-receipt/v1','DNS_RECEIPT_INVALID');const plan=validateDNSPlan(receipt.plan,{now,allowExpired:true});ensure(identity.administratorUID===plan.administratorUID,'ADMINISTRATOR_IDENTITY_MISMATCH');ensure(confirmation===plan.id,'DNS_PLAN_CONFIRMATION_REQUIRED');ensure(typeof persist==='function','DURABLE_ROLLBACK_RECEIPT_REQUIRED');
  const current=await inventory({run});assertSameService(current.service,plan.service);
  if(same(current.configuredDNS,plan.before)){receipt.state='ROLLED_BACK';await persist(receipt);return receipt;}
  ensure(same(current.configuredDNS,plan.after),'DNS_SETTINGS_CHANGED_AFTER_REPAIR');
  checkPolicy(current);
  receipt.state='ROLLING_BACK';receipt.rollbackWriteAttempted=null;await persist(receipt);
  try{
    const beforeWrite=await inventory({run});assertSameService(beforeWrite.service,plan.service);
    if(same(beforeWrite.configuredDNS,plan.before)){receipt.state='ROLLED_BACK';receipt.rollbackWriteAttempted=false;await persist(receipt);return receipt;}
    checkPolicy(beforeWrite);ensure(same(beforeWrite.configuredDNS,plan.after),'DNS_SETTINGS_CHANGED_AFTER_REPAIR');
  }catch(error){receipt.state='BLOCKED';receipt.rollbackWriteAttempted=false;receipt.rollbackFailure=error.message;await persist(receipt);throw error;}
  receipt.rollbackWriteAttempted=true;await setDNS(run,plan.service,plan.before);
  const restored=await inventory({run});assertSameService(restored.service,plan.service);ensure(same(restored.configuredDNS,plan.before),'DNS_ROLLBACK_VERIFICATION_FAILED');receipt.state='ROLLED_BACK';await persist(receipt);return receipt;
}
function argvOptions(args){const result={};for(let i=0;i<args.length;i++){const key=args[i];ensure(['--hostname','--servers','--directory','--plan','--receipt','--confirm','--policy-reviewed'].includes(key)&&!Object.hasOwn(result,key),'ARGUMENT_INVALID');if(key==='--policy-reviewed')result[key]=true;else{ensure(args[i+1]&&!args[i+1].startsWith('--'),'ARGUMENT_VALUE_REQUIRED');result[key]=args[++i];}}return result;}
export async function adminDNSMain(args=process.argv.slice(2)){
  const [action,...rest]=args,options=argvOptions(rest);
  if(action==='inspect')return inspectNetwork({hostname:options['--hostname']??'example.com'});
  ensure(['prepare','apply','rollback'].includes(action),'Use inspect, prepare, apply, or rollback. No command elevates the compute account.');
  const identity=await administratorIdentity({privileged:action!=='prepare'});
  if(action==='prepare'){
    ensure(options['--servers']&&options['--directory'],'EXPLICIT_RESOLVERS_AND_PRIVATE_DIRECTORY_REQUIRED');const directory=path.resolve(options['--directory']);validateAdminPath(directory,{administratorUID:identity.administratorUID,directory:true});
    const plan=createDNSPlan({inventory:await networkInventory(),servers:options['--servers'].split(','),hostname:options['--hostname']??'example.com',administratorUID:identity.administratorUID});const file=path.join(directory,'dns-plan-'+plan.id+'.json');writePrivate(file,plan,identity.administratorUID);return {status:'AWAITING_ADMINISTRATOR_REVIEW',planFile:file,plan,approval:'Read the plan, then run apply separately with --plan, --confirm matching the plan ID, and --policy-reviewed. Use a verified administrator-owned release and Node executable. Never grant the compute account sudo.'};
  }
  // Refuse a mistakenly privileged run from compute-owned or shared writable code.
  for(const file of [fileURLToPath(import.meta.url),fileURLToPath(new URL('./network-preflight.mjs',import.meta.url)),fs.realpathSync(process.execPath)]){
    let cursor=path.resolve(file);while(true){const stat=fs.lstatSync(cursor);ensure(!stat.isSymbolicLink()&&[0,identity.administratorUID].includes(stat.uid)&&!(stat.mode&0o022),'ADMINISTRATOR_OWNED_RELEASE_REQUIRED');if(cursor===path.dirname(cursor))break;cursor=path.dirname(cursor);}
  }
  if(action==='apply'){
    ensure(options['--plan'],'DNS_PLAN_REQUIRED');const file=path.resolve(options['--plan']),plan=readPrivate(file,identity.administratorUID),receiptFile=file.replace(/\.json$/,'')+'.receipt.json';let created=false;
    const receipt=await applyDNSPlan({plan,confirmation:options['--confirm'],policyReviewed:options['--policy-reviewed'],identity,persist:async x=>{if(created)replacePrivate(receiptFile,x,identity.administratorUID);else{writePrivate(receiptFile,x,identity.administratorUID);created=true;}}});return {...receipt,receiptFile,status:receipt.state==='APPLIED'?'PASS':'FAIL'};
  }
  ensure(options['--receipt'],'DNS_RECEIPT_REQUIRED');const file=path.resolve(options['--receipt']);const receipt=await rollbackDNSReceipt({receipt:readPrivate(file,identity.administratorUID),confirmation:options['--confirm'],identity,persist:async x=>replacePrivate(file,x,identity.administratorUID)});return {...receipt,status:'PASS'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))adminDNSMain().then(x=>{process.stdout.write(JSON.stringify(x,null,2)+'\n');if(['BLOCKED','FAIL','ROLLED_BACK','ROLLBACK_FAILED'].includes(x.status??x.state))process.exitCode=1;}).catch(error=>{process.stderr.write(JSON.stringify({status:'BLOCKED',code:error.message,notice:'No automatic privilege escalation. Use the separate Mac administrator and approved network policy.'})+'\n');process.exitCode=1;});
