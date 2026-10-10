import test from "node:test";
import assert from "node:assert/strict";
import { keccak256, ZeroHash } from "ethers";
import { Chain } from "../src/chain.mjs";
import { NodeError } from "../src/util.mjs";
function fixture() {
  const c = Object.create(Chain.prototype),
    seen = [];
  c.c = { agent: "0x" + "1".repeat(40), label: "worker", proof: [] };
  c.head = async () => ({ number: 123, hash: ZeroHash });
  c.identityCode = {
    address: "0x" + "2".repeat(40),
    codeHash: keccak256("0x01"),
  };
  c.provider = {
    getCode: async (_a, b) => {
      assert.equal(b, 123);
      return "0x01";
    },
    getBlock: async () => ({ hash: ZeroHash }),
  };
  const value =
    (name, result) =>
    async (...args) => {
      assert.deepEqual(args.at(-1), { blockTag: 123 });
      seen.push({ name, args });
      return result;
    };
  c.manager = Object.fromEntries(
    Object.entries({
      blacklistedAgents: false,
      additionalAgents: false,
      agentMerkleRoot: ZeroHash,
      ens: "0x" + "3".repeat(40),
      nameWrapper: "0x" + "4".repeat(40),
      agentRootNode: ZeroHash,
      alphaAgentRootNode: ZeroHash,
    }).map(([k, v]) => [k, value("manager." + k, v)]),
  );
  c.ownership = {
    verifyMerkleOwnership: value("merkle", false),
    ["verifyENSOwnership(address,address,address,string,bytes32,bytes32)"]:
      value("ens", false),
  };
  return { c, seen, value };
}
test("unlisted nonblacklisted wallet no longer claims eligibility without role authorization", async () => {
  const { c, seen } = fixture();
  const r = await c.agentHealth();
  assert.equal(r.eligible, false);
  assert.equal(r.eligibility, "not-authorized");
  assert.ok(seen.some((s) => s.name === "merkle"));
  assert.ok(seen.some((s) => s.name === "ens"));
  await assert.rejects(c.assertAgentAuthorized(), /AGENT_NOT_AUTHORIZED/);
});
test("allowlist, role Merkle and exact ENS library routes are verified at one coherent block", async () => {
  for (const route of ["allowlist", "merkle", "ens"]) {
    const { c, value, seen } = fixture();
    if (route === "allowlist")
      c.manager.additionalAgents = value("additionalAgents", true);
    else if (route === "merkle")
      c.ownership.verifyMerkleOwnership = value("merkle", true);
    else
      c.ownership[
        "verifyENSOwnership(address,address,address,string,bytes32,bytes32)"
      ] = value("ens", true);
    const r = await c.assertAgentAuthorized();
    assert.equal(r.route, route);
    assert.equal(r.blockNumber, 123);
    for (const read of seen.filter((s) => ["merkle", "ens"].includes(s.name)))
      assert.equal(read.args[read.name === "ens" ? 2 : 0], c.c.agent);
  }
});
test("blacklisting overrides valid exception and stale/missing code or a reorg cannot give a pass", async () => {
  const { c, value } = fixture();
  c.manager.additionalAgents = value("additionalAgents", true);
  c.manager.blacklistedAgents = value("blacklistedAgents", true);
  assert.equal((await c.agentHealth()).eligible, false);
  c.manager.blacklistedAgents = value("blacklistedAgents", false);
  c.provider.getBlock = async () => ({ hash: "changed" });
  await assert.rejects(c.agentHealth(), /IDENTITY_OBSERVATION_REORG/);
  c.provider.getCode = async () => "0x02";
  await assert.rejects(c.agentHealth(), /DEPLOYMENT_CODE_CHANGED/);
});
test("RPC outage is unverified; a corroboration disagreement propagates its signing stop", async () => {
  const { c } = fixture();
  c.manager.agentMerkleRoot = async () => {
    throw Error("private RPC secret");
  };
  const r = await c.agentHealth();
  assert.equal(r.eligible, false);
  assert.equal(r.eligibility, "unverified");
  assert.ok(!JSON.stringify(r).includes("secret"));
  c.manager.agentMerkleRoot = async () => {
    throw new NodeError("RPC_DISAGREEMENT");
  };
  await assert.rejects(c.agentHealth(), /RPC_DISAGREEMENT/);
  delete c.identityCode;
  assert.equal((await c.agentHealth()).eligible, false);
});
