"""Synthetic adapter regressions; these fixtures are never release evidence."""
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile

ENGINEERING = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINEERING))
spec = importlib.util.spec_from_file_location('saved_profiles', ENGINEERING / 'run-next-profile-integration.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class SavedProfileIntegrity(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.profile = 'manager-1.17.0-b7218196'
        self.candidate = json.loads((ENGINEERING / 'next-release.json').read_text())
        source = b'// synthetic source fixture\n'
        rows = [{'path': 'src/code.mjs', 'sha256': hashlib.sha256(source).hexdigest(), 'executable': False}]
        revision = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        inventory = {'revisionSHA256': revision, 'files': rows}
        content = {'src/code.mjs': source, 'source-inventory.json': json.dumps(inventory).encode(),
                   'docs/guide.md': b'Synthetic guide\n', 'node_modules/dependency/index.js': b'// saved dependency\n'}
        content['MANIFEST.sha256'] = ''.join(hashlib.sha256(value).hexdigest() + '  ' + name + '\n'
                                            for name, value in sorted(content.items())).encode()
        self.archive = self.root / self.candidate['name']
        with zipfile.ZipFile(self.archive, 'w') as saved:
            for name, value in content.items():
                entry = zipfile.ZipInfo(self.candidate['prefix'] + '/' + name)
                entry.external_attr = (stat.S_IFREG | 0o644) << 16
                saved.writestr(entry, value)
        self.candidate.update(sourceRevisionSHA256=revision, sourceFiles=1,
                              bytes=self.archive.stat().st_size, sha256=runner.sha(self.archive))
        self.records = runner.archive_records(self.archive, self.candidate)
        runner.candidate_tools(self.candidate).extract(self.archive, self.root / 'extracted')
        self.fleet = self.root / 'extracted' / self.candidate['prefix']

    def verify(self):
        return runner.verify_saved_tree(self.fleet, self.archive, self.candidate, self.records)

    def test_complete_archive_keeps_docs_dependencies_and_manifest(self):
        self.assertEqual(self.verify(), {'files': 1, 'revisionSHA256': self.candidate['sourceRevisionSHA256']})
        self.assertEqual(set(self.records), {'src/code.mjs', 'source-inventory.json', 'docs/guide.md',
                                           'node_modules/dependency/index.js', 'MANIFEST.sha256'})

    def test_source_only_runner_still_rejects_non_source_coverage(self):
        source_runner = runner.load_module('run-profile-integration.py')
        with self.assertRaisesRegex(ValueError, 'Source inventory coverage differs'):
            source_runner.source_identity(self.fleet)

    def test_changed_non_source_members_are_rejected(self):
        for name in self.records:
            with self.subTest(name=name):
                file = self.fleet / name
                original = file.read_bytes()
                file.write_bytes(original + b'changed')
                with self.assertRaisesRegex(ValueError, 'member changed'):
                    self.verify()
                file.write_bytes(original)

    def test_added_files_and_empty_directories_are_rejected(self):
        extra = self.fleet / 'node_modules/dependency/extra.js'
        extra.write_text('added')
        with self.assertRaisesRegex(ValueError, 'Added saved candidate file'):
            self.verify()
        extra.unlink()
        (self.fleet / 'extra-directory').mkdir()
        with self.assertRaisesRegex(ValueError, 'coverage differs'):
            self.verify()

    def test_missing_members_and_changed_executable_mode_are_rejected(self):
        file = self.fleet / 'docs/guide.md'
        file.chmod(0o755)
        with self.assertRaisesRegex(ValueError, 'member changed'):
            self.verify()
        file.chmod(0o644); file.unlink()
        with self.assertRaisesRegex(ValueError, 'coverage differs'):
            self.verify()

    def test_symlinked_members_and_parent_directories_are_rejected(self):
        file = self.fleet / 'docs/guide.md'
        copy = self.root / 'guide.md'; copy.write_bytes(file.read_bytes())
        file.unlink(); file.symlink_to(copy)
        with self.assertRaisesRegex(ValueError, 'not ordinary'):
            self.verify()
        file.unlink(); file.write_bytes(copy.read_bytes())
        link = self.root / 'linked'; link.symlink_to(self.fleet.parent, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'canonical'):
            runner.verify_saved_tree(link / self.fleet.name, self.archive, self.candidate, self.records)

    def test_wrong_archive_binding_and_source_only_subset_are_rejected(self):
        other = {**self.candidate, 'sha256': 'f' * 64}
        with self.assertRaisesRegex(ValueError, 'archive identity changed'):
            runner.verify_saved_tree(self.fleet, self.archive, other, self.records)
        (self.fleet / 'node_modules/dependency/index.js').unlink()
        with self.assertRaisesRegex(ValueError, 'coverage differs'):
            self.verify()

    def test_archive_file_changed_after_extraction_is_rejected(self):
        with self.archive.open('ab') as output:
            output.write(b'changed after extraction')
        with self.assertRaisesRegex(ValueError, 'archive identity changed'):
            self.verify()

    def test_wrong_selected_profile_manager_commit_is_rejected(self):
        manager = self.root / 'manager'; manager.mkdir()
        with patch.object(runner.subprocess, 'check_output', return_value='db876a8021da6afcf7aa974489d13374e6d188b5\n'):
            with self.assertRaisesRegex(ValueError, 'explicit profile commit'):
                runner.require_manager(manager, self.profile)

    def test_wrong_candidate_metadata_retains_failure_summary(self):
        metadata = self.root / 'release.json'
        metadata.write_text(json.dumps({**self.candidate, 'version': '0.0.0'}))
        evidence = self.root / 'failed-evidence'
        args = ['runner', '--metadata', str(metadata), '--archive', str(self.archive),
                '--work', str(self.root / 'work'), '--evidence', str(evidence),
                '--manager', str(self.root / 'manager'), '--node', sys.executable,
                '--contract-profile', self.profile]
        with patch.object(sys, 'argv', args), self.assertRaisesRegex(ValueError, 'Candidate metadata differs'):
            runner.main()
        result = json.loads((evidence / 'summary.json').read_text())
        self.assertEqual(result['status'], 'FAIL')
        self.assertFalse(result['productionQualified'])
        self.assertIn('metadata differs', result['error'])

    def invoke_synthetic(self, *, mutate=False, fail=False, mismatch=False):
        manager = self.root / 'prepared-manager'; (manager / 'node_modules').mkdir(parents=True)
        evidence = self.root / 'synthetic-evidence'
        node = self.root / 'node'; node.write_text('synthetic fixture, never executed')
        metadata = self.root / 'release.json'; metadata.write_text(json.dumps(self.candidate))
        commit = runner.CONTRACT_PROFILES[self.profile]['commit']
        def exercise(*, identity_checker, validation_context):
            args = dict(zip(sys.argv[1::2], sys.argv[2::2]))
            fleet = Path(args['--fleet'])
            self.assertNotEqual(fleet, ENGINEERING.parent / 'fleet')
            self.assertEqual((fleet / 'node_modules/dependency/index.js').read_text(), '// saved dependency\n')
            before = identity_checker(fleet)
            directory = Path(args['--evidence']); directory.mkdir()
            (directory / 'step.log').write_text('synthetic retained output\n')
            if mutate: (fleet / 'docs/guide.md').write_text('changed during execution')
            if fail: raise ValueError('synthetic test failure')
            summary = {'status': 'PASS', 'profile': 'wrong' if mismatch else self.profile,
                       'profileManifestSHA256': runner.CONTRACT_PROFILES[self.profile]['manifestSHA256'],
                       'managerCommit': commit, 'source': before, 'savedArchiveBinding': validation_context,
                       'limitations': {'savedArchiveBytesExercised': True},
                       'lifecycle': {'status': 'PASS', 'contractProfile': self.profile,
                                     'contractProfileSHA256': runner.CONTRACT_PROFILES[self.profile]['manifestSHA256']},
                       'steps': [],
                       'managerRegression': {'collectedTests': 792, 'executedTests': 792, 'passedTests': 792}}
            for name in runner.EXPECTED_STEPS:
                log = directory / (name + '.log'); log.write_text('Synthetic unit fixture step, never release evidence\n')
                summary['steps'].append({'name': name, 'exitCode': 0, 'log': log.name, 'logSHA256': runner.sha(log)})
            (directory / 'profile-lifecycle.json').write_text(json.dumps(summary['lifecycle']))
            (directory / 'summary.json').write_text(json.dumps(summary))
        args = ['runner', '--metadata', str(metadata), '--archive', str(self.archive),
                '--work', str(self.root / 'work'), '--evidence', str(evidence),
                '--manager', str(manager), '--node', str(node), '--contract-profile', self.profile]
        with patch.object(sys, 'argv', args), \
             patch.object(runner, 'load_candidate', return_value=self.candidate), \
             patch.object(runner, 'verify_candidate', return_value={'status': 'SYNTHETIC_UNIT_FIXTURE'}), \
             patch.object(runner, 'require_manager', return_value={'commit': commit}), \
             patch.object(runner.subprocess, 'check_output', side_effect=lambda args, **kw: 'v24.21.0\n' if args[-1] == '--version' else 'x64\n'), \
             patch.object(runner.platform, 'machine', return_value='x86_64'), \
             patch.object(runner.platform, 'system', return_value='Linux'), \
             patch.object(runner, 'load_module', return_value=types.SimpleNamespace(__file__='synthetic-runner', main=exercise)):
            if fail or mutate or mismatch:
                with self.assertRaises(ValueError): runner.main()
            else: runner.main()
        return evidence, json.loads((evidence / 'summary.json').read_text())

    def test_adapter_executes_complete_extraction_and_binds_results(self):
        _, result = self.invoke_synthetic()
        self.assertEqual(result['status'], 'PASS')
        self.assertTrue(result['completeArchiveUnchanged'])
        self.assertEqual(result['completeArchiveFiles'], 5)
        self.assertIn('integrationSummarySHA256', result)

    def test_integrity_is_checked_and_logs_retained_after_test_failure(self):
        evidence, result = self.invoke_synthetic(mutate=True, fail=True)
        self.assertEqual(result['status'], 'FAIL')
        self.assertIn('synthetic test failure', result['error'])
        self.assertIn('member changed', result['integrityError'])
        self.assertFalse(result['completeArchiveUnchanged'])
        self.assertTrue((evidence / 'profile-integration/step.log').is_file())

    def test_successful_child_cannot_hide_archive_mutation(self):
        _, result = self.invoke_synthetic(mutate=True)
        self.assertEqual(result['status'], 'FAIL')
        self.assertFalse(result['completeArchiveUnchanged'])

    def test_selected_profile_mismatch_cannot_be_relabelled_pass(self):
        _, result = self.invoke_synthetic(mismatch=True)
        self.assertEqual(result['status'], 'FAIL')
        self.assertIn('result binding differs', result['error'])


if __name__ == '__main__':
    unittest.main()
