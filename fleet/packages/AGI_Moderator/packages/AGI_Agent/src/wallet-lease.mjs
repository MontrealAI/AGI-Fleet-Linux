import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// OS-backed SQLite locks are released on process death. Never unlink this
// database: doing so would create a second inode and allow two writers.
export function acquireFileLease(file, busyCode = "INSTANCE_ALREADY_RUNNING") {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
    throw Error("LEASE_PATH_INVALID");
  let db;
  try {
    db = new DatabaseSync(file);
    fs.chmodSync(file, 0o600);
    db.exec(
      "PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS holder(pid INTEGER);",
    );
    db.prepare("INSERT INTO holder VALUES(?)").run(process.pid);
  } catch (error) {
    try {
      db?.close();
    } catch {}
    if (error.errcode === 5 || error.errcode === 6) throw Error(busyCode);
    throw Error("LEASE_UNAVAILABLE");
  }
  let released = false;
  return () => {
    if (!released) {
      released = true;
      try {
        db.exec("ROLLBACK");
      } finally {
        db.close();
      }
    }
  };
}

export function acquireWalletLease(
  chainId,
  wallet,
  directory = path.join(
    os.homedir(),
    "Library/Application Support/AGI Wallet Leases",
  ),
) {
  if (
    !Number.isSafeInteger(chainId) ||
    chainId < 1 ||
    !/^0x[0-9a-fA-F]{40}$/.test(wallet)
  )
    throw Error("WALLET_LEASE_IDENTITY");
  return acquireFileLease(
    path.join(directory, `${chainId}-${wallet.toLowerCase()}.sqlite`),
    "WALLET_ALREADY_RUNNING",
  );
}
