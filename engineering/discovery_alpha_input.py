# SPDX-License-Identifier: Apache-2.0
"""Capture one authenticated Alpha UI artifact; never execute artifact contents."""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import urllib.request
import urllib.parse

import discovery_release as release

REPOSITORY = "MontrealAI/AGI-Alpha-Agent-v0"
WORKFLOW = ".github/workflows/successor-capability.yml"
PREFIX = "discovery-continuation/"
MEMBERS = ("source.json", "exact-checkout.json", PREFIX + "served/index.html", PREFIX + "served/sources.json",
           PREFIX + "fleet-native/native-proof.json", PREFIX + "journey.json",
           *(PREFIX + name for name in ("fleet-browser-workspace.json", "jobs-browser-workspace.json",
             "fleet-browser-request.json", "jobs-browser-request.json", "browser-native-requests.json")))
METADATA = tuple('metadata/' + name + '.json' for name in
                 ('run', 'jobs', 'artifacts', 'checkout-commit', 'public-commit'))
LIMIT = 120_000_000


def require(value, message):
    if not value:
        raise ValueError(message)


def document(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "Duplicate Alpha input JSON key")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))


def profile(raw, alpha=None):
    value = document(raw)
    require(value.get("schema") == "agi-fleet/discovery-alpha-input-profile/v1"
            and value.get("qualification") == "FROZEN_AUTHENTICATED_INPUT" and value.get("authority") == "none"
            and isinstance(value.get("transport"), dict), "Original authenticated Alpha mission input is UNSET; build held")
    transport = value["transport"]
    require(set(transport) == {"repository", "commit", "tree", "path", "custodySha256", "custodyBytes", "custodyGitBlob"}
            and transport["repository"] == REPOSITORY, "Public Alpha evidence transport fields differ")
    for key in ("commit", "tree", "custodyGitBlob"):
        require(isinstance(transport[key], str) and re.fullmatch("[0-9a-f]{40}", transport[key]), "Invalid public evidence Git identity")
    require(isinstance(transport["custodySha256"], str) and re.fullmatch("[0-9a-f]{64}", transport["custodySha256"])
            and type(transport["custodyBytes"]) is int and 0 < transport["custodyBytes"] <= release.MAX_MEMBER,
            "Invalid public custody byte identity")
    release.safe_name(transport["path"])
    return transport


def binding(custody, alpha):
    require(custody.get("schema") == "successor/discovery-browser-artifact-custody/v1"
            and custody.get("repository") == REPOSITORY and custody.get("workflowPath") == WORKFLOW,
            "Unsupported common Alpha artifact custody")
    producer, artifact = custody["producer"], custody["artifact"]
    require(producer["event"] == "push" and producer["headBranch"] == "main"
            and producer["headCommit"] == producer["checkoutCommit"] == alpha["commit"]
            and producer["checkoutTree"] == alpha["tree"] and custody["sourceHash"] == alpha["sourceHash"]
            and custody["pageSha256"] == alpha["files"]["docs/successor/capabilities/index.html"]["sha256"]
            and custody["catalogSha256"] == alpha["files"]["docs/successor/capabilities/sources.json"]["sha256"],
            "Alpha input does not bind the accepted final main source/page/catalog")
    result = {"acceptedCommit": alpha["commit"], "acceptedTree": alpha["tree"], "checkoutCommit": producer["checkoutCommit"],
              "checkoutTree": producer["checkoutTree"], "checkoutParents": producer["checkoutParents"],
              "headSha": producer["headCommit"], "baseSha": None, "runId": producer["runId"],
              "runAttempt": producer["runAttempt"], "workflowId": producer["workflowId"], "workflowPath": WORKFLOW,
              "event": producer["event"], "artifactId": artifact["id"], "artifactName": artifact["name"],
              "artifactSha256": artifact["digest"].removeprefix("sha256:"), "artifactBytes": artifact["sizeInBytes"],
              "sourceHash": custody["sourceHash"], "pageSha256": custody["pageSha256"], "members": custody["members"]}
    require(isinstance(result["checkoutParents"], list) and len(result["checkoutParents"]) <= 2
            and all(isinstance(item, str) and re.fullmatch("[0-9a-f]{40}", item) for item in result["checkoutParents"]),
            "Invalid Alpha checkout parents")
    require(all(type(result[key]) is int and result[key] > 0 for key in ("runId", "runAttempt", "workflowId", "artifactId"))
            and type(result["artifactBytes"]) is int and 0 < result["artifactBytes"] <= LIMIT
            and artifact["digest"] == "sha256:" + result["artifactSha256"]
            and re.fullmatch("[0-9a-f]{64}", result["artifactSha256"])
            and result["artifactName"] == "successor-capability-" + alpha["commit"], "Invalid original Alpha artifact identity")
    inventory = custody["inventory"]
    require(isinstance(inventory, dict) and len(inventory) <= 4096 and set(result["members"]) == set(MEMBERS), "Alpha original inventory differs")
    for name, row in inventory.items():
        release.safe_name(name.rstrip("/"))
        require(set(row) == {"bytes", "sha256"} and type(row["bytes"]) is int and 0 <= row["bytes"] <= LIMIT
                and isinstance(row["sha256"], str) and re.fullmatch("[0-9a-f]{64}", row["sha256"]), "Invalid original inventory member")
    require(sum(row["bytes"] for row in inventory.values()) <= 600_000_000, "Alpha original inventory exceeds total bound")
    for name, row in result["members"].items():
        require(row == inventory.get(name) and 0 < row["bytes"] <= release.MAX_MEMBER, "Invalid selected original member")
    return result


def validate_members(files, binding, alpha):
    require(set(files) == set(MEMBERS), "Alpha raw member inventory differs")
    for name, raw in files.items():
        require({"bytes": len(raw), "sha256": release.sha(raw)} == binding["members"][name], "Alpha original member bytes differ: " + name)
    source = document(files["source.json"])
    checkout = document(files["exact-checkout.json"])
    require(release.sha(files[PREFIX + "served/sources.json"])
            == alpha["files"]["docs/successor/capabilities/sources.json"]["sha256"],
            "Alpha served catalog raw bytes differ from the accepted source catalog")
    catalog = document(files[PREFIX + "served/sources.json"])
    require(source["commit"] == binding["checkoutCommit"] and source["trackedDiff"] == ""
            and checkout["commit"] == binding["checkoutCommit"] and checkout["tree"] == binding["checkoutTree"]
            and source["source"] == checkout["source"] == catalog and checkout["files"] == catalog["sources"]
            and catalog["sourceHash"] == alpha["sourceHash"], "Alpha source journal/catalog differs")
    require(release.sha(json.dumps(catalog["sources"], sort_keys=True, separators=(",", ":")).encode()) == alpha["sourceHash"]
            and all(name in alpha["files"] and alpha["files"][name]["sha256"] == value for name, value in catalog["sources"].items()),
            "Alpha served catalog does not reproduce the accepted closure")
    require(release.sha(files[PREFIX + "served/index.html"]) == binding["pageSha256"], "Alpha served page differs")
    journal = document(files[PREFIX + "browser-native-requests.json"])
    proof = document(files[PREFIX + "fleet-native/native-proof.json"])
    journey = document(files[PREFIX + "journey.json"])
    workspace_raw = files[PREFIX + "fleet-browser-workspace.json"]
    workspace = document(workspace_raw)
    require(workspace_raw == files[PREFIX + "jobs-browser-workspace.json"]
            and journal["schema"] == "actual-browser-native-request-exports/v1"
            and journal["missionId"] == workspace["missionId"] and journal["sourceHash"] == alpha["sourceHash"]
            and journal["pageSha256"] == binding["pageSha256"]
            and journal["workspace"] == {"file": "fleet-browser-workspace.json", "sha256": release.sha(workspace_raw),
                "jobsFile": "jobs-browser-workspace.json", "jobsSha256": release.sha(workspace_raw),
                "revision": workspace["revision"], "eventPrefix": [row["digest"] for row in workspace["events"]],
                "head": workspace["events"][-1]["digest"]}, "Alpha original mission journal differs")
    require(proof["schema"] == "actual-browser-fleet-native-return/v1"
            and proof["alphaCommit"] == binding["checkoutCommit"] and proof["alphaTree"] == binding["checkoutTree"]
            and proof["sourceHash"] == journal["sourceHash"] and proof["missionId"] == journal["missionId"]
            and proof["campaignDigest"] == journal["campaignDigest"] and proof["workspaceSha256"] == release.sha(workspace_raw)
            and proof["requestSha256"] == journal["requests"]["manager-usdc"]["sha256"]
            and journey["passed"] is True and journey["pageErrors"] == [] and journey["source"] == catalog
            and journey["pageSha256"] == binding["pageSha256"], "Alpha original native/browser observation differs")
    requests = []
    for route, filename, currency in (("manager-usdc", "fleet-browser-request.json", "USDC6"),
                                       ("jobs-agialpha", "jobs-browser-request.json", "AGIALPHA18")):
        raw = files[PREFIX + filename]
        request = document(raw)
        require(journal["requests"][route] == {"file": filename, "sha256": release.sha(raw), "currency": currency}
                and request["missionId"] == workspace["missionId"]
                and request["commission"]["route"] == route and request["commission"]["currency"] == currency
                and request["commission"].get("capBaseUnits") == "0" and request["commission"].get("status") == "DRAFT_NOT_SUBMITTED",
                "Alpha original UI request differs")
        requests.append(request)
    require({key: value for key, value in requests[0].items() if key != "commission"}
            == {key: value for key, value in requests[1].items() if key != "commission"}
            and requests[0]["commission"]["id"] == requests[1]["commission"]["id"]
            and requests[0]["commission"]["branch"] != requests[1]["commission"]["branch"], "Alpha alternative drafts differ")


def authenticated_metadata(api, binding):
    workflow = api(f'/actions/workflows/{binding["workflowId"]}')
    require(workflow.get('id') == binding['workflowId'] and workflow.get('path') == WORKFLOW,
            'Alpha producer workflow identity differs')
    run = api(f'/actions/runs/{binding["runId"]}/attempts/{binding["runAttempt"]}')
    require(run["id"] == binding["runId"] and run["run_attempt"] == binding["runAttempt"] and run["head_branch"] == "main"
            and run["head_sha"] == binding["headSha"] and run["event"] == binding["event"]
            and run["workflow_id"] == binding["workflowId"] and run["path"].split("@")[0] == WORKFLOW
            and run["repository"]["full_name"] == REPOSITORY and run["head_repository"]["full_name"] == REPOSITORY
            and run["status"] == "completed" and run["conclusion"] == "success", "Alpha original run/attempt is not successful and exact")
    accepted = api('/git/commits/' + binding["acceptedCommit"])
    checkout = api('/git/commits/' + binding["checkoutCommit"])
    require(accepted["sha"] == binding["acceptedCommit"] and accepted["tree"]["sha"] == binding["acceptedTree"]
            and (binding["acceptedCommit"] == binding["headSha"] or binding["headSha"] in [row["sha"] for row in accepted["parents"]])
            and checkout["sha"] == binding["checkoutCommit"] and checkout["tree"]["sha"] == binding["checkoutTree"]
            and [row["sha"] for row in checkout["parents"]] == binding["checkoutParents"], "Alpha accepted/synthetic Git source differs")
    jobs = api(f'/actions/runs/{binding["runId"]}/attempts/{binding["runAttempt"]}/jobs?per_page=100')
    require(type(jobs.get('total_count')) is int and jobs['total_count'] == len(jobs['jobs'])
            and 0 < len(jobs['jobs']) <= 100 and len({row.get('id') for row in jobs['jobs']}) == len(jobs['jobs']),
            "Alpha job collection incomplete/duplicate")
    selected = [row for row in jobs["jobs"] if row["name"] == "capability"]
    require(len(selected) == 1 and selected[0]["status"] == "completed" and selected[0]["conclusion"] == "success"
            and selected[0]["run_id"] == binding["runId"] and selected[0]["head_sha"] == binding["headSha"], "Alpha producer job failed/missing")
    job = selected[0]
    for name in ("Bind retained evidence to exact source", "Saved future-task protocol, docket and real-task boundary acceptance",
                 "Retain exact-source screenshots and journey evidence"):
        steps = [row for row in job["steps"] if row["name"] == name]
        require(len(steps) == 1 and steps[0].get('status') == 'completed' and steps[0]["conclusion"] == "success", "Alpha producer step failed/missing")
    artifact = api(f'/actions/artifacts/{binding["artifactId"]}')
    require(artifact["id"] == binding["artifactId"] and artifact["name"] == binding["artifactName"]
            and artifact["expired"] is False and artifact["size_in_bytes"] == binding["artifactBytes"]
            and artifact["digest"] == "sha256:" + binding["artifactSha256"]
            and artifact["workflow_run"]["id"] == binding["runId"] and artifact["workflow_run"]["head_sha"] == binding["headSha"]
            and datetime.fromisoformat(job["started_at"].replace("Z", "+00:00"))
                <= datetime.fromisoformat(artifact["created_at"].replace("Z", "+00:00"))
                <= datetime.fromisoformat(job["completed_at"].replace("Z", "+00:00")), "Alpha original artifact custody differs")
    return {"run": run, "job": job, "artifact": artifact, "acceptedCommit": accepted, "checkoutCommit": checkout}


def retained_metadata(files, expected):
    snapshots = {name: document(files['metadata/' + name + '.json']) for name in
                 ('run', 'jobs', 'artifacts', 'checkout-commit', 'public-commit')}
    for name in ('jobs', 'artifacts'):
        rows = snapshots[name].get(name)
        require(isinstance(rows, list) and type(snapshots[name].get('total_count')) is int
                and snapshots[name]['total_count'] == len(rows) and 0 < len(rows) <= 100
                and len({row.get('id') for row in rows}) == len(rows), 'Incomplete/duplicate original public metadata inventory')
    selected = [row for row in snapshots['artifacts']['artifacts'] if row.get('id') == expected['artifactId']]
    require(len(selected) == 1, 'Original public artifact metadata missing/duplicate')
    def git_record(value):
        result = dict(value)
        result['tree'] = value.get('tree', value.get('commit', {}).get('tree', {}))
        require(result.get('sha') == expected['acceptedCommit'] and result['tree'].get('sha') == expected['acceptedTree']
                and [row.get('sha') for row in result.get('parents', [])] == expected['checkoutParents'],
                'Original public source metadata differs')
        return result
    accepted, checkout = (git_record(snapshots[name]) for name in ('public-commit', 'checkout-commit'))
    lookup = {f'/actions/workflows/{expected["workflowId"]}': {'id': expected['workflowId'], 'path': WORKFLOW},
              f'/actions/runs/{expected["runId"]}/attempts/{expected["runAttempt"]}': snapshots['run'],
              '/git/commits/' + expected['acceptedCommit']: checkout,
              f'/actions/runs/{expected["runId"]}/attempts/{expected["runAttempt"]}/jobs?per_page=100': snapshots['jobs'],
              f'/actions/artifacts/{expected["artifactId"]}': selected[0]}
    authenticated_metadata(lookup.__getitem__, expected)
    return snapshots


def captured_entries(folder, config, alpha):
    transport = profile(config)
    custody_raw = release.regular_bytes(folder, "CUSTODY.json")[0]
    require(len(custody_raw) == transport["custodyBytes"] and release.sha(custody_raw) == transport["custodySha256"]
            and hashlib.sha1(b"blob " + str(len(custody_raw)).encode() + b"\0" + custody_raw).hexdigest() == transport["custodyGitBlob"],
            "Alpha public custody differs from the pinned Git bytes")
    expected = binding(document(custody_raw), alpha)
    metadata = {name: release.regular_bytes(folder, name)[0] for name in METADATA}
    retained_metadata(metadata, expected)
    files = {name: release.regular_bytes(folder, name)[0] for name in MEMBERS}
    validate_members(files, expected, alpha)
    return {"mission-input/" + name: (raw, 0o644) for name, raw in
            {**files, **metadata, "CUSTODY.json": custody_raw}.items()}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


class ReadOnlyGitHub:
    """Unauthenticated public metadata and immutable raw reads; no Actions ZIP."""
    def __init__(self):
        self.immutable = {}

    def api(self, route):
        cached = route.startswith(('/git/commits/', '/git/trees/'))
        if cached and route in self.immutable:
            return self.immutable[route]
        require(route.startswith("/") and not route.startswith("//"), "Relative public Alpha API route required")
        request = urllib.request.Request("https://api.github.com/repos/" + REPOSITORY + route,
            headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
                     "User-Agent": "Fleet-Alpha-original-input"})
        with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as response:
            raw = response.read(8_000_001)
        require(len(raw) <= 8_000_000, "Public Alpha API response exceeds bound")
        result = document(raw)
        if cached:
            self.immutable[route] = result
        return result

    def raw(self, commit, name, maximum):
        require(isinstance(commit, str) and re.fullmatch('[0-9a-f]{40}', commit), 'Immutable public raw commit required')
        release.safe_name(name)
        require(type(maximum) is int and 0 < maximum <= release.MAX_MEMBER, 'Bounded public raw read required')
        url = 'https://raw.githubusercontent.com/' + REPOSITORY + '/' + commit + '/' + urllib.parse.quote(name, safe='/')
        with urllib.request.build_opener(NoRedirect).open(urllib.request.Request(url,
                headers={'User-Agent': 'Fleet-Alpha-original-input'}), timeout=60) as response:
            raw = response.read(maximum + 1)
        require(len(raw) <= maximum, 'Public raw body exceeds bound')
        return raw


def public_files(api, read_body, transport, names, *, exact=False, bindings=None):
    commit = api('/git/commits/' + transport['commit'])
    require(commit['sha'] == transport['commit'] and commit['tree']['sha'] == transport['tree'], 'Public Git commit/tree differs')
    tree = api('/git/trees/' + transport['tree'] + '?recursive=1')
    rows = tree.get('tree')
    require(tree.get('sha') == transport['tree'] and tree.get('truncated') is False and isinstance(rows, list)
            and len(rows) <= 100_000 and len({row.get('path') for row in rows}) == len(rows),
            'Complete public recursive Git tree required')
    prefix = transport['path'] + '/' if transport['path'] else ''
    entries = {row['path'][len(prefix):]: row for row in rows if row['path'].startswith(prefix) and row.get('type') != 'tree'}
    if exact:
        require(set(entries) == set(MEMBERS) | set(METADATA) | {'CUSTODY.json'},
                'Public packet must contain exactly the common 17 original/custody files')
    files = {}
    for name in names:
        release.safe_name(name)
        row = entries.get(name, {})
        require(row.get('type') == 'blob' and row.get('mode') in ('100644', '100755')
                and (not exact or row['mode'] == '100644')
                and isinstance(row.get('sha'), str) and re.fullmatch('[0-9a-f]{40}', row['sha'])
                and type(row.get('size')) is int and 0 < row['size'] <= release.MAX_MEMBER,
                'Public source must be bounded ordinary Git blobs')
        if bindings is not None:
            require(row['mode'] == bindings[name]['mode'] and row['sha'] == bindings[name]['gitBlob'],
                    'Public source Git blob/mode differs from the reviewed profile')
        data = read_body(transport['commit'], prefix + name, row['size'])
        require(isinstance(data, bytes) and len(data) == row['size']
                and hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() == row['sha'],
                'Public raw bytes differ from their actual Git blob')
        files[name] = data
    return files


def fetch_capture(api, read_body, config, alpha, output):
    original_api, immutable = api, {}
    def api(route):
        if route.startswith(('/git/commits/', '/git/trees/', '/actions/workflows/')):
            if route not in immutable:
                immutable[route] = original_api(route)
            return immutable[route]
        return original_api(route)
    require(not output.exists(), "Public Alpha capture destination must be absent")
    transport = profile(config)
    custody_raw = public_files(api, read_body, transport, ['CUSTODY.json'], exact=True)['CUSTODY.json']
    require(len(custody_raw) == transport["custodyBytes"] and release.sha(custody_raw) == transport["custodySha256"]
            and hashlib.sha1(b"blob " + str(len(custody_raw)).encode() + b"\0" + custody_raw).hexdigest() == transport["custodyGitBlob"],
            "Public custody differs from pinned bytes")
    expected = binding(document(custody_raw), alpha)
    metadata = authenticated_metadata(api, expected)
    files = public_files(api, read_body, transport, (*MEMBERS, *METADATA), exact=True)
    retained_metadata({name: files[name] for name in METADATA}, expected)
    validate_members({name: files[name] for name in MEMBERS}, expected, alpha)
    source = public_files(api, read_body, {'commit': alpha['commit'], 'tree': alpha['tree'], 'path': ''},
                          alpha['files'], bindings=alpha['files'])
    for name, raw in source.items():
        require(release.sha(raw) == alpha['files'][name]['sha256']
                and hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest() == alpha['files'][name]['gitBlob'],
                'Original accepted Alpha source bytes differ from the reviewed profile')
    require(authenticated_metadata(api, expected) == metadata, "Original Alpha public metadata changed during capture")
    output.mkdir(mode=0o700)
    for name, raw in {**files, "CUSTODY.json": custody_raw}.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    return expected, metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    alpha = release.load_profile()["alpha"]
    config = release.regular_bytes(release.ROOT, "discovery-lab/release/mission-input.json")[0]
    transport = ReadOnlyGitHub()
    result, _ = fetch_capture(transport.api, transport.raw, config, alpha, args.output)
    print(json.dumps({"artifactId": result["artifactId"], "sha256": result["artifactSha256"], "members": len(MEMBERS)}))
