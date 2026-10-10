import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export const encode = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
export function canonical(v) {
  return JSON.stringify(normalize(v));
}
function normalize(v) {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, normalize(v[k])]),
    );
  return v;
}
export function ensure(condition, code) {
  if (!condition) throw new NodeError(code);
}
export class NodeError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export const codeOf = (e) =>
  e instanceof NodeError ? e.code : "DEPENDENCY_OR_NETWORK_ERROR";
export function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(dir, 0o700);
}
export function atomicWrite(file, value) {
  privateDir(path.dirname(file));
  const temp = file + "." + crypto.randomUUID() + ".tmp";
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
  if (process.platform !== "win32") {
    const d = fs.openSync(path.dirname(file), "r");
    try {
      fs.fsyncSync(d);
    } finally {
      fs.closeSync(d);
    }
  }
}
export function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
export async function pool(items, concurrency, work) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await work(items[i]);
      }
    }),
  );
}
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function safeInteger(n, min, max, name) {
  ensure(Number.isSafeInteger(n) && n >= min && n <= max, "CONFIG_" + name);
  return n;
}
export function strictKeys(value, keys, code) {
  ensure(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every((k) => keys.includes(k)),
    code,
  );
}
