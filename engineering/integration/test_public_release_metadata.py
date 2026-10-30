"""Benign public-package metadata checks; no hosted/native qualification.

These complete tiny archives are ordinary synthetic unit metadata. They do not
supply Git provenance, installed product evidence or a connected journey.
"""
import hashlib
from pathlib import Path
import runpy
import stat
import tempfile
import unittest
import zipfile

COMMON = runpy.run_path(str(Path(__file__).with_name("public_release_common.py")))

class PublicReleaseMetadataTests(unittest.TestCase):
    def test_known_input_blob_and_raw_digests(self):
        observed = COMMON["verify_input_blob"](
            b"hello\n", "ce013625030ba8dba906f756967f9e9ca394464a",
            "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03", 6)
        self.assertEqual(observed["bytes"], 6)
        self.assertEqual(observed["gitBlob"], COMMON["git_blob"](b"hello\n"))

    def test_complete_tiny_source_members_bytes_and_modes(self):
        public = {"README.txt": (b"Public package\n", "100644", 0),
                  "bin/public-tool": (b"#!/bin/sh\nprintf public\\n\n", "100755", stat.S_IFREG | 0o755)}
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "public-source.zip"
            with zipfile.ZipFile(archive, "w") as output:
                for name, (raw, _, mode) in public.items():
                    info = zipfile.ZipInfo("public-source/" + name)
                    info.create_system = 3
                    info.external_attr = (mode << 16) or 0x20
                    output.writestr(info, raw)
            entries = COMMON["inspect_zip"](archive)
            tracked = {name: {"mode": mode, "blob": hashlib.sha1(
                b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()}
                for name, (raw, mode, _) in public.items()}
            selected = COMMON["source_members"](entries, "public-source/", tracked)
            self.assertEqual(set(selected), set(public))
            with zipfile.ZipFile(archive) as source:
                for name, expected in tracked.items():
                    raw = source.read("public-source/" + name)
                    declared, effective = COMMON["source_member_identity"](
                        raw, selected[name], expected, "alpha", name)
                    self.assertEqual(raw, public[name][0])
                    self.assertEqual(effective, stat.S_IFREG | (0o755 if name.startswith("bin/") else 0o644))
                    self.assertEqual(declared, (stat.S_IFREG | 0o755) if name.startswith("bin/") else None)

# Shape-only unit tokens; never final inputs, API receipts or live observations.
# run_path keeps the CLI admission guards inactive and does not call the API.
LIVE = runpy.run_path(str(Path(__file__).with_name("public_live_inputs.py")))


def live_metadata_fixture():
    website_source = {"commit": "1" * 40, "tree": "2" * 40}
    value = {
        "schema": "agi-fleet/final-public-live-inputs/v1",
        "websiteSource": website_source,
        "releaseInput": {"blob": "3" * 40, "sha256": "4" * 64},
        "connectedJourney": {"runId": 1, "attempt": 1},
        "sites": {},
    }
    for role, repository, asset_role in (
        ("alpha", "AGI-Alpha-Agent-v0", "source"),
        ("fleet", "AGI-Fleet-Linux", "packageX64"),
        ("jobs", "AGIJobsv0", "source"),
        ("manager", "AGIJobManager", "package"),
    ):
        build_info = {
            "path": "/release.json" if role == "alpha" else "/build-info.json",
            "commitPointer": "/commit",
            "versionPointer": "/version",
        }
        if role == "jobs":
            build_info = {
                "path": "/catalog.json",
                "commitPointer": "/revision",
                "versionPointer": None,
            }
        elif role == "fleet":
            build_info["versionPath"] = "/release.json"
        elif role == "manager":
            build_info["commitPointer"] = "/sourceCommit"
            build_info["versionPointer"] = "/sourceVersion"
        value["sites"][role] = {
            "baseUrl": "https://montrealai.github.io/" + repository + "/",
            "source": dict(website_source),
            "version": "1.2.3",
            "buildInfo": build_info,
            "pagesRun": {
                "id": 1,
                "attempt": 1,
                "path": ".github/workflows/pages.yml",
                "event": "push",
                "ref": "refs/heads/main",
            },
            "languages": {
                language: {
                    "path": "/",
                    "steps": [{"action": "assertVisible", "selector": "h1", "value": ""}],
                    "downloads": [{"selector": "a.download", "assetRole": asset_role}],
                }
                for language in ("en", "fr")
            },
        }
    return value


class PublicLiveMetadataTests(unittest.TestCase):
    def test_jobs_context_and_separate_fleet_version_metadata_shape(self):
        value = live_metadata_fixture()
        self.assertIs(LIVE["validate_live"](value), value)

    def test_jobs_refuses_served_version_or_wrong_catalog_metadata(self):
        for field, replacement in (
            ("versionPointer", "/version"),
            ("path", "/release.json"),
            ("commitPointer", "/commit"),
        ):
            with self.subTest(field=field):
                value = live_metadata_fixture()
                value["sites"]["jobs"]["buildInfo"][field] = replacement
                with self.assertRaises(ValueError):
                    LIVE["validate_live"](value)

    def test_alpha_and_manager_require_served_version_pointer(self):
        for role in ("alpha", "manager"):
            with self.subTest(role=role):
                value = live_metadata_fixture()
                value["sites"][role]["buildInfo"]["versionPointer"] = None
                with self.assertRaises(ValueError):
                    LIVE["validate_live"](value)

    def test_fleet_refuses_missing_or_wrong_separate_version_path(self):
        for version_path in (None, "/build-info.json"):
            with self.subTest(version_path=version_path):
                value = live_metadata_fixture()
                build_info = value["sites"]["fleet"]["buildInfo"]
                if version_path is None:
                    del build_info["versionPath"]
                else:
                    build_info["versionPath"] = version_path
                with self.assertRaises(ValueError):
                    LIVE["validate_live"](value)

    def test_fleet_website_source_must_remain_t(self):
        value = live_metadata_fixture()
        value["sites"]["fleet"]["source"]["commit"] = "9" * 40
        with self.assertRaises(ValueError):
            LIVE["validate_live"](value)


if __name__ == "__main__":
    unittest.main()
