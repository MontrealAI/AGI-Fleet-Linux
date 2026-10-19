"""Saved-archive custody regressions; no browser or service execution is simulated."""
import hashlib
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile


class SavedPackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.root=Path(self.temporary.name);self.archive=self.root/'package.zip';self.application=self.root/'application';self.observation=self.root/'package-observation.json';self.commit='1'*40
        files={'local-runtime/cli/main.mjs':b'// inert fixture\n','local-runtime/validate.mjs':b'// inert fixture\n','LICENSE':b'Fixture license\n'}
        rows=[{'path':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'mode':0o644} for name,raw in sorted(files.items())]
        manifest={'schema':'agi-fleet/local-source-preview/v1','version':'0.1.0-alpha.6','commit':self.commit,'workingTreeDirty':False,'productionQualified':False,'files':rows}
        files['local-preview-manifest.json']=json.dumps(manifest).encode()
        with zipfile.ZipFile(self.archive,'x') as archive:
            for name,raw in files.items():
                entry=zipfile.ZipInfo('agi-fleet-local-0.1.0-alpha.6/'+name);entry.create_system=3;entry.external_attr=(stat.S_IFREG|0o644)<<16;archive.writestr(entry,raw)
    def tearDown(self):self.temporary.cleanup()
    def command(self,action,commit=None):
        return subprocess.run([sys.executable,'-B',str(Path(__file__).with_name('service-package.py')),action,'--archive',str(self.archive),'--application',str(self.application),'--commit',commit or self.commit,'--observation',str(self.observation)],capture_output=True,text=True)
    def test_exact_saved_bytes_and_modes_are_stable(self):
        self.assertEqual(self.command('extract').returncode,0);self.assertEqual(self.command('verify').returncode,0)
        value=json.loads(self.observation.read_text());self.assertEqual(value['inventoryBeforeSha256'],value['inventoryAfterSha256']);self.assertTrue(value['unchanged'])
    def test_changed_source_is_refused(self):
        self.assertEqual(self.command('extract').returncode,0);(self.application/'LICENSE').write_text('modified');self.assertNotEqual(self.command('verify').returncode,0)
    def test_new_importable_file_is_refused(self):
        self.assertEqual(self.command('extract').returncode,0);(self.application/'extra.mjs').write_text('// unreviewed');self.assertNotEqual(self.command('verify').returncode,0)
    def test_changed_file_mode_is_refused(self):
        self.assertEqual(self.command('extract').returncode,0);(self.application/'LICENSE').chmod(0o755);self.assertNotEqual(self.command('verify').returncode,0)
    def test_symlink_is_refused(self):
        self.assertEqual(self.command('extract').returncode,0);(self.application/'extra').symlink_to(self.archive);self.assertNotEqual(self.command('verify').returncode,0)
    def test_foreign_source_commit_is_refused_before_extraction(self):
        self.assertNotEqual(self.command('extract','2'*40).returncode,0);self.assertFalse(self.application.exists())


if __name__=='__main__':unittest.main()
