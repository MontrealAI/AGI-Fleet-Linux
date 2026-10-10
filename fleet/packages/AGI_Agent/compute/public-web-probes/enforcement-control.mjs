// Deterministic negative controls against the installed proxy module, inside the
// exact immutable proxy image. These are synthetic DNS/redirect fixtures, not
// measurements of an external authoritative DNS server or real hostile site.
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import {createPublicWebProxy} from '/opt/agi/public-web-proxy.mjs';
import {approvePublicWebGrant,grantDigest} from '/opt/agi/public-web-policy.mjs';
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519'),authority=publicKey.export({format:'pem',type:'spki'}),secret=privateKey.export({format:'pem',type:'pkcs8'}),now=Date.now();
const grant={schema:'agi-public-web-grant/v1',taskHash:'a'.repeat(64),runtimePolicyHash:'b'.repeat(64),sessionID:crypto.randomUUID(),browserContainerID:'c'.repeat(64),browserImageID:'sha256:'+'d'.repeat(64),proxyImageID:'sha256:'+'e'.repeat(64),browserIPv4:'172.30.80.3',proxyIPv4:'172.30.80.2',issuedAt:now-1,expiresAt:now+30000,hosts:[{hostname:'selftest.example.com',ports:[80,443]}],limits:{maxRequests:64,maxConnections:8,maxBytes:1048576}};
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
async function fixture(lookup,redirect=false){
 const upstream=http.createServer((_req,res)=>{if(redirect){res.writeHead(302,{Location:'http://unapproved.example.com/'});res.end();}else res.end('FIXTURE');});await listen(upstream);const connects=[],pins=new WeakMap();
 const proxy=createPublicWebProxy({approval:approvePublicWebGrant(grant,secret),authorityKey:authority,expectedGrantHash:grantDigest(grant),lookup,peerAddress:()=>grant.browserIPv4,connect:options=>{connects.push(options.host);const socket=net.connect({host:'127.0.0.1',port:upstream.address().port});pins.set(socket,{address:options.host,port:options.port});return socket;},remoteAddress:socket=>pins.get(socket)});await listen(proxy.server);
 return {connects,async request(host='selftest.example.com'){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:proxy.server.address().port,path:'http://'+host+'/',headers:{Host:host},agent:false},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,location:res.headers.location??null,body}));});req.setTimeout(2000,()=>req.destroy(Error('TIMEOUT')));req.once('error',reject);req.end();});},close(){proxy.close();upstream.closeAllConnections();upstream.close();}};
}
const tests=[];
let f=await fixture(async()=>[{address:'1.1.1.1',family:4},{address:'10.0.0.1',family:4}]);try{tests.push({id:'mixed-dns',response:await f.request(),connects:[...f.connects]});}finally{f.close();}
let lookups=0;f=await fixture(async()=>[++lookups===1?{address:'1.1.1.1',family:4}:{address:'10.0.0.1',family:4}]);try{const first=await f.request(),second=await f.request();tests.push({id:'rebind-after-public',first,second,lookups,connects:[...f.connects]});}finally{f.close();}
f=await fixture(async()=>[{address:'1.1.1.1',family:4}],true);try{const first=await f.request(),second=await f.request('unapproved.example.com');tests.push({id:'redirect-reauthorization',first,second,connects:[...f.connects]});}finally{f.close();}
f=await fixture(async()=>{throw Error('UNEXPECTED_DNS');});try{const responses=[];for(const target of ['127.0.0.1','169.254.169.254','168.63.129.16'])responses.push({target,...await f.request(target)});tests.push({id:'literal-private',responses,connects:[...f.connects]});}finally{f.close();}
process.stdout.write(JSON.stringify({schema:'agi-public-web-enforcement-probe/v1',syntheticDNS:true,syntheticRedirect:true,installedProxyModule:'/opt/agi/public-web-proxy.mjs',tests}));
