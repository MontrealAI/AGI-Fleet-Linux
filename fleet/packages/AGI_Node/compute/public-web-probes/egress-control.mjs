// Fixed positive controls run only inside the exact approved proxy container.
import net from 'node:net';
import dgram from 'node:dgram';
import {lookup} from 'node:dns/promises';
import {publicIPAddress} from '/opt/agi/public-web-policy.mjs';
const result={schema:'agi-public-web-egress-probe/v1',dns:[],selectedIPv4:null,tcp:{connected:false,error:null},udpDNS:{receivedBytes:0,transactionID:null,rcode:null,answerCount:null,peerAddress:null,error:null}};
const safe=error=>typeof error?.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'UNAVAILABLE';
try{result.dns=await lookup('example.com',{all:true});result.selectedIPv4=result.dns.find(value=>value.family===4&&publicIPAddress(value.address))?.address??null;}catch(error){result.dnsError=safe(error);}
if(result.selectedIPv4)result.tcp=await new Promise(resolve=>{const socket=net.connect({host:result.selectedIPv4,port:443});let done=false;const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value);};socket.setTimeout(2000,()=>finish({connected:false,error:'TIMEOUT'}));socket.once('connect',()=>finish({connected:true,error:null}));socket.once('error',error=>finish({connected:false,error:safe(error)}));});
result.udpDNS=await new Promise(resolve=>{
 const socket=dgram.createSocket('udp4'),query=Buffer.from('a61101000001000000000000076578616d706c6503636f6d0000010001','hex');let done=false;
 const finish=value=>{if(done)return;done=true;clearTimeout(timer);socket.close();resolve(value);};const timer=setTimeout(()=>finish({...result.udpDNS,error:'TIMEOUT'}),2000);
 socket.once('error',error=>finish({...result.udpDNS,error:safe(error)}));socket.once('message',(bytes,peer)=>finish({receivedBytes:bytes.length,transactionID:bytes.length>=12?bytes.readUInt16BE(0):null,rcode:bytes.length>=12?bytes[3]&15:null,answerCount:bytes.length>=12?bytes.readUInt16BE(6):null,peerAddress:peer.address,error:null}));socket.send(query,53,'1.1.1.1');
});
process.stdout.write(JSON.stringify(result));
