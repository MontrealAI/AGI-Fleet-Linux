import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

PATH=Path(__file__).resolve().parents[1]/'check-successor-preservation.py'
SPEC=importlib.util.spec_from_file_location('profile_preservation',PATH)
CHECK=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)

class ProfilePreservation(unittest.TestCase):
    def test_only_exact_six_port_reservation_fixtures_are_classified(self):
        self.assertEqual(len(CHECK.PORT_RESERVATION_FIXTURES),6)
        for name in CHECK.PORT_RESERVATION_FIXTURES:
            self.assertIn('port',CHECK.reason(name))
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);name=next(iter(CHECK.PORT_RESERVATION_FIXTURES));file=root/name
            file.parent.mkdir(parents=True);file.write_bytes(b'unreviewed fixture change')
            with patch.object(CHECK,'ROOT',root),self.assertRaisesRegex(ValueError,'fixture bytes differ'):
                CHECK.reason(name)
        with self.assertRaisesRegex(ValueError,'Unclassified'):
            CHECK.reason('fleet/packages/AGI_Unknown/tests/setup-runtime-materialization.test.mjs')

    def test_all_original_paths_modes_anchors_and_diagrams_survive(self):
        result=CHECK.check()
        self.assertEqual(result['status'],'PASS')
        self.assertEqual(result['removed'],[])
        self.assertEqual(result['modeChanges'],[])

    def test_only_exact_reviewed_profile_paths_are_classified(self):
        paths=CHECK.PROFILE_RUNTIME_PATHS|CHECK.PROFILE_OPERATOR_PATHS|CHECK.PROFILE_VERIFIER_PATHS
        self.assertEqual(len(paths),35)
        for name in paths:self.assertIn('profile',CHECK.reason(name))
        for name in ('fleet/unreviewed/src/config.mjs','fleet/packages/AGI_Unknown/src/chain.mjs','fleet/packages/AGI_Agent/scripts/unreviewed.mjs','fleet/packages/AGI_Agent/shared/operator/ops/config.mjs'):
            with self.subTest(path=name),self.assertRaisesRegex(ValueError,'Unclassified'):
                CHECK.reason(name)

    def test_changed_unknown_original_file_still_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'successor').mkdir();(root/'unknown.txt').write_text('changed')
            baseline={'commit':'fixture','files':[{'path':'unknown.txt','mode':'100644','sha256':CHECK.sha(b'original')}]}
            (root/'successor/preservation-baseline.json').write_text(json.dumps(baseline))
            with patch.object(CHECK,'ROOT',root),self.assertRaisesRegex(ValueError,'Unclassified'):
                CHECK.check()

    def test_optimized_python_cannot_skip_missing_original_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'successor').mkdir()
            baseline={'commit':'fixture','files':[{'path':'missing.txt','mode':'100644','sha256':'0'*64}]}
            (root/'successor/preservation-baseline.json').write_text(json.dumps(baseline))
            script="import importlib.util,pathlib,sys; s=importlib.util.spec_from_file_location('p',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.ROOT=pathlib.Path(sys.argv[2]); m.check()"
            result=subprocess.run([sys.executable,'-O','-c',script,str(PATH),str(root)],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('ValueError: Original path missing',result.stderr)
