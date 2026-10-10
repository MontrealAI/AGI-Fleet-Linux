import path from "node:path";
import crypto from "node:crypto";
import { ensure } from "./common.mjs";
export const OPENCLAW_VERSION = "2026.9.5";
export function profileConfig({ role, model, token, port }, workspace) {
  ensure(
    ["employer", "evidence", "moderator", "recovery"].includes(role),
    "ROLE",
  );
  ensure(/^[a-z0-9-]+\/[a-zA-Z0-9._:/-]{1,100}$/.test(model), "MODEL_ID");
  ensure(/^[a-f0-9]{64}$/.test(token), "TOKEN_FORMAT");
  ensure(
    Number.isInteger(port) && port >= 1024 && port <= 65535,
    "GATEWAY_PORT",
  );
  const tools = { deny: ["*"], elevated: { enabled: false } };
  return {
    gateway: {
      mode: "local",
      bind: "loopback",
      port,
      auth: { mode: "token", token },
      http: { endpoints: { chatCompletions: { enabled: true } } },
    },
    agents: {
      defaults: {
        model: { primary: model, fallbacks: [] },
        maxConcurrent: 1,
        heartbeat: { every: "0m" },
      },
      entries: {
        [`agi-${role}`]: {
          name: `AGI ${role} evidence reviewer`,
          workspace,
          model: { primary: model, fallbacks: [] },
          skills: [],
          tools,
        },
      },
    },
    tools,
    browser: { enabled: false },
    plugins: {
      allow: model.startsWith("openai/")
        ? ["openai", "codex"]
        : [model.split("/")[0]],
      slots: { memory: "none" },
    },
  };
}
