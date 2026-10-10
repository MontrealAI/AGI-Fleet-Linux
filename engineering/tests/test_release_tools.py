import importlib.util
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release_tools import extract, members, verify_archive, verify_source


class ArchiveSafety(unittest.TestCase):
    def make(self, root, names, mode=stat.S_IFREG | 0o755):
        path = root / 'input.zip'
        with zipfile.ZipFile(path, 'w') as archive:
            for name in names:
                entry = zipfile.ZipInfo(name)
                entry.create_system = 3
                entry.external_attr = mode << 16
                archive.writestr(entry, b'#!/bin/sh\nexit 0\n')
        return path

    def test_unsafe_paths_and_links_do_not_escape(self):
        for name, mode in [('../escaped', stat.S_IFREG), ('/absolute', stat.S_IFREG),
                           ('a\\b', stat.S_IFREG), ('a/./b', stat.S_IFREG), ('a//b', stat.S_IFREG),
                           ('link', stat.S_IFLNK | 0o777)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                archive = self.make(root, [name], mode)
                with self.assertRaises(ValueError):
                    extract(archive, root / 'out')
                self.assertFalse((root / 'out').exists())

    def test_case_collisions_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = self.make(root, ['A/file', 'a/FILE'])
            with self.assertRaises(ValueError):
                extract(archive, root / 'out')

    def test_existing_destination_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = self.make(root, ['file'])
            destination = root / 'out'
            destination.mkdir()
            (destination / 'operator-data').write_text('preserve')
            with self.assertRaises(ValueError):
                extract(archive, destination)
            self.assertEqual((destination / 'operator-data').read_text(), 'preserve')

    def test_source_selection_and_executable_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = self.make(root, ['code/run.sh', 'historical/report.txt'])
            extract(archive, root / 'out', {'code/run.sh'})
            self.assertTrue((root / 'out/code/run.sh').stat().st_mode & 0o111)
            self.assertFalse((root / 'out/historical').exists())

    def test_missing_selected_member_fails_without_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = self.make(root, ['code'])
            with self.assertRaises(ValueError):
                extract(archive, root / 'out', {'missing'})
            self.assertFalse((root / 'out').exists())

    def test_symlink_destination_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = self.make(root, ['code'])
            (root / 'out').symlink_to(root / 'absent', target_is_directory=True)
            with self.assertRaises(ValueError):
                extract(archive, root / 'out')
            self.assertTrue((root / 'out').is_symlink())

    def test_wrong_release_is_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = self.make(Path(temporary), ['code'])
            with self.assertRaisesRegex(ValueError, 'identity mismatch'):
                verify_archive(archive)

    def test_mirror_cannot_replace_its_own_trust_anchor(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'source-inventory.json').write_text(json.dumps({'revisionSHA256': '0' * 64, 'files': []}))
            with self.assertRaisesRegex(ValueError, 'Frozen source revision'):
                verify_source(root)


if __name__ == '__main__':
    unittest.main()
