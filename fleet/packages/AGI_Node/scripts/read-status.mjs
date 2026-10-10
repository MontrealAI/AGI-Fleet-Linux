#!/usr/bin/env node
import fs from "node:fs";
// Copy this standalone reader and the read-only JSON to a monitoring account.
// It requires no wallet directory, browser session, SDK or signing credential.
try {
  const bytes = fs.readFileSync(process.argv[2]);
  if (bytes.length > 4096) throw Error();
  const c = JSON.parse(bytes),
    u = new URL(c.url);
  if (
    c.schema !== "agi-node-read-access/v1" ||
    !/^[a-f0-9]{64}$/.test(c.token) ||
    u.protocol !== "http:" ||
    u.hostname !== "127.0.0.1" ||
    !u.port ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/api/companion/status"
  )
    throw Error();
  const r = await fetch(u, {
    headers: { Authorization: "Bearer " + c.token },
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw Error();
  let n = 0;
  const parts = [];
  for await (const part of r.body) {
    n += part.length;
    if (n > 16384) throw Error();
    parts.push(part);
  }
  const value = JSON.parse(Buffer.concat(parts).toString("utf8"));
  if (value.schema !== "agi-node-status/v1") throw Error();
  console.log(JSON.stringify(value, null, 2));
} catch {
  console.error(
    "Status unavailable. Check that AGI Node is open and the read-only connection has not been revoked.",
  );
  process.exitCode = 1;
}
