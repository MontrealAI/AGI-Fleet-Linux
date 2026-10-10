import { getAddress, ZeroAddress } from "ethers";
import { ensure, strictKeys, canonical } from "./util.mjs";
export const AUTONOMY_DECLARATION =
  "AGI-AUTONOMY-V1: public inputs; immutable formal criteria and named automated moderators determine acceptance and dispute resolution.";
export const FORMAL_PROFILES = [
  "json-rules/v1",
  "json-schema-2020-12/v1",
  "csv-table/v1",
  "text-checks/v1",
  "file-sha256/v1",
];
export function autonomySpec(value, validate) {
  strictKeys(
    value,
    [
      "schema",
      "title",
      "task",
      "inputs",
      "dataPolicy",
      "acceptance",
      "resolution",
    ],
    "AUTONOMY_FIELDS",
  );
  ensure(
    value.schema === "agi-autonomy-job/v1" && value.dataPolicy === "public",
    "AUTONOMY_SCHEMA",
  );
  ensure(
    typeof value.title === "string" &&
      value.title.length > 0 &&
      value.title.length <= 160 &&
      typeof value.task === "string" &&
      value.task.length > 0 &&
      value.task.length <= 6000 &&
      typeof value.inputs === "string" &&
      value.inputs.length <= 10000 &&
      Buffer.byteLength(canonical(value)) <= 18000,
    "AUTONOMY_SIZE",
  );
  strictKeys(
    value.resolution,
    ["mode", "moderators", "neutralRefund"],
    "AUTONOMY_RESOLUTION",
  );
  ensure(
    value.resolution.mode === "formal-only/v1" &&
      value.resolution.neutralRefund === true &&
      Array.isArray(value.resolution.moderators) &&
      value.resolution.moderators.length > 0 &&
      value.resolution.moderators.length <= 20,
    "AUTONOMY_POLICY",
  );
  const a = value.resolution.moderators.map(getAddress);
  ensure(
    new Set(a).size === a.length && !a.includes(ZeroAddress),
    "AUTONOMY_MODERATORS",
  );
  ensure(
    FORMAL_PROFILES.includes(value.acceptance?.profile),
    "AUTONOMY_FORMAL_ONLY",
  );
  validate(value.acceptance);
  return value;
}
export function unwrapSpecification(
  value,
  details,
  validate,
  legacyDeclaration,
) {
  if (details === AUTONOMY_DECLARATION)
    return autonomySpec(value, validate).acceptance;
  ensure(details === legacyDeclaration, "UNSUPPORTED_ACCEPTANCE_DECLARATION");
  return validate(value);
}
