// Exact manager and both clients, synthetic identities/model output/IPFS transport.
// No OpenAI account, public deployment, real USDC or real-time seven-day soak.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
import hre from 'hardhat';import {BrowserProvider,ContractFactory,HDNodeWallet,ZeroAddress,ZeroHash,parseUnits} from 'ethers';
import {artifacts,Chain} from '../src/chain.mjs';import {DEFAULT,validateConfig,binding} from '../src/config.mjs';import {Store} from '../src/store.mjs';import {Engine} from '../src/engine.mjs';import {ContentReader,rawCID} from '../src/content.mjs';import {Publisher} from '../src/publisher.mjs';import {deliveryPlan,deliveryBytes} from '../src/delivery.mjs';import {DECLARATION} from '../src/review.mjs';import {atomicWrite,encode} from '../src/util.mjs';import {dualFixture} from './dual-rpc-fixture.mjs';const imageSpec=JSON.parse(fs.readFileSync(new URL('../examples/computer-smoke.json',import.meta.url)));const png=()=>fs.readFileSync(new URL('../examples/computer-smoke.bundle.json',import.meta.url));
const nodeRoot=process.env.AGI_NODE_ROOT??new URL('../../AGI_Node_Private_v2.8.0/',import.meta.url).pathname;
const mod=async file=>import(pathToFileURL(path.join(nodeRoot,'src',file)));
const [{Chain:NodeChain},{DEFAULT:ND,validateConfig:nodeConfig,binding:nodeBinding},{Store:NodeStore},{Engine:NodeEngine}]=await Promise.all([mod('chain.mjs'),mod('config.mjs'),mod('store.mjs'),mod('engine.mjs')]);
const connection=await hre.network.connect('hardhat'),provider=new BrowserProvider(connection.provider,undefined,{cacheTimeout:-1});assert.equal(Number((await provider.getNetwork()).chainId),31337);
const wallets=Array.from({length:9},(_,i)=>HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,`m/44'/60'/0'/0/${i}`).connect(provider));
const [owner,buyer,agent,v1,v2,v3,feeA,feeB]=wallets,validators=[v1,v2,v3];
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-images-chain-')),addresses={},stores=[];let dual,realNow=Date.now;
const mined=async p=>(await p).wait();
try {
 async function deploy(name,args=[]) {
  const a=artifacts[name]??JSON.parse(fs.readFileSync(new URL('../contract/artifacts/'+name+'.json',import.meta.url)));let bytecode=a.bytecode;
  for(const libs of Object.values(a.linkReferences))for(const [lib,refs]of Object.entries(libs)){if(!addresses[lib])await deploy(lib);for(const{start,length}of refs)bytecode=bytecode.slice(0,2+start*2)+addresses[lib].slice(2).toLowerCase()+bytecode.slice(2+(start+length)*2);}
  const c=await new ContractFactory(a.abi,bytecode,owner).deploy(...args);await c.waitForDeployment();addresses[name]=await c.getAddress();return c;
 }
 const token=await deploy('FailingERC20'),manager=await deploy('AGIJobManager',[addresses.FailingERC20,'ipfs://',[ZeroAddress,ZeroAddress],[ZeroHash,ZeroHash,ZeroHash,ZeroHash],[ZeroHash,ZeroHash],[feeA.address,feeB.address]]),creation=(await manager.deploymentTransaction().wait()).blockNumber;
 await mined(manager.addAdditionalAgent(agent.address));for(const v of validators)await mined(manager.addAdditionalValidator(v.address));await mined(manager.unpauseIntake());
 for(const w of [buyer,agent,...validators])await mined(token.mint(w.address,parseUnits('1000',6)));
 const evidence=new Map(),specBytes=Buffer.from(JSON.stringify(imageSpec)),specURI='ipfs://'+rawCID(specBytes);evidence.set(rawCID(specBytes),specBytes);
 await mined(token.connect(buyer).approve(addresses.AGIJobManager,parseUnits('100',6)));await mined(manager.connect(buyer).createJob(specURI,parseUnits('100',6),3600,DECLARATION));
 const c=validateConfig({...structuredClone(DEFAULT),chainId:31337,agent:agent.address,manager:addresses.AGIJobManager,deploymentBlock:creation,confirmations:1,trustedBuyers:[buyer.address],dataDir:path.join(dir,'agent'),execution:{...DEFAULT.execution,publicDataOnly:true,publicPublishing:true,allowComputerWork:true}},dir,{ready:true});
 fs.mkdirSync(c.dataDir);dual=await dualFixture(connection.provider,dir);const chain=new Chain(c,dual.provider),pin=await chain.enroll();
 const reader=new ContentReader(c,async url=>{const bytes=evidence.get(new URL(url).pathname.split('/')[2]);assert.ok(bytes);return bytes;});
 const publisher={publish:async(content,work)=>{const plan=deliveryPlan(deliveryBytes(content,work));for(const b of plan.blocks)evidence.set(b.cid,b.bytes);assert.deepEqual((await reader.readBundle(plan.uri)).bytes,deliveryBytes(content,work));return plan.uri;},verify:async(uri,content,work)=>{assert.deepEqual((await reader.readBundle(uri)).bytes,deliveryBytes(content,work));return true;}};
 let store=new Store(c.dataDir);stores.push(store);atomicWrite(path.join(c.dataDir,'activation.json'),encode({binding:binding(c,pin),agent:agent.address}));let generation=0;
 const options={live:true,signer:agent,reader,publisher,executor:async kind=>kind==='generate'?(generation++,{status:'complete',content:png().toString()}):{verdict:'pass'}};
 let engine=new Engine(c,chain,store,pin,options);await engine.cycle();assert.equal(store.work('0').stage,'draft');store.close();stores.pop();store=new Store(c.dataDir);stores.push(store);engine=new Engine(c,chain,store,pin,options);
 for(let i=0;i<12 && !(await manager.getJobValidation(0)).completionRequested;i++)await engine.cycle();
 assert.equal((await manager.getJobValidation(0)).completionRequested,true);assert.equal(generation,1);if(store.pending())await engine.cycle();assert.deepEqual((await reader.readBundle(await manager.getJobCompletionURI(0))).bytes,png());
 for(let i=0;i<validators.length;i++) {
  const v=validators[i],dataDir=path.join(dir,'node-'+i);fs.mkdirSync(dataDir);
  const nc=nodeConfig({...structuredClone(ND),chainId:31337,validator:v.address,manager:addresses.AGIJobManager,deploymentBlock:creation,confirmations:1,trustedBuyers:[buyer.address],dataDir,ai:{...ND.ai,cloudVeto:true,cloudPublicOnly:true,reviewComputerWork:true}},dir,{ready:true});
  const ch=new NodeChain(nc,dual.provider),np=await ch.enroll(),st=new NodeStore(dataDir);stores.push(st);atomicWrite(path.join(dataDir,'activation.json'),encode({binding:nodeBinding(nc,np),validator:v.address}));
  let reviews=0;const ne=new NodeEngine(nc,ch,st,np,{live:true,signer:v,reader,cloudReviewer:async(s,b)=>{assert.equal(s.profile,'computer-work/v1');assert.deepEqual(b,png());reviews++;return {verdict:'consistent',checks:imageSpec.criteria.map(c=>({id:c.id,status:'pass',method:'Synthetic integration reviewer',observed:'Fixture expected values',files:imageSpec.outputs.map(f=>f.name)}))};}});
  for(let k=0;k<8;k++)await ne.cycle();assert.ok(reviews>0);assert.equal(st.pending(),undefined);
 }
 const snapshot=await chain.snapshot('0');assert.equal(snapshot.approvals,3n);assert.equal(snapshot.quorum,3n);
 await connection.provider.request({method:'evm_increaseTime',params:[8*86400]});await connection.provider.request({method:'evm_mine',params:[]});const simulated=(await provider.getBlock('latest')).timestamp*1000;Date.now=()=>simulated;
 await engine.cycle();assert.equal(store.pending().kind,'finalize');await engine.cycle();assert.equal((await manager.getJobCore(0)).completed,true);assert.equal(await token.balanceOf(addresses.AGIJobManager),0n);assert.ok(await token.balanceOf(agent.address)>parseUnits('1000',6));
 console.log(JSON.stringify({manager:'v1.1.0',agent:'1.7.0',node:'2.8.0',filesPrepared:true,restartPreservedBundle:true,contentAddressedDelivery:true,threeJournaledNodeVotes:true,journaledAgentFinalization:true,managerBalance:'0',mockTokenPayment:true,liveInference:false,realIndependentOperators:false,publicIPFS:false,reviewTime:'eight simulated days'},null,2));
}finally{Date.now=realNow;for(const s of stores)s.close();if(dual)await dual.close();provider.destroy();await connection.close();fs.rmSync(dir,{recursive:true,force:true});}
