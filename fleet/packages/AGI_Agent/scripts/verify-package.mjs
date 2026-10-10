#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ROOT, sha256 } from "../src/util.mjs";
const file = path.join(ROOT, "MANIFEST.sha256");
if (!fs.existsSync(file)) {
  console.error(
    "MANIFEST.sha256 is generated when the delivery ZIP is packaged.",
  );
  process.exit(1);
}
let checked = 0,
  failed = 0;
for (const line of fs.readFileSync(file, "utf8").trim().split("\n")) {
  const m = /^([0-9a-f]{64})  (.+)$/.exec(line);
  if (!m || path.isAbsolute(m[2]) || m[2].split("/").includes(".."))
    throw new Error("Invalid manifest");
  try {
    if (sha256(fs.readFileSync(path.join(ROOT, m[2]))) !== m[1])
      throw new Error("Changed");
    checked++;
  } catch {
    console.error("MISSING OR CHANGED: " + m[2]);
    failed++;
  }
}
console.log(
  `${checked} files verified; ${failed} missing or changed. Runtime state and your private configuration are intentionally outside the package manifest.`,
);
process.exitCode = failed ? 1 : 0;
