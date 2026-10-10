import { Admission } from "./admission.mjs";
import fs from "node:fs";
import path from "node:path";
import {
  Interface,
  Transaction,
  keccak256,
  parseUnits,
  getAddress,
} from "ethers";
import { ensure, atomicWrite } from "./util.mjs";
import { assertPrepared } from "./work.mjs";
import { preparationBinding } from "./config.mjs";
import { TOKEN_ABI } from "./chain.mjs";
const tokenInterface = new Interface(TOKEN_ABI);
export class Transactions {
  constructor(c, chain, store, signer, pin, bindingHash) {
    Object.assign(this, { c, chain, store, signer, pin, bindingHash });
    this.admission = new Admission(c, chain, store);
  }
  assertActive() {
    ensure(!this.halted, "SERVICE_STOPPING");
    if (this.c.chainId !== 31337) {
      ensure(
        this.chain.provider?.verified === true,
        "VERIFICATION_RPC_REQUIRED",
      );
      ensure(
        this.c.independenceReviewed === true,
        "INDEPENDENCE_REVIEW_REQUIRED",
      );
    }
    ensure(!fs.existsSync(path.join(this.c.dataDir, "STOP")), "NODE_PAUSED");
    const p = path.join(this.c.dataDir, "activation.json");
    ensure(fs.existsSync(p), "LIVE_NOT_ACTIVATED");
    const a = JSON.parse(fs.readFileSync(p, "utf8"));
    ensure(
      a.binding === this.bindingHash && a.agent === getAddress(this.c.agent),
      "ACTIVATION_SCOPE_CHANGED",
    );
  }
  policy(request, kind, job, decision, bond) {
    ensure(
      !request.value || BigInt(request.value) === 0n,
      "NATIVE_VALUE_FORBIDDEN",
    );
    const to = getAddress(request.to);
    if (kind === "approve") {
      ensure(to === this.pin.token, "TOKEN_TARGET");
      const p = tokenInterface.parseTransaction({ data: request.data });
      ensure(
        p.name === "approve" &&
          getAddress(p.args[0]) === getAddress(this.c.manager) &&
          p.args[1] === BigInt(bond),
        "APPROVAL_SCOPE",
      );
      ensure(
        BigInt(bond) <= parseUnits(this.c.limits.maxBondUSDC, 6),
        "BOND_LIMIT",
      );
    } else {
      ensure(to === getAddress(this.c.manager), "MANAGER_TARGET");
      const p = this.chain.iface.parseTransaction({ data: request.data });
      if (kind === "apply") {
        ensure(
          BigInt(bond) <= parseUnits(this.c.limits.maxBondUSDC, 6),
          "BOND_LIMIT",
        );
        assertPrepared(
          this.store.work(job),
          preparationBinding(this.c, this.pin),
          this.bindingHash,
        );
        ensure(
          p.name === "applyForJob" &&
            p.args[0].toString() === String(job) &&
            p.args[1] === this.c.label &&
            JSON.stringify(Array.from(p.args[2])) ===
              JSON.stringify(this.c.proof),
          "APPLY_SCOPE",
        );
      } else if (kind === "submit") {
        const w = this.store.work(job);
        assertPrepared(
          w,
          preparationBinding(this.c, this.pin),
          this.bindingHash,
        );
        ensure(
          this.store.job(job)?.owned &&
            p.name === "requestJobCompletion" &&
            p.args[0].toString() === String(job) &&
            p.args[1] === w.uri,
          "SUBMISSION_SCOPE",
        );
      } else if (kind === "claim")
        ensure(
          p.name === "claimUSDC" &&
            getAddress(p.args[0]) === getAddress(this.c.agent),
          "CLAIM_SCOPE",
        );
      else if (kind === "finalize")
        ensure(
          p.name === "finalizeJob" &&
            p.args[0].toString() === String(job) &&
            this.c.autoFinalizeOwnJobs &&
            this.store.job(job)?.owned,
          "FINALIZE_SCOPE",
        );
      else throw new Error("TRANSACTION_KIND");
    }
  }
  budget(now, gas, bond, kind) {
    const clock = this.store.meta("spendingClock", 0);
    ensure(now >= clock - 300, "SPENDING_CLOCK_CHANGED");
    this.store.set("spendingClock", Math.max(now, clock));
    const recent = this.store.recent(now);
    ensure(
      recent.length < this.c.limits.maxTransactions24h,
      "TRANSACTION_24H_LIMIT",
    );
    const spent = recent.reduce((s, t) => s + BigInt(t.gas_budget), 0n);
    ensure(
      spent + gas <= parseUnits(this.c.limits.maxGas24hETH, 18),
      "GAS_24H_LIMIT",
    );
    if (kind === "apply") {
      ensure(
        BigInt(bond) <= parseUnits(this.c.limits.maxBondUSDC, 6),
        "BOND_LIMIT",
      );
      ensure(
        recent
          .filter((t) => t.kind === "apply")
          .reduce((s, t) => s + BigInt(t.bond), 0n) +
          BigInt(bond) <=
          parseUnits(this.c.limits.maxBond24hUSDC, 6),
        "BOND_24H_LIMIT",
      );
    }
  }
  async send(
    request,
    {
      kind,
      job = null,
      decision = null,
      bond = "0",
      context = null,
      beforeSign = async () => {},
    },
  ) {
    this.assertActive();
    ensure(!this.store.pending(), "TRANSACTION_PENDING");
    ensure(
      this.signer &&
        getAddress(await this.signer.getAddress()) === getAddress(this.c.agent),
      "SIGNER_MISMATCH",
    );
    await this.chain.verify(this.pin);
    this.policy(request, kind, job, decision, bond);
    await this.admission.beforeCommit({kind, job, bond, decision});
    await beforeSign();
    const p = this.chain.provider,
      address = this.c.agent,
      latest = await p.getTransactionCount(address, "latest"),
      pending = await p.getTransactionCount(address, "pending");
    ensure(latest === pending, "EXTERNAL_PENDING_NONCE");
    const last = this.store.db
      .prepare("SELECT MAX(nonce) AS n FROM txs")
      .get().n;
    ensure(latest === (last === null ? 0 : last + 1), "EXTERNAL_NONCE_CHANGED");
    const fee = await p.getFeeData(),
      maxFee = fee.maxFeePerGas,
      priority = fee.maxPriorityFeePerGas;
    ensure(
      maxFee !== null &&
        priority !== null &&
        maxFee <= parseUnits(this.c.limits.maxFeeGwei, 9),
      "GAS_PRICE_LIMIT",
    );
    const tip =
      priority > parseUnits(this.c.limits.maxPriorityGwei, 9)
        ? parseUnits(this.c.limits.maxPriorityGwei, 9)
        : priority;
    const bare = { ...request, from: address, value: 0n };
    await p.call(bare);
    const estimate = await p.estimateGas(bare),
      gas = (estimate * 120n + 99n) / 100n;
    const gasCeiling =
      kind === "finalize"
        ? (this.c.limits.maxFinalizeGas ?? this.c.limits.maxTxGas)
        : this.c.limits.maxTxGas;
    ensure(
      gas <= BigInt(gasCeiling),
      kind === "finalize" ? "FINALIZATION_GAS_UNITS_LIMIT" : "GAS_UNITS_LIMIT",
    );
    const gasBudget = gas * maxFee;
    ensure(
      gasBudget <= parseUnits(this.c.limits.maxTxETH, 18),
      "TRANSACTION_COST_LIMIT",
    );
    ensure((await p.getBalance(address)) >= gasBudget, "INSUFFICIENT_ETH");
    const now = Math.floor(Date.now() / 1000);
    this.budget(now, gasBudget, bond, kind);
    await beforeSign();
    this.assertActive();
    ensure(
      (await p.getTransactionCount(address, "latest")) === latest &&
        (await p.getTransactionCount(address, "pending")) === pending,
      "NONCE_CHANGED_BEFORE_SIGNING",
    );
    await this.admission.beforeCommit({kind, job, bond, gasBudget, decision});
    const tx = {
      to: request.to,
      data: request.data,
      value: 0n,
      chainId: this.c.chainId,
      type: 2,
      nonce: pending,
      gasLimit: gas,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: tip,
    };
    this.assertActive();
    this.admission.assertCurrent({kind,job,bond,decision});
    const raw = await this.signer.signTransaction(tx),
      decoded = Transaction.from(raw);
    ensure(decoded.from === getAddress(address) && decoded.to === getAddress(tx.to) && decoded.data === tx.data && decoded.value === 0n && decoded.chainId === BigInt(tx.chainId) && decoded.nonce === tx.nonce && decoded.gasLimit === tx.gasLimit && decoded.maxFeePerGas === tx.maxFeePerGas && decoded.maxPriorityFeePerGas === tx.maxPriorityFeePerGas && decoded.type === 2, "SIGNED_TRANSACTION_MISMATCH");
    this.assertActive();
    this.admission.assertCurrent({kind,job,bond,decision});
    const hash = keccak256(raw);
    this.store.reserve({
      hash,
      raw,
      nonce: pending,
      kind,
      job,
      decision,
      context,
      bond: String(bond),
      gas_budget: gasBudget.toString(),
      created: now,
    });
    try {
      await p.broadcastTransaction(raw);
    } catch {
      /* The signed journal is authoritative: never invent a second transaction. */
    }
    return hash;
  }
  async recover({ rebroadcast = true } = {}) {
    const t = this.store.pending();
    if (!t) return false;
    await this.chain.verify(this.pin);
    const p = this.chain.provider,
      receipt = await p.getTransactionReceipt(t.hash);
    if (receipt) {
      const head = await this.chain.head(),
        block = await p.getBlock(receipt.blockNumber);
      ensure(block?.hash === receipt.blockHash, "TRANSACTION_REORG");
      if (
        head.number - receipt.blockNumber + 1 < this.c.confirmations ||
        receipt.blockNumber > (await this.chain.safeHeight(head))
      )
        return true;
      this.store.markReceipt(t.hash, receipt, Math.floor(Date.now() / 1000));
      if (receipt.status !== 1)
        atomicWrite(
          path.join(this.c.dataDir, "STOP"),
          "A transaction reverted. Inspect status, then resume explicitly.\n",
        );
      return true;
    }
    ensure(
      (await p.getTransactionCount(this.c.agent, "latest")) <= t.nonce,
      "NONCE_CONSUMED_WITHOUT_KNOWN_RECEIPT",
    );
    const signed = Transaction.from(t.raw);
    ensure(
      signed.hash === t.hash &&
        signed.from === getAddress(this.c.agent) &&
        Number(signed.chainId) === this.c.chainId &&
        signed.nonce === t.nonce,
      "JOURNAL_SIGNATURE_MISMATCH",
    );
    if (
      !rebroadcast ||
      this.halted ||
      fs.existsSync(path.join(this.c.dataDir, "STOP"))
    )
      return true;
    // A journal created under an earlier policy may be observed, but never rebroadcast after reconfiguration.
    this.assertActive();
    this.policy(Transaction.from(t.raw), t.kind, t.job, t.decision, t.bond);
    const now = Math.floor(Date.now() / 1000);
    ensure(now - t.created < 3600, "PENDING_TRANSACTION_NEEDS_REVIEW");
    if (t.kind === "apply" || (t.kind === "approve" && BigInt(t.bond) > 0n)) {
      const s = await this.chain.snapshot(t.job);
      if (this.chain.eligible(s)) return true;
      ensure(t.context && s.context === t.context, "PENDING_CONTEXT_CHANGED");
    }
    if (t.kind === "submit") {
      const s = await this.chain.snapshot(t.job);
      if (
        s.agent.toLowerCase() !== this.c.agent.toLowerCase() ||
        s.completed ||
        s.expired ||
        s.requested ||
        s.disputed ||
        s.paused ||
        BigInt(s.now + 30) > s.deadline
      )
        return true;
    }
    try { await this.admission.beforeCommit({kind:t.kind, job:t.job, bond:t.bond, decision:t.decision, gasBudget:BigInt(t.gas_budget), rebroadcast:true}); } catch(e) { if(String(e.message).startsWith("ADMISSION_")) return true; throw e; }
    await p.call({
      to: signed.to,
      data: signed.data,
      value: 0n,
      from: signed.from,
    });
    this.assertActive();
    try {
      this.admission.assertCurrent({kind:t.kind,job:t.job,bond:t.bond,decision:t.decision});
      await p.broadcastTransaction(t.raw);
    } catch {}
    return true;
  }
  approveRequest(amount) {
    return {
      to: this.pin.token,
      data: tokenInterface.encodeFunctionData("approve", [
        this.c.manager,
        amount,
      ]),
    };
  }
}
