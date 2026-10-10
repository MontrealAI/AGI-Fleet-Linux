import {Funding} from './funding.mjs';
import fs from "node:fs";
import path from "node:path";
import { parseUnits, ZeroAddress } from "ethers";
import { ContentReader } from "../packages/AGI_Node/src/content.mjs";
import { AUTONOMY_DECLARATION } from "../packages/AGI_Node/src/autonomy.mjs";
import {
  ensure,
  now,
  same,
  json,
  canonical,
  sha256,
  errorCode,
  serviceError,
} from "./common.mjs";
import { binding, inShard } from "./config.mjs";
import { collectEvidence, assertProof } from "./evidence.mjs";
import { jobAction, requestFor, scoped } from "./policy.mjs";
import { Transactions } from "./transactions.mjs";
export class Engine {
  constructor(
    c,
    chain,
    store,
    pin,
    { signer = null, reader = null, reviewer = null } = {},
  ) {
    Object.assign(this, { c, chain, store, pin, reviewer });
    this.reader =
      reader ?? new ContentReader({ ...c, allowedHttpsHosts: c.contentHosts });
    this.binding = binding(c, pin);
    this.tx = new Transactions(c, chain, store, pin, signer, this.binding);
    this.funding = new Funding(c,chain,store,this.reader);
    this.tx.funding=this.funding;
    this.busy = false;
    const identity = {
      chain: c.chainId,
      manager: c.manager,
      wallet: c.wallet,
      role: c.role,
    };
    ensure(
      canonical(store.meta("identity", identity)) === canonical(identity),
      "STATE_IDENTITY_MISMATCH",
    );
    store.set("identity", identity);
  }
  halt() {
    this.halted = true;
    this.tx.halted = true;
  }
  async proof(row, s) {
    const cached = row.proof ? JSON.parse(row.proof) : null;
    if (
      cached &&
      cached.context === s.context &&
      cached.expires > now() &&
      cached.modelVeto === this.c.modelVeto
    ) {
      assertProof(this.c, s, cached);
      this.store.observeEvidence(row.id, s.context, cached.decision);
      return cached;
    }
    const proof = await collectEvidence(this.c, row, s, this.reader, {
      reviewer: this.reviewer,
    });
    this.store.putJob(row.id, { proof: json(proof) });
    this.store.observeEvidence(row.id, s.context, proof.decision);
    this.store.event("evidence-checked", {
      job: row.id,
      decision: proof.decision,
      hash: proof.hash,
    });
    return proof;
  }
  async authorized(row, action, proof, context) {
    const s = await this.chain.snapshot(row.id);
    ensure(s.context === context, "JOB_CHANGED_BEFORE_SIGNING");
    const latest = jobAction(this.c, s, row, proof);
    ensure(
      latest &&
        latest.action ===
          (action.action === "approve-dispute" ? "dispute" : action.action),
      "ACTION_NO_LONGER_ELIGIBLE",
    );
    if (["dispute", "approve-dispute"].includes(action.action)) {
      const bond = await this.chain.approvedDisputeBond(row.id);
      let open = 0n;
      for (const item of this.store.db
        .prepare(
          "SELECT DISTINCT t.job FROM txs t LEFT JOIN jobs j ON j.id=t.job WHERE t.action='dispute' AND t.status='confirmed' AND (j.status IS NULL OR j.status!='terminal')",
        )
        .all()) {
        const old = await this.chain.snapshot(item.job);
        if (!old.completed && !old.expired) open += old.disputeBond;
      }
      ensure(
        open + bond <= parseUnits(this.c.limits.maxOpenDisputeBondsUSDC, 6),
        "OPEN_DISPUTE_BOND_LIMIT",
      );
      ensure(
        (await this.chain.token.balanceOf(this.c.wallet)) >= bond,
        "INSUFFICIENT_USDC",
      );
    }
  }
  async claims(live) {
    const beneficiaries = this.c.claimBeneficiaries.filter((b) =>
      inShard(this.c, `claim:${b}`),
    );
    if (!beneficiaries.length || this.halted) return false;
    const paused = await this.chain.manager.settlementPaused();
    const start = this.store.meta("claimCursor", 0) % beneficiaries.length;
    for (
      let n = 0;
      n < Math.min(beneficiaries.length, this.c.maxClaimsPerCycle);
      n++
    ) {
      if (this.halted) return false;
      const index = (start + n) % beneficiaries.length,
        beneficiary = beneficiaries[index];
      this.store.set("claimCursor", (index + 1) % beneficiaries.length);
      const amount = await this.chain.manager.pendingUSDC(beneficiary);
      this.store.claim(beneficiary, amount);
      const row = this.store.db
        .prepare("SELECT * FROM claims WHERE beneficiary=?")
        .get(beneficiary);
      if (amount === 0n) continue;
      if (row.attempts >= this.c.limits.maxClaimAttempts) {
        this.store.exhaustClaim(beneficiary);
        continue;
      }
      if (
        paused ||
        !live ||
        this.halted ||
        this.c.role === "evidence" ||
        row.next_check > now()
      )
        continue;
      const action = { action: "claim", beneficiary },
        request = requestFor(this.chain, this.pin, action);
      try {
        await this.chain.provider.call({ ...request, from: this.c.wallet });
      } catch (error) {
        if (error?.code !== "CALL_EXCEPTION") throw error;
        // Contract pause and a concurrent successful claim are not failed recipients.
        if (await this.chain.manager.settlementPaused()) continue;
        const current = await this.chain.manager.pendingUSDC(beneficiary);
        this.store.claim(beneficiary, current);
        if (current === 0n) continue;
        this.store.claimAttempt(beneficiary, false);
        if (row.attempts + 1 >= this.c.limits.maxClaimAttempts) this.store.exhaustClaim(beneficiary);
        continue;
      }
      await this.tx.send(request, action, {
        beforeSign: async () => {
          ensure(
            !(await this.chain.manager.settlementPaused()),
            "SETTLEMENT_PAUSED",
          );
          ensure(
            (await this.chain.manager.pendingUSDC(beneficiary)) > 0n,
            "CLAIM_ALREADY_PAID",
          );
        },
      });
      return true;
    }
    return false;
  }
  async cycle({ live = false } = {}) {
    ensure(!this.busy, "CYCLE_BUSY");
    this.busy = true;
    try {
      await this.chain.verify(this.pin);
      for (const t of this.store.db
        .prepare(
          "SELECT block_number,block_hash FROM txs WHERE block_number IS NOT NULL ORDER BY nonce DESC LIMIT 100",
        )
        .all())
        ensure(
          (await this.chain.provider.getBlock(t.block_number))?.hash ===
            t.block_hash,
          "CONFIRMED_TRANSACTION_REORG",
        );
      if (this.store.pending()) {
        await this.tx.recover({ rebroadcast: live });
        return { status: "reconciling" };
      }
      const scan = await this.chain.scan(this.store);
      if (!scan.caughtUp) return { status: "catching-up", ...scan };
      await this.funding.reconcile();
      const active = live && !fs.existsSync(path.join(this.store.home, "STOP"));
      if (active) this.tx.active();
      const settlementPaused = await this.chain.manager.settlementPaused();
      if (settlementPaused) {
        await this.claims(false);
        return { status: "settlement-paused", ...scan };
      }
      const last = this.store.db
        .prepare("SELECT action FROM txs ORDER BY nonce DESC LIMIT 1")
        .get();
      const claimsFirst = last?.action !== "claim";
      if (claimsFirst && (await this.claims(active)))
        return { status: "claim-sent" };
      if(active){try{const a=await this.funding.reviews.next();if(a){await this.tx.send(requestFor(this.chain,this.pin,a),a,{beforeSign:()=>this.funding.beforeCommit(a)});return {status:a.action};}}catch(e){this.store.incident('service','review-funding',errorCode(e));}}
      for (const row of this.store.queue(this.c.maxJobsPerCycle)) {
        if (this.halted) break;
        try {
          const s = await this.chain.snapshot(row.id);
          if (s.completed || s.expired) {
            this.store.putJob(row.id, {
              status: "terminal",
              checked: now(),
              reason: "CLOSED",
            });
            continue;
          }
          scoped(this.c, s);
          if (this.c.role === "employer")
            ensure(same(s.buyer, this.c.wallet), "EMPLOYER_AUTHORITY_REQUIRED");
          if (this.c.role === "moderator" && s.disputed) {
            ensure(s.moderator, "MODERATOR_NOT_APPOINTED");
            ensure(
              ![s.buyer, s.agent].some(
                (a) =>
                  same(a, this.c.wallet) ||
                  this.c.excludedParties.some((b) => same(a, b)),
              ),
              "CONFLICT_OF_INTEREST",
            );
          }
          ensure(row.spec_uri === sha256(s.specURI), "JOB_SPEC_EVENT_MISMATCH");
          row.createdTime = (
            await this.chain.provider.getBlock(row.created)
          ).timestamp;
          let proof = null;
          if (
            ["moderator", "employer", "evidence"].includes(this.c.role) &&
            s.requested &&
            (this.c.role !== "moderator" || s.disputed)
          )
            proof = await this.proof(row, s);
          const action = jobAction(this.c, s, row, proof);
          const jobUpdate = {
            checked: now(),
            next_check: now() + this.c.pollSeconds,
            status: action ? "ready" : proof ? "evidence-ready" : "waiting",
            reason: action?.action ?? "WAITING_FOR_CONTRACT_STATE",
          };
          if (!active || !action || this.halted) {
            this.store.putJob(row.id, jobUpdate);
            continue;
          }
          let bond = 0n;
          if (action.action === "dispute") {
            bond = await this.chain.approvedDisputeBond(row.id);
            const allowance = await this.chain.token.allowance(
              this.c.wallet,
              this.c.manager,
            );
            ensure(
              allowance === 0n || allowance === bond,
              "EXISTING_ALLOWANCE_REQUIRES_REVIEW",
            );
            if (allowance === 0n) action.action = "approve-dispute";
          }
          const request = requestFor(this.chain, this.pin, action, bond);
          await this.tx.send(request, action, {
            bond,
            context: s.context,
            beforeSign: () => this.authorized(row, action, proof, s.context),
          });
          this.store.putJob(row.id, jobUpdate);
          return {
            status: "transaction-sent",
            job: row.id,
            action: action.action,
          };
        } catch (e) {
          const code = errorCode(e);
          this.store.putJob(row.id, {
            checked: now(),
            next_check: now() + Math.max(this.c.pollSeconds, 60),
            status:
              /^(BUYER_OUT_OF_SCOPE|WRONG_SHARD|JOB_VALUE_LIMIT|EMPLOYER_AUTHORITY_REQUIRED)$/.test(
                code,
              )
                ? "out-of-scope"
                : "blocked",
            reason: code,
          });
          if (row.status !== "blocked" || row.reason !== code)
            this.store.event("job-deferred", { job: row.id, code });
          if (this.store.pending() || serviceError(code)) throw e;
        }
      }
      if (!claimsFirst && (await this.claims(active)))
        return { status: "claim-sent" };
      if(active&&!this.halted) {
        const funding=await this.funding.next();
        if(funding) {
          const request=requestFor(this.chain,this.pin,funding);
          await this.tx.send(request,funding,{beforeSign:()=>this.funding.beforeCommit(funding)});
          return {status:'qualified-funding-sent',offer:funding.job};
        }
      }
      const status = this.halted ? "stopped" : active ? "running" : "observing";
      this.store.set("lastCycle", { time: now(), status, ...scan });
      return { status, ...scan };
    } finally {
      this.busy = false;
    }
  }
}
