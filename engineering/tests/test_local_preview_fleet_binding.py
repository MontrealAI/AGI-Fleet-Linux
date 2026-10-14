"""Exercise the Local Skills handoff with the current Fleet auditor's synthetic fixture."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

import test_next_publication as fleet_fixtures

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('local_preview_binding', ROOT / 'local-runtime/release.py')
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class LocalPreviewFleetBinding(unittest.TestCase):
    def test_current_manifest_and_exact_evidence_are_required(self):
        fixture = fleet_fixtures.PublicationAcceptance('test_complete_candidate_can_be_prepared')
        fixture.setUp()
        with tempfile.TemporaryDirectory() as temporary:
            fleet = Path(temporary)
            evidence = fleet / 'synthetic-fleet-evidence.zip'
            evidence.write_bytes(b'synthetic publication handoff fixture')
            manifest = {**fixture.metadata, 'workflowRun': fixture.run_id,
                        'audit': fixture.audit, 'evidence': preview.identity(evidence)}
            path = fleet / f"Release-Manifest-v{fixture.metadata['version']}.json"
            preview.write(path, manifest)
            # A stale legacy filename must never select an unrelated manifest.
            preview.write(fleet / 'Release-Manifest-v1.1.1.json', {})
            self.assertEqual(preview.validate_fleet(fleet, fixture.commit, fixture.run_id), manifest)
            other_run = '1' if fixture.run_id != '1' else '2'
            for change in ({'workflowCommit': 'c' * 40}, {'workflowRun': other_run}):
                preview.write(path, {**manifest, **change})
                with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'Fleet workflow identity differs'):
                    preview.validate_fleet(fleet, fixture.commit, fixture.run_id)
            preview.write(path, manifest)
            evidence.write_bytes(b'changed evidence fixture')
            with self.assertRaisesRegex(ValueError, 'Fleet evidence identity differs'):
                preview.validate_fleet(fleet, fixture.commit, fixture.run_id)
