import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { ensure, atomicWrite, readJSON } from "../util.mjs";
const scrypt = promisify(crypto.scrypt),
  N = 131072,
  MAX = 48 * 1024 * 1024;
const derive = (password, salt) =>
  scrypt(password, salt, 32, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
function encrypt(value, key, salt, purpose) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const bytes = Buffer.from(JSON.stringify(value));
  ensure(bytes.length <= MAX, "BACKUP_TOO_LARGE");
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    schema: 2,
    purpose,
    kdf: "scrypt",
    N,
    r: 8,
    p: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}
function inspect(e, purpose) {
  ensure(
    e &&
      e.schema === 2 &&
      e.purpose === purpose &&
      e.kdf === "scrypt" &&
      e.N === N &&
      e.r === 8 &&
      e.p === 1,
    "ENCRYPTED_FILE_FORMAT",
  );
  for (const k of ["salt", "iv", "tag", "data"])
    ensure(
      typeof e[k] === "string" &&
        e[k].length < MAX * 1.4 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(e[k]),
      "ENCRYPTED_FILE_FORMAT",
    );
  ensure(
    Buffer.from(e.salt, "base64").length === 32 &&
      Buffer.from(e.iv, "base64").length === 12 &&
      Buffer.from(e.tag, "base64").length === 16,
    "ENCRYPTED_FILE_FORMAT",
  );
}
function decrypt(e, key, purpose) {
  inspect(e, purpose);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(e.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(e.tag, "base64"));
  try {
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(e.data, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new Error("PASSWORD_OR_FILE_INCORRECT");
  }
}
export async function sealBackup(value, password) {
  ensure(
    typeof password === "string" &&
      password.length >= 12 &&
      password.length <= 1024,
    "PASSWORD_LENGTH",
  );
  const salt = crypto.randomBytes(32),
    key = await derive(password, salt);
  try {
    return encrypt(value, key, salt, "agi-agent-backup/v2");
  } finally {
    key.fill(0);
  }
}
export async function openBackup(envelope, password) {
  inspect(envelope, "agi-agent-backup/v2");
  ensure(
    typeof password === "string" && password.length <= 1024,
    "PASSWORD_LENGTH",
  );
  const key = await derive(password, Buffer.from(envelope.salt, "base64"));
  try {
    return decrypt(envelope, key, "agi-agent-backup/v2");
  } finally {
    key.fill(0);
  }
}
export class Vault {
  constructor(home) {
    this.file = path.join(home, "vault.json");
    this.key = null;
    this.value = null;
    this.salt = null;
  }
  get exists() {
    return fs.existsSync(this.file);
  }
  get unlocked() {
    return this.key !== null;
  }
  async create(password) {
    ensure(!this.exists, "VAULT_ALREADY_EXISTS");
    ensure(
      typeof password === "string" &&
        password.length >= 12 &&
        password.length <= 1024,
      "PASSWORD_LENGTH",
    );
    this.salt = crypto.randomBytes(32);
    this.key = await derive(password, this.salt);
    this.value = {};
    this.save();
  }
  async unlock(password) {
    ensure(
      typeof password === "string" && password.length <= 1024,
      "PASSWORD_LENGTH",
    );
    const e = readJSON(this.file);
    inspect(e, "agi-agent-vault/v2");
    const key = await derive(password, Buffer.from(e.salt, "base64"));
    try {
      this.value = decrypt(e, key, "agi-agent-vault/v2");
      this.lockKey();
      this.key = key;
      this.salt = Buffer.from(e.salt, "base64");
    } catch (error) {
      key.fill(0);
      throw error;
    }
  }
  unlockKey(encoded) {
    const key = Buffer.from(encoded, "base64");
    ensure(key.length === 32, "OS_CREDENTIAL_INVALID");
    const e = readJSON(this.file);
    try {
      const value = decrypt(e, key, "agi-agent-vault/v2");
      this.lock();
      this.key = key;
      this.value = value;
      this.salt = Buffer.from(e.salt, "base64");
    } catch (error) {
      key.fill(0);
      throw error;
    }
  }
  get(name) {
    ensure(this.unlocked, "NODE_LOCKED");
    return this.value[name];
  }
  set(values) {
    ensure(this.unlocked, "NODE_LOCKED");
    ensure(
      Object.keys(values).every((k) =>
        [
          "rpcURL",
          "verificationRPCURL",
          "privateKey",
          "walletRecovery",
          "openclawToken",
          "publicWebAuthority",
        ].includes(k),
      ),
      "VAULT_FIELD",
    );
    Object.assign(this.value, values);
    this.save();
  }
  save() {
    ensure(this.unlocked, "NODE_LOCKED");
    atomicWrite(
      this.file,
      JSON.stringify(
        encrypt(this.value, this.key, this.salt, "agi-agent-vault/v2"),
      ) + "\n",
    );
  }
  lockKey() {
    this.key?.fill(0);
    this.key = null;
  }
  lock() {
    this.lockKey();
    this.value = null;
    this.salt = null;
  }
  async verifyPassword(password) {
    const other = new Vault(path.dirname(this.file));
    try {
      await other.unlock(password);
      return true;
    } finally {
      other.lock();
    }
  }
}
