#!/usr/bin/env python3
"""INACTIVE WORKFLOW IMPLEMENTATION. No stage is authorized by this source file.

Used only by a separately published, exact-commit, user-approved one-time workflow.
Unit tests call pure helpers or mock subprocess/network; no native stage is tested.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib
import json
import os
import posixpath
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request

REPOSITORY = 'MontrealAI/AGI-Fleet-Linux'
GIT_URL = 'https://github.com/' + REPOSITORY + '.git'
HARNESS_COMMIT = '076360c836d55ebc25d175bf3119ec88f740c1da'
HARNESS_TREE = '573430501e15cd46461a6a77ff838890a0d7ae19'
RUNTIME_COMMIT = '2d5d62369d57db9abc9f622ccb4781e6cccd90d2'
RUNTIME_TREE = '7c52bc0cdd85b87f2219b46b6be6caeafa136b43'
RELATIVE_HARNESS = Path('local-runtime/alpha/native-qualification/provision')
PROPOSAL = RELATIVE_HARNESS / 'workflow/alpha-fixed-path.workflow.yml'
LIVE_WORKFLOW = Path('.github/workflows/alpha-fixed-path.yml')
STAGES = ('initialize', 'inputs', 'prerequisites', 'prepare', 'provision', 'qualify', 'collect')
PRESERVE = '--preserve-env=GITHUB_ACTIONS,RUNNER_ENVIRONMENT,GITHUB_REPOSITORY'
PACKAGES = ('bubblewrap', 'util-linux', 'apparmor-profiles', 'binutils')
PUBLIC_PREPARATION = ('preparation.json', 'preparation.sha256', 'approval.json', 'source-lock.json', 'fixture-lock.diff', 'remote-provenance.json')
PUBLIC_COMMANDS = ('dependencies', 'harness-python-tests', 'harness-cancellation-tests', 'packages-before', 'apt-update', 'apt-install', 'host-policy', 'packages-after', 'prepare', 'provision', 'qualify')
PUBLIC_STAGE = ('invocation.json', 'input-references.json', 'host-policy.json', 'package-identities.json',
                *(f'command-{name}.json' for name in PUBLIC_COMMANDS),
                *(f'{prefix}-{stage}.json' for prefix in ('started', 'stage') for stage in STAGES if stage != 'collect'))
PUBLIC_ACTUAL = ('fixed-path.json', *(f'attempt-{i}.json' for i in range(8)), 'drift-prepare.json', 'drift-check.json')


def need(value, message):
    if not value:
        raise ValueError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read(file, limit=128_000_000):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        s = os.fstat(stream.fileno())
        need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_size <= limit, 'Unsafe input file')
        raw = stream.read(limit + 1)
    need(len(raw) == s.st_size and len(raw) <= limit, 'Input changed during read')
    return raw


def write_json(file, value):
    with open(file, 'x', encoding='utf8') as stream:
        json.dump(value, stream, sort_keys=True, indent=2, allow_nan=False)
        stream.write('\n')


def clean_env(env):
    # No GitHub token or signed URL is passed to Git, npm, Node, sudo or payloads.
    keep = ('PATH', 'HOME', 'LANG', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'GITHUB_REPOSITORY')
    return {**{key: env[key] for key in keep if key in env}, 'PYTHONDONTWRITEBYTECODE': '1', 'GIT_TERMINAL_PROMPT': '0'}


def git(directory, *args):
    return subprocess.check_output(['git', '-C', str(directory), *args], env=clean_env(os.environ)).decode().strip()


def verify_checkout(directory, commit, tree=None):
    need(git(directory, 'rev-parse', 'HEAD') == commit, 'Checkout commit changed')
    actual_tree = git(directory, 'rev-parse', 'HEAD^{tree}')
    need(tree is None or actual_tree == tree, 'Checkout tree changed')
    need(not git(directory, 'status', '--porcelain'), 'Checkout is not clean')
    return actual_tree


def paths(env):
    """Pure runner-derived layout; no caller-selected path, commit or artifact."""
    need(os.geteuid() != 0, 'Workflow stages must run as the non-root hosted runner')
    need(env.get('GITHUB_ACTIONS') == 'true' and env.get('RUNNER_ENVIRONMENT') == 'github-hosted' and env.get('GITHUB_REPOSITORY') == REPOSITORY, 'Hosted repository context required')
    need(env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch' and env.get('GITHUB_RUN_ATTEMPT') == '1', 'One manual invocation only; reruns require a new approved proposal')
    need(re.fullmatch('[1-9][0-9]*', env.get('GITHUB_RUN_ID', '')) is not None, 'Invalid workflow run identity')
    for key in ('GITHUB_SHA', 'GITHUB_WORKFLOW_SHA'):
        need(re.fullmatch('[a-f0-9]{40}', env.get(key, '')) is not None, 'Exact workflow commit required')
    need(env['GITHUB_SHA'] == env['GITHUB_WORKFLOW_SHA'], 'Workflow/source commit mismatch')
    need(env.get('GITHUB_WORKFLOW_REF') == REPOSITORY + '/' + str(LIVE_WORKFLOW) + '@' + env.get('GITHUB_REF', ''), 'Wrong workflow source reference')
    target = {'X64': 'linux-x64', 'ARM64': 'linux-arm64'}.get(env.get('RUNNER_ARCH'))
    need(target is not None and env.get('FLEET_MATRIX_TARGET') == target, 'Unsupported or mismatched native runner')
    roots = {}
    for key in ('GITHUB_WORKSPACE', 'RUNNER_TEMP'):
        raw = env.get(key, '')
        need(raw and not re.search(r'[\x00-\x1f\x7f]', raw), 'Malformed runner path')
        p = Path(raw)
        need(p.is_absolute() and p == p.resolve(strict=True) and p.is_dir(), 'Canonical existing runner root required')
        s = p.stat()
        need(s.st_uid == os.getuid() and s.st_mode & 0o022 == 0, 'Runner root ownership/mode mismatch')
        roots[key] = p
    workspace, temp = roots['GITHUB_WORKSPACE'], roots['RUNNER_TEMP']
    need(not workspace.is_relative_to(temp) and not temp.is_relative_to(workspace), 'Overlapping workspace and temporary root')
    root = temp / ('fleet-alpha-fixed-' + target)
    harness_source = temp / ('fleet-alpha-fixed-harness-' + target)
    for p in (root, harness_source):
        need(p == p.resolve(strict=False), 'Derived path alias refused')
        if p.exists():
            s = p.stat()
            need(p.is_dir() and s.st_uid == os.getuid() and s.st_mode & 0o022 == 0, 'Derived root ownership/mode mismatch')
    for child in ('source', 'downloads', 'tools', 'preparation', 'actual-evidence', 'public', 'private', 'retained'):
        p = root / child
        need(p == p.resolve(strict=False), 'Derived child alias refused')
        if p.exists():
            s = p.stat()
            need(p.is_dir() and s.st_uid == os.getuid() and s.st_mode & 0o022 == 0, 'Derived child ownership/mode mismatch')
    return {'target': target, 'workspace': workspace, 'root': root, 'harnessSource': harness_source,
            'harness': harness_source / RELATIVE_HARNESS, 'source': root / 'source',
            'downloads': root / 'downloads', 'tools': root / 'tools', 'preparation': root / 'preparation',
            'evidence': root / 'actual-evidence', 'public': root / 'public', 'private': root / 'private', 'retained': root / 'retained',
            'workflowCommit': env['GITHUB_SHA'], 'runId': env['GITHUB_RUN_ID']}


def verify_implementation(directory):
    manifest = json.loads(read(directory / 'implementation.json'))
    need(manifest['harnessCommit'] == HARNESS_COMMIT and manifest['harnessTree'] == HARNESS_TREE and manifest['runtimeCommit'] == RUNTIME_COMMIT and manifest['runtimeTree'] == RUNTIME_TREE, 'Implementation source binding changed')
    need(set(manifest['filesSha256']) == {'driver.py', 'alpha-fixed-path.workflow.yml', 'test_workflow.py', 'README.md'}, 'Implementation inventory differs')
    for name, expected in manifest['filesSha256'].items():
        need(digest(read(directory / name)) == expected, 'Implementation file changed')


def workflow_identity(c):
    tree = verify_checkout(c['workspace'], c['workflowCommit'])
    need(read(c['workspace'] / LIVE_WORKFLOW) == read(c['workspace'] / PROPOSAL), 'Published workflow differs from the reviewed inert source')
    need(Path(__file__).resolve() == c['workspace'] / PROPOSAL.parent / 'driver.py', 'Workflow helper source differs')
    verify_implementation(c['workspace'] / PROPOSAL.parent)
    return tree


def checkout(directory, commit, tree):
    need(not os.path.lexists(directory), 'Checkout destination must be absent')
    env = clean_env(os.environ)
    for args in (['git', 'init', str(directory)], ['git', '-C', str(directory), 'remote', 'add', 'origin', GIT_URL],
                 ['git', '-C', str(directory), 'fetch', '--depth=1', 'origin', commit],
                 ['git', '-C', str(directory), 'checkout', '--detach', 'FETCH_HEAD']):
        subprocess.run(args, env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    verify_checkout(directory, commit, tree)


def harness(c):
    verify_checkout(c['harnessSource'], HARNESS_COMMIT, HARNESS_TREE)
    sys.path.insert(0, str(c['harness']))
    p = importlib.import_module('prepare')
    need(Path(p.__file__).resolve() == c['harness'] / 'prepare.py', 'Unexpected harness import')
    return p


def references(c):
    return json.loads(read(c['harness'] / 'reviewed-pr47-evidence.json'))


def runtime_identity(c):
    verify_checkout(c['source'], RUNTIME_COMMIT, RUNTIME_TREE)
    ref = references(c)
    need(ref['runtimeSourceTree'] == RUNTIME_TREE, 'Reviewed metadata tree mismatch')
    for relative, expected in ref['runtimeSourceFilesSha256'].items():
        need(digest(read(c['source'] / relative)) == expected, 'Reviewed runtime input changed')
    return ref


def run(c, label, argv, env=None):
    """Retain bounded public command/exit metadata; raw output stays private."""
    log = c['private'] / (label + '.log')
    with open(log, 'xb') as stream:
        result = subprocess.run([str(x) for x in argv], env=env or clean_env(os.environ), stdout=stream, stderr=subprocess.STDOUT)
    write_json(c['public'] / ('command-' + label + '.json'), {'argv': [str(x) for x in argv], 'exitStatus': result.returncode, 'logSha256': digest(read(log, 128_000_000)), 'rawLogRetention': 'private hosted-runner state only'})
    need(result.returncode == 0, 'Command failed: ' + label)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def artifact_redirect(location):
    u = urllib.parse.urlsplit(location)
    host = u.hostname or ''
    need(u.scheme == 'https' and not u.username and not u.password and u.port in (None, 443), 'Unsafe artifact redirect')
    need(host.endswith('.blob.core.windows.net') or host.endswith('.actions.githubusercontent.com') or host.endswith('.githubusercontent.com'), 'Artifact storage host refused')
    return location


def download(url, destination, expected, length=None, token=None):
    """Fixed HTTPS source only; never forward the API credential to blob storage."""
    need(url.startswith('https://'), 'HTTPS required')
    need(not os.path.lexists(destination), 'Download destination must be absent')
    headers = {'User-Agent': 'fleet-fixed-path-qualification'}
    if token:
        need(url.startswith('https://api.github.com/repos/' + REPOSITORY + '/actions/artifacts/'), 'Credential destination refused')
        headers.update(Authorization='Bearer ' + token, Accept='application/vnd.github+json', **{'X-GitHub-Api-Version': '2022-11-28'})
    opener = urllib.request.build_opener(NoRedirect)
    try:
        response = opener.open(urllib.request.Request(url, headers=headers), timeout=60)
    except urllib.error.HTTPError as error:
        need(token and error.code == 302, 'Download refused by server')
        location = artifact_redirect(error.headers['Location'])
        response = opener.open(urllib.request.Request(location, headers={'User-Agent': headers['User-Agent']}), timeout=60)
    total = 0
    h = hashlib.sha256()
    with response, open(destination, 'xb') as stream:
        while block := response.read(1024 * 1024):
            total += len(block)
            need(total <= (length if length is not None else 128_000_000), 'Download exceeded frozen bound')
            stream.write(block); h.update(block)
    need(h.hexdigest() == expected and (length is None or total == length), 'Downloaded input hash/length mismatch')


def check_node_members(members, target):
    prefix = 'node-v24.21.0-' + target
    need(len(members) <= 10000 and sum(m.size for m in members) <= 512_000_000, 'Node archive expansion bound')
    for m in members:
        parts = m.name.rstrip('/').split('/')
        need(parts[0] == prefix and all(x not in ('', '.', '..') for x in parts), 'Node archive path refused')
        need(m.isdir() or m.isfile() or m.issym(), 'Node archive special/hardlink entry refused')
        if m.issym():
            linked = posixpath.normpath(posixpath.join(posixpath.dirname(m.name), m.linkname))
            need(not m.linkname.startswith('/') and linked.startswith(prefix + '/'), 'Node link escape refused')
    return prefix


def prerequisite_commands(c, python):
    return [('apt-update', ['sudo', 'apt-get', 'update']),
            ('apt-install', ['sudo', 'apt-get', 'install', '-y', *PACKAGES]),
            ('host-policy', ['sudo', PRESERVE, str(python), '-B', str(c['source'] / 'local-runtime/prepare-engineering-host.py')])]


def initialize(c):
    need(not os.path.lexists(c['root']) and not os.path.lexists(c['harnessSource']), 'Fresh runner destinations required')
    checkout(c['harnessSource'], HARNESS_COMMIT, HARNESS_TREE)
    p = harness(c)
    rp = importlib.import_module('runner_paths').runner_paths(os.environ)
    for name in ('root', 'source', 'downloads', 'tools', 'preparation', 'evidence'):
        need(rp[name] == str(c[name]), 'Frozen harness path derivation differs')
    c['root'].mkdir(mode=0o700)
    for name in ('public', 'private', 'downloads', 'tools'):
        c[name].mkdir(mode=0o700)
    write_json(c['public'] / 'invocation.json', {'workflowCommit': c['workflowCommit'], 'workflowTree': workflow_identity(c),
               'runId': c['runId'], 'runAttempt': 1, 'target': c['target'], 'harnessCommit': HARNESS_COMMIT,
               'harnessTree': HARNESS_TREE, 'runtimeCommit': RUNTIME_COMMIT, 'runtimeTree': RUNTIME_TREE,
               'authority': p.AUTHORITY, 'productionQualified': False, 'disposal': 'whole hosted runner only',
               'python': str(Path(sys.executable).resolve()), 'pythonSha256': digest(read(Path(sys.executable).resolve()))})


def inputs(c):
    p = harness(c)
    checkout(c['source'], RUNTIME_COMMIT, RUNTIME_TREE)
    ref = runtime_identity(c)
    p.verify_remote(p.REVIEWED_EXPECTATION)  # Exact still-open PR + passed two-architecture run.
    token = os.environ.get('GH_TOKEN')
    need(token, 'Ephemeral read-only workflow token required for raw API ZIPs')
    for target, a in p.REVIEWED_ARTIFACTS.items():
        download('https://api.github.com/repos/' + REPOSITORY + '/actions/artifacts/' + str(a['id']) + '/zip',
                 c['downloads'] / (target + '.zip'), a['sha256'], a['bytes'], token)
    selected = ref['targets'][c['target']]
    asset = selected['nodeArchive']
    need(asset['url'] == 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-' + c['target'] + '.tar.xz', 'Unexpected official Node URL')
    archive = c['downloads'] / 'node.tar.xz'
    download(asset['url'], archive, asset['sha256'])
    with tarfile.open(archive) as tar:
        prefix = check_node_members(tar.getmembers(), c['target'])
        tar.extractall(c['tools'], filter='data')
    node = c['tools'] / prefix / 'bin/node'
    need(digest(read(node)) == selected['nodeExecutableSha256'], 'Node differs from native observation')
    env = clean_env(os.environ); env['PATH'] = str(node.parent) + ':/usr/bin:/bin'; env['NPM_CONFIG_USERCONFIG'] = '/dev/null'; env['NPM_CONFIG_GLOBALCONFIG'] = '/dev/null'
    run(c, 'dependencies', [node, node.parent.parent / 'lib/node_modules/npm/bin/npm-cli.js', 'ci', '--prefix', c['source'] / 'fleet', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], env)
    runtime_identity(c)
    run(c, 'harness-python-tests', [sys.executable, '-B', '-m', 'unittest', 'discover', '-s', c['harness'], '-p', 'test_*.py', '-v'])
    run(c, 'harness-cancellation-tests', [node, '--test', c['harness'] / 'cancellation.test.mjs'])
    write_json(c['public'] / 'input-references.json', ref)


def node_path(c):
    node = c['tools'] / ('node-v24.21.0-' + c['target']) / 'bin/node'
    need(digest(read(node)) == references(c)['targets'][c['target']]['nodeExecutableSha256'], 'Pinned Node changed')
    return node


def python_identity(c):
    invocation = json.loads(read(c['public'] / 'invocation.json'))
    executable = Path(sys.executable).resolve()
    need(str(executable) == invocation['python'] and digest(read(executable)) == invocation['pythonSha256'], 'Workflow Python changed')
    return executable


def prerequisites(c):
    runtime_identity(c); node_path(c)
    need(not os.path.lexists('/opt/agi-fleet-alpha'), 'Existing fixed installation refused')
    run(c, 'packages-before', ['dpkg-query', '-W', '-f=${binary:Package} ${Version}\n'])
    for label, argv in prerequisite_commands(c, python_identity(c)):
        python_identity(c); runtime_identity(c)
        need(not os.path.lexists('/opt/agi-fleet-alpha'), 'Existing fixed installation refused')
        run(c, label, argv)
    # The helper prints only packaged-policy identity and before/after restrictions.
    policy = json.loads(read(c['private'] / 'host-policy.log'))
    need(policy['namespaceRestrictionsBefore'] == policy['namespaceRestrictionsAfter'], 'Namespace policy was weakened')
    write_json(c['public'] / 'host-policy.json', policy)
    run(c, 'packages-after', ['dpkg-query', '-W', '-f=${binary:Package} ${Version}\n'])
    write_json(c['public'] / 'package-identities.json', {name: read(c['private'] / (name + '.log')).decode().splitlines() for name in ('packages-before', 'packages-after')})


def preparation(c):
    p = harness(c); runtime_identity(c)
    run(c, 'prepare', [sys.executable, '-B', c['harness'] / 'prepare.py', '--source', c['source'], '--output', c['preparation'],
                       '--node', node_path(c), '--expected', c['harness'] / 'expected-pr47.json',
                       '--x64-artifact', c['downloads'] / 'linux-x64.zip', '--arm64-artifact', c['downloads'] / 'linux-arm64.zip', '--native-target', c['target']])


def approved_commands(c):
    p = harness(c); runtime_identity(c); node_path(c); python_identity(c)
    raw = read(c['preparation'] / 'preparation.json')
    identity = digest(raw)
    report = importlib.import_module('privileged').verify_preparation(c['preparation'], identity)
    packet = json.loads(read(c['preparation'] / 'approval.json'))
    need(packet == p.approval_packet(report, identity, c['preparation']), 'Command packet differs from frozen generator')
    need(report['expected'] == p.REVIEWED_EXPECTATION and report['installation'] == references(c)['targets'][c['target']]['installation'], 'Prepared identity/destination differs')
    return shlex.split(packet['privilegedCommand']), shlex.split(packet['subsequentNonrootCommand'])


def reject_secrets(value):
    if isinstance(value, dict):
        need(not any(k.lower() in ('token', 'clienttoken', 'password', 'authorization', 'secret') for k in value), 'Private field in public report')
        for item in value.values(): reject_secrets(item)
    elif isinstance(value, list):
        for item in value: reject_secrets(item)


def collect(c):
    """Fresh finite allowlisted upload set, including available failure receipts.

    Malformed/private partial reports stay on the runner; record their exclusion.
    The upload action runs only when collection itself succeeds. It never points
    at raw evidence, state, checkout, private logs or an unvalidated directory.
    """
    if not c['root'].exists():
        return
    need(not os.path.lexists(c['retained']), 'Retention destination must be absent')
    selected, excluded = {}, []
    for source, names, prefix in ((c['public'], PUBLIC_STAGE, ''), (c['preparation'], PUBLIC_PREPARATION, 'preparation-'), (c['evidence'], PUBLIC_ACTUAL, 'actual-')):
        for name in names:
            file = source / name
            if not os.path.lexists(file):
                continue
            try:
                need(source == source.resolve(strict=True), 'Evidence parent alias refused')
                raw = read(file, 16_000_000)
                if file.suffix == '.json': reject_secrets(json.loads(raw))
            except (OSError, ValueError):
                excluded.append({'name': prefix + name, 'reason': 'unsafe, private or incomplete; bytes not copied'})
                continue
            selected[prefix + name] = raw
    c['retained'].mkdir(mode=0o700)
    for name, raw in selected.items():
        with open(c['retained'] / name, 'xb') as output:
            output.write(raw)
    write_json(c['retained'] / 'retention.json', {'disposal': 'whole disposable hosted runner; no /opt deletion or authority reset',
               'excluded': ['private/', 'state-*', 'drift-state/', 'drift.json', 'drift-checkout/', 'client tokens', 'runtime databases'],
               'excludedPartialReports': excluded, 'retainedFilesSha256': {name: digest(raw) for name, raw in selected.items()},
               'productionQualified': False})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=STAGES)
    stage = parser.parse_args().stage
    c = paths(os.environ); workflow_identity(c)
    if stage == 'initialize':
        initialize(c)
    elif stage == 'collect':
        collect(c)
        return
    else:
        harness(c)
        previous = STAGES[STAGES.index(stage) - 1]
        need(json.loads(read(c['public'] / ('stage-' + previous + '.json')))['status'] == 'COMPLETED', 'Previous stage did not complete')
    marker = c['public'] / ('started-' + stage + '.json')
    write_json(marker, {'stage': stage, 'status': 'STARTED'})
    try:
        if stage == 'inputs': inputs(c)
        elif stage == 'prerequisites': prerequisites(c)
        elif stage == 'prepare': preparation(c)
        elif stage == 'provision': run(c, 'provision', approved_commands(c)[0])
        elif stage == 'qualify': run(c, 'qualify', approved_commands(c)[1])
    except Exception:
        write_json(c['public'] / ('stage-' + stage + '.json'), {'stage': stage, 'status': 'FAILED', 'details': 'Private log retained on runner; no token or signed URL copied to public evidence'})
        raise RuntimeError('Fixed-path stage failed: ' + stage) from None
    write_json(c['public'] / ('stage-' + stage + '.json'), {'stage': stage, 'status': 'COMPLETED'})


if __name__ == '__main__':
    main()
