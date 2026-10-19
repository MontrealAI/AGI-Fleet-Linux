import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('source_guard',Path(__file__).with_name('source_guard.py'))
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)


class SourceGuardTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.root=Path(self.directory.name)
        subprocess.run(['git','init','--quiet',str(self.root)],check=True)
        self.sources=self.root/'sources';self.sources.mkdir();self.file=self.sources/'module.py';self.file.write_text('VALUE=1\n')
        self.git('add','sources');self.git('-c','user.name=Source fixture','-c','user.email=source-fixture@example.invalid','commit','--quiet','-m','Synthetic source guard fixture')
    def tearDown(self):self.directory.cleanup()
    def git(self,*arguments):return subprocess.check_output(['git',*arguments],cwd=self.root)
    def check(self):return guard.verify_tree(self.root,[('sources',True)])
    def test_clean_exact_git_source_and_ignored_pycache(self):
        before=self.check();cache=self.sources/'__pycache__';cache.mkdir();(cache/'module.cpython-312.pyc').write_bytes(b'IGNORED INTERPRETER CACHE')
        self.assertEqual(self.check(),before)
    def test_changed_tracked_bytes_fail_even_when_assume_unchanged(self):
        self.git('update-index','--assume-unchanged','sources/module.py');self.file.write_text('VALUE=2\n')
        with self.assertRaisesRegex(ValueError,'SOURCE_GIT_BYTES_CHANGED'):self.check()
    def test_untracked_importable_file_is_refused(self):
        (self.sources/'injected.py').write_text('VALUE=2\n')
        with self.assertRaisesRegex(ValueError,'SOURCE_UNTRACKED_IMPORTABLE'):self.check()
    def test_linked_tracked_file_is_refused_even_for_identical_bytes(self):
        target=self.root/'outside.py';target.write_bytes(self.file.read_bytes());self.file.unlink();self.file.symlink_to(target)
        with self.assertRaisesRegex(ValueError,'SOURCE_LINK'):self.check()
    def test_untracked_linked_import_directory_is_refused(self):
        outside=self.root/'outside';outside.mkdir();(outside/'injected.py').write_text('VALUE=2\n');(self.sources/'linked').symlink_to(outside,target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'SOURCE_LINK'):self.check()
    def test_later_exact_source_change_produces_a_different_snapshot(self):
        before=self.check();self.file.write_text('VALUE=2\n');self.git('add','sources');self.git('-c','user.name=Source fixture','-c','user.email=source-fixture@example.invalid','commit','--quiet','-m','New synthetic source')
        self.assertNotEqual(self.check(),before)


if __name__=='__main__':unittest.main()
