import { JsonRpcProvider, FetchRequest, toQuantity } from "ethers";
import { ensure, canonical, atomicWrite, NodeError } from "./util.mjs";
import path from "node:path";
const dynamic = (tag) =>
  tag === undefined || ["latest", "safe", "finalized"].includes(tag);
const header = (b) =>
  b &&
  Object.fromEntries(
    [
      "number",
      "hash",
      "parentHash",
      "timestamp",
      "stateRoot",
      "receiptsRoot",
      "transactionsRoot",
    ].map((k) => [k, b[k]]),
  );
const log = (l) =>
  Object.fromEntries(
    [
      "address",
      "topics",
      "data",
      "blockNumber",
      "blockHash",
      "transactionHash",
      "transactionIndex",
      "logIndex",
      "removed",
    ].map((k) => [k, l[k] ?? (k === "removed" ? false : null)]),
  );
function projection(method, value) {
  if (method === "getBlock") return header(value);
  if (method === "getLogs")
    return value
      .map(log)
      .sort(
        (a, b) =>
          Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) ||
          Number(BigInt(a.logIndex) - BigInt(b.logIndex)),
      );
  if (method === "getTransactionReceipt")
    return (
      value && {
        transactionHash: value.transactionHash,
        blockHash: value.blockHash,
        blockNumber: value.blockNumber,
        from: value.from,
        to: value.to,
        contractAddress: value.contractAddress,
        status: value.status,
        gasUsed: value.gasUsed,
        logs: value.logs.map(log),
      }
    );
  if (method === "getTransaction")
    return (
      value &&
      Object.fromEntries(
        [
          "hash",
          "from",
          "to",
          "nonce",
          "input",
          "value",
          "chainId",
          "blockHash",
          "blockNumber",
        ].map((k) => [k, value[k] ?? null]),
      )
    );
  return value;
}
export function rpcRequest(url) {
  const r = new FetchRequest(url);
  r.timeout = 15000;
  r.setThrottleParams({ maxAttempts: 2, slotInterval: 500 });
  return r;
}
// Every security-sensitive read is corroborated. No automatic single-provider fallback.
export class VerifiedProvider extends JsonRpcProvider {
  constructor(primaryURL, witnessURL, dataDir, options = {}) {
    super(rpcRequest(primaryURL), undefined, { cacheTimeout: -1 });
    this.witness =
      options.witness ??
      new JsonRpcProvider(rpcRequest(witnessURL), undefined, {
        cacheTimeout: -1,
      });
    this.primaryPerform = options.primaryPerform ?? ((r) => super._perform(r));
    this.onDisagreement =
      options.onDisagreement ??
      (() => atomicWrite(path.join(dataDir, "STOP"), "RPC_DISAGREEMENT\n"));
    this.verified = true;
    this.verification = { checkedAt: null, block: null, lastError: null };
    this.fault = false;
  }
  disagree() {
    this.fault = true;
    this.verification.lastError = "RPC_DISAGREEMENT";
    this.onDisagreement();
    throw new NodeError("RPC_DISAGREEMENT");
  }
  async pair(request) {
    const values = await Promise.allSettled([
      this.primaryPerform(request),
      this.witness._perform(request),
    ]);
    ensure(!this.fault, "RPC_DISAGREEMENT");
    if (values.some((v) => v.status === "rejected")) {
      this.verification.lastError = "RPC_VERIFICATION_UNAVAILABLE";
      // Preserve a genuine dual simulation revert for the caller; never sign it.
      if (
        request.method === "call" &&
        values.every(
          (v) => v.status === "rejected" && v.reason?.code === "CALL_EXCEPTION",
        )
      )
        throw values[0].reason;
      throw new NodeError("RPC_VERIFICATION_UNAVAILABLE");
    }
    return values.map((v) => v.value);
  }
  compare(method, a, b) {
    ensure(!this.fault, "RPC_DISAGREEMENT");
    if (canonical(projection(method, a)) !== canonical(projection(method, b)))
      this.disagree();
    this.verification.checkedAt = new Date().toISOString();
    this.verification.lastError = null;
    return a;
  }
  async agreedBlock(tag = "latest") {
    const [chainA, chainB] = await this.pair({ method: "chainId" });
    this.compare("chainId", chainA, chainB);
    let [a, b] = await this.pair({
      method: "getBlock",
      blockTag: tag,
      includeTransactions: false,
    });
    ensure(a && b && a.hash && b.hash, "RPC_VERIFICATION_UNAVAILABLE");
    if (a.number !== b.number) {
      const height = BigInt(a.number) < BigInt(b.number) ? a.number : b.number;
      [a, b] = await this.pair({
        method: "getBlock",
        blockTag: height,
        includeTransactions: false,
      });
    }
    this.compare("getBlock", a, b);
    this.verification.block = Number(BigInt(a.number));
    return a;
  }
  async _perform(request) {
    ensure(!this.fault, "RPC_DISAGREEMENT");
    const m = request.method;
    if (m === "getBlockNumber") {
      const [a, b] = await this.pair(request);
      return BigInt(a) < BigInt(b) ? a : b;
    }
    if (
      m === "getBlock" &&
      dynamic(request.blockTag) &&
      !request.blockHash &&
      !request.includeTransactions
    )
      return this.agreedBlock(request.blockTag ?? "latest");
    const reads = [
      "chainId",
      "getBlock",
      "getBalance",
      "getTransactionCount",
      "getCode",
      "getStorage",
      "call",
      "getLogs",
      "getTransactionReceipt",
      "getTransaction",
    ];
    if (reads.includes(m)) {
      let r = { ...request },
        block = null;
      if (
        [
          "getBalance",
          "getTransactionCount",
          "getCode",
          "getStorage",
          "call",
        ].includes(m) &&
        dynamic(r.blockTag)
      ) {
        block = await this.agreedBlock(r.blockTag ?? "latest");
        r.blockTag = block.number;
      }
      if (
        m === "getLogs" &&
        !r.filter.blockHash &&
        (dynamic(r.filter.toBlock) || dynamic(r.filter.fromBlock))
      ) {
        block = await this.agreedBlock();
        r.filter = {
          ...r.filter,
          fromBlock: r.filter.fromBlock ?? "0x0",
          toBlock: dynamic(r.filter.toBlock) ? block.number : r.filter.toBlock,
        };
        if (dynamic(r.filter.fromBlock)) r.filter.fromBlock = block.number;
      }
      const [a, b] = await this.pair(r);
      if (m === "getTransactionReceipt" && Boolean(a) !== Boolean(b)) {
        this.verification.lastError = "RPC_VERIFICATION_UNAVAILABLE";
        throw new NodeError("RPC_VERIFICATION_UNAVAILABLE");
      }
      this.compare(m, a, b);
      if (block) {
        const [after, other] = await this.pair({
          method: "getBlock",
          blockTag: block.number,
          includeTransactions: false,
        });
        this.compare("getBlock", after, other);
        if (after?.hash !== block.hash) this.disagree();
      }
      return a;
    }
    if (m === "estimateGas") {
      const [a, b] = await this.pair(request);
      return toQuantity(BigInt(a) > BigInt(b) ? a : b);
    }
    // Broadcast only the primary's already-journaled bytes. Fee suggestions remain bounded by signer policy.
    return this.primaryPerform(request);
  }
  destroy() {
    this.witness.destroy();
    super.destroy();
  }
}
