import { acquireWalletLease } from "./wallet-lease.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Wallet, formatUnits, ZeroHash } from "ethers";
import { Store } from "./store.mjs";
import { Engine } from "./engine.mjs";
import { connectChain } from "./rpc.mjs";
import { cachedReader } from "./cache.mjs";
import { NodeError, codeOf, atomicWrite, delay } from "./util.mjs";
let running = false,
  stop = false,
  store = null,
  c = null,
  chain = null,
  engine = null,
  releaseWallet = null;
const send = (payload) => {
  if (process.connected) process.send(payload);
};
const reviews = new Map();
function executor(kind, payload) {
  if (stop || !process.connected || reviews.size)
    return Promise.reject(new NodeError("EXECUTOR_UNAVAILABLE"));
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID(),
      timeout = setTimeout(() => {
        reviews.delete(id);
        reject(new NodeError("EXECUTOR_UNAVAILABLE"));
      }, 725000);
    reviews.set(id, { resolve, reject, timeout });
    send({ type: "execute", id, kind, payload });
  });
}
function cancelReviews() {
  for (const pending of reviews.values()) {
    clearTimeout(pending.timeout);
    pending.reject(Error("CLOUD_AI_UNAVAILABLE"));
  }
  reviews.clear();
}
process.on("message", async (message) => {
  if (message.type === "execute-result") {
    const pending = reviews.get(message.id);
    if (pending) {
      reviews.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.result && !stop) pending.resolve(message.result);
      else
        pending.reject(new NodeError(message.error ?? "EXECUTOR_UNAVAILABLE"));
    }
    return;
  }
  if (message.type === "stop") {
    stop = true;
    if (engine) engine.tx.halted = true;
    cancelReviews();
    return;
  }
  if (message.type !== "start" || running) return;
  running = true;
  c = message.config;
  try {
    if (message.mode === "live")
      releaseWallet = acquireWalletLease(c.chainId, c.agent);
    chain = connectChain(c, message.rpcURL, message.verificationRPCURL);
    store = new Store(c.dataDir);
    const live = message.mode === "live",
      signer = live ? new Wallet(message.privateKey, chain.provider) : null;
    message.privateKey = undefined;
    message.rpcURL = undefined;
    message.verificationRPCURL = undefined;
    const reader = cachedReader(c);
    engine = new Engine(c, chain, store, message.pin, {
      live,
      signer,
      reader,
      executor,
    });
    if (live) engine.tx.assertActive();
    send({ type: "ready" });
    let cycle = 0;
    while (!stop) {
      const started = performance.now();
      let health,
        cyclePassed = false;
      try {
        await engine.cycle();
        cyclePassed = true;
      } catch (error) {
        send({ type: "issue", code: codeOf(error) });
      }
      if (++cycle % 3 === 1 && !stop && cyclePassed) {
        try {
          const [identity, eth, usdc, allowance, nonce] = await Promise.all([
            chain.agentHealth(),
            chain.provider.getBalance(c.agent),
            chain.token.balanceOf(c.agent),
            chain.token.allowance(c.agent, c.manager),
            chain.provider.getTransactionCount(c.agent, "latest"),
          ]);
          health = {
            checkedAt: new Date().toISOString(),
            contract: true,
            ...identity,
            eth: formatUnits(eth, 18),
            usdc: formatUnits(usdc, 6),
            allowanceUSDC: formatUnits(allowance, 6),
            walletNonce: nonce,
            chainId: c.chainId,
          };
        } catch {}
      }
      send({
        type: "cycle",
        passed: cyclePassed,
        verification: chain.provider.verification ?? null,
        finalized: chain.lastFinalized ?? null,
        ...(health ? { health } : {}),
        runtime: store.meta("runtime"),
        metrics: {
          cycleMs: Math.round(performance.now() - started),
          cacheHits: reader.hits,
          cacheMisses: reader.misses,
          cacheBytes: reader.bytes,
          memoryRSS: process.memoryUsage().rss,
        },
      });
      for (let i = 0; i < c.pollSeconds * 5 && !stop; i++) await delay(200);
    }
  } catch (error) {
    send({ type: "fatal", code: codeOf(error) });
    process.exitCode = 1;
  } finally {
    try {
      store?.close();
    } catch {}
    chain?.provider.destroy();
    releaseWallet?.();
    process.disconnect?.();
  }
});
process.on("disconnect", () => {
  const unexpected = !stop;
  stop = true;
  if (engine) engine.tx.halted = true;
  cancelReviews();
  if (unexpected && running && c && !process.exitCode) {
    try {
      atomicWrite(path.join(c.dataDir, "STOP"), "SUPERVISOR_DISCONNECTED\n");
    } catch {}
  }
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stop = true;
    if (engine) engine.tx.halted = true;
  });
