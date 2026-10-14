import {DEFAULT} from '../fleet/shared/operator/ops/config.mjs';
import {defaultMission} from '../fleet/successor/vendor/manager/site/assets/successor/missions.mjs';
import {digest,roleContract} from './contracts.mjs';

export function example(role,now=Math.floor(Date.now()/1000)) {
  const common={schema:'agi-fleet/local-task/v1',workspace:'files',review:'none',sourceActor:null,sourceController:null};
  if(role==='agent')return {...common,action:'successor-run',input:{mission:defaultMission(),variant:'improved'}};
  if(role==='evidence'){const content='Public synthetic evidence';return {...common,action:'evidence-inspect',input:{files:[{name:'evidence.txt',content,sha256:digest(content)}]}};}
  const buyer='0x'+'22'.repeat(20),agent='0x'+'33'.repeat(20),wallet=role==='employer'?buyer:'0x'+'44'.repeat(20),manager='0x'+'11'.repeat(20);
  const config={...structuredClone(DEFAULT),role,chainId:31337,deploymentBlock:1,manager,wallet,trustedBuyers:[buyer],gatewayURL:'http://127.0.0.1:'+roleContract(role).port,gatewayAgent:roleContract(role).oauth[0]};
  const snapshot={id:'1',buyer,agent,payout:'1000000',paused:false,completed:false,expired:false,disputed:role==='moderator',requested:true,moderator:role==='moderator',now,neutralRefundAfter:'0',settlementAfter:String(now-1),assignmentDeadline:String(now-1),reviewEnd:String(now+600),context:'synthetic-context'};
  const proof={schema:'agi-fleet-evidence/v1',chainId:31337,manager,job:'1',context:snapshot.context,decision:'approve',created:now,expires:now+300,modelVeto:false,modelVerdict:null};proof.hash=digest(proof);
  return {...common,action:'protocol-inspect',input:{config,snapshot,row:{createdTime:now-3600},proof}};
}
