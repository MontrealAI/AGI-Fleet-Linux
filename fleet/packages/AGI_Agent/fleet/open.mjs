import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { HOME_DIR } from "./supervised.mjs";
try {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major !== 24 || minor < 19) throw Error();
  const file = path.join(HOME_DIR(), "monitor-access.json");
  if (fs.statSync(file).size > 4096) throw Error();
  const a = JSON.parse(fs.readFileSync(file, "utf8")),
    u = new URL(a.url);
  if (
    u.protocol !== "http:" ||
    u.hostname !== "127.0.0.1" ||
    u.port !== "8790" ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    u.username ||
    u.password ||
    !/^[a-f0-9]{64}$/.test(a.secret)
  )
    throw Error();
  const r = await fetch(u.origin + "/api/reopen", {
    method: "POST",
    headers: {
      Origin: u.origin,
      "Content-Type": "application/json",
      Authorization: "Bearer " + a.secret,
    },
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw Error();
  const d = await r.json(),
    next = new URL(d.url);
  if (
    next.origin !== u.origin ||
    next.pathname !== "/" ||
    next.search ||
    !/^#[a-f0-9]{64}$/.test(next.hash)
  )
    throw Error();
  if (process.platform === "darwin")
    spawn("open", [next.href], { stdio: "ignore" }).on("error", () =>
      console.error("Open the monitor using its local launch link."),
    );
  else console.log(next.href);
} catch {
  console.error(
    "Use Node 24.19+ within 24.x. Monitor is unavailable. Start or reinstall its supervised service, then reopen. See FLEET_MONITOR.html; never copy wallet credentials to this machine.",
  );
  process.exitCode = 1;
}
