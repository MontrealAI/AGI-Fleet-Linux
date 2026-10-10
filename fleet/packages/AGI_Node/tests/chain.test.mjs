import test from "node:test";
import assert from "node:assert/strict";
import { Chain } from "../src/chain.mjs";
import { DEFAULT } from "../src/config.mjs";
import { ZeroAddress, ZeroHash } from "ethers";
function make() {
  return new Chain(
    {
      ...structuredClone(DEFAULT),
      manager: "0x0000000000000000000000000000000000000001",
      validator: "0x0000000000000000000000000000000000000002",
    },
    {},
  );
}
test("public finalized height and depth both gate scanning/receipt acceptance", async () => {
  const c = make();
  c.provider = {
    getBlock: async (tag) => {
      assert.equal(tag, "finalized");
      return { number: 90, hash: ZeroHash };
    },
  };
  assert.equal(await c.safeHeight({ number: 100 }), 89);
  c.c.confirmations = 3;
  assert.equal(await c.safeHeight({ number: 100 }), 90);
  c.provider.getBlock = async () => null;
  await assert.rejects(
    c.safeHeight({ number: 100 }),
    /FINALIZED_BLOCK_UNAVAILABLE/,
  );
  c.c.chainId = 31337;
  assert.equal(await c.safeHeight({ number: 100 }), 98);
});
test("log range subdivision preserves all blocks when provider enforces smaller windows", async () => {
  const c = make(),
    calls = [];
  c.provider = {
    getLogs: async (q) => {
      calls.push([q.fromBlock, q.toBlock]);
      if (q.toBlock - q.fromBlock >= 8) throw Error("too large");
      return Array.from(
        { length: q.toBlock - q.fromBlock + 1 },
        (_, i) => q.fromBlock + i,
      );
    },
  };
  assert.deepEqual(
    await c.logs(1, 20),
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
  assert.ok(calls.length > 1);
});
test("eligibility rejects conflict, unknown credential, full validator slots and short deadline", () => {
  const c = make(),
    buyer = "0x0000000000000000000000000000000000000003";
  c.c.trustedBuyers = [buyer];
  const s = {
    completed: false,
    expired: false,
    requested: true,
    disputed: false,
    paused: false,
    blacklisted: false,
    credential: "0x" + "1".repeat(64),
    controller: c.c.validator,
    buyer,
    agent: "0x0000000000000000000000000000000000000004",
    approvals: 0n,
    disapprovals: 0n,
    reviewEnd: 1000n,
    now: 500,
  };
  assert.equal(c.eligible(s), null);
  assert.equal(
    c.eligible({ ...s, credential: ZeroHash }),
    "VALIDATOR_NOT_AUTHORIZED",
  );
  assert.equal(
    c.eligible({ ...s, controller: ZeroAddress }),
    "VALIDATOR_NOT_AUTHORIZED",
  );
  assert.equal(
    c.eligible({ ...s, buyer: c.c.validator }),
    "CONFLICT_OF_INTEREST",
  );
  assert.equal(c.eligible({ ...s, approvals: 50n }), "VALIDATOR_LIMIT_REACHED");
  assert.equal(
    c.eligible({ ...s, reviewEnd: 600n }),
    "REVIEW_WINDOW_TOO_SHORT",
  );
});
