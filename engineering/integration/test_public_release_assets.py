"""Bounded synthetic release-admission fixtures, never release qualification.

All API responses, workflow identities and downloaded bytes are local doubles.
No network, package execution, install or source-custody path is exercised.
"""
import base64
import copy
from contextlib import contextmanager, redirect_stdout
import io
import json
import os
from pathlib import Path
import runpy
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

ASSETS = runpy.run_path(str(Path(__file__).with_name("public_release_assets.py")))


class ReleaseFixture:
    """A shape-valid four-repository input with independently fixed test bytes."""

    def __init__(self, immutable=False):
        self.input = {"schema": ASSETS["SCHEMA"], "consumerSource": None, "repositories": {}}
        self.api_rows, self.asset_rows, self.payloads = {}, {}, {}
        self.downloaded = []
        for index, (role, repository) in enumerate(ASSETS["REPOSITORIES"].items(), 1):
            identity = {"commit": str(index) * 40, "tree": str(index + 4) * 40}
            prefix = "/repos/" + repository
            release_id = 100 + index
            tag = "fixture-1.0"
            selected = {
                "repository": repository, "releaseId": release_id, "tag": tag,
                "reviewed": dict(identity), "released": dict(identity),
                "sourceContinuity": {"kind": "same-commit", "reviewIds": [700 + index]},
                "jobsSourceTransition": None, "requiredRuns": [], "assets": {},
            }
            self.input["repositories"][role] = selected
            if role == "fleet":
                self.input["consumerSource"] = dict(identity)
            self.api_rows[prefix + "/releases/" + str(release_id)] = {
                "id": release_id, "tag_name": tag, "draft": False,
                "published_at": "2026-01-01T00:00:00Z", "immutable": immutable, "prerelease": True,
            }
            self.api_rows[prefix + "/git/ref/tags/" + tag] = {
                "object": {"type": "commit", "sha": identity["commit"]}}
            self.api_rows[prefix + "/git/commits/" + identity["commit"]] = {
                "tree": {"sha": identity["tree"]}}
            rows = []
            for offset, asset_role in enumerate(sorted(ASSETS["ROLES"][role]), 1):
                asset_id = index * 1000 + offset
                name = ("source-profile-rc16.json" if asset_role == "sourceProfile"
                        else role + "-" + asset_role + ".txt")
                payload = ("synthetic fixture: " + role + "/" + asset_role + "\n").encode()
                digest = ASSETS["sha"](payload)
                selected["assets"][asset_role] = {
                    "id": asset_id, "name": name, "bytes": len(payload), "sha256": digest}
                rows.append({"id": asset_id, "name": name, "size": len(payload),
                             "digest": "sha256:" + digest, "state": "uploaded"})
                self.payloads["https://api.github.com" + prefix + "/releases/assets/" + str(asset_id)] = payload
            self.asset_rows[prefix + "/releases/" + str(release_id) + "/assets"] = rows
            for offset, workflow in enumerate(sorted(ASSETS["REQUIRED_WORKFLOWS"][role]), 1):
                run_id = index * 100 + offset
                event = "workflow_dispatch" if role == "fleet" else "push"
                selected["requiredRuns"].append({
                    "id": run_id, "attempt": 1, "path": ".github/workflows/" + workflow,
                    "event": event, "ref": "refs/heads/main", "sourceRole": "released"})
                run = {"id": run_id, "run_attempt": 1, "status": "completed", "conclusion": "success",
                       "head_sha": identity["commit"], "path": ".github/workflows/" + workflow,
                       "event": event, "head_branch": "main"}
                self.api_rows[prefix + "/actions/runs/" + str(run_id)] = run
                self.api_rows[prefix + "/actions/runs/" + str(run_id) + "/attempts/1"] = dict(run)
            comment_id = selected["sourceContinuity"]["reviewIds"][0]
            self.api_rows[prefix + "/issues/comments/" + str(comment_id)] = {
                "id": comment_id, "body": "Fixture only: " + identity["commit"],
                "html_url": "https://github.com/" + repository + "/issues/1#issuecomment-" + str(comment_id),
                "user": {"login": "synthetic-fixture"}, "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z"}
        ASSETS["validate"](self.input)
        self.raw = ASSETS["encoded"](self.input)
        self.blob_id, self.raw_sha = ASSETS["git_blob"](self.raw), ASSETS["sha"](self.raw)
        self.prefix = "/repos/" + ASSETS["REPOSITORIES"]["fleet"]
        self.blob_path = self.prefix + "/git/blobs/" + self.blob_id
        self.api_rows[self.blob_path] = {
            "sha": self.blob_id, "encoding": "base64", "size": len(self.raw),
            "content": base64.b64encode(self.raw).decode()}
        self.env = {
            "GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted",
            "GITHUB_REPOSITORY": ASSETS["REPOSITORIES"]["fleet"],
            "GITHUB_EVENT_NAME": "push", "GITHUB_RUN_ATTEMPT": "1",
            "GITHUB_SHA": self.input["consumerSource"]["commit"], "GITHUB_RUN_ID": "9001",
            "GITHUB_REF": "refs/heads/qualification/ti-public-packages-" + self.blob_id + "-" + self.raw_sha,
        }
        self.consumer_path = self.prefix + "/actions/runs/9001"
        self.api_rows[self.consumer_path] = {
            "id": 9001, "run_attempt": 1, "head_sha": self.env["GITHUB_SHA"], "event": "push",
            "head_branch": self.env["GITHUB_REF"][len("refs/heads/"):],
            "path": ".github/workflows/public-release-journey.yml"}

    def api(self, path):
        if path not in self.api_rows:
            raise urllib.error.HTTPError("https://api.github.com" + path, 404, "fixture missing", {}, None)
        return copy.deepcopy(self.api_rows[path])

    def pages(self, path, key=None):
        if key == "workflow_runs":
            expected = self.prefix + "/actions/workflows/public-release-journey.yml/runs?head_sha=" + self.env["GITHUB_SHA"]
            if path != expected:
                raise AssertionError("unexpected fixture workflow query: " + path)
            return [{"id": 9001}]
        return copy.deepcopy(self.asset_rows[path])

    def git(self, root, *args):
        if args == ("rev-parse", "HEAD"):
            return self.input["consumerSource"]["commit"]
        if args == ("rev-parse", "HEAD^{tree}"):
            return self.input["consumerSource"]["tree"]
        raise AssertionError("unexpected Git invocation in bounded fixture")

    def response(self, url, *, binary=False):
        if not binary or url not in self.payloads:
            raise AssertionError("unexpected download in bounded fixture: " + url)
        self.downloaded.append(url)
        return io.BytesIO(self.payloads[url])

    @contextmanager
    def active(self):
        with patch.dict(os.environ, self.env, clear=True), \
             patch.dict(ASSETS["current"].__globals__, {"api": self.api, "pages": self.pages, "git": self.git}), \
             patch.dict(ASSETS["download"].__globals__, {"response": self.response}):
            yield

    def alpha(self):
        selected = self.input["repositories"]["alpha"]
        return selected, "/repos/" + selected["repository"]


class PublicReleaseAdmissionTests(unittest.TestCase):
    def test_mutable_and_immutable_release_acquisition_preserve_observed_flag(self):
        for immutable in (False, True):
            with self.subTest(immutable=immutable), tempfile.TemporaryDirectory() as temporary:
                fixture = ReleaseFixture(immutable)
                with fixture.active():
                    value, producer, observations = ASSETS["run"]("acquire", Path(temporary) / "bundle")
                self.assertEqual(value, fixture.input)
                self.assertEqual(producer["inputBlob"], fixture.blob_id)
                self.assertEqual(producer["inputSha256"], fixture.raw_sha)
                receipt = json.loads((Path(temporary) / "bundle/acquisition.json").read_text())
                self.assertEqual(receipt["observations"], observations)
                for role in ASSETS["REPOSITORIES"]:
                    self.assertIs(observations[role]["release"]["immutable"], immutable)
                self.assertEqual(len(fixture.downloaded), 16)

    def test_published_prerelease_and_stable_status_are_both_preserved(self):
        for prerelease in (False, True):
            with self.subTest(prerelease=prerelease):
                fixture = ReleaseFixture()
                selected, prefix = fixture.alpha()
                fixture.api_rows[prefix + "/releases/" + str(selected["releaseId"])]["prerelease"] = prerelease
                with fixture.active():
                    observations = ASSETS["authenticate"](fixture.input)
                self.assertIs(observations["alpha"]["release"]["prerelease"], prerelease)

    def test_cli_reports_content_pinning_and_actual_optional_immutability(self):
        original_run_path = runpy.run_path
        module = Path(__file__).with_name("public_release_assets.py")
        common_path = module.with_name("public_release_common.py")
        for immutable in (False, True, None):
            with self.subTest(immutable=immutable), tempfile.TemporaryDirectory() as temporary:
                fixture = ReleaseFixture(immutable)
                if immutable is None:
                    for role, selected in fixture.input["repositories"].items():
                        del fixture.api_rows["/repos/" + selected["repository"] + "/releases/" + str(selected["releaseId"])]["immutable"]
                common = original_run_path(str(common_path))
                common.update({"api": fixture.api, "pages": fixture.pages, "git": fixture.git})
                common["download"].__globals__["response"] = fixture.response

                def load_common(path):
                    self.assertEqual(Path(path), common_path)
                    return common

                output = io.StringIO()
                with patch.dict(os.environ, fixture.env, clear=True), \
                     patch.object(sys, "argv", [str(module), "acquire", "--bundle", str(Path(temporary) / "bundle")]), \
                     patch("runpy.run_path", side_effect=load_common), redirect_stdout(output):
                    original_run_path(str(module), run_name="__main__")
                summary = json.loads(output.getvalue())
                self.assertIs(summary["contentPinnedReleasesAuthenticated"], True)
                self.assertNotIn("immutableReleasesAuthenticated", summary)
                self.assertEqual(summary["releaseImmutabilityObserved"],
                                 {role: immutable for role in ASSETS["REPOSITORIES"]})
                self.assertIs(summary["journeyExecuted"], False)
                self.assertEqual(summary["input"], fixture.raw_sha)

    def test_missing_optional_immutability_observation_does_not_reject_release(self):
        fixture = ReleaseFixture()
        selected, prefix = fixture.alpha()
        del fixture.api_rows[prefix + "/releases/" + str(selected["releaseId"])]["immutable"]
        with fixture.active():
            observations = ASSETS["authenticate"](fixture.input)
        self.assertIsNone(observations["alpha"]["release"].get("immutable"))

    def test_unselected_release_asset_is_not_acquired(self):
        fixture = ReleaseFixture()
        selected, prefix = fixture.alpha()
        fixture.asset_rows[prefix + "/releases/" + str(selected["releaseId"]) + "/assets"].append({
            "id": 999999, "name": "unselected.txt", "size": 1, "digest": "sha256:" + "0" * 64,
            "state": "uploaded"})
        with tempfile.TemporaryDirectory() as temporary, fixture.active():
            bundle = Path(temporary) / "bundle"
            _, _, observations = ASSETS["run"]("acquire", bundle)
            self.assertEqual({p.name for p in (bundle / "alpha").iterdir()},
                             {a["name"] for a in selected["assets"].values()})
            self.assertNotIn(999999, {a["id"] for a in observations["alpha"]["assets"].values()})
            self.assertEqual(len(fixture.downloaded), 16)

    def test_wrong_release_id_tag_draft_or_publication_is_rejected(self):
        for field, replacement in (("id", 999), ("tag_name", "different"),
                                   ("draft", True), ("published_at", None)):
            with self.subTest(field=field):
                fixture = ReleaseFixture()
                selected, prefix = fixture.alpha()
                fixture.api_rows[prefix + "/releases/" + str(selected["releaseId"])][field] = replacement
                with fixture.active(), self.assertRaisesRegex(ValueError, "published release identity"):
                    ASSETS["authenticate"](fixture.input)

    def test_wrong_peeled_commit_or_source_tree_is_rejected(self):
        for target in ("commit", "tree"):
            with self.subTest(target=target):
                fixture = ReleaseFixture()
                selected, prefix = fixture.alpha()
                if target == "commit":
                    fixture.api_rows[prefix + "/git/ref/tags/" + selected["tag"]]["object"]["sha"] = "a" * 40
                else:
                    fixture.api_rows[prefix + "/git/commits/" + selected["released"]["commit"]]["tree"]["sha"] = "b" * 40
                with fixture.active(), self.assertRaisesRegex(ValueError, "peeled release tag commit|authenticated source trees"):
                    ASSETS["authenticate"](fixture.input)

    def test_wrong_producer_source_attempt_workflow_event_ref_or_result_is_rejected(self):
        for field, replacement in (("head_sha", "a" * 40), ("run_attempt", 2),
                                   ("path", ".github/workflows/other.yml"), ("event", "pull_request"),
                                   ("head_branch", "other"), ("status", "in_progress"),
                                   ("conclusion", "failure")):
            with self.subTest(field=field):
                fixture = ReleaseFixture()
                selected, prefix = fixture.alpha()
                fixture.api_rows[prefix + "/actions/runs/" + str(selected["requiredRuns"][0]["id"])][field] = replacement
                with fixture.active(), self.assertRaisesRegex(ValueError, "required producer source/attempt/status"):
                    ASSETS["authenticate"](fixture.input)

    def test_failed_producer_attempt_and_missing_canonical_producer_are_rejected(self):
        fixture = ReleaseFixture()
        selected, prefix = fixture.alpha()
        fixture.api_rows[prefix + "/actions/runs/" + str(selected["requiredRuns"][0]["id"]) + "/attempts/1"]["conclusion"] = "failure"
        with fixture.active(), self.assertRaisesRegex(ValueError, "required producer source/attempt/status"):
            ASSETS["authenticate"](fixture.input)
        selected["requiredRuns"] = []
        with self.assertRaisesRegex(ValueError, "finite required producer runs"):
            ASSETS["validate"](fixture.input)

    def test_missing_or_wrong_source_review_binding_is_rejected(self):
        fixture = ReleaseFixture()
        selected, prefix = fixture.alpha()
        path = prefix + "/issues/comments/" + str(selected["sourceContinuity"]["reviewIds"][0])
        fixture.api_rows[path]["body"] = "unbound synthetic review"
        with fixture.active(), self.assertRaisesRegex(ValueError, "source review comment identity/binding differs"):
            ASSETS["authenticate"](fixture.input)
        selected["sourceContinuity"]["reviewIds"] = []
        with self.assertRaisesRegex(ValueError, "genuine review comment IDs required"):
            ASSETS["validate"](fixture.input)

    def test_selected_asset_id_name_size_digest_or_state_change_is_rejected(self):
        for field, replacement in (("id", 999), ("name", "replacement.txt"), ("size", 1),
                                   ("digest", "sha256:" + "a" * 64), ("state", "new")):
            with self.subTest(field=field):
                fixture = ReleaseFixture()
                selected, prefix = fixture.alpha()
                fixture.asset_rows[prefix + "/releases/" + str(selected["releaseId"]) + "/assets"][0][field] = replacement
                with fixture.active(), self.assertRaisesRegex(ValueError, "release asset metadata differs"):
                    ASSETS["authenticate"](fixture.input)

    def test_missing_selected_asset_or_required_digest_is_rejected(self):
        fixture = ReleaseFixture()
        selected, prefix = fixture.alpha()
        fixture.asset_rows[prefix + "/releases/" + str(selected["releaseId"]) + "/assets"].pop()
        with fixture.active(), self.assertRaisesRegex(ValueError, "release asset metadata differs"):
            ASSETS["authenticate"](fixture.input)
        del next(iter(selected["assets"].values()))["sha256"]
        with self.assertRaisesRegex(ValueError, "closed object keys differ"):
            ASSETS["validate"](fixture.input)

    def test_self_consistent_replacement_metadata_and_bytes_do_not_replace_input(self):
        fixture = ReleaseFixture()
        selected, prefix = fixture.alpha()
        actual = fixture.asset_rows[prefix + "/releases/" + str(selected["releaseId"]) + "/assets"][0]
        replacement = b"new unapproved fixture bytes\n"
        actual["size"], actual["digest"] = len(replacement), "sha256:" + ASSETS["sha"](replacement)
        fixture.payloads["https://api.github.com" + prefix + "/releases/assets/" + str(actual["id"])] = replacement
        with tempfile.TemporaryDirectory() as temporary, fixture.active():
            with self.assertRaisesRegex(ValueError, "release asset metadata differs"):
                ASSETS["run"]("acquire", Path(temporary) / "bundle")
        self.assertEqual(fixture.downloaded, [])

    def test_corrupt_short_or_long_download_fails_against_approved_bytes(self):
        for mutation in (lambda raw: b"X" + raw[1:], lambda raw: raw[:-1], lambda raw: raw + b"X"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                fixture = ReleaseFixture()
                url = next(iter(fixture.payloads))
                fixture.payloads[url] = mutation(fixture.payloads[url])
                with fixture.active(), self.assertRaisesRegex(ValueError, "download bytes differ|download exceeded authenticated size"):
                    ASSETS["run"]("acquire", Path(temporary) / "bundle")
                self.assertFalse((Path(temporary) / "bundle/acquisition.json").exists())

    def test_transport_verify_retains_live_authentication_and_byte_check(self):
        fixture = ReleaseFixture()
        with tempfile.TemporaryDirectory() as temporary, fixture.active():
            bundle = Path(temporary) / "bundle"
            ASSETS["run"]("acquire", bundle)
            ASSETS["run"]("verify", bundle)
            selected, prefix = fixture.alpha()
            path = prefix + "/releases/" + str(selected["releaseId"])
            fixture.api_rows[path]["tag_name"] = "different"
            with self.assertRaisesRegex(ValueError, "published release identity"):
                ASSETS["run"]("verify", bundle)
            fixture.api_rows[path]["tag_name"] = selected["tag"]
            asset = next(iter(selected["assets"].values()))
            file = bundle / "alpha" / asset["name"]
            file.write_bytes(b"X" + file.read_bytes()[1:])
            with self.assertRaisesRegex(ValueError, "transported public bytes differ"):
                ASSETS["run"]("verify", bundle)

    def test_missing_input_anchor_branch_or_blob_is_rejected(self):
        fixture = ReleaseFixture()
        fixture.env["GITHUB_REF"] = "refs/heads/main"
        with fixture.active(), self.assertRaisesRegex(ValueError, "strict input-bound qualification branch"):
            ASSETS["current"]()
        fixture = ReleaseFixture()
        del fixture.api_rows[fixture.blob_path]
        with fixture.active(), self.assertRaises(urllib.error.HTTPError):
            ASSETS["current"]()

    def test_changed_input_bytes_fail_even_when_blob_metadata_claims_original_identity(self):
        fixture = ReleaseFixture()
        changed = fixture.raw.replace(b"fixture-1.0", b"fixture-2.0")
        self.assertEqual(len(changed), len(fixture.raw))
        fixture.api_rows[fixture.blob_path]["content"] = base64.b64encode(changed).decode()
        with fixture.active(), self.assertRaisesRegex(ValueError, "raw input and Git blob digests"):
            ASSETS["current"]()

    def test_wrong_or_missing_input_digests_and_size_are_rejected(self):
        fixture = ReleaseFixture()
        for blob_id, raw_sha, size in (
            ("a" * 40, fixture.raw_sha, len(fixture.raw)),
            (fixture.blob_id, "b" * 64, len(fixture.raw)),
            (None, fixture.raw_sha, len(fixture.raw)),
            (fixture.blob_id, None, len(fixture.raw)),
            (fixture.blob_id, fixture.raw_sha, len(fixture.raw) + 1),
        ):
            with self.subTest(blob_id=blob_id, raw_sha=raw_sha, size=size):
                with self.assertRaisesRegex(ValueError, "raw input and Git blob digests"):
                    ASSETS["verify_input_blob"](fixture.raw, blob_id, raw_sha, size)


if __name__ == "__main__":
    unittest.main()
