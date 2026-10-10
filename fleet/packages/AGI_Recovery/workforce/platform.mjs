import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { need, readFile, digest } from "./core.mjs";
export function inspectInstallation(app = "/Applications/OpenClaw.app") {
  need(
    process.platform === "darwin" && process.arch === "arm64",
    "APPLE_SILICON_REQUIRED",
  );
  need(path.isAbsolute(app) && app.endsWith(".app"), "APP_PATH");
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
  });
  const plist = readFile(path.join(app, "Contents/Info.plist"), 1048576),
    field = (key) =>
      execFileSync(
        "/usr/libexec/PlistBuddy",
        ["-c", "Print :" + key, path.join(app, "Contents/Info.plist")],
        { encoding: "utf8", timeout: 10000 },
      ).trim(),
    executable = field("CFBundleExecutable"),
    bundleId = field("CFBundleIdentifier");
  need(
    /^[A-Za-z0-9_. -]+$/.test(executable) &&
      ![".", ".."].includes(executable) &&
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(bundleId),
    "APP_IDENTITY",
  );
  const binary = path.join(app, "Contents/MacOS", executable);
  const fd = fs.openSync(
      binary,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    ),
    hash = crypto.createHash("sha256");
  try {
    const st = fs.fstatSync(fd);
    need(st.isFile() && st.size > 0 && st.size <= 536870912, "APP_BINARY");
    const b = Buffer.alloc(1048576);
    let size;
    while ((size = fs.readSync(fd, b, 0, b.length, null)) > 0)
      hash.update(b.subarray(0, size));
  } finally {
    fs.closeSync(fd);
  }
  return {
    app,
    bundleId,
    installationSha256: digest({
      executableSha256: hash.digest("hex"),
      infoPlistSha256: digest(plist),
      resourceSealSha256: digest(
        readFile(
          path.join(app, "Contents/_CodeSignature/CodeResources"),
          16777216,
        ),
      ),
    }),
    signatureVerified: true,
  };
}
export function inspectHardware() {
  need(
    process.platform === "darwin" && process.arch === "arm64",
    "APPLE_SILICON_REQUIRED",
  );
  const get = (command, args) =>
    execFileSync(command, args, { encoding: "utf8", timeout: 10000 });
  const ioreg = get("/usr/sbin/ioreg", [
      "-rd1",
      "-c",
      "IOPlatformExpertDevice",
    ]),
    uuid = ioreg.match(/"IOPlatformUUID"\s*=\s*"([A-Fa-f0-9-]+)"/)?.[1];
  need(uuid, "HARDWARE_ID");
  return {
    platform: "darwin",
    arch: "arm64",
    machineSha256: digest(uuid.toLowerCase()),
    osBuild: get("/usr/bin/sw_vers", ["-buildVersion"]).trim(),
    chip: get("/usr/sbin/sysctl", ["-n", "machdep.cpu.brand_string"]).trim(),
    bootSha256: digest(get("/usr/sbin/sysctl", ["-n", "kern.boottime"]).trim()),
  };
}
