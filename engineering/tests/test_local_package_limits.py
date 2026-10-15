"""Packaging must reject bytes the local runtime cannot identify."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('local_package_limits', ROOT / 'local-runtime/package.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)

class LocalPackageLimits(unittest.TestCase):
    def test_runtime_source_limit_matches_and_accepts_exact_boundary(self):
        runtime = (ROOT / 'local-runtime/supervisor/runtime.mjs').read_text()
        self.assertIn('s.size<=8_000_000', runtime)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            member = root / 'member'
            with member.open('wb') as stream:
                stream.truncate(package.MAX_RUNTIME_SOURCE_BYTES)
            with patch.object(package, 'ROOT', root):
                self.assertEqual(len(package.source_bytes(member, 'fleet/node_modules')), 8_000_000)

    def test_oversized_dependency_stops_before_archive_or_git(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'source'; root.mkdir()
            (root / 'local-runtime').mkdir()
            member = root / 'local-runtime/oversized-source'
            with member.open('wb') as stream:
                stream.truncate(package.MAX_RUNTIME_SOURCE_BYTES + 1)
            output = Path(temporary) / 'output'
            with patch.object(package, 'ROOT', root), patch.object(package.subprocess, 'check_output') as git:
                with self.assertRaisesRegex(ValueError, '--omit=dev'):
                    package.build(output)
                git.assert_not_called()
            self.assertFalse(output.exists())
