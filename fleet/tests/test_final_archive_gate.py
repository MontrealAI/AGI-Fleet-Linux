import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest
from unittest import mock
import warnings
import zipfile


ROOT = Path(__file__).resolve().parents[1]
REAL_RUN = subprocess.run


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gate = load_module('final_archive_gate_tests_target', ROOT / 'scripts/final_archive_gate.py')
preparation = load_module('archive_preparation_tests_target', ROOT / 'scripts/prepare-release.py')


class FinalArchiveGateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.calls = []
        self.extractions = []

    def tearDown(self):
        self.temporary.cleanup()

    def archive(self, entries=None, name='fixture.zip'):
        entries = entries or [('release/scripts/main.mjs', b'#!/usr/bin/env node\nconsole.log(1);\n', 0o755)]
        archive = self.root / name
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as target:
                for path, content, mode in entries:
                    info = zipfile.ZipInfo(path)
                    info.create_system = 3
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = (stat.S_IFREG | mode) << 16
                    target.writestr(info, content)
        return archive

    def report(self, archive):
        return json.loads((archive.parent / (archive.stem + '-checks/final-gate.json')).read_text())

    def runner(self, launcher_code=0, launcher_status='PASS', mutate=None, actual_validator=False):
        def execute(command, **options):
            program = Path(command[1]).name
            extracted = Path(command[command.index('--root') + 1])
            output = Path(command[command.index('--output') + 1])
            self.calls.append(program)
            self.extractions.append(extracted)
            self.assertTrue(extracted.is_dir())
            self.assertNotEqual(extracted.parent, self.root)
            self.assertNotIn('NODE_OPTIONS', options['env'])
            self.assertNotIn('NODE_PATH', options['env'])
            if program == 'validate-executables.py':
                if actual_validator:
                    return REAL_RUN(command, **options)
                output.write_text(json.dumps({'status': 'PASS', 'files': [], 'summary': {'files': 1, 'pass': 1, 'fail': 0}}))
                return subprocess.CompletedProcess(command, 0, 'executable fixture passed\n', '')
            self.assertEqual(program, 'smoke-native-launchers.py')
            if mutate:
                mutate(extracted)
            output.mkdir()
            (output / 'launcher-smoke.json').write_text(json.dumps({'status': launcher_status, 'summary': {'failed': int(launcher_code != 0)}}))
            return subprocess.CompletedProcess(command, launcher_code, 'launcher fixture\n', '')
        return execute

    def test_fresh_extraction_uses_archive_bytes_and_preserves_archive(self):
        archive = self.archive()
        before = archive.read_bytes()
        (self.root / 'main.mjs').write_bytes(b'broken source tree; this must never be tested')
        seen = []
        def inspect(extracted):
            entry = extracted / 'scripts/main.mjs'
            self.assertEqual(entry.read_bytes(), b'#!/usr/bin/env node\nconsole.log(1);\n')
            self.assertTrue(entry.stat().st_mode & 0o111)
            seen.append(str(extracted))
        with mock.patch.dict(os.environ, {'NODE_OPTIONS': '--invalid-test-option', 'NODE_PATH': str(self.root)}), mock.patch.object(gate.subprocess, 'run', side_effect=self.runner(mutate=inspect)):
            result = gate.validate_final_archive(archive)
        self.assertEqual(self.calls, ['validate-executables.py', 'smoke-native-launchers.py'])
        self.assertTrue(seen)
        self.assertTrue(all(not path.exists() for path in self.extractions))
        self.assertTrue(result['freshExtraction'])
        self.assertTrue(result['allArchiveCRCsVerified'])
        self.assertTrue(result['extractedBytesAndModesUnchangedAfterTests'])
        self.assertEqual(result['maximumFileBytes'], 450_000_000)
        self.assertEqual(result['physicalMacQualification'], 'NOT_RUN')
        self.assertEqual(result['status'], 'PASS_PACKAGED_EXECUTABLES_AND_LINUX_LAUNCHER_SMOKE')
        self.assertEqual(archive.read_bytes(), before)

    def test_evidence_destination_must_be_fresh(self):
        archive = self.archive()
        output = self.root / 'fixture-checks'
        output.mkdir()
        sentinel = output / 'keep.txt'
        sentinel.write_text('preexisting evidence')
        with mock.patch.object(gate.subprocess, 'run') as run, self.assertRaisesRegex(ValueError, 'new archive/evidence destination'):
            gate.validate_final_archive(archive)
        run.assert_not_called()
        self.assertEqual(sentinel.read_text(), 'preexisting evidence')

    def test_oversized_archive_rejected_before_extraction(self):
        archive = self.archive()
        before = archive.read_bytes()
        with mock.patch.object(gate, 'MAX_FILE_BYTES', archive.stat().st_size - 1), mock.patch.object(gate.subprocess, 'run') as run, self.assertRaisesRegex(ValueError, 'Archive exceeds'):
            gate.validate_final_archive(archive)
        run.assert_not_called()
        self.assertEqual(self.report(archive)['status'], 'FAIL')
        self.assertEqual(archive.read_bytes(), before)

    def test_exact_archive_ceiling_rejected_before_extraction(self):
        archive = self.archive()
        with mock.patch.object(gate, 'MAX_FILE_BYTES', archive.stat().st_size), mock.patch.object(gate.subprocess, 'run') as run, self.assertRaisesRegex(ValueError, 'Archive exceeds'):
            gate.validate_final_archive(archive)
        run.assert_not_called()
        self.assertEqual(self.report(archive)['status'], 'FAIL')

    def test_oversized_member_rejected(self):
        archive = self.archive([('release/large.mjs', b'x' * 4096, 0o644)])
        self.assertLess(archive.stat().st_size, 1000)
        with mock.patch.object(gate, 'MAX_FILE_BYTES', 1000), mock.patch.object(gate.subprocess, 'run') as run, self.assertRaisesRegex(ValueError, 'member exceeds'):
            gate.validate_final_archive(archive)
        run.assert_not_called()

    def test_duplicate_and_casefold_collisions_rejected(self):
        for index, names in enumerate((('release/a.mjs', 'release/a.mjs'), ('release/A.mjs', 'release/a.mjs'))):
            with self.subTest(names=names):
                archive = self.archive([(name, b'console.log(1);', 0o644) for name in names], f'collision-{index}.zip')
                with mock.patch.object(gate.subprocess, 'run') as run, self.assertRaisesRegex(ValueError, 'Duplicate archive paths'):
                    gate.validate_final_archive(archive)
                run.assert_not_called()
                self.assertEqual(self.report(archive)['status'], 'FAIL')

    def test_traversal_rejected(self):
        archive = self.archive([('release/../outside.mjs', b'console.log(1);', 0o644)])
        with mock.patch.object(gate.subprocess, 'run') as run, self.assertRaisesRegex(ValueError, 'Unsafe archive path'):
            gate.validate_final_archive(archive)
        run.assert_not_called()
        self.assertFalse((self.root / 'outside.mjs').exists())

    def test_nonzero_launcher_exit_blocks_release_and_preserves_archive(self):
        archive = self.archive()
        before = archive.read_bytes()
        with mock.patch.object(gate.subprocess, 'run', side_effect=self.runner(launcher_code=1)), self.assertRaisesRegex(ValueError, 'launcher gate failed'):
            gate.validate_final_archive(archive)
        self.assertEqual(self.report(archive)['status'], 'FAIL')
        self.assertEqual(archive.read_bytes(), before)

    def test_failed_or_subset_launcher_report_cannot_pass_with_exit_zero(self):
        for status in ('FAIL', 'SUBSET_PASS'):
            with self.subTest(status=status):
                archive = self.archive(name=status + '.zip')
                with mock.patch.object(gate.subprocess, 'run', side_effect=self.runner(launcher_status=status)), self.assertRaisesRegex(ValueError, 'launcher gate failed'):
                    gate.validate_final_archive(archive)
                self.assertEqual(self.report(archive)['status'], 'FAIL')

    def test_launcher_cannot_modify_extracted_bytes_or_modes(self):
        modifications = [lambda root: (root / 'scripts/main.mjs').write_bytes(b'changed'),
                         lambda root: (root / 'scripts/main.mjs').chmod(0o644),
                         lambda root: (root / 'unexpected.txt').write_text('new file')]
        for index, mutation in enumerate(modifications):
            with self.subTest(index=index):
                archive = self.archive(name=f'mutation-{index}.zip')
                before = archive.read_bytes()
                with mock.patch.object(gate.subprocess, 'run', side_effect=self.runner(mutate=mutation)), self.assertRaisesRegex(ValueError, 'changed packaged files'):
                    gate.validate_final_archive(archive)
                self.assertEqual(archive.read_bytes(), before)
                self.assertTrue(all(not path.exists() for path in self.extractions))

    def require_node24(self):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'Node 24 is a required release test runtime')
        version = REAL_RUN([node, '--version'], capture_output=True, text=True, env={k: v for k, v in os.environ.items() if k not in ('NODE_OPTIONS', 'NODE_PATH')})
        self.assertRegex(version.stdout.strip(), r'^v24\.\d+\.\d+$')
        return node

    def test_actual_node24_syntax_failure_blocks_before_launcher(self):
        node = self.require_node24()
        archive = self.archive([('release/main.mjs', b'#!/usr/bin/env node\nconst broken = ;\n', 0o755)])
        before = archive.read_bytes()
        with mock.patch.object(gate.subprocess, 'run', side_effect=self.runner(actual_validator=True)), self.assertRaisesRegex(ValueError, 'JS executable gate failed'):
            gate.validate_final_archive(archive, node=node)
        evidence = json.loads((self.root / 'fixture-checks/executables.json').read_text())
        self.assertEqual(evidence['summary']['fail'], 1)
        self.assertEqual(evidence['summary']['misplacedHashbangFiles'], 0)
        self.assertNotEqual(evidence['files'][0]['nodeCheck']['exitCode'], 0)
        self.assertIn('SyntaxError', evidence['files'][0]['nodeCheck']['stderr'])
        self.assertEqual(self.calls, ['validate-executables.py'])
        self.assertEqual(archive.read_bytes(), before)

    def test_actual_node24_reproduces_released_misplaced_shebang(self):
        node = self.require_node24()
        content = b"import {setupRole} from '../compute/roles.mjs';\n#!/usr/bin/env node\nconsole.log(1);\n"
        archive = self.archive([('release/setup-openclaw.mjs', content, 0o755)])
        before = archive.read_bytes()
        with mock.patch.object(gate.subprocess, 'run', side_effect=self.runner(actual_validator=True)), self.assertRaisesRegex(ValueError, 'JS executable gate failed'):
            gate.validate_final_archive(archive, node=node)
        evidence = json.loads((self.root / 'fixture-checks/executables.json').read_text())
        self.assertEqual(evidence['summary']['misplacedHashbangFiles'], 1)
        self.assertEqual(evidence['files'][0]['misplacedHashbangs'][0]['line'], 2)
        self.assertNotEqual(evidence['files'][0]['nodeCheck']['exitCode'], 0)
        self.assertEqual(self.calls, ['validate-executables.py'])
        self.assertEqual(archive.read_bytes(), before)


class FinalArchiveEquivalenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source'
        self.source.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def build_fixture(self, embedded_mode=0o644, embedded_body=b'fixture\n', gate_status='PASS_PACKAGED_EXECUTABLES_AND_LINUX_LAUNCHER_SMOKE'):
        versions = {'fleet': '1.19.1', 'agent': '1.25.1'}
        def package(command, **options):
            archive = Path(command[command.index('--out') + 1])
            fleet = archive.name.startswith('AGI_Autonomous_Fleet_')
            prefix = archive.stem + ('/packages/AGI_Agent/' if fleet else '/')
            info = zipfile.ZipInfo(prefix + 'main.mjs')
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | (embedded_mode if fleet else 0o644)) << 16
            with zipfile.ZipFile(archive, 'w') as target:
                target.writestr(info, embedded_body if fleet else b'fixture\n')
            output = archive.parent / (archive.stem + '-checks')
            output.mkdir()
            (output / 'final-gate.json').write_text(json.dumps({'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'status': gate_status}))
            return subprocess.CompletedProcess(command, 0, '', '')
        def verify(archive):
            return {'file': str(archive), 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'bytes': archive.stat().st_size}
        with mock.patch.object(preparation, 'REGISTRY', {'agent': {}}), mock.patch.object(preparation, 'versions', return_value=versions), mock.patch.object(preparation.subprocess, 'run', side_effect=package), mock.patch.object(preparation, 'verify_archive', side_effect=verify):
            return preparation.build(self.source, self.root / 'output', 1_791_417_600)

    def test_equivalence_accepts_identical_bytes_and_modes(self):
        result = self.build_fixture()
        self.assertTrue(result['standaloneMatchesEmbedded'])
        self.assertEqual(set(result['archives']), {'agent', 'fleet'})
        self.assertEqual(result['maximumDeliverableBytes'], 450_000_000)

    def test_equivalence_rejects_same_bytes_with_different_modes(self):
        with self.assertRaisesRegex(ValueError, 'Standalone and embedded companion bytes differ'):
            self.build_fixture(embedded_mode=0o600)

    def test_equivalence_rejects_changed_embedded_bytes(self):
        with self.assertRaisesRegex(ValueError, 'Standalone and embedded companion bytes differ'):
            self.build_fixture(embedded_body=b'changed\n')

    def test_build_cannot_accept_failed_final_gate(self):
        with self.assertRaisesRegex(ValueError, 'Final executable gate is missing or failed'):
            self.build_fixture(gate_status='FAIL')


if __name__ == '__main__':
    unittest.main()
