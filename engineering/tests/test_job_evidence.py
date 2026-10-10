import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('job_audit', ROOT / 'audit-job-evidence.py')
auditor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auditor)


class RetainedEvidence(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.report = json.loads((ROOT / 'tests/fixtures/job-evidence-fixture.json').read_text())
        for step in self.report['steps']:
            body = 'Synthetic test fixture: ' + step['name'] + '\n'
            if step['name'] == 'manager-build':
                body += 'Exported artifacts: zero compiler warnings or errors.\n'
            elif step['name'] == 'fleet-artifact-reproduction':
                body += ''.join('MATCH ' + name + '\n' for name in auditor.runner.ARTIFACTS)
                body += 'All 11 artifacts reproduced exactly\n'
            elif step['name'] == 'manager-regression':
                body += json.dumps(self.report['managerRegression'], separators=(',', ':')) + '\n'
            (self.directory / step['log']).write_text(body)
            step['logSHA256'] = hashlib.sha256(body.encode()).hexdigest()
        (self.directory / 'current-manager-lifecycle.json').write_text(
            json.dumps(self.report['currentManagerLifecycle']))
        self.save()

    def save(self):
        (self.directory / 'summary.json').write_text(json.dumps(self.report))

    def audit(self):
        return auditor.audit_run(self.directory, 'x64', '0', 'a' * 40)

    def test_valid_fixture_has_complete_log_coverage(self):
        self.assertEqual(self.audit()['verifiedLogs'], 19)

    def test_missing_log_cannot_be_pass(self):
        (self.directory / 'AGI_Agent-integration.log').unlink()
        with self.assertRaisesRegex(ValueError, 'log coverage differs'):
            self.audit()

    def test_changed_log_cannot_be_pass(self):
        (self.directory / 'AGI_Agent-integration.log').write_text('tampered')
        with self.assertRaisesRegex(ValueError, 'log differs or failed'):
            self.audit()

    def test_failed_step_cannot_be_pass(self):
        self.report['steps'][-1]['exitCode'] = 1; self.save()
        with self.assertRaisesRegex(ValueError, 'log differs or failed'):
            self.audit()

    def test_skipped_manager_test_cannot_be_pass(self):
        self.report['managerRegression']['executedTests'] -= 1; self.save()
        with self.assertRaisesRegex(ValueError, 'regression counts differ'):
            self.audit()

    def test_changed_contract_hash_cannot_be_pass(self):
        self.report['contractCompatibility']['artifacts'][0]['deployedBytecodeSHA256'] = '0' * 64; self.save()
        with self.assertRaisesRegex(ValueError, 'artifact comparison differs'):
            self.audit()

    def test_simulation_cannot_be_reclassified_as_live_evidence(self):
        self.report['limitations']['realUSDC'] = True; self.save()
        with self.assertRaisesRegex(ValueError, 'limits were broadened'):
            self.audit()


if __name__ == '__main__':
    unittest.main()
