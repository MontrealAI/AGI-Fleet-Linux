import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {need,keys,uuid,parseStrict,canonical,MAX_BYTES} from '../../primitives.mjs';
import {readPrivate} from '../../private-file.mjs';

export const TOOL='fleet_local';
export const OPERATIONS=['status','inspect','prepare','run','cancel','output'];
export function configuration(input){
  keys(input,['actor','role','agentId','origin','socket','tokenFile'],['actor','role','agentId','tokenFile']);uuid(input.actor);
  need(['agent','node','moderator','employer','evidence','recovery'].includes(input.role),'CLIENT_ROLE_INVALID');
  need(input.agentId==='fleet-'+input.actor,'CLIENT_AGENT_BINDING');
  need(Object.hasOwn(input,'origin')!==Object.hasOwn(input,'socket'),'CLIENT_ENDPOINT_REQUIRED');
  if(Object.hasOwn(input,'socket')){
    need(typeof input.socket==='string'&&path.isAbsolute(input.socket)&&path.basename(input.socket)==='control.sock','CLIENT_SOCKET_INVALID');
    const parent=path.dirname(input.socket),s=fs.lstatSync(parent);
    need(fs.realpathSync(parent)===parent&&s.isDirectory()&&s.uid===process.getuid()&&(s.mode&0o077)===0,'CLIENT_SOCKET_DIRECTORY');
    const endpoint=fs.lstatSync(input.socket);
    need(endpoint.isSocket()&&endpoint.uid===process.getuid()&&(endpoint.mode&0o077)===0,'CLIENT_SOCKET_INVALID');
  }else{
    const u=new URL(input.origin);
    need(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&Number(u.port)>=1024&&Number(u.port)<=65535&&u.origin===input.origin,'CLIENT_ORIGIN_INVALID');
  }
  need(path.isAbsolute(input.tokenFile)&&fs.realpathSync(input.tokenFile)===input.tokenFile,'CLIENT_CREDENTIAL_PATH');
  const token=readPrivate(input.tokenFile,100).toString().trim();need(/^[a-f0-9]{64}$/.test(token),'CLIENT_CREDENTIAL_INVALID');
  return {...input,token};
}
function request(config,operation,input,signal){
  const body=canonical(input);need(Buffer.byteLength(body)<=MAX_BYTES,'INPUT_LIMIT');
  return new Promise((resolve,reject)=>{
    const endpoint=config.socket?{socketPath:config.socket,host:'localhost'}:{hostname:'127.0.0.1',port:Number(new URL(config.origin).port)};
    const q=http.request({...endpoint,path:'/v1/'+operation,method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)},res=>{
      const chunks=[];let size=0;res.on('data',b=>{size+=b.length;if(size>4_000_000)q.destroy(Error('CLIENT_RESPONSE_LIMIT'));else chunks.push(b);});
      res.on('end',()=>{try{const value=parseStrict(Buffer.concat(chunks).toString(),4_000_000);need(res.statusCode===200,value.error||'CLIENT_REQUEST_FAILED');resolve(value);}catch(e){reject(e);}});
    });
    q.once('error',e=>reject(Object.assign(Error(/^[A-Z0-9_]+$/.test(e.code||e.message)?e.code||e.message:'CLIENT_TRANSPORT_UNCERTAIN'),{code:'CLIENT_TRANSPORT_UNCERTAIN'})));
    q.end(body);
  });
}
export async function invoke(configInput,parameters,{signal}={}){
  const c=configuration(configInput);
  need(parameters&&OPERATIONS.includes(parameters.operation),'CLIENT_OPERATION_DENIED');
  const required={status:['operation'],inspect:['operation'],prepare:['operation','task'],run:['operation','grant'],cancel:['operation','run'],output:['operation','run']}[parameters.operation];
  keys(parameters,required);
  const scope=await request(c,'client-info',{},signal);
  need(scope.operator===false&&scope.actor===c.actor&&canonical(scope.actions)===canonical(['status','inspect','prepare','run','cancel','output']),'CLIENT_SCOPED_CREDENTIAL_REQUIRED');
  const actor=await request(c,'inspect',{actor:c.actor},signal);need(actor.role===c.role,'CLIENT_ROLE_MISMATCH');
  let input={actor:c.actor};
  if(parameters.operation==='status')input={};
  if(parameters.operation==='prepare')input.task=parameters.task;
  if(parameters.operation==='run')input.grant=uuid(parameters.grant);
  if(['cancel','output'].includes(parameters.operation))input.run=uuid(parameters.run);
  return await request(c,parameters.operation,input,signal);
}
