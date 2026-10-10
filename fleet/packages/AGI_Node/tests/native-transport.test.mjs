import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { fixture } from "./workforce-fixture.mjs";
import { Gateway } from "../workforce/gateway.mjs";
import { runNative } from "../workforce/runner.mjs";
import { open } from "../workforce/envelope.mjs";
import { Journal } from "../workforce/core.mjs";
const image =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
async function server(dir) {
  const state = {
      actions: [],
      authenticated: 0,
      models: 0,
      step: 0,
      job: null,
    },
    errors = [];
  const srv = http.createServer(async (req, res) => {
    try {
      assert.equal(req.url, "/v1/chat/completions");
      assert.equal(req.headers.authorization, "Bearer " + "a".repeat(64));
      const chunks = [];
      for await (const b of req) chunks.push(b);
      const request = JSON.parse(Buffer.concat(chunks));
      assert.deepEqual(request.tools, []);
      assert.equal(request.tool_choice, "none");
      state.job = JSON.parse(request.messages[1].content);
      const script = [
          { action: "screenshot", args: {} },
          { action: "type", args: { text: "42" } },
          { action: "screenshot", args: {} },
          { finished: true, review: null },
        ],
        answer = script[state.step++];
      state.models++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", content: JSON.stringify(answer) },
            },
          ],
          usage: { total_tokens: 20 },
        }),
      );
    } catch (e) {
      errors.push(e);
      res.writeHead(500);
      res.end("{}");
    }
  });
  const ws = new WebSocketServer({ server: srv });
  ws.on("connection", (socket) => {
    const nonce = crypto.randomUUID(),
      ts = Date.now();
    socket.send(
      JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce, ts },
      }),
    );
    socket.on("message", (raw) => {
      try {
        const q = JSON.parse(raw);
        let payload;
        assert.equal(q.type, "req");
        if (q.method === "connect") {
          const p = q.params;
          assert.equal(p.minProtocol, 4);
          assert.equal(p.maxProtocol, 4);
          assert.equal(p.auth.token, "a".repeat(64));
          assert.deepEqual(p.scopes, ["operator.read", "operator.write"]);
          const key = crypto.createPublicKey({
              key: { kty: "OKP", crv: "Ed25519", x: p.device.publicKey },
              format: "jwk",
            }),
            bytes = [
              "v3",
              p.device.id,
              p.client.id,
              p.client.mode,
              p.role,
              p.scopes.join(","),
              String(ts),
              p.auth.token,
              nonce,
              p.client.platform,
              "",
            ].join("|");
          assert(
            crypto.verify(
              null,
              Buffer.from(bytes),
              key,
              Buffer.from(p.device.signature, "base64url"),
            ),
          );
          state.authenticated++;
          payload = {
            type: "hello-ok",
            protocol: 4,
            auth: { scopes: p.scopes },
            server: { version: "2026.9.5" },
          };
        } else if (q.method === "node.describe") {
          assert.equal(q.params.nodeId, "test-node");
          payload = {
            nodeId: "test-node",
            connected: true,
            platform: "macos",
            commands: ["computer.act", "screen.snapshot"],
            computerUse: {
              contractVersion: 2,
              provider: { id: "cua-computer", generation: "fixture-1" },
              actions: ["screenshot", "type"],
            },
          };
        } else if (q.method === "node.invoke") {
          const p = q.params;
          assert.equal(p.nodeId, "test-node");
          state.actions.push(p);
          if (p.params.action === "type") {
            assert.equal(p.params.text, "42");
            fs.writeFileSync(
              path.join(state.job.outputDirectory, "result.json"),
              '{"value":42}',
            );
          }
          payload = {
            ok: true,
            nodeId: p.nodeId,
            command: p.command,
            payload:
              p.command === "screen.snapshot"
                ? {
                    base64: image,
                    format: "png",
                    width: 1,
                    height: 1,
                    displayFrameId: "frame-" + state.actions.length,
                    screenIndex: 0,
                  }
                : { ok: true },
          };
        } else throw Error("unexpected method");
        socket.send(
          JSON.stringify({ type: "res", id: q.id, ok: true, payload }),
        );
      } catch (e) {
        errors.push(e);
        socket.close();
      }
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return {
    state,
    errors,
    port: srv.address().port,
    close: async () => {
      for (const socket of ws.clients) socket.terminate();
      await new Promise((r) => ws.close(r));
      await new Promise((r) => srv.close(r));
    },
  };
}
test("real WebSocket and HTTP transports authenticate, create actual files and seal a handoff (mock desktop/model)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-native-transport-")),
    s = await server(dir);
  try {
    const f = fixture(dir, s.port),
      result = await runNative(f.c, f.packet, { allowTestPlatform: true });
    assert.equal(result.status, "complete");
    assert.equal(s.state.authenticated, 1);
    assert.equal(s.state.models, 4);
    assert.equal(
      s.state.actions.filter((x) => x.params.action === "type").length,
      1,
    );
    assert.equal(
      new Set(s.state.actions.map((x) => x.params.executionId)).size,
      1,
    );
    const encrypted = JSON.parse(fs.readFileSync(result.output)),
      delivery = JSON.parse(
        open(encrypted, f.recipient.privateKey, encrypted.header.context),
      );
    assert.equal(
      JSON.parse(Buffer.from(delivery.files[0].content, "base64")).value,
      42,
    );
    await assert.rejects(
      () => runNative(f.c, f.packet, { allowTestPlatform: true }),
      /DUPLICATE_RUN/,
    );
    assert.equal(s.state.models, 4);
    const j = new Journal(f.c.dataDir, { observer: true });
    assert.equal(j.report().unreconciledCosts, 1);
    j.close();
    assert.deepEqual(s.errors, []);
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true });
  }
});
test("token or non-loopback endpoint changes fail before an outbound request", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-native-transport-")),
    f = fixture(dir);
  try {
    f.c.gatewayURL = "http://example.org:29501";
    assert.throws(() => new Gateway(f.c), /LOOPBACK_GATEWAY/);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
