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


import contract_profiles as profiles


class ExplicitContractProfiles(unittest.TestCase):
    def setUp(self):
        import shutil
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.fleet, self.manager = self.root / 'fleet', self.root / 'manager'
        source = Path(__file__).resolve().parents[2] / 'fleet'
        shutil.copytree(source / 'shared/runtime/contract-profiles', self.fleet / 'shared/runtime/contract-profiles')
        shutil.copytree(source / 'packages/AGI_Agent/contract', self.fleet / 'packages/AGI_Agent/contract')
        self.profile = 'manager-1.17.0-b7218196'
        self.bundle, self.manifest = profiles.contract_bundle(self.fleet, self.profile)
        provenance = json.loads((self.bundle / 'artifact-provenance.json').read_text())
        original = json.loads((self.bundle / 'compiler-inputs' / (provenance['artifacts']['AGIJobManager']['buildInfoId'] + '.json')).read_text())
        for name in self.manifest['productionSources']:
            file = self.manager / name.removeprefix('project/')
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(original['sources'][name]['content'].encode())
        shutil.copytree(self.bundle / 'artifacts', self.manager / 'build/contracts')

    def test_exact_new_profile_is_complete_and_default_still_rejects_it(self):
        result = profiles.compare_contracts(self.fleet, self.manager, self.profile)
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(result['contractProfile'], self.profile)
        self.assertEqual(result['bundledSourceCommit'], 'b721819639668f0074c244d516bbbe0cf57329a7')
        self.assertEqual(len(result['productionSources']), 11)
        self.assertEqual(len(result['artifacts']), 11)
        with self.assertRaisesRegex(ValueError, 'production source changed'):
            profiles.compare_contracts(self.fleet, self.manager)

    def test_every_production_source_is_exact(self):
        for name in self.manifest['productionSources']:
            with self.subTest(name=name):
                file = self.manager / name.removeprefix('project/')
                before = file.read_bytes()
                file.write_bytes(before + b'\n')
                with self.assertRaisesRegex(ValueError, 'production source changed'):
                    profiles.compare_contracts(self.fleet, self.manager, self.profile)
                file.write_bytes(before)

    def test_every_artifact_field_remains_exact(self):
        for name in profiles.ARTIFACTS:
            file = self.manager / 'build/contracts' / (name + '.json')
            before = file.read_text()
            for field in ['abi', 'bytecode', 'deployedBytecode', 'linkReferences', 'deployedLinkReferences', 'immutableReferences']:
                with self.subTest(name=name, field=field):
                    artifact = json.loads(before)
                    artifact[field] = {'fixture': [{'start': 999999, 'length': 32}]} if field == 'immutableReferences' else None
                    file.write_text(json.dumps(artifact))
                    with self.assertRaisesRegex(ValueError, 'differs|differ'):
                        profiles.compare_contracts(self.fleet, self.manager, self.profile)
                    file.write_text(before)

    def test_mixed_legacy_library_with_new_manager_is_rejected(self):
        import shutil
        shutil.copyfile(self.fleet / 'packages/AGI_Agent/contract/artifacts/ENSOwnership.json', self.manager / 'build/contracts/ENSOwnership.json')
        with self.assertRaisesRegex(ValueError, 'Compiled ENSOwnership'):
            profiles.compare_contracts(self.fleet, self.manager, self.profile)

    def test_unknown_selectors_never_become_paths_or_hash_overrides(self):
        for selector in ['../contract', '/tmp/contract', 'main', 'v1.17.0', 'f' * 64, {}, []]:
            with self.subTest(selector=selector):
                with self.assertRaisesRegex(ValueError, 'Unknown contract profile'):
                    profiles.contract_bundle(self.fleet, selector)

    def test_manifest_and_bundle_tampering_are_rejected(self):
        manifest = self.fleet / 'shared/runtime/contract-profiles' / (self.profile + '.json')
        before = manifest.read_bytes()
        manifest.write_bytes(before + b'\n')
        with self.assertRaisesRegex(ValueError, 'manifest integrity'):
            profiles.contract_bundle(self.fleet, self.profile)
        manifest.write_bytes(before)
        artifact = self.bundle / 'artifacts/ENSOwnership.json'
        artifact.write_bytes(artifact.read_bytes() + b'\n')
        with self.assertRaisesRegex(ValueError, 'member integrity'):
            profiles.contract_bundle(self.fleet, self.profile)

    def test_profile_registry_matches_runtime_manifest_pins(self):
        runtime = (Path(__file__).resolve().parents[2] / 'fleet/shared/runtime/src/contract-profiles.mjs').read_text()
        for name, definition in profiles.CONTRACT_PROFILES.items():
            self.assertIn(name, runtime)
            self.assertIn(definition['manifestSHA256'], runtime)
            self.assertIn(definition['commit'], runtime)


if __name__ == '__main__':
    unittest.main()
