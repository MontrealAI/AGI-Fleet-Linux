import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {NETWORK_COMMANDS as C,networkInventory,resolverPolicyRequiresReview} from '../compute/network-preflight.mjs';
import {createDNSPlan,applyDNSPlan,rollbackDNSReceipt} from '../compute/admin-dns.mjs';

// Synthetic scutil layout follows Apple's configd logger, not an actual Mac capture.
const fixture=fs.readFileSync(new URL('./fixtures/dns-standard-mdns.txt',import.meta.url),'utf8');
const ordinary=fixture.split('DNS configuration (for scoped queries)')[0];
const primary=ordinary.split('resolver #2')[0];
const supplement='\nresolver #8\n  domain : corp.example\n  nameserver[0] : 10.0.0.53\n  flags : Supplemental, Request A records\n';
const identity={administratorUID:501,privileged:true};
function mac({text=fixture,managed={code:0,stdout:'Enrolled via DEP: No\nMDM enrollment: No\n'},configured={mode:'automatic',servers:[]}}={}){
 const state={text,managed,configured},events=[];
 const run=async(file,args=[],options={})=>{events.push({file,args});let stdout='';
  if(file===C.scutil){if(args[0]==='--dns')stdout=state.text;else if(options.input.includes('Setup:'))stdout='<dictionary> {\n UserDefinedName : Ethernet\n}\n';else if(options.input.includes('IPv6'))stdout='No such key\n';else stdout='<dictionary> {\n PrimaryService : 12345678-1234-1234-1234-123456789abc\n PrimaryInterface : en1\n}\n';}
  else if(file===C.networksetup){if(args[0]==='-listnetworkserviceorder')stdout='(1) Ethernet\n(Hardware Port: Ethernet, Device: en1)\n';else if(args[0]==='-getdnsservers')stdout=state.configured.mode==='automatic'?"There aren't any DNS Servers set on Ethernet.\n":state.configured.servers.join('\n');else if(args[0]==='-setdnsservers')state.configured=args[2]==='Empty'?{mode:'automatic',servers:[]}:{mode:'manual',servers:args.slice(2)};else throw Error('UNEXPECTED_COMMAND');}
  else if(file===C.route)stdout=' interface: en1\n';else if(file===C.profiles)return {...state.managed,stderr:''};else throw Error('UNEXPECTED_COMMAND');
  return {code:0,stdout,stderr:''};
 };
 return {state,events,run,inventory:()=>networkInventory({run,platform:'darwin'}),writes:()=>events.filter(x=>x.args[0]==='-setdnsservers')};
}
async function planFor(m){return createDNSPlan({inventory:await m.inventory(),servers:['1.1.1.1'],administratorUID:501});}
async function apply(m,plan,extra={}){return applyDNSPlan({plan,confirmation:plan.id,policyReviewed:true,identity,run:m.run,inventory:m.inventory,persist:async()=>{},verify:async()=>({status:'PASS',checks:[]}),...extra});}

test('DNS-MDNS-001 standard local and link-local reverse multicast plus active scoped copy permits planning',async()=>{
 for(const text of [primary,ordinary,fixture,fixture.replace('a.e.f.ip6.arpa','A.E.F.IP6.ARPA.')]){const m=mac({text}),inventory=await m.inventory();assert.equal(inventory.splitDNS,false);const plan=createDNSPlan({inventory,servers:['1.1.1.1'],administratorUID:501});assert.equal(plan.service.name,'Ethernet');assert.equal(m.writes().length,0);assert.deepEqual(inventory.effectiveDNS,['192.168.2.1']);}
});
test('mixed multicast and genuine supplemental unicast remains blocked',async()=>{
 const m=mac({text:ordinary+supplement}),inventory=await m.inventory();assert.equal(inventory.splitDNS,true);await assert.rejects(planFor(m),/SPLIT_DNS_ADMINISTRATOR_REQUIRED/);assert.equal(m.writes().length,0);
});
test('only explicit mdns in the six Apple namespaces qualifies for the multicast exception',()=>{
 for(const [from,to] of [['options : mdns','options : mdns tls'],['options : mdns','options : unicast'],['options : mdns','nameserver[0] : 10.0.0.53'],['domain : local','domain : private.local'],['domain : 254.169.in-addr.arpa','domain : 2.168.192.in-addr.arpa'],['domain : 8.e.f.ip6.arpa','domain : c.e.f.ip6.arpa']])assert.equal(resolverPolicyRequiresReview(ordinary.replace(from,to),{primaryInterface:'en1'}),true,to);
 for(const insertion of ['nameserver[0] : 10.0.0.53','port : 5353','if_index : 6 (en1)','search domain[0] : corp.example','flags : Supplemental'])assert.equal(resolverPolicyRequiresReview(ordinary.replace('options : mdns',`options : mdns\n  ${insertion}`),{primaryInterface:'en1'}),true,insertion);
});
test('domain-specific unicast local and arpa are not silently ignored',()=>{
 for(const domain of ['local','254.169.in-addr.arpa','8.e.f.ip6.arpa','corp.example'])assert.equal(resolverPolicyRequiresReview(primary+`\nresolver #2\n domain : ${domain}\n nameserver[0] : 10.0.0.53\n flags : Request A records\n`,{primaryInterface:'en1'}),true,domain);
});
test('ordinary search suffixes are not split routing, but scoped policy must match the active primary route',()=>{
 assert.equal(resolverPolicyRequiresReview(fixture,{primaryInterface:'en1'}),false);
 const [unscoped,scoped]=fixture.split('DNS configuration (for scoped queries)');
 for(const changed of [scoped.replace('(en1)','(utun3)'),scoped.replace('(en1)','(en0)'),scoped.replace('192.168.2.1','10.0.0.53'),scoped.replace('home','corp.example'),scoped.replace('flags : Scoped,','flags : Supplemental, Scoped,'),scoped.replace('if_index : 6 (en1)',''),scoped.replace('flags : Scoped,','flags :'),scoped+'\n  options : mdns\n'])assert.equal(resolverPolicyRequiresReview(unscoped+'DNS configuration (for scoped queries)'+changed,{primaryInterface:'en1'}),true);
 assert.equal(resolverPolicyRequiresReview(fixture),true);
});
test('service-specific, unknown transport and flag policy require review',()=>{
 for(const text of [fixture.replace('(for scoped queries)','(for service-specific queries)'),fixture.replace('(for scoped queries)','(for unknown queries)'),primary+'  options : https\n',primary+'  service_identifier : 4\n',primary+'  port : 5353\n',primary.replace('Request A records','0x00000001'),primary.replace('Request A records','Scoped'),primary+'  sortaddr[0] : 10.0.0.0/255.0.0.0\n'])assert.equal(resolverPolicyRequiresReview(text,{primaryInterface:'en1'}),true);
});
test('malformed, empty, duplicated, truncated and reordered resolver structure fails closed',()=>{
 const cases=['','No DNS configuration available',null,primary+'unparsed line',primary+'  nameserver[0] : 8.8.8.8\n',primary.replace('nameserver[0]','nameserver[1]'),primary.replace('192.168.2.1','not-an-address'),primary.replace('resolver #1','resolver #3'),primary.replace('resolver #1','resolver #0'),primary.replace('resolver #1','resolver #1\nresolver #2'),primary+'\nresolver #2\n',primary+'\nDNS configuration (for scoped queries)\n',primary+'\nresolver #1\n  nameserver[0] : 9.9.9.9\n',primary.replace('flags : Request','flags : , Request'),primary.replace('if_index : 6 (en1)','if_index : unknown'),primary+'\0',fixture+' '.repeat(128*1024),ordinary.replace('resolver #1','resolver #9'),ordinary.slice(ordinary.indexOf('resolver #2')).replace('resolver #2','resolver #1')];
 for(const text of cases)assert.equal(resolverPolicyRequiresReview(text,{primaryInterface:'en1'}),true,String(text).slice(0,100));
});
test('the support inventory remains the same sanitized schema without raw resolver domains or options',async()=>{
 const inventory=await mac().inventory();assert.deepEqual(Object.keys(inventory).sort(),['schema','service','configuredDNS','effectiveDNS','mdmEnrolled','managementKnown','splitDNS','routeInterface'].sort());assert.equal(JSON.stringify(inventory).includes('mdns'),false);assert.equal(JSON.stringify(inventory).includes('in-addr.arpa'),false);
});
test('managed, failed or ambiguous management detection never grants a DNS plan',async()=>{
 for(const managed of [{code:0,stdout:'MDM enrollment: Yes\n'},{code:0,stdout:'MDM enrollment: Yes (User Approved)\n'},{code:1,stdout:'MDM enrollment: No\n'},{code:0,error:'TIMEOUT',stdout:'MDM enrollment: No\n'},{code:0,stdout:'MDM enrollment: No\nMDM enrollment: Yes\n'},{code:0,stdout:'MDM enrollment: No\nMDM enrollment: No\n'},{code:0,stdout:'MDM enrollment: No but unknown\n'},{code:0,stdout:'unknown'}]){const m=mac({managed});await assert.rejects(planFor(m),/MANAGED_NETWORK_ADMINISTRATOR_REQUIRED/);assert.equal(m.writes().length,0);}
});
test('missing or ambiguous splitDNS cannot bypass the explicit policy decision',async()=>{
 const inventory=await mac().inventory();for(const value of [undefined,null,0,'false',true])assert.throws(()=>createDNSPlan({inventory:{...inventory,splitDNS:value},servers:['1.1.1.1'],administratorUID:501}),/SPLIT_DNS_ADMINISTRATOR_REQUIRED/);
});
test('apply rechecks new split or MDM policy after approval with no receipt or write on initial refusal',async()=>{
 for(const change of [m=>m.state.text=ordinary+supplement,m=>m.state.text='',m=>m.state.managed={code:0,stdout:'MDM enrollment: Yes\n'}]){const m=mac(),plan=await planFor(m);change(m);let saves=0;await assert.rejects(apply(m,plan,{persist:async()=>{saves++;}}),/ADMINISTRATOR_REQUIRED/);assert.equal(saves,0);assert.equal(m.writes().length,0);}
});
test('policy changes while the rollback receipt is persisted block the first DNS write',async()=>{
 const m=mac(),plan=await planFor(m),receipts=[];const result=await apply(m,plan,{persist:async receipt=>{receipts.push(structuredClone(receipt));if(receipt.state==='APPLYING')m.state.text=ordinary+supplement;}});assert.equal(result.state,'BLOCKED');assert.equal(result.dnsWriteAttempted,false);assert.equal(result.failure,'SPLIT_DNS_ADMINISTRATOR_REQUIRED');assert.equal(m.writes().length,0);assert.equal(receipts[0].dnsWriteAttempted,null);assert.equal(receipts.at(-1).state,'BLOCKED');
});
test('approved mDNS-only apply persists before mutation and verifies the same selected service',async()=>{
 const m=mac(),plan=await planFor(m),saved=[];const result=await apply(m,plan,{persist:async r=>saved.push({state:r.state,writes:m.writes().length})});assert.equal(result.state,'APPLIED');assert.equal(result.dnsWriteAttempted,true);assert.deepEqual(saved[0],{state:'APPLYING',writes:0});assert.deepEqual(m.writes().map(x=>x.args),[['-setdnsservers','Ethernet','1.1.1.1']]);
});
test('policy drift immediately after the write suppresses automatic rollback into new managed policy',async()=>{
 const m=mac(),plan=await planFor(m),original=m.run;const run=async(...args)=>{const result=await original(...args);if(args[1][0]==='-setdnsservers')m.state.managed={code:0,stdout:'MDM enrollment: Yes\n'};return result;};const result=await apply(m,plan,{run});assert.equal(result.state,'ROLLBACK_FAILED');assert.equal(result.dnsWriteAttempted,true);assert.equal(result.failure,'MANAGED_NETWORK_ADMINISTRATOR_REQUIRED');assert.equal(result.rollbackFailure,'MANAGED_NETWORK_ADMINISTRATOR_REQUIRED');assert.equal(m.writes().length,1);
});
test('policy drift during successful hostname verification is not reported APPLIED or overwritten',async()=>{
 const m=mac(),plan=await planFor(m);const result=await apply(m,plan,{verify:async()=>{m.state.text=ordinary+supplement;return {status:'PASS',checks:[]};}});assert.equal(result.state,'ROLLBACK_FAILED');assert.equal(result.failure,'SPLIT_DNS_ADMINISTRATOR_REQUIRED');assert.equal(result.rollbackFailure,'SPLIT_DNS_ADMINISTRATOR_REQUIRED');assert.equal(m.writes().length,1);
});
test('unchanged policy retains automatic DNS rollback after native verification fails',async()=>{
 const m=mac(),plan=await planFor(m);const result=await apply(m,plan,{verify:async()=>({status:'BLOCKED',checks:[]})});assert.equal(result.state,'ROLLED_BACK');assert.deepEqual(m.writes().map(x=>x.args),[['-setdnsservers','Ethernet','1.1.1.1'],['-setdnsservers','Ethernet','Empty']]);assert.deepEqual(m.state.configured,plan.before);
});
test('explicit rollback does not overwrite DNS after policy becomes managed',async()=>{
 const m=mac(),plan=await planFor(m);m.state.configured=structuredClone(plan.after);m.state.managed={code:0,stdout:'MDM enrollment: Yes\n'};await assert.rejects(rollbackDNSReceipt({receipt:{schema:'agi-admin-dns-receipt/v1',plan,state:'APPLIED'},confirmation:plan.id,identity,run:m.run,inventory:m.inventory,persist:async()=>{}}),/MANAGED_NETWORK_ADMINISTRATOR_REQUIRED/);assert.equal(m.writes().length,0);
});
test('explicit rollback rechecks policy and settings after durable persistence before any write',async()=>{
 for(const change of [m=>m.state.text=ordinary+supplement,m=>m.state.managed={code:0,stdout:'MDM enrollment: Yes\n'},m=>m.state.configured={mode:'manual',servers:['9.9.9.9']}]){const m=mac(),plan=await planFor(m),saved=[];m.state.configured=structuredClone(plan.after);await assert.rejects(rollbackDNSReceipt({receipt:{schema:'agi-admin-dns-receipt/v1',plan,state:'APPLIED'},confirmation:plan.id,identity,run:m.run,inventory:m.inventory,persist:async r=>{saved.push(structuredClone(r));if(r.state==='ROLLING_BACK')change(m);}}),/ADMINISTRATOR_REQUIRED|DNS_SETTINGS_CHANGED_AFTER_REPAIR/);assert.equal(m.writes().length,0);assert.equal(saved.at(-1).state,'BLOCKED');assert.equal(saved.at(-1).rollbackWriteAttempted,false);}
});
