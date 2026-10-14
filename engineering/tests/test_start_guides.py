import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
GUIDES = ('docs/START_HERE.md', 'docs/COMMENCER_ICI.md')


class StartingGuidesTests(unittest.TestCase):
    def test_both_guides_are_discoverable_from_readme(self):
        readme = (ROOT / 'README.md').read_text()
        for guide in GUIDES:
            with self.subTest(guide=guide): self.assertIn('](' + guide + ')', readme)

    def test_all_local_guide_destinations_exist(self):
        for guide in GUIDES:
            path = ROOT / guide
            for target in re.findall(r'\[[^\]]+\]\(([^\s)]+)\)', path.read_text()):
                if target.startswith(('https://', 'http://', '#')): continue
                destination = (path.parent / target.split('#', 1)[0]).resolve()
                with self.subTest(guide=guide, target=target):
                    self.assertTrue(destination.is_relative_to(ROOT))
                    self.assertTrue(destination.is_file())

    def test_guides_match_the_published_platform_versions(self):
        linux = json.loads((ROOT / 'engineering/published-release.json').read_text())
        mac = json.loads((ROOT / 'macos/published-release.json').read_text())
        for guide in GUIDES:
            text = (ROOT / guide).read_text()
            with self.subTest(guide=guide):
                self.assertIn('Linux ' + linux['version'], text)
                self.assertIn('Mac ' + mac['version'], text)
                self.assertIn(linux['name'], text)
                self.assertIn('/releases/tag/' + linux['tag'], text)

    def test_languages_link_to_each_other(self):
        self.assertIn('](COMMENCER_ICI.md)', (ROOT / GUIDES[0]).read_text())
        self.assertIn('](START_HERE.md)', (ROOT / GUIDES[1]).read_text())

    def test_integration_publication_claim_matches_the_published_manifest(self):
        release = json.loads((ROOT / 'engineering/published-release.json').read_text())
        guide = (ROOT / 'docs/JOB_INTEGRATION.md').read_text()
        version = re.search(r'\*\*Published release: Linux ([\d.]+)\.\*\*', guide).group(1)
        self.assertEqual(version, release['version'])
        first = guide.split('\n\n')[1]
        self.assertIn(release['integration']['commit'], first)
        candidate = json.loads((ROOT / 'engineering/next-release.json').read_text())
        self.assertIn(candidate['integration']['commit'], guide)

    def test_developer_guide_names_the_current_publication_notes(self):
        release = json.loads((ROOT / 'engineering/next-release.json').read_text())
        notes = 'docs/RELEASE_NOTES_' + release['version'].replace('.', '_') + '.md'
        self.assertIn('`' + notes + '`', (ROOT / 'docs/DEVELOPMENT.md').read_text())
        self.assertTrue((ROOT / notes).is_file())


if __name__ == '__main__':
    unittest.main()
