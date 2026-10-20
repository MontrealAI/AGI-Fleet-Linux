#!/usr/bin/env python3
"""Decode one public Alpha receipt frame from decoded GitHub job logs.

This utility authenticates no network producer and repeats no Git, wheel or physical
observation. Independent caller expectations must come from the actual GitHub/Git
readback. Transport-only decoding accepts generic JSON for deterministic unit tests.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import datetime
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat

MAX_RECEIPT_BYTES = 4 * 1024 * 1024  # The exact reviewed producer's emit() bound.
MAX_LOG_BYTES = 32 * 1024 * 1024
CHUNK_BYTES = 6000
MAX_CHUNKS = (MAX_RECEIPT_BYTES + CHUNK_BYTES - 1) // CHUNK_BYTES
PREFIX = "ALPHA_PAYLOAD_RECEIPT_"
SCHEMA = "alpha-release-payload-receipt/v1"
FLEET = "MontrealAI/AGI-Fleet-Linux"
ALPHA = "MontrealAI/AGI-Alpha-Agent-v0"
HELPER = "docs/release-evidence/ti-compatible-set-20261019/verify-release-payloads.py"
MODE_EXCEPTIONS = frozenset((
    "alpha_factory_v1/demos/alpha_agi_business_v1/scripts/setup_config.py",
    "alpha_factory_v1/demos/alpha_agi_insight_v0/official_demo.py",
    "alpha_factory_v1/demos/alpha_agi_insight_v1/tools/export_tree.py",
))
STAMP = re.compile(r"(?P<stamp>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z) (?P<body>.*)\Z")
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")


class IngestionError(ValueError):
    """A fixed, public failure code; never contains source log contents."""


def need(value, code):
    if not value:
        raise IngestionError(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                      allow_nan=False).encode("ascii")


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def _reject_constant(_value):
    raise IngestionError("NONFINITE_JSON")


def json_value(raw):
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_pairs,
                          parse_constant=_reject_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as error:
        if isinstance(error, IngestionError):
            raise
        raise IngestionError("INVALID_JSON") from None


def _body(line):
    match = STAMP.fullmatch(line)
    if match and PREFIX in match["body"]:
        try:
            datetime.datetime.fromisoformat(match["stamp"].replace("Z", "+00:00"))
        except ValueError:
            raise IngestionError("INVALID_TIMESTAMP") from None
        return match["body"], "GITHUB_ISO_TIMESTAMP"
    return line, "PLAIN"


def decode_log(text, *, max_log_bytes=MAX_LOG_BYTES):
    """Return (exact canonical bytes, parsed JSON, transport metadata); no auth claim."""
    need(type(text) is str and 0 < max_log_bytes <= MAX_LOG_BYTES, "LOG_INPUT")
    need(len(text) <= max_log_bytes, "LOG_BOUND")
    try:
        log_raw = text.encode("utf-8")
    except UnicodeError:
        raise IngestionError("INVALID_LOG_UTF8") from None
    need(len(log_raw) <= max_log_bytes and "\x00" not in text, "LOG_BOUND")
    state, header, parts, received = "before", None, [], 0
    start_line = end_line = None
    prefix_style = None
    for number, line in enumerate(text.split("\n"), 1):
        if line.endswith("\r"):
            line = line[:-1]
        body, style = _body(line)
        if PREFIX not in body:
            need(state != "parts", "INTERLEAVED_FRAME_LINE")
            continue
        need(body.startswith(PREFIX), "MALFORMED_FRAME_LINE")
        need(len(body) <= 8192, "FRAME_LINE_BOUND")
        if body.startswith(PREFIX + "BEGIN "):
            need(state == "before", "EXTRA_BEGIN")
            header_raw = body.removeprefix(PREFIX + "BEGIN ").encode("utf-8")
            header = json_value(header_raw)
            exact_keys(header, {"schema", "bytes", "sha256", "chunks"}, "FRAME_HEADER")
            need(header["schema"] == SCHEMA, "FRAME_SCHEMA")
            integer(header["bytes"], 1, MAX_RECEIPT_BYTES, "FRAME_BYTES")
            integer(header["chunks"], 1, MAX_CHUNKS, "FRAME_CHUNKS")
            digest(header["sha256"], "FRAME_DIGEST")
            need(header["chunks"] == (header["bytes"] + CHUNK_BYTES - 1) // CHUNK_BYTES,
                 "FRAME_CHUNK_COUNT")
            need(canonical(header) == header_raw, "NONCANONICAL_HEADER")
            state, start_line, prefix_style = "parts", number, style
        elif body.startswith(PREFIX + "PART "):
            need(state == "parts" and style == prefix_style, "UNEXPECTED_PART")
            match = re.fullmatch(r"ALPHA_PAYLOAD_RECEIPT_PART ([1-9][0-9]{0,2})/([1-9][0-9]{0,2}) ([A-Za-z0-9+/]+={0,2})", body)
            need(match is not None, "PART_FORMAT")
            index, count, encoded = int(match[1]), int(match[2]), match[3]
            need(index == len(parts) + 1 and count == header["chunks"]
                 and index <= count and len(encoded) <= 8000, "PART_SEQUENCE")
            try:
                part = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error):
                raise IngestionError("PART_BASE64") from None
            need(base64.b64encode(part).decode("ascii") == encoded, "NONCANONICAL_BASE64")
            expected_size = CHUNK_BYTES if index < count else header["bytes"] - CHUNK_BYTES * (count - 1)
            need(len(part) == expected_size, "PART_BYTES")
            received += len(part)
            need(received <= header["bytes"], "RECEIPT_BOUND")
            parts.append(part)
        elif body.startswith(PREFIX + "END "):
            need(state == "parts" and style == prefix_style and len(parts) == header["chunks"],
                 "UNEXPECTED_END")
            ending = body.removeprefix(PREFIX + "END ")
            need(ending == header["sha256"], "END_DIGEST")
            state, end_line = "after", number
        else:
            raise IngestionError("UNKNOWN_FRAME_MARKER")
    need(state == "after" and header is not None and received == header["bytes"], "INCOMPLETE_FRAME")
    raw = b"".join(parts)
    need(hashlib.sha256(raw).hexdigest() == header["sha256"], "RECEIPT_DIGEST")
    value = json_value(raw)
    try:
        need(canonical(value) == raw, "NONCANONICAL_RECEIPT_JSON")
    except (ValueError, RecursionError, UnicodeError):
        raise IngestionError("NONCANONICAL_RECEIPT_JSON") from None
    transport = {"schema": "alpha-receipt-log-transport/v1", "logBytes": len(log_raw),
        "logSha256": hashlib.sha256(log_raw).hexdigest(), "receiptBytes": len(raw),
        "receiptSha256": header["sha256"], "chunks": len(parts), "beginLine": start_line,
        "endLine": end_line, "prefixStyle": prefix_style,
        "networkOrProducerAuthenticationPerformed": False}
    return raw, value, transport


def exact_keys(value, names, code):
    need(type(value) is dict and set(value) == set(names), code)


def integer(value, minimum, maximum, code):
    need(type(value) is int and minimum <= value <= maximum, code)


def digest(value, code, length=64):
    need(type(value) is str and (HEX64 if length == 64 else HEX40).fullmatch(value), code)


def duration(value, maximum=3600000):
    need(type(value) in (int, float) and math.isfinite(value) and 0 < value < maximum, "DURATION")


def path_name(value):
    need(type(value) is str and value and "\\" not in value
         and not any(ord(c) < 32 or ord(c) == 127 for c in value), "RECEIPT_PATH")
    need(not PurePosixPath(value).is_absolute()
         and all(p not in ("", ".", "..") for p in value.split("/")), "RECEIPT_PATH")


def mode(value):
    need(type(value) is str and re.fullmatch(r"[0-7]{4}", value), "RECEIPT_MODE")


def file_identity(value, *, key="name", extra=()):
    exact_keys(value, {key, "bytes", "sha256", "mode"} | set(extra), "FILE_IDENTITY")
    path_name(value[key])
    integer(value["bytes"], 0, 16 * 1024 * 1024, "FILE_BYTES")
    digest(value["sha256"], "FILE_DIGEST")
    mode(value["mode"])


def _source_identity(value, extra=()):
    exact_keys(value, {"commit", "gitBlob", "sha256", "workflowGitBlob"} | set(extra), "VERIFIER_IDENTITY")
    for field in ("commit", "gitBlob", "workflowGitBlob"):
        digest(value[field], "VERIFIER_DIGEST", 40)
    digest(value["sha256"], "VERIFIER_DIGEST")


def _asset(value):
    exact_keys(value, {"id", "name", "bytes", "sha256"}, "ASSET_IDENTITY")
    integer(value["id"], 1, 2**63 - 1, "ASSET_ID")
    integer(value["bytes"], 1, 64 * 1024 * 1024, "ASSET_BYTES")
    path_name(value["name"])
    need("/" not in value["name"], "ASSET_NAME")
    digest(value["sha256"], "ASSET_DIGEST")


def _contract(value):
    exact_keys(value, {"schema", "repository", "release", "assets", "attestationEvidence", "verifier"}, "CONTRACT_KEYS")
    need(value["schema"] == "alpha-release-payload-input/v1" and value["repository"] == ALPHA, "CONTRACT_SCHEMA")
    release = value["release"]
    exact_keys(release, {"id", "tag", "commit", "tree", "version"}, "RELEASE_KEYS")
    integer(release["id"], 1, 2**63 - 1, "RELEASE_ID")
    digest(release["commit"], "RELEASE_COMMIT", 40)
    digest(release["tree"], "RELEASE_TREE", 40)
    need(type(release["version"]) is str and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", release["version"])
         and release["tag"] == "v" + release["version"], "RELEASE_VERSION")
    exact_keys(value["assets"], {"wheel", "requirements", "checksums"}, "ASSET_ROLES")
    names = {"wheel": "alpha_factory_v1-" + release["version"] + "-py3-none-any.whl",
             "requirements": "requirements-agent.lock", "checksums": "SHA256SUMS"}
    ids = set()
    for role, asset in value["assets"].items():
        _asset(asset)
        need(asset["name"] == names[role] and asset["id"] not in ids, "ASSET_NAME_OR_DUPLICATE")
        ids.add(asset["id"])
    _source_identity(value["verifier"])
    attestation = value["attestationEvidence"]
    exact_keys(attestation, {"classification", "sourceCommit", "wheelSha256", "publicUrl"}, "ATTESTATION_REFERENCE")
    need(attestation["classification"] == "EXTERNAL_PUBLISHER_VERIFICATION_REFERENCE"
         and attestation["sourceCommit"] == release["commit"]
         and attestation["wheelSha256"] == value["assets"]["wheel"]["sha256"]
         and type(attestation["publicUrl"]) is str
         and attestation["publicUrl"].startswith("https://github.com/" + ALPHA + "/"), "ATTESTATION_REFERENCE")


def _producer(value):
    exact_keys(value, {"GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB"}, "PRODUCER_KEYS")
    need(value["GITHUB_REPOSITORY"] == FLEET, "PRODUCER_REPOSITORY")
    digest(value["GITHUB_SHA"], "PRODUCER_COMMIT", 40)
    for field in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
        need(type(value[field]) is str and re.fullmatch(r"[1-9][0-9]*", value[field]), "PRODUCER_RUN")
    need(type(value["GITHUB_JOB"]) is str and re.fullmatch(r"[A-Za-z0-9_-]+", value["GITHUB_JOB"]), "PRODUCER_JOB")


def _raw_identity(value, extra=(), maximum=16 * 1024 * 1024):
    exact_keys(value, {"bytes", "sha256"} | set(extra), "RAW_IDENTITY")
    integer(value["bytes"], 1, maximum, "RAW_BYTES")
    digest(value["sha256"], "RAW_DIGEST")


def inspect_receipt(value, expected=None):
    """Inspect final installed-receipt claims. Matching expectations is not API auth."""
    root_keys = {"schema", "scope", "producer", "verifier", "runtime", "installer", "input",
        "publicApiInputs", "releaseAssets", "attestation", "wheel", "installation",
        "normalInstallerExecutedByThisHelper", "targetPackageImported", "modelOrNativeAcceptance",
        "onChainAction", "wholeReleaseQualification", "elapsedMilliseconds"}
    exact_keys(value, root_keys, "RECEIPT_KEYS")
    need(value["schema"] == SCHEMA and value["scope"] == "ALPHA_FILE_BINDING_ONLY", "RECEIPT_SCHEMA")
    for field in ("normalInstallerExecutedByThisHelper", "targetPackageImported", "modelOrNativeAcceptance",
                  "onChainAction", "wholeReleaseQualification"):
        need(value[field] is False, "RECEIPT_SCOPE")
    duration(value["elapsedMilliseconds"])
    _producer(value["producer"])
    supplied = value["input"]
    exact_keys(supplied, {"bytes", "sha256", "contract"}, "INPUT_IDENTITY")
    integer(supplied["bytes"], 1, 1024 * 1024, "INPUT_BYTES")
    digest(supplied["sha256"], "INPUT_DIGEST")
    _contract(supplied["contract"])
    contract = supplied["contract"]
    verifier = value["verifier"]
    _source_identity(verifier, {"path", "inputCommit", "inputGitBlob"})
    need(verifier["path"] == HELPER and verifier["inputCommit"] == value["producer"]["GITHUB_SHA"]
         and {k: verifier[k] for k in contract["verifier"]} == contract["verifier"], "VERIFIER_BINDING")
    digest(verifier["inputGitBlob"], "INPUT_BLOB", 40)
    runtime = value["runtime"]
    exact_keys(runtime, {"pythonVersion", "platform", "architecture", "executableBytes",
                        "executableSha256", "executableMode", "boundary"}, "RUNTIME_KEYS")
    need(type(runtime["pythonVersion"]) is str and re.fullmatch(r"3\.(11|12|13)\.[0-9]+", runtime["pythonVersion"])
         and runtime["platform"] == "linux" and type(runtime["architecture"]) is str
         and re.fullmatch(r"[A-Za-z0-9_-]+", runtime["architecture"])
         and runtime["boundary"] == "OWNER_TRUSTED_INTERPRETER_STDLIB_TLS_GIT", "RUNTIME_SCOPE")
    integer(runtime["executableBytes"], 1, 128 * 1024 * 1024, "RUNTIME_BYTES")
    digest(runtime["executableSha256"], "RUNTIME_DIGEST")
    mode(runtime["executableMode"])
    installer = value["installer"]
    exact_keys(installer, {"sourceCommit", "gitBlob", "sha256"}, "INSTALLER_KEYS")
    need(installer["sourceCommit"] == contract["release"]["commit"], "INSTALLER_COMMIT")
    digest(installer["gitBlob"], "INSTALLER_BLOB", 40)
    digest(installer["sha256"], "INSTALLER_DIGEST")
    api = value["publicApiInputs"]
    exact_keys(api, {"release", "tagObjects", "commit"}, "API_IDENTITIES")
    _raw_identity(api["release"], {"observedImmutable"}, maximum=8 * 1024 * 1024)
    need(api["release"]["observedImmutable"] is True, "RELEASE_IMMUTABILITY")
    _raw_identity(api["commit"], maximum=8 * 1024 * 1024)
    need(type(api["tagObjects"]) is list and 1 <= len(api["tagObjects"]) <= 9, "TAG_IDENTITIES")
    for tag in api["tagObjects"]:
        _raw_identity(tag, maximum=8 * 1024 * 1024)
    exact_keys(value["releaseAssets"], {"wheel", "requirements", "checksums"}, "DOWNLOADED_ASSETS")
    for role, actual in value["releaseAssets"].items():
        exact_keys(actual, {"id", "name", "bytes", "sha256", "physicalDownloadMode",
                            "serverDigest", "actualBytesVerified"}, "DOWNLOADED_ASSET")
        need({k: actual[k] for k in contract["assets"][role]} == contract["assets"][role]
             and actual["serverDigest"] == "sha256:" + actual["sha256"]
             and actual["actualBytesVerified"] is True, "DOWNLOADED_ASSET_BINDING")
        mode(actual["physicalDownloadMode"])
    exact_keys(value["attestation"], {"classification", "reference"}, "ATTESTATION_KEYS")
    need(value["attestation"]["classification"] == "EXTERNAL_REFERENCE_NOT_CRYPTOGRAPHICALLY_REVERIFIED"
         and value["attestation"]["reference"] == contract["attestationEvidence"], "ATTESTATION_SCOPE")
    payload_names, metadata_names = _wheel_claims(value["wheel"], contract["release"]["version"])
    _installation_claims(value, payload_names, metadata_names)
    matched, job_id = False, None
    if expected is not None:
        exact_keys(expected, {"producer", "jobId", "input", "contract", "installer"}, "EXPECTED_KEYS")
        _producer(expected["producer"])
        integer(expected["jobId"], 1, 2**63 - 1, "EXTERNAL_JOB_ID")
        _raw_identity(expected["input"], {"commit", "gitBlob"}, maximum=1024 * 1024)
        digest(expected["input"]["commit"], "EXPECTED_INPUT_COMMIT", 40)
        digest(expected["input"]["gitBlob"], "EXPECTED_INPUT_BLOB", 40)
        _contract(expected["contract"])
        need(expected["producer"] == value["producer"] and expected["contract"] == contract
             and expected["installer"] == installer
             and expected["input"] == {"commit": verifier["inputCommit"], "gitBlob": verifier["inputGitBlob"],
                                      "bytes": supplied["bytes"], "sha256": supplied["sha256"]},
             "CALLER_BINDING_MISMATCH")
        matched, job_id = True, expected["jobId"]
    return {"schema": "alpha-receipt-claim-inspection/v1", "finalInstalledReceiptShapeChecked": True,
        "callerBindingsMatched": matched, "externalNumericJobId": job_id,
        "networkOrProducerAuthenticationPerformed": False, "sourceAndPhysicalObservationsRepeated": False,
        "actualExecutionIndependentlyProved": False, "attestationCryptographicallyReverified": False}


def _wheel_claims(wheel, version):
    exact_keys(wheel, {"members", "record", "payloadCount", "pythonPayloadCount", "payloads",
                      "generatedMetadata", "allActualPayloadsGitCompared", "allTrackedSourceRequiredInWheel"}, "WHEEL_KEYS")
    need(wheel["allActualPayloadsGitCompared"] is True and wheel["allTrackedSourceRequiredInWheel"] is False, "WHEEL_SCOPE")
    need(type(wheel["payloads"]) is list and type(wheel["generatedMetadata"]) is list, "WHEEL_ARRAYS")
    need(all(type(item) is dict and type(item.get("name")) is str for item in wheel["payloads"]), "PAYLOAD_ITEM_TYPE")
    integer(wheel["members"], 1, 4096, "WHEEL_MEMBER_COUNT")
    integer(wheel["payloadCount"], 1, 4096, "WHEEL_PAYLOAD_COUNT")
    integer(wheel["pythonPayloadCount"], 0, 4096, "WHEEL_PYTHON_COUNT")
    need(wheel["members"] == len(wheel["payloads"]) + len(wheel["generatedMetadata"])
         and wheel["payloadCount"] == len(wheel["payloads"]) and wheel["payloadCount"] > 0
         and wheel["pythonPayloadCount"] == sum(x.get("name", "").endswith(".py") for x in wheel["payloads"]), "WHEEL_COUNTS")
    record = wheel["record"]
    _raw_identity(record, {"rows", "selfRowEmpty", "rawPreservedAs"})
    integer(record["rows"], 1, 4096, "WHEEL_RECORD_ROWS")
    need(record["rows"] == wheel["members"] and record["selfRowEmpty"] is True
         and record["rawPreservedAs"] == "wheel-RECORD.csv", "WHEEL_RECORD")
    names = set()
    for item in wheel["payloads"]:
        exact_keys(item, {"name", "bytes", "sha256", "gitBlob", "gitMode", "wheelMode",
                         "legacyModeException", "physicalMode", "installedRecordHashPresent"}, "PAYLOAD_KEYS")
        path_name(item["name"])
        need(item["name"].split("/", 1)[0] in {"alpha_factory_v1", "af_requests", "openai_agents"}
             and item["name"] not in names, "PAYLOAD_NAME")
        names.add(item["name"])
        integer(item["bytes"], 0, 16 * 1024 * 1024, "PAYLOAD_BYTES")
        digest(item["sha256"], "PAYLOAD_DIGEST")
        digest(item["gitBlob"], "PAYLOAD_BLOB", 40)
        need(item["gitMode"] in ("100644", "100755") and item["wheelMode"] in ("0644", "0755")
             and item["physicalMode"] == item["wheelMode"] and type(item["installedRecordHashPresent"]) is bool,
             "PAYLOAD_MODES")
        exception = item["name"] in MODE_EXCEPTIONS and item["gitMode"] == "100755" and item["wheelMode"] == "0644"
        need(item["legacyModeException"] is exception
             and (item["gitMode"][-3:] == item["wheelMode"][-3:] or exception), "PAYLOAD_MODE_EXCEPTION")
    metadata_names = set()
    dist = "alpha_factory_v1-" + version + ".dist-info/"
    for item in wheel["generatedMetadata"]:
        file_identity(item)
        need(item["name"].startswith(dist) and item["name"] not in metadata_names
             and item["name"] not in names, "WHEEL_METADATA_NAME")
        metadata_names.add(item["name"])
    need({dist + x for x in ("RECORD", "METADATA", "WHEEL")}.issubset(metadata_names), "WHEEL_METADATA_REQUIRED")
    self_record = next(x for x in wheel["generatedMetadata"] if x["name"] == dist + "RECORD")
    need(self_record["sha256"] == record["sha256"] and self_record["bytes"] == record["bytes"], "WHEEL_RECORD_IDENTITY")
    need(sum(x["bytes"] for x in wheel["payloads"] + wheel["generatedMetadata"]) <= 128 * 1024 * 1024, "WHEEL_TOTAL_BOUND")
    return names, metadata_names


def _installation_claims(value, payload_names, metadata_names):
    installed = value["installation"]
    exact_keys(installed, {"classification", "normalInstallObservation", "venvConfigSha256",
        "pythonExecutable", "payloadCount", "record", "generatedAndMetadata", "optionalUnrecordedBytecode"}, "INSTALLATION_KEYS")
    need(installed["classification"] == "OBSERVED_EXISTING_NORMAL_INSTALL_FILES_NOT_TARGET_CODE_EXECUTION"
         and installed["payloadCount"] == len(payload_names), "INSTALLATION_SCOPE")
    digest(installed["venvConfigSha256"], "VENV_CONFIG_DIGEST")
    integer(installed["payloadCount"], 1, 4096, "INSTALLED_PAYLOAD_COUNT")
    executable = installed["pythonExecutable"]
    exact_keys(executable, {"sha256", "bytes", "mode"}, "VENV_PYTHON_KEYS")
    need(executable["sha256"] == value["runtime"]["executableSha256"]
         and executable["bytes"] == value["runtime"]["executableBytes"], "VENV_PYTHON_BINDING")
    mode(executable["mode"])
    observed = installed["normalInstallObservation"]
    exact_keys(observed, {"schema", "producer", "installer", "wheelSha256", "requirementsSha256",
                         "profile", "exitCode", "elapsedMilliseconds"}, "NORMAL_INSTALL_KEYS")
    need(observed["schema"] == "alpha-normal-install-observation/v1"
         and observed["producer"] == value["producer"] and observed["installer"] == value["installer"]
         and observed["wheelSha256"] == value["releaseAssets"]["wheel"]["sha256"]
         and observed["requirementsSha256"] == value["releaseAssets"]["requirements"]["sha256"]
         and observed["profile"] == "UNCHANGED_INSTALL_AGENT_HASH_LOCKED_DEPS_WHEEL_PIPCHECK_CLI"
         and type(observed["exitCode"]) is int and observed["exitCode"] == 0, "NORMAL_INSTALL_BINDING")
    duration(observed["elapsedMilliseconds"])
    record = installed["record"]
    _raw_identity(record, {"rows", "rawPreservedAs", "payloadRowsCompared"})
    integer(record["rows"], 1, 8192, "INSTALLED_RECORD_COUNT")
    integer(record["payloadRowsCompared"], 1, 4096, "INSTALLED_RECORD_PAYLOAD_COUNT")
    need(record["rawPreservedAs"] == "installed-RECORD.csv" and record["payloadRowsCompared"] == len(payload_names), "INSTALLED_RECORD")
    need(type(installed["generatedAndMetadata"]) is list and type(installed["optionalUnrecordedBytecode"]) is list, "INSTALL_ARRAYS")
    names, immutable = set(), {}
    for item in installed["generatedAndMetadata"]:
        exact_keys(item, {"name", "kind", "bytes", "sha256", "mode", "recordHashPresent"}, "INSTALL_FILE_KEYS")
        # Entry-point RECORD paths may traverse only to a venv bin destination; the producer
        # validated that physical destination. Here retain the exact relative spelling.
        need(type(item["name"]) is str and item["name"] and not item["name"].startswith("/")
             and "\\" not in item["name"] and not any(ord(c) < 32 for c in item["name"]), "INSTALL_FILE_NAME")
        need(item["name"] not in names and item["name"] not in payload_names, "DUPLICATE_INSTALL_FILE")
        names.add(item["name"])
        integer(item["bytes"], 0, 16 * 1024 * 1024, "INSTALL_FILE_BYTES")
        digest(item["sha256"], "INSTALL_FILE_DIGEST")
        mode(item["mode"])
        need(type(item["recordHashPresent"]) is bool and item["kind"] in {
            "WHEEL_METADATA", "PIP_METADATA", "OBSERVED_UNVERIFIED_RECORDED_BYTECODE", "GENERATED_ENTRYPOINT"}, "INSTALL_FILE_CLASS")
        if item["kind"] == "WHEEL_METADATA":
            immutable[item["name"]] = item
        elif item["kind"] == "PIP_METADATA":
            dist_prefix = "alpha_factory_v1-" + value["input"]["contract"]["release"]["version"] + ".dist-info/"
            need(item["name"] in {dist_prefix + x for x in ("INSTALLER", "REQUESTED", "direct_url.json")}, "PIP_METADATA_NAME")
        elif item["kind"] == "OBSERVED_UNVERIFIED_RECORDED_BYTECODE":
            path_name(item["name"])
            need(item["name"].split("/", 1)[0] in {"alpha_factory_v1", "af_requests", "openai_agents"}
                 and "/__pycache__/" in item["name"] and item["name"].endswith(".pyc"), "RECORDED_BYTECODE_NAME")
        else:
            parts = item["name"].split("/")
            need(len(parts) == 5 and parts[:4] == ["..", "..", "..", "bin"]
                 and parts[4] not in ("", ".", ".."), "ENTRYPOINT_RECORD_PATH")
    dist = "alpha_factory_v1-" + value["input"]["contract"]["release"]["version"] + ".dist-info/"
    need(record["rows"] == len(payload_names) + len(names) + 1, "INSTALLED_RECORD_COVERAGE_COUNT")
    need(set(immutable) == metadata_names - {dist + "RECORD"}, "INSTALLED_METADATA_COVERAGE")
    wheel_metadata = {x["name"]: x for x in value["wheel"]["generatedMetadata"]}
    for name, item in immutable.items():
        need(all(item[k] == wheel_metadata[name][k] for k in ("bytes", "sha256", "mode")), "INSTALLED_METADATA_BINDING")
    optional_names = set()
    for item in installed["optionalUnrecordedBytecode"]:
        file_identity(item, extra={"kind"})
        need(item["kind"] == "OBSERVED_UNVERIFIED_UNRECORDED_BYTECODE"
             and item["name"].split("/", 1)[0] in {"alpha_factory_v1", "af_requests", "openai_agents"}
             and "/__pycache__/" in item["name"] and item["name"].endswith(".pyc")
             and item["name"] not in optional_names and item["name"] not in names
             and item["name"] not in payload_names, "OPTIONAL_BYTECODE_CLASS")
        optional_names.add(item["name"])
    need(len(optional_names) <= 8192
         and len(payload_names) + len(optional_names) + sum(x["kind"] == "OBSERVED_UNVERIFIED_RECORDED_BYTECODE"
             for x in installed["generatedAndMetadata"]) <= 8192
         and sum(x["bytes"] for x in installed["generatedAndMetadata"]) <= 128 * 1024 * 1024
         and sum(x["bytes"] for x in installed["optionalUnrecordedBytecode"]) <= 128 * 1024 * 1024, "INSTALL_FILE_BOUNDS")


def ingest_log(text, expected):
    """Decode and inspect using independent caller bindings; do not infer API auth."""
    need(expected is not None, "CALLER_EXPECTATIONS_REQUIRED")
    raw, receipt, transport = decode_log(text)
    inspection = inspect_receipt(receipt, expected)
    return raw, {"transport": transport, "inspection": inspection}


def _read(path, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and 0 <= before.st_size <= maximum, "INPUT_FILE_BOUND")
        chunks, remaining = [], before.st_size + 1
        while remaining:
            part = os.read(fd, min(65536, remaining))
            if not part:
                break
            chunks.append(part)
            remaining -= len(part)
        raw = b"".join(chunks)
        after = os.fstat(fd)
        need(len(raw) == before.st_size and all(getattr(before, x) == getattr(after, x)
             for x in ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns")), "INPUT_FILE_CHANGED")
        return raw
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", required=True)
    parser.add_argument("--expected", required=True, help="Independent actual API/Git bindings; never copy from receipt")
    parser.add_argument("--output", required=True, help="Absent local output directory")
    args = parser.parse_args()
    log = _read(args.log, MAX_LOG_BYTES).decode("utf-8")
    expected = json_value(_read(args.expected, 1024 * 1024))
    raw, report = ingest_log(log, expected)
    output = Path(args.output)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    for name, data in (("receipt.json", raw), ("ingestion.json", canonical(report))):
        fd = os.open(output / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
    print("ALPHA_RECEIPT_INGESTED " + hashlib.sha256(raw).hexdigest())


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("ALPHA_RECEIPT_INGESTION_FAILED", file=__import__("sys").stderr)
        raise SystemExit(1)
