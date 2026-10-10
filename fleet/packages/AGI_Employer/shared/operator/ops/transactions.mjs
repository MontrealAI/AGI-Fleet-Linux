import fs from "node:fs";
import path from "node:path";
import { getAddress, parseUnits, Transaction, keccak256 } from "ethers";
import { ensure, now, same, atomicWrite } from "./common.mjs";
import { assertRequest } from "./policy.mjs";
export class Transactions {
  constructor(c, chain, store, pin, signer, binding) {
    Object.assign(this, { c, chain, store, pin, signer, binding });
  }
  active() {
    ensure(!this.halted, "SERVICE_STOPPING");
    ensure(this.c.role !== "evidence", "READ_ONLY_ROLE");
    ensure(
      !fs.existsSync(path.join(this.store.home, "STOP")),
      "SERVICE_PAUSED",
    );
    const a = this.store.meta("activation");
    ensure(
      a?.binding === this.binding &&
        a.expires > now() &&
        a.wallet === getAddress(this.c.wallet),
      "AUTHORITY_NOT_ACTIVE",
    );
    ensure(
      this.c.chainId === 31337 || this.chain.provider.verified === true,
      "DUAL_RPC_REQUIRED",
    );
  }
  budget(gas, bond, action) {
    const t = now(),
      clock = this.store.meta("spendingClock", t);
    ensure(t >= clock - 300, "CLOCK_MOVED_BACKWARD");
    this.store.set("spendingClock", Math.max(t, clock));
    const list = this.store.recent(t);
    ensure(
      list.length < this.c.limits.maxTransactions24h,
      "TRANSACTION_DAILY_LIMIT",
    );
    ensure(
      list.reduce((s, x) => s + BigInt(x.gas_budget), 0n) + gas <=
        parseUnits(this.c.limits.maxGas24hETH, 18),
      "GAS_DAILY_LIMIT",
    );
    if (action === "dispute")
      ensure(
        list
          .filter((x) => x.action === "dispute")
          .reduce((s, x) => s + BigInt(x.bond), 0n) +
          bond <=
          parseUnits(this.c.limits.maxDisputeBonds24hUSDC, 6),
        "DISPUTE_DAILY_LIMIT",
      );
  }
  async send(request, action, { bond = 0n, context = null, beforeSign } = {}) {
    this.active();
    ensure(typeof beforeSign === "function", "FRESH_AUTHORIZATION_REQUIRED");
    ensure(!this.store.pending(), "TRANSACTION_PENDING");
    ensure(
      this.signer && same(await this.signer.getAddress(), this.c.wallet),
      "SIGNER_MISMATCH",
    );
    await this.chain.verify(this.pin);
    assertRequest(this.c, this.chain, this.pin, request, action, bond);
    await beforeSign();
    await this.funding?.beforeCommit(action);
    const p = this.chain.provider,
      latest = await p.getTransactionCount(this.c.wallet, "latest"),
      pending = await p.getTransactionCount(this.c.wallet, "pending"),
      last = this.store.db.prepare("SELECT MAX(nonce) n FROM txs").get().n;
    ensure(latest === pending, "EXTERNAL_PENDING_NONCE");
    ensure(
      latest === (last === null ? this.store.meta("initialNonce") : last + 1),
      "EXTERNAL_NONCE_CHANGED",
    );
    const fees = await p.getFeeData(),
      maxFee = fees.maxFeePerGas,
      tip = fees.maxPriorityFeePerGas;
    ensure(
      maxFee !== null &&
        tip !== null &&
        maxFee <= parseUnits(this.c.limits.maxFeeGwei, 9),
      "GAS_PRICE_LIMIT",
    );
    const bare = { ...request, from: this.c.wallet, value: 0n };
    await p.call(bare);
    const gas = ((await p.estimateGas(bare)) * 120n) / 100n + 1n;
    ensure(gas <= BigInt(this.c.limits.maxTxGas), "GAS_UNITS_LIMIT");
    const gasBudget = gas * maxFee;
    ensure(
      gasBudget <= parseUnits(this.c.limits.maxTxETH, 18),
      "TRANSACTION_COST_LIMIT",
    );
    ensure(
      (await p.getBalance(this.c.wallet)) >= gasBudget,
      "INSUFFICIENT_ETH",
    );
    this.budget(gasBudget, bond, action.action);
    await this.chain.verify(this.pin);
    await beforeSign();
    await this.funding?.beforeCommit(action,{gasBudget});
    this.active();
    ensure(
      (await p.getTransactionCount(this.c.wallet, "latest")) === latest &&
        (await p.getTransactionCount(this.c.wallet, "pending")) === pending,
      "NONCE_CHANGED",
    );
    const tx = {
      to: request.to,
      data: request.data,
      value: 0n,
      chainId: this.c.chainId,
      type: 2,
      nonce: pending,
      gasLimit: gas,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas:
        tip < parseUnits(this.c.limits.maxPriorityGwei, 9)
          ? tip
          : parseUnits(this.c.limits.maxPriorityGwei, 9),
    };
    this.active();
    if(['fund','approve-funding','approve-review','fund-review','refund-review','claim-review'].includes(action.action)){ensure(this.funding,'FUNDING_GATE_REQUIRED');this.funding.assertCurrent(action.job,action.offer);}
    const raw = await this.signer.signTransaction(tx),
      decoded = Transaction.from(raw);
    ensure(
      same(decoded.from, this.c.wallet) &&
        decoded.data === request.data &&
        same(decoded.to, request.to) &&
        decoded.value === 0n &&
        decoded.nonce === pending &&
        Number(decoded.chainId) === this.c.chainId &&
        decoded.type === 2 &&
        decoded.gasLimit === tx.gasLimit &&
        decoded.maxFeePerGas === tx.maxFeePerGas &&
        decoded.maxPriorityFeePerGas === tx.maxPriorityFeePerGas,
      "SIGNED_TRANSACTION_MISMATCH",
    );
    this.active();
    if(['fund','approve-funding','approve-review','fund-review','refund-review','claim-review'].includes(action.action))this.funding.assertCurrent(action.job,action.offer);
    const hash = keccak256(raw);
    this.store.reserve({
      hash,
      raw,
      nonce: pending,
      ...action,
      context,
      bond: String(bond),
      gas_budget: String(gasBudget),
      created: now(),
      binding: this.binding,
    });
    try {
      await p.broadcastTransaction(raw);
    } catch {
      this.store.event("broadcast-unconfirmed", { hash });
    }
    return hash;
  }
  async recover({ rebroadcast = false } = {}) {
    const t = this.store.pending();
    if (!t) return false;
    await this.chain.verify(this.pin);
    const p = this.chain.provider,
      r = await p.getTransactionReceipt(t.hash);
    if (r) {
      const h = await this.chain.head();
      ensure(
        (await p.getBlock(r.blockNumber))?.hash === r.blockHash,
        "TRANSACTION_REORG",
      );
      if (r.blockNumber > (await this.chain.safeHeight(h))) return true;
      await this.funding?.receipt(t,r);
      this.store.receipt(t.hash, r);
      if (t.action === "claim")
        this.store.claimAttempt(t.beneficiary, r.status === 1);
      if (r.status !== 1)
        atomicWrite(
          path.join(this.store.home, "STOP"),
          "TRANSACTION_REVERTED\n",
        );
      return true;
    }
    ensure(
      (await p.getTransactionCount(this.c.wallet, "latest")) <= t.nonce,
      "UNKNOWN_NONCE_CONSUMPTION",
    );
    const d = Transaction.from(t.raw);
    ensure(
      d.hash === t.hash &&
        same(d.from, this.c.wallet) &&
        Number(d.chainId) === this.c.chainId &&
        d.nonce === t.nonce,
      "JOURNAL_SIGNATURE_MISMATCH",
    );
    // A pause prevents rebroadcast. Observation continues so an already sent transaction can be reconciled.
    if (
      !rebroadcast ||
      fs.existsSync(path.join(this.store.home, "STOP")) ||
      this.store.meta("activation")?.binding !== this.binding
    )
      return true;
    this.active();
    ensure(t.binding === this.binding, "JOURNAL_POLICY_CHANGED");
    if(['fund','approve-funding','approve-review','fund-review','refund-review','claim-review'].includes(t.action)){ensure(this.funding,'FUNDING_GATE_REQUIRED');t.offer=this.funding.intent(t.job);}
    assertRequest(this.c, this.chain, this.pin, d, t, BigInt(t.bond));
    try{await this.funding?.beforeCommit(t,{gasBudget:BigInt(t.gas_budget),rebroadcast:true});}catch(e){if(String(e.message).startsWith('FUNDING_'))return true;throw e;}
    ensure(now() - t.created < 3600, "PENDING_TRANSACTION_REQUIRES_REVIEW");
    if (t.context) {
      const s = await this.chain.snapshot(t.job);
      ensure(s.context === t.context, "PENDING_CONTEXT_CHANGED");
    }
    await p.call({ to: d.to, data: d.data, value: 0n, from: this.c.wallet });
    this.active();
    try {
      if(['fund','approve-funding','approve-review','fund-review','refund-review','claim-review'].includes(t.action))this.funding.assertCurrent(t.job,t.offer);
      await p.broadcastTransaction(t.raw);
    } catch {}
    return true;
  }
}
