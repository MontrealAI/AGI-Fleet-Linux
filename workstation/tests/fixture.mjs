import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { digest, atomic, canonical } from "../engine/core.mjs";
import { nativeRuntime, grantBody, signGrant } from "../engine/runner.mjs";
import specCore from "../engine/core/computer-work.cjs";
export function fixture(dir, port = 29501, role = "agent") {
  const operator = crypto.generateKeyPairSync("ed25519"),
    recipient = crypto.generateKeyPairSync("x25519"),
    gatewayConfig = {
      gateway: {
        bind: "loopback",
        port,
        auth: { mode: "token", token: "a".repeat(64) },
        http: { endpoints: { chatCompletions: { enabled: true } } },
      },
      agents: {
        entries: {
          "agi-native-planner": {
            model: { primary: "openai/test-model", fallbacks: [] },
            tools: { deny: ["*"] },
          },
        },
      },
    };
  const c = {
    schema: "agi-native-config/v1",
    role,
    dataDir: path.join(dir, role + "-data"),
    identityDir: path.join(dir, role + "-identity"),
    gatewayURL: "http://127.0.0.1:" + port,
    gatewayTokenFile: path.join(dir, "token.txt"),
    gatewayConfigFile: path.join(dir, "gateway.json"),
    gatewayConfigSha256: digest(gatewayConfig),
    plannerAgent: "agi-native-planner",
    model: "openai/test-model",
    openclawVersion: "2026.9.5",
    nodeId: "test-node",
    provider: "cua-computer",
    installationSha256: "c".repeat(64),
    appBundlePath: "/synthetic/openclaw",
    resources: ["dedicated-account:fixture"],
    operatorPublicKey: operator.publicKey.export({
      type: "spki",
      format: "pem",
    }),
    recipientPublicKeys: [
      recipient.publicKey.export({ type: "spki", format: "pem" }),
    ],
    limits: {
      maxActions: 12,
      maxModelCalls: 8,
      maxSeconds: 60,
      maxRuns24h: 20,
    },
    costPolicy: {
      modelCallReserveUSDC: "0.01",
      actionReserveUSDC: "0.001",
      fixedRunReserveUSDC: "0.10",
      maxDailyReserveUSDC: "20",
    },
    qualificationPolicyFile: null,
    qualificationEvidenceFile: null,
    revocationFile: null,
    receiptPublicKey: null,
    applications: [],
  };
  atomic(c.gatewayTokenFile, gatewayConfig.gateway.auth.token);
  atomic(c.gatewayConfigFile, gatewayConfig);
  const runtime = specCore.digest(nativeRuntime(c));
  const spec = {
    schema: "agi-node-job/v1",
    profile: "computer-work/v2",
    title: "Reconcile fixture data",
    prompt:
      "Create result.json with value 42, then inspect the saved artifact. This is synthetic test data.",
    dataPolicy: "scoped",
    inputs: [],
    outputs: [
      {
        name: "result.json",
        mediaType: "application/json",
        maxBytes: 10000,
        requirement: "Store the calculated value.",
      },
    ],
    criteria: [
      {
        id: "value",
        requirement: "The value must equal 42.",
        verification: "Open the actual JSON and recompute.",
        evidence: ["result.json"],
      },
    ],
    environment: {
      runtimeSha256: { agent: runtime, reviewer: runtime },
      capabilities: {
        agent: ["desktop", "files"],
        reviewer: ["desktop", "independent-review"],
      },
    },
    authority: {
      agent: { scope: "dedicated-account", resources: c.resources },
      reviewer: { scope: "dedicated-account", resources: c.resources },
    },
    budget: {
      maxAgentSeconds: 60,
      maxReviewSeconds: 60,
      maxAgentCostUSDC: "2",
      maxReviewCostUSDC: "2",
    },
    deadline: Math.floor(Date.now() / 1000) + 3600,
    settlement: {
      chainId: 31337,
      manager: "0x" + "1".repeat(40),
      recovery: "Preserve records; no automatic transaction.",
    },
    coordination: {
      parentSpecSha256: null,
      dependencies: [],
      delegation: "none",
    },
  };
  const packet = {
    schema: "agi-native-job/v1",
    specification: spec,
    inputs: [],
    delivery: null,
    grant: signGrant(grantBody(c, spec), operator.privateKey),
  };
  return {
    c,
    spec,
    packet,
    operator,
    recipient,
    resign: () => {
      packet.grant = signGrant(grantBody(c, spec), operator.privateKey);
    },
  };
}
