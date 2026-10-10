import path from "node:path";
import crypto from "node:crypto";
import { fixture } from "./workforce-fixture.mjs";
import { atomic, createIdentity } from "../workforce/core.mjs";
import { nativeRuntime, grantBody, signGrant } from "../workforce/runner.mjs";
import { signAuthority } from "../workforce/authority.mjs";
import { recipientId } from "../workforce/envelope.mjs";
import core from "../workforce/core/computer-work.cjs";
export function nativeV3(dir, role = "agent", operator = null) {
  const f = fixture(dir, 29501, role);
  if (operator) {
    f.operator = operator;
    f.c.operatorPublicKey = operator.publicKey.export({
      type: "spki",
      format: "pem",
    });
  }
  f.c.nodeId = role + "-node";
  f.c.revocationFile = path.join(dir, role + "-authority.json");
  f.c.receiptPublicKey = crypto
    .createPublicKey(createIdentity(f.c.identityDir).privateKey)
    .export({ type: "spki", format: "pem" });
  f.spec.profile = "computer-work/v3";
  f.spec.dataPolicy = "confidential";
  f.spec.privacy = {
    recipientKeyIds: f.c.recipientPublicKeys.map(recipientId),
    retentionSeconds: 86400,
    publicDisclosure: "commitment-only",
    modelProcessing: "approved-provider",
  };
  f.spec.execution = {
    maxWallSeconds: 86400,
    leaseSeconds: 5,
    maxResumes: 3,
    retryBudget: 0,
  };
  f.spec.permissions = Object.fromEntries(
    ["agent", "reviewer"].map((r) => [
      r,
      {
        enforcement: "whole-account",
        allowedActions: ["screenshot", "type"],
        capabilityHandles: ["task-account"],
        externalEffects: ["whole-account-interaction"],
        expiresAt: f.spec.deadline,
      },
    ]),
  );
  f.spec.environment.runtimeSha256.agent = core.digest(nativeRuntime(f.c));
  f.spec.environment.runtimeSha256.reviewer = core.digest(nativeRuntime(f.c));
  f.authority = {
    schema: "agi-native-authority/v1",
    nodeId: f.c.nodeId,
    role,
    sequence: 1,
    issuedAt: Math.floor(Date.now() / 1000) - 1,
    expiresAt: f.spec.deadline,
    disabled: false,
    revokedGrantNonces: [],
  };
  atomic(f.c.revocationFile, signAuthority(f.authority, f.operator.privateKey));
  f.packet = {
    ...f.packet,
    specification: f.spec,
    grant: signGrant(grantBody(f.c, f.spec), f.operator.privateKey),
  };
  return f;
}
