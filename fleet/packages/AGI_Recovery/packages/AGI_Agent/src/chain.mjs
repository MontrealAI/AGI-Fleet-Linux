import { AUTONOMY_DECLARATION } from './autonomy.mjs';
import {
  Contract,
  JsonRpcProvider,
  FetchRequest,
  Interface,
  getAddress,
  keccak256,
  ZeroAddress,
  ZeroHash,
} from "ethers";
import path from "node:path";
import {
  ROOT,
  readJSON,
  ensure,
  canonical,
  sha256,
  pool,
  codeOf,
} from "./util.mjs";
import { AGENT_DECLARATION, shardFor } from "./work.mjs";
import { DECLARATION } from "./review.mjs";
import { rpcURL } from "./config.mjs";
export const artifacts = Object.fromEntries(
  [
    "AGIJobManager",
    "UriUtils",
    "TransferUtils",
    "BondMath",
    "ReputationMath",
    "ENSOwnership",
    "NftEligibility",
    "JobSettlement",
    "JobValidation",
  ].map((n) => [
    n,
    readJSON(path.join(ROOT, "contract/artifacts", n + ".json")),
  ]),
);
export const ABI = artifacts.AGIJobManager.abi;
export const TOKEN_ABI = [
  "function decimals() view returns(uint8)",
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
];
export const NATIVE_USDC = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
};
export function matchRuntime(name, address, code, token, known = {}) {
  const a = artifacts[name];
  ensure(a, "UNRECOGNIZED_LIBRARY");
  ensure(code.length === a.deployedBytecode.length, "RUNTIME_LENGTH_MISMATCH");
  let expected = a.deployedBytecode;
  const patch = (start, length, value) => {
    ensure(value.length === length * 2, "RUNTIME_PATCH");
    expected =
      expected.slice(0, 2 + start * 2) +
      value +
      expected.slice(2 + (start + length) * 2);
  };
  for (const byName of Object.values(a.deployedLinkReferences))
    for (const [lib, refs] of Object.entries(byName))
      for (const ref of refs) {
        const target = getAddress(
          "0x" +
            code.slice(2 + ref.start * 2, 2 + (ref.start + ref.length) * 2),
        );
        ensure(
          target !== ZeroAddress && (!known[lib] || known[lib] === target),
          "LIBRARY_ADDRESS_MISMATCH",
        );
        known[lib] = target;
        patch(ref.start, ref.length, target.slice(2).toLowerCase());
      }
  for (const refs of Object.values(a.immutableReferences))
    for (const ref of refs)
      patch(
        ref.start,
        ref.length,
        (name === "AGIJobManager" ? token : address)
          .slice(2)
          .toLowerCase()
          .padStart(ref.length * 2, "0"),
      );
  ensure(
    expected.toLowerCase() === code.toLowerCase(),
    "RUNTIME_BYTECODE_MISMATCH",
  );
  return known;
}
export class Chain {
  constructor(c, provider = null) {
    this.c = c;
    if (provider) this.provider = provider;
    else {
      const request = new FetchRequest(rpcURL(c));
      request.timeout = 30000;
      request.setThrottleParams({ maxAttempts: 2, slotInterval: 1000 });
      this.provider = new JsonRpcProvider(request, undefined, {
        cacheTimeout: -1,
      });
    }
    this.manager = new Contract(c.manager, ABI, this.provider);
    this.iface = new Interface(ABI);
  }
  async head() {
    const network = await this.provider.getNetwork();
    ensure(Number(network.chainId) === this.c.chainId, "WRONG_CHAIN");
    const head = await this.provider.getBlock("latest");
    ensure(head && head.hash, "CHAIN_HEAD_UNAVAILABLE");
    const age = Math.floor(Date.now() / 1000) - head.timestamp;
    ensure(
      age <= this.c.maxBlockAgeSeconds && age >= -90,
      "STALE_CHAIN_OR_CLOCK",
    );
    return head;
  }
  async safeHeight(head) {
    const depth = head.number - this.c.confirmations + 1;
    if (this.c.chainId === 31337) return depth;
    const final = await this.provider.getBlock("finalized");
    ensure(
      final && final.hash && final.number <= head.number,
      "FINALIZED_BLOCK_UNAVAILABLE",
    );
    this.lastFinalized = final.number;
    return Math.min(depth, final.number);
  }
  async enroll() {
    const head = await this.head();
    ensure(
      this.c.deploymentBlock > 0 &&
        this.c.deploymentBlock <= (await this.safeHeight(head)),
      "DEPLOYMENT_BLOCK_REQUIRED",
    );
    ensure(
      (await this.provider.getCode(
        this.c.manager,
        this.c.deploymentBlock - 1,
      )) === "0x",
      "DEPLOYMENT_BLOCK_NOT_CREATION",
    );
    ensure(
      (await this.provider.getCode(this.c.manager, this.c.deploymentBlock)) !==
        "0x",
      "NO_CODE_AT_DEPLOYMENT_BLOCK",
    );
    const token = getAddress(
      await this.manager.usdcToken({ blockTag: head.number }),
    );
    if (this.c.chainId !== 31337)
      ensure(
        token === getAddress(NATIVE_USDC[this.c.chainId]),
        "NOT_NATIVE_USDC",
      );
    this.token = new Contract(token, TOKEN_ABI, this.provider);
    ensure(
      Number(await this.token.decimals({ blockTag: head.number })) === 6,
      "USDC_DECIMALS",
    );
    const known = {},
      codes = {},
      addresses = { AGIJobManager: getAddress(this.c.manager) };
    const todo = ["AGIJobManager"];
    while (todo.length) {
      const name = todo.shift(),
        address = addresses[name],
        code = await this.provider.getCode(address, head.number);
      matchRuntime(name, address, code, token, known);
      codes[name] = { address, codeHash: keccak256(code) };
      for (const [lib, addr] of Object.entries(known)) {
        if (addresses[lib])
          ensure(addresses[lib] === addr, "LIBRARY_ADDRESS_MISMATCH");
        else {
          addresses[lib] = addr;
          todo.push(lib);
        }
      }
    }
    ensure(Object.keys(codes).length === 9, "INCOMPLETE_LIBRARY_GRAPH");
    return {
      schema: 1,
      chainId: this.c.chainId,
      manager: getAddress(this.c.manager),
      token,
      deploymentBlock: this.c.deploymentBlock,
      sourceTag: "v1.1.0",
      sourceCommit: "db876a8021da6afcf7aa974489d13374e6d188b5",
      contracts: codes,
    };
  }
  async verify(pin) {
    const head = await this.head();
    await this.safeHeight(head);
    ensure(
      pin.chainId === this.c.chainId &&
        pin.manager === getAddress(this.c.manager) &&
        pin.deploymentBlock === this.c.deploymentBlock &&
        Object.keys(pin.contracts).length === 9,
      "DEPLOYMENT_PIN_MISMATCH",
    );
    await pool(Object.values(pin.contracts), 4, async (p) =>
      ensure(
        keccak256(await this.provider.getCode(p.address, head.number)) ===
          p.codeHash,
        "DEPLOYMENT_CODE_CHANGED",
      ),
    );
    ensure(
      getAddress(await this.manager.usdcToken({ blockTag: head.number })) ===
        pin.token,
      "TOKEN_CHANGED",
    );
    this.token = new Contract(pin.token, TOKEN_ABI, this.provider);
    ensure(
      Number(await this.token.decimals({ blockTag: head.number })) === 6,
      "USDC_DECIMALS",
    );
    this.identityCode = pin.contracts.ENSOwnership;
    this.ownership = new Contract(
      this.identityCode.address,
      artifacts.ENSOwnership.abi,
      this.provider,
    );
    return head;
  }
  async agentHealth() {
    try {
      ensure(this.identityCode && this.ownership, "AGENT_IDENTITY_UNVERIFIED");
      const block = await this.head(),
        o = { blockTag: block.number };
      ensure(
        keccak256(
          await this.provider.getCode(this.identityCode.address, block.number),
        ) === this.identityCode.codeHash,
        "DEPLOYMENT_CODE_CHANGED",
      );
      const [blacklisted, listed] = await Promise.all([
        this.manager.blacklistedAgents(this.c.agent, o),
        this.manager.additionalAgents(this.c.agent, o),
      ]);
      let route = null;
      if (!blacklisted) {
        if (listed) route = "allowlist";
        else {
          const root = await this.manager.agentMerkleRoot(o);
          if (
            await this.ownership.verifyMerkleOwnership(
              this.c.agent,
              this.c.proof,
              root,
              o,
            )
          )
            route = "merkle";
          else if (this.c.label) {
            const [ens, wrapper, primary, secondary] = await Promise.all([
              this.manager.ens(o),
              this.manager.nameWrapper(o),
              this.manager.agentRootNode(o),
              this.manager.alphaAgentRootNode(o),
            ]);
            // Execute the exact pinned view library, including its label rules,
            // wrapped approvals, resolver rules and bounded staticcalls.
            if (
              await this.ownership[
                "verifyENSOwnership(address,address,address,string,bytes32,bytes32)"
              ](ens, wrapper, this.c.agent, this.c.label, primary, secondary, o)
            )
              route = "ens";
          }
        }
      }
      ensure(
        (await this.provider.getBlock(block.number))?.hash === block.hash,
        "IDENTITY_OBSERVATION_REORG",
      );
      return {
        eligible: !blacklisted && route !== null,
        listed,
        blacklisted,
        eligibility: route ? "verified" : "not-authorized",
        route,
        reason: blacklisted
          ? "AGENT_BLACKLISTED"
          : route
            ? null
            : "AGENT_NOT_AUTHORIZED",
        controller: this.c.agent,
        blockNumber: block.number,
        blockHash: block.hash,
      };
    } catch (error) {
      const code = codeOf(error);
      if (
        /RPC_DISAGREEMENT|REORG|CODE_CHANGED|WRONG_CHAIN|PIN_MISMATCH/.test(
          code,
        )
      )
        throw error;
      return {
        eligible: false,
        listed: null,
        blacklisted: null,
        eligibility: "unverified",
        route: null,
        controller: this.c.agent,
        reason: "AGENT_IDENTITY_UNVERIFIED",
      };
    }
  }
  async assertAgentAuthorized() {
    const result = await this.agentHealth();
    ensure(
      result.eligible === true && result.eligibility === "verified",
      result.reason ?? "AGENT_IDENTITY_UNVERIFIED",
    );
    return result;
  }
  async snapshot(id) {
    const block = await this.head(),
      o = { blockTag: block.number };
    const [
      core,
      v,
      b,
      d,
      specURI,
      completionURI,
      paused,
      intakePaused,
      blacklisted,
      bps,
      min,
      max,
      durationLimit,
      nftRequired,
      nftScore,
      quorum,
    ] = await Promise.all([
      this.manager.getJobCore(id, o),
      this.manager.getJobValidation(id, o),
      this.manager.getJobBonds(id, o),
      this.manager.getJobDeadlines(id, o),
      this.manager.getJobSpecURI(id, o),
      this.manager.getJobCompletionURI(id, o),
      this.manager.settlementPaused(o),
      this.manager.paused(o),
      this.manager.blacklistedAgents(this.c.agent, o),
      this.manager.agentBondBps(o),
      this.manager.agentBond(o),
      this.manager.agentBondMax(o),
      this.manager.jobDurationLimit(o),
      this.manager.jobAgentNftRequired(id, o),
      this.manager.getHighestPayoutPercentage(this.c.agent, o),
      this.manager.voteQuorum(o),
    ]);
    let bond = b.agentAmount;
    if (core.assignedAgent === ZeroAddress) {
      bond = (core.payout * bps) / 10000n;
      if (bond < min) bond = min;
      if (durationLimit !== 0n) bond += (bond * core.duration) / durationLimit;
      if (max !== 0n && bond > max) bond = max;
      if (bond > core.payout) bond = core.payout;
    }
    const r = {
      id: String(id),
      buyer: core.employer,
      agent: core.assignedAgent,
      payout: core.payout,
      duration: core.duration,
      completed: core.completed,
      expired: core.expired,
      disputed: core.disputed,
      requested: v.completionRequested,
      approvals: v.validatorApprovals,
      disapprovals: v.validatorDisapprovals,
      quorum,
      deadline: d.assignmentDeadline,
      settlementAfter: d.settlementAfter,
      neutralRefundAfter: d.neutralRefundAfter,
      bond,
      specURI,
      completionURI,
      paused,
      intakePaused,
      blacklisted,
      nftRequired,
      nftScore,
      reward: (core.payout * BigInt(core.agentPayoutPct)) / 100n,
    };
    return {
      ...r,
      context: sha256(canonical(r)),
      now: block.timestamp,
      blockNumber: block.number,
      blockHash: block.hash,
    };
  }
  eligible(s) {
    if (s.completed || s.expired) return "JOB_TERMINAL";
    if (s.agent !== ZeroAddress) return "JOB_ALREADY_ASSIGNED";
    if (s.disputed || s.requested) return "JOB_NOT_OPEN";
    if (s.paused || s.intakePaused) return "CONTRACT_PAUSED";
    if (s.blacklisted) return "AGENT_BLACKLISTED";
    if (s.nftRequired && s.nftScore === 0n) return "AGENT_NFT_REQUIRED";
    if (
      s.buyer.toLowerCase() === this.c.agent.toLowerCase() ||
      this.c.excludedParties.some(
        (a) => a.toLowerCase() === s.buyer.toLowerCase(),
      )
    )
      return "CONFLICT_OF_INTEREST";
    if (
      !this.c.trustedBuyers.some(
        (a) => a.toLowerCase() === s.buyer.toLowerCase(),
      )
    )
      return "BUYER_NOT_IN_SCOPE";
    if (
      s.duration <
      BigInt(
        Math.max(
          3600,
          this.c.submissionBufferSeconds + this.c.confirmations * 24,
        ),
      )
    )
      return "JOB_DURATION_TOO_SHORT";
    if (
      shardFor(
        this.c.chainId,
        this.c.manager,
        s.id,
        this.c.execution.shardCount,
      ) !== this.c.execution.shardIndex
    )
      return "OTHER_FLEET_SHARD";
    return null;
  }
  request(name, id, extra = []) {
    return {
      to: this.c.manager,
      data: this.iface.encodeFunctionData(name, [id, ...extra]),
    };
  }
  applyRequest(id) {
    return this.request("applyForJob", id, [this.c.label, this.c.proof]);
  }
  submitRequest(id, uri) {
    return this.request("requestJobCompletion", id, [uri]);
  }
  async logs(from, to) {
    const topics = [
      "JobCreated",
      "JobApplied",
      "JobCompletionRequested",
      "JobCompleted",
      "JobCancelled",
      "JobExpired",
    ].map((n) => this.iface.getEvent(n).topicHash);
    try {
      return await this.provider.getLogs({
        address: this.c.manager,
        fromBlock: from,
        toBlock: to,
        topics: [topics],
      });
    } catch (e) {
      if (from === to || to - from < 8) throw e;
      const mid = Math.floor((from + to) / 2);
      return [
        ...(await this.logs(from, mid)),
        ...(await this.logs(mid + 1, to)),
      ];
    }
  }
  async scan(store) {
    const head = await this.head(),
      target = await this.safeHeight(head);
    let cursor = store.meta("cursor", {
      number: this.c.deploymentBlock - 1,
      hash: null,
    });
    if (cursor.hash)
      ensure(
        (await this.provider.getBlock(cursor.number))?.hash === cursor.hash,
        "CHAIN_REORG_REINDEX_REQUIRED",
      );
    for (let n = 0; n < this.c.chunksPerCycle && cursor.number < target; n++) {
      const from = cursor.number + 1,
        to = Math.min(target, from + this.c.logChunk - 1),
        logs = await this.logs(from, to),
        block = await this.provider.getBlock(to);
      ensure(block?.hash, "SCAN_BLOCK_MISSING");
      const hashes = new Map();
      for (const l of logs) {
        if (!hashes.has(l.blockNumber))
          hashes.set(
            l.blockNumber,
            (await this.provider.getBlock(l.blockNumber))?.hash,
          );
        ensure(
          !l.removed && hashes.get(l.blockNumber) === l.blockHash,
          "SCAN_REORG",
        );
      }
      store.transaction(() => {
        for (const l of logs) {
          const e = this.iface.parseLog(l),
            id = e.args.jobId.toString();
          if(["JobCancelled","JobCompleted","JobExpired"].includes(e.name))store.set("admissionTerminal:"+id,{transactionHash:l.transactionHash,event:e.name,blockNumber:l.blockNumber,blockHash:l.blockHash});
          if (e.name === "JobCreated")
            store.putJob(id, {
              created_block: l.blockNumber,
              spec_uri: sha256(e.args.jobSpecURI),
              details: [DECLARATION, AGENT_DECLARATION, AUTONOMY_DECLARATION].includes(e.args.details)
                ? e.args.details
                : "unsupported",
            });
          else if (e.name === "JobApplied") {
            const own =
              e.args.agent.toLowerCase() === this.c.agent.toLowerCase();
            store.putJob(id, {
              owned: own ? 1 : 0,
              status: own ? "assigned" : "lost",
              reason: own ? "DELIVERY_READY" : "ASSIGNED_TO_ANOTHER_AGENT",
            });
          } else if (e.name === "JobCompletionRequested")
            store.putJob(id, {
              requested: 1,
              status: store.job(id)?.owned ? "submitted" : "lost",
            });
          else store.putJob(id, { status: "terminal", bond: "0" });
        }
        cursor = { number: to, hash: block.hash };
        store.set("cursor", cursor);
      });
    }
    return {
      head: head.number,
      scanned: cursor.number,
      caughtUp: cursor.number >= target,
    };
  }
}
