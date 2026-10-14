import json,re,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
class SuccessorReleaseIdentity(unittest.TestCase):
    def setUp(self):self.spec=json.loads((ROOT/'engineering/next-release.json').read_text())
    def test_troubleshooting_commands_use_current_candidate(self):
        paths=re.findall(r'/opt/agi-fleet-linux/(AGI_Fleet_Linux_v[\d.]+)/packages/AGI_Agent/(?:Inspect|Stop-Compute)\.sh',(ROOT/'docs/TROUBLESHOOTING.md').read_text())
        self.assertEqual(paths,[self.spec['prefix']]*2)
    def test_builder_and_integration_qualify_the_same_manager_release(self):
        provenance=json.loads((ROOT/'fleet/successor/vendor/manager-provenance.json').read_text())
        for field in ('repository','version','commit'):self.assertEqual(provenance[field],self.spec['integration'][field])
    def test_blank_ledger_identity_does_not_import_observations(self):
        ledger=json.loads((ROOT/'docs/physical-qualification-template.json').read_text());self.assertEqual(ledger['release'],self.spec['version']);self.assertEqual(ledger['releaseSHA256'],'');self.assertFalse(ledger['productionQualified'])
        for gate in ledger['gates'].values():self.assertEqual(gate['status'],'NOT_RUN');self.assertEqual(gate['sanitizedEvidence'],[])
    def test_fresh_install_paths_and_asset_identity_agree(self):
        text=(ROOT/'docs/FRESH_INSTALL.md').read_text();self.assertIn(self.spec['name'],text)
        for version in re.findall(r'/opt/agi-fleet-linux/AGI_Fleet_Linux_v([\d.]+)',text):self.assertEqual(version,self.spec['version'])
    def test_changed_metadata_preserves_mac_and_historical_release_records(self):
        baseline=json.loads((ROOT/'successor/preservation-baseline.json').read_text());import hashlib
        for row in baseline['files']:
            if row['path']=='macos/build.py':self.assertEqual(hashlib.sha256((ROOT/'successor/history/macos-build-pre-baseline-repair.py').read_bytes()).hexdigest(),row['sha256']);continue
            if row['path']=='macos/tests/test_build.py':self.assertEqual(hashlib.sha256((ROOT/'successor/history/macos-test-build-pre-baseline-repair.py').read_bytes()).hexdigest(),row['sha256']);continue
            if row['path']=='macos/preview/tests/test_materialize.py':self.assertEqual(hashlib.sha256((ROOT/'successor/history/macos-preview-test-materialize-pre-successor.py').read_bytes()).hexdigest(),row['sha256']);continue
            if row['path']=='macos/preview/source-inventory.json':self.assertEqual(hashlib.sha256((ROOT/'successor/history/macos-preview-source-inventory-pre-successor.json').read_bytes()).hexdigest(),row['sha256']);continue
            if row['path'].startswith(('validation/','macos/')) or re.match(r'docs/RELEASE_NOTES_1_0_',row['path']):self.assertEqual(hashlib.sha256((ROOT/row['path']).read_bytes()).hexdigest(),row['sha256'],row['path'])
