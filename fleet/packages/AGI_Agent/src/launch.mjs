#!/usr/bin/env node
import { profilePort, seedProfileHome } from './control/wallet-profile.mjs';
import fs from "node:fs";
import { VERSION, assertRuntime } from "./version.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Controller, defaultHome } from "./control/controller.mjs";
import { createControlServer } from "./control/server.mjs";
import { openBrowser } from "./control/os-integration.mjs";
import { privateDir, atomicWrite, readJSON, ensure } from "./util.mjs";
import { publicError } from "./control/messages.mjs";
const args = process.argv.slice(2),
  value = (key, fallback) => {
    const at = args.indexOf("--" + key);
    return at < 0 ? fallback : args[at + 1];
  },
  originalHome = path.resolve(value("home", defaultHome())),
  home = args.includes("--seed-profile") ? seedProfileHome(originalHome) : originalHome,
  background = args.includes("--background"),
  noOpen = args.includes("--no-open"),
  port = Number(value("port", String(profilePort(home))));
privateDir(home);
const lockFile = path.join(home, "application.lock"),
  launchFile = path.join(home, "launch.json");
let lockFD;
async function reopen() {
  const record = readJSON(launchFile);
  ensure(
    Number.isSafeInteger(record.port) && record.port > 0 && record.port < 65536,
    "APP_RECORD_INVALID",
  );
  const origin = `http://127.0.0.1:${record.port}`;
  const response = await fetch(origin + "/api/launch", {
    method: "POST",
    headers: {
      Origin: origin,
      Authorization: "Bearer " + record.secret,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(3000),
  });
  ensure(response.ok, "APP_ALREADY_RUNNING");
  const result = await response.json();
  if (!background && !noOpen) await openBrowser(result.url).catch(() => {});
  if (!background) console.log("Your private AGI Agent: " + result.url);
}
async function main() {
  assertRuntime();
  try {
    lockFD = fs.openSync(lockFile, "wx", 0o600);
    fs.writeFileSync(lockFD, JSON.stringify({ pid: process.pid }));
    fs.fsyncSync(lockFD);
  } catch {
    const existing = readJSON(lockFile);
    let alive = true;
    try {
      process.kill(existing.pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") alive = false;
    }
    if (alive) {
      await reopen();
      return;
    }
    fs.unlinkSync(lockFile);
    return main();
  }
  const controller = new Controller(home);
  let ui,
    closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await controller.close();
    await ui?.close();
    fs.rmSync(launchFile, { force: true });
    fs.closeSync(lockFD);
    fs.rmSync(lockFile, { force: true });
  };
  try {
    ui = await createControlServer(controller, {
      port,
      onQuit: async () => {
        await close();
        process.exit(0);
      },
    });
    atomicWrite(
      launchFile,
      JSON.stringify({
        pid: process.pid,
        port: ui.port,
        secret: ui.launchSecret,
      }),
    );
    console.log(`AGI Agent ${VERSION} · Private Operator Edition`);
    if (!background) {
      console.log("Open your private app: " + ui.url);
      if (!noOpen)
        await openBrowser(ui.url).catch(() =>
          console.log("Open the link above in your browser."),
        );
    }
    await controller.boot();
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => close().then(() => process.exit(0)));
  } catch (error) {
    await close();
    throw error;
  }
}
main().catch((error) => {
  const message = publicError(error);
  console.error(message.title + ". " + message.action);
  process.exitCode = 1;
});
