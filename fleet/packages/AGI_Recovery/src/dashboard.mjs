import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, encode } from "./util.mjs";
export async function dashboard(store, port) {
  const token = crypto.randomBytes(32).toString("hex");
  const server = http.createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    if (
      !["127.0.0.1:" + port, "localhost:" + port].includes(req.headers.host) ||
      req.method !== "GET"
    ) {
      res.writeHead(403).end();
      return;
    }
    if (
      req.headers.origin &&
      !["http://127.0.0.1:" + port, "http://localhost:" + port].includes(
        req.headers.origin,
      )
    ) {
      res.writeHead(403).end();
      return;
    }
    if (req.url === "/api/status") {
      const auth = req.headers.authorization ?? "",
        expected = "Bearer " + token;
      if (
        auth.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
      ) {
        res.writeHead(401).end();
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(encode(store.snapshot()));
      return;
    }
    const routes = {
      "/": ["index.html", "text/html; charset=utf-8"],
      "/app.js": ["app.js", "text/javascript; charset=utf-8"],
      "/style.css": ["style.css", "text/css; charset=utf-8"],
    };
    const item = routes[req.url];
    if (!item) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Content-Type", item[1]);
    res.end(fs.readFileSync(path.join(ROOT, "web", item[0])));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return { server, url: `http://127.0.0.1:${port}/#${token}` };
}
