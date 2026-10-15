import importlib.util
from pathlib import Path
import unittest
import subprocess
import sys

PATH=Path(__file__).resolve().parents[1]/'check-successor-archive.py'
SPEC=importlib.util.spec_from_file_location('successor_archive_counts',PATH)
CHECK=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)

class SuccessorArchiveCounts(unittest.TestCase):
    def tap(self, **changes):
        counts=dict(tests=17,pass_=17,fail=0,cancelled=0,skipped=0,todo=0)
        counts.update(changes)
        return '\n'.join('# '+name.rstrip('_')+' '+str(value) for name,value in counts.items())+'\n'

    def test_exact_reviewed_portable_suite(self):
        self.assertEqual(CHECK.portable_counts(self.tap())['tests'],17)

    def test_stale_or_changed_counts_fail_closed(self):
        for changes in ({'tests':13,'pass_':13},{'tests':18,'pass_':18},{'pass_':16},{'fail':1},{'cancelled':1},{'skipped':1},{'todo':1}):
            with self.subTest(changes=changes),self.assertRaises(ValueError):
                CHECK.portable_counts(self.tap(**changes))

    def test_missing_or_duplicate_totals_fail_closed(self):
        for output in (self.tap().replace('# todo 0\n',''),self.tap()+'# tests 17\n',self.tap().replace('# pass 17','# pass invalid')):
            with self.subTest(output=output),self.assertRaises(ValueError):
                CHECK.portable_counts(output)

    def test_optimized_python_preserves_validation(self):
        script='import runpy,sys; m=runpy.run_path(sys.argv[1]); m[sys.argv[2]](*'+repr((self.tap(tests=13,pass_=13),))+')'
        result=subprocess.run([sys.executable,'-O','-c',script,str(PATH),'portable_counts'],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('ValueError',result.stderr)
        script="import runpy,sys; runpy.run_path(sys.argv[1])['require'](False,'optimized guard')"
        result=subprocess.run([sys.executable,'-O','-c',script,str(PATH)],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('ValueError: optimized guard',result.stderr)
