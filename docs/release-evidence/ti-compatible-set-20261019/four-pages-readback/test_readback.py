"""Offline generic transport/shape units; no HTTP, website or release evidence."""
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote, urlsplit

spec = importlib.util.spec_from_file_location("pages_readback", Path(__file__).with_name("readback.py"))
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)


def encoded(value):
    return json.dumps(value, separators=(",", ":")).encode()


def expectations():
    # Unit tokens only, never inputs to the live CLI or a retained observation.
    return {**{name: {"commit": str(index) * 40, "version": "1.2.3"}
               for index, name in enumerate(("alpha", "jobs", "manager"), 1)},
            "fleet": {"websiteCommit": "4" * 40, "releaseCommit": "5" * 40,
                      "version": "1.2.3", "releaseTag": "v1.2.3-test", "releaseWorkflowRun": "123",
                      "releaseArchive": {"name": "unit.zip", "bytes": 9, "sha256": "a" * 64}}}


def unit_transport(expected):
    files = {}
    for name, routes in R.ROUTES.items():
        for relative, language, query in routes:
            files[(name, relative, query)] = (f'<html lang="{language or "en"}"><head><title>Unit</title></head></html>'.encode(), "text/html")
    for file in R.PAPERS:
        files[("alpha", file, None)] = (b"%PDF-unit" if file.endswith(".pdf") else b"PK\x03\x04unit" if file.endswith(".zip") else b"unit TeX", "application/octet-stream")
    inventories = {}
    for name in ("manager", "fleet"):
        inventories[name] = {}
        for relative, _language, _query in R.ROUTES[name]:
            member = relative + "index.html" if not relative or relative.endswith("/") else relative
            raw, media = files[(name, relative, None)]
            files[(name, member, None)] = (raw, media)
            inventories[name][member] = {"bytes": len(raw), "sha256": R.digest(raw)} if name == "manager" else R.digest(raw)
    metadata = {
        "alpha": {"schema": 1, "version": "1.2.3", "commit": expected["alpha"]["commit"], "url": "https://" + R.HOST + R.ROOTS["alpha"]},
        "jobs": {"schemaVersion": 2, "revision": expected["jobs"]["commit"], "basePath": R.ROOTS["jobs"], "directories": 1, "guides": 1,
                 "successorRoutes": ["successor/computer/", "successor/computer/fr/"]},
        "manager": {"sourceCommit": expected["manager"]["commit"], "sourceVersion": "1.2.3",
                    "files": inventories["manager"], "buildOnlyFiles": {".nojekyll": {}}},
        "fleet": {"schema": "agi-fleet-pages-build/v1", "commit": expected["fleet"]["websiteCommit"], "productionQualified": False,
                  "files": inventories["fleet"]},
    }
    for name, value in metadata.items():
        files[(name, R.METADATA[name], None)] = (encoded(value), "application/json")
    release = {"schema": "agi-linux-published-release/v1", "workflowCommit": expected["fleet"]["releaseCommit"], "version": "1.2.3",
               "tag": "v1.2.3-test", "workflowRun": "123", "productionQualified": False, **expected["fleet"]["releaseArchive"]}
    files[("fleet", "release.json", None)] = (encoded(release), "application/json")

    class UnitTransport:
        def __init__(self):
            self.calls = []
        def get(self, target, limit):
            self.calls.append(target)
            parsed = urlsplit(target)
            name = next(name for name, root in R.ROOTS.items() if parsed.path.startswith(root))
            relative = unquote(parsed.path[len(R.ROOTS[name]):])
            language = "fr" if "lang=fr" in parsed.query else None
            raw, media = files[(name, relative, language)]
            return raw, media
    return files, UnitTransport()


class ReadbackUnits(unittest.TestCase):
    def test_finite_paper_inventory_preserves_original_paths_and_adds_public_source_names(self):
        original = (
            "Transformational_Intelligence.pdf", "Transformational_Intelligence.tex",
            "Beyond_the_Original_Problem.pdf", "Beyond_the_Original_Problem.tex",
            "Beyond_the_Production_Frontier.pdf", "Beyond_the_Production_Frontier.tex",
            "Transformational_Intelligence_LaTeX.zip",
            "Beyond_the_Original_Problem_LaTeX.zip",
            "Beyond_the_Production_Frontier_LaTeX.zip",
            "assets/whitepaper_v0.1.0-alphav15.pdf",
            "manuscript/AGI_ALPHA_Unified_Publication_Final.pdf")
        added = (
            "Earn_the_Next_Experiment.pdf", "Earn_the_Next_Experiment.tex",
            "Earn_the_Next_Experiment_LaTeX.zip", "Invent_the_Economy.pdf",
            "Invent_the_Economy.tex", "Invent_the_Economy_LaTeX.zip")
        self.assertEqual(R.PAPERS, original + added)
        self.assertEqual(len(set(R.PAPERS)), 17)
        self.assertEqual([row for row in R.ROUTES["alpha"] if row[0].startswith("PILOT_PLAYBOOK")],
                         [("PILOT_PLAYBOOK/", None, None)])
        expected = expectations()
        expected["alpha"]["paperSha256"] = {added[0]: R.digest(b"%PDF-unit")}
        files, transport = unit_transport(expected)
        value = R.readback(expected, transport)
        self.assertEqual([row["path"] for row in value["papers"]], list(original + added))
        self.assertTrue(next(row for row in value["papers"] if row["path"] == added[0])[
            "independentExpectedHashCompared"])
        self.assertIn("PILOT_PLAYBOOK/", [row["path"] for row in value["routes"] if row["site"] == "alpha"])
        files[("alpha", added[0], None)] = (b"%PDF-unit-changed", "application/octet-stream")
        with self.assertRaisesRegex(ValueError, "independent paper hash differs"):
            R.readback(expected, transport)

    def test_required_independent_inputs_refuse_before_transport(self):
        expected = expectations()
        _, transport = unit_transport(expected)
        del expected["alpha"]["commit"]
        with self.assertRaises(ValueError):
            R.readback(expected, transport)
        self.assertEqual(transport.calls, [])

    def test_safe_public_paths_and_fixed_queries(self):
        self.assertEqual(R.safe_path("assets/trace‑graph.html"), "assets/trace‑graph.html")
        for name in ("../a", "a/../b", "/other", "a%2fb", "a?x=1", "a\\b", ".nojekyll"):
            with self.assertRaises(ValueError):
                R.safe_path(name)
        target = R.request_target("alpha", "successor/alpha/", "1" * 40, "fr")
        self.assertTrue(target.startswith(R.ROOTS["alpha"]))
        self.assertIn("lang=fr", target)
        with self.assertRaises(ValueError):
            R.request_target("alpha", "https://example.invalid/", "1" * 40)

    def test_json_is_strict_and_bounded(self):
        self.assertEqual(R.json_object(b'{"a":1}'), {"a": 1})
        for raw in (b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":1e999}', b'[]', b'\xff'):
            with self.assertRaises((ValueError, UnicodeError)):
                R.json_object(raw)
        with patch.object(R, "JSON_LIMIT", 2):
            with self.assertRaises(ValueError):
                R.json_object(b'{"a":1}')

    def test_manager_and_fleet_inventory_shapes_are_distinct(self):
        self.assertEqual(R.inventory({"files": {"index.html": {"bytes": 0, "sha256": "a" * 64}}, "buildOnlyFiles": {".nojekyll": {}}}, "manager")["index.html"]["bytes"], 0)
        self.assertEqual(R.inventory({"files": {"index.html": "a" * 64}}, "fleet"), {"index.html": {"sha256": "a" * 64}})
        for name in ("build-info.json", ".nojekyll"):
            with self.assertRaises(ValueError):
                R.inventory({"files": {name: "a" * 64}}, "fleet")
        with self.assertRaises(ValueError):
            R.inventory({"files": {"a/b": "a" * 64}}, "fleet")

    def test_metadata_identity_fail_stops_before_payloads(self):
        expected = expectations()
        files, transport = unit_transport(expected)
        value = json.loads(files[("jobs", "catalog.json", None)][0])
        value["revision"] = "9" * 40
        files[("jobs", "catalog.json", None)] = (encoded(value), "application/json")
        with self.assertRaises(ValueError):
            R.readback(expected, transport)
        self.assertEqual(len(transport.calls), 2)
        self.assertTrue(transport.calls[0].split("?")[0].endswith("release.json"))
        self.assertTrue(transport.calls[1].split("?")[0].endswith("catalog.json"))

    def test_website_t_is_not_release_s(self):
        expected = expectations()
        files, _ = unit_transport(expected)
        value = json.loads(files[("fleet", "release.json", None)][0])
        R.fleet_release_identity(value, expected["fleet"])
        value["workflowCommit"] = expected["fleet"]["websiteCommit"]
        with self.assertRaises(ValueError):
            R.fleet_release_identity(value, expected["fleet"])

    def test_generic_offline_readback_order_and_nonclaims(self):
        expected = expectations()
        _, transport = unit_transport(expected)
        value = R.readback(expected, transport)
        self.assertEqual(value["inventoryFilesCompared"], {"manager": 6, "fleet": 6})
        self.assertTrue(all(transport.calls[i].split("?")[0].endswith(R.METADATA[name]) for i, name in enumerate(R.ROOTS)))
        self.assertFalse(value["producerAuthenticatedByThisHelper"])
        self.assertFalse(value["renderedUiTested"])
        self.assertFalse(value["nativeOrModelAcceptance"])
        self.assertTrue(all(row["independentExpectedHashCompared"] is False for row in value["papers"]))

    def test_inventory_or_independent_hash_mismatch_refuses(self):
        expected = expectations()
        files, transport = unit_transport(expected)
        files[("manager", "index.html", None)] = (b"changed", "text/html")
        with self.assertRaises(ValueError):
            R.readback(expected, transport)
        expected = expectations()
        expected["alpha"]["metadataSha256"] = "0" * 64
        _, transport = unit_transport(expected)
        with self.assertRaises(ValueError):
            R.readback(expected, transport)
        self.assertEqual(len(transport.calls), 1)

    def test_directory_alias_is_compared_to_inventory(self):
        expected = expectations()
        files, transport = unit_transport(expected)
        files[("manager", "fr/", None)] = (b'<html lang="fr"><title>Other unit</title></html>', "text/html")
        with self.assertRaisesRegex(ValueError, "alias differs"):
            R.readback(expected, transport)

    def test_fixed_host_http_headers_status_encoding_and_bounds(self):
        class Response:
            status = 200
            def __init__(self, raw=b"unit", headers=None):
                self.raw = raw
                self.headers = headers or {"Content-Length": str(len(raw)), "Content-Type": "text/plain"}
            def getheader(self, name, default=None):
                return self.headers.get(name, default)
            def read(self, count):
                result, self.raw = self.raw[:count], self.raw[count:]
                return result
            def close(self):
                Opener.observed.append("closed")
        class Opener:
            observed = []
            response = Response()
            def open(self, request, **kwargs):
                self.observed.append((request, kwargs))
                return self.response
        target = R.request_target("jobs", "catalog.json", "2" * 40)
        with patch.object(R.urllib.request, "build_opener", return_value=Opener()) as build:
            self.assertEqual(R.PublicHTTP().get(target, 4)[0], b"unit")
            request = Opener.observed[0][0]
            self.assertIsNone(request.get_header("Authorization"))
            self.assertIsNone(request.get_header("Cookie"))
            self.assertEqual(urlsplit(request.full_url).netloc, R.HOST)
            self.assertEqual(request.get_method(), "GET")
            self.assertEqual(Opener.observed[-1], "closed")
            self.assertEqual(len(build.call_args.args), 1)
            self.assertIsInstance(build.call_args.args[0], R.NoRedirect)
            self.assertIsNone(R.NoRedirect().redirect_request(None, None, 302, "unit", {}, "https://example.invalid/"))
            Opener.response = Response()
            Opener.response.status = 302
            with self.assertRaises(ValueError):
                R.PublicHTTP().get(target, 4)
            Opener.response = Response(b"12345", {"Content-Type": "text/plain"})
            with self.assertRaises(ValueError):
                R.PublicHTTP().get(target, 4)
            Opener.response = Response(b"unit", {"Content-Encoding": "gzip"})
            with self.assertRaises(ValueError):
                R.PublicHTTP().get(target, 4)
            with patch.object(Opener, "open", side_effect=R.urllib.error.URLError("GENERIC_TRANSPORT_DETAIL")):
                with self.assertRaisesRegex(ValueError, "public HTTP transport failed") as caught:
                    R.PublicHTTP().get(target, 4)
                self.assertNotIn("GENERIC_TRANSPORT_DETAIL", str(caught.exception))
                self.assertTrue(caught.exception.__suppress_context__)


if __name__ == "__main__":
    unittest.main()
