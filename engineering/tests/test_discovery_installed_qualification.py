# SPDX-License-Identifier: Apache-2.0
"""Inert retained-metadata fixtures; never installed native acceptance evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

import test_discovery_installed_profile as packaging

MODULE = Path(__file__).resolve().parents[1] / "discovery_installed_qualification.py"
spec = importlib.util.spec_from_file_location("discovery_installed_qualification", MODULE)
qualification = importlib.util.module_from_spec(spec)
previous = sys.modules.get("discovery_release")
sys.modules["discovery_release"] = packaging.release
try:
    spec.loader.exec_module(qualification)
finally:
    if previous is None:
        sys.modules.pop("discovery_release")
    else:
        sys.modules["discovery_release"] = previous


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))


class InstalledAudit(unittest.TestCase):
    def setUp(self):
        builder = packaging.InstalledProfile("runTest")
        builder.setUp()
        self.addCleanup(builder.doCleanups)
        fleet, alpha = builder.prepare()
        self.base = builder.base
        self.candidate = self.base / "built/candidate"
        self.candidate.parent.mkdir()
        receipt = packaging.release.build(self.candidate, alpha, root=fleet, mission_input=self.base / "input")
        self.profile_bytes = (fleet / "discovery-lab/release/profile.json").read_bytes()
        profile = json.loads(self.profile_bytes)
        _, _, manifest, manifest_bytes = qualification.candidate_bytes(self.candidate)
        self.expected = {"schema": "agi-fleet/discovery-installed-hosted-provenance/v1", "source": receipt["source"],
                         "workflow": {"GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1"},
                         "candidateSha256": receipt["sha256"],
                         "receiptSha256": qualification.digest((self.candidate / "package-receipt.json").read_bytes()),
                         "profileSha256": qualification.digest(self.profile_bytes)}
        write(self.candidate.parent / "provenance.json", self.expected)
        members = {row["path"]: row for row in manifest["files"]}
        receiver_source = {**receipt["source"], "adapterSha256": members["discovery-lab/receiver.mjs"]["sha256"],
                           "contractSha256": members["discovery-lab/contract.mjs"]["sha256"]}
        self.inputs = {name: (self.base / 'input' / name).read_bytes() for name in qualification.original_input.MEMBERS}
        initial_raw = self.inputs[qualification.original_input.PREFIX + 'fleet-browser-workspace.json']
        initial = json.loads(initial_raw)
        journal = json.loads(self.inputs[qualification.original_input.PREFIX + 'browser-native-requests.json'])
        custody_raw = (self.base / 'input/CUSTODY.json').read_bytes()
        self.reports = []
        for selected in qualification.PROFILES:
            folder = self.base / selected
            self.reports.append(folder)
            write(folder / "provenance.json", self.expected)
            for lane in ("installed-native", "constructed-fixture"):
                is_ui = lane == "installed-native"
                lane_initial = copy.deepcopy(initial)
                if not is_ui:
                    lane_initial['missionId'] = 'separate-inert-constructed-mission'
                    lane_initial['events'][-1]['digest'] = 'd' * 64
                lane_initial_raw = initial_raw if is_ui else json.dumps(lane_initial, sort_keys=True, separators=(',', ':')).encode()
                campaign_digest = journal['campaignDigest'] if is_ui else lane_initial['events'][-1]['digest']
                evidence = folder / lane
                evidence.mkdir()
                (evidence / "initial-workspace.json").write_bytes(lane_initial_raw)
                final = copy.deepcopy(lane_initial)
                final['revision'] += 2
                rows = []
                for currency, route in (("USDC", "manager-usdc"), ("AGIALPHA", "jobs-agialpha")):
                    request = self.inputs[qualification.original_input.PREFIX + ('fleet-browser-request.json' if currency == 'USDC' else 'jobs-browser-request.json')].decode()
                    if not is_ui:
                        request_value = json.loads(request)
                        request_value['missionId'] = lane_initial['missionId']
                        request = json.dumps(request_value)
                    raw = json.dumps({"state": "accepted-local-review", "authority": "none", "remoteExecution": "unprovisioned",
                                      "organizationalIndependence": False, "inertMetadataFixture": True})
                    wrapper = {"raw": json.dumps({"schema": "agi-fleet/discovery-review-return/v1", "original": request,
                                                 "receiptRaw": raw}), "source": receiver_source}
                    prefix = currency.lower()
                    (evidence / (prefix + "-request.json")).write_text(request)
                    write(evidence / (prefix + "-return.json"), wrapper)
                    row = {"currency": currency, "route": route, "receiptId": "inert-fixture-" + currency,
                           "requestSha256": qualification.digest(request.encode()), "receiptSha256": qualification.digest(raw.encode()),
                           "returnSha256": qualification.digest(json.dumps(wrapper, ensure_ascii=False, separators=(",", ":")).encode()),
                           "state": "accepted-local-review"}
                    rows.append(row)
                    final['events'].append({'kind': 'lab-evidence-attached', 'digest': str(len(final['events'])) * 64,
                        'previous': final['events'][-1]['digest'], 'payload': {'kind': 'receiver-receipt',
                            'campaignDigest': campaign_digest, 'record': wrapper,
                            'recordDigest': qualification.digest(json.dumps(wrapper, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode())}})
                    request_workspace_sha256 = qualification.digest(lane_initial_raw)
                    if not is_ui and currency == 'AGIALPHA':
                        intermediate = {**lane_initial, 'events': final['events'][:-1], 'revision': lane_initial['revision'] + 1}
                        request_workspace_sha256 = qualification.digest(json.dumps(intermediate, sort_keys=True, separators=(',', ':')).encode())
                    write(evidence / (prefix + "-installed-observation.json"), {"runtimeProfile": selected,
                          "runtime": profile["runtimeProfiles"][selected], "manifestSha256": qualification.digest(manifest_bytes),
                          "requestSha256": row["requestSha256"], "receiptSha256": row["receiptSha256"], "state": row["state"],
                          "workspaceSha256": request_workspace_sha256})
                write(evidence / "workspace.json", final)
                docket = json.dumps({'files': {'05_agialpha_runs/run.json': json.dumps({'workspace': final}),
                    **{name: 'inert docket metadata' for name in qualification.DOCKET_PATHS if name != '05_agialpha_runs/run.json'}}}).encode()
                (evidence / "docket.json").write_bytes(docket)
                report = {"profile": selected, "fleetSource": receipt["source"],
                      "alpha": {key: profile["alpha"][key] for key in ("commit", "tree", "sourceHash")},
                      "manifestSha256": qualification.digest(manifest_bytes), "passed": 2, "total": 2,
                      "inputKind": "authenticated-alpha-ui-artifact" if is_ui else "constructed-regression-fixture",
                      "missionId": lane_initial['missionId'], "historyHead": final['events'][-1]['digest'],
                      "sameHistory": True, "duplicateRefused": True, "reopenedDocketByteIdentical": True,
                      "authority": "none", "remoteExecution": "unprovisioned", "organizationalIndependence": False,
                      "totalComplete": False, "docketSha256": qualification.digest(docket), "cases": rows}
                if is_ui:
                    report.update(inputCustodySha256=qualification.digest(custody_raw), inputWorkspaceSha256=qualification.digest(initial_raw),
                                  inputEventPrefix=journal['workspace']['eventPrefix'], inputHistoryHead=journal['workspace']['head'],
                                  inputRevision=initial['revision'])
                write(evidence / "qualification.json", report)

    def audit(self, reports=None, expected=None):
        return qualification.audit(self.candidate, self.reports if reports is None else reports, self.profile_bytes,
                                   self.expected if expected is None else expected)

    def test_inert_complete_metadata_keeps_all_publication_and_legacy_gates_held(self):
        report = self.audit()
        self.assertEqual(report["nativeCases"], 4)
        self.assertEqual(report["publication"], "HELD")
        self.assertFalse(report["productionQualified"])
        self.assertEqual(report["legacyReleaseGates"], "SEPARATE_UNCHANGED_REQUIREMENTS")
        self.assertEqual(report["eligibleOwnerReview"], "NOT_ESTABLISHED_BY_THIS_LANE")

    def test_missing_duplicate_or_mixed_workflow_reports_refuse(self):
        for reports in (self.reports[:1], [self.reports[0], self.reports[0]]):
            with self.subTest(reports=reports), self.assertRaises(ValueError):
                self.audit(reports)
        changed = copy.deepcopy(self.expected)
        changed["workflow"]["GITHUB_RUN_ID"] = "another-run"
        write(self.reports[1] / "provenance.json", changed)
        with self.assertRaisesRegex(ValueError, "does not qualify"):
            self.audit()

    def test_wrong_runtime_and_changed_raw_return_refuse(self):
        path = self.reports[0] / "installed-native/usdc-installed-observation.json"
        observation = json.loads(path.read_bytes())
        original = copy.deepcopy(observation)
        observation["runtime"]["binarySha256"] = "0" * 64
        write(path, observation)
        with self.assertRaisesRegex(ValueError, "pinned runtime"):
            self.audit()
        write(path, original)
        path = self.reports[0] / "installed-native/usdc-return.json"
        wrapper = json.loads(path.read_bytes())
        envelope = json.loads(wrapper["raw"])
        envelope["original"] = "changed retained request"
        wrapper["raw"] = json.dumps(envelope)
        write(path, wrapper)
        with self.assertRaisesRegex(ValueError, "observation bytes"):
            self.audit()

    def test_changed_archive_and_docket_cannot_reuse_report(self):
        docket = self.reports[0] / "installed-native/docket.json"
        docket.write_text("changed metadata fixture")
        with self.assertRaisesRegex(ValueError, "docket"):
            self.audit()
        archive = self.candidate / (packaging.release.PREFIX + ".zip")
        archive.write_bytes(archive.read_bytes() + b"changed")
        with self.assertRaisesRegex(ValueError, "Candidate bytes"):
            self.audit()

    def test_constructed_history_and_changed_original_prefix_cannot_replace_ui_input(self):
        report_path = self.reports[0] / 'installed-native/qualification.json'
        report = json.loads(report_path.read_bytes())
        report['inputKind'] = 'constructed-regression-fixture'
        write(report_path, report)
        with self.assertRaisesRegex(ValueError, 'does not qualify'):
            self.audit()
        report['inputKind'] = 'authenticated-alpha-ui-artifact'
        write(report_path, report)
        path = self.reports[0] / 'installed-native/workspace.json'
        final = json.loads(path.read_bytes())
        final['events'][0]['digest'] = '0' * 64
        write(path, final)
        with self.assertRaisesRegex(ValueError, 'original mission prefix'):
            self.audit()

    def test_constructed_lane_requires_every_raw_request_return_and_observation(self):
        folder = self.reports[0] / 'constructed-fixture'
        for filename in ('initial-workspace.json', 'workspace.json',
                         *(currency + suffix for currency in ('usdc', 'agialpha')
                           for suffix in ('-request.json', '-return.json', '-installed-observation.json'))):
            path = folder / filename
            raw = path.read_bytes()
            path.unlink()
            with self.subTest(filename=filename), self.assertRaises(FileNotFoundError):
                self.audit()
            path.write_bytes(raw)

    def test_constructed_raw_bytes_and_runtime_cannot_reuse_summary(self):
        folder = self.reports[0] / 'constructed-fixture'
        for filename in ('usdc-request.json', 'agialpha-request.json', 'usdc-return.json', 'agialpha-return.json'):
            path = folder / filename
            raw = path.read_bytes()
            value = json.loads(raw)
            value['inertTamperedField'] = True
            write(path, value)
            with self.subTest(filename=filename), self.assertRaisesRegex(ValueError, 'observation bytes'):
                self.audit()
            path.write_bytes(raw)
        for currency in ('usdc', 'agialpha'):
            path = folder / (currency + '-installed-observation.json')
            raw = path.read_bytes()
            value = json.loads(raw)
            value['runtime']['binarySha256'] = '0' * 64
            write(path, value)
            with self.subTest(currency=currency), self.assertRaisesRegex(ValueError, 'pinned runtime'):
                self.audit()
            path.write_bytes(raw)
        path = folder / 'agialpha-installed-observation.json'
        value = json.loads(path.read_bytes())
        value['workspaceSha256'] = qualification.digest((folder / 'initial-workspace.json').read_bytes())
        write(path, value)
        with self.assertRaisesRegex(ValueError, 'observation bytes'):
            self.audit()

    def test_constructed_history_prefix_and_docket_are_independently_checked(self):
        folder = self.reports[0] / 'constructed-fixture'
        path = folder / 'workspace.json'
        raw = path.read_bytes()
        value = json.loads(raw)
        value['events'][0]['digest'] = '0' * 64
        write(path, value)
        with self.assertRaisesRegex(ValueError, 'original mission prefix'):
            self.audit()
        path.write_bytes(raw)
        path = folder / 'docket.json'
        raw = path.read_bytes()
        value = json.loads(raw)
        value['files']['05_agialpha_runs/run.json'] = json.dumps({'workspace': {'missionId': 'another-inert-mission'}})
        write(path, value)
        report_path = folder / 'qualification.json'
        report = json.loads(report_path.read_bytes())
        report['docketSha256'] = qualification.digest(path.read_bytes())
        write(report_path, report)
        with self.assertRaisesRegex(ValueError, '13-file docket'):
            self.audit()

    def test_constructed_history_cannot_attach_the_original_ui_lane_return(self):
        folder = self.reports[0] / 'constructed-fixture'
        final = json.loads((folder / 'workspace.json').read_bytes())
        wrapper = json.loads((self.reports[0] / 'installed-native/usdc-return.json').read_bytes())
        final['events'][-2]['payload']['record'] = wrapper
        final['events'][-2]['payload']['recordDigest'] = qualification.digest(
            json.dumps(wrapper, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode())
        write(folder / 'workspace.json', final)
        docket = json.loads((folder / 'docket.json').read_bytes())
        docket['files']['05_agialpha_runs/run.json'] = json.dumps({'workspace': final})
        write(folder / 'docket.json', docket)
        report = json.loads((folder / 'qualification.json').read_bytes())
        report['docketSha256'] = qualification.digest((folder / 'docket.json').read_bytes())
        write(folder / 'qualification.json', report)
        with self.assertRaisesRegex(ValueError, 'actual native return'):
            self.audit()


if __name__ == "__main__":
    unittest.main()
