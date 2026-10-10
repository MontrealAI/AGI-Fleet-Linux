import Ajv2020 from "ajv/dist/2020.js";
import { ensure, strictKeys, canonical } from "./util.mjs";
const ajv = new Ajv2020({
  strict: true,
  allErrors: false,
  validateFormats: false,
  ownProperties: true,
  addUsedSchema: false,
  allowUnionTypes: false,
});
const validators = new Map();
const schemaKeys = [
  "$schema",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "enum",
  "const",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "title",
  "description",
];
export function validateExtended(s) {
  if (s.profile === "json-schema-2020-12/v1") {
    strictKeys(
      s,
      ["schema", "profile", "title", "acceptanceSchema"],
      "SPEC_UNKNOWN_FIELD",
    );
    let count = 0;
    function walk(node, depth = 0) {
      ensure(++count <= 256 && depth <= 8, "SCHEMA_COMPLEXITY");
      if (typeof node === "boolean") return;
      strictKeys(node, schemaKeys, "SCHEMA_KEYWORD_UNSUPPORTED");
      if (node.$schema)
        ensure(
          node.$schema === "https://json-schema.org/draft/2020-12/schema",
          "SCHEMA_DRAFT",
        );
      if (node.properties) {
        ensure(
          typeof node.properties === "object" &&
            !Array.isArray(node.properties) &&
            Object.keys(node.properties).length <= 100,
          "SCHEMA_PROPERTIES",
        );
        for (const [k, v] of Object.entries(node.properties)) {
          ensure(
            !["__proto__", "prototype", "constructor"].includes(k),
            "SCHEMA_PROPERTY",
          );
          walk(v, depth + 1);
        }
      }
      for (const k of ["items", "additionalProperties", "not"])
        if (k in node) walk(node[k], depth + 1);
      for (const k of ["allOf", "anyOf", "oneOf"])
        if (k in node) {
          ensure(
            Array.isArray(node[k]) && node[k].length > 0 && node[k].length <= 8,
            "SCHEMA_BRANCHES",
          );
          for (const v of node[k]) walk(v, depth + 1);
        }
      if (node.enum)
        ensure(
          Array.isArray(node.enum) && node.enum.length <= 100,
          "SCHEMA_ENUM",
        );
    }
    walk(s.acceptanceSchema);
    const key = canonical(s.acceptanceSchema);
    ensure(key.length <= 65536, "SCHEMA_SIZE");
    if (!validators.has(key)) {
      ensure(ajv.validateSchema(s.acceptanceSchema), "SCHEMA_INVALID");
      const validate = ajv.compile(s.acceptanceSchema);
      if (validators.size >= 64)
        validators.delete(validators.keys().next().value);
      validators.set(key, validate);
    }
    return s;
  }
  if (s.profile === "csv-table/v1") {
    strictKeys(
      s,
      [
        "schema",
        "profile",
        "title",
        "columns",
        "minRows",
        "maxRows",
        "uniqueBy",
      ],
      "SPEC_UNKNOWN_FIELD",
    );
    ensure(
      Array.isArray(s.columns) &&
        s.columns.length > 0 &&
        s.columns.length <= 100,
      "CSV_COLUMNS",
    );
    ensure(
      Number.isInteger(s.minRows) &&
        Number.isInteger(s.maxRows) &&
        s.minRows >= 0 &&
        s.maxRows >= s.minRows &&
        s.maxRows <= 5000,
      "CSV_ROWS",
    );
    const names = new Set();
    for (const c of s.columns) {
      strictKeys(
        c,
        ["name", "type", "required", "min", "max", "equals", "enum"],
        "CSV_COLUMN_FIELD",
      );
      ensure(
        typeof c.name === "string" &&
          /^[A-Za-z][A-Za-z0-9 _-]{0,63}$/.test(c.name) &&
          !names.has(c.name),
        "CSV_COLUMN_NAME",
      );
      names.add(c.name);
      ensure(
        ["string", "number", "boolean"].includes(c.type),
        "CSV_COLUMN_TYPE",
      );
      ensure(
        c.required === undefined || typeof c.required === "boolean",
        "CSV_REQUIRED",
      );
      if ("min" in c || "max" in c) {
        ensure(
          Number.isFinite(c.min) &&
            Number.isFinite(c.max) &&
            c.min <= c.max &&
            c.type !== "boolean",
          "CSV_RANGE",
        );
        if (c.type === "string")
          ensure(
            Number.isInteger(c.min) &&
              Number.isInteger(c.max) &&
              c.min >= 0 &&
              c.max <= 1048576,
            "CSV_LENGTH",
          );
      }
      if (c.enum)
        ensure(
          Array.isArray(c.enum) &&
            c.enum.length > 0 &&
            c.enum.length <= 100 &&
            c.enum.every(
              (v) =>
                typeof v === c.type &&
                (c.type !== "number" || Number.isFinite(v)),
            ),
          "CSV_ENUM",
        );
      if ("equals" in c) ensure(typeof c.equals === c.type, "CSV_EQUALS_TYPE");
    }
    ensure(
      Array.isArray(s.uniqueBy) &&
        s.uniqueBy.length <= 10 &&
        s.uniqueBy.every((k) => names.has(k)),
      "CSV_UNIQUE",
    );
    return s;
  }
  if (s.profile === "text-checks/v1") {
    strictKeys(
      s,
      ["schema", "profile", "title", "checks"],
      "SPEC_UNKNOWN_FIELD",
    );
    ensure(
      Array.isArray(s.checks) && s.checks.length > 0 && s.checks.length <= 64,
      "TEXT_CHECKS",
    );
    const ids = new Set();
    for (const c of s.checks) {
      strictKeys(c, ["id", "op", "value", "min", "max"], "TEXT_CHECK_FIELD");
      ensure(
        typeof c.id === "string" &&
          /^[A-Za-z0-9_-]{1,40}$/.test(c.id) &&
          !ids.has(c.id),
        "TEXT_CHECK_ID",
      );
      ids.add(c.id);
      ensure(
        [
          "contains",
          "excludes",
          "startsWith",
          "endsWith",
          "wordCount",
          "lineCount",
        ].includes(c.op),
        "TEXT_CHECK_OP",
      );
      if (["wordCount", "lineCount"].includes(c.op))
        ensure(
          Number.isSafeInteger(c.min) &&
            Number.isSafeInteger(c.max) &&
            c.min >= 0 &&
            c.max >= c.min &&
            c.max <= 100000 &&
            !("value" in c),
          "TEXT_COUNT",
        );
      else
        ensure(
          typeof c.value === "string" &&
            c.value.length > 0 &&
            c.value.length <= 10000 &&
            !("min" in c) &&
            !("max" in c),
          "TEXT_VALUE",
        );
    }
    return s;
  }
  return null;
}
export function parseCSV(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, ""),
    rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false,
    begin = true;
  const field = () => {
    row.push(cell);
    ensure(row.length <= 100, "CSV_COLUMN_LIMIT");
    cell = "";
    closed = false;
    begin = true;
  };
  const record = () => {
    field();
    rows.push(row);
    ensure(rows.length <= 5001, "CSV_ROW_LIMIT");
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += ch;
      continue;
    }
    if (ch === ",") {
      field();
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record();
      continue;
    }
    ensure(!closed, "CSV_AFTER_QUOTE");
    if (ch === '"') {
      ensure(begin, "CSV_QUOTE");
      quoted = true;
      begin = false;
    } else {
      cell += ch;
      begin = false;
    }
  }
  ensure(!quoted, "CSV_UNCLOSED_QUOTE");
  if (cell.length || row.length || closed || !begin) record();
  return rows;
}
export function evaluateExtended(s, bytes, parseJSON) {
  if (s.profile === "json-schema-2020-12/v1") {
    let data;
    try {
      data = parseJSON(bytes);
    } catch {
      return result([{ id: "valid-json", passed: false }]);
    }
    const validate = validators.get(canonical(s.acceptanceSchema));
    const passed = validate(data);
    return result([
      {
        id: "json-schema",
        passed: Boolean(passed),
        ...(passed
          ? {}
          : { detail: String(validate.errors?.[0]?.keyword ?? "schema") }),
      },
    ]);
  }
  if (s.profile === "csv-table/v1") {
    let rows;
    try {
      rows = parseCSV(bytes);
    } catch {
      return result([{ id: "valid-csv", passed: false }]);
    }
    const checks = [
      {
        id: "column-headers",
        passed:
          canonical(rows[0] ?? []) === canonical(s.columns.map((c) => c.name)),
      },
      {
        id: "row-count",
        passed: rows.length - 1 >= s.minRows && rows.length - 1 <= s.maxRows,
      },
    ];
    if (!checks.every((c) => c.passed)) return result(checks);
    const seen = new Set();
    for (const [index, row] of rows.slice(1).entries()) {
      if (row.length !== s.columns.length) {
        checks.push({ id: "row-width", passed: false, row: index + 2 });
        break;
      }
      const values = {};
      for (let n = 0; n < s.columns.length; n++) {
        const c = s.columns[n],
          raw = row[n];
        let value = raw,
          ok = true;
        if (raw === "" && c.required === false) {
          values[c.name] = "";
          continue;
        }
        if (c.type === "number") {
          ok = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw);
          value = Number(raw);
          ok &&=
            Number.isFinite(value) &&
            Math.abs(value) <= Number.MAX_SAFE_INTEGER;
        } else if (c.type === "boolean") {
          ok = ["true", "false"].includes(raw);
          value = raw === "true";
        } else ok = raw !== "" || c.required === false;
        if (ok && "min" in c) {
          const n = c.type === "string" ? [...value].length : value;
          ok = n >= c.min && n <= c.max;
        }
        if (ok && "equals" in c) ok = value === c.equals;
        if (ok && c.enum)
          ok = c.enum.some((x) => canonical(x) === canonical(value));
        values[c.name] = value;
        if (!ok)
          checks.push({
            id: "column-" + c.name,
            passed: false,
            row: index + 2,
          });
        if (checks.length >= 22) break;
      }
      if (s.uniqueBy.length) {
        const key = canonical(s.uniqueBy.map((k) => values[k]));
        if (seen.has(key))
          checks.push({ id: "unique-key", passed: false, row: index + 2 });
        seen.add(key);
      }
      if (checks.length >= 22) break;
    }
    if (checks.length === 2)
      checks.push({ id: "all-cells-and-unique-keys", passed: true });
    return result(checks);
  }
  if (s.profile === "text-checks/v1") {
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return result([{ id: "utf8-text", passed: false }]);
    }
    return result(
      s.checks.map((c) => {
        let passed;
        switch (c.op) {
          case "contains":
            passed = text.includes(c.value);
            break;
          case "excludes":
            passed = !text.includes(c.value);
            break;
          case "startsWith":
            passed = text.startsWith(c.value);
            break;
          case "endsWith":
            passed = text.endsWith(c.value);
            break;
          default: {
            const n =
              c.op === "wordCount"
                ? text.trim()
                  ? text.trim().split(/\s+/u).length
                  : 0
                : text === ""
                  ? 0
                  : text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n")
                      .length;
            passed = n >= c.min && n <= c.max;
          }
        }
        return { id: c.id, passed };
      }),
    );
  }
  return null;
}
const result = (checks) => ({
  decision: checks.every((c) => c.passed) ? "approve" : "reject",
  checks,
});
