import path from "node:path";
import { getAddress, isAddress, parseUnits, ZeroAddress } from "ethers";
import {
  ensure,
  readJSON,
  safeInteger,
  strictKeys,
  canonical,
  sha256,
} from "./util.mjs";
export const DEFAULT = {
  version: 1,
  chainId: 1,
  manager: "",
  deploymentBlock: 0,
  agent: "",
  label: "",
  proof: [],
  rpcEnv: "AGI_AGENT_RPC_URL",
  dataDir: "data",
  keystore: "data/agent.keystore.json",
  confirmations: 12,
  pollSeconds: 20,
  logChunk: 1000,
  chunksPerCycle: 5,
  maxJobsPerCycle: 15,
  retrySeconds: 300,
  maxBlockAgeSeconds: 180,
  submissionBufferSeconds: 300,
  port: 8788,
  autoClaim: true,
  autoFinalizeOwnJobs: true,
  trustedBuyers: [],
  excludedParties: [],
  independenceReviewed: false,
  allowedHttpsHosts: [],
  ipfsGateway: "https://ipfs.io",
  maxContentBytes: 24000,
  maxIpfsBlocks: 32,
  contentTimeoutMs: 15000,
  limits: {
    maxJobUSDC: "1000",
    maxBondUSDC: "25",
    maxOpenBondUSDC: "100",
    maxBond24hUSDC: "100",
    maxFeeGwei: "30",
    maxPriorityGwei: "1",
    maxTxGas: 700000,
    maxFinalizeGas: 2000000,
    maxTxETH: "0.01",
    maxGas24hETH: "0.1",
    maxTransactions24h: 30,
  },
  execution: {
    publicDataOnly: false,
    publicPublishing: false,
    allowEnvelopes: false,
    minRewardUSDC: "1",
    maxActiveJobs: 3,
    maxAttempts: 3,
    shardIndex: 0,
    shardCount: 1,
    kuboPort: 5001,
  },
};
export function validateConfig(
  c,
  base = process.cwd(),
  { ready = false } = {},
) {
  c = { independenceReviewed: false, ...c };
  ensure(typeof c.independenceReviewed === "boolean", "CONFIG_INDEPENDENCE");
  strictKeys(c, Object.keys(DEFAULT), "CONFIG_UNKNOWN_FIELD");
  ensure(
    Object.keys(DEFAULT).every((k) => k in c),
    "CONFIG_MISSING_FIELD",
  );
  ensure(
    c.version === 1 && [1, 11155111, 31337].includes(c.chainId),
    "CONFIG_CHAIN",
  );
  for (const k of ["manager", "agent"])
    ensure(
      c[k] === "" || (isAddress(c[k]) && c[k].toLowerCase() !== ZeroAddress),
      "CONFIG_" + k,
    );
  if (ready)
    ensure(c.manager && c.agent && c.trustedBuyers.length, "SETUP_INCOMPLETE");
  safeInteger(c.deploymentBlock, 0, Number.MAX_SAFE_INTEGER, "deploymentBlock");
  for (const [k, min, max] of [
    ["confirmations", 1, 128],
    ["pollSeconds", 1, 3600],
    ["logChunk", 1, 5000],
    ["chunksPerCycle", 1, 100],
    ["maxJobsPerCycle", 1, 200],
    ["retrySeconds", 10, 86400],
    ["maxBlockAgeSeconds", 30, 3600],
    ["submissionBufferSeconds", 30, 86400],
    ["port", 1024, 65535],
    ["maxContentBytes", 128, 1048576],
    ["maxIpfsBlocks", 1, 128],
    ["contentTimeoutMs", 1000, 60000],
  ])
    safeInteger(c[k], min, max, k);
  ensure(
    c.chainId === 31337 || c.confirmations >= 3,
    "CONFIG_CONFIRMATIONS_MINIMUM_3",
  );
  ensure(
    typeof c.label === "string" && /^[a-z0-9-]{0,63}$/.test(c.label),
    "CONFIG_LABEL_ONLY",
  );
  ensure(
    Array.isArray(c.proof) &&
      c.proof.length <= 64 &&
      c.proof.every((x) => /^0x[0-9a-fA-F]{64}$/.test(x)),
    "CONFIG_PROOF",
  );
  ensure(
    typeof c.rpcEnv === "string" && /^[A-Z][A-Z0-9_]{1,80}$/.test(c.rpcEnv),
    "CONFIG_RPC_ENV",
  );
  for (const k of ["trustedBuyers", "excludedParties"])
    ensure(
      Array.isArray(c[k]) && c[k].length <= 10000 && c[k].every(isAddress),
      "CONFIG_" + k,
    );
  ensure(
    Array.isArray(c.allowedHttpsHosts) &&
      c.allowedHttpsHosts.every(
        (h) =>
          typeof h === "string" && /^[a-z0-9.-]+$/.test(h) && !h.includes(".."),
      ),
    "CONFIG_HOSTS",
  );
  const gateway = new URL(c.ipfsGateway);
  ensure(
    gateway.protocol === "https:" &&
      !gateway.username &&
      !gateway.password &&
      !gateway.search &&
      !gateway.hash &&
      gateway.pathname === "/" &&
      (!gateway.port || gateway.port === "443"),
    "CONFIG_IPFS_GATEWAY",
  );
  for (const k of ["autoClaim", "autoFinalizeOwnJobs"])
    ensure(typeof c[k] === "boolean", "CONFIG_BOOLEAN");
  // An upgrade never silently raises an existing wallet's gas-unit authority.
  if (c.limits && !Object.hasOwn(c.limits, "maxFinalizeGas"))
    c = { ...c, limits: { ...c.limits, maxFinalizeGas: c.limits.maxTxGas } };
  strictKeys(c.limits, Object.keys(DEFAULT.limits), "CONFIG_LIMITS");
  for (const k of Object.keys(DEFAULT.limits))
    ensure(k in c.limits, "CONFIG_LIMITS_MISSING");
  for (const k of [
    "maxJobUSDC",
    "maxBondUSDC",
    "maxOpenBondUSDC",
    "maxBond24hUSDC",
  ])
    money(c.limits[k], 6, k);
  for (const k of ["maxFeeGwei", "maxPriorityGwei"]) money(c.limits[k], 9, k);
  for (const k of ["maxTxETH", "maxGas24hETH"]) money(c.limits[k], 18, k);
  safeInteger(c.limits.maxTxGas, 21000, 2000000, "maxTxGas");
  safeInteger(c.limits.maxFinalizeGas, 21000, 2000000, "maxFinalizeGas");
  safeInteger(c.limits.maxTransactions24h, 1, 10000, "maxTransactions24h");
  strictKeys(c.execution, [...Object.keys(DEFAULT.execution), "allowImages", "allowComputerWork"], "CONFIG_EXECUTION");
  ensure(c.execution.allowComputerWork === undefined || typeof c.execution.allowComputerWork === "boolean", "CONFIG_EXECUTION");
  ensure(c.execution.allowImages === undefined || typeof c.execution.allowImages === "boolean", "CONFIG_EXECUTION");
  ensure(
    Object.keys(DEFAULT.execution).every((k) => k in c.execution),
    "CONFIG_EXECUTION",
  );
  for (const k of ["publicDataOnly", "publicPublishing", "allowEnvelopes"])
    ensure(typeof c.execution[k] === "boolean", "CONFIG_EXECUTION");
  money(c.execution.minRewardUSDC, 6, "minRewardUSDC");
  safeInteger(c.execution.maxActiveJobs, 1, 20, "maxActiveJobs");
  safeInteger(c.execution.maxAttempts, 1, 5, "maxAttempts");
  safeInteger(c.execution.shardCount, 1, 1024, "shardCount");
  safeInteger(
    c.execution.shardIndex,
    0,
    c.execution.shardCount - 1,
    "shardIndex",
  );
  safeInteger(c.execution.kuboPort, 1024, 65535, "kuboPort");
  for (const k of ["dataDir", "keystore"])
    ensure(
      typeof c[k] === "string" && c[k].length > 0 && !c[k].includes("\0"),
      "CONFIG_PATH",
    );
  return {
    ...c,
    dataDir: path.resolve(base, c.dataDir),
    keystore: path.resolve(base, c.keystore),
  };
}
export function money(s, decimals, name = "amount") {
  ensure(typeof s === "string" && /^\d+(\.\d+)?$/.test(s), "CONFIG_" + name);
  const v = parseUnits(s, decimals);
  ensure(v > 0n, "CONFIG_" + name);
  return v;
}
export function loadConfig(file = "agent.config.json", opts = {}) {
  return validateConfig(readJSON(file), path.dirname(path.resolve(file)), opts);
}
export function binding(c, deployment) {
  const { dataDir, keystore, ...authority } = c;
  return sha256(canonical({ config: authority, deployment }));
}
// These execution budgets cannot alter what work was accepted or its evidence.
export const SETTLEMENT_BUDGET_FIELDS = Object.freeze([
  "maxFinalizeGas",
  "maxTxETH",
  "maxGas24hETH",
]);
export function preparationBinding(c, deployment) {
  const { dataDir, keystore, ...authority } = c;
  const limits = { ...c.limits };
  for (const key of SETTLEMENT_BUDGET_FIELDS) delete limits[key];
  return sha256(
    canonical({
      schema: "agi-preparation-scope/v1",
      config: { ...authority, limits },
      deployment,
    }),
  );
}
export function rpcURL(c) {
  const value = process.env[c.rpcEnv];
  ensure(value, "RPC_NOT_CONFIGURED");
  const u = new URL(value);
  ensure(!u.username && !u.password, "RPC_URL_USERINFO_UNSUPPORTED");
  ensure(
    u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)),
    "RPC_REQUIRES_HTTPS_OR_LOOPBACK",
  );
  return value;
}
