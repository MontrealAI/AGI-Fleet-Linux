import {linuxBackground} from '../packages/AGI_Node/src/control/linux-integration.mjs';
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, ensure, atomicWrite, sha256 } from "./common.mjs";
export { openBrowser } from "../packages/AGI_Node/src/control/os-integration.mjs";
const xml = (v) =>
  String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export const serviceLabel = (home, role) =>
  `ai.montreal.agi-fleet.${role}.${sha256(path.resolve(home)).slice(0, 12)}`;
export function launchAgent(home, role, node = process.execPath) {
  return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>${serviceLabel(home, role)}</string><key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(path.join(ROOT, "ops/launch.mjs"))}</string><string>--role</string><string>${role}</string><string>--home</string><string>${xml(home)}</string><string>--background</string></array><key>WorkingDirectory</key><string>${xml(ROOT)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>30</integer><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string><key>EnvironmentVariables</key><dict><key>NODE_ENV</key><string>production</string></dict></dict></plist>`;
}
export function background(home, role, enabled) {
  if(process.platform === "linux")return linuxBackground({label:serviceLabel(home,role),args:[process.execPath,path.join(ROOT,"ops/launch.mjs"),"--role",role,"--home",home,"--background"],enabled});
  ensure(process.platform === "darwin", "MAC_ONLY");
  const p = path.join(
    os.homedir(),
    "Library/LaunchAgents",
    `${serviceLabel(home, role)}.plist`,
  );
  if (enabled) atomicWrite(p, launchAgent(home, role));
  else fs.rmSync(p, { force: true });
  return { enabled, nextLogin: true };
}
