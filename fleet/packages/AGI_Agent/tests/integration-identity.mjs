// Isolated chain 31337 only. No public provider, funded account or job publication.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import hre from "hardhat";
import solc from "solc";
import {
  BrowserProvider,
  ContractFactory,
  HDNodeWallet,
  ZeroAddress,
  ZeroHash,
  namehash,
  solidityPackedKeccak256,
} from "ethers";
import { Chain, artifacts } from "../src/chain.mjs";
import { DEFAULT, validateConfig } from "../src/config.mjs";
const connection = await hre.network.connect("hardhat"),
  provider = new BrowserProvider(connection.provider, undefined, {
    cacheTimeout: -1,
  });
assert.equal(Number((await provider.getNetwork()).chainId), 31337);
const wallets = Array.from({ length: 5 }, (_, i) =>
  HDNodeWallet.fromPhrase(
    "test test test test test test test test test test test junk",
    undefined,
    `m/44'/60'/0'/0/${i}`,
  ).connect(provider),
);
const [owner, agent, other, w30, w10] = wallets,
  addresses = {},
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-identity-integration-"));
const mined = async (p) => (await p).wait();
async function deploy(name, args = []) {
  const a =
    artifacts[name] ??
    JSON.parse(
      fs.readFileSync(
        new URL("../contract/artifacts/" + name + ".json", import.meta.url),
      ),
    );
  let code = a.bytecode;
  for (const libs of Object.values(a.linkReferences))
    for (const [lib, refs] of Object.entries(libs)) {
      if (!addresses[lib]) await deploy(lib);
      for (const r of refs)
        code =
          code.slice(0, 2 + r.start * 2) +
          addresses[lib].slice(2).toLowerCase() +
          code.slice(2 + (r.start + r.length) * 2);
    }
  const c = await new ContractFactory(a.abi, code, owner).deploy(...args);
  await c.waitForDeployment();
  addresses[name] = await c.getAddress();
  return c;
}
try {
  const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
contract IdentityFixture {
 mapping(uint256=>address) public ownerOf; mapping(uint256=>address) public getApproved;
 mapping(address=>mapping(address=>bool)) public isApprovedForAll; mapping(bytes32=>address) public addr;
 function resolver(bytes32) external view returns(address) {return address(this);}
 function set(bytes32 node,address owner,address approved,address resolved) external {ownerOf[uint256(node)]=owner;getApproved[uint256(node)]=approved;addr[node]=resolved;}
 function operator(address owner,address who,bool allow) external {isApprovedForAll[owner][who]=allow;}
}`;
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "Fixture.sol": { content: source } },
        settings: {
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
    ),
  );
  assert.ok(
    !output.errors?.some((e) => e.severity === "error"),
    JSON.stringify(output.errors),
  );
  const art = output.contracts["Fixture.sol"].IdentityFixture;
  const fixture = await new ContractFactory(
    art.abi,
    art.evm.bytecode.object,
    owner,
  ).deploy();
  await fixture.waitForDeployment();
  const f = await fixture.getAddress();
  await deploy("MockERC20");
  const primary = namehash("agent.agi.eth"),
    secondary = namehash("alpha.agent.agi.eth");
  const manager = await deploy("AGIJobManager", [
    addresses.MockERC20,
    "ipfs://",
    [f, f],
    [ZeroHash, primary, ZeroHash, secondary],
    [ZeroHash, ZeroHash],
    [w30.address, w10.address],
  ]);
  const c = validateConfig(
    {
      ...structuredClone(DEFAULT),
      chainId: 31337,
      confirmations: 1,
      manager: addresses.AGIJobManager,
      agent: agent.address,
      label: "worker",
      deploymentBlock: (await manager.deploymentTransaction().wait())
        .blockNumber,
      dataDir: dir,
    },
    dir,
  );
  const chain = new Chain(c, provider),
    pin = await chain.enroll();
  await chain.verify(pin);
  const check = async (expected, route = null) => {
    const r = await chain.agentHealth();
    assert.equal(r.eligible, expected, JSON.stringify(r));
    assert.equal(r.route, route);
  };
  await check(false);
  await mined(manager.addAdditionalAgent(agent.address));
  await check(true, "allowlist");
  await mined(manager.blacklistAgent(agent.address, true));
  await check(false);
  await mined(manager.blacklistAgent(agent.address, false));
  await mined(manager.removeAdditionalAgent(agent.address));
  await check(false);
  console.log("PASS allowlist admission, revocation and blacklist override");
  const node = namehash("worker.agent.agi.eth");
  await mined(fixture.set(node, agent.address, ZeroAddress, ZeroAddress));
  await check(true, "ens");
  c.label = "wrong";
  await check(false);
  c.label = "worker";
  c.agent = other.address;
  await check(false);
  c.agent = agent.address;
  await mined(fixture.set(node, other.address, agent.address, ZeroAddress));
  await check(true, "ens");
  await mined(fixture.set(node, other.address, ZeroAddress, ZeroAddress));
  await check(false);
  await mined(fixture.operator(other.address, agent.address, true));
  await check(true, "ens");
  await mined(fixture.operator(other.address, agent.address, false));
  await check(false);
  await mined(fixture.set(node, ZeroAddress, ZeroAddress, agent.address));
  await check(true, "ens");
  await mined(fixture.set(node, ZeroAddress, ZeroAddress, other.address));
  await check(false);
  await mined(
    fixture.set(
      namehash("worker.alpha.agent.agi.eth"),
      agent.address,
      ZeroAddress,
      ZeroAddress,
    ),
  );
  await check(true, "ens");
  console.log(
    "PASS primary/secondary ENS, owner, token approval, operator approval, resolver, wrong wallet/label and revoked permissions",
  );
  c.label = "";
  const leaf = solidityPackedKeccak256(["address"], [agent.address]);
  await mined(manager.updateMerkleRoots(ZeroHash, leaf));
  await check(true, "merkle");
  c.proof = [ZeroHash];
  await check(false);
  c.proof = [];
  c.agent = other.address;
  await check(false);
  c.agent = agent.address;
  await mined(manager.updateMerkleRoots(ZeroHash, ZeroHash));
  await check(false);
  console.log(
    "PASS role-specific Merkle route, invalid proof, wrong claimant and root revocation",
  );
  console.log(
    "IDENTITY INTEGRATION PASSED: exact manager and pinned ENSOwnership library; no financial job or model call.",
  );
} finally {
  provider.destroy();
  await connection.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
