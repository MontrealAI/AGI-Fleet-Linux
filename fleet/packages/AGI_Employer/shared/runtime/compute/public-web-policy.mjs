import crypto from 'node:crypto';
import net from 'node:net';
import {domainToASCII} from 'node:url';
const need=(ok,code)=>{if(!ok)throw Error(code);};
export const PUBLIC_WEB_MAX_TTL_MS=300000;
export const PUBLIC_WEB_PROXY_PORT=18080;
export function canonicalGrant(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonicalGrant).join(',')+']';return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalGrant(value[key])).join(',')+'}';}
export function grantDigest(payload){return crypto.createHash('sha256').update(canonicalGrant(payload)).digest('hex');}
function keys(object,allowed){need(object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).every(k=>allowed.includes(k)),'PUBLIC_WEB_GRANT_INVALID');}
export function normalizePublicHostname(input){
 need(typeof input==='string'&&input.length<=253&&!/[\s\\/%:@\[\]?#\x00-\x1f\x7f]/.test(input),'PUBLIC_WEB_HOST_INVALID');
 const host=domainToASCII(input).toLowerCase();need(host&&host.length<=253&&host===new URL('https://'+host).hostname&&!net.isIP(host),'PUBLIC_WEB_HOST_INVALID');
 const labels=host.split('.');need(labels.length>=2&&labels.every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))&&/[a-z]/.test(labels.at(-1)),'PUBLIC_WEB_HOST_INVALID');
 need(!['localhost','local','internal','home','lan','test','invalid','onion'].includes(labels.at(-1)),'PUBLIC_WEB_HOST_INVALID');return host;
}
function ipv4Number(value){return value.split('.').reduce((n,x)=>(n<<8n)|BigInt(Number(x)),0n);}
function ipv6Number(value){if(value.includes('.')||value.includes('%'))return null;const parts=value.toLowerCase().split('::');if(parts.length>2)return null;const left=parts[0]?parts[0].split(':'):[],right=parts.length===2&&parts[1]?parts[1].split(':'):[];const fill=8-left.length-right.length;if(fill<0||parts.length===1&&fill!==0)return null;const all=parts.length===1?left:[...left,...Array(fill).fill('0'),...right];return all.reduce((n,x)=>(n<<16n)|BigInt('0x'+(x||'0')),0n);}
const V4_DENY=[['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['168.63.129.16',32],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.31.196.0',24],['192.52.193.0',24],['192.88.99.0',24],['192.168.0.0',16],['192.175.48.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]].map(([n,prefix])=>[ipv4Number(n),BigInt(32-prefix)]);
const V6_DENY=[['2001::',23],['2001:db8::',32],['2002::',16],['2620:4f:8000::',48],['3fff::',20]].map(([n,prefix])=>[ipv6Number(n),BigInt(128-prefix)]);
export function publicIPAddress(address){
 const family=net.isIP(address);if(family===4){const value=ipv4Number(address);return !V4_DENY.some(([network,shift])=>value>>shift===network>>shift);}
 if(family===6){const value=ipv6Number(address);return value!==null&&value>>125n===1n&&!V6_DENY.some(([network,shift])=>value>>shift===network>>shift);}
 return false;
}
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
function privatePeer(address){if(net.isIP(address)!==4)return false;const n=ipv4Number(address);return [['10.0.0.0',8],['172.16.0.0',12],['192.168.0.0',16]].some(([base,bits])=>n>>BigInt(32-bits)===ipv4Number(base)>>BigInt(32-bits));}
export function validatePublicWebGrant(payload,{now=Date.now()}={}){
 const accepted=payload?.schema==='agi-public-web-grant/v2';
 keys(payload,['schema','taskHash','runtimePolicyHash','sessionID','browserContainerID','browserImageID','proxyImageID','browserIPv4','proxyIPv4','issuedAt','expiresAt','hosts','limits',...(accepted?['sourceSpecSha256','chainId','manager','jobID','role','runtimeSha256','purpose','interactions']:[])]);
 if(accepted){need(['accepted-job','commissioning'].includes(payload.purpose)&&/^[a-f0-9]{64}$/.test(payload.sourceSpecSha256)&&/^[a-f0-9]{64}$/.test(payload.runtimeSha256)&&Number.isSafeInteger(payload.chainId)&&payload.chainId>0&&/^0x[0-9a-f]{40}$/.test(payload.manager)&&!/^0x0{40}$/.test(payload.manager)&&typeof payload.jobID==='string'&&/^[1-9][0-9]{0,77}$/.test(payload.jobID)&&BigInt(payload.jobID)<2n**256n&&['agent','reviewer'].includes(payload.role),'PUBLIC_WEB_GRANT_INVALID');}
 if(accepted)need(Array.isArray(payload.interactions)&&payload.interactions.length>=1&&payload.interactions.length<=3&&payload.interactions.includes('inspect')&&new Set(payload.interactions).size===payload.interactions.length&&payload.interactions.every(action=>['inspect','navigate','form'].includes(action)),'PUBLIC_WEB_GRANT_INVALID');
 need(['agi-public-web-grant/v1','agi-public-web-grant/v2'].includes(payload.schema)&&/^[a-f0-9]{64}$/.test(payload.taskHash)&&/^[a-f0-9]{64}$/.test(payload.runtimePolicyHash)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(payload.sessionID)&&/^[a-f0-9]{64}$/.test(payload.browserContainerID),'PUBLIC_WEB_GRANT_INVALID');
 for(const key of ['browserImageID','proxyImageID'])need(/^sha256:[a-f0-9]{64}$/.test(payload[key]),'PUBLIC_WEB_GRANT_INVALID');
 need(privatePeer(payload.browserIPv4)&&privatePeer(payload.proxyIPv4)&&payload.browserIPv4!==payload.proxyIPv4,'PUBLIC_WEB_GRANT_INVALID');
 need(Number.isSafeInteger(payload.issuedAt)&&Number.isSafeInteger(payload.expiresAt)&&payload.issuedAt<=now&&payload.expiresAt>now&&payload.expiresAt>payload.issuedAt&&payload.expiresAt-payload.issuedAt<=PUBLIC_WEB_MAX_TTL_MS,'PUBLIC_WEB_GRANT_EXPIRED');
 need(Array.isArray(payload.hosts)&&payload.hosts.length>=1&&payload.hosts.length<=32,'PUBLIC_WEB_GRANT_INVALID');
 const seen=new Set();for(const scope of payload.hosts){keys(scope,['hostname','ports']);need(scope.hostname===normalizePublicHostname(scope.hostname)&&!seen.has(scope.hostname),'PUBLIC_WEB_GRANT_INVALID');seen.add(scope.hostname);need(Array.isArray(scope.ports)&&scope.ports.length>=1&&scope.ports.length<=2&&new Set(scope.ports).size===scope.ports.length&&scope.ports.every(port=>port===80||port===443),'PUBLIC_WEB_GRANT_INVALID');}
 keys(payload.limits,['maxRequests','maxConnections','maxBytes']);for(const [key,min,max]of [['maxRequests',1,256],['maxConnections',1,16],['maxBytes',1024,67108864]])need(Number.isSafeInteger(payload.limits[key])&&payload.limits[key]>=min&&payload.limits[key]<=max,'PUBLIC_WEB_GRANT_INVALID');
 return freeze(structuredClone(payload));
}
export function approvePublicWebGrant(payload,privateKey,{now=Date.now()}={}){
 validatePublicWebGrant(payload,{now});const key=crypto.createPrivateKey(privateKey);need(key.asymmetricKeyType==='ed25519','PUBLIC_WEB_AUTHORITY_INVALID');
 return {schema:'agi-public-web-approval/v1',payload:structuredClone(payload),signature:crypto.sign(null,Buffer.from(canonicalGrant(payload)),key).toString('base64')};
}
export function verifyPublicWebApproval(approval,authorityKey,{expectedGrantHash,now=Date.now()}={}){
 keys(approval,['schema','payload','signature']);need(approval.schema==='agi-public-web-approval/v1'&&typeof approval.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(approval.signature),'PUBLIC_WEB_APPROVAL_INVALID');
 const key=crypto.createPublicKey(authorityKey);need(key.asymmetricKeyType==='ed25519','PUBLIC_WEB_AUTHORITY_INVALID');need(crypto.verify(null,Buffer.from(canonicalGrant(approval.payload)),key,Buffer.from(approval.signature,'base64')),'PUBLIC_WEB_APPROVAL_INVALID');
 const payload=validatePublicWebGrant(approval.payload,{now});need(/^[a-f0-9]{64}$/.test(expectedGrantHash??'')&&grantDigest(payload)===expectedGrantHash,'PUBLIC_WEB_GRANT_IDENTITY');return payload;
}
export function authorizePublicWebTarget(grant,hostname,port,{now=Date.now()}={}){
 need(now>=grant.issuedAt&&now<grant.expiresAt,'PUBLIC_WEB_GRANT_EXPIRED');const host=normalizePublicHostname(hostname);need(grant.hosts.some(scope=>scope.hostname===host&&scope.ports.includes(port)),'PUBLIC_WEB_HOST_NOT_APPROVED');return host;
}
export async function resolvePublicWebTarget(grant,hostname,port,{lookup,now=Date.now(),signal}={}){
 const host=authorizePublicWebTarget(grant,hostname,port,{now});need(typeof lookup==='function','PUBLIC_WEB_RESOLVER_REQUIRED');
 const answers=await lookup(host,{all:true,verbatim:true,signal});need(Array.isArray(answers)&&answers.length>0&&answers.length<=64,'PUBLIC_WEB_DNS_INVALID');
 need(answers.every(a=>a&&publicIPAddress(a.address)&&net.isIP(a.address)===a.family),'PUBLIC_WEB_DNS_NOT_PUBLIC');
 const unique=[...new Map(answers.map(a=>[a.address,a])).values()];return {hostname:host,port,address:unique[0].address,family:unique[0].family,checkedAnswers:unique.length};
}

export function createPublicWebGrantForSpec({immutableSpec,bindings,issuedAt=Date.now(),expiresAt=issuedAt+PUBLIC_WEB_MAX_TTL_MS,limits={maxRequests:64,maxConnections:8,maxBytes:33554432}}){
 need(immutableSpec&&typeof immutableSpec==='object'&&!Array.isArray(immutableSpec)&&Buffer.byteLength(canonicalGrant(immutableSpec))<=32768,'PUBLIC_WEB_SPEC_REQUIRED');
 keys(immutableSpec.publicWeb,['hosts']);need(Array.isArray(immutableSpec.publicWeb.hosts),'PUBLIC_WEB_SPEC_SCOPE_REQUIRED');
 keys(bindings,['runtimePolicyHash','sessionID','browserContainerID','browserImageID','proxyImageID','browserIPv4','proxyIPv4']);
 const grant={schema:'agi-public-web-grant/v1',...structuredClone(bindings),taskHash:grantDigest(immutableSpec),issuedAt,expiresAt,hosts:structuredClone(immutableSpec.publicWeb.hosts),limits:structuredClone(limits)};
 return validatePublicWebGrant(grant,{now:issuedAt});
}
