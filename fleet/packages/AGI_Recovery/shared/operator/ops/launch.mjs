import {ROOT} from './common.mjs';
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Controller } from "./controller.mjs";
import { createServer } from "./server.mjs";
import { ROLES } from "./config.mjs";
import { acquireLock, ensure, atomicWrite, errorCode } from "./common.mjs";
import { openBrowser } from "./os.mjs";
import { assertRuntime } from "../packages/AGI_Node/src/version.mjs";
import { seedProfileHome } from "../packages/AGI_Node/src/control/wallet-profile.mjs";
const args = process.argv.slice(2),
  option = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const role = option("--role") ?? "evidence";
ensure(ROLES.includes(role), "ROLE");
const roleFile=path.join(ROOT,"config/operator-role.json");if(fs.existsSync(roleFile)){const fixed=JSON.parse(fs.readFileSync(roleFile));ensure(fixed.schema==="agi-fleet-operator-role/v1"&&fixed.role===role,"HOME_ROLE_MISMATCH");}
assertRuntime();
const originalHome = path.resolve(
  option("--home") ??
    path.join(
      os.homedir(),
      process.platform === "linux" ? ".local/share/montreal-ai/fleet" : "Library/Application Support/AGI Fleet",
      role,
    ),
);
ensure(!args.includes("--seed-profile") || role !== "evidence", "EVIDENCE_HAS_NO_SIGNING_KEY");
const home = args.includes("--seed-profile") ? seedProfileHome(originalHome) : originalHome;
let unlock;
try {
  unlock = acquireLock(home);
} catch (e) {
  if (e.message === "INSTANCE_ALREADY_RUNNING") {
    const current = JSON.parse(fs.readFileSync(path.join(home, "panel.json")));
    if (!args.includes("--background")) await openBrowser(current.url);
    process.exit(0);
  }
  throw e;
}
const controller = new Controller(home, role),
  panel = await createServer(controller, {
    port: option("--port") ? Number(option("--port")) : 0,
  });
atomicWrite(path.join(home, "panel.json"), JSON.stringify({ url: panel.url }));
if (args.includes("--background")) await controller.resumeAfterLogin();
else if (!args.includes("--no-open"))
  await openBrowser(panel.url).catch(() =>
    console.log(
      `Open the private control panel link in ${path.join(home, "panel.json")}`,
    ),
  );
console.log(
  `AGI ${role} control panel is running on loopback. Press Ctrl-C to close.`,
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await controller.close();
  panel.server.close();
  unlock();
}
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => void close());
const fatal = (e) => {
  process.exitCode = 1;
  console.error(errorCode(e));
  controller.pause();
  void close();
};
process.on("uncaughtException", fatal);
process.on("unhandledRejection", fatal);
