import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture,task} from './helpers.mjs';
import {createServer} from '../supervisor/server.mjs';
import {invoke} from '../clients/openclaw/client.mjs';
import {localTool} from '../clients/openclaw/index.mjs';

async function setup(){
  const f=fixture(),a=f.create(),c=f.runtime.issueClient(a.id),s=createServer(f.runtime),{url}=await s.start();
  const tokenFile=f.directory+'/actor.token';fs.writeFileSync(tokenFile,c.token,{mode:0o600});
  return {...f,a,c,s,config:{actor:a.id,role:a.role,agentId:'fleet-'+a.id,origin:url,tokenFile},async finish(){s.server.closeAllConnections();await new Promise(r=>s.server.close(r));f.close();}};
}
test('OpenClaw client uses actual authenticated HTTP and a separately authorized grant (synthetic worker boundary)',async()=>{
  const f=await setup();try{
    const tool=localTool({agentId:f.config.agentId,sessionKey:'agent:'+f.config.agentId+':test'},f.config);assert.ok(tool);
    const prepared=JSON.parse((await tool.execute('call',{operation:'prepare',task:task()})).content[0].text).value;
    const inspected=await f.runtime.dispatch('grant-inspect',{grant:prepared.grant},f.operator);
    assert.equal(inspected.preparingClient,'scoped-client');assert.equal(inspected.commitment,prepared.commitment);
    await assert.rejects(f.runtime.dispatch('grant-inspect',{grant:prepared.grant},f.c.principal),/CLIENT_SCOPE_DENIED/);
    assert.equal(f.runtime.status(f.operator).pending[0].grant,prepared.grant);
    await assert.rejects(invoke(f.config,{operation:'run',grant:prepared.grant}),/GRANT_UNAVAILABLE/);
    f.authorize(prepared);
    const run=await invoke(f.config,{operation:'run',grant:prepared.grant});assert.equal(run.state,'complete');
    assert.equal(run.receipt.result.checker.passed,true);
    assert.equal((await invoke(f.config,{operation:'output',run:run.run})).state,'complete');
    await assert.rejects(invoke(f.config,{operation:'run',grant:prepared.grant}),/GRANT_UNAVAILABLE/);
  }finally{await f.finish();}
});
test('client rejects operator credentials, other actors, role spoofing, extra fields, arbitrary origins and privileged operations',async()=>{
  const f=await setup();try{
    const second=f.create();
    for(const parameters of [{operation:'authorize'},{operation:'stop'},{operation:'prepare',task:task(),actor:second.id}])await assert.rejects(invoke(f.config,parameters),/CLIENT_OPERATION_DENIED|FIELDS_INVALID/);
    await assert.rejects(invoke({...f.config,role:'node'},{operation:'status'}),/CLIENT_ROLE_MISMATCH/);
    await assert.rejects(invoke({...f.config,actor:second.id,agentId:'fleet-'+second.id},{operation:'status'}),/CLIENT_SCOPED_CREDENTIAL_REQUIRED/);
    for(const origin of ['http://localhost:10000','http://127.0.0.1:10000/path','https://127.0.0.1:10000','http://169.254.169.254:10000'])await assert.rejects(invoke({...f.config,origin},{operation:'status'}),/CLIENT_ORIGIN_INVALID/);
    const operator=f.runtime.issueClient();fs.writeFileSync(f.config.tokenFile,operator.token);
    await assert.rejects(invoke(f.config,{operation:'status'}),/CLIENT_SCOPED_CREDENTIAL_REQUIRED/);
    assert.equal(localTool({agentId:'other',sessionKey:'agent:other:session'},f.config),null);
  }finally{await f.finish();}
});
test('revoked scoped client stops all future adapter calls without exposing raw credentials',async()=>{
  const f=await setup();try{
    f.runtime.revokeClient({client:f.c.principal.hash},f.operator);
    await assert.rejects(invoke(f.config,{operation:'status'}),error=>error.message==='AUTH_REQUIRED'&&!error.message.includes(f.c.token));
  }finally{await f.finish();}
});
