import { Watchdog } from "./watchdog.mjs";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const requireValue = (v, message) => {
  if (!v) throw Error(message);
};
export function validateConnection(input) {
  const c = input.connection,
    u = new URL(c?.url);
  requireValue(
    c?.schema === "agi-fleet-read-access/v1" &&
      ["agent", "node"].includes(c.role) &&
      /^[a-f0-9]{64}$/.test(c.token),
    "Choose a monitoring connection downloaded from Operations & commissioning.",
  );
  requireValue(
    u.protocol === "http:" &&
      u.hostname === "127.0.0.1" &&
      u.port &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === "/api/monitor/status",
    "Only the dedicated localhost monitoring route is permitted.",
  );
  requireValue(
    Number.isInteger(input.forwardPort) &&
      input.forwardPort >= 1024 &&
      input.forwardPort <= 65535,
    "Enter the local forwarded port from your SSH tunnel.",
  );
  requireValue(
    typeof input.name === "string" &&
      input.name.trim().length > 0 &&
      input.name.length <= 60 &&
      !/[\x00-\x1f]/.test(input.name),
    "Use a short machine name.",
  );
  return {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    role: c.role,
    sourcePort: Number(u.port),
    forwardPort: input.forwardPort,
    token: c.token,
  };
}
export async function pollActor(actor, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(
      `http://127.0.0.1:${actor.forwardPort}/api/monitor/status`,
      {
        headers: {
          Authorization: "Bearer " + actor.token,
          Host: `127.0.0.1:${actor.sourcePort}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(6000),
      },
    );
    requireValue(r.ok, "unavailable");
    let n = 0;
    const parts = [];
    for await (const part of r.body) {
      n += part.length;
      requireValue(n <= 32768, "too large");
      parts.push(part);
    }
    const s = JSON.parse(Buffer.concat(parts).toString("utf8")),
      age = Date.now() - Date.parse(s.generatedAt);
    requireValue(
      s.schema === "agi-fleet-status/v1" &&
        s.role === actor.role &&
        age >= -30000 &&
        age < 90000 &&
        ["healthy", "attention", "stopped"].includes(s.state),
      "stale or invalid",
    );
    for (const field of [
      "worker",
      "rpc",
      "openclaw",
      "ipfs",
      "wallet",
      "disk",
      "software",
    ])
      requireValue(s[field] && typeof s[field] === "object", "invalid");
    return { state: s.state, checkedAt: new Date().toISOString(), status: s };
  } catch {
    return {
      state: "offline",
      checkedAt: new Date().toISOString(),
      status: null,
    };
  }
}
const write = (file, value) => {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
};
export async function startMonitor({
  home = process.env.AGI_FLEET_HOME ??
    path.join(
      os.homedir(),
      "Library/Application Support/MONTREAL.AI/AGI Fleet Monitor",
    ),
  port = 8790,
  pollMs = 15000,
  fetchImpl = fetch,
  heartbeatFetch = fetch,
} = {}) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const watchdog = new Watchdog(home, { fetchImpl: heartbeatFetch });
  const configFile = path.join(home, "connections.json"),
    historyFile = path.join(home, "observations.json");
  let actors = fs.existsSync(configFile)
    ? JSON.parse(fs.readFileSync(configFile, "utf8"))
    : [];
  requireValue(
    Array.isArray(actors) && actors.length <= 32,
    "Monitoring configuration invalid.",
  );
  actors = actors.map((a) => ({
    ...validateConnection({
      name: a.name,
      forwardPort: a.forwardPort,
      connection: {
        schema: "agi-fleet-read-access/v1",
        role: a.role,
        token: a.token,
        url: `http://127.0.0.1:${a.sourcePort}/api/monitor/status`,
      },
    }),
    id: /^[a-f0-9-]{36}$/.test(a.id) ? a.id : crypto.randomUUID(),
  }));
  let history = fs.existsSync(historyFile)
    ? JSON.parse(fs.readFileSync(historyFile, "utf8"))
    : {};
  const latest = new Map(),
    sessions = new Map(),
    launchSecret = crypto.randomBytes(32).toString("hex");
  let bootstrap = crypto.randomBytes(32).toString("hex"),
    bootstrapUsed = false,
    actualPort = port,
    busy = false,
    closed = false,
    timer,
    storageError = false;
  const origin = () => `http://127.0.0.1:${actualPort}`;
  const poll = async () => {
    if (busy || closed) return;
    busy = true;
    try {
      const list = [...actors];
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, list.length) }, async () => {
          while (index < list.length) {
            const a = list[index++],
              value = await pollActor(a, fetchImpl);
            if (!actors.some((x) => x.id === a.id)) continue;
            latest.set(a.id, value);
            const prev = history[a.id] ?? {
              startedAt: new Date().toISOString(),
              samples: 0,
              healthySamples: 0,
              unhealthySamples: 0,
              events: [],
            };
            prev.samples++;
            if (value.state === "healthy") prev.healthySamples++;
            else {
              prev.unhealthySamples++;
              prev.lastExceptionAt = value.checkedAt;
            }
            if (prev.lastState !== value.state) {
              prev.events.unshift({ at: value.checkedAt, state: value.state });
              prev.events = prev.events.slice(0, 200);
            }
            prev.lastState = value.state;
            prev.lastSampleAt = value.checkedAt;
            history[a.id] = prev;
          }
        }),
      );
      write(historyFile, history);
      storageError = false;
    } catch {
      storageError = true;
    } finally {
      busy = false;
      if (!closed) {
        try {
          await watchdog.tick(report());
        } catch {
          storageError = true;
        }
      }
    }
  };
  const report = () => ({
    schema: "agi-fleet-observations/v1",
    generatedAt: new Date().toISOString(),
    storageError,
    watchdog: watchdog.summary(actors),
    qualification:
      "Observed samples only. Monitor downtime is unobserved; this is not a certification or proof of continuous uptime.",
    actors: actors.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      forwardPort: a.forwardPort,
      ...(latest.get(a.id) ?? { state: "waiting", status: null }),
      history: history[a.id] ?? null,
    })),
  });
  const read = async (req) => {
    let n = 0,
      parts = [];
    for await (const b of req) {
      n += b.length;
      requireValue(n <= 16384, "Request too large.");
      parts.push(b);
    }
    return JSON.parse(Buffer.concat(parts));
  };
  const server = http.createServer(async (req, res) => {
    const json = (v, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(v));
    };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      requireValue(
        req.headers.host === `127.0.0.1:${actualPort}`,
        "Host rejected.",
      );
      if (req.headers.origin)
        requireValue(req.headers.origin === origin(), "Origin rejected.");
      const u = new URL(req.url, origin());
      requireValue(u.origin === origin() && !u.search, "Route rejected.");
      if (!u.pathname.startsWith("/api/")) {
        requireValue(req.method === "GET", "Method rejected.");
        const file = {
          "/": "index.html",
          "/app.js": "app.js",
          "/style.css": "style.css",
        }[u.pathname];
        requireValue(file, "Page not found.");
        res.writeHead(200, {
          "Content-Type": file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : "text/html",
        });
        res.end(fs.readFileSync(path.join(ROOT, file)));
        return;
      }
      if (req.method === "POST")
        requireValue(
          req.headers.origin === origin() &&
            req.headers["content-type"]?.split(";")[0] === "application/json",
          "Origin and JSON required.",
        );
      if (u.pathname === "/api/reopen") {
        requireValue(
          req.method === "POST" &&
            req.headers.authorization === "Bearer " + launchSecret,
          "Local launch access required.",
        );
        await read(req);
        bootstrap = crypto.randomBytes(32).toString("hex");
        bootstrapUsed = false;
        json({ url: origin() + "/#" + bootstrap });
        return;
      }
      if (u.pathname === "/api/session") {
        requireValue(req.method === "POST", "Method rejected.");
        const input = await read(req);
        requireValue(
          !bootstrapUsed && input.token === bootstrap,
          "Reopen Fleet Monitor to connect.",
        );
        bootstrapUsed = true;
        const token = crypto.randomBytes(32).toString("hex");
        sessions.set(token, Date.now() + 86400000);
        json({ token });
        return;
      }
      const t = req.headers.authorization?.replace(/^Bearer /, "");
      requireValue(
        sessions.get(t) > Date.now(),
        "Session expired. Reopen Fleet Monitor.",
      );
      if (
        req.method === "GET" &&
        ["/api/status", "/api/report"].includes(u.pathname)
      ) {
        json(report());
        return;
      }
      requireValue(req.method === "POST", "Method rejected.");
      const input = await read(req);
      if (u.pathname === "/api/watchdog") {
        json(watchdog.configure(input, actors));
        void poll();
        return;
      }
      if (u.pathname === "/api/watchdog/disable") {
        json(watchdog.disable());
        return;
      }
      if (u.pathname === "/api/add") {
        requireValue(
          actors.length < 32,
          "This monitor supports 32 actors. Use another monitor for additional groups.",
        );
        const actor = validateConnection(input);
        requireValue(
          !actors.some(
            (a) =>
              a.token === actor.token ||
              (a.forwardPort === actor.forwardPort &&
                a.sourcePort === actor.sourcePort),
          ),
          "This connection is already registered.",
        );
        const next = [...actors, actor];
        write(configFile, next);
        actors = next;
        json({ saved: true });
        void poll();
        return;
      }
      if (u.pathname === "/api/remove") {
        const next = actors.filter((a) => a.id !== input.id);
        write(configFile, next);
        actors = next;
        delete history[input.id];
        latest.delete(input.id);
        write(historyFile, history);
        json({ removed: true });
        return;
      }
      if (u.pathname === "/api/quit") {
        json({ stopped: true });
        setTimeout(() => void close(), 100);
        return;
      }
      throw Error("Route rejected.");
    } catch (e) {
      json({ error: e.message }, 400);
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 30;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      actualPort = server.address().port;
      resolve();
    });
  });
  timer = setInterval(() => void poll(), pollMs);
  timer.unref();
  void poll();
  const close = async () => {
    closed = true;
    clearInterval(timer);
    await new Promise((r) => server.close(r));
  };
  return {
    url: origin() + "/#" + bootstrap,
    launchSecret,
    close,
    poll,
    report,
    port: actualPort,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major !== 24 || minor < 19)
    throw Error(
      "Install Node 24.19 or newer in the 24.x line. Node 26 is not qualified for this package.",
    );
  const home =
    process.env.AGI_FLEET_HOME ??
    path.join(
      os.homedir(),
      "Library/Application Support/MONTREAL.AI/AGI Fleet Monitor",
    );
  const app = await startMonitor({ home });
  write(path.join(home, "monitor-access.json"), {
    url: `http://127.0.0.1:${app.port}`,
    secret: app.launchSecret,
  });
  const service = process.argv.includes("--service");
  if (!service)
    console.log(
      "Fleet Monitor is running locally. Keep this window open.\n" + app.url,
    );
  if (!service && process.platform === "darwin")
    spawn("open", [app.url], { stdio: "ignore" }).on("error", () => {});
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => void app.close());
}
