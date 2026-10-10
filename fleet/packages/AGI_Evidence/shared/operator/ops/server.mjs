import {roleContract} from '../../runtime/compute/roles.mjs';
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, ensure, json, errorCode, atomicWrite } from "./common.mjs";
import { boundedJSON } from "../packages/AGI_Node/src/review.mjs";
import { background } from "./os.mjs";
import { OPENCLAW_VERSION } from "./openclaw.mjs";
import { health } from "./health.mjs";
import { estimate } from "./workload.mjs";
export async function createServer(
  controller,
  { port = 0, token = crypto.randomBytes(32).toString("hex") } = {},
) {
  const monitorFile = path.join(controller.home, "monitor-access.json");
  let monitorToken = crypto.randomBytes(32).toString("hex");
  if (fs.existsSync(monitorFile)) {
    const saved = JSON.parse(fs.readFileSync(monitorFile, "utf8"));
    ensure(/^[0-9a-f]{64}$/.test(saved.token), "MONITOR_CREDENTIAL_INVALID");
    monitorToken = saved.token;
  }
  let origin,
    mutating = false;
  const recoveryAttempts = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const reply = (value, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(json(value));
    };
    let held = false;
    try {
      ensure(req.headers.host === new URL(origin).host, "HOST_REJECTED");
      ensure(
        !req.headers.origin || req.headers.origin === origin,
        "ORIGIN_REJECTED",
      );
      const u = new URL(req.url, origin);
      ensure(!u.search, "QUERY_REJECTED");
      if (
        req.method === "GET" &&
        ["/", "/app.js", "/wallet.js", "/app.css", "/genesis.js", "/genesis.css", "/experience.js", "/atelier.css"].includes(u.pathname)
      ) {
        const f = {
          "/": "index.html",
          "/app.js": "app.js",
          "/wallet.js": "wallet.js",
          "/genesis.js": "genesis.js",
          "/experience.js": "experience.js",
          "/atelier.css": "atelier.css",
          "/genesis.css": "genesis.css",
          "/app.css": "app.css",
        }[u.pathname];
        res.writeHead(200, {
          "Content-Type": f.endsWith("html")
            ? "text/html; charset=utf-8"
            : f.endsWith("js")
              ? "text/javascript"
              : "text/css",
        });
        res.end(fs.readFileSync(path.join(ROOT, "web", f)));
        return;
      }
      const auth = req.headers.authorization ?? "";
      const readonly = `Bearer ${monitorToken}`;
      if (
        req.method === "GET" &&
        u.pathname === "/api/health" &&
        auth.length === readonly.length &&
        crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(readonly))
      ) {
        reply(health(controller.snapshot()));
        return;
      }
      const expected = `Bearer ${token}`;
      ensure(
        auth.length === expected.length &&
          crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected)),
        "AUTH_REQUIRED",
      );
      if (req.method === "GET" && u.pathname === "/api/status") {
        reply(controller.snapshot());
        return;
      }
      if (req.method === "GET" && u.pathname === "/api/health") {
        reply(health(controller.snapshot()));
        return;
      }
      if (req.method === "GET" && u.pathname === "/api/monitor") {
        reply({
          schema: "agi-fleet-monitor/v1",
          url: origin + "/api/health",
          token: monitorToken,
        });
        return;
      }
      if (req.method === "GET" && u.pathname === "/api/workload") {
        reply(controller.workload());
        return;
      }
      if (req.method === "GET" && u.pathname === "/api/export") {
        const s = controller.snapshot();
        reply({
          schema: "agi-fleet-status-export/v1",
          ...s,
          evidence: controller.store.db
            .prepare(
              "SELECT id,proof FROM jobs WHERE proof IS NOT NULL LIMIT 10000",
            )
            .all()
            .map((r) => ({ job: r.id, evidence: JSON.parse(r.proof) })),
        });
        return;
      }
      ensure(
        req.method === "POST" &&
          req.headers.origin === origin &&
          req.headers["content-type"]?.split(";")[0] === "application/json",
        "REQUEST_REJECTED",
      );
      ensure(!mutating || u.pathname === "/api/pause", "OPERATION_BUSY");
      if (["/api/wallet/reveal", "/api/wallet/confirm", "/api/wallet/phrase", "/api/unlock"].includes(u.pathname)) {
        const cutoff = Date.now() - 60000;
        while (recoveryAttempts.length && recoveryAttempts[0] < cutoff) recoveryAttempts.shift();
        ensure(recoveryAttempts.length < 8, "RECOVERY_RATE_LIMIT");
        recoveryAttempts.push(Date.now());
      }
      if (u.pathname !== "/api/pause") {
        mutating = true;
        held = true;
      }
      let size = 0,
        chunks = [];
      for await (const b of req) {
        size += b.length;
        ensure(size < (["/api/restore","/api/backup/verify"].includes(u.pathname) ? 64 * 1024 * 1024 : 1024 * 1024), "REQUEST_TOO_LARGE");
        chunks.push(b);
      }
      const body = boundedJSON(Buffer.concat(chunks));
      let result;
      switch (u.pathname) {
        case "/api/wallet/create":
          result = await controller.wallet("create", body);
          break;
        case "/api/wallet/phrase":
          result = await controller.wallet("phrase", body);
          break;
        case "/api/wallet/reveal":
          result = await controller.revealRecovery(body.password);
          break;
        case "/api/wallet/confirm":
          result = controller.confirmRecovery(body);
          break;
        case "/api/backup/verify":result=await controller.verifyBackup(body.envelope,body.password);break;
        case "/api/preflight":result=controller.machinePreflight();break;
        case "/api/diagnostics":result=controller.diagnostics();break;
        case "/api/upgrade/check":result=controller.compareUpgrade(body.expectedAddress);break;
        case "/api/backup/saved":
          result = controller.acknowledgeBackup();
          break;
        case "/api/exceptions": {
          const items = controller.store.incidents(body.limit ?? 50, body.after ?? "");
          result = { items, next: items.at(-1)?.key ?? null, totalOpen: controller.store.stats().openExceptions };
          break;
        }
        case "/api/labor-estimate":
          result = estimate(body.caseId, body.assumptions);
          break;
        case "/api/human-work":
          result = controller.recordHuman(body);
          break;
        case "/api/void-human-work":
          result = controller.voidHuman(body.id);
          break;
        case "/api/renew-claim":
          result = await controller.renewClaim(body);
          break;
        case "/api/unlock":
          result = await controller.unlock(body.password);
          break;
        case "/api/config":
          result = await controller.save(body.config, body.secrets ?? {});
          break;
        case "/api/enroll":
          result = await controller.enroll();
          break;
        case "/api/activate":
          result = await controller.activate(body);
          break;
        case "/api/start":
          result = await controller.start(body.mode);
          break;
        case "/api/pause":
          result = controller.pause();
          break;
        case "/api/stop":
          result = await controller.stop();
          break;
        case "/api/lock":
          result = await controller.lock();
          break;
        case "/api/remember":
          result = await controller.remember(body.enabled === true);
          break;
        case "/api/background":
          ensure(controller.vault.unlocked, "VAULT_LOCKED");
          result = background(
            controller.home,
            controller.config.role,
            body.enabled === true,
          );
          break;
        case "/api/backup":
          result = await controller.backup(body.password);
          break;
        case "/api/restore":
          result = await controller.restore(body.envelope, body.password);
          break;
        case "/api/openclaw-kit": {
          ensure(
            controller.vault.unlocked &&
              !controller.running &&
              !controller.busy,
            "STOP_AND_UNLOCK_FIRST",
          );
          ensure(
            typeof body.model === "string" &&
              /^[a-z0-9-]+\/[a-zA-Z0-9._:/-]{1,100}$/.test(body.model),
            "MODEL_ID",
          );
          const contract=roleContract(controller.config.role);
          ensure(/^openai\/[a-zA-Z0-9._-]{1,100}$/.test(body.model),'MODEL_ID');
          ensure(Number(new URL(controller.config.gatewayURL).port)===contract.port&&controller.config.gatewayAgent===contract.oauth[0],'COMPUTE_ROLE_REQUIRED');
          const gatewayToken = crypto.randomBytes(32).toString("hex");
          controller.invalidateWallet();
          controller.vault.set({ openclawToken: gatewayToken });
          result={schema:contract.schema,openclawVersion:OPENCLAW_VERSION,role:controller.config.role,model:body.model,token:gatewayToken,port:contract.port,agent:controller.config.wallet,mode:'workstation',signerUID:process.getuid()};
          break;
        }
        case "/api/test-model": {
          ensure(
            controller.vault.unlocked &&
              !controller.running &&
              !controller.busy,
            "STOP_AND_UNLOCK_FIRST",
          );
          const { modelReview } = await import("./evidence.mjs");
          result = await modelReview(
            controller.config,
            controller.vault.get("openclawToken"),
            {
              test: "Known-answer transport probe",
              formal: {
                decision: "approve",
                checks: [{ id: "one-plus-one", passed: true }],
              },
              delivery: "2",
            },
            controller.store,
          );
          break;
        }
        default:
          throw Error("NOT_FOUND");
      }
      reply(result);
    } catch (e) {
      reply(
        { error: errorCode(e) },
        ["AUTH_REQUIRED", "HOST_REJECTED", "ORIGIN_REJECTED"].includes(
          errorCode(e),
        )
          ? 403
          : errorCode(e) === "RECOVERY_RATE_LIMIT" ? 429 : 400,
      );
    } finally {
      if (held) mutating = false;
    }
  });
  server.requestTimeout = 70000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 30;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  atomicWrite(
    monitorFile,
    JSON.stringify({
      schema: "agi-fleet-monitor/v1",
      url: origin + "/api/health",
      token: monitorToken,
    }),
  );
  return { server, origin, token, url: `${origin}/#${token}` };
}
