import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Interface, Contract, ZeroAddress } from "ethers";
import { validateConfig, inShard } from "../ops/config.mjs";
import { jobAction, requestFor, assertRequest } from "../ops/policy.mjs";
import { collectEvidence, assertProof } from "../ops/evidence.mjs";
import {
  autonomySpec,
  AUTONOMY_DECLARATION,
} from "../packages/AGI_Node/src/autonomy.mjs";
import { validateSpec, boundedJSON } from "../packages/AGI_Node/src/review.mjs";
import { config, snap, spec, addr, temp } from "./helpers.mjs";
import { sha256, now, canonical } from "../ops/common.mjs";
import { ABI, TOKEN_ABI } from "../packages/AGI_Node/src/chain.mjs";
const row = {
  id: "0",
  details: AUTONOMY_DECLARATION,
  spec_uri: sha256("ipfs://spec"),
  createdTime: now() - 86400 * 30,
};
const reader = (delivery = '{"answer":42}', envelope = spec) => ({
  read: async (u) => ({
    bytes: Buffer.from(
      u === "ipfs://spec" ? JSON.stringify(envelope) : delivery,
    ),
  }),
});
test("formal evidence earns a ruling without hidden truth labels", async () => {
  const c = config(),
    s = snap(),
    p = await collectEvidence(c, row, s, reader());
  assert.equal(p.decision, "approve");
  assert.equal(jobAction(c, s, row, p).action, "agent-win");
  assertProof(c, s, p);
});
test("actual failing bytes produce buyer win", async () => {
  const c = config(),
    s = snap(),
    p = await collectEvidence(c, row, s, reader('{"answer":41}'));
  assert.equal(p.decision, "reject");
  assert.equal(jobAction(c, s, row, p).action, "buyer-win");
});
test("missing evidence never becomes buyer-win evidence", async () => {
  await assert.rejects(
    collectEvidence(config(), row, snap(), {
      read: async () => {
        throw Error("NETWORK_UNAVAILABLE");
      },
    }),
  );
});
test("different moderator address is rejected", async () => {
  await assert.rejects(
    collectEvidence(
      config("moderator", { wallet: addr(7) }),
      row,
      snap(),
      reader(),
    ),
    /MODERATOR_NOT_NAMED/,
  );
});
test("uncommitted and semantic-only jobs are not adjudicated automatically", async () => {
  await assert.rejects(
    collectEvidence(config(), { ...row, details: "legacy" }, snap(), reader()),
    /AUTOMATION_NOT_COMMITTED/,
  );
  const v = structuredClone(spec);
  v.acceptance.profile = "computer-work/v1";
  assert.throws(() => autonomySpec(v, validateSpec), /FORMAL_ONLY/);
});
test("model cannot convert a failed formal check into a passing ruling", async () => {
  const c = config("moderator", { modelVeto: true }),
    s = snap();
  const p = await collectEvidence(c, row, s, reader('{"answer":0}'), {
    reviewer: async () => ({ verdict: "consistent", decision: "approve" }),
  });
  assert.equal(p.decision, "reject");
  assert.equal(jobAction(c, s, row, p).action, "buyer-win");
});
test("model concern and unavailable model abstain before signing", async () => {
  const c = config("moderator", { modelVeto: true });
  await assert.rejects(
    collectEvidence(c, row, snap(), reader(), {
      reviewer: async () => ({ verdict: "concern" }),
    }),
    /ABSTENTION/,
  );
  await assert.rejects(
    collectEvidence(c, row, snap(), reader()),
    /REVIEW_REQUIRED/,
  );
});
test("proof expiry, tampering and changed chain context are rejected", async () => {
  const c = config(),
    s = snap(),
    p = await collectEvidence(c, row, s, reader());
  assert.throws(
    () => assertProof(c, { ...s, context: "changed" }, p),
    /CONTEXT/,
  );
  assert.throws(() => assertProof(c, s, { ...p, decision: "reject" }), /HASH/);
  const old = { ...p, created: now() - 1000, expires: now() - 1 };
  delete old.hash;
  old.hash = sha256(canonical(old));
  assert.throws(() => assertProof(c, s, old), /EXPIRED/);
});
test("employer accepts only own work and disputes only within review window", async () => {
  const c = config("employer", { wallet: addr(1) }),
    s = snap({ disputed: false }),
    p = await collectEvidence(c, row, s, reader());
  assert.equal(jobAction(c, s, row, p).action, "accept");
  assert.throws(
    () => jobAction({ ...c, wallet: addr(4) }, s, row, p),
    /AUTHORITY/,
  );
  const late = snap({ disputed: false, reviewEnd: BigInt(now() - 1) }),
    bad = await collectEvidence(c, row, late, reader('{"answer":0}'));
  assert.equal(jobAction(c, late, row, bad), null);
});
test("recovery respects strict deadlines and pause-adjusted contract output", () => {
  const c = config("recovery"),
    s = snap({ neutralRefundAfter: BigInt(now()) });
  assert.equal(jobAction(c, s, row, null), null);
  assert.equal(
    jobAction(c, { ...s, now: s.now + 1 }, row, null).action,
    "refund",
  );
  assert.throws(
    () => jobAction(c, { ...s, paused: true }, row, null),
    /PAUSED/,
  );
});
test("conflicted moderator, unappointed signer and excessive job value are rejected", async () => {
  const c = config(),
    s = snap(),
    p = await collectEvidence(c, row, s, reader());
  assert.throws(() => jobAction(c, { ...s, buyer: c.wallet }, row, p));
  assert.throws(
    () => jobAction(c, { ...s, moderator: false }, row, p),
    /NOT_APPOINTED/,
  );
  assert.throws(
    () => jobAction(c, { ...s, payout: 1000000001n }, row, p),
    /VALUE_LIMIT/,
  );
});
test("signer scope rejects arbitrary calldata, transfer, foreign beneficiary and evidence role", () => {
  const c = config("recovery", { claimBeneficiaries: [addr(9)] }),
    chain = {
      c,
      iface: new Interface(ABI),
      token: { interface: new Interface(TOKEN_ABI) },
    },
    pin = { token: addr(12) },
    a = { action: "claim", beneficiary: addr(9) },
    r = requestFor(chain, pin, a);
  assertRequest(c, chain, pin, r, a);
  assert.throws(
    () => assertRequest(c, chain, pin, { ...r, to: addr(13) }, a),
    /SCOPE/,
  );
  assert.throws(
    () => assertRequest(c, chain, pin, { ...r, value: 1n }, a),
    /VALUE/,
  );
  assert.throws(
    () => assertRequest({ ...c, role: "evidence" }, chain, pin, r, a),
    /ROLE/,
  );
  const x = { action: "claim", beneficiary: addr(7) };
  assert.throws(
    () => assertRequest(c, chain, pin, requestFor(chain, pin, x), x),
    /BENEFICIARY/,
  );
});
test("shards partition every job exactly once", () => {
  for (let id = 0; id < 1000; id++) {
    let n = 0;
    for (let shardIndex = 0; shardIndex < 9; shardIndex++)
      n += inShard({ ...config(), shardCount: 9, shardIndex }, String(id));
    assert.equal(n, 1);
  }
});
test("duplicate and prototype JSON keys are rejected", () => {
  for (const text of ['{"a":1,"a":2}', '{"__proto__":{"admin":true}}'])
    assert.throws(() => boundedJSON(Buffer.from(text)));
});
test("configuration rejects hidden fields and remote model gateways", () => {
  assert.throws(() => validateConfig({ ...config(), unlimited: true }));
  assert.throws(
    () =>
      validateConfig({ ...config(), gatewayURL: "https://attacker.invalid" }),
    /LOOPBACK/,
  );
});
