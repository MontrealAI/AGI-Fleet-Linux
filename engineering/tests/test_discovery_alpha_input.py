# SPDX-License-Identifier: Apache-2.0
"""Inert original-artifact custody fixtures; no browser, network or native claim."""
import copy
import base64
import hashlib
import json
import io
from pathlib import Path
import unittest
import zipfile
from unittest import mock

import test_discovery_installed_profile as packaging

original = packaging.original_input


class AlphaOriginalInput(unittest.TestCase):
    def setUp(self):
        builder = packaging.InstalledProfile("runTest")
        builder.setUp()
        self.addCleanup(builder.doCleanups)
        self.fleet, _ = builder.prepare()
        self.base = builder.base
        self.alpha = json.loads((self.fleet / "discovery-lab/release/profile.json").read_bytes())["alpha"]
        self.raw_profile = (self.fleet / "discovery-lab/release/mission-input.json").read_bytes()
        self.custody = json.loads((self.base / "input/CUSTODY.json").read_bytes())
        self.binding = original.binding(self.custody, self.alpha)
        snapshots = {name: json.loads((self.base / 'input/supplementarymetadata' / (name + '.json')).read_bytes())
            for name in ('run', 'jobs', 'artifacts', 'checkout-commit', 'public-commit')}
        self.metadata = {'run': snapshots['run'], 'job': snapshots['jobs']['jobs'][0],
            'artifact': snapshots['artifacts']['artifacts'][0], 'checkoutCommit': snapshots['checkout-commit'],
            'acceptedCommit': snapshots['public-commit']}

    def api(self, binding=None, metadata=None):
        binding, metadata = binding or self.binding, metadata or self.metadata
        return {f'/actions/workflows/{binding["workflowId"]}': {'id': binding['workflowId'], 'path': original.WORKFLOW},
            f'/actions/runs/{binding["runId"]}/attempts/{binding["runAttempt"]}': metadata["run"],
            '/git/commits/' + binding["acceptedCommit"]: metadata["acceptedCommit"],
            '/git/commits/' + binding["checkoutCommit"]: metadata["checkoutCommit"],
            f'/actions/runs/{binding["runId"]}/attempts/{binding["runAttempt"]}/jobs?per_page=100': {"total_count": 1, "jobs": [metadata["job"]]},
            f'/actions/artifacts/{binding["artifactId"]}': metadata["artifact"]}.__getitem__

    def test_original_raw_inputs_survive_capture_and_package_inventory(self):
        original.profile(self.raw_profile)
        binding = original.binding(self.custody, self.alpha)
        self.assertEqual(original.authenticated_metadata(self.api(), binding), self.metadata)
        entries = original.captured_entries(self.base / "input", self.raw_profile, self.alpha)
        self.assertEqual(len(entries), len(original.MEMBERS) + len(original.METADATA) + 1)
        self.assertEqual(entries["mission-input/" + original.PREFIX + "fleet-browser-workspace.json"],
                         entries["mission-input/" + original.PREFIX + "jobs-browser-workspace.json"])

    def test_unset_and_source_or_page_reanchoring_refuse(self):
        with self.assertRaisesRegex(ValueError, "UNSET"):
            original.profile((packaging.ROOT / "discovery-lab/release/mission-input.json").read_bytes(), self.alpha)
        for key in ("sourceHash", "pageSha256", "catalogSha256"):
            changed = copy.deepcopy(self.custody)
            changed[key] = "0" * 64
            with self.subTest(key=key), self.assertRaises(ValueError):
                original.binding(changed, self.alpha)

    def test_pr_synthetic_checkout_is_not_a_final_main_artifact(self):
        for key, value in (("event", "pull_request"), ("headBranch", "feature"), ("checkoutTree", "0" * 40),
                           ("headCommit", "d" * 40)):
            changed = copy.deepcopy(self.custody)
            changed["producer"][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "final main"):
                original.binding(changed, self.alpha)

    def test_wrong_attempt_missing_step_and_stale_artifact_refuse(self):
        mutations = (("run", "run_attempt", 1), ("run", "conclusion", "failure"),
                     ("artifact", "created_at", "2026-10-21T00:00:00Z"),
                     ("artifact", "digest", "sha256:" + "0" * 64))
        for section, key, value in mutations:
            metadata = copy.deepcopy(self.metadata)
            metadata[section][key] = value
            with self.subTest(section=section, key=key), self.assertRaises(ValueError):
                original.authenticated_metadata(self.api(metadata=metadata), self.binding)
        metadata = copy.deepcopy(self.metadata)
        metadata["job"]["steps"].pop()
        with self.assertRaisesRegex(ValueError, "step"):
            original.authenticated_metadata(self.api(metadata=metadata), self.binding)

    def test_outer_sha_member_change_and_different_workspace_refuse(self):
        changed = json.loads(self.raw_profile)
        changed['transport']['custodySha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, "pinned Git bytes"):
            original.captured_entries(self.base / "input", json.dumps(changed), self.alpha)
        target = self.base / "input" / original.PREFIX / "jobs-browser-workspace.json"
        target.write_text('{"missionId":"different inert mission"}')
        with self.assertRaisesRegex(ValueError, "original member bytes"):
            original.captured_entries(self.base / "input", self.raw_profile, self.alpha)

    def test_saved_member_journal_cannot_claim_another_mission(self):
        files = {name: (self.base / "input" / name).read_bytes() for name in original.MEMBERS}
        name = original.PREFIX + "browser-native-requests.json"
        journal = json.loads(files[name])
        journal["missionId"] = "another inert mission"
        files[name] = json.dumps(journal).encode()
        binding = copy.deepcopy(self.binding)
        binding["members"][name] = {"bytes": len(files[name]), "sha256": original.release.sha(files[name])}
        with self.assertRaisesRegex(ValueError, "mission journal"):
            original.validate_members(files, binding, self.alpha)

    def test_semantically_equal_served_catalog_with_different_raw_bytes_refuses(self):
        files = {name: (self.base / 'input' / name).read_bytes() for name in original.MEMBERS}
        name = original.PREFIX + 'served/sources.json'
        before = files[name]
        files[name] += b' \n'
        self.assertEqual(json.loads(before), json.loads(files[name]))
        custody = copy.deepcopy(self.custody)
        row = {'bytes': len(files[name]), 'sha256': original.release.sha(files[name])}
        custody['inventory'][name] = row
        custody['members'][name] = row
        binding = original.binding(custody, self.alpha)
        with self.assertRaisesRegex(ValueError, 'catalog raw bytes'):
            original.validate_members(files, binding, self.alpha)

    def public_api(self):
        objects = {}
        repository = self.base / 'public-evidence'
        packaging.repository(repository)
        for name in (*original.MEMBERS, *original.METADATA, 'CUSTODY.json'):
            target = repository / 'discovery-input' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((self.base / 'input' / name).read_bytes())
        packaging.commit(repository)
        def save_tree(repository, commit, tree):
            rows = []
            for record in packaging.git(repository, 'ls-tree', '-r', '-t', '-z', tree).split('\0'):
                if not record:
                    continue
                header, name = record.split('\t')
                mode, kind, identity = header.split()
                row = {'path': name, 'mode': mode, 'type': kind, 'sha': identity}
                if kind == 'blob':
                    data = __import__('subprocess').check_output(['git', '-C', str(repository), 'cat-file', 'blob', identity])
                    row['size'] = len(data)
                    objects['raw:' + commit + ':' + name] = data
                rows.append(row)
            objects['/git/trees/' + tree + '?recursive=1'] = {'sha': tree, 'truncated': False, 'tree': rows}
        tree = packaging.git(repository, 'rev-parse', 'HEAD^{tree}')
        configured = json.loads(self.raw_profile)
        configured['transport']['tree'] = tree
        save_tree(repository, configured['transport']['commit'], tree)
        save_tree(self.base / 'alpha', self.alpha['commit'], self.alpha['tree'])
        objects['/git/commits/' + configured['transport']['commit']] = {'sha': configured['transport']['commit'], 'tree': {'sha': tree}}
        calls = []
        def api(route):
            calls.append(route)
            self.assertNotIn('/zip', route)
            self.assertNotIn('/git/blobs/', route)
            return objects[route] if route in objects else self.api()(route)
        def read_body(commit, name, maximum):
            raw = objects['raw:' + commit + ':' + name]
            self.assertLessEqual(len(raw), maximum)
            return raw
        return api, read_body, configured, objects, calls

    def test_public_git_packet_captures_exact_original17_without_actions_zip(self):
        api, read_body, configured, _, calls = self.public_api()
        output = self.base / 'public-read-capture'
        binding, _ = original.fetch_capture(api, read_body, json.dumps(configured), self.alpha, output)
        self.assertEqual(binding, self.binding)
        for name in (*original.MEMBERS, *original.METADATA, 'CUSTODY.json'):
            self.assertEqual((output / name).read_bytes(), (self.base / 'input' / name).read_bytes())
        self.assertEqual(len(original.captured_entries(output, json.dumps(configured), self.alpha)), 17)
        self.assertTrue(calls)
        self.assertLessEqual(len(calls), 12)

    def test_public_git_blob_tamper_or_incomplete_metadata_refuses(self):
        api, read_body, configured, objects, _ = self.public_api()
        key = next(key for key in objects if key.startswith('raw:'))
        objects[key] = b'x' * len(objects[key])
        with self.assertRaises(ValueError):
            original.fetch_capture(api, read_body, json.dumps(configured), self.alpha, self.base / 'refused-public-capture')
        self.assertFalse((self.base / 'refused-public-capture').exists())
        metadata = {name: (self.base / 'input' / name).read_bytes() for name in original.METADATA}
        jobs = json.loads(metadata['supplementarymetadata/jobs.json'])
        jobs['total_count'] += 1
        metadata['supplementarymetadata/jobs.json'] = json.dumps(jobs).encode()
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            original.retained_metadata(metadata, self.binding)

    def test_raw_transport_is_immutable_bounded_get_without_credentials(self):
        opener = mock.Mock()
        opener.open.side_effect = [io.BytesIO(b'raw'), io.BytesIO(b'oversized')]
        with mock.patch.object(original.urllib.request, 'build_opener', return_value=opener):
            transport = original.ReadOnlyGitHub()
            self.assertEqual(transport.raw('a' * 40, 'packet/space name.json', 3), b'raw')
            with self.assertRaisesRegex(ValueError, 'exceeds bound'):
                transport.raw('a' * 40, 'packet/space name.json', 3)
        for call in opener.open.call_args_list:
            request = call.args[0]
            self.assertEqual(request.get_method(), 'GET')
            self.assertEqual(request.full_url, 'https://raw.githubusercontent.com/' + original.REPOSITORY
                             + '/' + 'a' * 40 + '/packet/space%20name.json')
            self.assertFalse(any(key.lower() == 'authorization' for key, _ in request.header_items()))
