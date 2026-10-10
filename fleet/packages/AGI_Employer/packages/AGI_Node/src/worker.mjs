import { acquireWalletLease } from "./wallet-lease.mjs";
import {cloudReviewResult} from './cloud-review-result.mjs';
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Wallet, formatUnits, ZeroHash } from "ethers";
import { Store } from "./store.mjs";
import { Engine } from "./engine.mjs";
import { connectChain } from "./rpc.mjs";
import { cachedReader } from "./cache.mjs";
import { codeOf, atomicWrite, delay } from "./util.mjs";
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
export function cloudReviewer(specification, bytes, executionAdmission = null) {
  if (
    stop ||
    !process.connected ||
    bytes.length >
      (["computer-work/v1","computer-work/v2"].includes(specification?.profile)
        ? 94371840
        : specification?.profile === "image-png/v1"
          ? 4194304
          : 16000) ||
    reviews.size >= 16
  )
    return Promise.reject(Error("CLOUD_AI_UNAVAILABLE"));
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(
      () => {
        reviews.delete(id);
        reject(Error("CLOUD_AI_UNAVAILABLE"));
      },
      ["computer-work/v1","computer-work/v2"].includes(specification?.profile) ? 725000 : 125000,
    );
    reviews.set(id, { resolve, reject, timeout });
    send({
      type: "cloud-review",
      id,
      specification,
      delivery: bytes.toString("base64"),
      ...(executionAdmission ? {executionAdmission} : {}),
    });
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
  if (message.type === "cloud-review-result") {
    const pending = reviews.get(message.id);
    if (pending) {
      reviews.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.verdict && !stop) {
        try { pending.resolve(cloudReviewResult(message)); }
        catch { pending.reject(Error("CLOUD_AI_UNAVAILABLE")); }
      } else pending.reject(Error("CLOUD_AI_UNAVAILABLE"));
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
      releaseWallet = acquireWalletLease(c.chainId, c.validator);
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
      cloudReviewer,
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
          const [eth, usdc, allowance, credential, blacklisted, nonce] =
            await Promise.all([
              chain.provider.getBalance(c.validator),
              chain.token.balanceOf(c.validator),
              chain.token.allowance(c.validator, c.manager),
              chain.manager.validatorCredential(c.validator, c.label, c.proof),
              chain.manager.blacklistedValidators(c.validator),
              chain.provider.getTransactionCount(c.validator, "latest"),
            ]);
          health = {
            checkedAt: new Date().toISOString(),
            contract: true,
            eligible: credential[0] !== ZeroHash && !blacklisted,
            eth: formatUnits(eth, 18),
            usdc: formatUnits(usdc, 6),
            allowanceUSDC: formatUnits(allowance, 6),
            walletNonce: nonce,
            controller: credential[1],
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
