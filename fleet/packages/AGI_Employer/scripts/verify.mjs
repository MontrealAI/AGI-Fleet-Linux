import fs from "node:fs";
import path from "node:path";
import { ROOT, sha256, ensure } from "../ops/common.mjs";
const inventory = path.join(ROOT, "MANIFEST.sha256");
ensure(fs.existsSync(inventory), "RELEASE_MANIFEST_MISSING");
let checked = 0,
  failed = 0;
for (const line of fs.readFileSync(inventory, "utf8").trim().split("\n")) {
  const m = /^([0-9a-f]{64})  (.+)$/.exec(line);
  ensure(
    m && !path.isAbsolute(m[2]) && !m[2].split("/").includes(".."),
    "INVALID_MANIFEST",
  );
  try {
    const p = path.join(ROOT, m[2]);
    ensure(
      fs.realpathSync(p).startsWith(path.resolve(ROOT) + path.sep),
      "EXTERNAL_SYMLINK",
    );
    ensure(sha256(fs.readFileSync(p)) === m[1], "HASH_CHANGED");
    checked++;
  } catch {
    console.error("MISSING OR CHANGED: " + m[2]);
    failed++;
  }
}
console.log(
  `${checked} files verified; ${failed} missing or changed. This is an integrity check, not a developer signature.`,
);
process.exitCode = failed ? 1 : 0;
