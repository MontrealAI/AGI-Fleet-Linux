"""Ordinary in-memory checksum/metadata checks; no installed-tree mutation."""
import copy
import importlib.util
from pathlib import Path
import unittest

PATH = Path(__file__).resolve().parents[2] / 'local-runtime/transformation/dependency_reference.py'
SPEC = importlib.util.spec_from_file_location('ti_dependency_reference', PATH)
REFERENCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REFERENCE)


class DependencyReference(unittest.TestCase):
    def setUp(self):
        self.inputs = {'fleet/package.json': b'{"name":"inert-fixture"}', 'fleet/package-lock.json': b'{"lockfileVersion":3}'}
        self.members = {'example/package.json': (b'{"name":"example"}', 0o644),
                        'example/run.js': (b'// inert fixture, never executed\n', 0o755)}
        self.reference = {'schema': REFERENCE.SCHEMA, 'inputs': REFERENCE.identities(self.inputs),
                          'installation': {'command': REFERENCE.COMMAND, 'exitCode': 0,
                                           'node': REFERENCE.NODE, 'npm': REFERENCE.NPM},
                          'files': REFERENCE.records(self.members)}

    def test_exact_reference_accepts_complete_bytes_and_modes(self):
        result = REFERENCE.verify_reference(self.reference, self.inputs, self.members)
        self.assertEqual(result['files'], 2)
        self.assertEqual(result['referenceSha256'], REFERENCE.sha(REFERENCE.encoded(self.reference)))

    def test_inert_metadata_differences_are_not_reference_matches(self):
        alternatives = [
            {'example/package.json': self.members['example/package.json']},
            {**self.members, 'example/extra.txt': (b'inert metadata', 0o644)},
            {**self.members, 'example/run.js': (b'// distinct inert checksum fixture\n', 0o755)},
            {**self.members, 'example/run.js': (self.members['example/run.js'][0], 0o644)},
        ]
        for members in alternatives:
            with self.subTest(paths=sorted(members)), self.assertRaisesRegex(ValueError, 'REFERENCE_MISMATCH'):
                REFERENCE.verify_reference(self.reference, self.inputs, members)

    def test_different_package_or_lock_identity_is_not_blessed(self):
        for name in self.inputs:
            inputs = {**self.inputs, name: b'{}'}
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'REFERENCE_MISMATCH'):
                REFERENCE.verify_reference(self.reference, inputs, self.members)

    def test_incomplete_installation_metadata_is_rejected(self):
        for field, value in [('command', ['npm', 'install']), ('exitCode', 1), ('exitCode', False),
                             ('node', 'unknown'), ('npm', 'unknown')]:
            reference = copy.deepcopy(self.reference)
            reference['installation'][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'REFERENCE_MISMATCH'):
                REFERENCE.verify_reference(reference, self.inputs, self.members)

    def test_exact_captured_receipt_bytes_are_bound(self):
        raw = REFERENCE.encoded(self.reference) + b'\n'
        entries = {name: (data, 0o644) for name, data in self.inputs.items()}
        entries.update({'fleet/node_modules/' + name: value for name, value in self.members.items()})
        entries['local-runtime/transformation/dependency-reference.json'] = (raw, 0o644)
        result = REFERENCE.verify_packaged_dependencies(entries)
        self.assertEqual(result['referenceSha256'], REFERENCE.sha(raw))


if __name__ == '__main__':
    unittest.main()
