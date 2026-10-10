// Actual Kubo, isolated offline repository, no network publication or wallet.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';
import crypto from 'node:crypto';import {spawn,spawnSync} from 'node:child_process';import {deflateSync} from 'node:zlib';import assert from 'node:assert/strict';
import { Publisher } from '../src/publisher.mjs';import { ContentReader } from '../src/content.mjs';import { DEFAULT } from '../src/config.mjs';import { normalizeWork,assertPrepared } from '../src/work.mjs';import { DECLARATION } from '../src/review.mjs';import { imageSpec,chunk } from './image-fixture.mjs';
const binary=process.env.KUBO_BIN;assert.ok(binary,'Set KUBO_BIN to an installed Kubo executable.');
const repo=fs.mkdtempSync(path.join(os.tmpdir(),'agi-kubo-images-')),env={...process.env,IPFS_PATH:repo};
const port=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const api=await port(),gateway=await port();let child,logs='';
const run=args=>{const r=spawnSync(binary,args,{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;};
try {
 const version=run(['version']).trim();run(['init','--profile=test']);
 run(['config','Addresses.API',`/ip4/127.0.0.1/tcp/${api}`]);run(['config','Addresses.Gateway',`/ip4/127.0.0.1/tcp/${gateway}`]);
 child=spawn(binary,['daemon','--offline'],{env,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',b=>logs=(logs+b).slice(-4000));
 const c={...structuredClone(DEFAULT),execution:{...DEFAULT.execution,publicPublishing:true,kuboPort:api}};
 const reader=new ContentReader(c,async url=>{
   const u=new URL(url);const r=await fetch(`http://127.0.0.1:${gateway}${u.pathname}${u.search}`);assert.equal(r.status,200);return Buffer.from(await r.arrayBuffer());
 });
 const publisher=new Publisher(c,{reader});let ready=false;
 for(let i=0;i<120;i++){try{await publisher.check();ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(ready,logs);
 const h=Buffer.alloc(13);h.writeUInt32BE(1024,0);h.writeUInt32BE(1024,4);h[8]=8;h[9]=2;
 const pixels=crypto.randomBytes((1024*3+1)*1024);for(let y=0;y<1024;y++)pixels[y*(1024*3+1)]=0;
 const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
 const work=normalizeWork(imageSpec,DECLARATION),content=bytes.toString('base64'),uri=await publisher.publish(content,work);
 assert.ok(bytes.length>2*1024*1024);assert.deepEqual((await reader.readImage(uri)).bytes,bytes);
 assertPrepared({spec:work,content,uri,binding:'fixture',stage:'published'},'fixture');
 const ordinary=await fetch(`http://127.0.0.1:${gateway}/ipfs/${uri.slice(7)}`);assert.equal(ordinary.status,200);assert.deepEqual(Buffer.from(await ordinary.arrayBuffer()),bytes);
 console.log(JSON.stringify({version,bytes:bytes.length,chunkedPublication:true,normalGatewayReconstruction:true,independentContentReader:true,publicInternetRetrieval:false,liveImageGeneration:false},null,2));
}finally{if(child && child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}fs.rmSync(repo,{recursive:true,force:true});}
