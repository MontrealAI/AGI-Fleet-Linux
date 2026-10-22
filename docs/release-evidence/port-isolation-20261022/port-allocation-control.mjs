import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
const listen=(s,port=0)=>new Promise((resolve,reject)=>{s.once('error',reject);s.listen(port,'127.0.0.1',()=>resolve(s.address().port));});
const close=s=>new Promise(resolve=>s.close(resolve));
test('released reservation permits duplicate port selection and recreates observed EADDRINUSE',async t=>{
 const first=http.createServer(),second=http.createServer(),gateway=http.createServer(),compute=http.createServer();
 t.after(async()=>{for(const s of [first,second,gateway,compute])if(s.listening)await close(s);});
 const gatewayPort=await listen(first);await close(first);
 const computePort=await listen(second,gatewayPort);await close(second);assert.equal(computePort,gatewayPort);
 await listen(gateway,gatewayPort);await assert.rejects(listen(compute,computePort),e=>e.code==='EADDRINUSE');
});
test('simultaneous reservations allocate distinct ports and both services can bind afterward',async t=>{
 const first=http.createServer(),second=http.createServer(),gateway=http.createServer(),compute=http.createServer();
 t.after(async()=>{for(const s of [first,second,gateway,compute])if(s.listening)await close(s);});
 const gatewayPort=await listen(first),computePort=await listen(second);assert.notEqual(gatewayPort,computePort);
 await close(second);await close(first);await listen(gateway,gatewayPort);await listen(compute,computePort);
});
test('early preparation failure closes a held reservation',async()=>{
 const reserve=http.createServer();let port;
 try{port=await listen(reserve);throw Error('PREPARATION_FAILED');}catch(e){assert.equal(e.message,'PREPARATION_FAILED');}finally{if(reserve.listening)await close(reserve);}
 const next=http.createServer();try{assert.equal(await listen(next,port),port);}finally{await close(next);}
});
