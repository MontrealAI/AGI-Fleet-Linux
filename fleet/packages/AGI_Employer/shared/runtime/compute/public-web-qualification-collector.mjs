import {consumerRoot,consumerCompute,consumerFile} from './consumer.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {boundedCommand} from './repair.mjs';
import {publicWebCDPCommand} from './public-web-isolation.mjs';
import {publicWebQualificationIdentity} from './public-web-qualification-identity.mjs';
import {publicIPAddress} from './public-web-policy.mjs';
import {canonical,sha256,ensure} from '../src/util.mjs';
const ROOT=consumerCompute;
export const PUBLIC_WEB_RESIDUAL_MEASUREMENTS=['authoritative-dns-rebinding','cross-host-redirect','controlled-host-private-reachability'];
export const PUBLIC_WEB_PROBE_IDS=['egress-control','browser-negative','protected-browser-positive','proxy-enforcement-control'];
export function publicWebProbeSources(){return Object.fromEntries(['public-web-qualification-collector.mjs','public-web-probes/egress-control.mjs','public-web-probes/browser-negative.py','public-web-probes/enforcement-control.mjs'].map(name=>[name,sha256(fs.readFileSync(path.join(ROOT,name)))]));}
// This collector executes only fixed reviewed probes in the exact active owned
// containers. It records raw outcomes; deciding what they establish is separate.
export async function collectPublicWebQualification({worker,active,operatorPublicKey,expectedGrantHash,session,signal,allowLocalRuntime=false,dependencies={}}){
 ensure(allowLocalRuntime===true,'PUBLIC_WEB_LOCAL_MEASUREMENT_APPROVAL_REQUIRED');
 const now=dependencies.now??Date.now,run=dependencies.run??boundedCommand,verify=dependencies.verify??publicWebCDPCommand,platform=dependencies.platform??process.platform;
 ensure(platform==='darwin'||platform==='linux'&&worker.c.deploymentPlatform==='linux','PUBLIC_WEB_NATIVE_HOST_REQUIRED');worker.assertPolicy();
 ensure(['commissioning','qualified'].includes(worker.c.publicWebPolicy?.mode)&&active.plan.spec.runtimePolicyHash===worker.c.policyHash,'PUBLIC_WEB_COMMISSIONING_POLICY_REQUIRED');
 await verify(active,{operatorPublicKey,expectedGrantHash,signal,now});
 const observations=[],identity=(dependencies.identity??publicWebQualificationIdentity)(worker.c),sourceHashes=identity.sourceHashes;
 const record=async(id,executable,args,options={})=>{
  worker.assertPolicy();ensure(now()<active.expiresAt&&!signal?.aborted,'PUBLIC_WEB_GRANT_EXPIRED');
  const remaining=Math.max(1,Math.min(options.timeoutMs??10000,active.expiresAt-now())),commandSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(remaining)]):AbortSignal.timeout(remaining);
  const startedAt=now(),result=await run(executable,args,{timeoutMs:remaining,maxBytes:32768,signal:commandSignal});
  let stdout=null;try{stdout=JSON.parse(result.stdout);}catch{}
  const observed={id,commandSha256:sha256(canonical({executable,args})),exitCode:result.status??null,code:result.code??'UNKNOWN',stdout,startedAt,finishedAt:now()};observations.push(observed);worker.assertPolicy();return observed;
 };
 const positive=await record('egress-control',active.docker,['exec',active.proxyContainerID,'node','--input-type=module','--eval',fs.readFileSync(path.join(ROOT,'public-web-probes/egress-control.mjs'),'utf8')]);
 const selected=positive.stdout?.selectedIPv4;
 if(typeof selected==='string'&&publicIPAddress(selected)&&/^\d+\.\d+\.\d+\.\d+$/.test(selected)){
  await record('browser-negative',active.docker,['exec',active.browserContainerID,'python3','-c',fs.readFileSync(path.join(ROOT,'public-web-probes/browser-negative.py'),'utf8'),JSON.stringify({publicIPv4:selected,proxyIPv4:active.plan.proxyIPv4})],{timeoutMs:20000});
 }else observations.push({id:'browser-negative',commandSha256:sha256('POSITIVE_CONTROL_UNAVAILABLE'),exitCode:null,code:'POSITIVE_CONTROL_UNAVAILABLE',stdout:null,startedAt:now(),finishedAt:now()});
 await record('proxy-enforcement-control',active.docker,['exec',active.proxyContainerID,'node','--input-type=module','--eval',fs.readFileSync(path.join(ROOT,'public-web-probes/enforcement-control.mjs'),'utf8')],{timeoutMs:15000});
 const startedAt=now();let stdout=null,code='OK';
 try{
  await session.execute({action:'navigate',url:'https://example.com/'},{signal});
  let snapshot;for(let attempt=0;attempt<5;attempt++){snapshot=await session.execute({action:'snapshot'},{signal});if(snapshot.url==='https://example.com/'&&snapshot.title&&snapshot.headings?.some(value=>value.level==='h1'))break;await new Promise(resolve=>setTimeout(resolve,200));}
  stdout={schema:'agi-public-web-browser-observation/v1',url:snapshot.url,title:snapshot.title,headings:snapshot.headings,textSha256:sha256(snapshot.text),grantHash:snapshot.grantHash,untrusted:snapshot.untrusted};
 }catch(error){code=/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'PUBLIC_WEB_BROWSER_OBSERVATION_FAILED';}
 observations.push({id:'protected-browser-positive',commandSha256:sha256(canonical([{action:'navigate',url:'https://example.com/'},{action:'snapshot'}])),exitCode:code==='OK'?0:null,code,stdout,startedAt,finishedAt:now()});
 await verify(active,{operatorPublicKey,expectedGrantHash,signal,now});worker.assertPolicy();
 const result={schema:'agi-public-web-observations/v1',collectedAt:now(),executionFingerprint:identity.executionFingerprint,platform:{platform,arch:process.arch,uid:process.getuid?.(),signerUID:worker.c.signerUID},synthetic:Object.keys(dependencies).length>0,sourceHashes,policyHash:worker.c.policyHash,sessionID:active.plan.spec.sessionID,grantHash:expectedGrantHash,containerIDs:{browser:active.browserContainerID,proxy:active.proxyContainerID},imageIDs:{browser:active.plan.spec.browserImageID,proxy:active.plan.spec.proxyImageID},observations,requiredExternalMeasurements:[...PUBLIC_WEB_RESIDUAL_MEASUREMENTS],productionQualified:false};
 const target=path.join(active.plan.spec.sessionDirectory,'physical-observations.json');fs.writeFileSync(target,JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});return result;
}
