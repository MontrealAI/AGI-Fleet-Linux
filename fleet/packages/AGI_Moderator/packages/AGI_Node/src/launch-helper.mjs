import { defaultHome } from './control/controller.mjs';
import { seedProfileHome, profilePort } from './control/wallet-profile.mjs';
// macOS graphical wrapper. The node remains a separate local background process.
import { spawn, execFile } from "node:child_process";
import path from "node:path";
import { ROOT } from "./util.mjs";
import { openBrowser } from "./control/os-integration.mjs";
const seedHome = process.argv.includes('--seed-profile') ? seedProfileHome(defaultHome()) : null;
const child = spawn(
  process.execPath,
  [path.join(ROOT, "src/launch.mjs"), "--no-open", ...(seedHome ? ["--home", seedHome, "--port", String(profilePort(seedHome))] : [])],
  { cwd: ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"] },
);
try {
  const url = await new Promise((resolve, reject) => {
    let output = "",
      error = "";
    const timer = setTimeout(
      () =>
        reject(
          Error("Startup timed out. Open START_HERE.html for recovery steps."),
        ),
      15000,
    );
    child.stdout.on("data", (chunk) => {
      output = (output + chunk).slice(-8192);
      const match = /http:\/\/127\.0\.0\.1:\d+\/#[a-f0-9]{64}/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.stderr.on("data", (chunk) => {
      error = (error + chunk).slice(-2048);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(Error("The local application could not start."));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(Error(error || "The local application could not start."));
    });
  });
  await openBrowser(url);
} catch (error) {
  if (process.platform === "darwin")
    await new Promise((resolve) =>
      execFile(
        "/usr/bin/osascript",
        [
          "-e",
          'on run argv\ndisplay dialog (item 1 of argv) buttons {"OK"} default button "OK" with title "AGI Node"\nend run',
          String(error.message).slice(0, 1800),
        ],
        () => resolve(),
      ),
    );
  else console.error(error.message);
} finally {
  child.stdout.destroy();
  child.stderr.destroy();
  child.unref();
}
