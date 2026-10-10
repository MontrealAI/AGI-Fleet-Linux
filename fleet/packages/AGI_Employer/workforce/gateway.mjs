import crypto from "node:crypto";
import {
  need,
  integer,
  createIdentity,
  canonical,
  readSecret,
  readFile,
  digest,
} from "./core.mjs";
// Current OpenClaw v2026.9.5 protocol 4, device signature payload v3.
// Device approval and the node command policy remain owned by OpenClaw.
export class Gateway {
  constructor(
    config,
    { WebSocketImpl = WebSocket, fetchImpl = fetch, now = Date.now } = {},
  ) {
    this.c = config;
    this.WS = WebSocketImpl;
    this.fetch = fetchImpl;
    this.now = now;
    this.pending = new Map();
    this.closed = false;
    const u = new URL(config.gatewayURL);
    need(
      u.protocol === "http:" &&
        u.hostname === "127.0.0.1" &&
        u.port &&
        u.pathname === "/" &&
        !u.search &&
        !u.hash &&
        !u.username &&
        !u.password,
      "LOOPBACK_GATEWAY",
    );
    this.url = u.origin;
    this.identity = createIdentity(config.identityDir);
    this.token = readSecret(config.gatewayTokenFile);
    need(this.token.length >= 32 && this.token.length <= 4096, "GATEWAY_TOKEN");
  }
  async connect(signal) {
    need(!this.socket && !this.closed, "GATEWAY_STATE");
    const ws = (this.socket = new this.WS(this.url.replace("http:", "ws:")));
    let challengeSeen = false;
    return new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => fail("CONNECT_TIMEOUT"), 10000);
      const fail = (code) => {
        clearTimeout(timer);
        if (!ready) reject(Error("WORKFORCE_" + code));
        this.close();
      };
      const abort = () => fail("CANCELLED");
      signal?.addEventListener("abort", abort, { once: true });
      ws.addEventListener("error", () => fail("GATEWAY_UNAVAILABLE"));
      ws.addEventListener("close", () => {
        this.closed = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(Error("WORKFORCE_GATEWAY_DISCONNECTED"));
        }
        this.pending.clear();
        if (!ready) reject(Error("WORKFORCE_GATEWAY_DISCONNECTED"));
      });
      ws.addEventListener("message", async (event) => {
        try {
          need(
            typeof event.data === "string" &&
              Buffer.byteLength(event.data) <= 16777216,
            "GATEWAY_FRAME",
          );
          const v = JSON.parse(event.data);
          if (v.type === "event" && v.event === "connect.challenge") {
            need(!challengeSeen, "DUPLICATE_CHALLENGE");
            challengeSeen = true;
            const { nonce, ts } = v.payload ?? {};
            need(
              typeof nonce === "string" &&
                nonce.length >= 1 &&
                nonce.length <= 256 &&
                integer(ts, 1, Number.MAX_SAFE_INTEGER) &&
                Math.abs(ts - this.now()) <= 300000,
              "CONNECT_CHALLENGE",
            );
            const scopes = ["operator.read", "operator.write"],
              platform = process.platform;
            const payload = [
              "v3",
              this.identity.id,
              "gateway-client",
              "backend",
              "operator",
              scopes.join(","),
              String(ts),
              this.token,
              nonce,
              platform,
              "",
            ].join("|");
            const hello = await this.request(
              "connect",
              {
                minProtocol: 4,
                maxProtocol: 4,
                client: {
                  id: "gateway-client",
                  displayName: "AGI private workforce",
                  version: "1.9.0",
                  platform,
                  mode: "backend",
                },
                role: "operator",
                scopes,
                caps: [],
                auth: { token: this.token },
                device: {
                  id: this.identity.id,
                  publicKey: this.identity.publicKey,
                  signature: crypto
                    .sign(null, Buffer.from(payload), this.identity.privateKey)
                    .toString("base64url"),
                  signedAt: ts,
                  nonce,
                },
              },
              5000,
            );
            need(
              hello?.type === "hello-ok" &&
                hello.protocol === 4 &&
                hello.auth?.scopes?.includes("operator.write"),
              "GATEWAY_APPROVAL_REQUIRED",
            );
            this.hello = hello;
            ready = true;
            clearTimeout(timer);
            resolve(hello);
          } else if (v.type === "res") {
            const p = this.pending.get(v.id);
            if (!p) return;
            this.pending.delete(v.id);
            clearTimeout(p.timer);
            v.ok === true
              ? p.resolve(v.payload)
              : p.reject(Error("WORKFORCE_GATEWAY_REQUEST_REJECTED"));
          }
        } catch {
          fail("GATEWAY_PROTOCOL_OR_APPROVAL");
        }
      });
      if (signal?.aborted) abort();
    });
  }
  request(method, params = {}, timeout = 20000) {
    need(
      this.socket?.readyState === 1 && !this.closed,
      "GATEWAY_NOT_CONNECTED",
    );
    need(
      ["connect", "node.list", "node.describe", "node.invoke"].includes(method),
      "GATEWAY_METHOD",
    );
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("WORKFORCE_GATEWAY_TIMEOUT_UNCERTAIN"));
        this.close();
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }
  async node() {
    const n = await this.request("node.describe", { nodeId: this.c.nodeId });
    need(
      n?.nodeId === this.c.nodeId &&
        n.connected === true &&
        ["darwin", "macos"].includes(n.platform) &&
        n.commands?.includes("computer.act") &&
        n.commands?.includes("screen.snapshot") &&
        n.computerUse?.contractVersion === 2,
      "NODE_NOT_READY",
    );
    need(
      n.computerUse.provider?.id === this.c.provider &&
        typeof n.computerUse.provider?.generation === "string",
      "PROVIDER_CHANGED",
    );
    return n;
  }
  async invoke(command, params, idempotencyKey) {
    need(["computer.act", "screen.snapshot"].includes(command), "NODE_COMMAND");
    const r = await this.request(
      "node.invoke",
      {
        nodeId: this.c.nodeId,
        command,
        params,
        idempotencyKey,
        timeoutMs: 15000,
      },
      20000,
    );
    need(
      r?.ok === true && r.nodeId === this.c.nodeId && r.command === command,
      "NODE_RESPONSE_SCOPE",
    );
    const value =
      r.payload ??
      (typeof r.payloadJSON === "string" ? JSON.parse(r.payloadJSON) : null);
    need(value && typeof value === "object", "NODE_RESPONSE");
    return value;
  }
  async plan(messages, signal) {
    const body = {
      model: "openclaw/" + this.c.plannerAgent,
      stream: false,
      tools: [],
      tool_choice: "none",
      messages,
      max_tokens: 4096,
    };
    const response = await this.fetch(this.url + "/v1/chat/completions", {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.token,
      },
      body: JSON.stringify(body),
    });
    need(response.ok, "MODEL_UNAVAILABLE");
    let size = 0,
      parts = [];
    for await (const b of response.body) {
      size += b.length;
      need(size <= 262144, "MODEL_OUTPUT_LIMIT");
      parts.push(b);
    }
    const v = JSON.parse(Buffer.concat(parts));
    const choice = v.choices?.[0];
    need(
      v.choices?.length === 1 &&
        choice.finish_reason === "stop" &&
        choice.message?.role === "assistant" &&
        !choice.message.tool_calls?.length &&
        !choice.message.refusal,
      "MODEL_RESPONSE",
    );
    return {
      answer: JSON.parse(choice.message.content),
      usage: v.usage ?? null,
    };
  }
  close() {
    this.closed = true;
    this.socket?.close();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("WORKFORCE_GATEWAY_CLOSED"));
    }
    this.pending.clear();
  }
}
export function verifyPlanner(c) {
  const config = JSON.parse(readFile(c.gatewayConfigFile, 1048576));
  need(digest(config) === c.gatewayConfigSha256, "GATEWAY_CONFIG_CHANGED");
  const a = config.agents?.entries?.[c.plannerAgent],
    model = a?.model ?? config.agents?.defaults?.model;
  need(
    a &&
      (typeof model === "string" ? model : model?.primary) === c.model &&
      !model?.fallbacks?.length &&
      !config.agents?.defaults?.model?.fallbacks?.length &&
      a.tools?.deny?.includes("*"),
    "PLANNER_POLICY",
  );
  need(
    config.gateway?.bind === "loopback" &&
      config.gateway?.auth?.mode === "token" &&
      config.gateway?.http?.endpoints?.chatCompletions?.enabled === true,
    "GATEWAY_POLICY",
  );
  need(
    String(config.gateway.port) === new URL(c.gatewayURL).port &&
      config.gateway.auth.token === readSecret(c.gatewayTokenFile),
    "GATEWAY_BINDING",
  );
  return true;
}
