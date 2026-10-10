import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
spec = importlib.util.spec_from_file_location('job_integration', Path(__file__).resolve().parents[1] / 'run-job-integration.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ContractCompatibility(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.fleet, self.manager = self.root / 'fleet', self.root / 'manager'
        self.bundled = self.fleet / 'packages/AGI_Agent/contract'
        (self.bundled / 'compiler-inputs').mkdir(parents=True)
        (self.bundled / 'artifacts').mkdir()
        (self.manager / 'build/contracts').mkdir(parents=True)
        (self.manager / 'contracts').mkdir()
        sources = {}
        for index in range(11):
            relative = f'contracts/source{index}.sol'
            value = f'// production source {index}\n'
            sources['project/' + relative] = {'content': value}
            (self.manager / relative).write_text(value)
        (self.bundled / 'compiler-inputs/input.json').write_text(json.dumps({'sources': sources}))
        (self.bundled / 'artifact-provenance.json').write_text(json.dumps({
            'sourceCommit': 'a' * 40, 'artifacts': {'AGIJobManager': {'buildInfoId': 'input'}},
        }))
        self.artifact = {
            'abi': [{'type': 'function', 'name': 'example'}], 'bytecode': '0x00', 'deployedBytecode': '0x01',
            'linkReferences': {}, 'deployedLinkReferences': {},
            'immutableReferences': {'123': [{'start': 10, 'length': 32}]},
        }
        for name in runner.ARTIFACTS:
            for directory in [self.bundled / 'artifacts', self.manager / 'build/contracts']:
                (directory / (name + '.json')).write_text(json.dumps(self.artifact))

    def change(self, field, value):
        file = self.manager / 'build/contracts/AGIJobManager.json'
        artifact = json.loads(file.read_text())
        artifact[field] = value
        file.write_text(json.dumps(artifact))

    def test_ast_id_renumbering_preserves_exact_immutable_locations(self):
        self.change('immutableReferences', {'999': [{'start': 10, 'length': 32}]})
        self.assertEqual(runner.compare_contracts(self.fleet, self.manager)['status'], 'PASS')

    def test_changed_production_source_fails_closed(self):
        (self.manager / 'contracts/source0.sol').write_text('// changed\n')
        with self.assertRaisesRegex(ValueError, 'production source changed'):
            runner.compare_contracts(self.fleet, self.manager)

    def test_missing_source_coverage_fails_closed(self):
        file = self.bundled / 'compiler-inputs/input.json'
        data = json.loads(file.read_text())
        data['sources'].pop('project/contracts/source0.sol')
        file.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'coverage differs'):
            runner.compare_contracts(self.fleet, self.manager)

    def test_abi_and_both_bytecodes_must_match(self):
        for field, value in [('abi', []), ('bytecode', '0x02'), ('deployedBytecode', '0x03')]:
            with self.subTest(field=field):
                self.change(field, value)
                with self.assertRaisesRegex(ValueError, 'differs'):
                    runner.compare_contracts(self.fleet, self.manager)
                self.change(field, self.artifact[field])

    def test_changed_library_link_fails_closed(self):
        self.change('linkReferences', {'source.sol': {'Library': [{'start': 5, 'length': 20}]}})
        with self.assertRaisesRegex(ValueError, 'linkReferences differs'):
            runner.compare_contracts(self.fleet, self.manager)

    def test_changed_immutable_offset_fails_closed(self):
        self.change('immutableReferences', {'123': [{'start': 11, 'length': 32}]})
        with self.assertRaisesRegex(ValueError, 'immutable locations differ'):
            runner.compare_contracts(self.fleet, self.manager)


if __name__ == '__main__':
    unittest.main()
