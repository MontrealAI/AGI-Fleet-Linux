"""Ordinary in-memory checksum/metadata checks; no installed-tree mutation."""
import contextlib
import copy
import io
import json
import os
import runpy
import subprocess
import tempfile
import zipfile
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

    def test_future_refresh_requires_public_integrity_for_the_complete_lock(self):
        package = {'resolved': 'https://registry.npmjs.org/example/-/example-1.0.0.tgz',
                   'integrity': 'sha512-' + 'A' * 86 + '=='}
        lock = {'lockfileVersion': 3, 'packages': {'': {}, 'node_modules/example': package}}
        inputs = {**self.inputs, 'fleet/package-lock.json': REFERENCE.encoded(lock)}
        REFERENCE.validate_public_lock(inputs)
        alternatives = [{**package, 'resolved': 'https://example.com/example.tgz'},
                        {**package, 'integrity': ''}, {**package, 'link': True}]
        for candidate in alternatives:
            changed = {**lock, 'packages': {'': {}, 'node_modules/example': candidate}}
            with self.assertRaisesRegex(ValueError, 'PUBLIC_INTEGRITY'):
                REFERENCE.validate_public_lock({**inputs, 'fleet/package-lock.json': REFERENCE.encoded(changed)})

    def test_exact_captured_receipt_bytes_are_bound(self):
        raw = REFERENCE.encoded(self.reference) + b'\n'
        entries = {name: (data, 0o644) for name, data in self.inputs.items()}
        entries.update({'fleet/node_modules/' + name: value for name, value in self.members.items()})
        entries['local-runtime/transformation/dependency-reference.json'] = (raw, 0o644)
        result = REFERENCE.verify_packaged_dependencies(entries)
        self.assertEqual(result['referenceSha256'], REFERENCE.sha(raw))


class BuilderDependencyProvenance(unittest.TestCase):
    """Actual builders over small public fixtures, with no npm/network work."""
    def fixture(self, temporary, edition):
        repository = Path(__file__).resolve().parents[2]
        module = runpy.run_path(str(repository / ('local-runtime/package.py' if edition == 'alpha6'
                                                  else 'local-runtime/transformation/package.py')))
        root = Path(temporary) / edition
        root.mkdir()
        for name in ['local-runtime/transformation', 'local-dashboard', 'role-skills', 'docs/local-skills',
                     'fleet/shared', 'fleet/successor', 'fleet/node_modules',
                     'fleet/packages/AGI_Agent/src/admission-core', 'fleet/packages/AGI_Node/src',
                     'engineering/transformation', '.github/workflows']:
            (root / name).mkdir(parents=True, exist_ok=True)
        inputs = {'fleet/package.json': b'{"name":"public-fixture"}',
                  'fleet/package-lock.json': b'{"lockfileVersion":3}'}
        members = {'example/package.json': (b'{"name":"example"}', 0o644),
                   'example/run.js': (b'// inert public fixture, never executed\n', 0o755)}
        for name, data in {**inputs, 'LOCAL_SKILLS.md': b'public fixture\n', 'LICENSE': b'MIT\n',
                           'docs/transformational-project.md': b'public fixture\n',
                           '.github/workflows/transformational-project.yml': b'public fixture\n'}.items():
            (root / name).write_bytes(data)
        for name, (data, mode) in members.items():
            target = root / 'fleet/node_modules' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(mode)
        (root / 'fleet/node_modules/.package-lock.json').write_bytes(b'generated cache is excluded\n')
        (root / 'local-runtime/__pycache__').mkdir()
        (root / 'local-runtime/__pycache__/inert.pyc').write_bytes(b'inert source cache, never executed\n')
        (root / 'local-runtime/inert.pyc').write_bytes(b'inert source cache, never executed\n')
        reference = {'schema': REFERENCE.SCHEMA, 'inputs': REFERENCE.identities(inputs),
                     'installation': {'command': REFERENCE.COMMAND, 'exitCode': 0,
                                      'node': REFERENCE.NODE, 'npm': REFERENCE.NPM},
                     'files': REFERENCE.records(members)}
        raw = REFERENCE.encoded(reference)
        (root / 'local-runtime/transformation/dependency-reference.json').write_bytes(raw)
        profile = root / 'local-runtime/transformation/release-profile.json'
        profile.write_bytes(REFERENCE.encoded({'version': '0.1.0-alpha.7', 'archive': 'fixture.zip',
                                               'scope': 'inert regression fixture'}))
        globals_ = module['build'].__globals__
        globals_['ROOT'] = root
        if edition == 'alpha7':
            globals_['PROFILE'] = profile
            globals_['INVENTORY'] = root / 'local-runtime/transformation/source-inventory.json'
            globals_['INVENTORY'].write_bytes(module['encoded'](module['reviewed_inventory']()))
        (root / '.gitignore').write_text('/fleet/node_modules/\n')
        env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull)
        def git(*args):
            return subprocess.check_output(['git', '-c', 'core.excludesFile=' + os.devnull, *args], cwd=root, env=env)
        git('init', '--quiet')
        git('add', '--', '.')
        git('-c', 'user.name=TI package fixture', '-c', 'user.email=ti-package-fixture@example.invalid',
            'commit', '-qm', 'public package fixture')
        self.assertEqual(git('status', '--porcelain', '--untracked-files=all'), b'')
        return module, root, raw

    def build(self, module, output):
        with contextlib.redirect_stdout(io.StringIO()):
            module['build'](output)
        receipt = json.loads((output / 'package-receipt.json').read_bytes())
        archive = output / receipt.get('archive', receipt.get('name'))
        with zipfile.ZipFile(archive) as saved:
            manifest_name = next(name for name in saved.namelist() if name.endswith('/local-preview-manifest.json'))
            manifest = json.loads(saved.read(manifest_name))
            self.assertFalse(manifest['workingTreeDirty'])
            self.assertFalse(any(row['path'] in ['local-runtime/__pycache__/inert.pyc', 'local-runtime/inert.pyc']
                                 for row in manifest['files']))
            self.assertEqual(manifest['dependencyProvenance'], receipt['dependencyProvenance'])
            self.assertFalse(any(name.endswith('/node_modules/.package-lock.json') for name in saved.namelist()))
        return archive.read_bytes(), receipt['dependencyProvenance']

    def test_both_builders_share_exact_verifier_and_exclude_only_generated_root_cache(self):
        for edition in ['alpha6', 'alpha7']:
            with self.subTest(edition=edition), tempfile.TemporaryDirectory() as temporary:
                module, root, raw = self.fixture(temporary, edition)
                first, provenance = self.build(module, Path(temporary) / 'first')
                self.assertEqual(provenance['referenceSha256'], REFERENCE.sha(raw))
                self.assertEqual(provenance['files'], 2)
                self.assertEqual(provenance['excludedGeneratedMembers'], ['.package-lock.json'])
                (root / 'fleet/node_modules/.package-lock.json').write_bytes(b'different generated cache\n')
                second, _ = self.build(module, Path(temporary) / 'second')
                self.assertEqual(first, second)
                (root / 'fleet/node_modules/example/.package-lock.json').write_bytes(b'nested extra is not excluded\n')
                with self.assertRaisesRegex(ValueError, 'REFERENCE_MISMATCH'):
                    module['build'](Path(temporary) / 'nested-extra')

    def test_both_builders_refuse_missing_extra_content_and_mode_mismatches_before_output(self):
        for edition in ['alpha6', 'alpha7']:
            for difference in ['missing', 'extra', 'content', 'mode', 'pyc', 'pycache']:
                with self.subTest(edition=edition, difference=difference), tempfile.TemporaryDirectory() as temporary:
                    module, root, _ = self.fixture(temporary, edition)
                    member = root / 'fleet/node_modules/example/run.js'
                    if difference == 'missing':
                        member.unlink()
                    elif difference == 'extra':
                        (root / 'fleet/node_modules/extra.txt').write_bytes(b'not in reference\n')
                    elif difference == 'content':
                        member.write_bytes(b'different public fixture\n')
                    elif difference == 'pyc':
                        (member.parent / 'inert.pyc').write_bytes(b'inert extra dependency metadata, never executed\n')
                    elif difference == 'pycache':
                        (member.parent / '__pycache__').mkdir()
                        (member.parent / '__pycache__/inert.txt').write_bytes(b'inert extra dependency metadata\n')
                    else:
                        member.chmod(0o644)
                    output = Path(temporary) / 'refused'
                    with self.assertRaisesRegex(ValueError, 'REFERENCE_MISMATCH'):
                        module['build'](output)
                    self.assertFalse(output.exists())

    def test_both_builders_reject_dependency_symlinks_including_generated_cache(self):
        for edition in ['alpha6', 'alpha7']:
            with self.subTest(edition=edition), tempfile.TemporaryDirectory() as temporary:
                module, root, _ = self.fixture(temporary, edition)
                cache = root / 'fleet/node_modules/.package-lock.json'
                cache.unlink()
                cache.symlink_to(root / 'fleet/node_modules/example/run.js')
                output = Path(temporary) / 'refused'
                with self.assertRaisesRegex(ValueError, 'link|LINK'):
                    module['build'](output)
                self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
