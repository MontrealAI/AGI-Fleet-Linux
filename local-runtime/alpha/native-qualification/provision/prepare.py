#!/usr/bin/env python3
"""Prepare isolated fixture authority from exact successful reviewed PR artifacts.

Read-only public GitHub verification; local writes only to a new output directory.
No installer, sandbox payload, sudo, workflow publication or production lock write.
"""
from __future__ import annotations
import argparse
import difflib
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import shlex
import sys
import stat
import subprocess
import tarfile
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
REPOSITORY = 'MontrealAI/AGI-Fleet-Linux'
WORKFLOW = '.github/workflows/alpha-native-ipc.yml'
# Reviewed lineage is frozen. A repaired/moved PR needs an explicit source review
# and pin change, never a caller-supplied future head substituted silently.
REVIEWED_PR = 47
REVIEWED_HEAD = '2d5d62369d57db9abc9f622ccb4781e6cccd90d2'
REVIEWED_TREE = '7c52bc0cdd85b87f2219b46b6be6caeafa136b43'
REVIEWED_EXPECTATION = {
    'headCommit': REVIEWED_HEAD,
    'testedCommit': '847943561dcd6406824eb4d22a617bd52a18f381',
    'sourceTree': REVIEWED_TREE,
    'runId': 38716434461,
    'runAttempt': 1,
}
# Raw GitHub ZIPs, not extracted/repacked candidates. Metadata and downloaded
# bytes must match these exact reviewed references; this is not a pass claim.
REVIEWED_ARTIFACTS = {
    'linux-x64': {'id': 11969784543, 'bytes': 59946774, 'sha256': '76af4122a07217651573a45aa00694ccca66d38ff4f8600637bcfae8ab3f32bd'},
    'linux-arm64': {'id': 11968950893, 'bytes': 53807545, 'sha256': '3e7a1bfee0db3cfb15b364f71a8443db1c9c4a5eb63276e0ab66683f5b7055af'},
}
TARGETS = ('linux-x64', 'linux-arm64')
KINDS = ('allocation', 'forecast', 'research', 'schedule')
REFUSALS = ('invalid-json', 'invalid-utf8', 'duplicate-key', 'wrong-market', 'wrong-executor', 'code-kind', 'nonfinite')
PROBES = ('isolation', 'detached-exit', 'cancel', 'cancel-after-exit', 'timeout', 'launcher-death', 'cpu', 'output')
AUTHORITY = 'ISOLATED_TEST_LOCK_FROM_NATIVE_CANDIDATE_EVIDENCE; NEVER_PRODUCTION_APPROVAL'
LOCK = 'local-runtime/alpha/package-lock.json'


def need(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def load(raw):
    def pairs(values):
        result = {}
        for key, value in values:
            need(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: need(False, 'Nonfinite JSON'))


def file_bytes(file, limit=512_000_000):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        s = os.fstat(stream.fileno())
        need(stat.S_ISREG(s.st_mode) and s.st_size <= limit, 'Unsafe or oversized input: ' + str(file))
        data = stream.read(limit + 1)
    need(len(data) <= limit and len(data) == s.st_size, 'Input grew or changed during read')
    return data


def safe_relative(value):
    need(isinstance(value, str) and value and '\\' not in value and not re.search(r'[\x00-\x1f\x7f]', value), 'Unsafe relative path')
    p = PurePosixPath(value)
    need(not p.is_absolute() and all(x not in ('', '.', '..') for x in value.split('/')), 'Unsafe relative path')
    return value



def absent_output(value, protected):
    """Resolve existing/missing ancestry before writes; aliases are never outputs.

    This intentionally rejects even outward-pointing aliases. A fresh single-
    tenant runner has no need for them. It is not a concurrent-writer guarantee.
    """
    value = Path(value).absolute()
    resolved = value.resolve(strict=False)
    need(value == resolved, 'Output ancestry contains a symlink or noncanonical alias')
    need(not os.path.lexists(value), 'Output must be absent, including dangling links')
    for root in protected:
        root = Path(root).resolve(strict=False)
        need(not resolved.is_relative_to(root), 'Output resolves inside protected source/preparation')
    return resolved

def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args]).decode().strip()


def fetch_json(endpoint):
    # No caller URL, token, alternate host or insecure redirect. Public reads only.
    need(endpoint.startswith('/') and '..' not in endpoint, 'Invalid GitHub endpoint')
    url = 'https://api.github.com/repos/' + REPOSITORY + endpoint
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError('GitHub metadata redirect refused')
    request = urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'fleet-alpha-fixed-path-review', 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
        raw = response.read(4_000_001)
    need(len(raw) <= 4_000_000, 'GitHub metadata too large')
    return load(raw)


def verified_merged_lineage(pr, tested, expect, fetch):
    """Accept only the recorded two-parent merge of the exact tested lineage.

    Metadata must come from the fixed HTTPS GitHub reader. The injected reader is
    the existing synthetic-test seam, never a CLI option or an approval authority.
    Neither this merge object nor a moving main checkout becomes runtime source.
    """
    need(pr.get('state') == 'closed' and pr.get('merged') is True, 'Closed PR was not verified merged')
    need(isinstance(pr.get('merged_at'), str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', pr['merged_at']) is not None, 'Merge time unavailable')
    need(pr.get('base', {}).get('ref') == 'main' and pr.get('base', {}).get('repo', {}).get('full_name') == REPOSITORY, 'Merge destination is not the reviewed repository main branch')
    merge_sha = pr.get('merge_commit_sha')
    need(isinstance(merge_sha, str) and re.fullmatch('[a-f0-9]{40}', merge_sha) is not None and merge_sha not in (expect['headCommit'], expect['testedCommit']), 'Real merge commit identity unavailable')
    parents = tested.get('parents')
    need(isinstance(parents, list) and len(parents) == 2 and all(isinstance(x, dict) and isinstance(x.get('sha'), str) and re.fullmatch('[a-f0-9]{40}', x['sha']) is not None for x in parents), 'Tested merge parents unavailable')
    parent_shas = [x['sha'] for x in parents]
    need(parent_shas[1] == expect['headCommit'] and parent_shas[0] != expect['headCommit'], 'Tested merge does not bind the frozen head')
    merged = fetch('/git/commits/' + merge_sha)
    need(isinstance(merged, dict) and merged.get('sha') == merge_sha and merged.get('tree', {}).get('sha') == expect['sourceTree'], 'Real merge Git object/tree differs or is unavailable')
    actual_parents = merged.get('parents')
    need(isinstance(actual_parents, list) and [x.get('sha') if isinstance(x, dict) else None for x in actual_parents] == parent_shas, 'Real merge parents differ from the exact tested lineage')
    return merged


def verify_remote(expect, fetch=fetch_json):
    """The injected reader is solely for clearly marked unit fixtures, not CLI input."""
    need(set(expect) == {'headCommit', 'testedCommit', 'sourceTree', 'runId', 'runAttempt'}, 'Exact immutable run identity required')
    for key in ('headCommit', 'testedCommit', 'sourceTree'):
        need(re.fullmatch('[a-f0-9]{40}', expect[key]) is not None, 'Invalid commit/tree')
    for key in ('runId', 'runAttempt'):
        need(type(expect[key]) is int and expect[key] > 0, 'Invalid run identity')
    need(expect == REVIEWED_EXPECTATION, 'Source/run differs from this harness reviewed PR lineage; review a pin update')
    run_id, attempt = expect['runId'], expect['runAttempt']
    pr = fetch(f'/pulls/{REVIEWED_PR}')
    need(pr['number'] == REVIEWED_PR and pr['head']['sha'] == expect['headCommit'] and pr['head']['repo']['full_name'] == REPOSITORY, 'Reviewed PR head moved or repository mismatch')
    need((pr.get('state') == 'open' and pr.get('merged') is False) or (pr.get('state') == 'closed' and pr.get('merged') is True), 'PR is neither open nor verified merged')
    run = fetch(f'/actions/runs/{run_id}/attempts/{attempt}')
    need(run['id'] == run_id and run['run_attempt'] == attempt and run['status'] == 'completed' and run['conclusion'] == 'success', 'Exact native attempt has not passed')
    need(run['repository']['full_name'] == REPOSITORY and run['path'] == WORKFLOW and run['event'] == 'pull_request', 'Wrong native workflow provenance')
    need(run['head_sha'] == expect['headCommit'] and any(p['number'] == REVIEWED_PR and p['head']['sha'] == expect['headCommit'] for p in run['pull_requests']), 'Run is not the exact reviewed PR head')
    commit = fetch('/git/commits/' + expect['testedCommit'])
    head = fetch('/git/commits/' + expect['headCommit'])
    need(commit['sha'] == expect['testedCommit'] and head['sha'] == expect['headCommit'] and commit['tree']['sha'] == head['tree']['sha'] == expect['sourceTree'], 'Tested integration source differs from reviewed head tree')
    merged = verified_merged_lineage(pr, commit, expect, fetch) if pr['state'] == 'closed' else None
    jobs = fetch(f'/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100')
    need(jobs['total_count'] == len(jobs['jobs']) and len(jobs['jobs']) == 2, 'Native job inventory incomplete')
    for target in TARGETS:
        matches = [j for j in jobs['jobs'] if target in j['name']]
        need(len(matches) == 1 and matches[0]['status'] == 'completed' and matches[0]['conclusion'] == 'success' and matches[0]['run_attempt'] == attempt, 'Native architecture job did not pass')
    artifacts = fetch(f'/actions/runs/{run_id}/artifacts?per_page=100')
    need(artifacts['total_count'] == len(artifacts['artifacts']), 'Artifact pagination required; refuse incomplete list')
    selected = {}
    for target in TARGETS:
        matches = [a for a in artifacts['artifacts'] if a['name'] == 'alpha-native-ipc-' + target]
        need(len(matches) == 1, 'Missing or ambiguous native artifact')
        a = matches[0]
        need(a['expired'] is False and re.fullmatch('sha256:[a-f0-9]{64}', a.get('digest', '')) is not None and a['workflow_run']['id'] == run_id and a['workflow_run']['head_sha'] == expect['headCommit'], 'Artifact provenance/digest unavailable')
        need(type(a['id']) is int and a['id'] == REVIEWED_ARTIFACTS[target]['id'] and a['digest'] == 'sha256:' + REVIEWED_ARTIFACTS[target]['sha256'] and type(a['size_in_bytes']) is int and a['size_in_bytes'] == REVIEWED_ARTIFACTS[target]['bytes'], 'Raw artifact differs from the reviewed ID/digest/length')
        selected[target] = a
    return {'pullRequest': pr, 'run': run, 'testedCommit': commit, 'headCommit': head, 'jobs': jobs, 'artifacts': selected, 'mergeCommit': merged, 'prLifecycle': 'MERGED_EXACT_TESTED_LINEAGE' if merged is not None else 'OPEN_REVIEWED_HEAD'}


def artifact_members(raw, expected_digest):
    need(sha(raw) == expected_digest, 'Downloaded GitHub artifact digest mismatch')
    result = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        need(len(archive.infolist()) <= 100, 'Unexpected artifact inventory')
        total = 0
        for member in archive.infolist():
            if member.is_dir():
                safe_relative(member.filename.rstrip('/'))
                need(not stat.S_ISLNK(member.external_attr >> 16), 'Linked artifact directory')
                continue
            name = safe_relative(member.filename)
            kind = stat.S_IFMT(member.external_attr >> 16)
            need(name not in result and kind in (0, stat.S_IFREG) and not member.flag_bits & 1, 'Duplicate, linked, special or encrypted artifact entry')
            total += member.file_size
            need(total <= 180_000_000 and member.file_size <= 128_000_000, 'Expanded artifact too large')
            result[name] = archive.read(member)
    return result


def select_member(members, basename):
    matches = [raw for name, raw in members.items() if PurePosixPath(name).name == basename]
    need(len(matches) == 1, 'Missing or ambiguous artifact member: ' + basename)
    return matches[0]


def closure_ok(observation):
    need(isinstance(observation, dict) and observation.get('processGroupGone') is True and observation.get('privateNamespacesEnded') is True, 'Native cleanup evidence incomplete')
    if 'phases' in observation:
        need(len(observation['phases']) == 2, 'Two native phases required')
        for phase in observation['phases']:
            closure_ok(phase)
    else:
        need(observation.get('namespaceLifetimeEOF') is True and isinstance(observation.get('status'), dict), 'Private channel cleanup missing')


def validate_evidence(target, members, expect, source):
    """Structural/hash validation only. Authenticity comes from verified remote ZIP digest."""
    values = {name: select_member(members, name) for name in ('candidate.tar.gz', 'manifest.json', 'native-candidate.json', 'native-ipc.json', 'reproduction.json')}
    manifest, candidate, ipc, reproduction = (load(values[name]) for name in ('manifest.json', 'native-candidate.json', 'native-ipc.json', 'reproduction.json'))
    inputs = load(file_bytes(source / 'local-runtime/alpha/candidate/inputs.lock.json'))
    need(manifest['schema'] == 'agi-fleet/alpha-candidate-artifact/v1' and manifest['target'] == target and manifest['sourceCommit'] == inputs['source']['commit'], 'Candidate target/source differs')
    need(manifest['productionQualified'] is False and manifest['settlementAuthority'] is False and manifest['qualification'] == 'NOT_RUN', 'Historical candidate authority was rewritten')
    need(sha(values['candidate.tar.gz']) == manifest['archiveSha256'] and len(values['candidate.tar.gz']) == manifest['archiveBytes'], 'Candidate archive changed')
    need(manifest['builderSha256'] == sha(file_bytes(source / 'local-runtime/alpha/candidate/build.py')) and manifest['launcherSha256'] == sha(file_bytes(source / 'local-runtime/alpha/candidate/launcher.py.in')), 'Candidate builder/launcher changed')
    need(manifest['assets'] == [inputs['targets'][target]['python'], *inputs['targets'][target]['runtimePackages'], *inputs['targets'][target]['wheels']], 'Candidate official assets differ')
    need(sha(canonical(manifest['entries'])) == manifest['treeSha256'] and manifest['inputsSha256'] == sha(file_bytes(source / 'local-runtime/alpha/candidate/inputs.lock.json')), 'Candidate tree/input lock differs')
    for report, schema in ((candidate, 'agi-fleet/alpha-candidate-isolation/v1'), (ipc, 'agi-fleet/alpha-native-ipc-qualification/v1')):
        need(report['schema'] == schema and report['status'] == 'PASSED' and report['fleetSourceDirty'] is False and report['fleetCommit'] == expect['testedCommit'] and report['settlementAuthority'] is False, 'Native evidence is stale, dirty or unsuccessful')
        for key in ('archiveSha256', 'treeSha256', 'inputsSha256', 'sourceCommit'):
            need(report[key] == manifest[key], 'Native evidence artifact binding differs')
        need(report['host']['machine'] == inputs['targets'][target]['machine'], 'Wrong native machine')
    need(candidate['nodeExecutableSha256'] == ipc['host']['nodeSha256'], 'Candidate and IPC Node runtimes differ')
    need(candidate['productionQualified'] is False and candidate['fleetGrantAdapterQualified'] is False and candidate['nativeExecutionObserved'] is True and len(candidate['tests']) == 28 and len(candidate['probeAttempts']) == 5, 'Candidate test coverage/authority invalid')
    need({(v['case'], v['mode']) for v in candidate['tests'] if 'case' in v} == {(k, p) for k in KINDS for p in ('validate', 'work')}, 'Candidate four-kind coverage incomplete')
    need({(v['refusal'], v['mode']) for v in candidate['tests'] if 'refusal' in v} == {(r, p) for r in REFUSALS for p in ('validate', 'work')}, 'Candidate refusal coverage incomplete')
    need(ipc['productionAdmissionQualified'] is False and ipc['productionProvisioningQualified'] is False and ipc['productionTrustTargets'] == 'UNPROVISIONED' and len(ipc['tests']) == len(ipc['attempts']) == 31 and all(t['status'] == 'PASSED' for t in ipc['tests']), 'IPC test coverage/authority invalid')
    expected_cases = {(m, k) for m in ('sequence', 'grant') for k in KINDS} | {('probe', p) for p in PROBES} | {('grant-stop', 'research')} | {('refusal', r + '-' + p) for r in REFUSALS for p in ('validate', 'work')}
    need({(a['mode'], a['case']) for a in ipc['attempts']} == expected_cases, 'IPC attempt inventory differs')
    need(re.fullmatch('[a-f0-9]{64}', ipc['adapterSha256']) is not None, 'Adapter identity missing')
    for attempt in ipc['attempts']:
        need(attempt['failure'] is None and attempt['driverExitStatus'] == 0 and attempt['driver']['adapterSha256'] == ipc['adapterSha256'] and attempt['driver']['archiveSha256'] == manifest['archiveSha256'], 'IPC attempt failed or adapter changed')
        if attempt['mode'] in ('sequence', 'grant'):
            need(attempt['driver']['ok'] is True, 'IPC deterministic attempt failed')
            closure_ok(attempt['driver']['observation'])
        if attempt['mode'] == 'refusal':
            need(attempt['driver']['ok'] is False and attempt['driver']['code'] == 'ALPHA_WORKER_FAILED', 'Native refusal was not a refusal')
            closure_ok(attempt['driver']['observation'])
            need(attempt['driver']['observation']['stdoutBytes'] == 0 and attempt['driver']['observation']['stderrBytes'] > 0, 'Native refusal output contract differs')
        if attempt['mode'] in ('probe', 'grant-stop'):
            closure_ok(attempt['driver']['observation'])
            live, remaining = attempt['liveNamespaceMembersObserved'], attempt['namespaceMembersRemaining']
            need(live and live.keys() == remaining.keys() and all(isinstance(pids, list) and pids for pids in live.values()) and all(pids == [] for pids in remaining.values()), 'Independent namespace evidence missing')
    source_hashes = [(candidate, 'qualifierSha256', 'candidate/qualify.py'), (candidate, 'probeSha256', 'candidate/probe.py'), (candidate, 'contractBridgeSha256', 'candidate/check-contract.mjs'), (ipc, 'qualifierSha256', 'native-qualification/qualify.py'), (ipc, 'driverSha256', 'native-qualification/driver.mjs'), (ipc, 'probeSha256', 'native-qualification/probe.py')]
    for report, key, relative in source_hashes:
        need(report[key] == sha(file_bytes(source / 'local-runtime/alpha' / relative)), 'Native qualifier source hash mismatch')
    need(candidate['contractFixtureSha256'] == inputs['contractFixtureSha256'] == sha(file_bytes(source / 'local-runtime/tests/fixtures/alpha-contract.json')), 'Contract fixture mismatch')
    need(reproduction['schema'] == 'agi-fleet/alpha-candidate-reproduction/v1' and reproduction['fleetCommit'] == expect['testedCommit'] and reproduction['workflowRun'] == str(expect['runId']) and reproduction['workflowAttempt'] == str(expect['runAttempt']) and reproduction['target'] == target and reproduction['identicalBuilds'] == 2 and reproduction['productionQualified'] is False and reproduction['productionTrustTargets'] == 'UNPROVISIONED', 'Reproduction belongs to another run/attempt')
    for key in ('archiveSha256', 'treeSha256', 'inputsSha256'):
        need(reproduction[key] == manifest[key], 'Reproduction artifact mismatch')
    q = {'schema': 'agi-fleet/alpha-reviewed-qualification/v1', 'status': 'PASSED', 'target': target, **{k: manifest[k] for k in ('archiveSha256', 'treeSha256', 'inputsSha256')}, 'adapterSha256': ipc['adapterSha256'], 'artifactNative': True, 'adapterNative': True, 'candidateEvidenceSha256': sha(values['native-candidate.json']), 'adapterEvidenceSha256': sha(values['native-ipc.json']), 'fleetCommit': expect['testedCommit'], 'settlementAuthority': False}
    qualification = canonical(q) + b'\n'
    descriptor = {'schema': 'agi-fleet/alpha-reviewed-target/v1', **{k: manifest[k] for k in ('target', 'sourceCommit', 'archiveSha256', 'archiveBytes', 'treeSha256', 'inputsSha256')}, 'manifestSha256': sha(values['manifest.json']), 'manifestBytes': len(values['manifest.json']), 'adapterSha256': ipc['adapterSha256'], 'qualificationSha256': sha(qualification)}
    return descriptor, qualification, values, ipc


def build_fixture_lock(original, descriptors):
    lock = load(original)
    need(lock['state'] == 'UNPROVISIONED' and lock['qualification'] == 'NOT_RUN' and lock['targets'] == dict.fromkeys(TARGETS) and lock['settlementAuthority'] is False, 'Source production lock must remain null')
    need(set(descriptors) == set(TARGETS), 'Both independently qualified architectures required')
    lock.update(state='REVIEWED_NATIVE', qualification='EXACT_ARTIFACT_AND_ADAPTER_NATIVE', targets=descriptors)
    return canonical(lock) + b'\n'


def snapshot_tree(root):
    entries = []
    for current, directories, files in os.walk(root, followlinks=False):
        for name in sorted(directories + files):
            file = Path(current) / name
            s = file.lstat()
            relative = file.relative_to(root).as_posix()
            if stat.S_ISLNK(s.st_mode):
                need(relative.startswith('fleet/node_modules/') and file.resolve().is_relative_to((root / 'fleet/node_modules').resolve()), 'Source symlink escapes dependency closure')
                entries.append([relative, 'symlink', os.readlink(file)])
            elif stat.S_ISREG(s.st_mode):
                need(s.st_nlink == 1, 'Snapshot hardlink forbidden')
                entries.append([relative, s.st_mode & 0o7777, sha(file_bytes(file, 8_000_000))])
            else:
                need(stat.S_ISDIR(s.st_mode), 'Special snapshot node forbidden')
                entries.append([relative, 'directory', s.st_mode & 0o7777])
    return sorted(entries)


def prepare(source, output, node, expect, artifacts, native_target):
    need(os.geteuid() != 0, 'Preparation must be non-root')
    source, node = source.resolve(), node.resolve()
    output = absent_output(output, (source, HERE))
    need(native_target in TARGETS, 'Unsupported native architecture')
    need(git(source, 'rev-parse', 'HEAD') in (expect['headCommit'], expect['testedCommit']) and git(source, 'rev-parse', 'HEAD^{tree}') == expect['sourceTree'] and not git(source, 'status', '--porcelain'), 'Use a clean exact reviewed source tree with installed ignored dependencies')
    remote = verify_remote(expect)
    output.mkdir(mode=0o700)
    # No source mutation or hardlinks. Git archive preserves the exact tracked tree.
    checkout = output / 'checkout'
    checkout.mkdir()
    archive = subprocess.check_output(['git', '-C', str(source), 'archive', '--format=tar', 'HEAD'])
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        need(all(m.isdir() or m.isfile() for m in tar.getmembers()), 'Source archive contains links or special nodes')
        tar.extractall(checkout, filter='data')
    shutil.copytree(source / 'fleet/node_modules', checkout / 'fleet/node_modules', symlinks=True)
    before = snapshot_tree(checkout)
    original = file_bytes(checkout / LOCK)
    descriptors, reports = {}, {}
    for target in TARGETS:
        raw = file_bytes(artifacts[target])
        metadata = remote['artifacts'][target]
        need(len(raw) == metadata['size_in_bytes'], 'Artifact compressed size mismatch')
        members = artifact_members(raw, metadata['digest'][7:])
        descriptor, qualification, values, ipc = validate_evidence(target, members, expect, checkout)
        descriptors[target], reports[target] = descriptor, ipc
        dest = output / 'inputs' / target
        dest.mkdir(parents=True)
        for name, value in {**values, 'qualification.json': qualification}.items():
            (dest / name).write_bytes(value)
    fixture_lock = build_fixture_lock(original, descriptors)
    (checkout / LOCK).write_bytes(fixture_lock)
    after = snapshot_tree(checkout)
    before_map, after_map = ({e[0]: e for e in entries} for entries in (before, after))
    changed = sorted(name for name in before_map.keys() | after_map.keys() if before_map.get(name) != after_map.get(name))
    need(changed == [LOCK], 'Unexpected semantic source difference')
    # Execute only reviewed Fleet source, not candidate payload. Validate both
    # archive trees and independently measure this architecture's adapter closure.
    need(sha(file_bytes(node)) == reports[native_target]['host']['nodeSha256'], 'Node differs from exact native IPC evidence')
    check = subprocess.check_output([str(node), str(HERE / 'validate.mjs'), str(checkout), str(output / 'inputs'), native_target], env={'PATH': '/usr/bin:/bin'})
    validation = load(check)
    need(validation['adapterSha256'] == descriptors[native_target]['adapterSha256'], 'Installed dependency/full adapter closure differs from native evidence')
    (output / 'source-lock.json').write_bytes(original)
    (output / 'fixture-lock.diff').write_text(''.join(difflib.unified_diff(original.decode().splitlines(True), fixture_lock.decode().splitlines(True), fromfile='source/' + LOCK, tofile='isolated-fixture/' + LOCK)))
    remote_bytes = canonical(remote) + b'\n'
    (output / 'remote-provenance.json').write_bytes(remote_bytes)
    harness_files = {p.name: sha(file_bytes(p)) for p in sorted(HERE.iterdir()) if p.suffix in ('.py', '.mjs', '.md', '.json')}
    report = {'schema': 'agi-fleet/alpha-fixed-path-preparation/v1', 'status': 'PREPARED_NOT_INSTALLED', 'authority': AUTHORITY, 'productionQualified': False, 'productionTrustTargets': 'UNPROVISIONED', 'productionAdmissionQualified': False, 'productionProvisioningQualified': False, 'settlementAuthority': False, 'expected': expect, 'nativeTarget': native_target, 'checkout': str(checkout), 'sourceCheckout': str(source), 'sourceCommit': git(source, 'rev-parse', 'HEAD'), 'sourceLockSha256': sha(original), 'fixtureLockSha256': sha(fixture_lock), 'sourceSnapshot': before, 'fixtureSnapshot': after, 'fixtureSnapshotSha256': sha(canonical(after)), 'node': str(node), 'nodeSha256': sha(file_bytes(node)), 'python': str(Path(sys.executable).resolve()), 'pythonSha256': sha(file_bytes(Path(sys.executable).resolve())), 'remoteProvenanceSha256': sha(remote_bytes), 'fixtureDiffSha256': sha(file_bytes(output / 'fixture-lock.diff')),  'inputs': {t: {p.name: sha(file_bytes(p)) for p in sorted((output / 'inputs' / t).iterdir())} for t in TARGETS}, 'harnessDirectory': str(HERE), 'harnessFiles': harness_files, 'installation': '/opt/agi-fleet-alpha/' + native_target + '/' + descriptors[native_target]['archiveSha256'], 'validation': validation, 'privilegedPreparation': 'NOT_RUN; EXACT_SOURCE_WORKFLOW_APPROVAL_REQUIRED', 'nativeAdmission': 'NOT_RUN', 'disposal': 'whole disposable GitHub-hosted runner only; no installation deletion'}
    report_bytes = canonical(report) + b'\n'
    (output / 'preparation.json').write_bytes(report_bytes)
    (output / 'preparation.sha256').write_text(sha(report_bytes) + '\n')
    (output / 'approval.json').write_bytes(canonical(approval_packet(report, sha(report_bytes), output)) + b'\n')
    # Preserve exact source and null lock throughout preparation.
    need(file_bytes(source / LOCK) == original and not git(source, 'status', '--porcelain'), 'Original checkout changed during preparation')
    return report



def evidence_directory(preparation):
    """One shared path for approved execution, report retention and CI collection."""
    return Path(preparation).parent / 'actual-evidence'


def approval_packet(report, expected_sha, output):
    """Concrete commands for review only. Returning strings never executes them."""
    root = ['sudo', '--preserve-env=GITHUB_ACTIONS,RUNNER_ENVIRONMENT,GITHUB_REPOSITORY', report['python'], '-B', str(HERE / 'privileged.py'), '--preparation', str(output), '--expected-sha256', expected_sha]
    actual = [report['python'], '-B', str(HERE / 'run.py'), '--preparation', str(output), '--expected-sha256', expected_sha, '--evidence', str(evidence_directory(output))]
    return {'schema': 'agi-fleet/alpha-fixed-path-approval-proposal/v1', 'status': 'NOT_AUTHORIZED_NOT_EXECUTED', 'authority': AUTHORITY, 'approvalScope': 'One externally approved exact-source/hash-bound workflow invocation; no per-runner approval pause',
            'privilegedCommand': shlex.join(root), 'subsequentNonrootCommand': shlex.join(actual),
            'evidenceDirectory': str(evidence_directory(output)), 'reportPath': str(evidence_directory(output) / 'fixed-path.json'),
            'preparationSha256': expected_sha, 'pythonSha256': report['pythonSha256'], 'nodeSha256': report['nodeSha256'],
            'harnessFiles': report['harnessFiles'], 'sourceSnapshotSha256': report['fixtureSnapshotSha256'],
            'remote': report['expected'], 'rawArtifacts': {target: dict(value) for target, value in REVIEWED_ARTIFACTS.items()}, 'inputs': report['inputs'], 'fixtureLockSha256': report['fixtureLockSha256'],
            'newRootDirectories': ['/opt/agi-fleet-alpha', '/opt/agi-fleet-alpha/linux-x64', '/opt/agi-fleet-alpha/linux-arm64'],
            'installation': report['installation'], 'stagingPattern': '/opt/agi-fleet-alpha/' + report['nativeTarget'] + '/.staging-*',
            'changesExistingSecuritySettings': False, 'existingInstallationPolicy': 'REFUSE_IF_BASE_EXISTS; no overwrite, deletion, chmod or chown',
            'prerequisites': 'Already compatible trusted root-owned bwrap/prlimit and namespace policy. This proposal excludes tool installation or AppArmor/security changes; if unavailable, stop for a separate exact proposal.',
            'disposal': 'End the entire disposable GitHub-hosted runner. Do not delete installed paths or reset STOP, consumed grants or uncertain journals.',
            'trustModel': 'Single-tenant disposable runner, no concurrent untrusted mutation. Byte identities are checked before use; this does not claim adversarial atomic snapshot isolation.',
            'productionQualified': False, 'productionTrustTargets': 'UNPROVISIONED', 'settlementAuthority': False}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'output', 'node', 'expected', 'x64-artifact', 'arm64-artifact'):
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--native-target', choices=TARGETS, required=True)
    args = parser.parse_args()
    report = prepare(args.source, args.output, args.node, load(file_bytes(args.expected, 4096)), {'linux-x64': args.x64_artifact, 'linux-arm64': args.arm64_artifact}, args.native_target)
    print(json.dumps({k: report[k] for k in ('status', 'authority', 'nativeAdmission', 'privilegedPreparation')}))


if __name__ == '__main__':
    main()
