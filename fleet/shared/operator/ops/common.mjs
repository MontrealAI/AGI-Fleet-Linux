import {consumerRoot} from './consumer.mjs';
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { acquireFileLease } from "../packages/AGI_Node/src/wallet-lease.mjs";
export {
  ensure,
  canonical,
  sha256,
  atomicWrite,
  privateDir,
  strictKeys,
  safeInteger,
  encode,
} from "../packages/AGI_Node/src/util.mjs";
export const ROOT = consumerRoot;
export const now = () => Math.floor(Date.now() / 1000);
export const json = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v));
export const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
export function errorCode(e) {
  const s = e?.code ?? e?.message;
  return typeof s === "string" && /^[A-Z][A-Z0-9_]{2,100}$/.test(s)
    ? s
    : "DEPENDENCY_OR_NETWORK_ERROR";
}
export const criticalError = (code) =>
  /REORG|POLICY_CHANGED|NONCE|JOURNAL|SIGNATURE|STORAGE|CLOCK|RPC_DISAGREEMENT|LEASE|SIGNER_MISMATCH/.test(
    code,
  );
export const serviceError = (code) =>
  criticalError(code) ||
  /^(RPC_|NETWORK_|SERVICE_STOPPING|AUTHORITY_NOT_ACTIVE|TRANSACTION_DAILY_LIMIT|GAS_DAILY_LIMIT|GAS_PRICE_LIMIT|INSUFFICIENT_ETH)/.test(
    code,
  );
export function acquireLock(home) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.chmodSync(home, 0o700);
  const release = acquireFileLease(path.join(home, "process-lock.sqlite"));
  try {
    const file = path.join(home, "process.lock"),
      token = crypto.randomBytes(24).toString("hex");
    if (fs.existsSync(file)) {
      let old;
      try {
        old = JSON.parse(fs.readFileSync(file));
        if (!Number.isSafeInteger(old.pid) || old.pid < 1)
          throw Error("LOCK_REQUIRES_REVIEW");
      } catch {
        throw Error("LOCK_REQUIRES_REVIEW");
      }
      try {
        process.kill(old.pid, 0);
        throw Error("INSTANCE_ALREADY_RUNNING");
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
      }
      fs.unlinkSync(file);
    }
    fs.writeFileSync(file, json({ pid: process.pid, token }), {
      flag: "wx",
      mode: 0o600,
    });
    return () => {
      try {
        if (JSON.parse(fs.readFileSync(file)).token === token)
          fs.unlinkSync(file);
      } catch {
      } finally {
        release();
      }
    };
  } catch (error) {
    release();
    throw error;
  }
}
