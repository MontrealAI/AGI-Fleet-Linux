"""Regression coverage for honest full-suite release status."""
from pathlib import Path
import runpy
import unittest
import tempfile
import hashlib
import os

runner = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/run-regressions.py'))

class RegressionStatus(unittest.TestCase):
    def test_history_is_bound_to_its_actual_role(self):
        history = {'authority': {'agent': '/verified/agent', 'node': '/verified/node'}}
        base = {'AGI_TEST_STANDARD_FINALIZATION_SOURCE': '/wrong/old', 'AGI_TEST_RUNTIME_ROLE': 'wrong'}
        for role in ('agent', 'node', 'employer', 'moderator', 'evidence', 'recovery', 'fleet'):
            with self.subTest(role=role):
                env = runner['role_environment'](base, history, role)
                if role in ('agent', 'node'):
                    self.assertEqual(env['AGI_TEST_STANDARD_FINALIZATION_SOURCE'], '/verified/' + role)
                else:
                    self.assertNotIn('AGI_TEST_STANDARD_FINALIZATION_SOURCE', env)
                if role == 'fleet':
                    self.assertNotIn('AGI_TEST_RUNTIME_ROLE', env)
                else:
                    self.assertEqual(env['AGI_TEST_RUNTIME_ROLE'], role)

    def test_only_complete_clean_full_coverage_passes(self):
        row = {'exitCode': 0, 'timedOut': False, 'completeSummary': True, 'counts': {'tests': 1}}
        options = dict(unchanged=True, partial=False, unix_available=True)
        check = runner['suite_passes']
        self.assertTrue(check([row], {'tests': 1, 'pass': 1}, **options))
        for field in ('fail', 'cancelled', 'skipped', 'todo'):
            with self.subTest(field=field):
                self.assertFalse(check([row], {'tests': 2, 'pass': 1, field: 1}, **options))
        for key, value in [('exitCode', 1), ('timedOut', True), ('completeSummary', False), ('counts', {'tests': 0})]:
            with self.subTest(key=key):
                self.assertFalse(check([{**row, key: value}], {'tests': 1}, **options))
        for key, value in [('unchanged', False), ('partial', True), ('unix_available', False), ('retained_logs', False)]:
            with self.subTest(key=key):
                self.assertFalse(check([row], {'tests': 1}, **{**options, key: value}))
        self.assertFalse(check([], {'tests': 0}, **options))

    def test_retained_binary_log_is_exact_private_and_detects_later_truncation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / 'case.tap'
            data = b'TAP version 13\n# synthetic invalid UTF-8: \xff\n# tests 1\n'
            evidence = runner['retain_log'](log, data)
            self.assertEqual(log.read_bytes(), data)
            self.assertEqual(evidence['logSHA256'], hashlib.sha256(data).hexdigest())
            self.assertEqual(evidence['logBytes'], len(data))
            self.assertEqual(os.stat(log).st_mode & 0o777, 0o600)
            self.assertFalse(log.with_suffix('.tap.tmp').exists())
            rows = [{'log': log.name, **evidence}]
            self.assertTrue(runner['retained_logs_valid'](root, rows))
            log.write_bytes(b'TAP version 13\n')
            self.assertFalse(runner['retained_logs_valid'](root, rows))
            log.unlink()
            self.assertFalse(runner['retained_logs_valid'](root, rows))

    def test_atomic_json_replaces_whole_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            import json
            target = Path(directory) / 'progress.json'
            runner['save'](target, {'completed': 1, 'long': 'x' * 4096})
            runner['save'](target, {'completed': 2})
            self.assertEqual(json.loads(target.read_text()), {'completed': 2})
            self.assertFalse(target.with_suffix('.json.tmp').exists())

if __name__ == '__main__':
    unittest.main()
