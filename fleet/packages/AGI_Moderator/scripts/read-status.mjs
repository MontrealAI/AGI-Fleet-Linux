import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const args = process.argv.slice(2),
  option = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null),
  role = option("--role") ?? "evidence";
try {
  if (!["employer", "evidence", "moderator", "recovery"].includes(role))
    throw Error("INVALID_ROLE");
  const home = path.resolve(
    option("--home") ??
      path.join(os.homedir(), "Library/Application Support/AGI Fleet", role),
  );
  const access = JSON.parse(
    fs.readFileSync(path.join(home, "monitor-access.json"), "utf8"),
  );
  const u = new URL(access.url);
  if (
    access.schema !== "agi-fleet-monitor/v1" ||
    u.hostname !== "127.0.0.1" ||
    u.protocol !== "http:" ||
    u.pathname !== "/api/health" ||
    u.search ||
    u.hash ||
    !/^([0-9a-f]{64})$/.test(access.token)
  )
    throw Error("INVALID_LOCAL_MONITOR");
  const response = await fetch(u, {
    headers: { Authorization: "Bearer " + access.token },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error("MONITOR_UNAVAILABLE");
  const report = await response.json();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.healthy ? 0 : 2;
} catch {
  console.log(
    JSON.stringify({
      role,
      healthy: false,
      issues: ["LOCAL_SERVICE_UNAVAILABLE"],
    }),
  );
  process.exitCode = 3;
}
