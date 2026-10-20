#!/usr/bin/env python3
"""Local, opt-in HTTP readback; no browser, release API or execution attestation.

CLI requires --read-live, --expected PATH and a new --output PATH. Expected is
an independently authenticated JSON object with exactly alpha/jobs/manager/fleet.
alpha/jobs/manager require commit (full SHA) and version. Fleet requires
websiteCommit T, releaseCommit S, version, releaseTag, releaseWorkflowRun and
releaseArchive {name,bytes,sha256}. Each site may additionally supply
metadataSha256 from its authenticated Pages artifact. Alpha may additionally
supply paperSha256 {fixed public paper path: SHA256} and paperGitBlobs
{fixed public paper path: independently authenticated Git blob ID}. No URLs are accepted.

No release identities are discovered or defaulted. Jobs catalog has no version;
its caller-supplied version is retained as unverified release context only.
HTTP success and served self-declared inventories do not authenticate a producer,
release, rendered UI, native/model execution, installation or on-chain state.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import http.client
import json
import math
import re
import signal
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, urlencode, urlsplit

HOST = "montrealai.github.io"
ROOTS = {"alpha": "/AGI-Alpha-Agent-v0/", "jobs": "/AGIJobsv0/",
         "manager": "/AGIJobManager/", "fleet": "/AGI-Fleet-Linux/"}
METADATA = {"alpha": "release.json", "jobs": "catalog.json",
            "manager": "build-info.json", "fleet": "build-info.json"}
SHA = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?\Z")
JSON_LIMIT = 4 * 1024 * 1024
FILE_LIMIT = 64 * 1024 * 1024
TOTAL_LIMIT = 256 * 1024 * 1024
FILE_COUNT_LIMIT = 1024
OVERALL_SECONDS = 600
REQUEST_SECONDS = 20
PAPERS = tuple(f"{name}.{suffix}" for name in
               ("Transformational_Intelligence", "Beyond_the_Original_Problem",
                "Beyond_the_Production_Frontier") for suffix in ("pdf", "tex")) + tuple(
    f"{name}_LaTeX.zip" for name in ("Transformational_Intelligence",
    "Beyond_the_Original_Problem", "Beyond_the_Production_Frontier")) + (
    "assets/whitepaper_v0.1.0-alphav15.pdf",
    "manuscript/AGI_ALPHA_Unified_Publication_Final.pdf",
    "Earn_the_Next_Experiment.pdf",
    "Earn_the_Next_Experiment.tex",
    "Earn_the_Next_Experiment_LaTeX.zip",
    "Invent_the_Economy.pdf",
    "Invent_the_Economy.tex",
    "Invent_the_Economy_LaTeX.zip",
    "SUCCESSOR_Omega_Invent_the_Economy_Business_Brief.pdf",
    "Out_Evolve.pdf", "Out_Evolve.tex",
    "The_World_as_an_Output.pdf", "The_World_as_an_Output.tex")
ROUTES = {
    "alpha": (("", "en", None), ("successor/alpha/", "en", None),
              ("successor/alpha/", None, "fr"),
              ("transformational-intelligence/", None, None),
              ("agent/SUCCESSOR_COMPUTER_USE/", None, None),
              ("manuscript/", None, None),
              ("PILOT_PLAYBOOK/", None, None)),
    "jobs": (("", None, None), ("start/", "en", None),
             ("start/fr/", "fr", None), ("successor/computer/", "en", None),
             ("successor/computer/fr/", "fr", None),
             ("successor/computer/desk/", "en", None),
             ("successor/computer/desk/fr/", "fr", None)),
    "manager": (("", "en", None), ("fr/", "fr", None),
                ("computer-receipt/", "en", None),
                ("fr/computer-receipt/", "fr", None),
                ("successor/", "en", None), ("fr/successor/", "fr", None)),
    "fleet": (("index.html", "en", None), ("fr.html", "fr", None),
              ("start.html", "en", None), ("start-fr.html", "fr", None),
              ("successor.html", "en", None), ("successor-fr.html", "fr", None)),
}


def need(value, message):
    if not value:
        raise ValueError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def integer(value, minimum=0, maximum=FILE_LIMIT):
    return type(value) is int and minimum <= value <= maximum


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "duplicate JSON property")
        result[key] = value
    return result


def json_object(raw):
    need(len(raw) <= JSON_LIMIT, "JSON exceeds limit")
    value = json.loads(raw.decode("utf-8", errors="strict"),
                       object_pairs_hook=object_pairs,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite JSON")),
                       parse_float=finite_float)
    need(isinstance(value, dict), "JSON object required")
    return value


def finite_float(token):
    value = float(token)
    need(math.isfinite(value), "nonfinite JSON number")
    return value


def safe_path(value, *, empty=False, flat=False):
    need(isinstance(value, str) and (value or empty) and len(value) <= 512,
         "invalid public relative path")
    need(not value.startswith("/") and not any(ord(c) < 32 or ord(c) == 127 for c in value)
         and not any(c in value for c in "\\%?#:") and "//" not in value,
         "unsafe public relative path")
    parts = value.rstrip("/").split("/") if value else []
    need(all(part not in ("", ".", "..") and not part.startswith(".") for part in parts),
         "unsafe path segment")
    need(not flat or len(parts) == 1, "flat public file required")
    return value


def validate_expected(value):
    need(set(value) == set(ROOTS), "all four independently supplied site expectations required")
    for name in ROOTS:
        row = value[name]
        need(isinstance(row, dict), "site expectation object required")
        base = {"commit", "version"} if name != "fleet" else {
            "websiteCommit", "releaseCommit", "version", "releaseTag",
            "releaseWorkflowRun", "releaseArchive"}
        allowed = base | {"metadataSha256"} | ({"paperSha256", "paperGitBlobs"} if name == "alpha" else set())
        need(base <= set(row) <= allowed, "missing or unknown expectation fields: " + name)
        for key in ("commit",) if name != "fleet" else ("websiteCommit", "releaseCommit"):
            need(isinstance(row[key], str) and SHA.fullmatch(row[key]) and row[key] != "0" * 40,
                 "actual full source commit required: " + name)
        need(isinstance(row["version"], str) and VERSION.fullmatch(row["version"]),
             "actual version required: " + name)
        if "metadataSha256" in row:
            need(isinstance(row["metadataSha256"], str) and DIGEST.fullmatch(row["metadataSha256"]),
                 "invalid independently supplied metadata hash")
        if name == "alpha" and "paperSha256" in row:
            papers = row["paperSha256"]
            need(isinstance(papers, dict) and set(papers) <= set(PAPERS), "unknown paper hash path")
            need(all(isinstance(h, str) and DIGEST.fullmatch(h) for h in papers.values()), "invalid paper hash")
        if name == "alpha" and "paperGitBlobs" in row:
            blobs = row["paperGitBlobs"]
            need(isinstance(blobs, dict) and set(blobs) <= set(PAPERS), "unknown paper source-blob path")
            need(all(isinstance(h, str) and SHA.fullmatch(h) and h != "0" * 40
                     for h in blobs.values()), "invalid paper source blob")
        if name == "fleet":
            need(isinstance(row["releaseTag"], str) and re.fullmatch(r"v[0-9A-Za-z.+-]{1,80}", row["releaseTag"]), "release tag required")
            need(isinstance(row["releaseWorkflowRun"], str) and re.fullmatch(r"[1-9][0-9]*", row["releaseWorkflowRun"]), "actual release run required")
            archive = row["releaseArchive"]
            need(isinstance(archive, dict) and set(archive) == {"name", "bytes", "sha256"}, "release archive identity required")
            safe_path(archive["name"], flat=True)
            need(integer(archive["bytes"], 1, 2_000_000_000) and isinstance(archive["sha256"], str)
                 and DIGEST.fullmatch(archive["sha256"]), "invalid release archive identity")
    return value


def request_target(name, relative, commit, language=None):
    need(name in ROOTS and isinstance(commit, str) and SHA.fullmatch(commit), "invalid request identity")
    safe_path(relative, empty=True)
    need(language in (None, "fr"), "only source-declared public language query is allowed")
    query = {"readback": commit}
    if language is not None:
        query["lang"] = language
    return ROOTS[name] + quote(relative, safe="/") + "?" + urlencode(query)


@contextlib.contextmanager
def wall_deadline(seconds):
    need(hasattr(signal, "setitimer"), "bounded Unix local verifier required")
    def expired(_signum, _frame):
        raise TimeoutError("public HTTP readback deadline exceeded")
    old_handler = signal.signal(signal.SIGALRM, expired)
    previous = signal.setitimer(signal.ITIMER_REAL, seconds)
    started = time.monotonic()
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, old_handler)
        if previous[0]:
            signal.setitimer(signal.ITIMER_REAL, max(0.000001, previous[0] - (time.monotonic() - started)), previous[1])


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


class PublicHTTP:
    """Fixed TLS origin; ordinary managed proxy transport, no origin credentials."""
    def __init__(self):
        self.total = 0
        self.count = 0
        self.deadline = time.monotonic() + OVERALL_SECONDS
        # Preserve urllib's normal platform transport. Do not inspect, override or
        # log proxy configuration. No cookie jar/origin-auth handler is installed.
        self.opener = urllib.request.build_opener(NoRedirect())

    def get(self, target, limit):
        need(target.startswith(tuple(ROOTS.values())) and not target.startswith("//"), "unexpected HTTP target")
        parsed = urlsplit(target)
        need(not parsed.scheme and not parsed.netloc and not parsed.fragment, "relative fixed-host target required")
        need(self.count < FILE_COUNT_LIMIT and self.total < TOTAL_LIMIT, "public download budget exceeded")
        remaining = self.deadline - time.monotonic()
        need(remaining > 0 and integer(limit, 1, FILE_LIMIT), "public deadline or read limit exceeded")
        self.count += 1
        request = urllib.request.Request("https://" + HOST + target, method="GET", headers={
            "Cache-Control": "no-cache", "Pragma": "no-cache", "Accept-Encoding": "identity",
            "User-Agent": "Four-Pages-Public-Readback/1"})
        response = None
        try:
            with wall_deadline(min(REQUEST_SECONDS, remaining)):
                response = self.opener.open(request, timeout=min(REQUEST_SECONDS, remaining))
                need(response.status == 200, "public response must be HTTP 200 (redirects refused)")
                need(response.getheader("Content-Encoding", "identity").lower() in ("", "identity"), "encoded response refused")
                declared = response.getheader("Content-Length")
                if declared is not None:
                    need(re.fullmatch(r"[0-9]+", declared) is not None and int(declared) <= limit, "declared response exceeds bound")
                content = bytearray()
                while True:
                    need(self.deadline > time.monotonic(), "public deadline exceeded")
                    chunk = response.read(min(64 * 1024, limit + 1 - len(content)))
                    if not chunk:
                        break
                    content.extend(chunk)
                    self.total += len(chunk)
                    need(len(content) <= limit and self.total <= TOTAL_LIMIT, "actual response exceeds budget")
                if declared is not None:
                    need(len(content) == int(declared), "truncated response")
                return bytes(content), response.getheader("Content-Type", "")
        except (OSError, http.client.HTTPException, urllib.error.URLError) as error:
            if isinstance(error, urllib.error.HTTPError):
                error.close()
            raise ValueError("public HTTP transport failed; platform transport details omitted") from None
        finally:
            if response is not None:
                response.close()


class HTMLSummary(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.language = None
        self.title_parts = []
        self.in_title = False
        self.links = set()
        self.html = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "html":
            self.html = True
            self.language = attrs.get("lang")
        self.in_title = self.in_title or tag == "title"
        if tag == "a" and isinstance(attrs.get("href"), str):
            link = urlsplit(attrs["href"])
            if link.scheme == "https" and link.netloc == HOST and not link.query:
                self.links.add("https://" + HOST + link.path + ("#" + link.fragment if link.fragment else ""))

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title_parts.append(data)


def inventory(metadata, name):
    files = metadata.get("files")
    need(isinstance(files, dict) and 1 <= len(files) <= FILE_COUNT_LIMIT, "finite served inventory required")
    result = {}
    for file, row in files.items():
        safe_path(file, flat=name == "fleet")
        need(file not in ("build-info.json", ".nojekyll"), "self/build-only file must not be promised served")
        if name == "manager":
            need(isinstance(row, dict) and set(row) == {"bytes", "sha256"}
                 and integer(row["bytes"]) and isinstance(row["sha256"], str) and DIGEST.fullmatch(row["sha256"]), "invalid Manager inventory row")
            result[file] = row
        else:
            need(isinstance(row, str) and DIGEST.fullmatch(row), "invalid Fleet inventory row")
            result[file] = {"sha256": row}
    if name == "manager":
        excluded = metadata.get("buildOnlyFiles")
        need(isinstance(excluded, dict) and set(excluded) == {".nojekyll"}, "unexpected Manager build-only exclusions")
    return result


def metadata_identity(name, value, expected):
    if name == "alpha":
        need(value.get("schema") == 1 and value.get("commit") == expected["commit"]
             and value.get("version") == expected["version"]
             and value.get("url") == "https://" + HOST + ROOTS[name], "Alpha served release identity differs")
    elif name == "jobs":
        need(value.get("schemaVersion") == 2 and value.get("revision") == expected["commit"]
             and value.get("basePath") == ROOTS[name], "Jobs served catalog identity differs")
        need(integer(value.get("directories"), 1, 1_000_000) and integer(value.get("guides"), 1, 1_000_000), "empty Jobs catalog")
        need(isinstance(value.get("successorRoutes"), list) and {"successor/computer/", "successor/computer/fr/"} <= set(value["successorRoutes"]), "Jobs native routes absent")
    elif name == "manager":
        need(value.get("sourceCommit") == expected["commit"] and value.get("sourceVersion") == expected["version"], "Manager served build identity differs")
        inventory(value, name)
    else:
        need(value.get("schema") == "agi-fleet-pages-build/v1" and value.get("commit") == expected["websiteCommit"]
             and value.get("productionQualified") is False, "Fleet served website identity differs")
        inventory(value, name)


def fleet_release_identity(value, expected):
    archive = expected["releaseArchive"]
    need(value.get("schema") == "agi-linux-published-release/v1"
         and value.get("workflowCommit") == expected["releaseCommit"]
         and value.get("version") == expected["version"] and value.get("tag") == expected["releaseTag"]
         and str(value.get("workflowRun")) == expected["releaseWorkflowRun"]
         and all(value.get(k) == archive[k] for k in ("name", "bytes", "sha256"))
         and value.get("productionQualified") is False, "Fleet served selected release differs from actual S")


def readback(expected, transport):
    validate_expected(expected)
    cache, records, metadata = {}, [], {}
    def get(name, relative, *, limit=FILE_LIMIT, language=None):
        commit = expected[name].get("commit", expected[name].get("websiteCommit"))
        target = request_target(name, relative, commit, language)
        if target not in cache:
            raw, media = transport.get(target, limit)
            need(len(raw) <= limit, "transport response exceeds bound")
            cache[target] = (raw, media)
            records.append({"site": name, "path": relative, "languageQuery": language,
                            "url": "https://" + HOST + target, "bytes": len(raw), "sha256": digest(raw)})
        return cache[target]
    # All four machine identities and selected Fleet S must pass before payload reads.
    for name in ROOTS:
        raw, _ = get(name, METADATA[name], limit=JSON_LIMIT)
        if "metadataSha256" in expected[name]:
            need(digest(raw) == expected[name]["metadataSha256"], "independent metadata hash differs")
        metadata[name] = json_object(raw)
        metadata_identity(name, metadata[name], expected[name])
    raw, _ = get("fleet", "release.json", limit=JSON_LIMIT)
    fleet_release_identity(json_object(raw), expected["fleet"])
    hashed = {}
    for name in ("manager", "fleet"):
        rows = inventory(metadata[name], name)
        for file, row in sorted(rows.items()):
            raw, _ = get(name, file, limit=max(row.get("bytes", 0), 1) if "bytes" in row else FILE_LIMIT)
            need(digest(raw) == row["sha256"] and ("bytes" not in row or len(raw) == row["bytes"]), "served inventory bytes/hash differ: " + name + "/" + file)
        hashed[name] = len(rows)
    html = []
    for name, routes in ROUTES.items():
        for relative, language, query in routes:
            raw, media = get(name, relative, language=query)
            if name in ("manager", "fleet"):
                member = relative + "index.html" if not relative or relative.endswith("/") else relative
                row = inventory(metadata[name], name).get(member)
                need(row is not None and digest(raw) == row["sha256"]
                     and ("bytes" not in row or len(raw) == row["bytes"]),
                     "journey alias differs from inventoried HTML: " + name + "/" + relative)
            need("text/html" in media.lower(), "journey route is not HTML")
            summary = HTMLSummary()
            summary.feed(raw.decode("utf-8", errors="strict"))
            title = "".join(summary.title_parts).strip()
            need(summary.html and title, "HTML route has no document/title")
            if language is not None:
                need(summary.language == language, "static HTML language differs")
            html.append({"site": name, "path": relative, "languageQuery": query,
                         "staticHtmlLanguage": summary.language, "title": title,
                         "canonicalHostLinks": sorted(summary.links)})
    papers = []
    for relative in PAPERS:
        raw, _ = get("alpha", relative)
        if relative.endswith(".pdf"):
            need(raw.startswith(b"%PDF-"), "paper is not a PDF")
        elif relative.endswith(".zip"):
            need(raw.startswith(b"PK\x03\x04"), "paper source is not a ZIP")
        else:
            need(bool(raw.decode("utf-8", errors="strict").strip()), "empty TeX source")
        wanted = expected["alpha"].get("paperSha256", {}).get(relative)
        if wanted is not None:
            need(digest(raw) == wanted, "independent paper hash differs")
        blob_digest = hashlib.sha1()
        blob_digest.update(f"blob {len(raw)}\0".encode("ascii"))
        blob_digest.update(raw)
        source_blob = blob_digest.hexdigest()
        wanted_blob = expected["alpha"].get("paperGitBlobs", {}).get(relative)
        if wanted_blob is not None:
            need(source_blob == wanted_blob, "independent paper source blob differs")
        papers.append({"path": relative, "sha256": digest(raw), "independentExpectedHashCompared": wanted is not None,
                       "gitBlob": source_blob, "independentExpectedGitBlobCompared": wanted_blob is not None})
    return {"schema": "local/four-pages-public-http-readback/v1", "scope": "BOUNDED_PUBLIC_HTTP_BYTES_ONLY",
            "expected": expected, "metadataIdentityMatched": True, "inventoryFilesCompared": hashed,
            "metadataExpectedHashCompared": {name: "metadataSha256" in expected[name] for name in ROOTS},
            "jobsVersionNotServedByCatalog": expected["jobs"]["version"], "routes": html, "papers": papers,
            "observations": records, "totalDownloadedBytes": sum(row["bytes"] for row in records),
            "producerAuthenticatedByThisHelper": False, "releaseAuthenticatedByThisHelper": False,
            "servedInventoryIndependentlyAuthenticatedByThisHelper": False,
            "renderedUiTested": False, "browserUsed": False, "nativeOrModelAcceptance": False,
            "installationChecked": False, "walletOrOnChainAction": False,
            "limitations": ["Caller must authenticate final source/release/deployment context independently.",
                "Served inventories are self-declared unless caller binds their metadata hash to the tested artifact.",
                "Static HTTP cannot exercise language toggles, controls, downloads or archive restore.",
                "Paper source/content binding requires independently supplied hashes; HTTP/type checks alone are insufficient.",
                "Historical Builder/deployment/Mac pins are retained and are not equated to website commits."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--read-live", action="store_true", help="explicitly allow public HTTPS reads after final inputs are supplied")
    args = parser.parse_args()
    need(args.read_live, "no network without explicit --read-live and actual final expectations")
    need(not args.output.exists(), "output must not exist")
    with args.expected.open("rb") as source:
        raw = source.read(JSON_LIMIT + 1)
    expected = validate_expected(json_object(raw))
    started = time.monotonic()
    with wall_deadline(OVERALL_SECONDS):
        result = readback(expected, PublicHTTP())
    result["elapsedSeconds"] = round(time.monotonic() - started, 6)
    result["expectedInputSha256"] = digest(raw)
    with args.output.open("x", encoding="utf-8") as output:
        output.write(json.dumps(result, ensure_ascii=True, allow_nan=False, sort_keys=True, indent=2) + "\n")
    print(json.dumps({"schema": result["schema"], "httpBytesObserved": True,
                      "files": len(result["observations"]), "producerAuthenticatedByThisHelper": False}))


if __name__ == "__main__":
    main()
