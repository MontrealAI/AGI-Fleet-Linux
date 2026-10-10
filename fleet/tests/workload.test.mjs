import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../ops/store.mjs";
import { Controller } from "../ops/controller.mjs";
import { Engine } from "../ops/engine.mjs";
import { createServer } from "../ops/server.mjs";
import { workload, estimate, ROUTINE } from "../ops/workload.mjs";
import { health } from "../ops/health.mjs";
import { config, temp, addr, snap } from "./helpers.mjs";
import { sha256, now } from "../ops/common.mjs";
import { Interface } from "ethers";
import { ABI } from "../packages/AGI_Node/src/chain.mjs";
const assumptions = (coverage = 1, completion = 1) => Object.fromEntries(ROUTINE.map(k => [k, {coverage, completion}]));
function fixture() {
  const home = temp(), store = new Store(home);
  return {home, store, close() {store.close();fs.rmSync(home,{recursive:true,force:true});}};
}

test("historical labor arithmetic matches both scenarios without rounding intermediates", () => {
  const moderate = estimate("case3_moderate", assumptions());
  assert.equal(moderate.baselineMinutes, 361180);
  assert.equal(moderate.estimatedRemainingMinutes, 0);
  assert.equal(moderate.kind, "modeled-not-measured");
  const stress = estimate("case4_conservative", assumptions());
  assert.equal(stress.routineMinutes, 326740);
  assert.equal(stress.retainedMinutes, 4390);
  assert.equal(stress.baselineMinutes, 331130);
  assert.equal(stress.scenario.claimMicroUSDC, "287321034918");
  assert.equal(stress.scenario.unpaidBeneficiaries, 204);
  assert.equal(stress.scenario.openJobs, 0);
});
test("weighted coverage and successful completion both affect the model", () => {
  const a = assumptions(0.8, 0.9);
  a.additionalEvidenceRequest = {coverage:0,completion:1};
  const r = estimate("case4_conservative", a);
  assert.ok(Math.abs(r.potentiallyAvoidedMinutes - (326740 - 12660) * 0.72) < 1e-8);
  assert.equal(estimate("case4_conservative", assumptions(0,1)).estimatedRemainingMinutes,331130);
  assert.ok(Math.abs(estimate("case4_conservative", assumptions(1,.95)).estimatedRemainingMinutes - 20727) < 1e-8);
});
test("model rejects missing categories, extra keys and invalid fractions", () => {
  for (const value of [NaN, Infinity, -0.01, 1.01, "1", null]) {
    const a=assumptions();a.buyerAcceptance.coverage=value;
    assert.throws(()=>estimate("case3_moderate",a),/LABOR_ASSUMPTION_RANGE/);
  }
  assert.throws(()=>estimate("case3_moderate",{}),/LABOR_CATEGORIES/);
  assert.throws(()=>estimate("absent",assumptions()),/LABOR_SCENARIO/);
});
test("repeated deferrals retain one case and one opening event across restart", () => {
  const f=fixture();
  try {
    f.store.putJob("42",{created:1,details:"fixture",spec_uri:"hash",status:"blocked",reason:"OPENCLAW_ABSTENTION"});
    for(let i=0;i<20;i++) f.store.putJob("42",{status:"blocked",reason:"OPENCLAW_ABSTENTION"});
    assert.equal(f.store.incidents().length,1);
    assert.equal(f.store.incidents()[0].occurrences,21);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE kind='exception-opened'").get().n,1);
    f.store.close();f.store=new Store(f.home);
    assert.equal(f.store.stats().openExceptions,1);
    f.store.putJob("42",{status:"terminal"});
    assert.equal(f.store.stats().openExceptions,0);
    assert.equal(f.store.db.prepare("SELECT outcome FROM incidents").get().outcome,"JOB_CLOSED_PAYMENT_NOT_ASSERTED");
    f.store.putJob("42",{status:"blocked",reason:"PROOF_HASH"});
    assert.equal(f.store.stats().openExceptions,1);
  } finally {f.store.close();fs.rmSync(f.home,{recursive:true,force:true});}
});
test("all exceptions can be paged without relying on the recent jobs window", () => {
  const f=fixture();try {
    for(let i=0;i<217;i++)f.store.incident("job",String(i),"FORMAL_DECISION_UNAVAILABLE");
    let after="", seen=[];
    for (;;) {const page=f.store.incidents(50,after);if(!page.length)break;seen.push(...page.map(x=>x.key));after=page.at(-1).key;}
    assert.equal(new Set(seen).size,217);
    const report=workload(f.store);assert.equal(report.exceptions.totalOpen,217);assert.equal(report.exceptions.open.length,200);
    assert.throws(()=>f.store.incidents(201),/INCIDENT_LIMIT/);
  }finally{f.close();}
});
test("empty human logs never produce a measured savings claim", () => {
  const f=fixture();try {
    const r=workload(f.store);assert.equal(r.humanWork.minutesRecorded,0);assert.equal(r.humanWork.measuredSavingsHours,null);assert.equal(r.humanWork.completeness,"unknown-self-reported");
    f.store.observeEvidence("1","context","approve");f.store.observeEvidence("1","context","approve");f.store.observeEvidence("1","new-context","approve");
    assert.equal(workload(f.store).evidenceObservations[0].uniqueContexts,2);
  }finally{f.close();}
});
test("human time is idempotent, validated and auditable when corrected", () => {
  const f=fixture();try {
    const entry={id:crypto.randomUUID(),category:"maintenance",minutes:25,reference:"job:42"};
    f.store.recordHuman(entry);f.store.recordHuman(entry);
    assert.equal(workload(f.store).humanWork.minutesRecorded,25);
    assert.throws(()=>f.store.recordHuman({...entry,minutes:26}),/WORK_ID_CONFLICT/);
    for(const minutes of [0,-1,1.5,1441]) assert.throws(()=>f.store.recordHuman({...entry,id:crypto.randomUUID(),minutes}),/WORK_MINUTES/);
    assert.throws(()=>f.store.recordHuman({...entry,reference:"<script>"}),/WORK_REFERENCE/);
    f.store.voidHuman(entry.id);f.store.voidHuman(entry.id);
    assert.equal(workload(f.store).humanWork.minutesRecorded,0);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE kind='human-work-voided'").get().n,1);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM human_work").get().n,1);
  }finally{f.close();}
});
test("claim success does not assert zero pending, and amounts retain integer precision", () => {
  const f=fixture();try {
    const amount=900719925474099300001n;
    f.store.claim(addr(1),amount);f.store.claimAttempt(addr(1),false);f.store.exhaustClaim(addr(1));f.store.claimAttempt(addr(1),true);
    assert.equal(f.store.db.prepare("SELECT status FROM claims").get().status,"confirmed-awaiting-refresh");
    assert.equal(workload(f.store).claims.observedUnpaidMicroUSDC,String(amount));
    assert.equal(f.store.stats().openExceptions,1);
    f.store.claim(addr(1),1n);assert.equal(f.store.db.prepare("SELECT status FROM claims").get().status,"pending");
    f.store.claim(addr(1),0n);assert.equal(f.store.stats().openExceptions,0);assert.equal(f.store.stats().unpaidClaims,0);
    assert.equal(f.store.db.prepare("SELECT lifetime_attempts FROM claims").get().lifetime_attempts,2);
  }finally{f.close();}
});
test("v1.1 claim schema and existing blocked jobs migrate without losing history", () => {
  const home=temp(), old=new DatabaseSync(path.join(home,"service.sqlite"));
  old.exec("CREATE TABLE claims(beneficiary TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,next_check INTEGER NOT NULL DEFAULT 0,amount TEXT NOT NULL DEFAULT '0',status TEXT NOT NULL DEFAULT 'pending');");
  old.prepare("INSERT INTO claims VALUES(?,12,99,'500','retry-exhausted')").run(addr(1));old.close();
  const store=new Store(home);try {
    const row=store.db.prepare("SELECT * FROM claims").get();assert.equal(row.attempts,12);assert.equal(row.lifetime_attempts,12);assert.equal(row.next_check,99);assert.equal(row.checked,0);assert.equal(store.stats().openExceptions,1);
  }finally{store.close();fs.rmSync(home,{recursive:true,force:true});}
});

async function renewalFixture(role="recovery") {
  const home=temp(), c=new Controller(home,role);
  c.config=config(role,{claimBeneficiaries:[addr(1)]});c.pin={fixture:true};
  await c.unlock("test password for renewal");
  c.store.claim(addr(1),100n);
  for(let i=0;i<c.config.limits.maxClaimAttempts;i++)c.store.claimAttempt(addr(1),false);
  c.store.exhaustClaim(addr(1));
  let amount=100n, paused=false, verifies=0;
  c.openChain=async()=>({verify:async()=>{verifies++},manager:{settlementPaused:async()=>paused,pendingUSDC:async()=>amount}});
  return {c, home, body:{beneficiary:addr(1),reason:"operator-reviewed",confirm:true}, setAmount:n=>amount=n,setPause:v=>paused=v, verifies:()=>verifies, async close(){await c.close();fs.rmSync(home,{recursive:true,force:true});}};
}
test("operator renewal preserves lifetime attempts, STOP and authority without signing",async()=>{
  const f=await renewalFixture();try{
    f.c.pause();f.c.store.set("activation",{fixture:"unchanged"});
    const r=await f.c.renewClaim(f.body);assert.equal(r.outcome,"retry-allowance-renewed");
    const row=f.c.store.db.prepare("SELECT * FROM claims").get();assert.equal(row.attempts,0);assert.equal(row.lifetime_attempts,f.c.config.limits.maxClaimAttempts);assert.equal(row.retry_round,1);
    assert.equal(f.c.store.stats().openExceptions,1);assert.equal(f.c.store.stats().confirmed,0);assert.equal(f.c.store.pending(),undefined);assert.ok(fs.existsSync(path.join(f.home,"STOP")));assert.deepEqual(f.c.store.meta("activation"),{fixture:"unchanged"});assert.equal(f.verifies(),1);
    await assert.rejects(f.c.renewClaim(f.body),/CLAIM_NOT_EXHAUSTED/);
  }finally{await f.close();}
});
test("renewal refuses running, locked, paused-contract, unconfirmed or foreign-beneficiary requests",async()=>{
  const f=await renewalFixture();try{
    f.c.running=true;await assert.rejects(f.c.renewClaim(f.body),/STOP_AND_UNLOCK_FIRST/);f.c.running=false;
    await assert.rejects(f.c.renewClaim({...f.body,confirm:false}),/CLAIM_REVIEW_REQUIRED/);
    await assert.rejects(f.c.renewClaim({...f.body,beneficiary:addr(2)}),/CLAIM_BENEFICIARY_SCOPE/);
    f.setPause(true);await assert.rejects(f.c.renewClaim(f.body),/SETTLEMENT_PAUSED/);assert.equal(f.c.busy,false);
    f.c.vault.lock();await assert.rejects(f.c.renewClaim(f.body),/STOP_AND_UNLOCK_FIRST/);
    assert.equal(f.c.store.db.prepare("SELECT attempts FROM claims").get().attempts,f.c.config.limits.maxClaimAttempts);
  }finally{await f.close();}
});
test("concurrently paid claim clears without allocating another retry round",async()=>{
  const f=await renewalFixture();try{f.setAmount(0n);assert.equal((await f.c.renewClaim(f.body)).outcome,"already-paid");assert.equal(f.c.store.stats().openExceptions,0);assert.equal(f.c.store.db.prepare("SELECT retry_round FROM claims").get().retry_round,0);}finally{await f.close();}
});
test("evidence role cannot renew claims",async()=>{
  const f=await renewalFixture("evidence");try{await assert.rejects(f.c.renewClaim(f.body),/READ_ONLY_ROLE/);}finally{await f.close();}
});
test("live repeated signing deferral does not clear and reopen an unchanged exception",async()=>{
  const f=fixture();try{
    const c=config("recovery"),state=snap({neutralRefundAfter:1n});
    f.store.putJob("0",{created:1,details:"fixture",spec_uri:sha256(state.specURI)});
    const chain={c,iface:new Interface(ABI),verify:async()=>{},scan:async()=>({caughtUp:true}),snapshot:async()=>state,manager:{settlementPaused:async()=>false},provider:{getBlock:async()=>({timestamp:now()})}};
    const engine=new Engine(c,chain,f.store,{}, {reader:{}});engine.tx.active=()=>{};engine.tx.send=async()=>{throw Error("GAS_DAILY_LIMIT")};
    for(let i=0;i<3;i++){f.store.db.exec("UPDATE jobs SET next_check=0");await assert.rejects(engine.cycle({live:true}),/GAS_DAILY_LIMIT/);}
    assert.equal(f.store.incidents()[0].occurrences,3);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE kind='exception-opened'").get().n,1);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE kind='exception-cleared'").get().n,0);
  }finally{f.close();}
});
test("workload and mutation routes reject monitoring credentials; human log requires unlocked vault",async()=>{
  const home=temp(),c=new Controller(home,"evidence"),p=await createServer(c);
  try{
    const monitor=JSON.parse(fs.readFileSync(path.join(home,"monitor-access.json")));
    for(const [route,method] of [["workload","GET"],["human-work","POST"],["renew-claim","POST"],["exceptions","POST"]]) {
      const r=await fetch(p.origin+"/api/"+route,{method,headers:{Authorization:"Bearer "+monitor.token,Origin:p.origin,"Content-Type":"application/json"},...(method==="POST"?{body:"{}"}:{})});assert.equal(r.status,403);
    }
    const headers={Authorization:"Bearer "+p.token,Origin:p.origin,"Content-Type":"application/json"};
    const r=await fetch(p.origin+"/api/human-work",{method:"POST",headers,body:JSON.stringify({id:crypto.randomUUID(),category:"maintenance",minutes:5})});assert.equal((await r.json()).error,"VAULT_LOCKED");
    const report=await(await fetch(p.origin+"/api/workload",{headers})).json();assert.equal(report.humanWork.measuredSavingsHours,null);
    c.store.incident("service","runtime","STORAGE_LIMIT");assert.ok(health(c.snapshot()).issues.includes("OPEN_EXCEPTIONS"));
  }finally{await c.close();await new Promise(r=>p.server.close(r));fs.rmSync(home,{recursive:true,force:true});}
});
test("encrypted backup restores exception history and time logs with signing paused",async()=>{
  const a=temp(),b=temp(),source=new Controller(a,"recovery"),restored=new Controller(b,"recovery");
  try{
    await source.unlock("backup test vault password");source.config=config("recovery",{claimBeneficiaries:[addr(1)]});
    source.store.claim(addr(1),99n);source.store.claimAttempt(addr(1),false);source.store.exhaustClaim(addr(1));
    source.recordHuman({id:crypto.randomUUID(),category:"incident",minutes:12,reference:"claim:"+addr(1)});
    const backup=await source.backup("backup test vault password");
    await restored.restore(backup,"backup test vault password");
    const report=restored.workload();assert.equal(report.humanWork.minutesRecorded,12);assert.equal(report.exceptions.totalOpen,1);assert.equal(report.claims.beneficiaries[0].lifetime_attempts,1);
    assert.ok(restored.snapshot().paused);assert.equal(restored.store.meta("activation"),null);assert.equal(restored.store.meta("autostart"),null);
  }finally{await source.close();await restored.close();fs.rmSync(a,{recursive:true,force:true});fs.rmSync(b,{recursive:true,force:true});}
});
