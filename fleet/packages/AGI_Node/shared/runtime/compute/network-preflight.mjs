import {spawn} from 'node:child_process';
import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';

export const NETWORK_COMMANDS={scutil:'/usr/sbin/scutil',networksetup:'/usr/sbin/networksetup',route:'/sbin/route',profiles:'/usr/bin/profiles',dscacheutil:'/usr/bin/dscacheutil',dig:'/usr/bin/dig',id:'/usr/bin/id'};
const ensure=(ok,code)=>{if(!ok)throw Error(code);};
export function networkRun(file,args=[],{input='',timeoutMs=6000,maxBytes=128*1024}={}){
  return new Promise(resolve=>{
    let done=false,stdout='',stderr='',bytes=0,child;
    const finish=(code,error=null)=>{if(done)return;done=true;clearTimeout(timer);resolve({code,stdout,stderr,error});};
    const timer=setTimeout(()=>{child?.kill('SIGKILL');finish(null,'TIMEOUT');},timeoutMs);
    try{child=spawn(file,args,{shell:false,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C',LC_ALL:'C'},stdio:['pipe','pipe','pipe']});}
    catch{finish(null,'COMMAND_UNAVAILABLE');return;}
    const collect=(key,data)=>{bytes+=data.length;if(bytes>maxBytes){child.kill('SIGKILL');finish(null,'OUTPUT_LIMIT');return;}if(key==='out')stdout+=data;else stderr+=data;};
    child.stdout.on('data',x=>collect('out',x));child.stderr.on('data',x=>collect('err',x));
    child.on('error',e=>finish(null,e.code??'COMMAND_FAILED'));child.on('close',code=>finish(code));
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
export function publicDiagnosticHostname(value='example.com'){
  ensure(typeof value==='string'&&value.length<=253,'DNS_HOSTNAME_INVALID');
  const name=value.toLowerCase();
  ensure(name===value.trim()&&!net.isIP(name)&&name.includes('.')&&name.split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x))&&!/(^|\.)(localhost|local|internal|home|test|invalid)$/.test(name),'DNS_HOSTNAME_INVALID');
  return name;
}
export function parseConfiguredDNS(text){
  const s=text.trim();
  if(/^There aren't any DNS Servers set on .+\.$/.test(s))return {mode:'automatic',servers:[]};
  const servers=s.split(/\r?\n/).map(x=>x.trim());
  ensure(servers.length>0&&servers.length<=16&&servers.every(x=>net.isIP(x)),'DNS_CONFIG_UNREADABLE');
  return {mode:'manual',servers};
}
export function parsePrimaryService(text){
  const service=text.match(/^\s*PrimaryService\s*:\s*([A-Fa-f0-9-]{36})\s*$/m)?.[1];
  const device=text.match(/^\s*PrimaryInterface\s*:\s*([a-z][a-z0-9]{0,15})\s*$/m)?.[1];
  return service&&device?{id:service,interface:device}:null;
}
export function parseServiceOrder(text){
  const rows=[];let current=null;
  for(const line of text.split(/\r?\n/)){
    const name=line.match(/^\((\d+|\*)\) (.+)$/);if(name){current={name:name[2],disabled:name[1]==='*'};continue;}
    const device=line.match(/Device: ([a-z][a-z0-9]{0,15})\)/);if(current&&device){rows.push({...current,interface:device[1]});current=null;}
  }return rows;
}
export function parseEffectiveDNS(text){
  return [...new Set([...text.matchAll(/nameserver\[\d+\]\s*:\s*(\S+)/g)].map(x=>x[1]).filter(x=>net.isIP(x)))];
}
const multicastDomains=new Set(['local','254.169.in-addr.arpa','8.e.f.ip6.arpa','9.e.f.ip6.arpa','a.e.f.ip6.arpa','b.e.f.ip6.arpa']);
const dnsDomain=value=>typeof value==='string'&&value.length<=254&&value.replace(/\.$/,'').split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(x));
// scutil emits independent ordinary, scoped and service-specific resolver blocks.
// Only Apple's standard multicast blocks are exempt; unknown policy stays review-required.
export function resolverPolicyRequiresReview(text,{primaryInterface}={}){
  if(typeof text!=='string'||!text.trim()||text.length>128*1024||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))return true;
  const blocks=[],seen=new Set(),sections=new Set();let section='ordinary',current=null;
  for(const line of text.split(/\r?\n/)){
    const value=line.trim();if(!value)continue;
    if(value.startsWith('DNS configuration')){
      const next={'DNS configuration':'ordinary','DNS configuration (for scoped queries)':'scoped','DNS configuration (for service-specific queries)':'service'}[value];
      if(!next||next==='service'||sections.has(next)||(next==='ordinary'&&blocks.length))return true;
      sections.add(next);section=next;current=null;continue;
    }
    const header=value.match(/^resolver #([1-9]\d*)$/);
    if(header){const key=section+':'+header[1];if(seen.has(key)||blocks.length>=128||Number(header[1])!==blocks.filter(x=>x.section===section).length+1)return true;seen.add(key);current={section,fields:new Map()};blocks.push(current);continue;}
    const field=value.match(/^([a-z_]+(?: domain)?(?:\[\d+\])?)\s*:\s*(.*)$/);
    if(!current||!field||current.fields.has(field[1]))return true;
    current.fields.set(field[1],field[2]);
  }
  if(!blocks.length||[...sections].some(x=>!blocks.some(b=>b.section===x)))return true;
  const primary=[],scoped=[];
  for(const block of blocks){
    const f=block.fields,servers=[],search=[];
    if(!f.size)return true;
    for(const [key,value] of f){
      if(/^nameserver\[\d+\]$/.test(key)){if(key!==`nameserver[${servers.length}]`||!net.isIP(value))return true;servers.push(value);}
      else if(/^search domain\[\d+\]$/.test(key)){if(key!==`search domain[${search.length}]`||!dnsDomain(value))return true;search.push(value.toLowerCase().replace(/\.$/,''));}
      else if(key==='domain'){if(!dnsDomain(value))return true;}
      else if(['timeout','order'].includes(key)){if(!/^\d{1,10}$/.test(value))return true;}
      else if(key==='reach'){if(!/^0x[\da-f]{8}(?: \([^\r\n]*\))?$/i.test(value))return true;}
      else if(!['flags','options','if_index','port'].includes(key))return true;
    }
    const flagText=f.get('flags')??'',flags=flagText?flagText.split(',').map(x=>x.trim()):[];
    if(flags.some(x=>!['Request A records','Request AAAA records','Scoped'].includes(x))||new Set(flags).size!==flags.length)return true;
    const isScoped=block.section==='scoped';if(flags.includes('Scoped')!==isScoped)return true;
    const iface=f.has('if_index')?f.get('if_index').match(/^[1-9]\d* \(([a-z][a-z0-9]{0,15})\)$/)?.[1]:null;
    if(f.has('if_index')&&(!iface||!primaryInterface||iface!==primaryInterface))return true;
    if(f.get('options')==='mdns'){
      const domain=(f.get('domain')??'').toLowerCase().replace(/\.$/,'');
      if(!multicastDomains.has(domain)||block===blocks[0]||isScoped||servers.length||search.length||f.has('if_index')||f.has('port'))return true;
      continue;
    }
    if(f.has('options')||f.has('domain')||!servers.length||(f.has('port')&&f.get('port')!=='53'))return true;
    const route={servers,search,port:f.get('port')??'53'};
    if(isScoped){if(!iface) return true;scoped.push(route);}else primary.push(route);
  }
  // A scoped copy of the primary interface is normal; competing or unidentified routes are not.
  return primary.length!==1||scoped.some(x=>JSON.stringify(x)!==JSON.stringify(primary[0]));
}
export async function networkInventory({run=networkRun,platform=process.platform}={}){
  ensure(platform==='darwin','MACOS_REQUIRED');
  const C=NETWORK_COMMANDS;
  const ask=async(file,args,input)=>{const r=await run(file,args,{input});ensure(r.code===0&&!r.error,'NETWORK_INVENTORY_UNAVAILABLE');return r.stdout;};
  const [ipv4,ipv6,order,effective,route,managed]=await Promise.all([
    ask(C.scutil,[], 'show State:/Network/Global/IPv4\n'),ask(C.scutil,[],'show State:/Network/Global/IPv6\n'),
    ask(C.networksetup,['-listnetworkserviceorder']),ask(C.scutil,['--dns']),run(C.route,['-n','get','default']),run(C.profiles,['status','-type','enrollment']),
  ]);
  const a=parsePrimaryService(ipv4),b=parsePrimaryService(ipv6),active=a??b;
  ensure(active,'ACTIVE_NETWORK_SERVICE_NOT_FOUND');
  ensure(!a||!b||(a.id===b.id&&a.interface===b.interface),'MULTIPLE_ACTIVE_NETWORK_SERVICES');
  ensure(!/^(utun|ppp|ipsec)/.test(active.interface),'MANAGED_OR_VPN_NETWORK_REVIEW_REQUIRED');
  const setup=await ask(C.scutil,[],`show Setup:/Network/Service/${active.id}\n`);
  const name=setup.match(/^\s*UserDefinedName\s*:\s*(.+?)\s*$/m)?.[1];
  ensure(name&&name.length<=128&&!/[\r\n\0]/.test(name),'ACTIVE_NETWORK_SERVICE_NOT_FOUND');
  const matches=parseServiceOrder(order).filter(x=>x.name===name&&!x.disabled&&x.interface===active.interface);
  ensure(matches.length===1,'ACTIVE_NETWORK_SERVICE_AMBIGUOUS');
  const routeDevice=route.code===0?route.stdout.match(/^\s*interface:\s*(\S+)/m)?.[1]:null;
  ensure(routeDevice===active.interface,'ACTIVE_ROUTE_INTERFACE_MISMATCH');
  const configured=parseConfiguredDNS(await ask(C.networksetup,['-getdnsservers',name]));
  const enrollmentLines=String(managed.stdout??'').split(/\r?\n/).map(x=>x.trim()).filter(x=>/^MDM enrollment\s*:/i.test(x));
  const enrollment=enrollmentLines.length===1?enrollmentLines[0].match(/^MDM enrollment:\s*(Yes(?: \(User Approved\))?|No)$/i):null;
  const managementKnown=managed.code===0&&!managed.error&&!!enrollment;
  const mdmEnrolled=managementKnown?/^Yes/i.test(enrollment[1]):null;
  return {schema:'agi-network-inventory/v1',service:{...active,name},configuredDNS:configured,effectiveDNS:parseEffectiveDNS(effective),mdmEnrolled,managementKnown,splitDNS:resolverPolicyRequiresReview(effective,{primaryInterface:active.interface}),routeInterface:routeDevice};
}
async function boundedLookup(hostname,lookup=dns.lookup){
  let timer;try{return await Promise.race([lookup(hostname,{all:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DNS_TIMEOUT')),5000);})]);}finally{clearTimeout(timer);}
}
export async function inspectNetwork({hostname='example.com',comparisonResolvers=[],run=networkRun,lookup=dns.lookup,platform=process.platform}={}){
  hostname=publicDiagnosticHostname(hostname);ensure(Array.isArray(comparisonResolvers)&&comparisonResolvers.length<=3&&comparisonResolvers.every(x=>net.isIP(x)),'DNS_RESOLVER_INVALID');
  const report={schema:'agi-network-preflight/v1',runID:crypto.randomUUID(),at:new Date().toISOString(),hostname,status:'NOT TESTED',scope:'Current account and configured resolver only; Gateway, Docker and browser checks are separate.',inventory:null,checks:[],administratorActionRequired:false};
  if(platform!=='darwin'){report.checks.push({id:'mac-network',status:'NOT TESTED',code:'MACOS_REQUIRED',remediation:'Run Inspect or Repair in the Standard compute account on the Mac.'});return report;}
  try{report.inventory=await networkInventory({run,platform});report.checks.push({id:'active-service',status:'PASS',service:report.inventory.service});}
  catch(e){report.status='BLOCKED';report.administratorActionRequired=true;report.checks.push({id:'active-service',status:'BLOCKED',code:e.message,remediation:'Ask the separate administrator to review the active network or VPN service. No settings were changed.'});return report;}
  let addresses=[];try{addresses=(await boundedLookup(hostname,lookup)).map(x=>x.address).filter(x=>net.isIP(x));}catch{}
  const native=await run(NETWORK_COMMANDS.dscacheutil,['-q','host','-a','name',hostname]);
  const nativeResolved=native.code===0&&/^\s*(?:ip_address|ipv6_address):\s*\S+/m.test(native.stdout);
  report.checks.push({id:'current-node-lookup',status:addresses.length?'PASS':'FAIL',addresses,remediation:addresses.length?null:'Name lookup failed in this account; inspect the configured resolver before changing settings.'});
  report.checks.push({id:'native-macos-lookup',status:nativeResolved?'PASS':'FAIL',remediation:nativeResolved?null:'Administrator must review resolver policy; automatic/DHCP DNS is not equivalent to no DNS.'});
  for(const resolver of [null,...comparisonResolvers]){
    const result=await run(NETWORK_COMMANDS.dig,['+time=2','+tries=1',...(resolver?['@'+resolver]:[]),hostname,'A']);
    const dnsStatus=result.stdout.match(/status:\s*([A-Z]+)/)?.[1]??'UNAVAILABLE';
    const answers=[...result.stdout.matchAll(/^\S+\s+\d+\s+IN\s+A\s+(\S+)\s*$/gm)].map(x=>x[1]).filter(x=>net.isIP(x)===4);
    report.checks.push({id:resolver?'explicit-resolver-comparison':'default-resolver-query',status:result.code===0&&dnsStatus==='NOERROR'&&answers.length?'PASS':'FAIL',resolver:resolver??'configured',dnsStatus,answers,code:result.error??null});
  }
  report.checks.push(...['gateway-process-resolution','browser-container-dns','actual-browser-navigation'].map(id=>({id,status:'NOT TESTED',remediation:'Run the attributed commissioning checks through the real services after an approved network repair.'})));
  report.status=addresses.length&&nativeResolved?'PASS':'BLOCKED';report.administratorActionRequired=report.status==='BLOCKED';
  report.conclusion=report.status==='PASS'?'Native lookup passed for this hostname only. This is not browser or job qualification.':'Resolver discrepancy or lookup failure requires a separate administrator decision. No DNS settings were changed.';
  return report;
}
