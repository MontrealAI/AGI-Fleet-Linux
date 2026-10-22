# SPDX-License-Identifier: Apache-2.0
"""Actual Git/config and saved-byte boundary checks; not native pilot evidence."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest import mock

MODULE = Path(__file__).resolve().parents[1] / "discovery_release.py"
spec = importlib.util.spec_from_file_location("discovery_release", MODULE)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
ROOT = MODULE.parent.parent
sys.path.insert(0, str(MODULE.parent))
import discovery_alpha_input as original_input
import discovery_input_fixture


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True, stderr=subprocess.PIPE).strip()


def repository(root):
    root.mkdir()
    git(root, "init", "-q")
    git(root, "config", "user.email", "fixture@example.invalid")
    git(root, "config", "user.name", "Offline fixture")


def commit(root):
    git(root, "add", ".")
    git(root, "commit", "-qm", "Bounded offline fixture")


class InstalledProfile(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)

    def prepare(self):
        alpha, fleet = self.base / "alpha", self.base / "fleet"
        repository(alpha)
        for name in ("workspace.mjs", "discovery-lab-history.mjs", "discovery-lab-inspector.mjs"):
            path = alpha / "examples/successor-capability" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("// Inert package boundary fixture; not a native executor.\n")
        shutil.copyfile(ROOT / "discovery-lab/contract.mjs", alpha / "examples/successor-capability/discovery-lab-contract.mjs")
        shutil.copyfile(ROOT / "discovery-lab/release/LICENSE-APACHE-2.0.txt", alpha / "LICENSE")
        sources = {path.relative_to(alpha).as_posix(): release.sha(path.read_bytes())
                   for path in (alpha / "examples/successor-capability").glob("*.mjs")}
        source_hash = release.sha(json.dumps(sources, sort_keys=True, separators=(",", ":")).encode())
        catalog = alpha / "docs/successor/capabilities/sources.json"
        catalog.parent.mkdir(parents=True)
        catalog.write_text(json.dumps({"sourceHash": source_hash, "sources": sources}))
        (catalog.parent / "index.html").write_text("<!doctype html><title>Inert source page</title>\n")
        commit(alpha)
        files = {name: {"sha256": release.sha((alpha / name).read_bytes()), "gitBlob": git(alpha, "rev-parse", "HEAD:" + name), "mode": "100644"}
                 for name in [*sources, "docs/successor/capabilities/sources.json", "docs/successor/capabilities/index.html", "LICENSE"]}
        profile = json.loads((ROOT / "discovery-lab/release/profile.json").read_bytes())
        profile.update(qualification="FROZEN_SOURCE_PROFILE", alpha={"commit": git(alpha, "rev-parse", "HEAD"),
                       "tree": git(alpha, "rev-parse", "HEAD^{tree}"), "sourceHash": source_hash, "files": files,
                       "sharedContractSha256": release.sha((ROOT / "discovery-lab/contract.mjs").read_bytes())})
        repository(fleet)
        for name in release.FLEET_FILES:
            target = fleet / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        (fleet / "discovery-lab/release/profile.json").write_text(json.dumps(profile))
        input_profile = discovery_input_fixture.prepare(original_input, self.base, profile["alpha"])
        (fleet / "discovery-lab/release/mission-input.json").write_text(json.dumps(input_profile))
        commit(fleet)
        return fleet, alpha

    def assert_config_refuses_before_source_operations(self, fleet, alpha):
        original = release.git

        def inert_guard(root, *args):
            self.assertNotIn(args[0], {"status", "diff", "archive", "fetch", "clone", "pull", "ls-remote"},
                             "Rejected configuration must not reach a source operation")
            return original(root, *args)

        with mock.patch.object(release, "git", side_effect=inert_guard):
            with self.assertRaisesRegex(ValueError, "Unsafe local Git"):
                release.build(self.base / "candidate", alpha, root=fleet, mission_input=self.base / "input")
        self.assertFalse((self.base / "candidate").exists())

    def test_unfrozen_profile_refuses_before_output_creation(self):
        fleet, alpha = self.prepare()
        profile_path = fleet / "discovery-lab/release/profile.json"
        profile = json.loads(profile_path.read_bytes())
        profile.update(qualification="PENDING_FINAL_ALPHA_PIN", alpha=None)
        profile_path.write_text(json.dumps(profile))
        target = self.base / "candidate"
        with self.assertRaisesRegex(ValueError, "not frozen"):
            release.build(target, alpha, root=fleet, mission_input=self.base / "input")
        self.assertFalse(target.exists())

    def pending_profile(self, fleet):
        profile_path = fleet / "discovery-lab/release/profile.json"
        profile = json.loads(profile_path.read_bytes())
        profile.update(qualification="PENDING_FINAL_ALPHA_PIN", alpha=None)
        profile_path.write_text(json.dumps(profile))
        commit(fleet)
        return profile_path

    def test_freeze_records_source_identity_without_claiming_installed_qualification(self):
        fleet, alpha = self.prepare()
        profile_path = self.pending_profile(fleet)
        result = release.freeze_source(alpha, git(alpha, "rev-parse", "HEAD"), root=fleet)
        profile = json.loads(profile_path.read_bytes())
        self.assertEqual(profile["qualification"], "FROZEN_SOURCE_PROFILE")
        self.assertEqual(profile["alpha"]["commit"], git(alpha, "rev-parse", "HEAD"))
        self.assertIn("discovery-lab-inspector.mjs", " ".join(profile["alpha"]["files"]))
        self.assertEqual(result["qualification"], "source-profile-only; saved-native-and-release-gates-pending")
        self.assertEqual(profile["publication"], "HELD")
        self.assertFalse(profile["productionQualified"])
        self.assertIn("LICENSE", profile["alpha"]["files"])

    def test_freeze_wrong_reviewed_commit_preserves_pending_profile(self):
        fleet, alpha = self.prepare()
        profile_path = self.pending_profile(fleet)
        original = profile_path.read_bytes()
        with self.assertRaisesRegex(ValueError, "identity differs"):
            release.freeze_source(alpha, "0" * 40, root=fleet)
        self.assertEqual(profile_path.read_bytes(), original)

    def test_freeze_cannot_overwrite_an_existing_frozen_profile(self):
        fleet, alpha = self.prepare()
        original = (fleet / "discovery-lab/release/profile.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "pending source profile"):
            release.freeze_source(alpha, git(alpha, "rev-parse", "HEAD"), root=fleet)
        self.assertEqual((fleet / "discovery-lab/release/profile.json").read_bytes(), original)

    def test_installed_capture_regressions(self):
        node = shutil.which("node")
        self.assertIsNotNone(node, "Node is required for the installed capture boundaries")
        result = subprocess.run([node, "--test", "discovery-lab/release/installed-review.test.mjs"],
                                cwd=ROOT, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_actual_nested_copy_is_not_a_git_root(self):
        parent = self.base / "parent"
        repository(parent)
        (parent / "readme").write_text("fixture")
        commit(parent)
        nested = parent / "copied-alpha"
        nested.mkdir()
        with self.assertRaisesRegex(ValueError, "worktree root"):
            release.clean_git_root(nested)

    def test_local_clean_filter_is_refused_before_status_can_execute_it(self):
        fleet, alpha = self.prepare()
        (fleet / ".gitattributes").write_text("LICENSE filter=probe\n")
        commit(fleet)
        git(fleet, "config", "filter.probe.clean", "inert-not-executed")
        self.assert_config_refuses_before_source_operations(fleet, alpha)

    def test_worktree_specific_filter_is_refused_before_status(self):
        fleet, alpha = self.prepare()
        (fleet / ".gitattributes").write_text("LICENSE filter=probe\n")
        commit(fleet)
        git(fleet, "config", "extensions.worktreeConfig", "true")
        git(fleet, "config", "--worktree", "filter.probe.clean", "inert-not-executed")
        self.assert_config_refuses_before_source_operations(fleet, alpha)

    def test_disabled_ignored_regular_worktree_metadata_preserves_clean_checkout(self):
        fleet, alpha = self.prepare()
        git(fleet, "config", "extensions.worktreeConfig", "false")
        (fleet / ".git/config.worktree").write_text("[core]\n sparseCheckout = false\n sparseCheckoutCone = false\n")
        self.assertEqual(release.clean_git_root(fleet)[0], git(fleet, "rev-parse", "HEAD"))
        release.build(self.base / "candidate", alpha, root=fleet, mission_input=self.base / "input")

    def test_checkout_gc_auto_zero_is_inert_and_other_gc_configuration_refuses(self):
        fleet, alpha = self.prepare()
        git(fleet, "config", "gc.auto", "0")
        release.clean_git_root(fleet)
        original_config = (fleet / '.git/config').read_text()
        for stanza in ('[gc]\nauto\n', '[gc]\nauto=1\n', '[gc]\nauto=-1\n', '[gc]\nauto="0"\n',
                       '[gc]\nauto=0\nauto=1\n', '[gc]\nauto=0\npruneExpire=now\n', '[gc "other"]\nauto=0\n',
                       '[gc]\nauto=0\n[GC]\nauto=0\n', '[gc]\nauto=0\n  continued\n', '[gc]\nauto=00\n'):
            config = original_config[:original_config.lower().index('[gc]')] + stanza
            (fleet / '.git/config').write_text(config)
            with self.subTest(stanza=stanza), self.assertRaisesRegex(ValueError, 'Unsafe local Git'):
                release.audit_worktree_config(fleet / '.git')

    def test_worktree_activation_is_rejected_before_any_git_call(self):
        fleet, _ = self.prepare()
        config = fleet / ".git/config"
        original = config.read_text()
        for value in ("worktreeConfig = true", "worktreeConfig", "worktreeConfig false", "worktreeConfig = unknown",
                      "worktreeConfig = false\\\n true"):
            with self.subTest(value=value):
                config.write_text(original + "\n[extensions]\n " + value + "\n")
                with mock.patch.object(release, "git", side_effect=AssertionError("Must refuse before any Git call")):
                    with self.assertRaisesRegex(ValueError, "Unsafe local Git worktree"):
                        release.clean_git_root(fleet)

    def test_ignored_worktree_metadata_must_be_regular_and_bounded(self):
        fleet, _ = self.prepare()
        path = fleet / ".git/config.worktree"
        path.write_bytes(b" " * 64_001)
        with mock.patch.object(release, "git", side_effect=AssertionError("Must refuse before any Git call")):
            with self.assertRaisesRegex(ValueError, "Unsafe local Git metadata"):
                release.clean_git_root(fleet)

    def test_included_filter_is_refused_before_actual_build_status(self):
        fleet, alpha = self.prepare()
        (fleet / ".gitattributes").write_text("LICENSE filter=probe\n")
        commit(fleet)
        config = fleet / ".git/extra-filter-config"
        config.write_text('[filter "probe"]\nclean = inert-not-executed\n')
        git(fleet, "config", "include.path", str(config))
        self.assert_config_refuses_before_source_operations(fleet, alpha)

    def test_build_does_not_invoke_a_configured_remote(self):
        fleet, alpha = self.prepare()
        git(fleet, "config", "remote.origin.url", "https://example.invalid/not-contacted")
        original = release.git

        def local_only(root, *args):
            self.assertNotIn(args[0], {"fetch", "clone", "pull", "ls-remote"})
            return original(root, *args)

        with mock.patch.object(release, "git", side_effect=local_only):
            release.build(self.base / "candidate", alpha, root=fleet, mission_input=self.base / "input")

    def test_untracked_packaged_runtime_cannot_claim_head_source(self):
        fleet, alpha = self.prepare()
        name = "discovery-lab/release/installed-review.mjs"
        git(fleet, "rm", "--cached", name)
        git(fleet, "commit", "-qm", "Remove declared executable from source")
        with self.assertRaises(subprocess.CalledProcessError):
            release.build(self.base / "candidate", alpha, root=fleet, mission_input=self.base / "input")
        self.assertFalse((self.base / "candidate").exists())

    def altered_alpha(self, alpha):
        name = "examples/successor-capability/workspace.mjs"
        (alpha / name).write_text("// Altered inert source fixture, never executed.\nexport const changed=true;\n")
        catalog_name = "docs/successor/capabilities/sources.json"
        catalog_path = alpha / catalog_name
        catalog = json.loads(catalog_path.read_bytes())
        catalog["sources"][name] = release.sha((alpha / name).read_bytes())
        catalog["sourceHash"] = release.sha(json.dumps(catalog["sources"], sort_keys=True, separators=(",", ":")).encode())
        catalog_path.write_text(json.dumps(catalog))
        return name, catalog_name, catalog

    def test_assume_unchanged_and_inconsistent_sha_map_cannot_relabel_raw_bytes(self):
        fleet, alpha = self.prepare()
        name, catalog_name, catalog = self.altered_alpha(alpha)
        git(alpha, "update-index", "--assume-unchanged", name, catalog_name)
        self.assertEqual(git(alpha, "status", "--porcelain", "--untracked-files=no"), "")
        profile_path = fleet / "discovery-lab/release/profile.json"
        profile = json.loads(profile_path.read_bytes())
        profile["alpha"]["sourceHash"] = catalog["sourceHash"]
        for relative, binding in profile["alpha"]["files"].items():
            binding["sha256"] = release.sha((alpha / relative).read_bytes())
        profile_path.write_text(json.dumps(profile))
        commit(fleet)
        with self.assertRaisesRegex(ValueError, "Alpha source differs"):
            release.build(self.base / "candidate", alpha, root=fleet, mission_input=self.base / "input")
        self.assertFalse((self.base / "candidate").exists())

    def test_local_replacement_objects_cannot_change_original_commit_tree(self):
        fleet, alpha = self.prepare()
        profile_path = fleet / "discovery-lab/release/profile.json"
        profile = json.loads(profile_path.read_bytes())
        original = profile["alpha"]["commit"]
        _, _, catalog = self.altered_alpha(alpha)
        commit(alpha)
        replacement = git(alpha, "rev-parse", "HEAD")
        git(alpha, "replace", original, replacement)
        git(alpha, "reset", "--hard", original)
        profile["alpha"]["tree"] = git(alpha, "rev-parse", "HEAD^{tree}")
        profile["alpha"]["sourceHash"] = catalog["sourceHash"]
        for relative, binding in profile["alpha"]["files"].items():
            binding["sha256"] = release.sha((alpha / relative).read_bytes())
            binding["gitBlob"] = git(alpha, "rev-parse", "HEAD:" + relative)
        profile_path.write_text(json.dumps(profile))
        commit(fleet)
        self.assertEqual(git(alpha, "rev-parse", "HEAD"), original)
        with self.assertRaises(ValueError):
            release.build(self.base / "candidate", alpha, root=fleet, mission_input=self.base / "input")
        self.assertFalse((self.base / "candidate").exists())
        self.assertEqual(release.git_environment()["GIT_NO_REPLACE_OBJECTS"], "1")

    def test_git_environment_cannot_redirect_the_selected_root(self):
        fleet, alpha = self.prepare()
        previous = os.environ.get("GIT_WORK_TREE")
        os.environ["GIT_WORK_TREE"] = str(alpha)
        try:
            self.assertEqual(release.clean_git_root(fleet)[0], git(fleet, "rev-parse", "HEAD"))
        finally:
            if previous is None:
                os.environ.pop("GIT_WORK_TREE")
            else:
                os.environ["GIT_WORK_TREE"] = previous

    def test_saved_archive_all_bytes_modes_and_inactive_install(self):
        fleet, alpha = self.prepare()
        receipt = release.build(self.base / "candidate", alpha, root=fleet, mission_input=self.base / "input")
        archive = self.base / "candidate" / receipt["archive"]
        installed = self.base / "inactive"
        result = release.install(archive, installed, receipt["sha256"])
        self.assertEqual(result["startedServices"], 0)
        self.assertEqual(result["authority"], "none")
        self.assertEqual((installed / "alpha/LICENSE").read_bytes(),
                         (installed / "discovery-lab/release/LICENSE-APACHE-2.0.txt").read_bytes())
        manifest = json.loads((installed / release.MANIFEST).read_bytes())
        for row in manifest["files"]:
            path = installed / row["path"]
            self.assertEqual(release.sha(path.read_bytes()), row["sha256"])
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), row["mode"])
        with self.assertRaisesRegex(ValueError, "absent"):
            release.install(archive, installed, receipt["sha256"])

    def mutate_archive(self, transform):
        fleet, alpha = self.prepare()
        receipt = release.build(self.base / "candidate", alpha, root=fleet, mission_input=self.base / "input")
        source = self.base / "candidate" / receipt["archive"]
        target = self.base / "mutated.zip"
        with zipfile.ZipFile(source) as z, zipfile.ZipFile(target, "w") as out:
            for info in z.infolist():
                transformed = transform(info, z.read(info))
                for item, data in transformed:
                    out.writestr(item, data)
        return target

    def test_missing_source_member_is_refused_before_destination_creation(self):
        archive = self.mutate_archive(lambda info, data: [] if info.filename.endswith("/receiver.mjs") else [(info, data)])
        destination = self.base / "must-stay-absent"
        with self.assertRaisesRegex(ValueError, "membership"):
            release.install(archive, destination, release.sha(archive.read_bytes()))
        self.assertFalse(destination.exists())

    def test_duplicate_archive_entry_is_refused(self):
        archive = self.mutate_archive(lambda info, data: [(info, data), (info, data)] if info.filename.endswith("/receiver.mjs") else [(info, data)])
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            release.install(archive, self.base / "inactive", release.sha(archive.read_bytes()))

    def test_wrong_archive_checksum_is_refused(self):
        fleet, alpha = self.prepare()
        receipt = release.build(self.base / "candidate", alpha, root=fleet, mission_input=self.base / "input")
        with self.assertRaisesRegex(ValueError, "checksum"):
            release.install(self.base / "candidate" / receipt["archive"], self.base / "inactive", "0" * 64)

    def test_archive_root_dot_refuses_before_destination_creation(self):
        def transform(info, data):
            if info.filename == release.PREFIX + "/LICENSE":
                info.filename = release.PREFIX + "/."
            if info.filename.endswith("/" + release.MANIFEST):
                manifest = json.loads(data)
                for row in manifest["files"]:
                    if row["path"] == "LICENSE":
                        row["path"] = "."
                data = json.dumps(manifest).encode()
            return [(info, data)]

        archive = self.mutate_archive(transform)
        destination = self.base / "must-stay-absent"
        with self.assertRaisesRegex(ValueError, "Unsafe package member"):
            release.install(archive, destination, release.sha(archive.read_bytes()))
        self.assertFalse(destination.exists())

    def test_conflicting_file_paths_refuse_before_destination_creation(self):
        def transform(info, data):
            if info.filename.endswith("/receiver.mjs"):
                info.filename = release.PREFIX + "/LICENSE/child"
            if info.filename.endswith("/" + release.MANIFEST):
                manifest = json.loads(data)
                for row in manifest["files"]:
                    if row["path"] == "discovery-lab/receiver.mjs":
                        row["path"] = "LICENSE/child"
                data = json.dumps(manifest).encode()
            return [(info, data)]

        archive = self.mutate_archive(transform)
        destination = self.base / "must-stay-absent"
        with self.assertRaisesRegex(ValueError, "file paths conflict"):
            release.install(archive, destination, release.sha(archive.read_bytes()))
        self.assertFalse(destination.exists())

    def test_inert_unsafe_member_names_refuse_before_filesystem_use(self):
        for name in (".", "../outside", "/outside", "directory\\outside", "nul\0name", "./not-canonical", "a//b"):
            with self.subTest(name=repr(name)):
                with self.assertRaises(ValueError):
                    release.safe_name(name)

    def test_git_object_lookups_cannot_lazily_fetch_or_use_external_protocols(self):
        environment = release.git_environment()
        self.assertEqual(environment["GIT_NO_REPLACE_OBJECTS"], "1")
        self.assertEqual(environment["GIT_NO_LAZY_FETCH"], "1")
        self.assertEqual(environment["GIT_ALLOW_PROTOCOL"], "")
        self.assertEqual(environment["GIT_TERMINAL_PROMPT"], "0")

    def test_source_change_refuses_saved_build(self):
        fleet, alpha = self.prepare()
        (alpha / "examples/successor-capability/workspace.mjs").write_text("// changed\n")
        with self.assertRaisesRegex(ValueError, "unchanged"):
            release.build(self.base / "candidate", alpha, root=fleet, mission_input=self.base / "input")

    def test_oversized_inert_source_refuses_before_descriptor_read(self):
        source = self.base / "inert.txt"
        source.write_bytes(b" " * (release.MAX_MEMBER + 1))
        with mock.patch.object(release.os, "read", side_effect=AssertionError("Must refuse before reading")):
            with self.assertRaisesRegex(ValueError, "bounded regular"):
                release.regular_bytes(self.base, source.name)

    def test_changed_inert_metadata_refuses_owned_descriptor_capture(self):
        source = self.base / "inert.txt"
        source.write_bytes(b"ordinary captured data\n")
        before = os.stat(source)
        after = mock.Mock(**{key: getattr(before, key)
                             for key in ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns")})
        after.st_ctime_ns += 1
        with mock.patch.object(release.os, "fstat", side_effect=[before, after]):
            with self.assertRaisesRegex(ValueError, "changed during"):
                release.regular_bytes(self.base, source.name)


if __name__ == "__main__":
    unittest.main()
