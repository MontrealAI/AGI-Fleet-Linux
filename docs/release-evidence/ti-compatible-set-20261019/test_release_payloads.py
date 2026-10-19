"""Benign stdlib units only; no release download, install or target code execution."""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location("release_payload_verifier", Path(__file__).with_name("verify-release-payloads.py"))
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)


class PublicDataUnits(unittest.TestCase):
    def test_regular_file_bytes_and_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "public-\N{NON-BREAKING HYPHEN}.txt"
            path.write_bytes(b"ordinary public fixture\n")
            path.chmod(0o644)
            self.assertEqual(VERIFIER.regular_bytes(path, 24), (b"ordinary public fixture\n", 0o644))

    def test_ordinary_read_bound(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "public.txt"
            path.write_bytes(b"123456789")
            with self.assertRaisesRegex(ValueError, "FILE_BOUND"):
                VERIFIER.regular_bytes(path, 8)

    def test_canonical_public_log_frame(self):
        raw = VERIFIER.canonical({"public": "\N{NON-BREAKING HYPHEN}", "rows": list(range(3000))})
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            VERIFIER.emit(raw)
        lines = output.getvalue().splitlines()
        begin = json.loads(lines[0].removeprefix("ALPHA_PAYLOAD_RECEIPT_BEGIN "))
        self.assertEqual(lines[-1], "ALPHA_PAYLOAD_RECEIPT_END " + hashlib.sha256(raw).hexdigest())
        pieces = []
        for index, line in enumerate(lines[1:-1], 1):
            prefix = "ALPHA_PAYLOAD_RECEIPT_PART " + str(index) + "/" + str(begin["chunks"]) + " "
            self.assertTrue(line.startswith(prefix))
            encoded = line.removeprefix(prefix)
            self.assertLessEqual(len(encoded), 8000)
            pieces.append(base64.b64decode(encoded, validate=True))
        self.assertEqual(len(pieces), begin["chunks"])
        self.assertEqual(b"".join(pieces), raw)
        self.assertEqual(begin["bytes"], len(raw))
        self.assertEqual(begin["sha256"], hashlib.sha256(raw).hexdigest())

    def test_record_payload_and_empty_self(self):
        value = b"ordinary public data\n"
        encoded = base64.urlsafe_b64encode(hashlib.sha256(value).digest()).rstrip(b"=").decode()
        raw = ("alpha_factory_v1/public.txt,sha256=" + encoded + "," + str(len(value))
               + "\nalpha_factory_v1-1.2.3.dist-info/RECORD,,\n").encode()
        entries = VERIFIER.parse_record(raw, {"alpha_factory_v1/public.txt", "alpha_factory_v1-1.2.3.dist-info/RECORD"},
                                        "alpha_factory_v1-1.2.3.dist-info/RECORD")
        self.assertTrue(VERIFIER.check_record_entry(entries["alpha_factory_v1/public.txt"], value))

    def test_complete_small_pure_wheel_inventory(self):
        dist = "alpha_factory_v1-1.2.3.dist-info"
        files = {
            "alpha_factory_v1/public.txt": b"ordinary public data\n",
            dist + "/METADATA": b"Metadata-Version: 2.4\nName: alpha-factory-v1\nVersion: 1.2.3\n",
            dist + "/WHEEL": b"Wheel-Version: 1.0\nGenerator: benign-unit\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
        }
        records = []
        for name, data in files.items():
            digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
            records.append(name + ",sha256=" + digest + "," + str(len(data)))
        records.append(dist + "/RECORD,,")
        files[dist + "/RECORD"] = ("\n".join(records) + "\n").encode()
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in files.items():
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(info, data)
        values, modes, record, actual_dist = VERIFIER.wheel_files(buffer.getvalue(), "1.2.3")
        self.assertEqual(values, files)
        self.assertEqual(set(modes.values()), {0o644})
        self.assertEqual(set(record), set(files))
        self.assertEqual(actual_dist, dist)

    def test_installed_record_row_bound(self):
        ordinary = "".join("public/" + str(index) + ".txt,,\n" for index in range(8192)).encode()
        self.assertEqual(len(VERIFIER.parse_record(ordinary)), 8192)
        with self.assertRaisesRegex(ValueError, "RECORD_ROW_BOUND"):
            VERIFIER.parse_record(ordinary + b"public/extra.txt,,\n")

    def test_exact_legacy_mode_exception_set(self):
        self.assertEqual(VERIFIER.LEGACY_MODES, {
            "alpha_factory_v1/demos/alpha_agi_business_v1/scripts/setup_config.py",
            "alpha_factory_v1/demos/alpha_agi_insight_v0/official_demo.py",
            "alpha_factory_v1/demos/alpha_agi_insight_v1/tools/export_tree.py",
        })
        self.assertEqual(VERIFIER.relative("alpha_factory_v1/ui/trace\N{NON-BREAKING HYPHEN}graph.html").as_posix(),
                         "alpha_factory_v1/ui/trace\N{NON-BREAKING HYPHEN}graph.html")


if __name__ == "__main__":
    unittest.main()
