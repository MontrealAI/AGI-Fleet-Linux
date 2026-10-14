#!/usr/bin/env python3
"""Qualify exact candidate archive in real bubblewrap, never activate Fleet."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import platform
import resource
import selectors
import shutil
import signal
import stat
import subprocess
import tempfile
import time
from build import HERE, ALPHA, read_lock, require, file_sha, canonical, sha, tree_manifest, extract_tar, build

BIN = Path('/usr/bin/bwrap')
LIMIT = Path('/usr/bin/prlimit')
PYTHON = '/opt/alpha/python/bin/python3.12'
MAX_STDOUT = 512_000
MAX_STDERR = 8192


def trusted(path):
    s = path.stat()
    require(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022,
            'SANDBOX_EXECUTABLE_UNTRUSTED: candidate qualification needs trusted root-owned bwrap/prlimit')
    return str(path.resolve())


def command(root, mode, probe=None):
    require(mode in ('work', 'validate', 'probe'), 'Only fixed candidate entrypoints are allowed')
    args = [trusted(LIMIT), '--cpu=10', '--as=4294967296', '--fsize=1048576', '--nofile=128', '--', trusted(BIN),
            '--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
            '--ro-bind', str(root), '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
            '--setenv', 'PATH', '/nonexistent', '--setenv', 'HOME', '/nonexistent', '--setenv', 'LANG', 'C.UTF-8',
            '--setenv', 'OPENBLAS_NUM_THREADS', '1', '--setenv', 'OMP_NUM_THREADS', '1', '--chdir', '/tmp']
    if mode == 'probe':
        require(probe in ('isolation', 'timeout', 'cancel', 'cpu', 'output'), 'Unreviewed probe')
        args += ['--ro-bind', str(HERE / 'probe.py'), '/candidate-probe.py', '--', PYTHON, '-I', '-S', '-B', '/candidate-probe.py', probe]
    else:
        require(probe is None, 'Probe argument cannot enter work launcher')
        args += ['--', PYTHON, '-I', '-S', '-B', '/opt/alpha/launch-' + mode + '.py']
    return args


def namespace_members(namespace):
    members = []
    for p in Path('/proc').iterdir():
        if p.name.isdigit():
            try:
                if os.readlink(p / 'ns/pid') == namespace:
                    members.append(int(p.name))
            except (FileNotFoundError, ProcessLookupError):
                pass
            except PermissionError:
                try:
                    require(p.stat().st_uid != os.getuid(), 'CLEANUP_UNOBSERVABLE: own process namespace cannot be read')
                except FileNotFoundError:
                    pass
    return members


def run(root, mode, data=b'', probe=None, wall=15, cancel_after=None, output_limit=MAX_STDOUT):
    require(0 < wall <= 15 and len(data) <= 512_000 and 0 < output_limit <= MAX_STDOUT, 'Candidate limits cannot be widened')
    started = time.monotonic()
    usage_before = resource.getrusage(resource.RUSAGE_CHILDREN)
    process = subprocess.Popen(command(root, mode, probe), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True, env={'PATH': '/usr/bin:/bin'})
    selector = selectors.DefaultSelector()
    for stream, channel in [(process.stdout, 'stdout'), (process.stderr, 'stderr')]:
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ, channel)
    offset = 0
    if data:
        os.set_blocking(process.stdin.fileno(), False)
        selector.register(process.stdin, selectors.EVENT_WRITE, 'stdin')
    else:
        process.stdin.close()
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    observed_members = {}
    reason = None
    killed_at = None
    try:
        while selector.get_map():
            elapsed = time.monotonic() - started
            reason = reason or ('WALL_TIMEOUT' if elapsed >= wall else 'CANCELLED' if cancel_after is not None and elapsed >= cancel_after else None)
            if reason and killed_at is None:
                killed_at = time.monotonic()
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            require(killed_at is None or time.monotonic() - killed_at < 5, 'CLEANUP_UNCONFIRMED: pipe descendants remain')
            for key, _ in selector.select(0.05):
                if key.data == 'stdin':
                    try:
                        offset += os.write(key.fd, data[offset:offset + 65536])
                    except BrokenPipeError:
                        offset = len(data)
                    if offset == len(data):
                        selector.unregister(key.fileobj)
                        key.fileobj.close()
                else:
                    chunk = os.read(key.fd, 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        key.fileobj.close()
                    else:
                        limit = output_limit if key.data == 'stdout' else MAX_STDERR
                        if len(buffers[key.data]) + len(chunk) > limit:
                            reason = reason or 'OUTPUT_LIMIT'
                        else:
                            buffers[key.data].extend(chunk)
                            if probe and key.data == 'stdout':
                                for line in buffers['stdout'].splitlines():
                                    try:
                                        event = json.loads(line)
                                    except (ValueError, UnicodeError):
                                        continue
                                    namespace = event.get('pidNamespace') if isinstance(event, dict) else None
                                    if namespace and namespace not in observed_members:
                                        members = namespace_members(namespace)
                                        if members:
                                            observed_members[namespace] = members
        status = process.wait(timeout=5)
    finally:
        selector.close()
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)
        for stream in (process.stdin, process.stdout, process.stderr):
            stream.close()
    group_gone = False
    try:
        os.killpg(process.pid, 0)
    except ProcessLookupError:
        group_gone = True
    require(group_gone, 'CLEANUP_UNCONFIRMED: launcher process group remains')
    observations = []
    if probe:
        for line in buffers['stdout'].splitlines():
            try:
                event = json.loads(line)
            except (ValueError, UnicodeError):
                continue
            if isinstance(event, dict) and 'pidNamespace' in event:
                require(event['pidNamespace'] in observed_members, 'CLEANUP_UNOBSERVABLE: no live private namespace member observed')
                require(not namespace_members(event['pidNamespace']), 'CLEANUP_UNCONFIRMED: private namespace still has processes')
                observations.append(event)
    usage_after = resource.getrusage(resource.RUSAGE_CHILDREN)
    cpu_seconds = usage_after.ru_utime + usage_after.ru_stime - usage_before.ru_utime - usage_before.ru_stime
    return {'cpuSeconds': cpu_seconds, 'status': status, 'reason': reason, 'stdout': bytes(buffers['stdout']), 'stderr': bytes(buffers['stderr']),
            'wallMilliseconds': round((time.monotonic() - started) * 1000), 'processGroupGone': group_gone,
            'probeObservations': observations, 'liveNamespaceMembersObserved': observed_members}


def verify_candidate(candidate, lock):
    manifest = json.loads((candidate / 'manifest.json').read_bytes())
    require(manifest['schema'] == 'agi-fleet/alpha-candidate-artifact/v1' and manifest['productionQualified'] is False
            and manifest['settlementAuthority'] is False and manifest['qualification'] == 'NOT_RUN', 'Not an unqualified candidate')
    target = manifest['target']
    require(target in lock['targets'] and manifest['sourceCommit'] == lock['source']['commit']
            and manifest['inputsSha256'] == file_sha(HERE / 'inputs.lock.json')
            and manifest['builderSha256'] == file_sha(HERE / 'build.py')
            and manifest['launcherSha256'] == file_sha(HERE / 'launcher.py.in'), 'Candidate source binding changed')
    require(manifest['assets'] == [lock['targets'][target]['python'], *lock['targets'][target]['runtimePackages'], *lock['targets'][target]['wheels']], 'Candidate asset bindings changed')
    archive = candidate / 'candidate.tar.gz'
    require(not archive.is_symlink() and archive.stat().st_size == manifest['archiveBytes']
            and file_sha(archive) == manifest['archiveSha256'], 'Saved archive changed')
    require(manifest['treeSha256'] == sha(canonical(manifest['entries'])), 'Manifest tree digest changed')
    return manifest


def contract_check(work_spec, envelope=None, expected_refusal=None):
    # Fixed checked-in bridge; no task-selected executable or JavaScript content.
    node = shutil.which('node')
    require(node is not None, 'Install the existing Fleet hash-pinned Node runtime for contract checks')
    result = subprocess.run([node, str(HERE / 'check-contract.mjs')],
                            input=canonical({'input': {'workSpec': work_spec}, 'envelope': envelope}),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, check=False)
    if expected_refusal is not None:
        require(result.returncode != 0 and not result.stdout and result.stderr.decode().strip() == expected_refusal,
                'Expected pre-admission refusal was not observed')
        return {'refused': expected_refusal, 'nativeLaunchAttempted': False}
    require(result.returncode == 0 and len(result.stdout) < 8192, 'Fleet pre-admission/receipt contract rejected candidate bytes')
    return json.loads(result.stdout)


def malformed_vectors(case):
    valid = json.loads(case['workSpec'])
    wrong_market = {**valid, 'market': 'manager-usdc'}
    wrong_executor = {**valid, 'executor': 'shell'}
    code = {**valid, 'mission': {'goal': 'Refuse code', 'work': {'kind': 'coding', 'code': 'print(1)'}}}
    return [('invalid-json', b'{'), ('invalid-utf8', b'\xff'),
            ('duplicate-key', b'{"schema":"first","schema":"second"}'),
            ('wrong-market', canonical(wrong_market)), ('wrong-executor', canonical(wrong_executor)),
            ('code-kind', canonical(code)), ('nonfinite', b'{"value":NaN}')]


def load_fixtures(lock):
    fixture_path = ALPHA.parent / 'tests/fixtures/alpha-contract.json'
    require(file_sha(fixture_path) == lock['contractFixtureSha256'], 'Contract fixture changed before execution')
    fixture = json.loads(fixture_path.read_text())
    require(len(fixture['cases']) == 4 and {case['kind'] for case in fixture['cases']} ==
            {'allocation', 'forecast', 'research', 'schedule'}, 'Exactly four reviewed fixture kinds are required')
    return fixture


def qualify(candidate, evidence, cache, source):
    require(platform.system() == 'Linux' and os.geteuid() != 0, 'Run candidate qualification on non-root Linux disposable runner')
    require(not evidence.exists(), 'Choose an absent evidence file')
    lock = read_lock()
    manifest = verify_candidate(candidate, lock)
    require(platform.machine() == lock['targets'][manifest['target']]['machine'], 'Candidate architecture does not match host')
    report = {'schema': 'agi-fleet/alpha-candidate-isolation/v1', 'evidenceClass': 'NATIVE_CANDIDATE_ISOLATION',
              'productionQualified': False, 'fleetGrantAdapterQualified': False, 'settlementAuthority': False,
              'archiveSha256': manifest['archiveSha256'], 'treeSha256': manifest['treeSha256'],
              'inputsSha256': manifest['inputsSha256'], 'sourceCommit': manifest['sourceCommit'],
              'qualifierSha256': file_sha(Path(__file__)), 'probeSha256': file_sha(HERE / 'probe.py'),
              'contractBridgeSha256': file_sha(HERE / 'check-contract.mjs'),
              'fleetCommit': subprocess.check_output(['git', '-C', str(ALPHA.parents[1]), 'rev-parse', 'HEAD'], text=True).strip(),
              'fleetSourceDirty': bool(subprocess.check_output(['git', '-C', str(ALPHA.parents[1]), 'status', '--porcelain'], text=True).strip()),
              'tests': [], 'status': 'FAILED', 'nativeExecutionObserved': False}
    evidence.parent.mkdir(parents=True, exist_ok=True)
    try:
        trusted(BIN)
        trusted(LIMIT)
        report['host'] = {'machine': platform.machine(), 'kernel': platform.release(),
                          'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                          'bwrapSha256': file_sha(BIN), 'prlimitSha256': file_sha(LIMIT)}
        with tempfile.TemporaryDirectory(prefix='alpha-candidate-') as temp:
            # Reconstruct from verified official assets and pinned source blobs.
            # A caller's self-describing manifest is never execution authority.
            expected = build(lock, manifest['target'], cache, source, Path(temp) / 'reconstructed')
            require(manifest == expected, 'Candidate differs from independently reconstructed pinned inputs')
            extracted = Path(temp) / 'saved-archive'
            extracted.mkdir()
            with (candidate / 'candidate.tar.gz').open('rb') as stream:
                extract_tar(stream, extracted)
            root = extracted / 'rootfs'
            require(tree_manifest(root) == manifest['entries'], 'Saved archive extraction differs from rootfs manifest')
            fixture = load_fixtures(lock)
            report['contractFixtureSha256'] = lock['contractFixtureSha256']
            report['nodeExecutableSha256'] = file_sha(shutil.which('node') or '/missing-node')
            for case in fixture['cases']:
                admission = contract_check(case['workSpec'])
                actual = {}
                for mode, field in [('validate', 'alphaValidation'), ('work', 'alphaOutput')]:
                    result = run(root, mode, case['workSpec'].encode(),
                                 output_limit=min(MAX_STDOUT, admission['budget']['validatorBytes' if mode == 'validate' else 'wireBytes']))
                    require(result['status'] == 0 and result['reason'] is None and not result['stderr'],
                            'Candidate ' + mode + ' failed: ' + result['stderr'].decode(errors='replace'))
                    require(result['stdout'] == case[field].encode(), 'Pinned fixture parity failed: ' + case['kind'] + '/' + mode)
                    actual[field] = result['stdout'].decode('utf-8')
                    report['nativeExecutionObserved'] = True
                    report['tests'].append({'case': case['kind'], 'mode': mode, 'stdoutSha256': sha(result.pop('stdout')),
                                            **{k:v for k,v in result.items() if k != 'stderr'}})
                require(contract_check(case['workSpec'], actual)['receiptChecked'], 'Actual Fleet receipt contract was not checked')
            oversized = json.loads(fixture['cases'][0]['workSpec'])
            oversized['mission'] = {'goal': 'Predictable escaped-text expansion', 'work': {'kind': 'research',
                'sources': [{'id': 'source-' + str(i), 'title': 'Supplied control text', 'text': (chr(92) + chr(10)) * 5000} for i in range(8)]}}
            refusal = contract_check(canonical(oversized).decode(), expected_refusal='ALPHA_OUTPUT_BUDGET_EXCEEDED')
            report['tests'].append({'preAdmission': 'predictable-output-expansion', **refusal})
            for label, data in malformed_vectors(fixture['cases'][0]):
                for mode in ('validate', 'work'):
                    result = run(root, mode, data)
                    require(result['status'] != 0 and result['reason'] is None and not result['stdout'] and result['stderr'],
                            'Malformed input was not cleanly refused: ' + label + '/' + mode)
                    report['tests'].append({'refusal': label, 'mode': mode, 'status': result['status'],
                                            'stderrSha256': sha(result['stderr']), 'processGroupGone': result['processGroupGone']})
            host_pidns = os.readlink('/proc/self/ns/pid')
            host_netns = os.readlink('/proc/self/ns/net')
            for probe in ('isolation', 'timeout', 'cancel', 'cpu', 'output'):
                result = run(root, 'probe', probe=probe, wall=1 if probe == 'timeout' else 15,
                             cancel_after=0.5 if probe == 'cancel' else None)
                require(result['probeObservations'], 'Fixed probe did not run inside candidate')
                for event in result['probeObservations']:
                    require(event['pidNamespace'] != host_pidns and event['networkNamespace'] != host_netns,
                            'Private process/network namespace missing')
                expected = {'isolation': None, 'timeout': 'WALL_TIMEOUT', 'cancel': 'CANCELLED', 'cpu': None, 'output': 'OUTPUT_LIMIT'}[probe]
                require(result['reason'] == expected, 'Unexpected probe termination: ' + probe)
                require(result['status'] == 0 if probe == 'isolation' else result['status'] != 0, 'Unexpected probe exit')
                if probe == 'cpu':
                    require(result['status'] in (-signal.SIGKILL, 128 + signal.SIGKILL)
                            and 9 <= result['cpuSeconds'] <= 11 and result['wallMilliseconds'] < 15000,
                            'CPU bound needs observed SIGKILL and approximately ten consumed CPU seconds')
                report['tests'].append({'probe': probe, 'stdoutSha256': sha(result.pop('stdout')),
                                        **{k:v for k,v in result.items() if k != 'stderr'}})
        require(report['nativeExecutionObserved'] is True and len(report['tests']) == 28
                and sum('case' in test for test in report['tests']) == 8
                and sum('refusal' in test for test in report['tests']) == 14, 'Incomplete native candidate coverage')
        report['status'] = 'PASSED'
    except BaseException as error:
        report['error'] = str(error)
        raise
    finally:
        evidence.write_bytes(canonical(report) + b'\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True, type=Path)
    parser.add_argument('--evidence', required=True, type=Path)
    parser.add_argument('--cache', required=True, type=Path)
    parser.add_argument('--alpha-repository', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(qualify(args.candidate.resolve(), args.evidence.resolve(), args.cache.resolve(), args.alpha_repository.resolve())))


if __name__ == '__main__':
    main()
