import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,need,parseStrict,MAX_BYTES} from '../contracts.mjs';
import {CAPSULE_ENVELOPE_BYTES} from '../primitives.mjs';

export function createServer(runtime,{port=0,socket=null}={}) {
  need(socket===null||path.dirname(socket)===runtime.directory,'SOCKET_SCOPE');
  const server=http.createServer(async(req,res)=>{
    const actual=server.address(),host=socket?'localhost':`127.0.0.1:${actual.port}`,origin=`http://${host}`;
    const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    if(req.headers.host!==host||req.headers.origin&&req.headers.origin!==origin)return reply(403,{error:'ORIGIN_DENIED'});
    if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'&&req.headers['sec-fetch-site']!=='none')return reply(403,{error:'ORIGIN_DENIED'});
    if(req.method==='GET'&&['/','/app.js','/style.css'].includes(req.url)&&!socket){
      const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}[req.url];
      res.writeHead(200,{'Content-Type':file.endsWith('html')?'text/html; charset=utf-8':file.endsWith('js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src blob:; frame-ancestors 'none'; form-action 'none'; base-uri 'none'"});
      res.end(fs.readFileSync(path.join(ROOT,'local-dashboard',file)));return;
    }
    if(req.method!=='POST'||!/^\/v1\/[a-z-]+$/.test(req.url)||req.headers['content-type']!=='application/json')return reply(404,{error:'ROUTE_INVALID'});
    try {
      const principal=runtime.authenticate(req.headers.authorization?.replace(/^Bearer /,''));
      const maximum=['/v1/project-import','/v1/journey-import'].includes(req.url)?CAPSULE_ENVELOPE_BYTES:MAX_BYTES;
      need(!req.headers['content-length']||Number(req.headers['content-length'])<=maximum,'INPUT_LIMIT');
      let count=0,parts=[];for await(const part of req){count+=part.length;need(count<=maximum,'INPUT_LIMIT');parts.push(part);}
      const input=parseStrict(Buffer.concat(parts).toString(),maximum);
      const value=await runtime.dispatch(req.url.slice(4),input,principal);reply(200,value);
    }catch(e){reply(400,{error:/^[A-Z0-9_]{1,100}$/.test(e.code||e.message)?e.code||e.message:'REQUEST_FAILED',...(e.run?{run:e.run}:{})});}
  });
  server.on('upgrade',(req,s)=>{s.destroy();});server.requestTimeout=20000;server.headersTimeout=5000;server.maxHeadersCount=24;server.keepAliveTimeout=1000;
  return {server,start:()=>new Promise((resolve,reject)=>{
    server.once('error',reject);
    const onListen=()=>{if(socket)fs.chmodSync(socket,0o600);resolve(socket?{socket}:{url:`http://127.0.0.1:${server.address().port}`});};
    if(socket)server.listen(socket,onListen);else server.listen(port,'127.0.0.1',onListen);
  })};
}
