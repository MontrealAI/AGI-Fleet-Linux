"""Regression fixtures for final-extraction executable gates using the actual Node 24 parser."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('executables', Path(__file__).resolve().parents[1] / 'scripts/validate-executables.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ReleaseExecutables(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.node = os.environ.get('AGI_TEST_NODE24', 'node')

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, name, data):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
        return file

    def run_gate(self):
        return m.validate(self.root, self.node, jobs=2)

    def test_first_byte_hashbang_parses_for_every_js_family(self):
        for suffix in ('js', 'mjs', 'cjs'):
            self.put('entry.' + suffix, b'#!/usr/bin/env node\nconsole.log("ok");\n')
        report = self.run_gate()
        self.assertEqual(report['status'], 'PASS')
        self.assertEqual(report['summary']['nodeChecksPassed'], 3)
        self.assertTrue(all(record['hashbangAtByteZero'] for record in report['files']))
        self.assertTrue(report['runtime']['version'].startswith('v24.'))

    def test_import_before_hashbang_reproduces_release_failure(self):
        self.put('broken.mjs', b'import fs from "node:fs";\n#!/usr/bin/env node\n')
        report = self.run_gate()
        self.assertEqual(report['status'], 'FAIL')
        record = report['files'][0]
        self.assertEqual(record['misplacedHashbangs'][0]['line'], 2)
        self.assertEqual(record['nodeCheck']['status'], 'FAIL')
        self.assertIn('SyntaxError', record['nodeCheck']['stderr'])

    def test_literal_bytes_inside_valid_strings_and_comments_fail(self):
        self.put('string.mjs', b'export const text = "#!/bin/sh";\n')
        self.put('comment.js', b'// misplaced #! marker\n')
        report = self.run_gate()
        self.assertEqual(report['summary']['nodeChecksPassed'], 2)
        self.assertEqual(report['summary']['misplacedHashbangFiles'], 2)
        self.assertEqual(report['status'], 'FAIL')

    def test_equivalent_escaped_literal_passes(self):
        self.put('string.mjs', b'export const text = "\\x23!/bin/sh";\n')
        self.assertEqual(self.run_gate()['status'], 'PASS')

    def test_bom_or_whitespace_before_hashbang_fails_byte_zero_rule(self):
        for name, prefix in [('bom', b'\xef\xbb\xbf'), ('space', b' '), ('line', b'\n')]:
            self.put(name + '.mjs', prefix + b'#!/usr/bin/env node\n')
        report = self.run_gate()
        self.assertEqual(report['summary']['misplacedHashbangFiles'], 3)
        self.assertEqual(report['summary']['fail'], 3)

    def test_dependencies_tests_and_historical_evidence_are_included(self):
        for name in ('node_modules/a/a.js', 'tests/a.mjs', 'evidence/history/a.cjs'):
            self.put(name, b'const = ;\n')
        report = self.run_gate()
        self.assertEqual(report['summary']['files'], 3)
        self.assertEqual(report['summary']['nodeChecksPassed'], 0)

    def test_multiple_hashbangs_all_reported(self):
        data = b'#!/usr/bin/env node\n"#!"; // #!\n'
        self.assertEqual(len(m.misplaced_hashbangs(data)), 2)
        self.assertTrue(all(item['byteOffset'] > 0 for item in m.misplaced_hashbangs(data)))

    def test_empty_tree_and_symbolic_links_rejected(self):
        with self.assertRaisesRegex(ValueError, 'empty validation'):
            self.run_gate()
        file = self.put('target.txt', b'console.log("ok");\n')
        (self.root / 'link.mjs').symlink_to(file)
        report = self.run_gate()
        self.assertEqual(report['status'], 'FAIL')
        self.assertIn('Symbolic link', report['files'][0]['error'])


if __name__ == '__main__':
    unittest.main()
