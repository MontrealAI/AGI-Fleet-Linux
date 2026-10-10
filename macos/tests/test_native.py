import copy
import hashlib
from pathlib import Path
import runpy
import stat
import tempfile
import unittest
import zipfile

NATIVE = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'run-native.py'))


class NativeRunnerGuardTests(unittest.TestCase):
    def setUp(self):
        self.environment = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                            'GITHUB_REPOSITORY': 'MontrealAI/AGI-Fleet-Linux', 'RUNNER_OS': 'macOS',
                            'RUNNER_ARCH': 'ARM64', 'AGI_MACOS_RUNNER_LABEL': 'macos-15',
                            'GITHUB_RUN_ID': '12345', 'GITHUB_SHA': 'a' * 40, 'GITHUB_WORKSPACE': '/checkout'}

    def guard(self, **overrides):
        values = dict(environment=self.environment, system='Darwin', machine='arm64', euid=0, home='/private/var/root')
        values.update(overrides)
        NATIVE['runner_guard'](**values)

    def test_exact_hosted_darwin_root_context(self):
        self.guard()

    def test_linux_rosetta_standard_user_and_operator_home_are_refused(self):
        for override in ({'system': 'Linux'}, {'machine': 'x86_64'}, {'euid': 501}, {'home': '/Users/operator'}):
            with self.subTest(override=override), self.assertRaises(ValueError):
                self.guard(**override)

    def test_unbound_or_self_hosted_runner_is_refused(self):
        bad = {'GITHUB_ACTIONS': 'false', 'RUNNER_ENVIRONMENT': 'self-hosted', 'GITHUB_REPOSITORY': 'someone/fork',
               'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64', 'AGI_MACOS_RUNNER_LABEL': 'macos-latest',
               'GITHUB_RUN_ID': '', 'GITHUB_SHA': 'main', 'GITHUB_WORKSPACE': ''}
        for key, value in bad.items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.guard(environment={**self.environment, key: value})

    def test_original_archive_metadata_is_bound_to_workflow(self):
        metadata = {'schema': 'agi-macos-candidate-build/v1', 'version': '1.20.0', 'platform': 'darwin',
                    'architecture': 'arm64', 'nodeVersion': '24.21.0', 'repositoryCommit': 'a' * 40,
                    'workflowCommit': 'a' * 40, 'productionQualified': False, 'physicalQualification': 'NOT_RUN',
                    'nativeAcceptance': 'NOT_RUN'}
        NATIVE['release_guard'](metadata, 'a' * 40)
        for key, value in {'schema': 'unknown', 'version': '1.19.0', 'platform': 'linux', 'architecture': 'x64',
                           'nodeVersion': '24.20.0', 'repositoryCommit': 'b' * 40, 'workflowCommit': 'b' * 40,
                           'productionQualified': True, 'physicalQualification': 'PASS', 'nativeAcceptance': 'PASS'}.items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                NATIVE['release_guard']({**metadata, key: value}, 'a' * 40)

class NativeAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.output = Path(self.temporary.name)
        self.expected = {}
        rows = []
        counts = {'tests': 12, 'suites': 0, 'pass': 12, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
        data = ('TAP version 13\n' + ''.join(f'# {key} {value}\n' for key, value in counts.items())).encode()
        for index in range(342):
            relative = f'tests/case-{index}.test.mjs'
            digest = hashlib.sha256(relative.encode()).hexdigest()
            self.expected[relative] = digest
            log = self.output / f'case-{index}.tap'
            log.write_bytes(data)
            rows.append({'file': relative, 'sourceSHA256': digest, 'exitCode': 0, 'timedOut': False,
                         'completeSummary': True, 'counts': dict(counts), 'log': log.name,
                         'logBytes': len(data), 'logSHA256': hashlib.sha256(data).hexdigest()})
        self.result = {'schema': 'agi-full-regressions/v1', 'status': 'PASS', 'scope': 'FULL', 'complete': True,
                       'sourceUnchanged': True, 'retainedLogsUnchanged': True,
                       'prerequisites': {'unixSocket': {'available': True}}, 'testFiles': 342,
                       'counts': {key: value * 342 for key, value in counts.items()}, 'results': rows}

    def accept(self, result=None):
        return NATIVE['accept'](self.result if result is None else result, self.expected, self.output)

    def test_complete_dynamic_count_is_accepted(self):
        self.assertTrue(self.accept())

    def test_every_incomplete_or_untrusted_top_level_flag_is_refused(self):
        bad = {'schema': 'unknown', 'status': 'NOT_PASS', 'scope': 'PARTIAL', 'complete': False,
               'sourceUnchanged': False, 'retainedLogsUnchanged': False, 'testFiles': 341}
        for key, value in bad.items():
            with self.subTest(key=key):
                self.assertFalse(self.accept({**self.result, key: value}))

    def test_removed_replaced_and_duplicate_tests_are_refused(self):
        for mutate in (lambda rows: rows.pop(), lambda rows: rows.__setitem__(1, rows[0]),
                       lambda rows: rows[0].update(file='tests/unknown.test.mjs')):
            result = copy.deepcopy(self.result)
            mutate(result['results'])
            self.assertFalse(self.accept(result))

    def test_failed_skipped_cancelled_todo_timeout_and_incomplete_tests_are_refused(self):
        for key in ('fail', 'skipped', 'cancelled', 'todo'):
            result = copy.deepcopy(self.result)
            result['results'][0]['counts'][key] = 1
            with self.subTest(key=key):
                self.assertFalse(self.accept(result))
        for key, value in (('exitCode', 1), ('timedOut', True), ('completeSummary', False), ('sourceSHA256', '0' * 64)):
            result = copy.deepcopy(self.result)
            result['results'][0][key] = value
            with self.subTest(key=key):
                self.assertFalse(self.accept(result))

    def test_totals_are_reconciled_and_minimum_coverage_is_required(self):
        for key, value in (('tests', 3897), ('pass', 4103), ('suites', 1)):
            result = copy.deepcopy(self.result)
            result['counts'][key] = value
            with self.subTest(key=key):
                self.assertFalse(self.accept(result))

    def test_socket_capability_is_required(self):
        self.result['prerequisites']['unixSocket']['available'] = False
        self.assertFalse(self.accept())

    def test_tampered_and_missing_logs_are_refused(self):
        log = self.output / 'case-0.tap'
        log.write_text('changed\n')
        self.assertFalse(self.accept())
        log.unlink()
        self.assertFalse(self.accept())

    def test_rehashed_log_still_requires_actual_tap_counts(self):
        log = self.output / 'case-0.tap'
        data = log.read_bytes().replace(b'# skipped 0', b'# skipped 1')
        log.write_bytes(data)
        self.result['results'][0].update(logBytes=len(data), logSHA256=hashlib.sha256(data).hexdigest())
        self.assertFalse(self.accept())

    def test_log_traversal_and_duplicate_log_are_refused(self):
        for name in ('../case-0.tap', 'case-1.tap'):
            self.result['results'][0]['log'] = name
            with self.subTest(name=name):
                self.assertFalse(self.accept())

    def test_symlinked_log_is_refused(self):
        first, second = self.output / 'case-0.tap', self.output / 'case-1.tap'
        first.unlink()
        first.symlink_to(second)
        self.assertFalse(self.accept())


class NativeFixtureExtractionTests(unittest.TestCase):
    def test_traversal_duplicate_and_symlink_members_are_refused(self):
        for kind in ('traversal', 'case-duplicate', 'symlink'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                archive = root / 'fixture.zip'
                with zipfile.ZipFile(archive, 'w') as saved:
                    if kind == 'traversal':
                        saved.writestr('../escaped', b'x')
                    elif kind == 'case-duplicate':
                        saved.writestr('file', b'x')
                        saved.writestr('FILE', b'x')
                    else:
                        item = zipfile.ZipInfo('link')
                        item.external_attr = (stat.S_IFLNK | 0o777) << 16
                        saved.writestr(item, b'/tmp/elsewhere')
                with self.assertRaises(ValueError):
                    NATIVE['extract_fixtures'](archive, root / 'extracted')
                self.assertFalse((root / 'escaped').exists())

    def test_regular_fixture_content_and_executable_bit_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / 'fixture.zip'
            with zipfile.ZipFile(archive, 'w') as saved:
                item = zipfile.ZipInfo('history/file')
                item.external_attr = (stat.S_IFREG | 0o755) << 16
                saved.writestr(item, b'fixture')
            NATIVE['extract_fixtures'](archive, root / 'extracted')
            file = root / 'extracted/history/file'
            self.assertEqual(file.read_bytes(), b'fixture')
            self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o755)


if __name__ == '__main__':
    unittest.main()
