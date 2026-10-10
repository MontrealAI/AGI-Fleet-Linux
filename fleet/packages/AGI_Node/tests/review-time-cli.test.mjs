import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {digest,verifyReceipt} from '../workforce/review-time.mjs';

const addr=n=>'0x'+n.toString(16).padStart(40,'0');
const cli=new URL('../scripts/review-time.mjs',import.meta.url);
const invoke=(...args)=>spawnSync(process.execPath,[cli.pathname,...args],{encoding:'utf8'});

test('Node CLI reserves and exports the same durable signed window, binds a job, and blocks policy rotation while booked',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-review-time-cli-'));
 try {
  const home=path.join(root,'node'),keys=path.join(root,'private-keys');
  assert.equal(invoke('keygen',keys).status,0);
  const publicKey=fs.readFileSync(path.join(keys,'reviewer-time-public.pem'),'utf8');
  const reviewers=Array.from({length:3},(_,i)=>({participantId:'reviewer'+(i+1),wallet:addr(i+3),controllerId:digest('controller'+i),failureDomain:'domain'+i,publicKey:i?crypto.generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'}):publicKey}));
  const policy={schema:'agi-review-time-policy/v1',chainId:1,manager:addr(99),employer:addr(1),fundingPolicySha256:digest('funding'),minimumReviewers:3,agentSeconds:60,reviewSeconds:300,challengeSeconds:60,reserveSeconds:60,reviewers};
  const store=new Store(home);store.set('admissionPolicy',{role:'reviewer',chainId:1,manager:policy.manager,wallet:reviewers[0].wallet});store.close();
  const file=path.join(root,'policy.json');fs.writeFileSync(file,JSON.stringify(policy));
  assert.equal(invoke('enroll',home,file).status,0);
  const now=Math.floor(Date.now()/1000),offerId=digest('offer');
  const request={offerId,specSha256:digest('spec'),fundingPolicySha256:policy.fundingPolicySha256,chainId:1,manager:policy.manager,employer:policy.employer,reviewerWallet:reviewers[0].wallet,participantId:reviewers[0].participantId,controllerId:reviewers[0].controllerId,failureDomain:reviewers[0].failureDomain,start:now+900,finish:now+1200,deadline:now+3000,validUntil:now+240};
  const requestFile=path.join(root,'request.json'),receiptFile=path.join(root,'receipt.json'),copyFile=path.join(root,'recovered.json');fs.writeFileSync(requestFile,JSON.stringify(request));
  assert.equal(invoke('reserve',home,reviewers[0].wallet,path.join(keys,'reviewer-time-private.pem'),requestFile,receiptFile).status,0);
  const receipt=JSON.parse(fs.readFileSync(receiptFile));verifyReceipt(receipt,policy);
  assert.equal(invoke('export',home,offerId,copyFile).status,0);
  assert.deepEqual(JSON.parse(fs.readFileSync(copyFile)),receipt);
  assert.equal(invoke('bind',home,offerId,'17').status,0);
  const changed={...policy,agentSeconds:61};fs.writeFileSync(file,JSON.stringify(changed));
  const rotation=invoke('enroll',home,file);assert.equal(rotation.status,1);assert.match(rotation.stderr,/REVIEW_TIME_OPEN_BOOKING/);
  const reopen=new Store(home);assert.equal(reopen.db.prepare('SELECT job FROM reviewer_time_bookings WHERE offer=?').get(offerId).job,'17');reopen.close();
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
