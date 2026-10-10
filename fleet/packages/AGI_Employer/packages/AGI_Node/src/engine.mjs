import timing from './admission-core/economics/execution-window.cjs';
import {checkGeneralSettlement} from './general-artifacts.mjs';
import {createExecutionAdmission} from './public-web-admission.mjs';
import fs from "node:fs";
import path from "node:path";
import { parseUnits } from "ethers";
import { ensure, pool, encode, codeOf, sha256, atomicWrite } from "./util.mjs";
import { binding } from "./config.mjs";
import { ContentReader } from "./content.mjs";
import { reviewJob } from "./review.mjs";
import { Transactions } from "./transactions.mjs";
export class Engine {
  constructor(
    c,
    chain,
    store,
    pin,
    { live = false, signer = null, reader = null, cloudReviewer = null } = {},
  ) {
    Object.assign(this, { c, chain, store, pin, live });
    this.reader = reader ?? new ContentReader(c);
    this.cloudReviewer = cloudReviewer;
    this.binding = binding(c, pin);
    this.tx = new Transactions(c, chain, store, signer, pin, this.binding);
    const identity = {
      chainId: c.chainId,
      manager: c.manager.toLowerCase(),
      validator: c.validator.toLowerCase(),
      deploymentBlock: c.deploymentBlock,
    };
    ensure(
      encode(store.meta("identity", identity)) === encode(identity),
      "STATE_BELONGS_TO_ANOTHER_DEPLOYMENT_OR_WALLET",
    );
    store.set("identity", identity);
    this.busy = false;
  }
  runtime(status, extra = {}) {
    this.store.set("runtime", {
      status,
      mode: this.live ? "LIVE" : "OBSERVE",
      chainId: this.c.chainId,
      manager: this.c.manager,
      validator: this.c.validator,
      updated: new Date().toISOString(),
      ...extra,
    });
  }
  async exposure() {
    let sum = await this.chain.manager.pendingUSDC(this.c.validator),
      count = 0;
    for (const row of this.store.ownJobs()) {
      const s = await this.chain.snapshot(row.id);
      if (s.completed || s.expired) {
        this.store.putJob(row.id, { status: "terminal", bond: "0" });
        continue;
      }
      count++;
      sum += s.bond;
      this.store.putJob(row.id, { bond: s.bond.toString() });
    }
    return { amount: sum, count };
  }
  risk(s, exposure) {
    if (s.payout > parseUnits(this.c.limits.maxJobUSDC, 6))
      return "JOB_VALUE_LIMIT";
    if (s.bond > parseUnits(this.c.limits.maxBondUSDC, 6)) return "BOND_LIMIT";
    if (exposure.amount + s.bond > parseUnits(this.c.limits.maxOpenBondUSDC, 6))
      return "OPEN_BOND_LIMIT";
    if (exposure.count >= 100) return "OPEN_JOB_LIMIT_100";
    if (s.slash > BigInt(this.c.limits.maxSlashBps))
      return "SLASH_POLICY_LIMIT";
    return null;
  }
  async cycle() {
    ensure(!this.busy, "CYCLE_ALREADY_RUNNING");
    this.busy = true;
    try {
      await this.chain.verify(this.pin);
      for (const t of this.store.confirmed()) {
        const b = await this.chain.provider.getBlock(t.block_number);
        ensure(b?.hash === t.block_hash, "CONFIRMED_TRANSACTION_REORG");
      }
      if (this.store.pending()) {
        await this.tx.recover({ rebroadcast: this.live });
        this.runtime("transaction-pending", {
          message: "Waiting for the recorded transaction or its confirmations.",
        });
        return;
      }
      const scan = await this.chain.scan(this.store);
      if(scan.caughtUp)await this.tx.admission.reconcile();
      if (!scan.caughtUp) {
        this.runtime("catching-up", scan);
        return;
      }
      const exposure = await this.exposure(),
        now = Math.floor(Date.now() / 1000);
      const queue = this.store.queue(this.c.maxReviewsPerCycle, now);
      if(this.live&&!fs.existsSync(path.join(this.c.dataDir,'STOP'))&&this.tx.reviewProtection.enabled()) {
        try {const action=await this.tx.reviewProtection.next(queue);if(action){await this.tx.send(this.tx.reviewProtection.request(action.kind,action.job),action);this.runtime(action.kind);return;}}
        catch(e){this.store.set('reviewProtectionServiceError',{at:now,code:codeOf(e)});}
      }
      await pool(queue, this.c.reviewConcurrency, async (row) => {
        try {
          const s = await this.chain.snapshot(row.id);
          ensure(row.spec_uri === sha256(s.specURI), "JOB_SPEC_EVENT_MISMATCH");
          const blocked = this.chain.eligible(s) ?? this.risk(s, exposure);
          if (blocked) {
            this.store.putJob(row.id, {
              status: blocked === "JOB_TERMINAL" ? "terminal" : "abstained",
              reason: blocked,
              next_review: now + this.c.retrySeconds,
            });
            return;
          }
          if(this.tx.reviewProtection.enabled()){ensure(this.live&&!fs.existsSync(path.join(this.c.dataDir,'STOP')),'PROTECTED_REVIEW_REQUIRES_ACTIVE_WORKER');this.tx.assertActive();await this.tx.reviewProtection.consume(row.id,s);}
          const result = await reviewJob(
            row,
            s,
            this.reader,
            this.c.ai,
            this.cloudReviewer,
            this.live ? async ({specification,specHash,deliveryHash,decision})=>{
              checkGeneralSettlement(specification,this.c);
              if(specification.profile==='computer-work/v2')timing.checkExecutionWindow(specification,'reviewer',{now:Math.floor(Date.now()/1000),closeAt:Number(s.reviewEnd),reserveSeconds:Math.max(30,this.c.minReviewSeconds)});
              await this.tx.admission.check(row.id,specHash,{commitment:{action:'vote',decision,completionURI:s.completionURI,deliverySha256:deliveryHash}});
              await this.tx.reviewProtection.beforeWorkCommit({kind:'vote',job:row.id,qualification:this.tx.admission.seals.get(String(row.id))});
              this.tx.admission.consumePreparation(row.id);
              if (specification.publicWeb?.reviewer != null) return createExecutionAdmission({
                specification,
                sourceSpecSha256: specHash,
                chainId: this.c.chainId,
                manager: this.c.manager,
                jobID: String(row.id),
                role: "reviewer",
              });
            } : null,
          );
          this.store.putJob(row.id, {
            status:
              result.decision === "abstain"
                ? result.permanent
                  ? "unsupported"
                  : "abstained"
                : "reviewed",
            reason: result.reason,
            next_review: now + this.c.retrySeconds,
            review: encode({
              ...result,
              completionURI:s.completionURI,
              context: s.context,
              reviewBinding: this.binding,
            }),
            bond: s.bond.toString(),
          });
        } catch (e) {
          this.store.putJob(row.id, {
            status: "abstained",
            reason: codeOf(e),
            next_review: now + this.c.retrySeconds,
          });
        }
      });
      if (!this.live) {
        this.runtime("observing", {
          ...scan,
          openBondUSDC: exposure.amount.toString(),
          message: "Reviews are running. No transactions will be signed.",
        });
        return;
      }
      if (fs.existsSync(path.join(this.c.dataDir, "STOP"))) {
        this.runtime("paused", scan);
        return;
      }
      this.tx.assertActive();
      const rows = this.store.db
        .prepare(
          "SELECT * FROM jobs WHERE status='reviewed' AND my_vote=0 ORDER BY created_block,id LIMIT 100",
        )
        .all();
      for (const row of rows) {
        const result = JSON.parse(row.review);
        if (
          result.reviewBinding !== this.binding ||
          now - result.reviewedAt > 600 ||
          (result.decision === "approve" &&
            this.c.ai.cloudVeto &&
            result.cloudVetoEnabled !== true) ||
          (result.decision === "approve" &&
            this.c.ai.enabled &&
            result.aiVetoEnabled !== true)
        ) {
          this.store.putJob(row.id, { status: "queued", next_review: 0 });
          continue;
        }
        const s = await this.chain.snapshot(row.id);
        const blocked = this.chain.eligible(s) ?? this.risk(s, exposure);
        if (blocked || s.context !== result.context) {
          this.store.putJob(row.id, {
            status: "queued",
            reason: blocked ?? "CONTEXT_CHANGED",
            next_review: now + this.c.pollSeconds,
          });
          continue;
        }
        ensure(
          ["approve", "reject"].includes(result.decision),
          "UNSUPPORTED_VOTE_DECISION",
        );
        ensure(
          (await this.chain.token.balanceOf(this.c.validator)) >= s.bond,
          "INSUFFICIENT_USDC_FOR_BOND",
        );
        const fresh = async () => {
          const current = await this.chain.snapshot(row.id);
          ensure(
            !this.chain.eligible(current) &&
              !this.risk(current, await this.exposure()) &&
              current.context === result.context,
            "REVIEW_CONTEXT_CHANGED",
          );
        };
        try {
          const allowance = await this.chain.token.allowance(
            this.c.validator,
            this.c.manager,
          );
          if (allowance !== s.bond) {
            const amount = allowance === 0n ? s.bond : 0n;
            await this.tx.send(this.tx.approveRequest(amount), {
              kind: "approve",
              job: row.id,
              bond: amount.toString(),
              context: result.context,
              beforeSign: fresh,
            });
            this.runtime("approval-pending", { job: row.id });
            return;
          }
          await this.tx.send(this.chain.voteRequest(row.id, result.decision), {
            kind: "vote",
            job: row.id,
            decision: result.decision,
            bond: s.bond.toString(),
            context: result.context,
            beforeSign: fresh,
          });
          this.runtime("vote-pending", {
            job: row.id,
            decision: result.decision,
          });
          return;
        } catch (e) {
          // An ineligible job must not starve the rest of the queue. Only a
          // pre-broadcast contract simulation rejection is scoped to this job.
          if ((e.code !== "CALL_EXCEPTION" && !String(e.message).startsWith("ADMISSION_")) || this.store.pending()) throw e;
          this.store.putJob(row.id, {
            status: "abstained",
            reason: String(e.message).startsWith("ADMISSION_") ? codeOf(e) : "CONTRACT_SIMULATION_REJECTED",
            next_review: now + this.c.retrySeconds,
          });
        }
      }
      if (
        this.c.autoClaim &&
        (await this.chain.manager.pendingUSDC(this.c.validator)) > 0n
      ) {
        await this.tx.send(
          {
            to: this.c.manager,
            data: this.chain.iface.encodeFunctionData("claimUSDC", [
              this.c.validator,
            ]),
          },
          { kind: "claim" },
        );
        this.runtime("claim-pending");
        return;
      }
      if (this.c.autoFinalizeOwnJobs) {
        for (const row of this.store.ownJobs()) {
          const s = await this.chain.snapshot(row.id);
          if (
            !s.completed &&
            !s.expired &&
            !s.disputed &&
            !s.paused &&
            s.requested &&
            BigInt(s.now) > s.settlementAfter
          ) {
            await this.tx.send(
              {
                to: this.c.manager,
                data: this.chain.iface.encodeFunctionData("finalizeJob", [
                  row.id,
                ]),
              },
              { kind: "finalize", job: row.id },
            );
            this.runtime("finalization-pending", { job: row.id });
            return;
          }
        }
      }
      this.runtime("monitoring", {
        ...scan,
        openBondUSDC: exposure.amount.toString(),
        message: "Monitoring confirmed jobs within your review policy.",
      });
    } catch (e) {
      const reason = codeOf(e);
      if (
        /RPC_DISAGREEMENT|EXTERNAL_NONCE_CHANGED|JOURNAL_SIGNATURE_MISMATCH|SPENDING_CLOCK_CHANGED|REORG|NONCE_CONSUMED|CODE_CHANGED|SCOPE_CHANGED|WRONG_CHAIN|PIN_MISMATCH/.test(
          reason,
        )
      )
        atomicWrite(path.join(this.c.dataDir, "STOP"), reason + "\n");
      this.runtime("attention", {
        reason,
        message: "Check this issue and any recorded pending transaction.",
      });
      throw e;
    } finally {
      this.busy = false;
    }
  }
}
