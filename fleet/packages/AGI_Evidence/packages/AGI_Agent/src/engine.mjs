import {checkGeneralSettlement} from './general-artifacts.mjs';
import {createExecutionAdmission} from './public-web-admission.mjs';
import {isComputerSpec} from './artifacts.mjs';
import { isImageSpec } from './images.mjs';
import fs from "node:fs";
import path from "node:path";
import { parseUnits, ZeroAddress } from "ethers";
import { ensure, encode, codeOf, sha256, canonical, atomicWrite } from "./util.mjs";
import { binding, preparationBinding } from "./config.mjs";
import { ContentReader } from "./content.mjs";
import { Transactions } from "./transactions.mjs";
import { Publisher } from "./publisher.mjs";
import { decodeWork, checkDelivery, assertPrepared } from "./work.mjs";
export class Engine {
  constructor(
    c,
    chain,
    store,
    pin,
    {
      live = false,
      signer = null,
      reader = null,
      executor = null,
      publisher = null,
    } = {},
  ) {
    Object.assign(this, { c, chain, store, pin, live, executor });
    this.reader = reader ?? new ContentReader(c);
    this.publisher = publisher ?? new Publisher(c);
    this.binding = binding(c, pin);
    this.preparationBinding = preparationBinding(c, pin);
    this.tx = new Transactions(c, chain, store, signer, pin, this.binding);
    const identity = {
      role: "agent",
      chainId: c.chainId,
      manager: c.manager.toLowerCase(),
      agent: c.agent.toLowerCase(),
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
      updated: new Date().toISOString(),
      ...extra,
    });
  }
  stopped() {
    return fs.existsSync(path.join(this.c.dataDir, "STOP"));
  }
  async exposure() {
    let amount = await this.chain.manager.pendingUSDC(this.c.agent),
      count = 0,
      unsubmitted = 0;
    for (const row of this.store.ownJobs()) {
      const s = await this.chain.snapshot(row.id);
      if (s.completed || s.expired) {
        this.store.putJob(row.id, { status: "terminal", bond: "0" });
        continue;
      }
      ensure(
        s.agent.toLowerCase() === this.c.agent.toLowerCase(),
        "ASSIGNMENT_HISTORY_MISMATCH",
      );
      count++;
      amount += s.bond;
      if (!s.requested) unsubmitted++;
      this.store.putJob(row.id, {
        bond: String(s.bond),
        requested: s.requested ? 1 : 0,
        status: s.disputed
          ? "disputed"
          : s.requested
            ? "submitted"
            : "assigned",
      });
    }
    return { amount, count, unsubmitted };
  }
  risk(s, x) {
    const l = this.c.limits;
    if (s.payout > parseUnits(l.maxJobUSDC, 6)) return "JOB_VALUE_LIMIT";
    if (s.reward < parseUnits(this.c.execution.minRewardUSDC, 6))
      return "REWARD_TOO_SMALL";
    if (s.bond > parseUnits(l.maxBondUSDC, 6)) return "BOND_LIMIT";
    if (s.bond + x.amount > parseUnits(l.maxOpenBondUSDC, 6))
      return "OPEN_BOND_LIMIT";
    if (x.count >= this.c.execution.maxActiveJobs) return "ACTIVE_JOB_LIMIT";
    return null;
  }
  reserveCapacity(x) {
    const used = ["agent.sqlite", "agent.sqlite-wal"].reduce(
      (n, f) =>
        n +
        (fs.existsSync(path.join(this.c.dataDir, f))
          ? fs.statSync(path.join(this.c.dataDir, f)).size
          : 0),
      0,
    );
    ensure(used < 24 * 1024 * 1024, "LOCAL_HISTORY_CAPACITY");
    const rows = this.store.recent(Math.floor(Date.now() / 1000)),
      slots = 3 + x.unsubmitted;
    ensure(
      rows.length + slots <= this.c.limits.maxTransactions24h,
      "SUBMISSION_CAPACITY_RESERVED",
    );
    ensure(
      rows.reduce((n, t) => n + BigInt(t.gas_budget), 0n) +
        parseUnits(this.c.limits.maxTxETH, 18) * BigInt(slots) <=
        parseUnits(this.c.limits.maxGas24hETH, 18),
      "SUBMISSION_GAS_RESERVED",
    );
  }
  async prepare(row, s) {
    await this.chain.assertAgentAuthorized();
    let w = this.store.work(row.id);
    if (!w || ![this.preparationBinding, this.binding].includes(w.binding)) {
      const data = await this.reader.read(s.specURI),
        spec = decodeWork(
          data.bytes,
          row.details,
          this.c.execution.allowEnvelopes,
        );
      ensure(!isComputerSpec(spec.acceptance) || this.c.execution.allowComputerWork === true,"COMPUTER_WORK_NOT_ENABLED");
      ensure(!isImageSpec(spec.acceptance) || this.c.execution.allowImages === true, "IMAGE_WORK_NOT_ENABLED");
      w = {
        binding: this.preparationBinding,
        spec_hash: data.sha256,
        spec,
        content: null,
        uri: null,
        stage: "new",
        attempts: 0,
      };
      this.store.saveWork(row.id, w);
    }
    ensure(!isComputerSpec(w.spec.acceptance) || this.c.execution.allowComputerWork === true,"COMPUTER_WORK_NOT_ENABLED");
    ensure(!isImageSpec(w.spec.acceptance) || this.c.execution.allowImages === true, "IMAGE_WORK_NOT_ENABLED");
    if (!this.live) {
      this.store.putJob(row.id, {
        status: "supported",
        reason: "READY_FOR_AUTONOMOUS_PREPARATION",
        next_review: Math.floor(Date.now() / 1000) + this.c.retrySeconds,
      });
      return false;
    }
    ensure(
      this.c.execution.publicDataOnly && this.c.execution.publicPublishing,
      "PUBLIC_DATA_REQUIRED",
    );
    checkGeneralSettlement(w.spec.acceptance,this.c);
    let publicWebSourceSha256 = null;
    let publicWebAcceptedWork = null;
    if (w.spec.acceptance.publicWeb?.agent != null || w.spec.acceptance.publicWeb?.reviewer != null) {
      const current = await this.reader.read(s.specURI);
      publicWebSourceSha256 = sha256(current.bytes);
      ensure(publicWebSourceSha256 === w.spec_hash, "PUBLIC_WEB_ACCEPTED_SOURCE_CHANGED");
      publicWebAcceptedWork = decodeWork(current.bytes, row.details, this.c.execution.allowEnvelopes);
      ensure(canonical(publicWebAcceptedWork) === canonical(w.spec), "PUBLIC_WEB_ACCEPTED_WORK_CHANGED");
    }
    this.tx.assertActive();
    await this.tx.admission.check(row.id, w.spec_hash);
    if (publicWebAcceptedWork) ensure(canonical(publicWebAcceptedWork) === canonical(w.spec), "PUBLIC_WEB_ACCEPTED_WORK_CHANGED");
    ensure(typeof this.executor === "function", "EXECUTOR_UNAVAILABLE");
    if (w.stage === "published") {
      assertPrepared(w, this.preparationBinding, this.binding);
      return true;
    }
    if (w.stage === "new" || w.stage === "generating") {
      ensure(
        w.attempts < this.c.execution.maxAttempts,
        "WORK_ATTEMPTS_EXHAUSTED",
      );
      w.attempts++;
      w.stage = "generating";
      this.store.saveWork(row.id, w);
      let result;
      try {
        this.tx.admission.consumePreparation(row.id);
        const executionAdmission = w.spec.acceptance.publicWeb?.agent == null ? null : createExecutionAdmission({
          specification: publicWebAcceptedWork.acceptance,
          sourceSpecSha256: publicWebSourceSha256,
          chainId: this.c.chainId,
          manager: this.c.manager,
          jobID: String(row.id),
          role: "agent",
        });
      result = await this.executor("generate", {
          specification: w.spec,
          attempt: w.attempts,
          ...(executionAdmission ? {executionAdmission} : {}),
        });
      } catch (e) {
        if (/COOLDOWN|BUSY|DAILY_LIMIT|DISABLED/.test(codeOf(e))) w.attempts--;
        w.stage = "new";
        this.store.saveWork(row.id, w);
        throw e;
      }
      this.tx.assertActive();
      if (result.status !== "complete") {
        w.stage = "declined";
        this.store.saveWork(row.id, w);
        this.store.putJob(row.id, {
          status: "unsupported",
          reason: "MODEL_DECLINED_JOB",
        });
        return false;
      }
      w.content = result.content;
      w.stage = "draft";
      this.store.saveWork(row.id, w);
      this.store.putJob(row.id, {
        status: "checking",
        reason: "DRAFT_CREATED",
      });
      return false;
    }
    if (w.stage === "draft") {
      let result;
      try {
        result = checkDelivery(w.spec, w.content);
      } catch {
        result = { decision: "reject" };
      }
      if (result.decision !== "approve") {
        w.stage = "new";
        w.content = null;
        this.store.saveWork(row.id, w);
        this.store.putJob(row.id, {
          status: "preparing",
          reason: "REVISING_FAILED_CHECKS",
        });
        return false;
      }
      this.tx.admission.consumePreparation(row.id);
      const executionAdmission = w.spec.acceptance.publicWeb?.reviewer == null ? null : createExecutionAdmission({
        specification: publicWebAcceptedWork.acceptance,
        sourceSpecSha256: publicWebSourceSha256,
        chainId: this.c.chainId,
        manager: this.c.manager,
        jobID: String(row.id),
        role: "reviewer",
      });
      const review = await this.executor("quality", {
        specification: w.spec,
        delivery: w.content,
        ...(executionAdmission ? {executionAdmission} : {}),
      });
      this.tx.assertActive();
      if (review.verdict !== "pass") {
        w.stage = "new";
        w.content = null;
        this.store.saveWork(row.id, w);
        this.store.putJob(row.id, {
          status: "preparing",
          reason: "QUALITY_REVIEW_NOT_PASSED",
        });
        return false;
      }
      w.stage = "checked";
      this.store.saveWork(row.id, w);
      this.store.putJob(row.id, {
        status: "publishing",
        reason: "CHECKS_PASSED",
      });
      return false;
    }
    if (w.stage === "checked") {
      this.tx.assertActive();
      const current = await this.chain.snapshot(row.id);
      ensure(!this.chain.eligible(current), "JOB_NO_LONGER_AVAILABLE");
      this.tx.admission.consumePreparation(row.id);
      w.uri = await this.publisher.publish(w.content, w.spec);
      w.stage = "published";
      this.store.saveWork(row.id, w);
      this.store.putJob(row.id, {
        status: "ready",
        reason: "DELIVERY_PUBLICLY_VERIFIED",
      });
      return true;
    }
    return false;
  }
  async submitOwned() {
    for (const row of this.store.ownJobs()) {
      const s = await this.chain.snapshot(row.id);
      if (s.completed || s.expired || s.requested || s.disputed || s.paused)
        continue;
      if (BigInt(s.now + 30) > s.deadline) {
        this.store.putJob(row.id, {
          status: "attention",
          reason: "SUBMISSION_DEADLINE_AT_RISK",
        });
        continue;
      }
      const w = this.store.work(row.id);
      try {
        assertPrepared(w, this.preparationBinding, this.binding);
      } catch (e) {
        this.store.putJob(row.id, {
          status: "attention",
          reason: "ASSIGNED_WORK_REQUIRES_RECOVERY",
        });
        throw e;
      }
      await this.publisher.verify(w.uri, w.content, w.spec);
      const fresh = async () => {
        const n = await this.chain.snapshot(row.id);
        ensure(
          n.agent.toLowerCase() === this.c.agent.toLowerCase() &&
            !n.completed &&
            !n.expired &&
            !n.disputed &&
            !n.requested &&
            !n.paused &&
            BigInt(n.now + 30) <= n.deadline,
          "SUBMISSION_STATE_CHANGED",
        );
        ensure(sha256(n.specURI) === row.spec_uri, "JOB_SPEC_EVENT_MISMATCH");
        assertPrepared(
          this.store.work(row.id),
          this.preparationBinding,
          this.binding,
        );
      };
      await this.tx.send(this.chain.submitRequest(row.id, w.uri), {
        kind: "submit",
        job: row.id,
        beforeSign: fresh,
      });
      this.runtime("submission-pending", { job: row.id });
      return true;
    }
    return false;
  }
  async settle() {
    if (
      this.c.autoClaim &&
      (await this.chain.manager.pendingUSDC(this.c.agent)) > 0n &&
      !(await this.chain.manager.settlementPaused())
    ) {
      await this.tx.send(
        {
          to: this.c.manager,
          data: this.chain.iface.encodeFunctionData("claimUSDC", [
            this.c.agent,
          ]),
        },
        { kind: "claim" },
      );
      this.runtime("claim-pending");
      return true;
    }
    if (this.c.autoFinalizeOwnJobs)
      for (const row of this.store.ownJobs()) {
        const s = await this.chain.snapshot(row.id);
        if (
          !s.completed &&
          !s.expired &&
          !s.disputed &&
          !s.paused &&
          s.requested &&
          BigInt(s.now) > s.settlementAfter &&
          s.approvals > s.disapprovals &&
          s.approvals + s.disapprovals >= s.quorum
        ) {
          await this.tx.send(this.chain.request("finalizeJob", row.id), {
            kind: "finalize",
            job: row.id,
            beforeSign: async () => {
              const n = await this.chain.snapshot(row.id);
              ensure(
                !n.disputed &&
                  !n.paused &&
                  n.approvals > n.disapprovals &&
                  n.approvals + n.disapprovals >= n.quorum &&
                  BigInt(n.now) > n.settlementAfter,
                "FINALIZATION_STATE_CHANGED",
              );
            },
          });
          this.runtime("finalization-pending");
          return true;
        }
      }
    return false;
  }
  async cycle() {
    ensure(!this.busy, "CYCLE_ALREADY_RUNNING");
    this.busy = true;
    try {
      await this.chain.verify(this.pin);
      for (const t of this.store.confirmed())
        ensure(
          (await this.chain.provider.getBlock(t.block_number))?.hash ===
            t.block_hash,
          "CONFIRMED_TRANSACTION_REORG",
        );
      if (this.store.pending()) {
        await this.tx.recover({ rebroadcast: this.live });
        this.runtime("transaction-pending");
        return;
      }
      const scan = await this.chain.scan(this.store);
      if(scan.caughtUp)await this.tx.admission.reconcile();
      if (!scan.caughtUp) {
        this.runtime("catching-up", scan);
        return;
      }
      const x = await this.exposure();
      if (this.stopped()) {
        this.runtime("paused", scan);
        return;
      }
      if (this.live) {
        this.tx.assertActive();
        if ((await this.submitOwned()) || (await this.settle())) return;
      }
      const now = Math.floor(Date.now() / 1000);
      for (const row of this.store.queue(this.c.maxJobsPerCycle, now)) {
        try {
          const s = await this.chain.snapshot(row.id);
          ensure(row.spec_uri === sha256(s.specURI), "JOB_SPEC_EVENT_MISMATCH");
          const reason = this.chain.eligible(s) ?? this.risk(s, x);
          if (reason) {
            this.store.putJob(row.id, {
              status:
                reason === "JOB_TERMINAL"
                  ? "terminal"
                  : s.agent !== ZeroAddress
                    ? "lost"
                    : "skipped",
              reason,
              next_review: now + this.c.retrySeconds,
            });
            continue;
          }
          if (this.live) {
            this.reserveCapacity(x);
            ensure(
              (await this.chain.provider.getBalance(this.c.agent)) >=
                parseUnits(this.c.limits.maxTxETH, 18) * 3n,
              "SUBMISSION_ETH_RESERVE",
            );
          }
          const prepared = await this.prepare(row, s);
          if (!this.live) continue;
          if (!prepared) {
            this.runtime("preparing", {
              ...scan,
              job: row.id,
              openBondUSDC: String(x.amount),
            });
            return;
          }
          const fresh = async () => {
            await this.chain.assertAgentAuthorized();
            const n = await this.chain.snapshot(row.id),
              ex = await this.exposure();
            ensure(
              !this.chain.eligible(n) &&
                !this.risk(n, ex) &&
                n.context === s.context,
              "JOB_CONTEXT_CHANGED",
            );
            this.reserveCapacity(ex);
            assertPrepared(
              this.store.work(row.id),
              this.preparationBinding,
              this.binding,
            );
          };
          const allowance = await this.chain.token.allowance(
            this.c.agent,
            this.c.manager,
          );
          ensure(
            (await this.chain.token.balanceOf(this.c.agent)) >= s.bond,
            "INSUFFICIENT_USDC_FOR_BOND",
          );
          if (allowance !== s.bond) {
            const amount = allowance === 0n ? s.bond : 0n;
            await this.tx.send(this.tx.approveRequest(amount), {
              kind: "approve",
              job: row.id,
              bond: String(amount),
              context: s.context,
              beforeSign: fresh,
            });
            this.runtime("approval-pending", { job: row.id });
            return;
          }
          await this.publisher.verify(
            this.store.work(row.id).uri,
            this.store.work(row.id).content,
            this.store.work(row.id).spec,
          );
          await this.tx.send(this.chain.applyRequest(row.id), {
            kind: "apply",
            job: row.id,
            bond: String(s.bond),
            context: s.context,
            beforeSign: fresh,
          });
          this.runtime("assignment-pending", { job: row.id });
          return;
        } catch (e) {
          if (this.store.pending()) throw e;
          const code =
            e.code === "CALL_EXCEPTION"
              ? "CONTRACT_SIMULATION_REJECTED"
              : codeOf(e);
          if (
            /RPC_DISAGREEMENT|EXTERNAL_NONCE_CHANGED|JOURNAL_SIGNATURE_MISMATCH|SPENDING_CLOCK_CHANGED|REORG|NONCE|CODE_CHANGED|SCOPE_CHANGED|WRONG_CHAIN|PIN_MISMATCH|JOURNAL/.test(
              code,
            )
          )
            throw e;
          const permanent =
            /UNSUPPORTED|SPEC_|WORK_TASK|WORK_ATTEMPTS|PUBLIC_DATA/.test(code);
          this.store.putJob(row.id, {
            status: permanent ? "unsupported" : "skipped",
            reason: code,
            next_review:
              now +
              (/COMPANION_COOLDOWN|COMPANION_BUSY/.test(code)
                ? 30
                : this.c.retrySeconds),
          });
        }
      }
      if (
        this.live &&
        (await this.chain.token.allowance(this.c.agent, this.c.manager)) > 0n
      ) {
        await this.tx.send(this.tx.approveRequest(0n), {
          kind: "approve",
          bond: "0",
        });
        this.runtime("allowance-cleanup");
        return;
      }
      this.runtime(this.live ? "monitoring" : "observing", {
        ...scan,
        openBondUSDC: String(x.amount),
        message: this.live
          ? "Watching for suitable public jobs within your limits."
          : "Previewing jobs. No AI requests, publishing, or transactions.",
      });
    } catch (e) {
      const reason = codeOf(e);
      if (
        /RPC_DISAGREEMENT|EXTERNAL_NONCE_CHANGED|JOURNAL_SIGNATURE_MISMATCH|SPENDING_CLOCK_CHANGED|REORG|NONCE|CODE_CHANGED|SCOPE_CHANGED|WRONG_CHAIN|PIN_MISMATCH|JOURNAL|CLOCK_CHANGED|PREPARED_WORK/.test(
          reason,
        )
      )
        atomicWrite(path.join(this.c.dataDir, "STOP"), reason + "\n");
      this.runtime("attention", { reason });
      throw e;
    } finally {
      this.busy = false;
    }
  }
}
