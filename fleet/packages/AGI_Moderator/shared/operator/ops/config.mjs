import {roleContract} from '../../runtime/compute/roles.mjs';
import { getAddress, ZeroAddress, parseUnits } from "ethers";
import {
  ensure,
  strictKeys,
  safeInteger,
  canonical,
  sha256,
} from "./common.mjs";
export const ROLES = ["employer", "evidence", "moderator", "recovery"];
export const DEFAULT = {
  schema: "agi-fleet-service/v1",
  role: "evidence",
  chainId: 11155111,
  manager: "",
  deploymentBlock: 0,
  wallet: "",
  trustedBuyers: [],
  excludedParties: [],
  claimBeneficiaries: [],
  independenceConfirmed: false,
  confirmations: 12,
  maxBlockAgeSeconds: 300,
  pollSeconds: 30,
  logChunk: 1000,
  chunksPerCycle: 4,
  maxJobsPerCycle: 20,
  maxClaimsPerCycle: 20,
  shardCount: 1,
  shardIndex: 0,
  cancelAfterSeconds: 1814400,
  minReviewSeconds: 300,
  proofTTLSeconds: 300,
  ipfsGateway: "https://ipfs.io",
  contentHosts: ["ipfs.io"],
  maxContentBytes: 131072,
  maxIpfsBlocks: 64,
  contentTimeoutMs: 15000,
  gatewayURL: "http://127.0.0.1:18941",
  gatewayAgent: "agi-evidence",
  modelVeto: false,
  maxModelRequests24h: 256,
  maxDiskMB: 1024,
  limits: {
    maxJobUSDC: "1000",
    maxDisputeBondUSDC: "5",
    maxDisputeBonds24hUSDC: "25",
    maxOpenDisputeBondsUSDC: "50",
    maxTransactions24h: 100,
    maxGas24hETH: "0.02",
    maxTxETH: "0.002",
    maxFeeGwei: "1",
    maxPriorityGwei: "0.25",
    maxTxGas: 2000000,
    maxClaimAttempts: 8,
  },
};
export function validateConfig(c) {
  if (c.maxClaimsPerCycle === undefined)
    c.maxClaimsPerCycle = DEFAULT.maxClaimsPerCycle;
  strictKeys(c, Object.keys(DEFAULT), "CONFIG_FIELDS");
  ensure(c.schema === DEFAULT.schema && ROLES.includes(c.role), "CONFIG_ROLE");
  ensure([1, 11155111, 31337].includes(c.chainId), "CONFIG_CHAIN");
  for (const k of ["manager", "wallet"]) {
    c[k] = getAddress(c[k]);
    ensure(
      c[k] !== ZeroAddress || (k === "wallet" && c.role === "evidence"),
      "CONFIG_ADDRESS",
    );
  }
  const ranges = {
    deploymentBlock: [1, 1000000000],
    confirmations: [1, 256],
    maxBlockAgeSeconds: [30, 900],
    pollSeconds: [5, 3600],
    logChunk: [1, 5000],
    chunksPerCycle: [1, 20],
    maxJobsPerCycle: [1, 200],
    maxClaimsPerCycle: [1, 200],
    shardCount: [1, 4096],
    shardIndex: [0, 4095],
    cancelAfterSeconds: [3600, 31536000],
    minReviewSeconds: [30, 86400],
    proofTTLSeconds: [30, 600],
    maxContentBytes: [1024, 1048576],
    maxIpfsBlocks: [1, 128],
    contentTimeoutMs: [1000, 60000],
    maxModelRequests24h: [1, 100000],
    maxDiskMB: [64, 100000],
  };
  for (const [k, [min, max]] of Object.entries(ranges))
    safeInteger(c[k], min, max, k);
  ensure(c.shardIndex < c.shardCount, "CONFIG_SHARD");
  for (const k of ["trustedBuyers", "excludedParties", "claimBeneficiaries"]) {
    ensure(Array.isArray(c[k]) && c[k].length <= 1000, "CONFIG_ADDRESS_LIST");
    c[k] = c[k].map(getAddress);
    ensure(
      new Set(c[k]).size === c[k].length && !c[k].includes(ZeroAddress),
      "CONFIG_ADDRESS_LIST",
    );
  }
  ensure(c.trustedBuyers.length > 0, "BUYER_SCOPE_REQUIRED");
  ensure(
    typeof c.independenceConfirmed === "boolean" &&
      typeof c.modelVeto === "boolean",
    "CONFIG_BOOLEAN",
  );
  const g = new URL(c.gatewayURL);
  ensure(
    g.protocol === "http:" &&
      g.hostname === "127.0.0.1" &&
      !g.username &&
      !g.password &&
      !g.search &&
      !g.hash &&
      g.pathname === "/" &&
      Number(g.port) >= 1024,
    "GATEWAY_LOOPBACK_REQUIRED",
  );
  ensure(/^[a-z][a-z0-9-]{0,47}$/.test(c.gatewayAgent), "CONFIG_GATEWAY_AGENT");
  const ipfs = new URL(c.ipfsGateway);
  ensure(
    ipfs.protocol === "https:" &&
      !ipfs.username &&
      !ipfs.password &&
      !ipfs.port &&
      !ipfs.search &&
      !ipfs.hash &&
      ipfs.pathname === "/",
    "CONFIG_GATEWAY",
  );
  ensure(
    Array.isArray(c.contentHosts) &&
      c.contentHosts.length > 0 &&
      c.contentHosts.length <= 20 &&
      c.contentHosts.every(
        (h) => typeof h === "string" && /^[a-z0-9.-]+$/.test(h),
      ) &&
      c.contentHosts.includes(ipfs.hostname),
    "CONFIG_CONTENT_HOSTS",
  );
  strictKeys(c.limits, Object.keys(DEFAULT.limits), "CONFIG_LIMITS");
  for (const k of [
    "maxJobUSDC",
    "maxDisputeBondUSDC",
    "maxDisputeBonds24hUSDC",
    "maxOpenDisputeBondsUSDC",
    "maxGas24hETH",
    "maxTxETH",
    "maxFeeGwei",
    "maxPriorityGwei",
  ]) {
    ensure(
      typeof c.limits[k] === "string" &&
        /^\d{1,12}(\.\d{1,9})?$/.test(c.limits[k]),
      "CONFIG_AMOUNT",
    );
    const decimals = k.includes("USDC") ? 6 : k.includes("Gwei") ? 9 : 18;
    ensure(parseUnits(c.limits[k], decimals) > 0n, "CONFIG_POSITIVE_LIMIT");
  }
  safeInteger(c.limits.maxTransactions24h, 1, 10000, "TRANSACTIONS");
  safeInteger(c.limits.maxTxGas, 21000, 10000000, "GAS");
  safeInteger(c.limits.maxClaimAttempts, 1, 8, "CLAIM_ATTEMPTS");
  return c;
}
export function binding(c, pin) {
  return sha256(canonical({ config: c, pin }));
}
export function validateRPC(url, chainId) {
  const u = new URL(url);
  ensure(!u.hash && !u.username && !u.password, "RPC_URL");
  ensure(
    u.protocol === "https:" ||
      (chainId === 31337 &&
        u.protocol === "http:" &&
        u.hostname === "127.0.0.1"),
    "RPC_HTTPS_REQUIRED",
  );
  return u.toString();
}
export function inShard(c, key) {
  return (
    Number(
      BigInt("0x" + sha256(`${c.chainId}:${c.manager.toLowerCase()}:${key}`)) %
        BigInt(c.shardCount),
    ) === c.shardIndex
  );
}
