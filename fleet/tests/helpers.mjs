import {roleContract} from '../packages/AGI_Node/compute/roles.mjs';
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAddress } from "ethers";
import { DEFAULT, validateConfig } from "../ops/config.mjs";
import { canonical, sha256, now } from "../ops/common.mjs";
export const addr = (n) => getAddress("0x" + n.toString(16).padStart(40, "0"));
export const spec = {
  schema: "agi-autonomy-job/v1",
  title: "Known-answer JSON task",
  task: "Return a JSON object whose answer is the number 42.",
  inputs: "Public deterministic fixture.",
  dataPolicy: "public",
  acceptance: {
    schema: "agi-node-job/v1",
    title: "Answer check",
    profile: "json-rules/v1",
    rules: [{ id: "answer", path: "/answer", op: "equals", value: 42 }],
  },
  resolution: {
    mode: "formal-only/v1",
    moderators: [addr(4)],
    neutralRefund: true,
  },
};
export function config(role = "moderator", patch = {}) {
  return validateConfig({
    ...structuredClone(DEFAULT),
    role,
    gatewayAgent:roleContract(role).oauth[0],
    gatewayURL:'http://127.0.0.1:'+roleContract(role).port,
    chainId: 31337,
    manager: addr(10),
    wallet: addr(4),
    deploymentBlock: 1,
    trustedBuyers: [addr(1)],
    confirmations: 1,
    independenceConfirmed: true,
    ...patch,
  });
}
export function snap(patch = {}) {
  const v = {
    id: "0",
    buyer: addr(1),
    agent: addr(2),
    payout: 100000000n,
    duration: 3600n,
    completed: false,
    expired: false,
    disputed: true,
    requested: true,
    approvals: 0n,
    disapprovals: 0n,
    requestedAt: 1n,
    disputedAt: 1n,
    assignmentDeadline: 1n,
    reviewEnd: 9999999999n,
    settlementAfter: 1n,
    neutralRefundAfter: 9999999999n,
    disputeBond: 1000000n,
    agentBond: 1n,
    specURI: "ipfs://spec",
    completionURI: "ipfs://delivery",
    paused: false,
    moderator: true,
    ...patch,
  };
  return {
    ...v,
    context: sha256(canonical(v)),
    now: now(),
    blockNumber: 1,
    blockHash: "0x" + "1".repeat(64),
  };
}
export function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agi-fleet-test-"));
}
