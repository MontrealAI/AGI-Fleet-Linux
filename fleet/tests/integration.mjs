import {localEvidence} from './local-evidence.mjs';
import {fixture as fundingFixture} from './funding-fixture.mjs';
import {requestFor} from '../ops/policy.mjs';
import {sha256} from '../ops/common.mjs';
import {formatUnits} from 'ethers';
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import hre from "hardhat";
import {
  BrowserProvider,
  ContractFactory,
  HDNodeWallet,
  ZeroAddress,
  ZeroHash,
  parseUnits,
} from "ethers";
import { artifacts } from "../packages/AGI_Node/src/chain.mjs";
import { ContentReader, rawCID } from "../packages/AGI_Node/src/content.mjs";
import { AUTONOMY_DECLARATION } from "../packages/AGI_Node/src/autonomy.mjs";
import { dualFixture } from "../packages/AGI_Node/tests/dual-rpc-fixture.mjs";
import { config, spec, temp } from "./helpers.mjs";
import { Chain } from "../ops/chain.mjs";
import { Store } from "../ops/store.mjs";
import { ReviewerTimeLedger } from "../workforce/review-time.mjs";
import crypto from "node:crypto";
import { Engine } from "../ops/engine.mjs";
import { Controller } from "../ops/controller.mjs";
import { workload } from "../ops/workload.mjs";
import { binding } from "../ops/config.mjs";
import { now, canonical, json } from "../ops/common.mjs";
const connection = await hre.network.connect("hardhat");
const provider = new BrowserProvider(connection.provider, undefined, {
  cacheTimeout: -1,
});
provider.pollingInterval = 10;
const wallets = Array.from({ length: 12 }, (_, i) =>
  HDNodeWallet.fromPhrase(
    "test test test test test test test test test test test junk",
    undefined,
    `m/44'/60'/0'/0/${i}`,
  ).connect(provider),
);
const [owner, buyer, agent, v0, v1, v2, moderator, keeper, fee30, fee10] =
  wallets;
const root = temp(),
  addresses = {},
  services = [],
  results = [],
  bytesByCID = new Map();
let dual, manager, token;
const realNow = Date.now;
const mined = async (p) => (await p).wait();
async function advance(t) {
  await provider.send("evm_setNextBlockTimestamp", [Number(t)]);
  await provider.send("evm_mine", []);
  await syncClock();
}
async function syncClock() {
  const t = (await provider.getBlock("latest")).timestamp;
  Date.now = () => t * 1000;
}
function put(bytes) {
  bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const cid = rawCID(bytes);
  bytesByCID.set(cid, bytes);
  return "ipfs://" + cid;
}
async function deploy(name, args = []) {
  const a =
    artifacts[name] ??
    JSON.parse(
      fs.readFileSync(
        new URL(
          `../packages/AGI_Node/contract/artifacts/${name}.json`,
          import.meta.url,
        ),
      ),
    );
  let code = a.bytecode;
  for (const libs of Object.values(a.linkReferences))
    for (const [lib, refs] of Object.entries(libs)) {
      if (!addresses[lib]) await deploy(lib);
      for (const r of refs)
        code =
          code.slice(0, 2 + r.start * 2) +
          addresses[lib].slice(2).toLowerCase() +
          code.slice(2 + (r.start + r.length) * 2);
    }
  const c = await new ContractFactory(a.abi, code, owner).deploy(...args);
  await c.waitForDeployment();
  addresses[name] = await c.getAddress();
  return c;
}
async function state() {
  const reserves = {};
  for (const k of [
    "lockedEscrow",
    "lockedAgentBonds",
    "lockedValidatorBonds",
    "lockedDisputeBonds",
    "lockedClaims",
  ])
    reserves[k] = String(await manager[k]());
  const balance = await token.balanceOf(addresses.AGIJobManager);
  assert.equal(
    balance,
    Object.values(reserves).reduce((s, v) => s + BigInt(v), 0n),
  );
  return { reserves, balance: String(balance) };
}
async function service(role, wallet) {
  const home = path.join(root, role),
    c = config(role, {
      manager: addresses.AGIJobManager,
      wallet: wallet.address,
      deploymentBlock: (await manager.deploymentTransaction().wait())
        .blockNumber,
      trustedBuyers: [buyer.address],
      claimBeneficiaries: [buyer, agent, fee30, fee10].map((w) => w.address),
      maxJobsPerCycle: 100,
      pollSeconds: 5,
      cancelAfterSeconds: 3600,
      limits: {
        ...config().limits,
        maxTransactions24h: 1000,
        maxGas24hETH: "1",
        maxTxETH: "0.1",
        maxFeeGwei: "100",
        maxPriorityGwei: "1",
        maxClaimAttempts: role === "recovery" ? 2 : config().limits.maxClaimAttempts,
      },
    }),
    chain = new Chain(c, dual.provider),
    store = new Store(home),
    pin = await chain.enroll();
  store.set("initialNonce", await provider.getTransactionCount(wallet.address));
  store.set("activation", {
    binding: binding(c, pin),
    wallet: wallet.address,
    expires: now() + 90 * 86400,
  });
  const reader = new ContentReader(c, async (url) => {
    const cid = new URL(url).pathname.split("/").at(-1);
    assert.ok(bytesByCID.has(cid), "fixture content unavailable");
    return bytesByCID.get(cid);
  });
  const engine = new Engine(c, chain, store, pin, { signer: wallet, reader });
  const item = { role, c, chain, store, pin, engine };
  services.push(item);
  return item;
}
async function cycles(s, count = 30) {
  for (let n = 0; n < count; n++) {
    await syncClock();
    s.store.db.prepare("UPDATE jobs SET next_check=0").run();
    const outcome = await s.engine.cycle({ live: true });
    await state();
    if (outcome.status === "running" && !s.store.pending() && n > 3) {
      const ready = s.store.db
        .prepare("SELECT COUNT(*) n FROM jobs WHERE status='ready'")
        .get().n;
      if (!ready) break;
    }
  }
}
try {
  assert.equal((await provider.getNetwork()).chainId, 31337n);
  token = await deploy("FailingERC20");
  manager = await deploy("AGIJobManager", [
    addresses.FailingERC20,
    "ipfs://",
    [ZeroAddress, ZeroAddress],
    [ZeroHash, ZeroHash, ZeroHash, ZeroHash],
    [ZeroHash, ZeroHash],
    [fee30.address, fee10.address],
  ]);
  await mined(manager.setMaxActiveJobsPerAgent(32));
  await mined(manager.addAdditionalAgent(agent.address));
  for (const w of [v0, v1, v2])
    await mined(manager.addAdditionalValidator(w.address));
  await mined(manager.addModerator(moderator.address));
  await mined(manager.unpauseIntake());
  for (const w of [buyer, agent, v0, v1, v2]) {
    await mined(token.mint(w.address, parseUnits("10000", 6)));
    await mined(
      token.connect(w).approve(addresses.AGIJobManager, parseUnits("10000", 6)),
    );
  }
  const envelope = {
    ...structuredClone(spec),
    resolution: { ...spec.resolution, moderators: [moderator.address] },
  };
  const specURI = put(canonical(envelope)),
    good = put('{"answer":42}'),
    bad = put('{"answer":0}'),
    missing = "ipfs://" + rawCID(Buffer.from("unavailable"));
  const ids = {};
  async function job(
    name,
    { delivery = good, disputed = false, assign = true, legacy = false } = {},
  ) {
    const id = String(await manager.nextJobId());
    await mined(
      manager
        .connect(buyer)
        .createJob(
          specURI,
          parseUnits("100", 6),
          259200,
          legacy
            ? "Legacy job without automation commitment"
            : AUTONOMY_DECLARATION,
        ),
    );
    if (assign) await mined(manager.connect(agent).applyForJob(id, "", []));
    if (delivery && assign)
      await mined(manager.connect(agent).requestJobCompletion(id, delivery));
    if (disputed) await mined(manager.connect(buyer).disputeJob(id));
    ids[name] = id;
  }
  await job("accept");
  await job("bad-delivery", { delivery: bad });
  await job("moderator-agent-win", { disputed: true });
  await job("moderator-buyer-win", { delivery: bad, disputed: true });
  await job("expire", { delivery: null });
  await job("cancel", { assign: false, delivery: null });
  await job("neutral", { disputed: true, legacy: true });
  await job("missing", { delivery: missing });
  await job("failed-payment");
  // Revoke fixture posting allowance. The employer service must approve only the exact dispute bond.
  await mined(token.connect(buyer).approve(addresses.AGIJobManager, 0));
  await syncClock();
  dual = await dualFixture(connection.provider, root);
  const emp = await service("employer", buyer),
    mod = await service("moderator", moderator),
    rec = await service("recovery", keeper);
  // Frozen evidence collection runs separately and owns no signing key.
  const ev = await service("evidence", wallets[11]);
  await ev.engine.cycle({ live: false });
  assert.ok(ev.store.stats().evidence > 0);
  assert.equal(ev.store.stats().confirmed, 0);
  results.push({ case: "read-only-evidence-service", passed: true });
  await mined(token.setFailTransfers(true));
  await cycles(emp, 40);
  assert.ok((await manager.getJobCore(ids.accept)).completed);
  assert.ok((await manager.getJobCore(ids["bad-delivery"])).disputed);
  assert.ok((await manager.lockedClaims()) > 0n);
  assert.equal(
    await token.allowance(buyer.address, addresses.AGIJobManager),
    0n,
  );
  results.push({
    case: "employer-accept-dispute-exact-bond-protected-claims",
    passed: true,
  });
  const protectedClaims = await manager.lockedClaims();
  await mined(manager.setSettlementPaused(true));
  await cycles(rec, 3);
  assert.equal(await manager.lockedClaims(), protectedClaims);
  assert.equal(
    rec.store.db.prepare("SELECT COALESCE(SUM(attempts),0) n FROM claims").get()
      .n,
    0,
  );
  assert.ok(rec.store.stats().unpaidClaims > 0);
  await mined(manager.setSettlementPaused(false));
  results.push({
    case: "paused-protected-claims-preserve-retry-budget",
    passed: true,
  });
  for (let i=0;i<2;i++) {
    rec.store.db.exec("UPDATE claims SET next_check=0");
    await rec.engine.claims(true);
  }
  const exhausted = rec.store.db.prepare("SELECT * FROM claims WHERE status='retry-exhausted'").all();
  assert.ok(exhausted.length>0);
  assert.ok(exhausted.every(c=>c.attempts===2 && c.lifetime_attempts===2));
  await mined(token.setFailTransfers(false));
  const renewal = new Controller(rec.store.home, "recovery");
  try {
    renewal.config=rec.c;renewal.pin=rec.pin;
    await renewal.unlock("integration-only renewal password");
    renewal.openChain=async()=>rec.chain;
    for(const c of exhausted) await renewal.renewClaim({beneficiary:c.beneficiary,reason:"token-restriction-cleared",confirm:true});
    assert.ok(rec.store.db.prepare("SELECT * FROM claims WHERE amount!='0'").all().every(c=>c.attempts===0 && c.retry_round===1 && c.lifetime_attempts===2));
    assert.equal(rec.store.pending(),undefined);
  } finally {await renewal.close();}
  results.push({case:"actual-reverted-preflight-exhaustion-and-reviewed-bounded-renewal",passed:true,beneficiaries:exhausted.length});
  await cycles(mod, 40);
  assert.ok((await manager.getJobCore(ids["moderator-agent-win"])).completed);
  assert.ok((await manager.getJobCore(ids["moderator-buyer-win"])).completed);
  assert.ok((await manager.getJobCore(ids["bad-delivery"])).completed);
  results.push({
    case: "actual-formal-moderator-agent-and-buyer-rulings",
    passed: true,
  });
  await cycles(rec, 30);
  assert.equal(await manager.lockedClaims(), 0n);
  await rec.engine.claims(false);
  assert.equal(workload(rec.store).claims.observedUnpaidMicroUSDC,"0");
  assert.equal(workload(rec.store).humanWork.measuredSavingsHours,null);
  results.push({ case: "original-beneficiary-claim-recovery", passed: true });
  const d = await manager.getJobDeadlines(ids.expire);
  await advance(d.assignmentDeadline + 1n);
  await cycles(emp, 10);
  await cycles(rec, 20);
  assert.ok((await manager.getJobCore(ids.expire)).expired);
  await assert.rejects(manager.getJobCore(ids.cancel));
  results.push({
    case: "assignment-expiry-and-employer-cancellation",
    passed: true,
  });
  let m = await manager.getJobDeadlines(ids.missing);
  await advance(m.settlementAfter + 1n);
  await cycles(rec, 15);
  assert.ok((await manager.getJobCore(ids.missing)).disputed);
  await cycles(mod, 10);
  assert.ok(
    (await manager.getJobCore(ids.missing)).disputed,
    "missing evidence must not be ruled against either party",
  );
  results.push({
    case: "missing-evidence-abstains-and-enters-contract-recovery",
    passed: true,
  });
  const before = await manager.getJobDeadlines(ids.missing);
  await mined(manager.setSettlementPaused(true));
  await advance(BigInt(now()) + 86400n);
  await cycles(rec, 5);
  assert.ok((await manager.getJobCore(ids.missing)).disputed);
  await mined(manager.setSettlementPaused(false));
  const after = await manager.getJobDeadlines(ids.missing);
  assert.ok(after.neutralRefundAfter > before.neutralRefundAfter);
  await advance(after.neutralRefundAfter + 1n);
  await cycles(rec, 25);
  for (const id of Object.values(ids)) {
    if (id === ids.cancel) continue;
    const s = await manager.getJobCore(id);
    assert.ok(s.completed || s.expired, `open ${id}`);
  }
  // Execute qualified funding through the actual private signer journal and manager.
  // Only the pre-funding observation adapter is injected for this mock-token chain.
  await syncClock();
  const fx=fundingFixture('operator-budget'),fp=fx.envelope.payload;
  fx.policy.chainId=31337;fx.policy.manager=addresses.AGIJobManager.toLowerCase();fx.policy.wallet=buyer.address.toLowerCase();
  fx.policy.maxGasWeiPerJob='1000000000000000000';fp.gasBudgetWei='500000000000000000';fp.ethPriceCeilingUSDC='1';
  for(const value of Object.values(fx.policy.limits)){value.minimumExpectedNetUSDC='0';value.maximumScenarioLossUSDC='10000';}
  fp.identities.employer.wallet=buyer.address.toLowerCase();fp.identities.agent.wallet=agent.address.toLowerCase();
  fp.specURI=specURI;fp.specSha256=sha256(Buffer.from(canonical(envelope)));fp.commitment.details=AUTONOMY_DECLARATION;
  fp.issuedAt=now()-1;fp.expiresAt=now()+500;fp.capacity.expiresAt=now()+600;fp.evidence.measuredAt=now()-100;
  const price=parseUnits('1000',6),duration=3600n;fp.commitment.durationSeconds=String(duration);
  let ab=price*await manager.agentBondBps()/10000n;const amin=await manager.agentBond(),amax=await manager.agentBondMax(),limit=await manager.jobDurationLimit();
  if(ab<amin)ab=amin;if(limit)ab+=ab*duration/limit;if(amax&&ab>amax)ab=amax;if(ab>price)ab=price;
  let vb=price*await manager.validatorBondBps()/10000n;const vmin=await manager.validatorBondMin(),vmax=await manager.validatorBondMax();if(vb<vmin)vb=vmin;if(vb>vmax)vb=vmax;if(vb>price)vb=price;
  fp.lifecycle.terms={jobCostUSDC:'1000',agentBondUSDC:formatUnits(ab,6),reviewerBondUSDC:formatUnits(vb,6),rewardPercentage:Number(await manager.validationRewardPercentage()),slashBps:Number(await manager.validatorSlashBps())};
  const calibrated=localEvidence(fp.lifecycle,now()-100);fp.evidence.measuredAt=now()-100;
  const fh=emp.store.home;fs.mkdirSync(path.join(fh,'funding/inbox'),{recursive:true});fs.mkdirSync(path.join(fh,'funding/evidence'),{recursive:true});
  for(const [o,k] of [[fp.evidence,'reportSha256'],[fp.valueEvidence,'baselineSha256'],[fp.valueEvidence,'outcomesSha256']]){const bytes=Buffer.from(k==='reportSha256'?calibrated:'Synthetic local funding fixture '+k);o[k]=sha256(bytes);fs.writeFileSync(path.join(fh,'funding/evidence',o[k]+'.json'),bytes);}
  fx.resign();fs.writeFileSync(path.join(fh,'funding/inbox',fp.offerId+'.json'),JSON.stringify(fx.envelope));emp.store.set('fundingPolicy',fx.policy);
  const reviewerKeys=fp.lifecycle.participants.filter(p=>p.role==='reviewer').map(()=>crypto.generateKeyPairSync('ed25519'));
  const reviewerEntries=fp.lifecycle.participants.filter(p=>p.role==='reviewer').map((p,i)=>({participantId:p.id,wallet:fp.identities[p.id].wallet,controllerId:fp.identities[p.id].controllerId,failureDomain:'fixture-domain-'+i,publicKey:reviewerKeys[i].publicKey.export({format:'pem',type:'spki'})}));
  const timePolicy={schema:'agi-review-time-policy/v1',chainId:31337,manager:fx.policy.manager,employer:fx.policy.wallet,fundingPolicySha256:fp.policyDigest,minimumReviewers:3,agentSeconds:60,reviewSeconds:300,challengeSeconds:60,reserveSeconds:60,reviewers:reviewerEntries};
  emp.store.set('reviewTimePolicy',timePolicy);
  const receipts=reviewerEntries.map((reviewer,i)=>{
    const journal=new Store(path.join(root,'reviewer-time-'+i));
    try {
      const t=now();return new ReviewerTimeLedger(journal,timePolicy,{time:()=>t}).issue({offerId:fp.offerId,specSha256:fp.specSha256,fundingPolicySha256:fp.policyDigest,chainId:31337,manager:fx.policy.manager,employer:fx.policy.wallet,reviewerWallet:reviewer.wallet,participantId:reviewer.participantId,controllerId:reviewer.controllerId,failureDomain:reviewer.failureDomain,start:t+900,finish:t+1200,deadline:t+3000,validUntil:t+300},reviewerKeys[i].privateKey,reviewer.wallet);
    } finally {journal.close();}
  });
  fs.mkdirSync(path.join(fh,'funding/review-windows'));fs.writeFileSync(path.join(fh,'funding/review-windows',fp.offerId+'.json'),JSON.stringify(receipts));
  emp.engine.funding.readState=async()=>({block:{timestamp:now()},terms:fp.lifecycle.terms,paused:await manager.paused(),settlementPaused:await manager.settlementPaused(),pendingUSDC:String(await manager.pendingUSDC(buyer.address)),balanceUSDC:formatUnits(await token.balanceOf(buyer.address),6),allowanceUSDC:formatUnits(await token.allowance(buyer.address,addresses.AGIJobManager),6).replace(/\.0+$/,'')});
  const nextBefore=await manager.nextJobId();
  for(const expected of ['approve-funding','fund']) {
    await syncClock();await emp.engine.funding.check(fp.offerId);const a=await emp.engine.funding.next();assert.equal(a.action,expected);
    await emp.engine.tx.send(requestFor(emp.chain,emp.pin,a),a,{beforeSign:()=>emp.engine.funding.beforeCommit(a)});
    await provider.send('evm_mine',[]);await syncClock();await emp.engine.tx.recover();assert.ok(!emp.store.pending());
  }
  const fr=emp.store.db.prepare('SELECT * FROM funding_reservations').get();assert.equal(fr.job,String(nextBefore));assert.equal((await manager.getJobCore(fr.job)).payout,price);
  assert.equal(await token.allowance(buyer.address,addresses.AGIJobManager),0n);assert.equal(await emp.engine.funding.next(),null);
  results.push({case:'qualified-employer-exact-approval-funding-receipt-no-duplicate',passed:true,realContract:true,quoteAdapter:'injected mock-token observation; canonical/native-USDC adapter tested separately'});
  await advance(BigInt(now())+3601n);await cycles(emp,12);await assert.rejects(manager.getJobCore(fr.job));
  assert.equal(emp.store.db.prepare('SELECT closed FROM funding_reservations').get().closed,0);
  assert.ok(emp.store.meta('fundingTerminal:'+fr.job));
  results.push({case:'funded-job-cancellation-retains-reservation-until-native-canonical-proof',passed:true});
  const final = await state();
  assert.equal(final.balance, "0");
  results.push({
    case: "pause-adjusted-neutral-refunds-zero-remaining-local-liabilities",
    passed: true,
    final,
  });
  const report = {
    passed: true,
    runtime: process.version,
    source: "AGIJobManager v1.1.0 exact bundled artifacts",
    chainId: 31337,
    dualTransport: true,
    independentPublicRPC: false,
    mockUSDC: true,
    fixtureMaxActiveJobsPerAgent: 32,
    liveMacTested: false,
    liveModelTested: false,
    results,
    transactions: services.flatMap((s) =>
      s.store.db
        .prepare(
          "SELECT hash,nonce,action,job,beneficiary,gas_budget,status,block_number,block_hash,receipt FROM txs",
        )
        .all()
        .map((t) => ({ role: s.role, ...t })),
    ),
    jobs: ids,
    limitations:
      "Actual service policies, verifiers, signer journal and unchanged contracts executed locally. Accelerated time; synthetic public job inputs; mock USDC; two transports to one local chain. No live model judgment, Apple hardware, independent commercial operators or production capacity claim.",
  };
  fs.writeFileSync(
    new URL("../evidence/service-integration.json", import.meta.url),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    json({
      passed: true,
      cases: results.length,
      transactions: report.transactions.length,
      final,
    }),
  );
} catch (e) {
  console.error(e);
  for (const s of services)
    console.error(
      s.role,
      s.store.db.prepare("SELECT id,status,reason FROM jobs").all(),
    );
  throw e;
} finally {
  Date.now = realNow;
  for (const s of services) s.store.close();
  if (dual) await dual.close();
  provider.destroy();
  await connection.close();
  fs.rmSync(root, { recursive: true, force: true });
}
