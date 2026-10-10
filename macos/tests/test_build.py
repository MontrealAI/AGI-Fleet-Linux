import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import shutil
import stat
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('macos_build', ROOT / 'macos/build.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
RULES = m.module('macos_test_rules', ROOT / 'fleet/scripts/prepare-release.py')


class MacDistribution(unittest.TestCase):
    def fixture(self, root):
        registry = {role: {'package': 'AGI_' + role.title()} for role in sorted(m.ROLES)}
        m.write_json(root / 'config/role-registry.json', {'roles': registry})
        versions = {role: m.VERSION for role in m.ROLES | {'fleet'}}
        for role, app in m.editions(root):
            m.write_json(app / 'package.json', {'version': m.VERSION, 'name': role})
            m.write_json(app / 'package-lock.json', {'version': m.VERSION,
                                                    'packages': {'': {'version': m.VERSION}}})
            m.write_json(app / 'config/companion-releases.json', {**versions, 'role': role})
            for name in ('START_HERE.html', 'START_HERE.md', 'README.html', 'README.md', 'READ_ME_FIRST.txt'):
                (app / name).write_text('Current Mac guide ' + m.VERSION)
            launcher = app / 'Start.command'; launcher.write_text('#!/bin/bash\nexit 0\n'); launcher.chmod(0o755)
            plist = app / 'AGI.app/Contents/Info.plist'; plist.parent.mkdir(parents=True)
            plist.write_bytes(plistlib.dumps({'CFBundleShortVersionString': m.VERSION, 'CFBundleVersion': m.VERSION}))
            m.write_json(app / 'release-manifest.json', {
                'release': versions, 'productionQualified': False, 'signedNotarized': False,
                'platformEdition': 'macOS Apple silicon', 'edition': role})
        self.refresh(root)
        return root

    def refresh(self, root):
        for role, app in m.editions(root):
            records = [{'path': name, 'sha256': m.sha(file), 'executable': bool(file.stat().st_mode & 0o111)}
                       for name, file in RULES.tree_files(app, RULES.source_path).items()]
            revision = hashlib.sha256(json.dumps(records, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            m.write_json(app / 'source-inventory.json', {'files': records, 'revisionSHA256': revision})
            release = json.loads((app / 'release-manifest.json').read_text())
            release['sourceRevisionSHA256'] = revision
            m.write_json(app / 'release-manifest.json', release)

    def pack(self, root, target):
        m.write_archive(root, target, 1791638400, RULES)
        inventory = json.loads((root / 'source-inventory.json').read_text())
        return {'version': m.VERSION, 'prefix': m.PREFIX, 'name': m.PREFIX + '.zip',
                'bytes': target.stat().st_size, 'sha256': m.sha(target), 'productionQualified': False,
                'sourceFiles': len(inventory['files']), 'sourceRevisionSHA256': inventory['revisionSHA256']}

    def test_specification_pins_current_public_source_and_stays_unqualified(self):
        data = m.specification()
        self.assertEqual(data['base']['sha256'], m.BASE_SHA)
        self.assertEqual(data['base']['sourceFiles'], 4816)
        self.assertEqual(data['tag'], 'v1.20.0-macos-qualification')
        self.assertFalse(data['productionQualified'])
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            for name in ('macos/release.json', 'engineering/published-release.json'):
                (repo / name).parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / name, repo / name)
            data['base']['sha256'] = '0' * 64
            m.write_json(repo / 'macos/release.json', data)
            with self.assertRaisesRegex(ValueError, 'baseline differs'):
                m.specification(repo)

    def test_seven_editions_verify_after_saved_archive_and_fresh_extraction(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary); root = self.fixture(folder / 'source')
            target = folder / 'candidate.zip'; metadata = self.pack(root, target)
            result = m.verify(target, metadata, folder / 'fresh')
            self.assertEqual(len(result['editions']), 7)
            self.assertTrue(result['freshExtraction'])
            self.assertEqual(result['nativeAcceptance'], 'NOT_RUN')
            self.assertTrue((folder / 'fresh' / m.PREFIX / 'Start.command').stat().st_mode & 0o111)
            with self.assertRaisesRegex(ValueError, 'destination must be absent'):
                m.verify(target, metadata, folder / 'fresh')

    def test_build_is_byte_reproducible_and_preserves_executable_modes(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary); root = self.fixture(folder / 'source')
            a, b = folder / 'a.zip', folder / 'b.zip'
            self.pack(root, a); self.pack(root, b)
            self.assertEqual(m.sha(a), m.sha(b))
            with zipfile.ZipFile(a) as saved:
                self.assertEqual(stat.S_IMODE(saved.getinfo(m.PREFIX + '/Start.command').external_attr >> 16), 0o755)
                self.assertEqual(stat.S_IMODE(saved.getinfo(m.PREFIX + '/README.md').external_attr >> 16), 0o644)
            with self.assertRaisesRegex(ValueError, 'already exists'):
                self.pack(root, a)

    def test_saved_archive_hash_and_size_are_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary); root = self.fixture(folder / 'source')
            target = folder / 'candidate.zip'; metadata = self.pack(root, target)
            metadata['sha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'archive identity'):
                m.verify(target, metadata)
            metadata['sha256'] = m.sha(target); metadata['bytes'] = m.LIMIT
            with self.assertRaisesRegex(ValueError, 'archive identity'):
                m.verify(target, metadata)

    def test_current_source_omitted_from_inventory_fails_even_with_correct_manifests(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary); root = self.fixture(folder / 'source')
            (root / 'unreviewed.mjs').write_text('console.log("unreviewed");\n')
            target = folder / 'candidate.zip'; metadata = self.pack(root, target)
            with self.assertRaisesRegex(ValueError, 'inventory coverage'):
                m.verify(target, metadata)

    def test_nonexecutable_mac_launcher_fails_with_otherwise_valid_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary); root = self.fixture(folder / 'source')
            (root / 'Start.command').chmod(0o644); self.refresh(root)
            target = folder / 'candidate.zip'; metadata = self.pack(root, target)
            with self.assertRaisesRegex(ValueError, 'launcher is not executable'):
                m.verify(target, metadata)

    def test_role_identity_and_coordinated_versions_are_enforced(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary); root = self.fixture(folder / 'source')
            config = root / 'packages/AGI_Node/config/companion-releases.json'
            data = json.loads(config.read_text()); data['role'] = 'agent'; m.write_json(config, data)
            self.refresh(root)
            target = folder / 'candidate.zip'; metadata = self.pack(root, target)
            with self.assertRaisesRegex(ValueError, 'Edition or package version'):
                m.verify(target, metadata)

    def test_symlinks_and_unsafe_role_package_paths_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary); root = self.fixture(folder / 'source')
            (root / 'linked.mjs').symlink_to(root / 'Start.command')
            with self.assertRaisesRegex(ValueError, 'materialized'):
                self.pack(root, folder / 'candidate.zip')
            (root / 'linked.mjs').unlink()
            registry = json.loads((root / 'config/role-registry.json').read_text())
            registry['roles']['agent']['package'] = '../AGI_Agent'
            m.write_json(root / 'config/role-registry.json', registry)
            with self.assertRaisesRegex(ValueError, 'role package path'):
                m.editions(root)

    def test_prior_manifest_bytes_are_saved_without_qualifying_candidate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.fixture(Path(temporary) / 'source')
            before = {role: (app / 'release-manifest.json').read_bytes() for role, app in m.editions(root)}
            m.preserve_history(root, m.specification()['base'])
            for role, app in m.editions(root):
                self.assertEqual((app / 'evidence/history/linux/release-manifest-v1.0.10.json').read_bytes(), before[role])
                self.assertFalse(json.loads((app / 'evidence/history/linux/PUBLIC_BASELINE.json').read_text())['candidateQualification'])
            validation = m.current_manifests(root, m.specification())
            self.assertFalse(validation['productionQualified'])
            self.assertEqual(set(validation['external'].values()), {'NOT_RUN'})
            for _, app in m.editions(root):
                self.assertEqual(json.loads((app / 'release-manifest.json').read_text())['platformEdition'], 'macOS Apple silicon')

    def test_mac_guides_replace_all_entrypoints_and_work_offline(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary); root = self.fixture(folder / 'source'); repo = folder / 'repo'
            (repo / 'engineering').mkdir(parents=True)
            shutil.copyfile(ROOT / 'engineering/build-next-release.py', repo / 'engineering/build-next-release.py')
            for name in m.DOCS:
                file = repo / 'macos/docs' / name; file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('# Mac guide\n\n[Next](FRESH_INSTALL.md)\n')
            for _, app in m.editions(root):
                (app / 'Linux-Guide.txt').write_text('old Linux installation')
            m.add_guides(root, repo, m.VERSION)
            for _, app in m.editions(root):
                self.assertIn('Apple silicon Mac', (app / 'START_HERE.md').read_text())
                self.assertIn('docs/macos-current/FRESH_INSTALL.html', (app / 'START_HERE.html').read_text())
                self.assertIn('href="FRESH_INSTALL.html"', (app / 'docs/macos-current/START_HERE.html').read_text())
                self.assertIn('href="../../START_HERE.html"', (app / 'docs/macos-current/START_HERE.html').read_text())
                self.assertIn('Historical Linux guide', (app / 'Linux-Guide.txt').read_text())
                self.assertEqual((app / 'Historical-Linux-Guide.txt').read_text(), 'old Linux installation')


if __name__ == '__main__':
    unittest.main()
