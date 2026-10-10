import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  need,
  exact,
  integer,
  canonical,
  digest,
  readFile,
  createIdentity,
} from "./core.mjs";
export function signAuthority(body, key) {
  return {
    body,
    signature: crypto
      .sign(null, Buffer.from(canonical(body)), key)
      .toString("base64"),
  };
}
export function verifySigned(record, key) {
  exact(record, ["body", "signature"]);
  need(
    typeof record.signature === "string" &&
      Buffer.from(record.signature, "base64").toString("base64") ===
        record.signature &&
      crypto.verify(
        null,
        Buffer.from(canonical(record.body)),
        key,
        Buffer.from(record.signature, "base64"),
      ),
    "SIGNED_RECORD",
  );
  return record.body;
}
export function checkAuthority(
  c,
  grant,
  journal,
  {
    now = Math.floor(Date.now() / 1000),
    required = false,
    requireExternalOwner = false,
  } = {},
) {
  if (!c.revocationFile) {
    need(!required, "REVOCATION_REQUIRED");
    return;
  }
  if (requireExternalOwner) {
    let f = c.revocationFile;
    for (;;) {
      const st = fs.lstatSync(f);
      need(
        !st.isSymbolicLink() &&
          st.uid !== process.getuid() &&
          (st.mode & 0o022) === 0,
        "AUTHORITY_WRITABLE_BY_COMPUTE",
      );
      if (path.dirname(f) === f) break;
      f = path.dirname(f);
    }
  }
  const b = verifySigned(
    JSON.parse(readFile(c.revocationFile, 65536)),
    c.operatorPublicKey,
  );
  exact(b, [
    "schema",
    "nodeId",
    "role",
    "sequence",
    "issuedAt",
    "expiresAt",
    "disabled",
    "revokedGrantNonces",
  ]);
  need(
    b.schema === "agi-native-authority/v1" &&
      b.nodeId === c.nodeId &&
      b.role === c.role &&
      integer(b.sequence, 0, Number.MAX_SAFE_INTEGER) &&
      integer(b.issuedAt, 1, now) &&
      integer(b.expiresAt, now + 1, b.issuedAt + 604800) &&
      typeof b.disabled === "boolean" &&
      Array.isArray(b.revokedGrantNonces) &&
      b.revokedGrantNonces.length <= 1000 &&
      b.revokedGrantNonces.every(
        (n) => typeof n === "string" && n.length <= 80,
      ),
    "AUTHORITY_RECORD",
  );
  journal.monotonic(
    "authority:" + digest(c.operatorPublicKey) + ":" + c.nodeId,
    b.sequence,
  );
  for (const nonce of b.revokedGrantNonces)
    journal.monotonic(
      "revoked:" + digest(c.operatorPublicKey) + ":" + nonce,
      1,
    );
  need(
    !b.disabled &&
      !journal.db
        .prepare("SELECT 1 FROM monotonic WHERE key=?")
        .get("revoked:" + digest(c.operatorPublicKey) + ":" + grant.nonce),
    "AUTHORITY_REVOKED",
  );
}
export function checkNativePermission(
  spec,
  role,
  action,
  now = Math.floor(Date.now() / 1000),
) {
  if (spec.profile !== "computer-work/v3") return;
  const p = spec.permissions[role];
  need(p.enforcement !== "broker-scoped", "SCOPED_BROKER_ADAPTER_REQUIRED");
  need(
    p.expiresAt > now && p.allowedActions.includes(action),
    "ACTION_AUTHORITY",
  );
  if (p.enforcement === "observe-only")
    need(
      ["screenshot", "list_apps", "list_windows", "get_window_state"].includes(
        action,
      ),
      "READ_ONLY",
    );
}
export function signReceipt(c, payload) {
  const identity = createIdentity(c.identityDir),
    body = {
      schema: "agi-native-receipt/v1",
      role: c.role,
      nodeId: c.nodeId,
      ...payload,
    };
  return signAuthority(body, identity.privateKey);
}
export function verifyReceipt(
  c,
  record,
  { grantSha256, specSha256, runtimeSha256, encryptedSha256 },
) {
  need(c.receiptPublicKey, "RECEIPT_IDENTITY_REQUIRED");
  const b = verifySigned(record, c.receiptPublicKey);
  exact(b, [
    "schema",
    "role",
    "nodeId",
    "run",
    "grantSha256",
    "specSha256",
    "runtimeSha256",
    "encryptedSha256",
    "status",
    "finishedAt",
  ]);
  need(
    b.schema === "agi-native-receipt/v1" &&
      b.role === c.role &&
      b.nodeId === c.nodeId &&
      b.grantSha256 === grantSha256 &&
      b.run === "job-" + grantSha256 &&
      b.specSha256 === specSha256 &&
      b.runtimeSha256 === runtimeSha256 &&
      b.encryptedSha256 === encryptedSha256 &&
      ["complete", "uncertain"].includes(b.status) &&
      integer(b.finishedAt, 1, Number.MAX_SAFE_INTEGER),
    "RECEIPT_SCOPE",
  );
  return b;
}
