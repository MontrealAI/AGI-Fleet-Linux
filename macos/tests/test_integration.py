import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
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
        self.candidate = {'version': '1.20.0', 'tag': 'v1.20.0-macos-qualification',
                          'name': 'AGI_Fleet_macOS_v1.20.0.zip', 'prefix': 'AGI_Fleet_macOS_v1.20.0',
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

    def test_failure_summary_retains_exact_candidate_provenance_without_changing_status(self):
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
            with patch.object(sys, 'argv', arguments), patch.object(RUNNER, 'guard'), patch.dict(os.environ, environment), patch.object(RUNNER, 'bind_runner', return_value=harness):
                with self.assertRaisesRegex(ValueError, 'fixture failure'):
                    RUNNER.main()
                self.assertEqual(sys.argv, arguments)
            self.assertEqual(saved_arguments[-2:], ['--manager-ref', harness.MANAGER_BASELINE])
            report = json.loads((evidence / 'summary.json').read_text())
            self.assertEqual(report['status'], 'FAIL')
            self.assertEqual(report['platform'], 'darwin')
            binding = json.loads((evidence / 'candidate-binding.json').read_text())
            self.assertEqual(binding['candidate'], {key: self.candidate[key] for key in ('version', 'tag', 'name', 'bytes', 'sha256', 'sourceRevisionSHA256')})
            self.assertEqual(binding['workflowCommit'], 'a' * 40)
            self.assertEqual(binding['workflowRun'], '12345')
            self.assertFalse(binding['productionQualified'])


if __name__ == '__main__':
    unittest.main()
