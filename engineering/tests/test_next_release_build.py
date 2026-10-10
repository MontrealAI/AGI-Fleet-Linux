import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
spec = importlib.util.spec_from_file_location('next_release_build', Path(__file__).resolve().parents[1] / 'build-next-release.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class CandidateBuilder(unittest.TestCase):
    def mirror(self, root, values):
        records = []
        for name, content in sorted(values.items()):
            file = root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(content)
            file.chmod(0o755 if name.endswith('.sh') else 0o644)
            records.append({'path': name, 'sha256': hashlib.sha256(content).hexdigest(), 'executable': name.endswith('.sh')})
        data = {'schema': 'agi-source-inventory/v1', 'files': records,
                'revisionSHA256': hashlib.sha256(json.dumps(records, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}
        m.write_json(root / 'source-inventory.json', data)
        return data

    def test_reviewed_inventory_requires_exact_content_modes_and_coverage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = self.mirror(root, {'run.sh': b'#!/bin/sh\n'})
            self.assertEqual(m.inventory(root, data['revisionSHA256'], 1), data)
            (root / 'extra').write_text('unreviewed')
            with self.assertRaisesRegex(ValueError, 'coverage'):
                m.inventory(root)
            (root / 'extra').unlink()
            (root / 'run.sh').chmod(0o644)
            with self.assertRaisesRegex(ValueError, 'source differs'):
                m.inventory(root)

    def test_mirror_symlinks_cannot_supply_reviewed_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.mirror(root, {'file': b'source'})
            (root / 'file').rename(root / 'real')
            (root / 'file').symlink_to(root / 'real')
            with self.assertRaisesRegex(ValueError, 'Unsafe or missing'):
                m.inventory(root)

    def test_overlay_removes_deleted_source_and_preserves_frozen_dependencies(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            root, source = folder / 'baseline', folder / 'source'
            root.mkdir(); source.mkdir()
            self.mirror(root, {'obsolete.mjs': b'obsolete', 'keep.mjs': b'old'})
            data = self.mirror(source, {'keep.mjs': b'new', 'start.sh': b'#!/bin/sh\n'})
            (root / 'node_modules').mkdir(); (root / 'node_modules/frozen').write_text('preserved')
            m.overlay_source(root, source, data['files'])
            self.assertFalse((root / 'obsolete.mjs').exists())
            self.assertEqual((root / 'keep.mjs').read_bytes(), b'new')
            self.assertEqual((root / 'node_modules/frozen').read_text(), 'preserved')
            self.assertTrue((root / 'start.sh').stat().st_mode & 0o111)

    def test_unsafe_inventory_path_rejected_even_when_digest_matches(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = self.mirror(root, {'run.sh': b'echo pass\n'})
            data['files'][0]['path'] = '../run.sh'
            data['revisionSHA256'] = hashlib.sha256(json.dumps(data['files'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            m.write_json(root / 'source-inventory.json', data)
            with self.assertRaisesRegex(ValueError, 'Unsafe candidate'):
                m.inventory(root)

    def test_offline_renderer_escapes_active_content_and_keeps_commands_readable(self):
        source = '# Start Here\n\n[Guide](docs/FRESH_INSTALL.md#accounts)\n\n```sh\necho "<test>"\n```\n\n<script>alert(1)</script>\n\n| Stage | Status |\n| --- | --- |\n| Native | Pending |\n'
        rendered = m.render_markdown(source)
        self.assertIn('href="docs/FRESH_INSTALL.html#accounts"', rendered)
        self.assertIn('id="start-here"', rendered)
        self.assertIn('echo &quot;&lt;test&gt;&quot;', rendered)
        self.assertNotIn('<script>', rendered)
        self.assertIn('<table>', rendered)
        self.assertIn(hashlib.sha256(source.encode()).hexdigest(), rendered)
        self.assertNotIn('href="javascript:', m.inline('[bad](javascript:alert)'))
        self.assertIn('<code>hello</code>', m.inline('[`hello`](guide.md)'))
        self.assertNotIn('\x01', m.inline('[`hello`](guide.md)'))

    def edition_fixture(self, root):
        registry = {role: {'package': 'AGI_' + role.title()} for role in sorted(m.ROLES)}
        m.write_json(root / 'config/role-registry.json', {'roles': registry})
        editions = [('fleet', root)] + [(role, root / 'packages' / entry['package']) for role, entry in registry.items()]
        versions = {role: '1.0.10' for role, _ in editions}
        for role, app in editions:
            for name in ['package.json', 'package-lock.json']:
                m.write_json(app / name, {'version': '1.0.10'})
            m.write_json(app / 'config/companion-releases.json', {**versions, 'role': role})
            m.write_json(app / 'release-manifest.json', {'version': '1.0.9', 'nativeAcceptance': 'PASS', 'productionQualified': True})
        return editions

    def test_new_manifests_do_not_reuse_previous_acceptance(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            editions = self.edition_fixture(root)
            m.update_manifests(root, '1.0.10', 1791583200)
            for role, app in editions:
                current = json.loads((app / 'release-manifest.json').read_text())
                history = json.loads((app / 'evidence/history/linux/release-manifest-v1.0.9.json').read_text())
                self.assertEqual(history['nativeAcceptance'], 'PASS')
                self.assertNotIn('nativeAcceptance', current)
                self.assertFalse(current['productionQualified'])
                self.assertEqual(current['localValidation']['status'], 'PENDING_SAVED_ARCHIVE_NATIVE_VALIDATION')
                self.assertEqual(set(current['physicalQualification'].values()), {'NOT_RUN'})

    def test_mismatched_role_version_cannot_be_built(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.edition_fixture(root)
            m.write_json(root / 'packages/AGI_Agent/package.json', {'version': '1.0.9'})
            with self.assertRaisesRegex(ValueError, 'edition version differs'):
                m.update_manifests(root, '1.0.10', 1791583200)


if __name__ == '__main__':
    unittest.main()
