import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const HOME_DIR = () =>
  process.env.AGI_FLEET_HOME ??
  path.join(
    os.homedir(),
    "Library/Application Support/MONTREAL.AI/AGI Fleet Monitor",
  );
const check = (v, m) => {
  if (!v) throw Error(m);
};
const xml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
export function plans({
  home,
  root = ROOT,
  node = process.execPath,
  key,
  agentHost,
  nodeHost,
}) {
  for (const p of [home, root, node, key])
    check(
      typeof p === "string" && path.isAbsolute(p) && !/[\x00-\x1f]/.test(p),
      "Use absolute local paths.",
    );
  for (const h of [agentHost, nodeHost])
    check(
      typeof h === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(h) &&
        !h.includes(".."),
      "Enter a hostname or IP only, without a user, port, URL or command.",
    );
  const tunnel = (host, local, remote) => [
    "/usr/bin/ssh",
    "-N",
    "-F",
    "/dev/null",
    "-i",
    key,
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "IdentityAgent=none",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ConnectTimeout=10",
    "-L",
    `127.0.0.1:${local}:127.0.0.1:${remote}`,
    `agimonitor@${host}`,
  ];
  return [
    {
      name: "monitor",
      args: [node, path.join(root, "monitor.mjs"), "--service"],
    },
    { name: "agent-tunnel", args: tunnel(agentHost, 18788, 8788) },
    { name: "node-tunnel", args: tunnel(nodeHost, 18787, 8787) },
  ].map((p) => {
    const label = "ai.montreal.agi-fleet." + p.name;
    return {
      ...p,
      label,
      plist: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${p.args.map((a) => "<string>" + xml(a) + "</string>").join("")}</array><key>EnvironmentVariables</key><dict><key>AGI_FLEET_HOME</key><string>${xml(home)}</string></dict><key>WorkingDirectory</key><string>${xml(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>ProcessType</key><string>Background</string><key>Umask</key><integer>63</integer><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>\n`,
    };
  });
}
async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  check(major === 24 && minor >= 19, "Install Node 24.19+ within 24.x.");
  check(
    process.platform === "darwin" && process.getuid() !== 0,
    "Run this under your dedicated non-root monitoring account on macOS.",
  );
  const home = path.resolve(HOME_DIR()),
    target = path.join(os.homedir(), "Library/LaunchAgents"),
    domain = `gui/${process.getuid()}`;
  const labels = ["monitor", "agent-tunnel", "node-tunnel"].map(
    (n) => "ai.montreal.agi-fleet." + n,
  );
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    if (process.argv.includes("--remove")) {
      check(
        (await rl.question(
          "This stops monitoring and both tunnels, not AGI workers. External checks will alert unless disabled there. Type REMOVE: ",
        )) === "REMOVE",
        "Cancelled.",
      );
      for (const label of labels) {
        spawnSync("/bin/launchctl", ["bootout", domain + "/" + label], {
          stdio: "ignore",
        });
        fs.rmSync(path.join(target, label + ".plist"), { force: true });
      }
      console.log(
        "Monitoring services removed. Actor wallets and journals were untouched.",
      );
      return;
    }
    console.log(
      "Supervise the keyless monitor and two restricted SSH tunnels after login.\nFirst quit the foreground monitor and tunnel windows. Remote agimonitor accounts must deny shells/other ports. Verify both host fingerprints in this account before continuing.\nUse a dedicated restricted SSH key that works in BatchMode without a password prompt. Do not select any wallet or treasury key.",
    );
    const agentHost = (
      await rl.question("Agent Mac hostname (for example agi-mini.local): ")
    ).trim();
    const nodeHost = (
      await rl.question("Node Mac hostname (for example agi-node.local): ")
    ).trim();
    const key = (
      await rl.question("Absolute path to the dedicated monitoring SSH key: ")
    ).trim();
    check(
      path.isAbsolute(key) && fs.existsSync(key),
      "Choose the existing dedicated SSH key.",
    );
    const st = fs.lstatSync(key);
    check(
      st.isFile() &&
        !st.isSymbolicLink() &&
        (st.mode & 0o077) === 0 &&
        st.uid === process.getuid(),
      "SSH key must be your own regular private file (chmod 600), not a symlink.",
    );
    const list = plans({ home, key, agentHost, nodeHost });
    console.log(
      `Services prepared for review:\nMonitor on localhost:8790\n${agentHost}:8788 -> localhost:18788\n${nodeHost}:8787 -> localhost:18787\nState: ${home}\nNode: ${process.execPath}\nAfter-login only. FileVault, sleep and cold reboot still require qualification.`,
    );
    check(
      (await rl.question(
        "Install these three per-user services? Type INSTALL: ",
      )) === "INSTALL",
      "Cancelled.",
    );
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    for (const p of list) {
      const file = path.join(target, p.label + ".plist");
      fs.writeFileSync(file, p.plist, { mode: 0o600 });
      fs.chmodSync(file, 0o600);
      const validation = spawnSync("/usr/bin/plutil", ["-lint", file], {
        encoding: "utf8",
      });
      check(validation.status === 0, "Generated service validation failed.");
      spawnSync("/bin/launchctl", ["bootout", domain + "/" + p.label], {
        stdio: "ignore",
      });
      check(
        spawnSync("/bin/launchctl", ["bootstrap", domain, file], {
          stdio: "ignore",
        }).status === 0,
        "Service installation failed; inspect launchctl and the generated plist before retrying.",
      );
    }
    console.log(
      "Installed. Open Open-Fleet-Monitor.command after a few seconds. Check both machines and configure two external heartbeat checks. Test logout/login, browser closure, broken tunnels and complete monitor-host loss before relying on alerts.",
    );
  } finally {
    rl.close();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
