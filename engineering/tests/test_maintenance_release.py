import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import re
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'engineering'))
spec = importlib.util.spec_from_file_location('maintenance_builder', ROOT / 'engineering/build-next-release.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def digest(value):
    return hashlib.sha256(value).hexdigest()


class MaintenanceReleaseTests(unittest.TestCase):
    def setUp(self):
        self.scope = json.loads((ROOT / 'engineering/linux-1.1.1-maintenance-scope.json').read_text())
        self.release = json.loads((ROOT / 'engineering/next-release.json').read_text())
        self.inventory = json.loads((ROOT / 'fleet/source-inventory.json').read_text())

    def test_changed_source_is_complete_and_bound_to_the_previous_inventory(self):
        changes = {row['path']: row for row in self.scope['changedSourceFiles']}
        self.assertEqual(len(changes), len(self.scope['changedSourceFiles']))
        previous = []
        for row in self.inventory['files']:
            if row['path'] in changes:
                self.assertEqual(row['sha256'], changes[row['path']]['afterSHA256'])
                previous.append({**row, 'sha256': changes[row['path']]['beforeSHA256']})
            else:
                previous.append(row)
        encoded = json.dumps(previous, sort_keys=True, separators=(',', ':')).encode()
        self.assertEqual(digest(encoded), self.scope['basisSourceRevisionSHA256'])
        self.assertEqual(self.scope['candidateSourceRevisionSHA256'], self.inventory['revisionSHA256'])
        self.assertEqual(self.release['sourceRevisionSHA256'], self.inventory['revisionSHA256'])
        self.assertEqual(self.scope['sourceFiles'], len(self.inventory['files']))
        self.assertTrue(changes.keys() <= {r['path'] for r in self.inventory['files']})

    def test_every_source_change_is_only_coordinated_version_or_generated_guidance(self):
        for row in self.scope['changedSourceFiles']:
            relative = Path(row['path']); path = ROOT / 'fleet' / relative
            data = path.read_bytes()
            with self.subTest(path=row['path']):
                if relative.name in ('package.json', 'package-lock.json'):
                    value = json.loads(data); self.assertEqual(value['version'], '1.1.1'); value['version'] = '1.1.0'
                    if relative.name == 'package-lock.json':
                        self.assertEqual(value['packages']['']['version'], '1.1.1')
                        value['packages']['']['version'] = '1.1.0'
                    old = (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()
                elif relative.name == 'companion-releases.json':
                    value = json.loads(data)
                    for name in ('fleet', 'agent', 'node', 'moderator', 'employer', 'evidence', 'recovery'):
                        self.assertEqual(value[name], '1.1.1'); value[name] = '1.1.0'
                    old = (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()
                elif relative.name == 'role-registry.json':
                    value = json.loads(data); self.assertEqual(value['fleet'], '1.1.1'); value['fleet'] = '1.1.0'
                    for role in value['roles'].values():
                        self.assertEqual(role['version'], '1.1.1'); role['version'] = '1.1.0'
                    old = (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()
                elif relative.name == 'Info.plist':
                    value = plistlib.loads(data)
                    for field in ('CFBundleVersion', 'CFBundleShortVersionString'):
                        self.assertEqual(value[field], '1.1.1'); value[field] = '1.1.0'
                    old = plistlib.dumps(value, sort_keys=False)
                elif relative.name == 'index.html' and relative.parent.name in ('app', 'web'):
                    old = data.replace(b'data-app-version>1.1.1<', b'data-app-version>1.1.0<').replace(b'id="appVersion">1.1.1<', b'id="appVersion">1.1.0<').replace(
                        b'/AGI-Fleet-Linux/blob/v1.1.1-qualification/', b'/AGI-Fleet-Linux/blob/v1.1.0-qualification/')
                elif len(relative.parts) == 3 and relative.parts[0] == 'packages':
                    if relative.name in ('README.html', 'START_HERE.html', 'Linux-Guide.html'):
                        welcome = (path.parent / 'README.md').read_text().replace('AGI Fleet Linux 1.1.1', 'AGI Fleet Linux 1.1.0')
                        old = builder.render_markdown(welcome).replace('<body>', '<body><span id="agi-fleet-linux-1011"></span>').encode()
                    elif relative.name in ('README.md', 'START_HERE.md', 'Linux-Guide.txt', 'READ_ME_FIRST.txt'):
                        old = data.replace(b'1.1.1', b'1.1.0')
                    else:
                        self.fail('Unexpected generated source path: ' + row['path'])
                else:
                    self.fail('Runtime, dependency or contract changes are not allowed in this maintenance release: ' + row['path'])
                self.assertEqual(digest(old), row['beforeSHA256'])
                self.assertEqual(digest(data), row['afterSHA256'])

    def test_qualification_and_unfinished_work_are_not_promoted(self):
        self.assertFalse(self.release['productionQualified'])
        for field in ('runtimeLogicChanged', 'dependencyVersionsChanged', 'contractArtifactsChanged', 'productionQualified', 'localSkillsIncluded'):
            self.assertIs(self.scope[field], False)
        excluded = {'local-runtime', 'local-dashboard', 'role-skills'}
        self.assertFalse(any(excluded.intersection(Path(row['path']).parts)
                             for row in self.inventory['files']))
        self.assertEqual(self.release['native']['complete'], {'tests': 3908, 'files': 343})
        self.assertEqual(self.release['native']['targeted'], {'tests': 291, 'files': 25})
        published = json.loads((ROOT / 'engineering/published-release.json').read_text())
        self.assertNotEqual(self.release['tag'], 'v1.1.0-qualification')
        if published['tag'] == self.release['tag']:
            self.assertEqual(published['sourceRevisionSHA256'], self.release['sourceRevisionSHA256'])
            self.assertFalse(published['productionQualified'])

    def test_french_offline_guide_declares_language_and_navigation(self):
        page = builder.render_markdown('# Commencer ici\n', language='fr')
        self.assertIn('<html lang="fr">', page)
        self.assertIn('>Commencer ici</a>', page)
        self.assertNotIn('>Start here</a>', page)
        self.assertIn('<html lang="en">', builder.render_markdown('# Start here\n'))
        with self.assertRaisesRegex(ValueError, 'Unsupported guide language'):
            builder.render_markdown('# Guide\n', language='fr" onclick="bad')

    def test_workflow_and_publication_use_only_the_new_release_identity(self):
        for name in ('.github/workflows/next-release.yml', 'engineering/publish-next-release.py'):
            text = (ROOT / name).read_text()
            self.assertNotIn('v1.1.0', text)
            self.assertIn('v1.1.1', text)
        workflow = (ROOT / '.github/workflows/next-release.yml').read_text()
        self.assertIn('cancel-in-progress: false', workflow)
        self.assertIn('needs: [build, native, integration, successor, audit]', workflow)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)
        self.assertIn("paths: ['engineering/next-release.json']", workflow)

    def test_generated_role_guides_match_current_markdown(self):
        for folder in sorted((ROOT / 'fleet/packages').glob('AGI_*')):
            welcome = (folder / 'README.md').read_text()
            expected = builder.render_markdown(welcome).replace(
                '<body>', '<body><span id="agi-fleet-linux-1011"></span>')
            self.assertEqual((folder / 'START_HERE.md').read_text(), welcome)
            for name in ('README.html', 'START_HERE.html', 'Linux-Guide.html'):
                with self.subTest(role=folder.name, guide=name):
                    self.assertEqual((folder / name).read_text(), expected)

    def test_every_static_edition_label_matches_the_candidate(self):
        labels = []
        for folder in [ROOT / 'fleet', *sorted((ROOT / 'fleet/packages').glob('AGI_*'))]:
            for name in ('app/index.html', 'web/index.html'):
                page = folder / name
                if not page.is_file():
                    continue
                found = re.findall(r'(?:id="appVersion"|data-app-version)\s*>\s*([^<]*)', page.read_text())
                for label in found:
                    if label.strip():
                        self.assertEqual(label.strip(), self.release['version'], str(page))
                        labels.append(label.strip())
        self.assertGreaterEqual(len(labels), 3)

    def test_historical_notes_remain_available(self):
        self.assertTrue((ROOT / 'docs/RELEASE_NOTES_1_1_0.md').is_file())
        self.assertTrue((ROOT / 'validation/LINUX_1_1_0_RELEASE_ADDENDUM.md').is_file())
        self.assertIn('PR #26', (ROOT / 'docs/RELEASE_NOTES_1_1_1.md').read_text())

    def test_saved_maintenance_installer_rejects_development_code_at_any_depth(self):
        for relative in ('local-runtime/worker.mjs', 'local-dashboard/app.js',
                         'role-skills/agi-agent/SKILL.md',
                         'packages/AGI_Agent/local-runtime/worker.mjs'):
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as temporary:
                archive = Path(temporary) / 'candidate.zip'
                with zipfile.ZipFile(archive, 'w') as saved:
                    saved.writestr('AGI_Fleet_Linux_v1.1.1/' + relative, 'unqualified fixture')
                with self.assertRaisesRegex(ValueError, 'Local Skills code is excluded'):
                    builder.verify_maintenance_archive(archive)

    def test_saved_maintenance_guidance_can_explain_the_separate_development_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / 'candidate.zip'
            with zipfile.ZipFile(archive, 'w') as saved:
                saved.writestr('AGI_Fleet_Linux_v1.1.1/docs/START_HERE.md',
                               'Local Skills is a separate, unfinished development preview.')
            builder.verify_maintenance_archive(archive)


if __name__ == '__main__':
    unittest.main()
