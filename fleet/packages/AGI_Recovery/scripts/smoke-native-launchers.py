#!/usr/bin/env python3
"""Exercise unmodified launchers and real modules from a final extracted release.

Linux results establish module entry, bounded refusals and loopback UI startup.
They never establish macOS installation, OAuth, Docker or physical qualification.
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import tempfile
import time
import urllib.request

ROLES = ('agent', 'node', 'moderator', 'employer', 'evidence', 'recovery')
BAD = re.compile(r'SyntaxError:|ERR_MODULE_NOT_FOUND|Cannot find module|ReferenceError:|Permission denied|command not found|syntax error near', re.I)
SETUP = re.compile(r'^(?:Install|Setup-OpenClaw|Clean-Install-Compute|Continue-.*|Retry-.*|Resume-Fresh-OAuth|Verified-Install)\.(?:command|sh)$')


def sha256(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def release_role(root):
    role = json.loads((root / 'config/companion-releases.json').read_text()).get('role')
    if role not in ('fleet', *ROLES):
        raise ValueError('Release metadata must identify Fleet or a supported standalone role.')
    return role


def is_fleet(root):
    if release_role(root) != 'fleet':
        return False
    missing = [role for role in ROLES if not (root / 'packages' / ('AGI_' + role.title())).is_dir()]
    if missing:
        raise ValueError('Fleet metadata requires all six role packages; missing: ' + ', '.join(missing))
    return True


def discover(root):
    roots = [root]
    if is_fleet(root):
        roots += [root / 'packages' / ('AGI_' + role.title()) for role in ROLES]
    found = set()
    for base in roots:
        found.update(p for p in base.glob('*') if p.is_file() and p.suffix in ('.command', '.sh'))
        found.update(p for p in (base / 'fleet').glob('*.command') if p.is_file())
        found.update(p for p in base.glob('*.app/Contents/MacOS/*') if p.is_file())
    return sorted(found)


def package_role(path, root):
    root_role = release_role(root)
    if root_role != 'fleet':
        return root_role
    if path.parent == root:
        match = re.match(r'Launch-(?:AGI-)?(Agent|Node|Moderator|Employer|Evidence|Recovery)(?:[.-])', path.name)
        if match:
            return match.group(1).lower()
    for part in path.parts:
        for role in ROLES:
            if part == 'AGI_' + role.title() or part.startswith('AGI_' + role.title() + '_'):
                return role
    return 'agent'


def stop_children(child, home):
    pids = []
    # GUI helpers detach the application. Its own private lock records its PID
    # in our namespace; /proc can expose outer-namespace PIDs in CI sandboxes.
    for lock in home.rglob('application.lock'):
        try:
            pid = json.loads(lock.read_text()).get('pid')
            if isinstance(pid, int) and pid > 1:
                pids.append(pid)
        except (OSError, ValueError):
            pass
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        child.wait(timeout=3)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=3)
    # Wait for detached UI processes to release fixed native-launcher ports.
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        live = []
        for pid in pids:
            try:
                os.kill(pid, 0)
                live.append(pid)
            except ProcessLookupError:
                pass
        if not live:
            break
        time.sleep(0.05)
    for pid in pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def gui_contract(path, root, role):
    package = root / 'packages' / ('AGI_' + role.title()) if is_fleet(root) else root
    if path.name.startswith('Launch-Demo.'):
        return {'entry': package / 'src/cli.mjs', 'html': package / 'web/index.html', 'record': None, 'lock': None, 'detached': False}
    if path.name == 'Launch-Fleet-Monitor.command':
        base = path.parent
        return {'entry': base / 'monitor.mjs', 'html': base / 'index.html', 'record': 'monitor-access.json', 'lock': None, 'detached': False}
    if role in ('agent', 'node'):
        detached = path.suffix != '.sh'
        return {'entry': package / 'src/launch.mjs', 'html': package / 'app/index.html', 'record': 'launch.json', 'lock': 'application.lock', 'detached': detached}
    base = package if package in path.parents else root
    return {'entry': base / 'ops/launch.mjs', 'html': base / 'web/index.html', 'record': 'panel.json', 'lock': 'process.lock', 'detached': False}


def case_processes(home, nonce):
    # /proc exposes outer PIDs in some CI namespaces. Match namespace identity
    # and use NSpid for application PID locks, rather than assuming either PID.
    namespace = os.readlink('/proc/self/ns/pid')
    owned = {}
    for directory in pathlib.Path('/proc').glob('[0-9]*'):
        try:
            if os.readlink(directory / 'ns/pid') != namespace:
                continue
            environment = (directory / 'environ').read_bytes().split(b'\0')
            if ('HOME=' + str(home)).encode() not in environment or ('AGI_LAUNCHER_SMOKE_CASE=' + nonce).encode() not in environment:
                continue
            status = dict(line.split(':', 1) for line in (directory / 'status').read_text().splitlines() if ':' in line)
            owned[int(directory.name)] = {'directory': directory, 'pid': int(status['NSpid'].split()[-1]), 'parent': int(status['PPid']), 'command': [x.decode() for x in (directory / 'cmdline').read_bytes().split(b'\0') if x], 'cwd': pathlib.Path(os.readlink(directory / 'cwd')), 'exe': pathlib.Path(os.readlink(directory / 'exe')).resolve()}
        except (OSError, ValueError, KeyError, UnicodeDecodeError):
            continue
    return owned


def socket_owner(port, home, nonce, node, contract, launcher_pid, record):
    inodes = set()
    for line in pathlib.Path('/proc/self/net/tcp').read_text().splitlines()[1:]:
        fields = line.split()
        if fields[1] == '0100007F:' + format(port, '04X') and fields[3] == '0A':
            inodes.add(fields[9])
    if not inodes:
        return None
    processes = case_processes(home, nonce)
    for outer, process in processes.items():
        command = process['command']
        if process['exe'] != node.resolve() or len(command) < 2:
            continue
        entry = pathlib.Path(command[1])
        entry = (process['cwd'] / entry).resolve() if not entry.is_absolute() else entry.resolve()
        if entry != contract['entry'].resolve():
            continue
        lock_proves_owner = False
        if contract['lock']:
            if record is None:
                continue
            try:
                lock = record.parent / contract['lock']
                lock_proves_owner = lock.is_file() and not lock.is_symlink() and json.loads(lock.read_text()).get('pid') == process['pid']
            except (OSError, ValueError):
                pass
            if not lock_proves_owner:
                continue
        ancestor = outer
        seen = set()
        descends = False
        while ancestor in processes and ancestor not in seen:
            seen.add(ancestor)
            if processes[ancestor]['pid'] == launcher_pid:
                descends = True
                break
            ancestor = processes[ancestor]['parent']
        if not descends and not (contract['detached'] and lock_proves_owner):
            continue
        for fd in (process['directory'] / 'fd').glob('*'):
            try:
                target = os.readlink(fd)
            except OSError:
                continue
            match = re.fullmatch(r'socket:\[(\d+)\]', target)
            if match and match.group(1) in inodes:
                return {'pid': process['pid'], 'expectedEntry': str(contract['entry']), 'socketInode': match.group(1), 'isolatedHomeAndCaseNonceVerified': True, 'launcherDescendant': descends, 'privatePIDLockVerified': lock_proves_owner}
    return None


def loopback_evidence(home, output, node, contract, nonce, launcher_pid):
    candidates = []
    if contract['record']:
        for file in home.rglob(contract['record']):
            try:
                if file.is_symlink():
                    continue
                data = json.loads(file.read_text())
                match = re.match(r'http://127\.0\.0\.1:(\d+)', data.get('url', ''))
                port = int(match.group(1)) if match else data.get('port')
                if isinstance(port, int) and 0 < port < 65536:
                    candidates.append((port, file))
            except (ValueError, OSError):
                pass
    else:
        candidates = [(int(port), None) for port in re.findall(r'Open your private demo: http://127\.0\.0\.1:(\d+)/', output)]
    expected = contract['html'].read_bytes()
    for port, record in candidates:
        owner = socket_owner(port, home, nonce, node, contract, launcher_pid, record)
        if not owner:
            continue
        url = 'http://127.0.0.1:' + str(port) + '/'
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                body = response.read(len(expected) + 1)
                if response.status == 200 and response.headers.get_content_type() == 'text/html' and body == expected:
                    # A second ownership check closes the most obvious stale-port race.
                    after = socket_owner(port, home, nonce, node, contract, launcher_pid, record)
                    if after and after['pid'] == owner['pid'] and after['socketInode'] == owner['socketInode']:
                        return {'origin': url.rstrip('/'), 'status': 200, 'htmlSHA256': hashlib.sha256(body).hexdigest(), 'exactPackagedHTMLVerified': str(contract['html']), 'ownership': owner}
        except (OSError, ValueError):
            pass
    return None


def configure_case(path, root, home, role):
    name = path.name
    args, stdin, markers, codes = [], '\n', [], [0]
    kind = 'module-entry'
    commissioning = None
    if name in ('Launch.sh','Install.sh','Inspect.sh','Stop-Compute.sh','Start-Approved.sh','Qualify-Linux.sh','Configure-Public-Browser.sh','Import-Public-Browser-Qualification.sh'):
        args, codes, markers, kind = ['--help'], [0], ['Linux'], 'linux-help-only-not-installation'
    elif name in ('Prepare-Ubuntu.sh','Prepare-Compute.sh','Transfer-Setup.sh'):
        args, codes, markers, kind = ['--help'], [0], ['usage:'], 'linux-help-only-not-installation'
    elif name == 'Verify-Linux.sh':
        markers, kind = ['"status": "PASS"'], 'final-linux-manifest-verification'
    elif SETUP.match(name):
        registry_file = root / 'shared/runtime/compute/role-registry.json'
        contract = json.loads(registry_file.read_text())['roles'][role]
        kit = {'schema': contract['schema'], 'mode': 'workstation', 'openclawVersion': '2026.9.5', 'token': '0' * 64, 'port': contract['port'], 'agent': contract['oauth'][0], 'model': contract['primaryModel'], 'signerUID': os.getuid()}
        if role not in ('agent', 'node'):
            kit['role'] = role
        # A synthetic same-UID handoff intentionally fails the real isolation
        # guard inside setupCapable, before runtime discovery or profile writes.
        file = home / 'synthetic-same-uid-private-setup.json'
        file.write_text(json.dumps(kit))
        file.chmod(0o600)
        args, codes = [str(file)], [1]
        markers = ['COMPUTE_SEPARATE_OS_USER_REQUIRED']
        if path.parent == root and is_fleet(root):
            markers.append('Opening the dedicated role installer')
        kind = 'dedicated-installer-validation-refusal'
    elif name == 'Qualify-Mac.command' or name == 'qualify-mac.mjs':
        commissioning = home / 'commissioning-output'
        args = ['--role', role, '--runs', '1', '--out', str(commissioning)]
        markers, codes = ['REAL_APPLE_SILICON_MAC_REQUIRED', 'Commissioning report:'], [1]
        kind = 'real-module-platform-refusal'
    elif name in ('Update-Signer.command', 'Experimental-Migration.command', 'Repair-Compute.command', 'Restart-Compute.command', 'Configure-Public-Browser.command', 'Import-Public-Browser-Qualification.command'):
        args, markers = ['--help'], ['Repair-Compute.command' if name == 'Experimental-Migration.command' else name]
    elif name == 'Administrator-DNS.command':
        args, markers, codes = ['--smoke-invalid-action'], ['Use inspect, prepare, apply, or rollback.'], [1]
        kind = 'real-module-argument-refusal'
    elif name == 'Prepare-Compute-Runtime.command':
        parent = home / '.agi-genesis-runtime'
        parent.mkdir(mode=0o700, exist_ok=True)
        target = parent / 'openclaw-2026.9.5'
        target.write_text('Deliberately invalid smoke fixture; no download is permitted.\n')
        markers, codes = ['Preparation stopped:'], [1]
        kind = 'real-module-runtime-refusal'
    elif name.startswith(('Connect-Agent.', 'Connect-Node.')):
        stdin, markers, codes = '-invalid\n', ['Enter a hostname or IPv4 address only.'], [1]
        kind = 'shell-input-refusal'
    elif name.startswith(('Setup-Supervised-Monitor.', 'Remove-Supervised-Monitor.')):
        markers, codes = ['Run this under your dedicated non-root monitoring account on macOS.'], [1]
        kind = 'real-module-platform-refusal'
    elif name == 'Open-Fleet-Monitor.command':
        markers, codes = ['Monitor is unavailable. Start or reinstall its supervised service'], [1]
        kind = 'real-module-state-refusal'
    elif name.startswith('Launch-Native-Workforce.'):
        stdin, markers = ['4\n', ['Private native workforce', 'NATIVE_WORKFORCE.html']]
    elif name == 'Practice-Offline.command':
        markers = ['AGI Fleet offline practice', 'Complete public example: approve', 'invalid price: reject']
    elif name == 'Verify-Package.command':
        markers = ['files verified; 0 missing or changed.']
        kind = 'final-manifest-verification'
    elif name == 'Cleanup-Evidence.command':
        args = ['--json']
        markers = ['"schema": "agi-cleanup-maintenance/v1"', '"providerCalled": false', '"settingsChanged": false', '"limitsChanged": false', '"automaticStopRemoval": false']
        kind = 'real-module-read-only-report'
    elif name.startswith('Launch-') or '.app' in str(path):
        args = ['--no-open', '--port', '0']
        kind = 'loopback-ui'
    else:
        raise ValueError('No explicit safe probe for launcher ' + str(path))
    return dict(args=args, stdin=stdin, markers=markers, codes=codes, kind=kind, commissioning=commissioning)


def run_case(path, root, output_dir, node, timeout, index, role, direct=False):
    relative = str(path.relative_to(root))
    case_id = f'{index:03d}-' + re.sub(r'[^A-Za-z0-9_-]+', '-', relative) + '-' + role
    result = {'id': case_id, 'launcher': relative, 'role': role, 'sha256': sha256(path), 'result': 'FAIL'}
    with tempfile.TemporaryDirectory(prefix='agi-launcher-smoke-') as temporary:
        home = pathlib.Path(temporary)
        runtime = home / '.agi-genesis-runtime/node-24.21.0/bin'
        runtime.mkdir(parents=True, mode=0o700)
        (runtime / 'node').symlink_to(node)
        case = configure_case(path, root, home, role)
        contract = gui_contract(path, root, role) if case['kind'] == 'loopback-ui' else None
        nonce = os.urandom(24).hex()
        result.update({'probe': case['kind'], 'arguments': [s.replace(str(home), '$ISOLATED_HOME') for s in case['args']]})
        env = {'HOME': str(home), 'PATH': str(node.parent) + ':/usr/bin:/bin:/usr/sbin:/sbin', 'USER': 'launcher-smoke', 'LOGNAME': 'launcher-smoke', 'LANG': 'C.UTF-8', 'SHELL': '/bin/bash', 'TMPDIR': str(home), 'CI': 'true', 'AGI_LAUNCHER_SMOKE_CASE': nonce}
        log = output_dir / (case_id + '.log')
        command = ([str(node), str(path)] if direct else [str(path)]) + case['args']
        start = time.monotonic()
        with log.open('wb') as stream:
            try:
                child = subprocess.Popen(command, cwd=home, env=env, stdin=subprocess.PIPE, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
            except OSError as error:
                result.update(error=str(error), seconds=0)
                return result
            try:
                child.stdin.write(case['stdin'].encode())
                child.stdin.close()
            except BrokenPipeError:
                pass  # Refusing launchers may exit before consuming input; validate status/output below.
            http = None
            stable_since = None
            expired = False
            try:
                while True:
                    text = log.read_text(errors='replace')
                    if BAD.search(text):
                        break
                    if case['kind'] == 'loopback-ui':
                        exit_now = child.poll()
                        if exit_now is not None and (exit_now != 0 or not contract['detached']):
                            break
                        http = loopback_evidence(home, text, node, contract, nonce, child.pid)
                        if http:
                            stable_since = stable_since or time.monotonic()
                            if time.monotonic() - stable_since >= 0.3:
                                break
                        else:
                            stable_since = None
                    if child.poll() is not None:
                        if case['kind'] != 'loopback-ui' or time.monotonic() - start > min(timeout, 5):
                            break
                    if time.monotonic() - start >= timeout:
                        expired = True
                        break
                    time.sleep(0.05)
                observed_exit = child.poll()
                text = log.read_text(errors='replace')
                result.update(exitCodeBeforeCleanup=observed_exit, timedOut=expired, seconds=round(time.monotonic()-start, 3))
                failed_marker = BAD.search(text)
                if failed_marker:
                    result['error'] = 'Unexpected runtime/shell failure: ' + failed_marker.group()
                elif expired:
                    result['error'] = 'Probe timed out before its required evidence.'
                elif case['kind'] == 'loopback-ui':
                    if observed_exit is not None and (observed_exit != 0 or not contract['detached']):
                        result['error'] = 'GUI launcher exited unexpectedly before smoke completion: ' + str(observed_exit)
                    elif http and stable_since is not None and time.monotonic() - stable_since >= 0.3:
                        result.update(result='PASS_LOOPBACK_HTTP', http=http)
                    else:
                        result['error'] = 'No stable responding app with verified process/socket ownership and exact packaged HTML was established.'
                elif observed_exit not in case['codes']:
                    result['error'] = 'Unexpected exit code; expected ' + repr(case['codes'])
                elif any(marker not in text for marker in case['markers']):
                    result['error'] = 'Required module-output marker absent: ' + repr([m for m in case['markers'] if m not in text])
                elif case['kind'] == 'real-module-runtime-refusal' and not re.search(r'Preparation stopped: (?:RUNTIME_INSTALL_STATE_INVALID|COMPUTE_NODE_UNTRUSTED)\b', text):
                    result['error'] = 'Runtime preparation did not reach an explicitly expected safe refusal.'
                else:
                    result.update(result='PASS_MODULE_ENTRY', markers=case['markers'])
                if case['commissioning'] and result['result'].startswith('PASS'):
                    report = json.loads((case['commissioning'] / 'commissioning.json').read_text())
                    if report.get('failure') != 'REAL_APPLE_SILICON_MAC_REQUIRED' or report.get('physicalMac') is not False or report.get('checks') != [] or report.get('role') != role:
                        result.update(result='FAIL', error='Unexpected commissioning report; expected Linux platform refusal with no checks.')
                    else:
                        result['commissioning'] = {key: report.get(key) for key in ('schema', 'role', 'physicalMac', 'status', 'qualification', 'failure', 'checks')}
            finally:
                stop_children(child, home)
        # Logs never contain real credentials; ephemeral loopback launch secrets are redacted.
        text = log.read_text(errors='replace').replace(str(home), '$ISOLATED_HOME')
        text = re.sub(r'(http://127\.0\.0\.1:\d+/#)[a-f0-9]{64}', r'\1[EPHEMERAL-REDACTED]', text)
        log.write_text(text)
        result['log'] = log.name
    return result


def build_cases(root):
    launchers = discover(root)
    fleet = is_fleet(root)
    cases = []
    for path in launchers:
        role = package_role(path, root)
        variants = ROLES if path.parent == root and fleet and path.name in ('Install.command', 'Qualify-Mac.command') else (role,)
        for selected in variants:
            cases.append((path, selected, False))
    packages = [root / 'packages' / ('AGI_' + r.title()) for r in ROLES] if fleet else [root]
    for package in packages:
        path = package / 'scripts/qualify-mac.mjs'
        if path.is_file():
            cases.append((path, package_role(path, root), True))
    return launchers, cases


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--node', type=pathlib.Path, default=pathlib.Path(shutil.which('node') or '/missing-node'))
    parser.add_argument('--timeout', type=float, default=25)
    parser.add_argument('--only', help='Optional regex subset for development; recorded as incomplete coverage.')
    args = parser.parse_args()
    root, output, node = args.root.resolve(), args.output.resolve(), args.node.resolve()
    if output == root or root in output.parents:
        parser.error('Evidence must be written outside the extracted release so the tested tree remains unchanged.')
    if os.uname().sysname != 'Linux':
        parser.error('This bounded-refusal harness is explicitly for Linux; use real Mac qualification separately.')
    version = subprocess.check_output([str(node), '--version'], text=True).strip()
    match = re.fullmatch(r'v24\.(\d+)\.\d+', version)
    if not match or int(match.group(1)) < 19:
        parser.error('Real supported Node 24.19+ within 24.x is required.')
    output.mkdir(parents=True, exist_ok=False)
    launchers, cases = build_cases(root)
    if args.only:
        cases = [case for case in cases if re.search(args.only, str(case[0].relative_to(root)))]
    evidence = {'schema': 'agi-final-extracted-native-launcher-smoke/v1', 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'root': str(root), 'node': str(node), 'nodeVersion': version, 'platform': os.uname().sysname, 'machine': os.uname().machine, 'physicalMacQualification': 'NOT_RUN', 'installationQualification': 'NOT_RUN', 'providerCalls': False, 'realWalletAccess': False, 'nativeShellEntryFilesDiscovered': len(launchers), 'coverage': 'SUBSET' if args.only else 'ALL_USER_FACING_SHELL_AND_APP_ENTRIES', 'excludedScope': 'Container entrypoint scripts and sourced shell libraries are parser-checked separately; they are not native user launchers.', 'limitations': ['Linux only. Finder, macOS launchd, Apple silicon Docker, OAuth, real Standard-account installation and physical soak were not run.', 'Setup probes use synthetic invalid nonsecret handoffs; expected validation refusals establish execution of the real dedicated module, not successful installation.', 'Node binary and application modules are real and unmodified. Native shells are executed directly from the supplied extracted release.'], 'cases': []}
    for index, (path, role, direct) in enumerate(cases, 1):
        result = run_case(path, root, output, node, args.timeout, index, role, direct)
        evidence['cases'].append(result)
        print(result['result'] + ' ' + result['launcher'] + ' [' + role + ']', flush=True)
        (output / 'launcher-smoke.json').write_text(json.dumps(evidence, indent=2) + '\n')
    evidence['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    evidence['summary'] = {'cases': len(cases), 'passed': sum(c['result'].startswith('PASS') for c in evidence['cases']), 'failed': sum(c['result'] == 'FAIL' for c in evidence['cases'])}
    evidence['status'] = 'PASS' if cases and evidence['summary']['failed'] == 0 and not args.only else 'FAIL' if not cases or evidence['summary']['failed'] else 'SUBSET_PASS'
    (output / 'launcher-smoke.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence['summary']), flush=True)
    return 1 if not cases or evidence['summary']['failed'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
