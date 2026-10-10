import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('script_entry_generation', ROOT / 'scripts/script_entry_generation.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
INSERT = MODULE.insert_imports
IMPORT = b"import {setupRole} from '../compute/roles.mjs';"


class ScriptEntryGenerationTests(unittest.TestCase):
    def test_lf_hashbang_stays_at_byte_zero(self):
        source = b'#!/usr/bin/env node\nconsole.log(1);\n'
        self.assertEqual(INSERT(source, [IMPORT]), b'#!/usr/bin/env node\n' + IMPORT + b'\nconsole.log(1);\n')

    def test_crlf_preserved(self):
        source = b'#!/usr/bin/env node\r\nconsole.log(1);\r\n'
        self.assertEqual(INSERT(source, [IMPORT]), b'#!/usr/bin/env node\r\n' + IMPORT + b'\r\nconsole.log(1);\r\n')

    def test_without_hashbang(self):
        self.assertEqual(INSERT(b'console.log(1);\n', [IMPORT]), IMPORT + b'\nconsole.log(1);\n')

    def test_crlf_without_hashbang(self):
        self.assertEqual(INSERT(b'console.log(1);\r\n', [IMPORT]), IMPORT + b'\r\nconsole.log(1);\r\n')

    def test_idempotent_and_no_duplicate_imports(self):
        source = b'#!/usr/bin/env node\nconsole.log(1);\n'
        generated = INSERT(source, [IMPORT, IMPORT])
        self.assertEqual(generated.count(IMPORT), 1)
        self.assertEqual(INSERT(generated, [IMPORT]), generated)

    def test_preserves_import_already_in_body(self):
        source = b'#!/usr/bin/env node\n// retained comment\n' + IMPORT + b'\nconsole.log(1);\n'
        self.assertEqual(INSERT(source, [IMPORT]), source)

    def test_multiple_imports_in_order(self):
        second = b"import fs from 'node:fs';"
        self.assertEqual(INSERT(b'#!/usr/bin/env node\n', [IMPORT, second]), b'#!/usr/bin/env node\n' + IMPORT + b'\n' + second + b'\n')

    def test_hashbang_without_final_newline(self):
        self.assertEqual(INSERT(b'#!/usr/bin/env node', [IMPORT]), b'#!/usr/bin/env node\n' + IMPORT + b'\n')

    def test_empty_source(self):
        self.assertEqual(INSERT(b'', [IMPORT]), IMPORT + b'\n')

    def test_empty_imports_preserve_source(self):
        source = b'#!/usr/bin/env node\nconsole.log(1);'
        self.assertEqual(INSERT(source, []), source)

    def test_rejects_released_defect(self):
        with self.assertRaisesRegex(ValueError, 'byte zero'):
            INSERT(IMPORT + b'\n#!/usr/bin/env node\n', [IMPORT])

    def test_rejects_any_late_hashbang(self):
        for source in (b'\n#!/usr/bin/env node\n', b' #!/usr/bin/env node\n',
                       b'#!/usr/bin/env node\n#!/bin/sh\n', b'console.log("#!");\n'):
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, 'byte zero'):
                INSERT(source, [IMPORT])

    def test_rejects_bom(self):
        for marker in (b'\xef\xbb\xbf', b'\xff\xfe', b'\xfe\xff', b'\x00\x00\xfe\xff'):
            with self.subTest(marker=marker), self.assertRaisesRegex(ValueError, 'byte order'):
                INSERT(marker + b'#!/usr/bin/env node\n', [IMPORT])

    def test_rejects_non_utf8(self):
        with self.assertRaises(UnicodeDecodeError):
            INSERT(b'#!/usr/bin/env node\n\xff', [IMPORT])

    def test_rejects_invalid_generated_imports(self):
        for statement in (b'console.log(1);', b"import 'x'", b"import 'x';\n", b"import 'x';\r", b"import '#!';"):
            with self.subTest(statement=statement), self.assertRaises(ValueError):
                INSERT(b'#!/usr/bin/env node\n', [statement])

    def test_rejects_nonbyte_inputs(self):
        with self.assertRaises(TypeError):
            INSERT('source', [IMPORT])
        with self.assertRaises(TypeError):
            INSERT(b'source', ['import x;'])

    def test_release_templates_generate_all_eight_entries(self):
        entries = MODULE.generated_entries(ROOT / 'shared/runtime')
        self.assertEqual(set(entries), {'agent', 'node', 'moderator', 'employer', 'evidence', 'recovery'})
        self.assertEqual(sum(map(len, entries.values())), 8)
        roles = json.loads((ROOT / 'config/role-registry.json').read_text())['roles']
        for role, destinations in entries.items():
            for name, expected in destinations.items():
                self.assertTrue(expected.startswith(b'#!/usr/bin/env node\nimport '))
                self.assertEqual(expected.count(b'#!'), 1)
                self.assertEqual((ROOT / 'packages' / roles[role]['package'] / name).read_bytes(), expected)

    def test_sync_regenerates_and_check_rejects_drift(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'config').mkdir()
            (root / 'config/role-registry.json').write_text(json.dumps({'roles': {'agent': {'package': 'AGI_Agent'}}}))
            app = root / 'packages/AGI_Agent'
            (app / 'scripts').mkdir(parents=True)
            canonical = root / 'shared/runtime'
            templates = canonical / 'script-entries'
            templates.mkdir(parents=True)
            (templates / 'entry.mjs.template').write_bytes(b'#!/usr/bin/env node\nconsole.log(1);\n')
            manifest = {'schema': 'agi-script-entry-templates/v1', 'entries': [{'template': 'entry.mjs.template', 'output': 'scripts/entry.mjs', 'roles': ['agent'], 'imports': [IMPORT.decode()]}]}
            (templates / 'manifest.json').write_text(json.dumps(manifest))
            entry = app / 'scripts/entry.mjs'
            entry.write_bytes(IMPORT + b'\n#!/usr/bin/env node\nconsole.log(1);\n')
            command = [sys.executable, str(ROOT / 'scripts/sync-shared-runtime.py'), '--root', str(root)]
            generated = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(generated.returncode, 0, generated.stderr)
            self.assertTrue(entry.read_bytes().startswith(b'#!/usr/bin/env node\n' + IMPORT))
            checked = subprocess.run(command + ['--check'], capture_output=True, text=True)
            self.assertEqual(checked.returncode, 0, checked.stderr)
            entry.write_bytes(b'// drift\n' + entry.read_bytes())
            checked = subprocess.run(command + ['--check'], capture_output=True, text=True)
            self.assertNotEqual(checked.returncode, 0)
            self.assertIn('generated-script-entry-divergence', checked.stderr)
            regenerated = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(regenerated.returncode, 0, regenerated.stderr)
            self.assertTrue(entry.read_bytes().startswith(b'#!/usr/bin/env node\n' + IMPORT))


if __name__ == '__main__':
    unittest.main()
