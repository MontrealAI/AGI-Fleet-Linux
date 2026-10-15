"""Catch reused-input inventory drift before the native Mac preview job."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('mac_preview_inventory_check', ROOT / 'macos/preview/check.py')
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)

class MacPreviewInventory(unittest.TestCase):
    def test_all_current_inputs_match_reviewed_preview_inventory(self):
        expected = json.loads((ROOT / 'macos/preview/source-inventory.json').read_text())
        self.assertEqual(preview.inventory(), expected)
