"""Benign public-package metadata checks; no hosted/native qualification.

These complete tiny archives are ordinary synthetic unit metadata. They do not
supply Git provenance, installed product evidence or a connected journey.
"""
import hashlib
from pathlib import Path
import runpy
import stat
import tempfile
import unittest
import zipfile

COMMON = runpy.run_path(str(Path(__file__).with_name("public_release_common.py")))

class PublicReleaseMetadataTests(unittest.TestCase):
    def test_known_input_blob_and_raw_digests(self):
        observed = COMMON["verify_input_blob"](
            b"hello\n", "ce013625030ba8dba906f756967f9e9ca394464a",
            "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03", 6)
        self.assertEqual(observed["bytes"], 6)
        self.assertEqual(observed["gitBlob"], COMMON["git_blob"](b"hello\n"))

    def test_complete_tiny_source_members_bytes_and_modes(self):
        public = {"README.txt": (b"Public package\n", "100644", 0),
                  "bin/public-tool": (b"#!/bin/sh\nprintf public\\n\n", "100755", stat.S_IFREG | 0o755)}
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "public-source.zip"
            with zipfile.ZipFile(archive, "w") as output:
                for name, (raw, _, mode) in public.items():
                    info = zipfile.ZipInfo("public-source/" + name)
                    info.create_system = 3
                    info.external_attr = (mode << 16) or 0x20
                    output.writestr(info, raw)
            entries = COMMON["inspect_zip"](archive)
            tracked = {name: {"mode": mode, "blob": hashlib.sha1(
                b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()}
                for name, (raw, mode, _) in public.items()}
            selected = COMMON["source_members"](entries, "public-source/", tracked)
            self.assertEqual(set(selected), set(public))
            with zipfile.ZipFile(archive) as source:
                for name, expected in tracked.items():
                    raw = source.read("public-source/" + name)
                    declared, effective = COMMON["source_member_identity"](
                        raw, selected[name], expected, "alpha", name)
                    self.assertEqual(raw, public[name][0])
                    self.assertEqual(effective, stat.S_IFREG | (0o755 if name.startswith("bin/") else 0o644))
                    self.assertEqual(declared, (stat.S_IFREG | 0o755) if name.startswith("bin/") else None)

if __name__ == "__main__":
    unittest.main()
