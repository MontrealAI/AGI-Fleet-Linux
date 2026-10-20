"""Deterministic generic JSON transport tests; no fabricated hosted receipt."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("alpha_receipt_ingestion", Path(__file__).with_name("ingest-alpha-receipt.py"))
INGEST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INGEST)


def frame(raw, *, stamp=False):
    count = (len(raw) + 5999) // 6000
    digest = hashlib.sha256(raw).hexdigest()
    header = {"schema": INGEST.SCHEMA, "bytes": len(raw), "sha256": digest, "chunks": count}
    lines = ["ALPHA_PAYLOAD_RECEIPT_BEGIN " + INGEST.canonical(header).decode()]
    for index in range(count):
        value = base64.b64encode(raw[index * 6000:(index + 1) * 6000]).decode()
        lines.append("ALPHA_PAYLOAD_RECEIPT_PART " + str(index + 1) + "/" + str(count) + " " + value)
    lines.append("ALPHA_PAYLOAD_RECEIPT_END " + digest)
    if stamp:
        lines = ["2026-10-19T22:01:02.1234567Z " + line for line in lines]
    return lines


class GenericTransportUnits(unittest.TestCase):
    def setUp(self):
        self.raw = INGEST.canonical({"kind": "GENERIC_TRANSPORT_UNIT", "data": list(range(3000))})
        self.lines = frame(self.raw)

    def refused(self, lines):
        with self.assertRaises(INGEST.IngestionError):
            INGEST.decode_log("\n".join(lines) + "\n")

    def test_exact_plain_canonical_bytes(self):
        raw = INGEST.canonical({"kind": "GENERIC_TRANSPORT_UNIT", "value": "\N{NON-BREAKING HYPHEN}"})
        actual, value, transport = INGEST.decode_log("\n".join(frame(raw)) + "\n")
        self.assertEqual(actual, raw)
        self.assertEqual(value["kind"], "GENERIC_TRANSPORT_UNIT")
        self.assertEqual(transport["receiptSha256"], hashlib.sha256(raw).hexdigest())
        self.assertIs(transport["networkOrProducerAuthenticationPerformed"], False)
        self.assertEqual(transport["prefixStyle"], "PLAIN")

    def test_timestamped_multichunk_and_normal_job_continuation(self):
        lines = ["2026-10-19T22:01:01.000Z Normal step output"] + frame(self.raw, stamp=True)
        lines += ["2026-10-19T22:01:03.000Z Normal artifact step"]
        raw, value, transport = INGEST.decode_log("\r\n".join(lines) + "\r\n")
        self.assertEqual(raw, self.raw)
        self.assertEqual(value["data"], list(range(3000)))
        self.assertEqual(transport["beginLine"], 2)
        self.assertEqual(transport["endLine"], len(lines) - 1)
        self.assertEqual(transport["prefixStyle"], "GITHUB_ISO_TIMESTAMP")
        self.assertEqual(transport["chunks"], 3)

    def test_missing_duplicate_reordered_and_extra_frames_refuse(self):
        changes = [
            self.lines[1:], self.lines[:-1],
            [self.lines[0], *self.lines],
            [self.lines[0], self.lines[1], *self.lines[1:]],
            [self.lines[0], self.lines[2], self.lines[1], *self.lines[3:]],
            [*self.lines, self.lines[-1]],
            [*self.lines, self.lines[1]],
            [*self.lines, *frame(INGEST.canonical({"kind": "ANOTHER_GENERIC_UNIT"}))],
            [self.lines[0], "ordinary unexpected line", *self.lines[1:]],
        ]
        for lines in changes:
            with self.subTest(lines=len(lines)):
                self.refused(lines)

    def test_declared_counts_length_digest_and_trailing_text_refuse(self):
        header = json.loads(self.lines[0].removeprefix("ALPHA_PAYLOAD_RECEIPT_BEGIN "))
        for key, value in (("bytes", header["bytes"] + 1), ("chunks", 1), ("sha256", "0" * 64)):
            changed = dict(header)
            changed[key] = value
            self.refused(["ALPHA_PAYLOAD_RECEIPT_BEGIN " + INGEST.canonical(changed).decode(), *self.lines[1:]])
        self.refused([*self.lines[:-1], self.lines[-1] + " trailing"])
        self.refused([self.lines[0] + " ", *self.lines[1:]])
        self.refused([self.lines[0], self.lines[1] + " ", *self.lines[2:]])
        self.refused([*self.lines[:-1], "ALPHA_PAYLOAD_RECEIPT_END " + "0" * 64])

    def test_parts_require_exact_index_total_and_canonical_base64(self):
        original = self.lines[1]
        for changed in (
            original.replace(" 1/3 ", " 2/3 ", 1),
            original.replace(" 1/3 ", " 1/2 ", 1),
            original + "=",
            original.replace(" 1/3 ", " 0/3 ", 1),
            original[:-1] + "!",
        ):
            self.refused([self.lines[0], changed, *self.lines[2:]])
        # Same decoded byte, non-zero unused base64 pad bits: strict decoder alone accepts it.
        raw = b"0"
        lines = frame(raw)
        lines[1] = "ALPHA_PAYLOAD_RECEIPT_PART 1/1 MB=="
        self.refused(lines)

    def test_generic_json_must_be_canonical_unique_and_finite(self):
        for raw in (b'{ "unit":1}', b'{"unit":1,"unit":2}', b'NaN', b'Infinity',
                    b'{"unit":1e999}', b'\xff', b'{} trailing'):
            with self.subTest(raw=raw):
                self.refused(frame(raw))

    def test_marker_prefix_timestamp_and_bounds_are_explicit(self):
        self.refused(["prefix " + self.lines[0], *self.lines[1:]])
        self.refused([self.lines[0], *frame(self.raw, stamp=True)[1:]])
        self.refused(["2026-99-19T22:01:02Z " + self.lines[0], *self.lines[1:]])
        self.refused([self.lines[0], "ALPHA_PAYLOAD_RECEIPT_PARTIAL unit", *self.lines[1:]])
        header = {"schema": INGEST.SCHEMA, "bytes": INGEST.MAX_RECEIPT_BYTES + 1,
                  "sha256": "0" * 64, "chunks": INGEST.MAX_CHUNKS}
        self.refused(["ALPHA_PAYLOAD_RECEIPT_BEGIN " + INGEST.canonical(header).decode()])
        with self.assertRaises(INGEST.IngestionError):
            INGEST.decode_log("\n".join(self.lines), max_log_bytes=10)
        self.refused(["ALPHA_PAYLOAD_RECEIPT_BEGIN " + "{}" + " " * 8200])

    def test_generic_transport_never_becomes_a_hosted_receipt(self):
        text = "\n".join(frame(INGEST.canonical({"kind": "GENERIC_TRANSPORT_UNIT"}))) + "\n"
        raw, generic, _ = INGEST.decode_log(text)
        self.assertTrue(raw)
        with self.assertRaises(INGEST.IngestionError):
            INGEST.inspect_receipt(generic)
        with self.assertRaises(INGEST.IngestionError):
            INGEST.ingest_log(text, None)
        with self.assertRaises(INGEST.IngestionError):
            INGEST.ingest_log(text, {})


if __name__ == "__main__":
    unittest.main()
