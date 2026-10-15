"""Synthetic /proc/path fixtures only. Never run native payloads or root code."""
import copy
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
import prepare
import payload
import run as runner


def process_stat(pid=77,parent=33,start='123'):
    fields=['S',str(parent)]+['0']*17+[start]
    return str(pid)+' (synthetic fixture) '+' '.join(fields)+'\n'


def proc_fixture(root):
    interpreter=root/'interpreter';interpreter.write_bytes(b'SYNTHETIC NEVER EXECUTED')
    proc=root/'proc';p=proc/'77';(p/'ns').mkdir(parents=True);(proc/'self/ns').mkdir(parents=True)
    (p/'cmdline').write_bytes(b'/opt/alpha/python/bin/python3.12\0-I\0-S\0-B\0/opt/alpha/launch-work.py\0')
    (p/'stat').write_text(process_stat());(p/'ns/pid').symlink_to('pid:[200]');(proc/'self/ns/pid').symlink_to('pid:[100]');(p/'exe').symlink_to(interpreter)
    return proc,p,interpreter,payload.interpreter_identity(interpreter)


class PayloadIdentityTests(unittest.TestCase):
    def test_exact_fixed_argv_only_not_wrappers_substrings_or_other_options(self):
        valid=b'/opt/alpha/python/bin/python3.12\0-I\0-S\0-B\0/opt/alpha/launch-work.py\0'
        self.assertEqual(payload.phase_from_argv(valid),'work')
        for raw in (b'/usr/bin/prlimit\0--cpu=5\0'+valid,b'/usr/bin/bwrap\0--\0'+valid,valid+b'extra\0',valid.replace(b'-S\0',b''),valid.replace(b'python3.12',b'python3'),valid.rstrip(b'\0')):
            self.assertIsNone(payload.phase_from_argv(raw))

    def test_actual_interpreter_inode_bytes_and_private_namespace_are_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc,p,interpreter,identity=proc_fixture(Path(tmp))
            value=payload.observe_payload(p,33,identity,proc)
            self.assertEqual((value['pid'],value['startTimeTicks'],value['pidNamespace']),(77,'123','pid:[200]'))
            (p/'ns/pid').unlink();(p/'ns/pid').symlink_to('pid:[100]')
            with self.assertRaisesRegex(ValueError,'host PID'):payload.observe_payload(p,33,identity,proc)

    def test_wrappers_skipped_before_host_namespace_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc,p,_,identity=proc_fixture(Path(tmp));(p/'cmdline').write_bytes(b'/usr/bin/bwrap\0--\0'+(p/'cmdline').read_bytes())
            (p/'ns/pid').unlink();(p/'ns/pid').symlink_to('pid:[100]')
            self.assertIsNone(payload.observe_payload(p,33,identity,proc))

    def test_argv_spoof_wrong_executable_and_changed_bytes_fail(self):
        for change in ('exe','bytes'):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);proc,p,interpreter,identity=proc_fixture(root)
                if change=='exe':
                    wrong=root/'wrong';wrong.write_bytes(interpreter.read_bytes());(p/'exe').unlink();(p/'exe').symlink_to(wrong)
                else:interpreter.write_bytes(b'X'*identity['bytes'])
                with self.assertRaises(ValueError):payload.observe_payload(p,33,identity,proc)

    def test_reused_pid_between_reads_cannot_be_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc,p,_,identity=proc_fixture(Path(tmp));original=Path.read_text;reads=0
            def changed(file,*args,**kwargs):
                nonlocal reads
                if file==p/'stat':
                    reads+=1
                    if reads>=3:return process_stat(start='999')
                return original(file,*args,**kwargs)
            with patch.object(Path,'read_text',changed):
                with self.assertRaisesRegex(ValueError,'changed'):payload.observe_payload(p,33,identity,proc)

    def test_unrelated_exact_argv_is_not_a_driver_descendant(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc,p,_,identity=proc_fixture(Path(tmp));(p/'stat').write_text(process_stat(parent=1))
            self.assertIsNone(payload.observe_payload(p,33,identity,proc))


class OutputContainmentTests(unittest.TestCase):
    def test_normal_absent_external_destination(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';source.mkdir()
            self.assertEqual(prepare.absent_output(root/'out',[source]),root/'out')
            self.assertFalse((root/'out').exists())

    def test_parent_alias_nested_alias_and_missing_children_rejected_before_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';source.mkdir();(root/'alias').symlink_to(source);(root/'nested').mkdir();(root/'nested/link').symlink_to(root/'alias')
            for destination in (root/'alias/out',root/'nested/link/out',root/'alias/missing/child',source/'new/child',root/'alias/../source/out'):
                with self.subTest(destination=destination),self.assertRaises(ValueError):prepare.absent_output(destination,[source])
            self.assertEqual(list(source.iterdir()),[])

    def test_existing_and_dangling_destination_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'existing').mkdir();(root/'dangling').symlink_to(root/'absent')
            for destination in (root/'existing',root/'dangling'):
                with self.assertRaises(ValueError):prepare.absent_output(destination,[])

    def test_prepare_rejects_source_alias_before_git_remote_or_mkdir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';source.mkdir();(root/'alias').symlink_to(source)
            with patch.object(prepare.os,'geteuid',return_value=1000),patch.object(prepare,'git') as git,patch.object(prepare,'verify_remote') as remote:
                with self.assertRaises(ValueError):prepare.prepare(source,root/'alias/prepared',Path(sys.executable),{}, {},'linux-x64')
                git.assert_not_called();remote.assert_not_called()
            self.assertEqual(list(source.iterdir()),[])

    def test_run_rejects_preparation_or_source_alias_before_mkdir_or_observer(self):
        env={'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted'}
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';source.mkdir();preparation=root/'prepared';preparation.mkdir();checkout=preparation/'checkout';checkout.mkdir();(root/'alias').symlink_to(source)
            report={'checkout':str(checkout),'sourceCheckout':str(source)}
            for destination in (root/'alias/evidence',preparation/'evidence',checkout/'missing/evidence'):
                with patch.object(runner.os,'geteuid',return_value=1000),patch.dict(os.environ,env),patch.object(runner,'verify_preparation',return_value=report),patch.object(runner,'load_observer') as observer:
                    with self.assertRaises(ValueError):runner.qualify(preparation,'a'*64,destination)
                    observer.assert_not_called()
            self.assertEqual(list(source.iterdir()),[])
            self.assertEqual(list(checkout.iterdir()),[])

if __name__=='__main__':unittest.main()
