#!/usr/bin/env python3
"""Read-only native IPC qualification. Does not provision or activate Fleet."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import platform
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'candidate'))
from build import read_lock, build, tree_manifest, extract_tar, file_sha, canonical, sha, require
from qualify import verify_candidate, load_fixtures, trusted, BIN, LIMIT, snapshot_process_identities, namespace_members, sample_namespace_cpu


def run_driver(candidate, root, mode, selector):
    node = shutil.which('node')
    require(node is not None, 'Pinned Fleet Node runtime is required')
    baseline = snapshot_process_identities()
    ignored, namespaces, samples, observations, events = {}, {}, {}, [], []
    clock_ticks = os.sysconf('SC_CLK_TCK')
    started = time.monotonic()
    process = subprocess.Popen([node, str(HERE / 'driver.mjs'), mode, str(candidate), str(root), selector],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
                               start_new_session=True, env={'PATH': os.environ.get('PATH', '/usr/bin:/bin')})
    streams = selectors.DefaultSelector()
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    parsed = 0
    failure = None
    for stream, channel in [(process.stdout, 'stdout'), (process.stderr, 'stderr')]:
        os.set_blocking(stream.fileno(), False)
        streams.register(stream, selectors.EVENT_READ, channel)
    try:
        while streams.get_map():
            require(time.monotonic() - started < 40, 'QUALIFICATION_DRIVER_TIMEOUT')
            sample_namespace_cpu(namespaces, samples, baseline=baseline, ignored=ignored)
            for key, _ in streams.select(0.025):
                data = os.read(key.fd, 65536)
                if not data:
                    streams.unregister(key.fileobj)
                    key.fileobj.close()
                    continue
                buffers[key.data].extend(data)
                require(len(buffers[key.data]) <= 2_000_000, 'QUALIFICATION_DRIVER_OUTPUT_LIMIT')
                if key.data == 'stdout':
                    while True:
                        end = buffers['stdout'].find(b'\n', parsed)
                        if end < 0:
                            break
                        event = json.loads(buffers['stdout'][parsed:end])
                        parsed = end + 1
                        events.append(event)
                        if event.get('kind') == 'probe':
                            observation = event['observation']
                            namespace = observation['pidNamespace']
                            members = namespace_members(namespace, baseline=baseline, ignored=ignored)
                            require(members, 'CLEANUP_UNOBSERVABLE: fixed probe has no observed live namespace member')
                            namespaces[namespace] = members
                            observations.append(observation)
        status = process.wait(timeout=2)
    except Exception as error:
        failure = str(error)
    finally:
        streams.close()
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
        for stream in [process.stdout, process.stderr]:
            stream.close()
    results = [event for event in events if event.get('kind') == 'result']
    if process.returncode != 0 or len(results) != 1:
        failure = failure or 'QUALIFICATION_DRIVER_FAILED'
    result = results[0] if len(results) == 1 else {'ok': False, 'code': 'QUALIFICATION_DRIVER_FAILED'}
    remaining = {}
    try:
        for namespace in namespaces:
            # Permit kernel teardown to finish, but do not accept unknown descendants.
            deadline = time.monotonic() + 1
            members = namespace_members(namespace, baseline=baseline, ignored=ignored)
            while members and time.monotonic() < deadline:
                time.sleep(0.01)
                members = namespace_members(namespace, baseline=baseline, ignored=ignored)
            remaining[namespace] = members
            require(not members, 'CLEANUP_UNCONFIRMED: private namespace member remains')
    except Exception as error:
        failure = failure or str(error)
    return {'mode': mode, 'case': selector, 'driver': result, 'liveNamespaceMembersObserved': namespaces,
            'namespaceMembersRemaining': remaining, 'probeObservations': observations, 'failure': failure,
            'driverExitStatus': process.returncode, 'stdoutSha256': sha(bytes(buffers['stdout'])),
            'namespaceCpuSecondsObserved': sum(v['userTicks'] + v['systemTicks'] for v in samples.values()) / clock_ticks,
            'namespaceCpuSamples': list(samples.values()), 'clockTicksPerSecond': clock_ticks,
            'prelaunchProcessIdentitySha256': sha(canonical(baseline)),
            'verifiedPreexistingProcessesExcluded': list(ignored.values()),
            'wallMilliseconds': round((time.monotonic() - started) * 1000),
            'stderr': buffers['stderr'].decode(errors='replace'), 'stderrSha256': sha(bytes(buffers['stderr']))}


def check_probe(name, attempt):
    result, observations = attempt['driver'], attempt['probeObservations']
    require(result['probeSeen'] and observations, 'Fixed native IPC probe did not execute')
    live, remaining = attempt['liveNamespaceMembersObserved'], attempt['namespaceMembersRemaining']
    require(isinstance(live, dict) and isinstance(remaining, dict) and live and set(live) == set(remaining)
            and all(isinstance(members, list) and members and all(type(pid) is int and pid > 0 for pid in members) for members in live.values())
            and all(isinstance(members, list) and len(members) == 0 for members in remaining.values()),
            'Independent namespace observation is incomplete')
    transport = result['observation']
    require(transport and transport['processGroupGone'] and transport['privateNamespacesEnded']
            and transport['namespaceLifetimeEOF'], 'Transport did not confirm complete cleanup')
    for observed in observations:
        require(observed['pidNamespace'] in live and observed['pidNamespace'] in remaining,
                'Probe namespace has no matching independent cleanup observation')
        require(observed['trustedChannelsAbsent'] and observed['cpuLimitSeconds'] == [5, 5], 'Probe channel/CPU constraints failed')
        require(observed['pidNamespace'] == 'pid:[' + str(transport['status']['namespaces']['pid']) + ']'
                and observed['networkNamespace'] == 'net:[' + str(transport['status']['namespaces']['net']) + ']',
                'Trusted bwrap metadata differs from independently observed probe namespaces')
    if name in ('isolation', 'detached-exit'):
        require(result['ok'] and transport['exitStatus'] == 0, 'Native probe success expected')
    else:
        expected = {'cancel': 'RUN_CANCELLED', 'cancel-after-exit': 'RUN_CANCELLED', 'timeout': 'RUN_TIMEOUT', 'launcher-death': 'ALPHA_WORKER_FAILED',
                    'cpu': 'ALPHA_WORKER_FAILED', 'output': 'ALPHA_OUTPUT_SIZE'}[name]
        require(not result['ok'] and result['code'] == expected, 'Wrong native probe refusal: ' + name)
    if name in ('detached-exit', 'cancel-after-exit', 'cancel', 'timeout', 'launcher-death'):
        require(all(v.get('detachedChild') for v in observations), 'Detached descendant was not established')
    if name == 'cpu':
        require(transport['status']['exitCode'] == 137 and 4 <= attempt['namespaceCpuSecondsObserved'] <= 6
                and transport['wallMilliseconds'] < 15000, 'Five-second hard CPU SIGKILL not demonstrated')


def qualify(candidate, evidence, cache, source):
    require(platform.system() == 'Linux' and os.geteuid() != 0, 'Use a non-root disposable Linux runner')
    require(not evidence.exists(), 'Evidence path must be absent')
    lock = read_lock()
    manifest = verify_candidate(candidate, lock)
    require(platform.machine() == lock['targets'][manifest['target']]['machine'], 'Host/candidate architecture mismatch')
    fleet = HERE.parents[2]
    report = {'schema': 'agi-fleet/alpha-native-ipc-qualification/v1', 'status': 'FAILED',
              'evidenceClass': 'NATIVE_CANDIDATE_TRANSPORT_WITH_SYNTHETIC_GRANT_AUTHORITY',
              'productionAdmissionQualified': False, 'productionProvisioningQualified': False,
              'productionTrustTargets': 'UNPROVISIONED', 'settlementAuthority': False,
              'archiveSha256': manifest['archiveSha256'], 'treeSha256': manifest['treeSha256'],
              'inputsSha256': manifest['inputsSha256'], 'sourceCommit': manifest['sourceCommit'],
              'fleetCommit': subprocess.check_output(['git', '-C', str(fleet), 'rev-parse', 'HEAD'], text=True).strip(),
              'fleetSourceDirty': bool(subprocess.check_output(['git', '-C', str(fleet), 'status', '--porcelain'], text=True).strip()),
              'driverSha256': file_sha(HERE / 'driver.mjs'), 'qualifierSha256': file_sha(Path(__file__)),
              'probeSha256': file_sha(HERE / 'probe.py'), 'attempts': [], 'tests': []}
    evidence.parent.mkdir(parents=True, exist_ok=True)
    try:
        trusted(BIN)
        trusted(LIMIT)
        require(not report['fleetSourceDirty'], 'Exact-source native qualification requires a clean checkout')
        report['host'] = {'machine': platform.machine(), 'kernel': platform.release(),
                          'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                          'bwrapSha256': file_sha(BIN), 'prlimitSha256': file_sha(LIMIT),
                          'nodeSha256': file_sha(shutil.which('node') or '/missing-node')}
        with tempfile.TemporaryDirectory(prefix='alpha-native-ipc-') as temp:
            expected = build(lock, manifest['target'], cache, source, Path(temp) / 'reconstructed')
            require(manifest == expected, 'Candidate differs from independently reconstructed official pinned inputs')
            extracted = Path(temp) / 'saved-archive'
            extracted.mkdir()
            with (candidate / 'candidate.tar.gz').open('rb') as stream:
                extract_tar(stream, extracted)
            root = extracted / 'rootfs'
            require(tree_manifest(root) == manifest['entries'], 'Saved archive differs from reconstructed tree')
            fixture = load_fixtures(lock)
            for case in fixture['cases']:
                for mode in ('sequence', 'grant'):
                    attempt = run_driver(candidate, root, mode, case['kind'])
                    report['attempts'].append(attempt)
                    require(attempt['failure'] is None, attempt['failure'])
                    require(attempt['driver']['ok'] is True, 'Native fixed sequence/grant fixture failed')
                    report['tests'].append({'mode': mode, 'case': case['kind'], 'status': 'PASSED'})
            for probe in ('isolation', 'detached-exit', 'cancel', 'cancel-after-exit', 'timeout', 'launcher-death', 'cpu', 'output'):
                attempt = run_driver(candidate, root, 'probe', probe)
                report['attempts'].append(attempt)
                require(attempt['failure'] is None, attempt['failure'])
                check_probe(probe, attempt)
                report['tests'].append({'probe': probe, 'status': 'PASSED'})
            attempt = run_driver(candidate, root, 'grant-stop', fixture['cases'][0]['kind'])
            report['attempts'].append(attempt)
            require(attempt['failure'] is None, attempt['failure'])
            check_probe('cancel', attempt)
            require(all(attempt['driver'].get(key) is True for key in ('stopRecorded', 'grantConsumed', 'runUncertain')),
                    'Native STOP did not preserve the consumed grant and uncertain run')
            report['tests'].append({'mode': 'grant-stop', 'status': 'PASSED'})
            for refusal in ('invalid-json', 'invalid-utf8', 'duplicate-key', 'wrong-market', 'wrong-executor', 'code-kind', 'nonfinite'):
                for phase in ('validate', 'work'):
                    attempt = run_driver(candidate, root, 'refusal', refusal + '-' + phase)
                    report['attempts'].append(attempt)
                    require(attempt['failure'] is None, attempt['failure'])
                    result = attempt['driver']
                    observation = result.get('observation')
                    require(not result['ok'] and result.get('code') == 'ALPHA_WORKER_FAILED' and observation
                            and observation['processGroupGone'] and observation['privateNamespacesEnded']
                            and observation['stdoutBytes'] == 0 and observation['stderrBytes'] > 0,
                            'Malformed native IPC input was not cleanly refused: ' + refusal + '/' + phase)
                    report['tests'].append({'refusal': refusal, 'phase': phase, 'status': 'PASSED'})
            adapter_hashes = {attempt['driver']['adapterSha256'] for attempt in report['attempts']}
            require(len(adapter_hashes) == 1, 'Adapter source changed during qualification')
            report['adapterSha256'] = adapter_hashes.pop()
            require(report['driverSha256'] == file_sha(HERE / 'driver.mjs')
                    and report['probeSha256'] == file_sha(HERE / 'probe.py')
                    and report['qualifierSha256'] == file_sha(Path(__file__)), 'Qualification source changed during execution')
            require(len(report['tests']) == 31, 'Native IPC test inventory incomplete')
            report['status'] = 'PASSED'
    except Exception as error:
        report['failure'] = str(error)
        raise
    finally:
        evidence.write_bytes(json.dumps(report, indent=2).encode() + b'\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('candidate', 'evidence', 'cache', 'alpha-repository'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    qualify(args.candidate.resolve(), args.evidence.resolve(), args.cache.resolve(), args.alpha_repository.resolve())
