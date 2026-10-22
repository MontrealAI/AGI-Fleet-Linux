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
        snapshots = {name: json.loads((self.base / 'input/metadata' / (name + '.json')).read_bytes())
            for name in ('run', 'jobs', 'artifacts', 'checkout-commit', 'public-commit')}
        self.snapshots = snapshots
        self.metadata = {'run': snapshots['run'], 'job': snapshots['jobs']['jobs'][0],
            'artifact': snapshots['artifacts']['artifacts'][0], 'checkoutCommit': snapshots['checkout-commit'],
            'acceptedCommit': snapshots['public-commit'], 'jobs': snapshots['jobs'], 'artifacts': snapshots['artifacts']}

    def api(self, binding=None, metadata=None):
        binding, metadata = binding or self.binding, metadata or self.metadata
        return {f'/actions/workflows/{binding["workflowId"]}': {'id': binding['workflowId'], 'path': original.WORKFLOW},
            f'/actions/runs/{binding["runId"]}': metadata["run"],
            '/git/commits/' + binding["acceptedCommit"]: metadata["acceptedCommit"],
            '/git/commits/' + binding["checkoutCommit"]: metadata["checkoutCommit"],
            f'/actions/runs/{binding["runId"]}/attempts/{binding["runAttempt"]}/jobs?per_page=100&page=1': metadata['jobs'],
            f'/actions/runs/{binding["runId"]}/artifacts?per_page=100&page=1': metadata['artifacts']}.__getitem__

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
        api, read_body, configured, objects, calls = self.public_api()
        self.assertEqual(set(original.METADATA), {'metadata/' + name + '.json' for name in
            ('run', 'jobs', 'artifacts', 'checkout-commit', 'public-commit')})
        self.assertIn('discovery-continuation/fleet-native/native-proof.json', original.MEMBERS)
        self.assertEqual(len(original.MEMBERS), 11)
        output = self.base / 'public-read-capture'
        binding, _ = original.fetch_capture(api, read_body, json.dumps(configured), self.alpha, output)
        self.assertEqual(binding, self.binding)
        for name in (*original.MEMBERS, *original.METADATA, 'CUSTODY.json'):
            self.assertEqual((output / name).read_bytes(), (self.base / 'input' / name).read_bytes())
        self.assertEqual(len(original.captured_entries(output, json.dumps(configured), self.alpha)), 17)
        self.assertTrue(calls)
        self.assertLessEqual(len(calls), 12)
        tree = objects['/git/trees/' + configured['transport']['tree'] + '?recursive=1']
        row = next(row for row in tree['tree'] if row['path'] == 'discovery-input/metadata/run.json')
        row['path'] = 'discovery-input/supplementarymetadata/run.json'
        refused = self.base / 'refused-old-metadata-alias'
        with self.assertRaisesRegex(ValueError, 'exactly the common 17'):
            original.fetch_capture(api, read_body, json.dumps(configured), self.alpha, refused)
        self.assertFalse(refused.exists())

    def test_public_git_blob_tamper_or_incomplete_metadata_refuses(self):
        api, read_body, configured, objects, _ = self.public_api()
        key = next(key for key in objects if key.startswith('raw:'))
        objects[key] = b'x' * len(objects[key])
        with self.assertRaises(ValueError):
            original.fetch_capture(api, read_body, json.dumps(configured), self.alpha, self.base / 'refused-public-capture')
        self.assertFalse((self.base / 'refused-public-capture').exists())
        metadata = {name: (self.base / 'input' / name).read_bytes() for name in original.METADATA}
        jobs = json.loads(metadata['metadata/jobs.json'])
        jobs['total_count'] += 1
        metadata['metadata/jobs.json'] = json.dumps(jobs).encode()
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            original.retained_metadata(metadata, self.binding)

    def replace_public_snapshot(self, objects, configured, name, value):
        """Commit honest inert Git identities for deliberately changed API JSON."""
        path = 'discovery-input/metadata/' + name + '.json'
        raw = json.dumps(value, indent=1).encode()
        objects['raw:' + configured['transport']['commit'] + ':' + path] = raw
        tree = objects['/git/trees/' + configured['transport']['tree'] + '?recursive=1']
        row = next(row for row in tree['tree'] if row['path'] == path)
        row.update(size=len(raw), sha=hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest())

    def test_full_committed_sidecars_match_live_metadata_before_capture_write(self):
        # Ancillary collection members and envelope fields are original API evidence too.
        self.snapshots['jobs']['jobs'].append({'id': 51, 'name': 'ancillary', 'runner_name': 'original runner'})
        self.snapshots['artifacts']['artifacts'].append({'id': 41, 'name': 'ancillary', 'digest': 'original digest'})
        for name in ('jobs', 'artifacts'):
            self.snapshots[name]['total_count'] = 2
            self.snapshots[name]['inventory_note'] = 'original envelope'
            (self.base / 'input/metadata' / (name + '.json')).write_text(json.dumps(self.snapshots[name]))
        api, read_body, configured, objects, _ = self.public_api()
        changes = []
        for name, change in (
            ('run', lambda x: x.update(display_title='modified ancillary run')),
            ('run', lambda x: x.pop('display_title')),
            ('run', lambda x: x['ancillary'].update(enabled=1)),
            ('run', lambda x: x['ancillary']['labels'].reverse()),
            ('jobs', lambda x: x['jobs'][1].update(runner_name='modified ancillary runner')),
            ('jobs', lambda x: x.update(inventory_note='modified envelope')),
            ('jobs', lambda x: x['jobs'].reverse()),
            ('artifacts', lambda x: x['artifacts'][1].update(digest='modified ancillary digest')),
            ('artifacts', lambda x: x.update(inventory_note='modified envelope')),
            ('artifacts', lambda x: x['artifacts'].reverse()),
        ):
            value = copy.deepcopy(self.snapshots[name])
            change(value)
            changes.append({name: value})
        for field, value in (('message', 'modified Git message'), ('verification', {'verified': True, 'reason': 'changed'})):
            # Both same-main commit sidecars can agree with each other yet differ from GitHub.
            changes.append({name: {**copy.deepcopy(self.snapshots[name]), field: value}
                            for name in ('checkout-commit', 'public-commit')})
        for index, changed in enumerate(changes):
            for name, value in self.snapshots.items():
                self.replace_public_snapshot(objects, configured, name, value)
            for name, value in changed.items():
                self.replace_public_snapshot(objects, configured, name, value)
            output = self.base / ('refused-sidecar-' + str(index))
            with self.subTest(changed=changed), self.assertRaisesRegex(ValueError, 'complete live responses'):
                original.fetch_capture(api, read_body, json.dumps(configured), self.alpha, output)
            self.assertFalse(output.exists())

    def test_sidecar_json_formatting_preserved_and_exact_live_routes_bounded(self):
        api, read_body, configured, objects, calls = self.public_api()
        for name, value in self.snapshots.items():
            self.replace_public_snapshot(objects, configured, name, dict(reversed(list(value.items()))))
        output = self.base / 'formatting-capture'
        original.fetch_capture(api, read_body, json.dumps(configured), self.alpha, output)
        for name in original.METADATA:
            self.assertEqual((output / name).read_bytes(),
                objects['raw:' + configured['transport']['commit'] + ':discovery-input/' + name])
        for route in ('/actions/runs/10', '/actions/runs/10/attempts/2/jobs?per_page=100&page=1',
                      '/actions/runs/10/artifacts?per_page=100&page=1'):
            self.assertEqual(calls.count(route), 2)
        self.assertEqual(calls.count('/git/commits/' + self.alpha['commit']), 1)
        self.assertFalse(any(route.startswith('/actions/artifacts/') for route in calls))
        self.assertLessEqual(len(calls), 12)

    def test_full_mutable_metadata_is_freshly_rechecked_before_capture_write(self):
        api, read_body, configured, _, _ = self.public_api()
        for index, route in enumerate(('/actions/runs/10', '/actions/runs/10/attempts/2/jobs?per_page=100&page=1',
                                       '/actions/runs/10/artifacts?per_page=100&page=1')):
            count = 0
            def changing_api(actual):
                nonlocal count
                value = copy.deepcopy(api(actual))
                if actual == route:
                    count += 1
                    if count == 2:
                        value['ancillary_change'] = 'changed after initial observation'
                return value
            output = self.base / ('refused-live-change-' + str(index))
            with self.subTest(route=route), self.assertRaisesRegex(ValueError, 'changed during capture'):
                original.fetch_capture(changing_api, read_body, json.dumps(configured), self.alpha, output)
            self.assertFalse(output.exists())

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
