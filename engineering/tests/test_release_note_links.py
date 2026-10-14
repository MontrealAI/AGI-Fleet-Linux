import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release_note_links import render_release_note_links


class ReleaseNoteLinksTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'docs/NOTES.md'
        self.source.parent.mkdir()
        self.source.write_text('Original offline notes\n')
        for relative in ['docs/FRESH_INSTALL.md', 'successor/docs/GUIDE.md', 'docs/guide with spaces.md', 'docs/picture.png']:
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('Fixture\n')
        self.commit = 'a' * 40
        self.base = 'https://github.com/MontrealAI/AGI-Fleet-Linux/blob/' + self.commit + '/'

    def render(self, text, **options):
        arguments = dict(root=self.root, source='docs/NOTES.md', repository='MontrealAI/AGI-Fleet-Linux', commit=self.commit)
        arguments.update(options)
        return render_release_note_links(text, **arguments)

    def test_current_guide_paths_are_commit_pinned(self):
        text = '[Guide](../successor/docs/GUIDE.md) and [Install](FRESH_INSTALL.md).\n'
        self.assertEqual(self.render(text), f'[Guide]({self.base}successor/docs/GUIDE.md) and [Install]({self.base}docs/FRESH_INSTALL.md).\n')

    def test_external_urls_and_same_document_anchors_are_unchanged(self):
        text = '[Web](https://example.org/path) [Mail](mailto:user@example.org) [Anchor](#scope) [CDN](//example.org/a)\n'
        self.assertEqual(self.render(text), text)

    def test_fragments_queries_and_titles_are_retained(self):
        self.assertEqual(self.render('[Guide](FRESH_INSTALL.md?plain=1#prepare "Install")'), f'[Guide]({self.base}docs/FRESH_INSTALL.md?plain=1#prepare "Install")')

    def test_angle_destinations_and_encoded_names(self):
        self.assertEqual(self.render('[Guide](<guide with spaces.md>)'), f'[Guide](<{self.base}docs/guide%20with%20spaces.md>)')
        self.assertEqual(self.render('[Guide](guide%20with%20spaces.md)'), f'[Guide]({self.base}docs/guide%20with%20spaces.md)')

    def test_reference_definition_uses_source_commit(self):
        self.assertEqual(self.render('[install]: FRESH_INSTALL.md "Install"\n'), f'[install]: {self.base}docs/FRESH_INSTALL.md "Install"\n')

    def test_image_uses_raw_source_bytes(self):
        expected = f'![Diagram](https://raw.githubusercontent.com/MontrealAI/AGI-Fleet-Linux/{self.commit}/docs/picture.png)'
        self.assertEqual(self.render('![Diagram](picture.png)'), expected)

    def test_code_examples_remain_unchanged(self):
        for text in ['`[Example](absent.md)`\n', '``[Example](absent.md)``\n', '```md\n[Example](absent.md)\n```\n', '~~~md\n[Example](absent.md)\n~~~\n', '    [Example](absent.md)\n', '\t[Example](absent.md)\n']:
            with self.subTest(text=text): self.assertEqual(self.render(text), text)

    def test_relative_link_outside_code_is_still_relocated(self):
        self.assertEqual(self.render('`[Example](absent.md)` [Install](FRESH_INSTALL.md)'), f'`[Example](absent.md)` [Install]({self.base}docs/FRESH_INSTALL.md)')

    def test_missing_destination_stops_preparation(self):
        with self.assertRaises(FileNotFoundError): self.render('[Broken](missing.md)')

    def test_invalid_source_and_mutable_ref_are_rejected(self):
        for commit in ['main', 'abcdef0', 'A' * 40, 'a' * 39, 'a' * 41, None]:
            with self.subTest(commit=commit), self.assertRaises(ValueError): self.render('', commit=commit)
        with self.assertRaises(ValueError): self.render('', repository='../../another/repository')

    def test_absolute_and_encoded_backslash_paths_are_rejected(self):
        for path in ['/etc/passwd', 'foo%5cbar.md', 'foo%00bar.md']:
            with self.subTest(path=path), self.assertRaises(ValueError): self.render('[Unsafe](' + path + ')')

    def test_traversal_and_symlink_escape_are_rejected(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside) / 'outside.md'; target.write_text('Outside')
            (self.source.parent / 'escape.md').symlink_to(target)
            with self.assertRaises(ValueError): self.render('[Unsafe](escape.md)')
            relative = '../../' + Path(outside).name + '/outside.md'
            with self.assertRaises(ValueError): self.render('[Unsafe](' + relative + ')')

    def test_offline_source_bytes_are_unchanged(self):
        before = self.source.read_bytes()
        self.render('[Install](FRESH_INSTALL.md)')
        self.assertEqual(self.source.read_bytes(), before)

    def test_rendering_is_idempotent(self):
        once = self.render('[Guide](../successor/docs/GUIDE.md)')
        self.assertEqual(self.render(once), once)


if __name__ == '__main__':
    unittest.main()
