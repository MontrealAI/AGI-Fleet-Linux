import { ensure, strictKeys, safeInteger } from "../util.mjs";
export const OPENCLAW_VERSION = "2026.9.5";
export function profileConfig(kit, workspace) {
  strictKeys(
    kit,
    ["schema", "openclawVersion", "token", "port", "agent", "model"],
    "OPENCLAW_SETUP_FILE",
  );
  ensure(
    kit.schema === "agi-node-openclaw-setup/v1" &&
      kit.openclawVersion === OPENCLAW_VERSION,
    "OPENCLAW_SETUP_FILE",
  );
  ensure(
    typeof kit.token === "string" && /^[a-f0-9]{64}$/.test(kit.token),
    "OPENCLAW_SETUP_FILE",
  );
  safeInteger(kit.port, 1024, 65535, "COMPANION_PORT");
  ensure(
    typeof kit.agent === "string" && /^[a-z][a-z0-9-]{0,47}$/.test(kit.agent),
    "OPENCLAW_SETUP_FILE",
  );
  ensure(
    typeof kit.model === "string" &&
      /^openai\/[a-zA-Z0-9._-]{1,100}$/.test(kit.model),
    "OPENCLAW_SETUP_FILE",
  );
  return {
    auth: {
      profiles: {
        "openai:agi-node-pro": { provider: "openai", mode: "oauth" },
      },
      order: { openai: ["openai:agi-node-pro"] },
    },
    gateway: {
      mode: "local",
      bind: "loopback",
      port: kit.port,
      auth: { mode: "token", token: kit.token },
      http: { endpoints: { chatCompletions: { enabled: true } } },
    },
    agents: {
      defaults: {
        model: { primary: kit.model, fallbacks: [] },
        maxConcurrent: 1,
        heartbeat: { every: "0m" },
      },
      entries: {
        [kit.agent]: {
          name: "AGI Node companion",
          workspace,
          model: { primary: kit.model, fallbacks: [] },
          skills: [],
          tools: { deny: ["*"], elevated: { enabled: false } },
        },
      },
    },
    tools: { deny: ["*"], elevated: { enabled: false } },
    browser: { enabled: false },
    plugins: { allow: ["openai", "codex"], slots: { memory: "none" } },
  };
}
