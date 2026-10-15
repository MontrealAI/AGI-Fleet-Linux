#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('demo_directory', Path(__file__).with_name('build-demo-directory.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DirectoryTests(unittest.TestCase):
    def test_generated_inventory_and_pages_are_current(self):
        module.generate(check=True)

    def test_official_launchers_and_singular_example_names_are_discoverable(self):
        paths = [
            'fleet/packages/AGI_Node/Launch-Demo.sh',
            'fleet/packages/AGI_Node/Launch-Demo.command',
            'fleet/packages/AGI_Node/Launch-Demo.cmd',
            'fleet/packages/AGI_Agent/agent.config.example.json',
            'fleet/packages/AGI_Node/ops/agi-node.service.example',
            'fleet/src/economics/lifecycle-example.json',
            'fleet/config/SAMPLE.yaml',
        ]
        self.assertEqual(module.named_examples(paths), sorted(paths))
        self.assertEqual(module.named_examples([
            'fleet/src/demographics.json', 'fleet/config/sampleable.json',
            *module.DIRECTORY_ASSETS, 'successor/history/old/examples/report.json',
        ]), [])

    def test_future_launcher_or_singular_example_cannot_silently_escape_the_catalog(self):
        tracked = module.subprocess.check_output(['git', 'ls-files', '-z'], cwd=module.ROOT, text=True)
        for name in ['fleet/Launch-Demo.future', 'fleet/new.config.example.json']:
            with self.subTest(name=name), patch.object(module.subprocess, 'check_output', return_value=tracked + name + '\0'):
                with self.assertRaisesRegex(ValueError, 'Unmapped named examples'):
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
