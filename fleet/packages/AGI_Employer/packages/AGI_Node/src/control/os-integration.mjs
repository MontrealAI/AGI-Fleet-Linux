import {linuxBackground} from './linux-integration.mjs';
import { profilePort, profileService } from './wallet-profile.mjs';
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { ensure, atomicWrite, ROOT } from "../util.mjs";
export function command(executable, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      args,
      { timeout: 15000, maxBuffer: 65536, windowsHide: true },
      (error, stdout) =>
        error
          ? reject(new Error("OS_CREDENTIAL_UNAVAILABLE"))
          : resolve(stdout.trim()),
    );
    child.stdin.end(input);
  });
}
const service = "ai.montreal.agi-node";
export class Keychain {
  constructor(home, platform = process.platform, run = command) {
    this.home = home;
    this.platform = platform;
    this.run = run;
    this.account = crypto
      .createHash("sha256")
      .update(home)
      .digest("hex")
      .slice(0, 32);
  }
  get supported() {
    return this.platform === "darwin" || this.platform === "linux" && fs.existsSync("/usr/bin/secret-tool");
  }
  async set(value) {
    ensure(this.supported, "OS_CREDENTIAL_UNAVAILABLE");
    ensure(/^[A-Za-z0-9+/]{43}=$/.test(value), "OS_CREDENTIAL_INVALID");
    if(this.platform === "linux"){await this.run("/usr/bin/secret-tool",["store","--label=AGI signer unlock key","service",service,"account",this.account],value);ensure(await this.get()===value,"OS_CREDENTIAL_UNAVAILABLE");return;}
    // Interactive security reads commands from stdin: the credential is never an argv value.
    await this.run(
      "/usr/bin/security",
      ["-i"],
      `add-generic-password -U -a ${this.account} -s ${service} -w ${value}\n`,
    );
    ensure((await this.get()) === value, "OS_CREDENTIAL_UNAVAILABLE");
  }
  async get() {
    ensure(this.supported, "OS_CREDENTIAL_UNAVAILABLE");
    if(this.platform === "linux")return this.run("/usr/bin/secret-tool",["lookup","service",service,"account",this.account]);
    return this.run("/usr/bin/security", [
      "find-generic-password",
      "-a",
      this.account,
      "-s",
      service,
      "-w",
    ]);
  }
  async remove() {
    if(this.platform === "linux"){if(this.supported)await this.run("/usr/bin/secret-tool",["clear","service",service,"account",this.account]).catch(()=>{});return;}
    if (this.supported)
      await this.run("/usr/bin/security", [
        "delete-generic-password",
        "-a",
        this.account,
        "-s",
        service,
      ]).catch(() => {});
  }
}
const xml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function launchAgent(home, node = process.execPath) {
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${profileService(home)}</string><key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(path.join(ROOT, "src/launch.mjs"))}</string><string>--background</string><string>--home</string><string>${xml(home)}</string><string>--port</string><string>${profilePort(home)}</string></array><key>WorkingDirectory</key><string>${xml(ROOT)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>30</integer><key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>`;
}
export async function setBackground(home, enabled) {
  if(process.platform === "linux")return linuxBackground({label:profileService(home),args:[process.execPath,path.join(ROOT,"src/launch.mjs"),"--background","--home",home,"--port",String(profilePort(home))],enabled});
  ensure(process.platform === "darwin", "SERVICE_UNAVAILABLE");
  const file = path.join(
    os.homedir(),
    "Library/LaunchAgents",
    profileService(home) + ".plist",
  );
  if (enabled) atomicWrite(file, launchAgent(home));
  else fs.rmSync(file, { force: true });
  return { enabled, nextLogin: true };
}
export function openBrowser(url) {
  ensure(/^http:\/\/127\.0\.0\.1:\d+\/#/.test(url), "LOCAL_URL_ONLY");
  if (process.platform === "darwin") return command("/usr/bin/open", [url]);
  if (process.platform === "win32")
    return command("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
  return command("/usr/bin/xdg-open", [url]);
}
