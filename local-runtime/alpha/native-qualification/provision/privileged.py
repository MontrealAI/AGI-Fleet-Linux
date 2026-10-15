#!/usr/bin/env python3
"""PENDING EXACT-WORKFLOW APPROVAL. Root stage for a disposable runner only.

Never called by prepare.py or unit tests. No fallback, cleanup or security changes.
The approved one-time workflow must bind this file, derived preparation digest,
exact runtime, source snapshot, candidate bytes and destination before invocation.
An approved fixed invocation does not require a separate per-runner pause.
"""
from __future__ import annotations
import argparse
import os
from pathlib import Path
import stat
import subprocess
import sys
sys.dont_write_bytecode = True
from prepare import AUTHORITY, LOCK, TARGETS, canonical, file_bytes, load, need, sha, snapshot_tree

BASE = Path('/opt/agi-fleet-alpha')


def verify_preparation(directory, expected_sha):
    need(directory.is_absolute() and not directory.is_symlink(), 'Canonical preparation path required')
    directory = directory.resolve()
    raw = file_bytes(directory / 'preparation.json', 8_000_000)
    need(sha(raw) == expected_sha, 'Preparation is not exact approved-workflow-bound bytes')
    p = load(raw)
    need(p['schema'] == 'agi-fleet/alpha-fixed-path-preparation/v1' and p['status'] == 'PREPARED_NOT_INSTALLED' and p['authority'] == AUTHORITY and p['productionQualified'] is False and p['productionTrustTargets'] == 'UNPROVISIONED' and p['productionProvisioningQualified'] is False and p['productionAdmissionQualified'] is False and p['settlementAuthority'] is False, 'Fixture authority boundary changed')
    checkout = directory / 'checkout'
    need(checkout.resolve() == Path(p['checkout']) and not checkout.is_symlink(), 'Preparation relocated')
    need(snapshot_tree(checkout) == p['fixtureSnapshot'] and sha(canonical(p['fixtureSnapshot'])) == p['fixtureSnapshotSha256'], 'Fixture source/dependencies changed')
    need(sha(file_bytes(checkout / LOCK)) == p['fixtureLockSha256'] and sha(file_bytes(directory / 'source-lock.json')) == p['sourceLockSha256'], 'Fixture or original lock changed')
    need(sha(file_bytes(directory / 'remote-provenance.json')) == p['remoteProvenanceSha256'] and sha(file_bytes(directory / 'fixture-lock.diff')) == p['fixtureDiffSha256'], 'Provenance or source diff changed')
    need(str(Path(sys.executable).resolve()) == p['python'] and sha(file_bytes(Path(p['python']))) == p['pythonSha256'], 'Approved Python changed')
    source_lock = load(file_bytes(directory / 'source-lock.json'))
    need(source_lock['targets'] == dict.fromkeys(TARGETS) and source_lock['state'] == 'UNPROVISIONED', 'Original lock was not null')
    node = Path(p['node'])
    need(node.is_absolute() and not node.is_symlink() and sha(file_bytes(node)) == p['nodeSha256'], 'Pinned Node changed')
    for target in TARGETS:
        for name, expected in p['inputs'][target].items():
            need('/' not in name and name not in ('.', '..') and sha(file_bytes(directory / 'inputs' / target / name)) == expected, 'Offline evidence or archive changed')
    need(set(p['inputs']) == set(TARGETS) and all(set(p['inputs'][target]) == {'candidate.tar.gz', 'manifest.json', 'native-candidate.json', 'native-ipc.json', 'reproduction.json', 'qualification.json'} for target in TARGETS), 'Evidence inventory changed')
    harness = Path(p['harnessDirectory'])
    need(harness == Path(__file__).resolve().parent, 'Reviewed harness moved')
    need(set(p['harnessFiles']) == {f.name for f in harness.iterdir() if f.suffix in ('.py', '.mjs', '.md', '.json')}, 'Reviewed harness inventory changed')
    for name, expected in p['harnessFiles'].items():
        need('/' not in name and name not in ('.', '..') and sha(file_bytes(harness / name)) == expected, 'Reviewed harness changed')
    target = p['nativeTarget']
    need(target in TARGETS and p['installation'] == str(BASE / target / load(file_bytes(checkout / LOCK))['targets'][target]['archiveSha256']), 'Fixed destination binding changed')
    return p


def root_parent(file):
    s = file.lstat()
    need(stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode) and s.st_uid == 0 and s.st_mode & 0o022 == 0, 'Existing parent is not trusted: ' + str(file))


def provision(directory, expected_sha):
    need(os.geteuid() == 0, 'Root step only within the approved exact-source workflow')
    need(os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted' and os.environ.get('GITHUB_REPOSITORY') == 'MontrealAI/AGI-Fleet-Linux', 'Fresh GitHub-hosted disposable runner required')
    p = verify_preparation(directory, expected_sha)
    for parent in (Path('/'), Path('/opt')):
        root_parent(parent)
    need(not os.path.lexists(BASE), 'Existing /opt/agi-fleet-alpha is never changed or removed')
    # Validate archive, manifest, qualification and adapter once more as approved
    # code, BEFORE creating any privileged path. This never runs candidate code.
    env = {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'}
    subprocess.run([p['node'], str(Path(p['harnessDirectory']) / 'validate.mjs'), p['checkout'], str(directory / 'inputs'), p['nativeTarget']], env=env, check=True, stdout=subprocess.DEVNULL)
    os.umask(0o022)
    os.mkdir(BASE, mode=0o755)  # Atomic refusal if any competing path appeared.
    for target in TARGETS:
        os.mkdir(BASE / target, mode=0o755)
    target = directory / 'inputs' / p['nativeTarget']
    command = [p['node'], str(Path(p['checkout']) / 'local-runtime/alpha/provision.mjs'), '--archive', str(target / 'candidate.tar.gz'), '--manifest', str(target / 'manifest.json'), '--qualification', str(target / 'qualification.json'), '--confirm']
    # Unchanged real provisioner; destination cannot be caller-selected.
    subprocess.run(command, cwd=p['checkout'], env=env, check=True)
    # Never delete, chown, chmod, retry, modify system policy or launch payloads.


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preparation', required=True, type=Path)
    parser.add_argument('--expected-sha256', required=True)
    args = parser.parse_args()
    provision(args.preparation.resolve(), args.expected_sha256)
