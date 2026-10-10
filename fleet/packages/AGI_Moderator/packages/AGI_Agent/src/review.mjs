import {isComputerSpec,validateComputerSpec,evaluateComputer} from './artifacts.mjs';
import { isImageSpec, validateImageSpec, evaluateImage } from './images.mjs';
import { validateExtended, evaluateExtended } from "./profiles.mjs";
import { ensure, strictKeys, canonical, sha256, codeOf } from "./util.mjs";
export const DECLARATION =
  "AGI-NODE-V1: the immutable job specification contains the complete acceptance criteria.";
const OPS = [
  "equals",
  "type",
  "numberRange",
  "stringLength",
  "arrayLength",
  "includes",
  "requiredKeys",
  "sha256",
];
export function boundedJSON(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let pos = 0,
    count = 0;
  const ws = () => {
    while (/[\t\n\r ]/.test(text[pos] ?? "!")) pos++;
  };
  const string = () => {
    const start = pos++;
    while (pos < text.length) {
      const ch = text[pos++];
      if (ch === "\\") {
        pos++;
        continue;
      }
      if (ch === '"') return JSON.parse(text.slice(start, pos));
    }
    throw new Error("JSON_STRING");
  };
  const value = (depth) => {
    ensure(depth <= 24 && ++count <= 12000, "JSON_COMPLEXITY");
    ws();
    const ch = text[pos];
    if (ch === '"') return string();
    if (ch === "{" || ch === "[") {
      const object = ch === "{",
        out = object ? {} : [],
        keys = new Set(),
        end = object ? "}" : "]";
      pos++;
      ws();
      if (text[pos] === end) {
        pos++;
        return out;
      }
      for (;;) {
        ws();
        let key;
        if (object) {
          ensure(text[pos] === '"', "JSON_KEY");
          key = string();
          ensure(!keys.has(key), "JSON_DUPLICATE_KEY");
          keys.add(key);
          ensure(
            !["__proto__", "constructor", "prototype"].includes(key),
            "JSON_UNSAFE_KEY",
          );
          ws();
          ensure(text[pos++] === ":", "JSON_COLON");
        }
        const v = value(depth + 1);
        if (object) out[key] = v;
        else out.push(v);
        ws();
        const sep = text[pos++];
        if (sep === end) return out;
        ensure(sep === ",", "JSON_SEPARATOR");
      }
    }
    for (const [word, v] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ])
      if (text.startsWith(word, pos)) {
        pos += word.length;
        return v;
      }
    const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      text.slice(pos),
    );
    ensure(token, "JSON_VALUE");
    pos += token[0].length;
    const n = Number(token[0]);
    ensure(
      Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER,
      "JSON_NUMBER_RANGE",
    );
    return n;
  };
  const data = value(0);
  ws();
  ensure(pos === text.length, "JSON_TRAILING_DATA");
  return data;
}
export function validateSpec(s) {
  if (isComputerSpec(s)) return validateComputerSpec(s);
  if (isImageSpec(s)) return validateImageSpec(s);
  ensure(
    s &&
      s.schema === "agi-node-job/v1" &&
      typeof s.title === "string" &&
      s.title.length <= 160,
    "SPEC_SCHEMA",
  );
  if (validateExtended(s)) return s;

  strictKeys(
    s,
    ["schema", "profile", "title", "rules", "sha256"],
    "SPEC_UNKNOWN_FIELD",
  );
  ensure(
    s.schema === "agi-node-job/v1" &&
      typeof s.title === "string" &&
      s.title.length <= 160,
    "SPEC_SCHEMA",
  );
  if (s.profile === "file-sha256/v1") {
    ensure(
      /^[0-9a-f]{64}$/.test(s.sha256) && !("rules" in s),
      "SPEC_FILE_HASH",
    );
    return s;
  }
  ensure(
    s.profile === "json-rules/v1" &&
      !("sha256" in s) &&
      Array.isArray(s.rules) &&
      s.rules.length > 0 &&
      s.rules.length <= 64,
    "SPEC_PROFILE",
  );
  const ids = new Set();
  for (const r of s.rules) {
    strictKeys(
      r,
      ["id", "path", "op", "value", "min", "max"],
      "RULE_UNKNOWN_FIELD",
    );
    ensure(
      typeof r.id === "string" &&
        /^[a-zA-Z0-9_-]{1,40}$/.test(r.id) &&
        !ids.has(r.id),
      "RULE_ID",
    );
    ids.add(r.id);
    ensure(
      typeof r.path === "string" &&
        r.path.length <= 512 &&
        (r.path === "" || r.path.startsWith("/")) &&
        !/~(?![01])/.test(r.path),
      "RULE_POINTER",
    );
    ensure(OPS.includes(r.op), "RULE_OP");
    if (["numberRange", "stringLength", "arrayLength"].includes(r.op)) {
      ensure(
        !("value" in r) &&
          Number.isFinite(r.min) &&
          Number.isFinite(r.max) &&
          r.min <= r.max,
        "RULE_RANGE",
      );
      if (r.op !== "numberRange")
        ensure(
          Number.isSafeInteger(r.min) &&
            Number.isSafeInteger(r.max) &&
            r.min >= 0 &&
            r.max <= 1048576,
          "RULE_LENGTH",
        );
    } else {
      ensure("value" in r && !("min" in r) && !("max" in r), "RULE_VALUE");
    }
    if (r.op === "type")
      ensure(
        ["string", "number", "boolean", "object", "array", "null"].includes(
          r.value,
        ),
        "RULE_TYPE",
      );
    if (r.op === "includes")
      ensure(
        typeof r.value === "string" &&
          r.value.length > 0 &&
          r.value.length <= 10000,
        "RULE_INCLUDES",
      );
    if (r.op === "requiredKeys")
      ensure(
        Array.isArray(r.value) &&
          r.value.length <= 100 &&
          r.value.every((k) => typeof k === "string" && k.length <= 100),
        "RULE_KEYS",
      );
    if (r.op === "sha256") ensure(/^[0-9a-f]{64}$/.test(r.value), "RULE_HASH");
  }
  return s;
}
function pointer(data, p) {
  let v = data;
  if (p === "") return v;
  for (const raw of p.slice(1).split("/")) {
    const k = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (
      ["__proto__", "prototype", "constructor"].includes(k) ||
      v === null ||
      typeof v !== "object" ||
      !Object.hasOwn(v, k)
    )
      return undefined;
    v = v[k];
  }
  return v;
}
export function evaluate(spec, bytes) {
  validateSpec(spec);
  if (isComputerSpec(spec)) return evaluateComputer(spec, bytes);
  if (isImageSpec(spec)) return evaluateImage(spec, bytes);
  const extended = evaluateExtended(spec, bytes, boundedJSON);
  if (extended) return extended;
  if (spec.profile === "file-sha256/v1")
    return {
      decision: sha256(bytes) === spec.sha256 ? "approve" : "reject",
      checks: [{ id: "file-hash", passed: sha256(bytes) === spec.sha256 }],
    };
  let data;
  try {
    data = boundedJSON(bytes);
  } catch {
    return {
      decision: "reject",
      checks: [{ id: "valid-json", passed: false }],
    };
  }
  const checks = spec.rules.map((r) => {
    const v = pointer(data, r.path);
    let passed = false;
    switch (r.op) {
      case "equals":
        passed = v !== undefined && canonical(v) === canonical(r.value);
        break;
      case "type":
        passed =
          (v === null ? "null" : Array.isArray(v) ? "array" : typeof v) ===
          r.value;
        break;
      case "numberRange":
        passed = typeof v === "number" && v >= r.min && v <= r.max;
        break;
      case "stringLength":
        passed =
          typeof v === "string" &&
          [...v].length >= r.min &&
          [...v].length <= r.max;
        break;
      case "arrayLength":
        passed = Array.isArray(v) && v.length >= r.min && v.length <= r.max;
        break;
      case "includes":
        passed = typeof v === "string" && v.includes(r.value);
        break;
      case "requiredKeys":
        passed =
          v !== null &&
          typeof v === "object" &&
          !Array.isArray(v) &&
          r.value.every((k) => Object.hasOwn(v, k));
        break;
      case "sha256":
        passed = typeof v === "string" && sha256(v) === r.value;
        break;
    }
    return { id: r.id, passed };
  });
  return {
    decision: checks.every((c) => c.passed) ? "approve" : "reject",
    checks,
  };
}
