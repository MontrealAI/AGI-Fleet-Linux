import hashlib
from contextlib import redirect_stderr
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

MACOS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MACOS))
SPEC = importlib.util.spec_from_file_location('mac_integration_tests', MACOS / 'run-integration.py')
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class IntegrationGuardTests(unittest.TestCase):
    def setUp(self):
        self.environment = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                            'GITHUB_REPOSITORY': 'MontrealAI/AGI-Fleet-Linux', 'RUNNER_OS': 'macOS',
                            'RUNNER_ARCH': 'ARM64', 'AGI_MACOS_RUNNER_LABEL': 'macos-26',
                            'GITHUB_SHA': 'a' * 40, 'GITHUB_RUN_ID': '12345'}

    def test_exact_native_hosted_context_is_accepted(self):
        RUNNER.guard(self.environment, 'Darwin', 'arm64')

    def test_linux_intel_and_unbound_hosted_context_are_rejected(self):
        for system, machine in [('Linux', 'aarch64'), ('Darwin', 'x86_64'), ('Darwin', 'ARM64')]:
            with self.subTest(system=system, machine=machine), self.assertRaises(ValueError):
                RUNNER.guard(self.environment, system, machine)
        wrong = {'GITHUB_ACTIONS': 'false', 'RUNNER_ENVIRONMENT': 'self-hosted',
                 'GITHUB_REPOSITORY': 'other/fork', 'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64',
                 'AGI_MACOS_RUNNER_LABEL': 'macos-latest', 'GITHUB_SHA': 'main', 'GITHUB_RUN_ID': ''}
        for key, value in wrong.items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                RUNNER.guard({**self.environment, key: value}, 'Darwin', 'arm64')

    def test_node_download_pairs_darwin_xz_url_with_exact_xz_digest(self):
        captured = []

        def download(url, target, digest):
            captured.append((url, target.name, digest))
            with tarfile.open(target, 'w:xz') as archive:
                member = tarfile.TarInfo('node-v24.21.0-darwin-arm64/bin/node')
                member.size = 7
                archive.addfile(member, io.BytesIO(b'fixture'))

        with tempfile.TemporaryDirectory() as temporary, patch.object(RUNNER, 'module', return_value=SimpleNamespace(download=download)):
            folder, architecture = RUNNER.install_node(Path(temporary))
            self.assertEqual(architecture, 'arm64')
            self.assertEqual((folder / 'node').read_bytes(), b'fixture')
        self.assertEqual(captured, [('https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.xz',
                                    'node-v24.21.0-darwin-arm64.tar.xz',
                                    '6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe')])


class IntegrationBindingTests(unittest.TestCase):
    def setUp(self):
        self.candidate = {'version': '1.20.1', 'tag': 'v1.20.1-macos-qualification',
                          'name': 'AGI_Fleet_macOS_v1.20.1.zip', 'prefix': 'AGI_Fleet_macOS_v1.20.1',
                          'sha256': 'b' * 64, 'bytes': 100, 'sourceRevisionSHA256': 'c' * 64,
                          'sourceFiles': 5000, 'workflowCommit': 'a' * 40}

    def test_runner_reuses_hash_checked_manager_harness_with_exact_mac_identity(self):
        source = RUNNER.ROOT / 'engineering/run-job-integration.py'
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        bound = RUNNER.bind_runner(self.candidate)
        self.assertEqual(bound.ASSET, self.candidate['name'])
        self.assertEqual(bound.PREFIX, self.candidate['prefix'])
        self.assertEqual(bound.SHA256, self.candidate['sha256'])
        self.assertEqual(bound.SIZE, self.candidate['bytes'])
        self.assertEqual(bound.NODE_SHA, {'arm64': RUNNER.NODE_SHA})
        self.assertIs(bound.install_node, RUNNER.install_node)
        self.assertEqual(bound.MANAGER_BASELINE, '191cf3590e5cdc08df1bb0af500ee28a91c8b010')
        self.assertEqual(sum(map(len, bound.SCRIPTS.values())), 8)
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), before)

    def test_archive_verification_uses_exact_candidate_and_preserves_seven_edition_coverage(self):
        bound = RUNNER.bind_runner(self.candidate)
        editions = {name: {'manifestFiles': index + 10} for index, name in enumerate(['fleet', 'agent', 'node', 'moderator', 'employer', 'evidence', 'recovery'])}
        with patch.object(RUNNER, 'verify', return_value={'status': 'PASS_ARCHIVE_INTEGRITY', 'editions': editions}) as verify:
            receipt = bound.verify_archive(Path('candidate.zip'))
        verify.assert_called_once_with(Path('candidate.zip'), self.candidate)
        self.assertEqual(receipt['status'], 'PASS')
        self.assertEqual(receipt['editions'], 7)
        self.assertEqual(receipt['sourceFiles'], 5000)
        self.assertEqual(receipt['manifestEntriesVerified'], sum(x['manifestFiles'] for x in editions.values()))

    def test_failed_archive_verification_cannot_be_promoted(self):
        bound = RUNNER.bind_runner(self.candidate)
        with patch.object(RUNNER, 'verify', side_effect=ValueError('Saved archive identity differs')):
            with self.assertRaisesRegex(ValueError, 'Saved archive identity differs'):
                bound.verify_archive(Path('candidate.zip'))

    def test_clean_checkout_is_checked_immediately_after_head_without_mutating_global_subprocess(self):
        with patch.object(RUNNER.subprocess, 'check_output', side_effect=['a' * 40 + '\n', b'']) as command:
            bound = RUNNER.bind_runner(self.candidate)
            result = bound.subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=Path('/manager'), text=True)
            self.assertEqual(result, 'a' * 40 + '\n')
            self.assertIs(RUNNER.subprocess.check_output, command)
            self.assertIsNot(bound.subprocess, RUNNER.subprocess)
        self.assertEqual(command.call_args_list[0].args, (['git', 'rev-parse', 'HEAD'],))
        self.assertEqual(command.call_args_list[0].kwargs, {'cwd': Path('/manager'), 'text': True})
        self.assertEqual(command.call_args_list[1].args, (['git', 'status', '--porcelain', '--untracked-files=no'],))
        self.assertEqual(command.call_args_list[1].kwargs, {'cwd': Path('/manager')})

    def test_case_collision_or_any_dirty_checkout_is_rejected_before_validation(self):
        for dirty in [b' M docs/README.md\n', b' D docs/Readme.md\n', b'?? unexpected-status\n']:
            with self.subTest(dirty=dirty), patch.object(RUNNER.subprocess, 'check_output', side_effect=['a' * 40 + '\n', dirty]) as command:
                bound = RUNNER.bind_runner(self.candidate)
                with self.assertRaisesRegex(ValueError, 'Manager checkout is not exact before validation'):
                    bound.subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=Path('/manager'), text=True)
                self.assertEqual(command.call_count, 2)

    def test_unavailable_cleanliness_check_is_not_treated_as_clean_and_final_guard_is_unchanged(self):
        failure = subprocess.CalledProcessError(128, ['git', 'status'])
        with patch.object(RUNNER.subprocess, 'check_output', side_effect=['a' * 40 + '\n', failure]):
            bound = RUNNER.bind_runner(self.candidate)
            with self.assertRaises(subprocess.CalledProcessError):
                bound.subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=Path('/manager'), text=True)
        with patch.object(RUNNER.subprocess, 'check_output', return_value=b' M changed') as command:
            bound = RUNNER.bind_runner(self.candidate)
            observed = bound.subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=Path('/manager'))
            self.assertEqual(observed, b' M changed')
            self.assertEqual(command.call_count, 1)

    def test_main_refuses_candidate_from_a_different_workflow_before_running_harness(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            metadata = root / 'release.json'
            metadata.write_text(json.dumps({**self.candidate, 'workflowCommit': 'd' * 40}))
            arguments = ['run-integration.py', '--metadata', str(metadata), '--archive', str(root / 'candidate.zip'),
                         '--work', str(root / 'work'), '--evidence', str(root / 'evidence')]
            with patch.object(sys, 'argv', arguments), patch.object(RUNNER, 'guard'), patch.dict(os.environ, {'GITHUB_SHA': 'a' * 40}), patch.object(RUNNER, 'bind_runner') as bind:
                with self.assertRaisesRegex(ValueError, 'Candidate commit differs'):
                    RUNNER.main()
                bind.assert_not_called()

    def test_failure_summary_retains_exact_provenance_even_if_diagnostic_file_cannot_be_written(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            metadata, evidence = root / 'release.json', root / 'evidence'
            metadata.write_text(json.dumps(self.candidate))
            evidence.mkdir()
            saved_arguments = []

            def fail():
                saved_arguments.extend(sys.argv)
                (evidence / 'summary.json').write_text(json.dumps({'status': 'FAIL', 'error': 'fixture failure'}))
                raise ValueError('fixture failure')

            harness = SimpleNamespace(__file__='historical-harness.py', MANAGER_BASELINE='191cf3590e5cdc08df1bb0af500ee28a91c8b010', main=fail)
            arguments = ['run-integration.py', '--metadata', str(metadata), '--archive', str(root / 'candidate.zip'),
                         '--work', str(root / 'work'), '--evidence', str(evidence)]
            environment = {'GITHUB_SHA': 'a' * 40, 'GITHUB_RUN_ID': '12345', 'GITHUB_REPOSITORY': 'MontrealAI/AGI-Fleet-Linux'}
            error_output = io.StringIO()
            with patch.object(sys, 'argv', arguments), patch.object(RUNNER, 'guard'), patch.dict(os.environ, environment), patch.object(RUNNER, 'bind_runner', return_value=harness), patch.object(RUNNER, 'retain_manager_diagnostics', side_effect=OSError('fixture disk error')), redirect_stderr(error_output):
                with self.assertRaisesRegex(ValueError, 'fixture failure'):
                    RUNNER.main()
                self.assertEqual(sys.argv, arguments)
            self.assertIn('original failure and provenance retained', error_output.getvalue())
            self.assertEqual(saved_arguments[-2:], ['--manager-ref', harness.MANAGER_BASELINE])
            report = json.loads((evidence / 'summary.json').read_text())
            self.assertEqual(report['status'], 'FAIL')
            self.assertEqual(report['platform'], 'darwin')
            binding = json.loads((evidence / 'candidate-binding.json').read_text())
            self.assertEqual(binding['candidate'], {key: self.candidate[key] for key in ('version', 'tag', 'name', 'bytes', 'sha256', 'sourceRevisionSHA256')})
            self.assertEqual(binding['workflowCommit'], 'a' * 40)
            self.assertEqual(binding['workflowRun'], '12345')
            self.assertFalse(binding['productionQualified'])


class IntegrationFilesystemTests(unittest.TestCase):
    def test_real_case_sensitive_workspace_is_observed_and_probe_is_removed(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            receipt = RUNNER.case_sensitive_workspace(parent)
            self.assertEqual(receipt, {'schema': 'agi-macos-integration-filesystem/v1', 'caseSensitive': True,
                                      'distinctCaseNames': True, 'scope': 'disposable engineering workspace only'})
            self.assertEqual(list(parent.iterdir()), [])

    def test_case_insensitive_exclusive_create_fails_closed_and_cleans_probe(self):
        original = Path.open

        def open_case(file, mode='r', *args, **kwargs):
            if file.name == 'CASE-PROBE' and mode == 'xb':
                raise FileExistsError('Simulated case-insensitive filesystem')
            return original(file, mode, *args, **kwargs)

        with tempfile.TemporaryDirectory() as temporary, patch.object(Path, 'open', open_case):
            with self.assertRaises(FileExistsError):
                RUNNER.case_sensitive_workspace(Path(temporary))
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_same_inode_or_changed_contents_cannot_claim_case_sensitivity(self):
        original_stat, original_read = Path.stat, Path.read_bytes

        def same_inode(file, *args, **kwargs):
            result = original_stat(file, *args, **kwargs)
            if file.name in ('case-probe', 'CASE-PROBE'):
                values = list(result)
                values[1] = 1
                return os.stat_result(values)
            return result

        def changed(file):
            return b'lower' if file.name == 'CASE-PROBE' else original_read(file)

        for name, replacement in [('stat', same_inode), ('read_bytes', changed)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary, patch.object(Path, name, replacement):
                with self.assertRaisesRegex(ValueError, 'Case-sensitive integration workspace required'):
                    RUNNER.case_sensitive_workspace(Path(temporary))
                self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_checkout_failure_retains_only_bounded_read_only_git_diagnostics(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manager, evidence = root / 'manager', root / 'evidence'
            (manager / '.git').mkdir(parents=True)
            evidence.mkdir()
            with patch.object(RUNNER.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as command:
                RUNNER.retain_manager_diagnostics(manager, evidence)
            self.assertEqual([call.args[0] for call in command.call_args_list], [
                ['git', 'status', '--porcelain=v1', '--untracked-files=no'],
                ['git', 'diff', '--no-ext-diff', '--no-textconv', '--stat', '--summary']])
            for call in command.call_args_list:
                self.assertEqual(call.kwargs['cwd'], manager)
                self.assertEqual(call.kwargs['timeout'], 30)
                self.assertFalse(call.kwargs['check'])
            log = (evidence / 'manager-source-change.log').read_text()
            self.assertIn('git status --porcelain=v1 --untracked-files=no', log)
            self.assertIn('git diff --no-ext-diff --no-textconv --stat --summary', log)

    def test_no_manager_repository_produces_no_diagnostic_commands(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(RUNNER.subprocess, 'run') as command:
            RUNNER.retain_manager_diagnostics(Path(temporary) / 'absent', Path(temporary))
            command.assert_not_called()
            self.assertFalse((Path(temporary) / 'manager-source-change.log').exists())

    def test_diagnostic_command_timeout_and_spawn_failure_cannot_mask_primary_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manager, evidence = root / 'manager', root / 'evidence'
            (manager / '.git').mkdir(parents=True)
            evidence.mkdir()
            failures = [subprocess.TimeoutExpired(['git', 'status'], 30), OSError('fixture git unavailable')]
            with patch.object(RUNNER.subprocess, 'run', side_effect=failures) as command:
                RUNNER.retain_manager_diagnostics(manager, evidence)
            self.assertEqual(command.call_count, 2)
            log = (evidence / 'manager-source-change.log').read_text()
            self.assertIn('TimeoutExpired: diagnostic command unavailable', log)
            self.assertIn('OSError: diagnostic command unavailable', log)


if __name__ == '__main__':
    unittest.main()
