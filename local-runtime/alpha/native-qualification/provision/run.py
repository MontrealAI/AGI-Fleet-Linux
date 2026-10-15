#!/usr/bin/env python3
"""Actual fixed-path fixture qualification after separate approved provisioning.

Never invokes sudo or changes /opt. Evidence stays fixture authority. Failed and
unobservable attempts are retained. Private state is not deleted or reconciled.
"""
from __future__ import annotations
import argparse
import importlib.util
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import sys
import time
sys.dont_write_bytecode = True
from prepare import AUTHORITY, HERE, KINDS, LOCK, absent_output, canonical, file_bytes, load, need, sha, snapshot_tree
from privileged import verify_preparation
from payload import interpreter_identity, observe_payload


def load_observer(checkout):
    # Reuse the exact reviewed independent /proc identity/cleanup checker.
    path = checkout / 'local-runtime/alpha/candidate'
    sys.path.insert(0, str(path))
    spec = importlib.util.spec_from_file_location('fixed_path_candidate_observer', path / 'qualify.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def native_processes(driver_pid, observer, baseline, ignored, interpreter):
    observed = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            if proc.stat().st_uid != os.getuid():
                continue
            identity = observe_payload(proc, driver_pid, interpreter)
            if identity is None:
                continue
            members = observer.namespace_members(identity['pidNamespace'], baseline=baseline, ignored=ignored)
            need(identity['pid'] in members, 'Payload namespace observation inconsistent')
            observed.append({**identity, 'members': members})
        except (FileNotFoundError, ProcessLookupError):
            pass
        except PermissionError:
            raise ValueError('Actual payload namespace cannot be independently observed')
    return observed


def check_attempt(attempt, expect_native=True):
    need(attempt['failure'] is None and attempt['exitStatus'] == 0 and attempt['driver'].get('ok') is True, 'Actual driver failed: ' + str(attempt['failure'] or attempt['driver'].get('code')))
    if not expect_native:
        return
    result = attempt['driver']
    observation = result['receipt']['observation'] if attempt['mode'] == 'work' else result['retained']['receipt']['observation']
    need(observation and observation['runtimeIdentity'] == result['runtimeIdentity'] and observation['providerCalls'] == 0 and observation['network'] == 'none', 'Actual native authority/runtime binding missing')
    phases = observation['phases']
    need(phases and (len(phases) == 2 if attempt['mode'] == 'work' else 1 <= len(phases) <= 2), 'Actual phases missing')
    live = attempt['nativeProcessesObserved']
    for phase in phases:
        need(phase['processGroupGone'] is True and phase['privateNamespacesEnded'] is True and phase['namespaceLifetimeEOF'] is True and phase['evidenceClass'] == 'NATIVE_FIXED_ALPHA_IPC', 'Actual fixed transport cleanup incomplete')
        namespace = 'pid:[' + str(phase['status']['namespaces']['pid']) + ']'
        need(any(p['pidNamespace'] == namespace and p['phase'] == phase['phase'] for p in live) and attempt['namespaceMembersRemaining'].get(namespace) == [], 'Actual phase was not independently observed live and gone')
    need(set(attempt['namespaceMembersRemaining']) == {p['pidNamespace'] for p in live} and all(v == [] for v in attempt['namespaceMembersRemaining'].values()), 'Unaccounted native namespace')
    if attempt['mode'] != 'work':
        need(attempt['cancelSent'] is True and all(result.get(k) is True for k in ('stopRecorded', 'grantConsumed', 'runUncertain', 'cancellationApplied')), 'Actual STOP/revocation authority evidence incomplete')
        request = attempt.get('cancelRequest')
        need(request and request == result.get('cancellationRequest') and result.get('code') == result['retained']['receipt'].get('error') == 'RUN_CANCELLED', 'Cancellation request or exact runtime outcome missing')
        payload = request['payload']
        need(any(all(p.get(k) == payload.get(k) for k in ('pid', 'startTimeTicks', 'pidNamespace', 'phase', 'interpreter')) for p in live), 'Cancellation target was not independently observed')
        phase = phases[-1]
        need(phase['phase'] == payload['phase'] and 'pid:[' + str(phase['status']['namespaces']['pid']) + ']' == payload['pidNamespace'], 'Cancelled phase differs from observed target')
        need(phase.get('signal') == 'SIGKILL' or type(phase.get('exitStatus')) is int and phase['exitStatus'] != 0 or type(phase['status'].get('exitCode')) is int and phase['status']['exitCode'] != 0, 'Cancellation happened after successful native phase completion')


def run_case(preparation, checkout, state, mode, kind, evidence, observer):
    baseline, ignored = observer.snapshot_process_identities(), {}
    interpreter = interpreter_identity(Path(preparation['installation']) / 'rootfs/opt/alpha/python/bin/python3.12')
    args = [preparation['node'], str(HERE / 'actual.mjs'), str(checkout), str(state), mode, kind]
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, env={'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'LANG': 'C.UTF-8'})
    selector = selectors.DefaultSelector()
    for stream, channel in ((process.stdout, 'stdout'), (process.stderr, 'stderr')):
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ, channel)
    buffers, events, parsed, failure = {'stdout': bytearray(), 'stderr': bytearray()}, [], 0, None
    live, armed, cancelled, cancel_request = {}, False, False, None
    nonce = None
    started = time.monotonic()
    try:
        while selector.get_map():
            need(time.monotonic() - started < 180, 'Actual driver observation timeout')
            if armed:
                for p in native_processes(process.pid, observer, baseline, ignored, interpreter):
                    live[(p['pid'], p['startTimeTicks'])] = p
                    if mode in ('stop', 'revoke-grant', 'revoke-client') and not cancelled:
                        cancel_request = {'kind': 'cancel-native-phase', 'nonce': nonce, 'payload': {k: p[k] for k in ('pid', 'startTimeTicks', 'pidNamespace', 'phase', 'interpreter')}}
                        process.stdin.write(canonical(cancel_request) + b'\n')
                        process.stdin.flush()
                        cancelled = True
            for key, _ in selector.select(0.002):
                data = os.read(key.fd, 65536)
                if not data:
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                    continue
                buffers[key.data].extend(data)
                need(len(buffers[key.data]) <= 3_000_000, 'Actual driver output bound')
                if key.data == 'stdout':
                    while True:
                        end = buffers['stdout'].find(b'\n', parsed)
                        if end < 0:
                            break
                        event = load(bytes(buffers['stdout'][parsed:end]))
                        events.append(event)
                        parsed = end + 1
                        if event.get('kind') == 'armed':
                            need(nonce is None and isinstance(event.get('nonce'), str) and len(event['nonce']) == 64, 'Invalid or repeated driver nonce')
                            nonce = event['nonce']
                            armed = True
        process.wait(timeout=5)
    except Exception as error:
        failure = str(error)
    finally:
        selector.close()
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
        for stream in (process.stdin, process.stdout, process.stderr):
            stream.close()
    remaining = {}
    try:
        for namespace in {p['pidNamespace'] for p in live.values()}:
            members = observer.namespace_members(namespace, baseline=baseline, ignored=ignored)
            deadline = time.monotonic() + 1
            while members and time.monotonic() < deadline:
                time.sleep(0.01)
                members = observer.namespace_members(namespace, baseline=baseline, ignored=ignored)
            remaining[namespace] = members
    except Exception as error:
        failure = failure or str(error)
    results = [v for v in events if v.get('kind') == 'result']
    if len(results) != 1:
        failure = failure or 'Actual driver did not return exactly one result'
    result = results[0] if len(results) == 1 else {}
    attempt = {'mode': mode, 'case': kind, 'driver': result, 'failure': failure, 'exitStatus': process.returncode, 'cancelSent': cancelled, 'cancelRequest': cancel_request, 'nativeProcessesObserved': list(live.values()), 'namespaceMembersRemaining': remaining, 'prelaunchProcessIdentitySha256': sha(canonical(baseline)), 'verifiedPreexistingProcessesExcluded': list(ignored.values()), 'wallMilliseconds': round((time.monotonic() - started) * 1000), 'stdoutSha256': sha(bytes(buffers['stdout'])), 'stderrSha256': sha(bytes(buffers['stderr'])), 'stderr': buffers['stderr'].decode(errors='replace')}
    # Persist failures before any assertion. No retry can erase them.
    evidence.write_bytes(canonical(attempt) + b'\n')
    return attempt


def qualify(directory, expected_sha, evidence):
    need(os.geteuid() != 0 and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted', 'Use the separately prepared non-root disposable hosted runner')
    p = verify_preparation(directory, expected_sha)
    checkout = Path(p['checkout'])
    evidence = absent_output(evidence, (checkout, directory, HERE, p['sourceCheckout']))
    evidence.mkdir(mode=0o700)
    observer = load_observer(checkout)
    report = {'schema': 'agi-fleet/alpha-fixed-path-qualification/v1', 'status': 'FAILED', 'authority': AUTHORITY, 'productionQualified': False, 'productionAdmissionQualified': False, 'productionProvisioningQualified': False, 'productionTrustTargets': 'UNPROVISIONED', 'settlementAuthority': False, 'preparationSha256': expected_sha, 'installationObserved': False, 'actualPathFixtureChecks': 'NOT_RUN', 'attempts': [], 'stateRetention': 'Retain STOP, consumed grants and uncertain journals. Dispose of entire runner only.'}
    try:
        planned = [('work', kind) for kind in KINDS] + [(mode, 'research') for mode in ('refusals', 'stop', 'revoke-grant', 'revoke-client')]
        for index, (mode, kind) in enumerate(planned):
            attempt = run_case(p, checkout, evidence / ('state-' + str(index)), mode, kind, evidence / ('attempt-' + str(index) + '.json'), observer)
            report['attempts'].append(attempt)
            check_attempt(attempt, expect_native=mode != 'refusals')
            report['installationObserved'] = True
        # Separate source copy and fresh private scenario state. Change only lock
        # whitespace, leaving target/qualification contents and installed bytes intact.
        drift = evidence / 'drift-checkout'
        shutil.copytree(checkout, drift, symlinks=True)
        original = file_bytes(drift / LOCK)
        (drift / LOCK).write_bytes(original + b'\n')
        report['driftFixtureLockSha256'] = sha(file_bytes(drift / LOCK))
        state = evidence / 'drift-state'
        for mode, source in (('drift-prepare', checkout), ('drift-check', drift)):
            attempt = run_case(p, source, state, mode, 'research', evidence / (mode + '.json'), observer)
            report['attempts'].append(attempt)
            check_attempt(attempt, expect_native=False)
        need(snapshot_tree(checkout) == p['fixtureSnapshot'], 'Original fixture source changed during actual checks')
        report.update(status='PASSED_FIXTURE_ONLY', actualPathFixtureChecks='PASSED')
    except Exception as error:
        report['failure'] = str(error)
        raise
    finally:
        (evidence / 'fixed-path.json').write_bytes(canonical(report) + b'\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preparation', type=Path, required=True)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    qualify(args.preparation.resolve(), args.expected_sha256, args.evidence.absolute())
