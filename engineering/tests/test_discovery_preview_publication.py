# SPDX-License-Identifier: Apache-2.0
"""Ordinary inert API/ZIP/publication fixtures; no network or release is created."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import urllib.error
import urllib.parse
import zipfile

import test_discovery_installed_profile as packaging

MODULE = Path(__file__).resolve().parents[1] / "discovery_preview_publication.py"
sys.path.insert(0, str(MODULE.parent))
try:
    spec = importlib.util.spec_from_file_location("discovery_preview_publication", MODULE)
    publication = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(publication)
finally:
    sys.path.pop(0)


# Exact immutable bytes at 0dd352fdd2b1af00bc8358e0ac7f96682fd6f796.
# Keep these explicit: a saved source ZIP has no historical Git object database.
HISTORICAL_BYTES = {
    '.github/workflows/next-release.yml': (12612, 'c46984b99d43d8f8c91d74bc35f14c0a7b6d1f217178087c06d04709aab9c125'),
    '.github/workflows/local-skills.yml': (13301, '93ab984151e461ba6e24a42121cca14e63daa26ea9a4501e9f0cf7fd18a7e3b0'),
    'engineering/publish-next-release.py': (15071, '96860a0774ed9740a24bccb498561d2e0795f477fc957ecaa541724c94fc51ee'),
    'engineering/publish-qualified-release.py': (5103, '159d4841f6b8a88a8717f30460124075ec17088702e47196bf077a96957937b7'),
    'engineering/next-release.json': (739, '0012e5d324d894019ea45d7b31627f47def2c14d06a21127637edc43feffe73b'),
    'local-runtime/release.py': (18992, '46e6458221045ffec6fa61a15bab9ff0783b6fe19c8e9c8f2f5d4a628f6d620b'),
    'local-runtime/preview-release.json': (613, 'de001dbd3cd5afadeb642aa59b0b2377ba48fee02367503e9a3afcf283103f18'),
    'LICENSE': (1068, '4827c1af7eacb8f5941bd6867e74293d5f0c3a1360a567f65cfcf264c6c04a25'),
}


def historical_bytes(root):
    for name, expected in HISTORICAL_BYTES.items():
        raw = (root / name).read_bytes()
        if (len(raw), hashlib.sha256(raw).hexdigest()) != expected:
            raise AssertionError('Historical baseline bytes differ: ' + name)


def missing(path):
    return urllib.error.HTTPError(path, 404, "Inert missing resource", {}, None)


class InertRelease:
    """A release-shaped byte store in memory, never an external service."""
    def __init__(self, source):
        self.source, self.tag, self.release = source, None, None
        self.assets, self.calls, self.downloads = {}, [], []
        self.corrupt = False

    def api(self, path, *, method="GET", data=None, upload=False):
        self.calls.append((method, path))
        if path == "/git/ref/heads/main":
            return {"object": {"sha": self.source}}
        if path == "/git/ref/tags/" + publication.TAG:
            if self.tag is None:
                raise missing(path)
            return copy.deepcopy(self.tag)
        if path == "/git/refs" and method == "POST":
            record = json.loads(data)
            self.tag = {"object": {"type": "commit", "sha": record["sha"]}}
            return copy.deepcopy(self.tag)
        if path == "/releases/tags/" + publication.TAG:
            if self.release is None:
                raise missing(path)
            return copy.deepcopy(self.release)
        if path == "/releases" and method == "POST":
            self.release = {"id": 1, "assets": [], **json.loads(data)}
            return copy.deepcopy(self.release)
        if path.startswith("/releases/1/assets?") and method == "POST":
            name = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)["name"][0]
            identifier = 100 + len(self.assets)
            self.assets[identifier] = data
            self.release["assets"].append({"id": identifier, "name": name, "size": len(data),
                "digest": "sha256:" + publication.digest(data)})
            return {}
        if path == "/releases/1":
            if method == "PATCH":
                self.release.update(json.loads(data))
            return copy.deepcopy(self.release)
        raise AssertionError("Unexpected inert API path: " + path)

    def download(self, path, output, expected):
        self.downloads.append((path, expected))
        identifier = int(path.rsplit("/", 1)[1])
        data = self.assets[identifier]
        output.write_bytes(data + b"changed" if self.corrupt else data)


class Publication(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir="/dev/shm")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.source, self.tree = "a" * 40, "b" * 40

    def review(self):
        record = {"schema": publication.REVIEW_SCHEMA, "repository": publication.REPOSITORY,
            "version": publication.VERSION, "reviewedCommit": self.source, "reviewedTree": self.tree, "pullRequest": 64,
            "reviewer": {"role": "independent-technical-review-agent", "identity": "/inert-static-review",
                         "accountArrangement": "owner-authorized-shared-account"},
            "ownerAuthorization": {"basis": "explicit-public-implementation-mandate", "reference": "inert fixture mandate reference"},
            "reviewedComponents": sorted(publication.COMPONENTS), "unresolvedFindings": [], "findingDispositions": [],
            "organizationalIndependence": False, "economicApproval": False}
        comment = {"id": 17, "html_url": "https://github.com/" + publication.REPOSITORY + "/pull/64#issuecomment-17",
            "issue_url": "https://api.github.com/repos/" + publication.REPOSITORY + "/issues/64",
            "author_association": "OWNER", "user": {"login": "MontrealAI"},
            "body": publication.REVIEW_MARKER + json.dumps(record)}
        pull = {"merged": True, "merge_commit_sha": self.source, "base": {"ref": "main"}}
        return record, comment, pull

    def test_source_specific_shared_account_comment_is_not_fabricated_approval(self):
        _, comment, pull = self.review()
        result = publication.review_record(comment, pull, self.source, self.tree, 64)
        self.assertIn("not APPROVE", result["githubReviewState"])
        self.assertEqual(result["bodySha256"], publication.digest(comment["body"].encode()))
        self.assertFalse(result["record"]["organizationalIndependence"])

    def test_historical_publishers_profiles_and_root_license_are_byte_exact(self):
        historical_bytes(publication.ROOT)

    def test_historical_byte_pins_work_without_git_and_refuse_each_changed_or_missing_file(self):
        root = self.base / 'saved-review-source'
        for name in HISTORICAL_BYTES:
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((publication.ROOT / name).read_bytes())
        self.assertFalse((root / '.git').exists())
        with mock.patch.object(subprocess, 'check_output', side_effect=AssertionError('Git must not be consulted')):
            historical_bytes(root)
            for name in HISTORICAL_BYTES:
                target = root / name
                raw = target.read_bytes()
                target.write_bytes(bytes([raw[0] ^ 1]) + raw[1:])
                with self.subTest(name=name, case='same-length changed bytes'), self.assertRaises(AssertionError) as caught:
                    historical_bytes(root)
                self.assertIn(name, str(caught.exception))
                target.unlink()
                with self.subTest(name=name, case='missing bytes'), self.assertRaises(FileNotFoundError):
                    historical_bytes(root)
                target.write_bytes(raw)
            historical_bytes(root)

    def test_generic_stale_unresolved_or_unmerged_review_refuses(self):
        record, comment, pull = self.review()
        for change in ({"reviewedCommit": "c" * 40}, {"unresolvedFindings": ["open"]},
                       {"reviewedComponents": []}, {"economicApproval": True}):
            altered = {**record, **change}
            candidate = {**comment, "body": publication.REVIEW_MARKER + json.dumps(altered)}
            with self.subTest(change=change), self.assertRaises(ValueError):
                publication.review_record(candidate, pull, self.source, self.tree, 64)
        with self.assertRaises(ValueError):
            publication.review_record({**comment, "body": "Generic bot review clear"}, pull, self.source, self.tree, 64)
        with self.assertRaises(ValueError):
            publication.review_record(comment, {**pull, "merged": False}, self.source, self.tree, 64)

    def test_authorization_requires_exact_current_main_and_frozen_profile(self):
        builder = packaging.InstalledProfile("runTest")
        builder.setUp()
        self.addCleanup(builder.doCleanups)
        fleet, _ = builder.prepare()
        self.source = packaging.git(fleet, "rev-parse", "HEAD")
        self.tree = packaging.git(fleet, "rev-parse", "HEAD^{tree}")
        _, comment, pull = self.review()
        env = {"GITHUB_REPOSITORY": publication.REPOSITORY, "GITHUB_SHA": self.source,
            "GITHUB_REF": "refs/heads/main", "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "1", "GITHUB_WORKFLOW_REF": publication.REPOSITORY + "/" + publication.WORKFLOW + "@refs/heads/main"}
        values = {"/git/ref/heads/main": {"object": {"sha": self.source}}, "/git/commits/" + self.source: {"tree": {"sha": self.tree}},
            "/pulls/64": pull, "/issues/comments/17": comment}
        result = publication.authorize(lambda path: values[path], self.source, 64, 17, publication.CONFIRMATION, root=fleet, environment=env)
        self.assertEqual(result["source"]["commit"], self.source)
        for changed in ({"GITHUB_REF": "refs/heads/other"}, {"GITHUB_EVENT_NAME": "push"}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                publication.authorize(lambda path: values[path], self.source, 64, 17, publication.CONFIRMATION,
                                      root=fleet, environment={**env, **changed})
        values["/git/ref/heads/main"] = {"object": {"sha": "d" * 40}}
        with self.assertRaisesRegex(ValueError, "lease"):
            publication.authorize(lambda path: values[path], self.source, 64, 17, publication.CONFIRMATION, root=fleet, environment=env)

    def jobs(self):
        names = set(publication.ARTIFACT_JOBS.values()) | {"Inherited full Fleet / Required release qualification",
            "Inherited full Fleet / build", "Inherited full Fleet / native (ubuntu-24.04, x64)",
            "Inherited full Fleet / native (ubuntu-24.04-arm, arm64)", "Inherited full Fleet / integration (ubuntu-24.04, x64)",
            "Inherited full Fleet / integration (ubuntu-24.04-arm, arm64)", "Inherited full Fleet / Saved-archive Manager 1.17 contract profile (ubuntu-24.04, x64)",
            "Inherited full Fleet / Saved-archive Manager 1.17 contract profile (ubuntu-24.04-arm, arm64)",
            "Inherited full Fleet / Saved-archive SUCCESSOR browser execution"}
        jobs = []
        for index, name in enumerate(sorted(names)):
            steps = publication.CRITICAL_STEPS.get(name, ())
            if name.startswith("Discovery installed review / Discovery installed native ("):
                steps = ("Verify and install the same saved archive without starting services",
                         "Run the actual extracted reviewer and return both alternatives to one mission",
                         "Preserve the separate constructed native regression history")
            jobs.append({"id": 1000 + index, "run_id": 123, "head_sha": self.source, "name": name,
                "status": "completed", "conclusion": "success", "started_at": "2026-10-22T00:00:00Z", "completed_at": "2026-10-22T00:10:00Z",
                "steps": [{"name": step, "status": "completed", "conclusion": "success"} for step in steps]})
        return jobs

    def test_all_original_inherited_groups_and_unskipped_native_steps_are_required(self):
        authorization = {"source": {"commit": self.source}, "workflow": {"GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2"}}
        jobs = self.jobs()
        def api(path):
            if path == "/actions/runs/123":
                return {"head_sha": self.source, "head_branch": "main", "event": "workflow_dispatch", "run_attempt": 2,
                        "workflow_id": 9, "path": publication.WORKFLOW}
            if path == "/actions/workflows/publish-discovery-preview.yml":
                return {"id": 9}
            if path.startswith("/actions/runs/123/attempts/2/jobs?"):
                return {"jobs": jobs}
            raise AssertionError(path)
        publication.workflow_jobs(api, authorization)
        target = next(job for job in jobs if "Discovery installed native (fleet-" in job["name"])
        target["steps"][-1]["conclusion"] = "skipped"
        with self.assertRaisesRegex(ValueError, "required step"):
            publication.workflow_jobs(api, authorization)
        target["steps"][-1]["conclusion"] = "success"
        jobs.remove(next(job for job in jobs if job["name"].startswith("Inherited full Fleet / integration (ubuntu-24.04-arm")))
        with self.assertRaisesRegex(ValueError, "qualification groups"):
            publication.workflow_jobs(api, authorization)

    def test_artifact_expansion_collision_refuses_before_output(self):
        archive = self.base / "inert.zip"
        with zipfile.ZipFile(archive, "x") as saved:
            saved.writestr("a", b"inert")
            saved.writestr("a/b", b"inert")
        target = self.base / "must-stay-absent"
        with self.assertRaisesRegex(ValueError, "paths conflict"):
            publication.safe_extract(archive, target)
        self.assertFalse(target.exists())

    def files(self):
        files = [self.base / "candidate.zip", self.base / "qualification.json"]
        files[0].write_bytes(b"inert saved byte fixture")
        files[1].write_bytes(b'{"inertMetadataFixture":true}')
        return files

    def test_immutable_release_downloads_every_asset_before_and_after_publish(self):
        transport = InertRelease(self.source)
        files = self.files()
        result = publication.publish_assets(transport, self.source, files, "Inert fixture notes")
        self.assertEqual(len(result["downloadedAssets"]), len(files) * 2)
        self.assertEqual({row["phase"] for row in result["downloadedAssets"]}, {"draft", "published"})
        self.assertFalse(transport.release["draft"])
        self.assertFalse(result["productionQualified"])
        self.assertFalse(any(method == "DELETE" for method, _ in transport.calls))

    def test_wrong_tag_or_differing_existing_asset_never_overwrites(self):
        transport = InertRelease(self.source)
        transport.tag = {"object": {"type": "commit", "sha": "c" * 40}}
        with self.assertRaisesRegex(ValueError, "replacement"):
            publication.publish_assets(transport, self.source, self.files(), "Inert fixture notes")
        self.assertFalse(any(method != "GET" for method, _ in transport.calls))

    def test_differing_draft_asset_and_missing_published_asset_refuse(self):
        files = self.files()
        for draft, entries in ((True, [{"id": 101, "name": files[0].name, "size": 1, "digest": "sha256:" + "0" * 64}]),
                               (False, [])):
            with self.subTest(draft=draft):
                transport = InertRelease(self.source)
                transport.tag = {"object": {"type": "commit", "sha": self.source}}
                transport.release = {"id": 1, "prerelease": True, "draft": draft, "target_commitish": self.source,
                                     "body": "Inert fixture notes", "assets": entries}
                with self.assertRaisesRegex(ValueError, "replacement|already published"):
                    publication.publish_assets(transport, self.source, files, "Inert fixture notes")
                self.assertFalse(any(method != "GET" for method, _ in transport.calls))

    def test_original_artifact_source_job_time_and_downloaded_zip_custody(self):
        jobs = self.jobs()
        records = []
        data = {}
        for index, (name, job_name) in enumerate(publication.ARTIFACT_JOBS.items()):
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w") as saved:
                saved.writestr("inert-retained-metadata.json", b'{"fixture":true}')
            raw = output.getvalue()
            identifier = 200 + index
            data[identifier] = raw
            records.append({"name": name, "id": identifier, "expired": False, "workflow_run": {"id": 123, "head_sha": self.source},
                "created_at": "2026-10-22T00:05:00Z", "digest": "sha256:" + publication.digest(raw), "size_in_bytes": len(raw)})
        class Transport:
            def api(self, path):
                return {"artifacts": records}
            def download(self, path, output, expected):
                raw = data[int(path.split("/")[-2])]
                self_check = {"bytes": len(raw), "sha256": publication.digest(raw)}
                if self_check != expected:
                    raise ValueError("Inert artifact byte mismatch")
                output.write_bytes(raw)
        authorization = {"source": {"commit": self.source}, "workflow": {"GITHUB_RUN_ID": "123"}}
        folder = self.base / "artifacts"
        folder.mkdir()
        custody = publication.download_artifacts(Transport(), authorization, folder, jobs)
        self.assertEqual(len(custody), len(publication.ARTIFACT_JOBS))
        self.assertTrue(all(row["members"][0]["path"] == "inert-retained-metadata.json" for row in custody))
        records[0]["created_at"] = "2026-10-21T00:05:00Z"
        stale = self.base / "stale-artifacts"
        stale.mkdir()
        with self.assertRaisesRegex(ValueError, "attempt custody"):
            publication.download_artifacts(Transport(), authorization, stale, jobs)

    def test_changed_downloaded_bytes_block_publication(self):
        transport = InertRelease(self.source)
        transport.corrupt = True
        with self.assertRaisesRegex(ValueError, "downloaded asset bytes"):
            publication.publish_assets(transport, self.source, self.files(), "Inert fixture notes")
        self.assertTrue(transport.release["draft"])
        self.assertFalse(any(method == "PATCH" for method, _ in transport.calls))

    def test_advanced_main_stops_before_any_mutation(self):
        transport = InertRelease("c" * 40)
        with self.assertRaisesRegex(ValueError, "Main/source lease"):
            publication.publish_assets(transport, self.source, self.files(), "Inert fixture notes")
        self.assertFalse(any(method != "GET" for method, _ in transport.calls))

    def test_changed_review_lease_stops_before_publishing_verified_draft(self):
        transport = InertRelease(self.source)
        def changed_review():
            raise ValueError("Inert review lease changed")
        with self.assertRaisesRegex(ValueError, "review lease changed"):
            publication.publish_assets(transport, self.source, self.files(), "Inert fixture notes", before_publish=changed_review)
        self.assertTrue(transport.release["draft"])
        self.assertFalse(any(method == "PATCH" for method, _ in transport.calls))

    def test_signed_storage_redirect_does_not_receive_authorization(self):
        transport = publication.GitHub("inert-token-never-sent")
        data = b"inert saved bytes"
        redirect = urllib.error.HTTPError("https://api.github.com/inert", 302, "fixture", {"Location": "https://storage.example.invalid/inert-signed-fixture"}, None)
        captured = []
        class Opener:
            def open(self, request, **kwargs):
                captured.append(dict(request.header_items()))
                return io.BytesIO(data)
        with mock.patch.object(transport, "request", side_effect=redirect), mock.patch.object(publication.urllib.request, "build_opener", return_value=Opener()):
            target = self.base / "inert-download"
            transport.download("/releases/assets/1", target, {"bytes": len(data), "sha256": publication.digest(data)})
        self.assertEqual(target.read_bytes(), data)
        self.assertFalse(any(key.lower() == "authorization" for headers in captured for key in headers))

    def test_review_source_zip_streams_git_blob_and_crc_checks(self):
        builder = packaging.InstalledProfile("runTest")
        builder.setUp()
        self.addCleanup(builder.doCleanups)
        fleet, _ = builder.prepare()
        source = packaging.git(fleet, "rev-parse", "HEAD")
        archive = self.base / "inert-source.zip"
        subprocess.run(["git", "-C", str(fleet), "archive", "--format=zip", "--output=" + str(archive), source], check=True)
        result = publication.verify_source_archive(archive, source, root=fleet)
        self.assertTrue(result["gitBlobsMatched"])
        altered = self.base / "altered-source.zip"
        with zipfile.ZipFile(archive) as original, zipfile.ZipFile(altered, "x") as saved:
            saved.comment = original.comment
            for info in original.infolist():
                data = original.read(info)
                if not info.is_dir() and info.external_attr >> 16 == 0:
                    # Python's writer assigns permission-only 0600 when an old
                    # Git DOS member has zero attributes. Preserve its 100644 meaning.
                    info.create_system = 3
                    info.external_attr = (stat.S_IFREG | 0o644) << 16
                if info.filename == "LICENSE":
                    data += b"inert changed license data"
                saved.writestr(info, data)
        with self.assertRaisesRegex(ValueError, "bytes differ"):
            publication.verify_source_archive(altered, source, root=fleet)


if __name__ == "__main__":
    unittest.main()
