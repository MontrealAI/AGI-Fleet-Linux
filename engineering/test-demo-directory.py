#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('demo_directory', Path(__file__).with_name('build-demo-directory.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DirectoryTests(unittest.TestCase):
    def test_generated_inventory_and_pages_are_current(self):
        module.generate(check=True)

    def test_source_paths_must_be_tracked_relative_files(self):
        module.validate_source('README.md', {'README.md'})
        with self.assertRaises(ValueError):
            module.validate_source('README.md', set())
        for path in ['../README.md', '/etc/passwd', 'missing.md', 'a/../../README.md']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                module.validate_source(path, {path})

    def test_symlink_escape_is_rejected_even_if_named_as_tracked(self):
        previous = module.ROOT
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'repo'
            root.mkdir()
            outside = Path(folder) / 'outside.md'
            outside.write_text('example')
            (root / 'link.md').symlink_to(outside)
            (root / 'outside-dir').symlink_to(Path(folder), target_is_directory=True)
            try:
                module.ROOT = root
                with self.assertRaises(ValueError):
                    module.validate_source('link.md', {'link.md'})
                with self.assertRaises(ValueError):
                    module.validate_source('outside-dir/outside.md', {'outside-dir/outside.md'})
            finally:
                module.ROOT = previous


if __name__ == '__main__':
    unittest.main()
