import fs from "node:fs";
import { ensure } from "./util.mjs";
export const VERSION = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
export function supportedRuntime(version = process.versions.node) {
  const [major, minor, patch] = version.split(".").map(Number);
  return (
    major === 24 &&
    Number.isInteger(minor) &&
    minor >= 19 &&
    Number.isInteger(patch) &&
    patch >= 0
  );
}
export function assertRuntime() {
  ensure(supportedRuntime(), "NODE_24_REQUIRED");
}
