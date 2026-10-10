"""Evidence tampering, incomplete-native and immutable-publication regressions."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

MACOS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MACOS))
spec = importlib.util.spec_from_file_location('macos_audit_tests', MACOS / 'audit.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
spec = importlib.util.spec_from_file_location('macos_publish_tests', MACOS / 'publish.py')
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)

COMMIT = 'a' * 40
RUN = '12345'


def tap(cases=1):
    return ('TAP version 13\n' + ''.join(f'ok {index} - case {index}\n' for index in range(1, cases + 1))
            + f'1..{cases}\n# tests {cases}\n# suites 0\n# pass {cases}\n# fail 0\n'
            '# cancelled 0\n# skipped 0\n# todo 0\n').encode()


class TapAuditTests(unittest.TestCase):
    def test_complete_case_inventory(self):
        self.assertEqual(audit.parse_tap(tap(3))['tests'], 3)

    def test_truncation_and_ambiguous_summary_fail(self):
        for value in (tap()[:30], tap() + b'# tests 1\n', tap().replace(b'1..1', b'1..2')):
            with self.subTest(value=value), self.assertRaises(ValueError):
                audit.parse_tap(value)

    def test_failed_skipped_todo_aborted_and_fabricated_counts_fail(self):
        values = [tap().replace(b'ok 1 - case 1', marker) for marker in
                  (b'not ok 1 - case 1', b'ok 1 - case 1 # SKIP', b'ok 1 - case 1 # TODO')]
        values += [tap() + b'Bail out! interrupted\n', tap().replace(b'# tests 1', b'# tests 4000').replace(b'# pass 1', b'# pass 4000')]
        for value in values:
            with self.subTest(value=value), self.assertRaises(ValueError):
                audit.parse_tap(value)

    def test_duplicate_json_keys_fail(self):
        with self.assertRaises(ValueError):
            audit.decode_json('{"status":"NOT_PASS","status":"PASS"}')

    def test_nested_suites_are_counted_without_becoming_tests(self):
        data = (b'TAP version 13\n    ok 1 - first\n    ok 2 - second\n    1..2\n'
                b'ok 1 - suite\n1..1\n# tests 2\n# suites 1\n# pass 2\n# fail 0\n'
                b'# cancelled 0\n# skipped 0\n# todo 0\n')
        self.assertEqual(audit.parse_tap(data)['tests'], 2)


class CompleteEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.file = 'tests/complete.test.mjs'
        self.source = {self.file: 'a' * 64}
        self.tree = {self.file: {'sha256': 'a' * 64, 'mode': 420}}
        self.node = {'executableSHA256': 'b' * 64}
        self.fixture = {'historical': [{'role': 'agent', 'manifestSHA256': 'c' * 64}]}
        self.data = tap(3898)
        (self.root / 'complete.tap').write_bytes(self.data)
        counts = audit.parse_tap(self.data)
        self.prerequisites = {'node': {'version': 'v24.21.0', 'sha256': 'b' * 64},
                              'unixSocket': {'available': True},
                              'openclaw': {'version': '2026.9.5', 'verifiedFiles': 200},
                              'historical': [{**self.fixture['historical'][0], 'verifiedFiles': 100}]}
        self.result = {'schema': 'agi-full-regressions/v1', 'status': 'PASS', 'scope': 'FULL',
                       'complete': True, 'sourceUnchanged': True, 'retainedLogsUnchanged': True,
                       'testFiles': 1, 'counts': counts, 'prerequisites': self.prerequisites,
                       'results': [{'file': self.file, 'log': 'complete.tap', 'logBytes': len(self.data),
                                    'logSHA256': audit.digest(self.data), 'sourceSHA256': 'a' * 64,
                                    'counts': counts, 'exitCode': 0, 'timedOut': False, 'completeSummary': True}]}
        audit.write_json(self.root / 'tested-source.json', self.source)
        audit.write_json(self.root / 'prerequisites.json', self.prerequisites)

    def tearDown(self):
        self.temporary.cleanup()

    def check(self):
        audit.write_json(self.root / 'results.json', self.result)
        return audit.audit_complete(self.root, self.tree, self.source, {self.file}, self.node, self.fixture)

    def test_complete_bound_logs_pass(self):
        self.assertEqual(self.check()['counts']['tests'], 3898)

    def test_modified_retained_tap_is_rejected(self):
        (self.root / 'complete.tap').write_bytes(self.data + b'# edited\n')
        with self.assertRaises(ValueError):
            self.check()

    def test_missing_and_extra_tap_are_rejected(self):
        (self.root / 'unlisted.tap').write_bytes(tap())
        with self.assertRaises(ValueError):
            self.check()
        (self.root / 'unlisted.tap').unlink()
        (self.root / 'complete.tap').unlink()
        with self.assertRaises(OSError):
            self.check()

    def test_duplicate_or_omitted_execution_is_rejected(self):
        self.result['results'].append(copy.deepcopy(self.result['results'][0]))
        with self.assertRaises(ValueError):
            self.check()
        self.result['results'] = []
        with self.assertRaises(ValueError):
            self.check()

    def test_source_snapshot_and_executed_source_are_bound(self):
        audit.write_json(self.root / 'tested-source.json', {self.file: 'd' * 64})
        with self.assertRaises(ValueError):
            self.check()
        audit.write_json(self.root / 'tested-source.json', self.source)
        self.result['results'][0]['sourceSHA256'] = 'd' * 64
        with self.assertRaises(ValueError):
            self.check()

    def test_timeout_partial_failed_exit_and_source_mutation_are_rejected(self):
        baseline = copy.deepcopy(self.result)
        for field, value in [('scope', 'PARTIAL'), ('status', 'NOT_PASS'), ('sourceUnchanged', False), ('complete', False)]:
            self.result = copy.deepcopy(baseline)
            self.result[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.check()
        for field, value in [('timedOut', True), ('exitCode', 1), ('completeSummary', False)]:
            self.result = copy.deepcopy(baseline)
            self.result['results'][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.check()

    def test_unsafe_log_path_and_incomplete_fixture_are_rejected(self):
        self.result['results'][0]['log'] = '../complete.tap'
        with self.assertRaises(ValueError):
            self.check()
        self.result['results'][0]['log'] = 'complete.tap'
        self.prerequisites['historical'] = []
        audit.write_json(self.root / 'prerequisites.json', self.prerequisites)
        with self.assertRaises(ValueError):
            self.check()

    def test_symlink_evidence_is_rejected(self):
        (self.root / 'linked.tap').symlink_to(self.root / 'complete.tap')
        with self.assertRaises(ValueError):
            audit.regular_tree(self.root)


class IntegrationFilesystemTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.receipt = {'schema': 'agi-macos-integration-filesystem/v1', 'caseSensitive': True,
                        'distinctCaseNames': True, 'scope': 'disposable engineering workspace only'}

    def tearDown(self):
        self.temporary.cleanup()

    def test_exact_successful_probe_is_required_and_hash_bound(self):
        audit.write_json(self.root / 'filesystem.json', self.receipt)
        self.assertEqual(audit.audit_integration_filesystem(self.root), audit.sha(self.root / 'filesystem.json'))

    def test_failed_ambiguous_or_broadened_probe_is_rejected(self):
        for change in ({'caseSensitive': False}, {'distinctCaseNames': False}, {'caseSensitive': 1},
                       {'distinctCaseNames': 1}, {'scope': 'operator deployment'},
                       {'schema': 'unrecognized'}, {'productionQualified': True}):
            audit.write_json(self.root / 'filesystem.json', {**self.receipt, **change})
            with self.subTest(change=change), self.assertRaises(ValueError):
                audit.audit_integration_filesystem(self.root)

    def test_missing_linked_or_duplicate_probe_is_rejected(self):
        path = self.root / 'filesystem.json'
        with self.assertRaises(ValueError):
            audit.audit_integration_filesystem(self.root)
        audit.write_json(self.root / 'other.json', self.receipt)
        path.symlink_to(self.root / 'other.json')
        with self.assertRaises(ValueError):
            audit.audit_integration_filesystem(self.root)
        path.unlink()
        path.write_text('{"caseSensitive":false,"caseSensitive":true}')
        with self.assertRaises(ValueError):
            audit.audit_integration_filesystem(self.root)


class PublicationTests(unittest.TestCase):
    def test_provenance_rejects_unknown_repo_run_or_commit(self):
        for commit, repo, run in [('main', audit.REPOSITORY, RUN), (COMMIT, 'other/repo', RUN), (COMMIT, audit.REPOSITORY, '0')]:
            with self.subTest(values=(commit, repo, run)), self.assertRaises(ValueError):
                audit.provenance(commit, repo, run)

    def test_publish_denies_local_and_pull_request_runs(self):
        environment = {'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY': audit.REPOSITORY,
                       'GITHUB_SHA': COMMIT, 'GITHUB_RUN_ID': RUN, 'GITHUB_REF': 'refs/heads/main',
                       'GITHUB_EVENT_NAME': 'push', 'GH_TOKEN': 'test-token'}
        with patch.dict(os.environ, environment, clear=True):
            self.assertEqual(publish.publication_environment(COMMIT, audit.REPOSITORY, RUN), 'test-token')
        for changed in ({'GITHUB_EVENT_NAME': 'pull_request'}, {'GITHUB_REF': 'refs/heads/other'}, {'GITHUB_ACTIONS': 'false'}):
            with patch.dict(os.environ, {**environment, **changed}, clear=True), self.assertRaises(ValueError):
                publish.publication_environment(COMMIT, audit.REPOSITORY, RUN)

    def test_duplicate_and_unsafe_checksum_names_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'SHA256SUMS.txt'
            for text in ('a' * 64 + '  good.zip\n' + 'a' * 64 + '  good.zip\n', 'a' * 64 + '  ../bad.zip\n'):
                path.write_text(text)
                with self.assertRaises(ValueError):
                    publish.checksum_inventory(path)

    def test_moved_tag_and_existing_different_asset_are_never_mutated(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / publish.NOTES).write_text('notes')
            asset = root / 'candidate.zip'
            asset.write_bytes(b'candidate')
            metadata = {'tag': 'v1.20.0-macos-qualification', 'sha256': audit.sha(asset)}
            for scenario in ('moved-tag', 'different-asset'):
                calls = []
                def api(path, token, **kwargs):
                    calls.append((path, kwargs.get('method', 'GET')))
                    if '/git/ref/' in path:
                        return {'object': {'type': 'commit', 'sha': 'b' * 40 if scenario == 'moved-tag' else COMMIT}}
                    return {'id': 1, 'prerelease': True, 'draft': False, 'target_commitish': COMMIT,
                            'tag_name': metadata['tag'], 'body': 'notes',
                            'assets': [{'name': asset.name, 'size': len(b'candidate'), 'digest': 'sha256:' + 'c' * 64}]}
                with patch.object(publish, 'publication_environment', return_value='token'), \
                     patch.object(publish, 'validate_prepared', return_value=(metadata, {}, [asset])), \
                     patch.object(publish, 'module', return_value=types.SimpleNamespace(api=api)), \
                     self.subTest(scenario=scenario), self.assertRaises(ValueError):
                    publish.publish(root, root, COMMIT, audit.REPOSITORY, RUN)
                self.assertTrue(all(method == 'GET' for _, method in calls))


if __name__ == '__main__':
    unittest.main()
