"""Audit retained alpha.7 evidence; publish only an exact-main immutable prerelease.

Selectors are not proof. Every producer/review/asset is authenticated with GitHub
before publication effects. Existing alpha.6 and Linux auditors remain unchanged.
"""
import argparse
import ast
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = 'MontrealAI/AGI-Fleet-Linux'
VERSION = '0.1.0-alpha.7'
TAG = 'v0.1.0-local-ti-preview.7'
ARCHIVE = 'agi-fleet-local-' + VERSION + '.zip'
TITLE = 'AGI Fleet Local TI 0.1.0 alpha.7 — source preview'
SCHEMA = 'agi-fleet/ti-published-source-preview/v1'
LIMIT = 450_000_000
WORKFLOWS = {'ti': 'transformational-project.yml', 'local': 'local-skills.yml',
             'linux': 'next-release.yml', 'repository': 'repository-checks.yml',
             'sourceReview': 'repository-review.yml'}
BOT = {'login': 'chatgpt-codex-connector[bot]', 'id': 199175422, 'type': 'Bot'}


def require(value, message):
    if not value:
        raise ValueError('TI_RELEASE: ' + message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def digest(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + '\n').encode()


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON key')
        result[key] = value
    return result


def decode(raw):
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda _: require(False, 'nonfinite JSON'))


def load(file):
    file = Path(file)
    require(file.is_file() and not file.is_symlink() and file.stat().st_size < 8_000_000, 'bounded regular JSON required')
    return decode(file.read_bytes())


def identity(file):
    file = Path(file)
    require(file.is_file() and not file.is_symlink() and 0 < file.stat().st_size < LIMIT, 'bounded regular asset required')
    return {'name': file.name, 'bytes': file.stat().st_size, 'sha256': digest(file)}


def module(name, relative):
    file = ROOT / relative
    spec = importlib.util.spec_from_file_location(name, file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


class GitHub:
    def __init__(self, token):
        require(isinstance(token, str) and bool(token), 'authenticated GitHub token required')
        self.token = token

    def request(self, path, method='GET', data=None, upload=False):
        require(path.startswith('/'), 'relative GitHub API path required')
        host = 'https://uploads.github.com' if upload else 'https://api.github.com'
        headers = {'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
                   'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'AGI-Fleet-TI-release'}
        if isinstance(data, dict):
            data = encoded(data)
        headers['Content-Type'] = 'application/octet-stream' if upload else 'application/json'
        request = urllib.request.Request(host + path, data=data, method=method, headers=headers)
        with urllib.request.build_opener(NoRedirect).open(request, timeout=120) as response:
            raw = response.read(8_000_001)
            require(len(raw) <= 8_000_000, 'API response exceeds bound')
            return decode(raw)

    def __call__(self, path, **kwargs):
        return self.request('/repos/' + REPOSITORY + path, **kwargs)

    def download(self, path, output, expected=None, maximum=LIMIT):
        require(path.startswith('/'), 'GitHub download endpoint required')
        request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + path,
            headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/octet-stream',
                     'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'AGI-Fleet-TI-release'})
        try:
            response = urllib.request.build_opener(NoRedirect).open(request, timeout=120)
        except urllib.error.HTTPError as error:
            require(error.code == 302, 'download unavailable')
            location = error.headers.get('Location', '')
            require(urllib.parse.urlsplit(location).scheme == 'https', 'HTTPS signed download required')
            # The redirect is a separate unauthenticated request; never forward GH_TOKEN.
            response = urllib.request.urlopen(location, timeout=120)
        with response, Path(output).open('xb') as stream:
            total = 0
            while block := response.read(1_048_576):
                total += len(block)
                require(total < maximum, 'download exceeds bound')
                stream.write(block)
        result = identity(output)
        if expected is not None:
            require(result['bytes'] == expected['bytes'] and result['sha256'] == expected['sha256'], 'download identity differs')
        return result


def maybe(api, path):
    try:
        return api(path)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        return None


def pages(api, path, key=None):
    result = []
    for page in range(1, 51):
        value = api(path + ('&' if '?' in path else '?') + 'per_page=100&page=' + str(page))
        rows = value[key] if key else value
        require(isinstance(rows, list), 'paginated list required')
        result.extend(rows)
        require(len(result) <= 5_000, 'API collection exceeds bound')
        if len(rows) < 100:
            return result
    raise ValueError('TI_RELEASE: incomplete pagination')


def current_main(api, source):
    require(re.fullmatch('[a-f0-9]{40}', source or '') is not None, 'exact source required')
    ref = api('/git/ref/heads/main')
    obj = ref.get('object') if isinstance(ref, dict) else None
    require(isinstance(ref, dict) and ref.get('ref') == 'refs/heads/main' and isinstance(obj, dict)
            and obj.get('type') == 'commit' and obj.get('sha') == source, 'current main lease differs')


def tag_commit(api, tag):
    ref = maybe(api, '/git/ref/tags/' + tag)
    if ref is None:
        return None
    require(ref.get('ref') == 'refs/tags/' + tag, 'tag ref differs')
    obj = ref['object']
    for _ in range(8):
        require(re.fullmatch('[a-f0-9]{40}', obj.get('sha', '')), 'tag object identity required')
        if obj.get('type') == 'commit':
            return obj['sha']
        require(obj.get('type') == 'tag', 'tag must resolve to a commit')
        obj = api('/git/tags/' + obj['sha'])['object']
    raise ValueError('TI_RELEASE: tag depth exceeded')


def authenticate_run(api, selector, kind, source, *, historical_collector=False):
    workflows = {**WORKFLOWS, 'publication': 'transformation-release.yml'}
    require(kind in workflows and (not historical_collector or kind == 'publication')
            and isinstance(selector, str) and re.fullmatch('[1-9][0-9]*:[1-9][0-9]*', selector), 'run:attempt selector required')
    run_id, attempt = map(int, selector.split(':'))
    run = api('/actions/runs/' + str(run_id))
    exact = api(f'/actions/runs/{run_id}/attempts/{attempt}')
    for index, value in enumerate((run, exact)):
        require(value.get('id') == run_id
                and value.get('repository', {}).get('full_name') == REPOSITORY
                and value.get('head_repository', {}).get('full_name') == REPOSITORY
                and value.get('head_sha') == source and value.get('head_branch') == 'main'
                and value.get('path') == '.github/workflows/' + workflows[kind]
                and value.get('event') in ('push', 'workflow_dispatch'), 'producer source/workflow/event differs')
        if historical_collector and index == 0:
            # Original publication provenance remains historical when a later
            # verification dispatch or attempt observes the immutable release.
            require(type(value.get('run_attempt')) is int and value['run_attempt'] >= attempt, 'original collector attempt missing')
        else:
            require(value.get('run_attempt') == attempt and value.get('status') == 'completed'
                    and value.get('conclusion') == 'success', 'producer latest/exact attempt did not succeed')
    require(kind != 'ti' or run['event'] == 'push', 'TI qualification must be the actual main push')
    require(kind != 'publication' or all(value['event'] == 'workflow_dispatch' for value in (run, exact)), 'original collector must be the manual publication workflow')
    workflow = api('/actions/workflows/' + str(run['workflow_id']))
    require(workflow.get('path') == run['path'], 'producer workflow ID differs')
    if not historical_collector:
        observed = pages(api, f'/actions/workflows/{run["workflow_id"]}/runs?head_sha={source}&branch=main', 'workflow_runs')
        candidates = [row for row in observed if row.get('event') in ('push', 'workflow_dispatch')]
        require(candidates and max(candidates, key=lambda row: (row.get('created_at', ''), row['id']))['id'] == run_id, 'a newer producer observation exists')
    jobs = pages(api, f'/actions/runs/{run_id}/attempts/{attempt}/jobs', 'jobs')
    require(jobs and all(row.get('run_id') == run_id and row.get('run_attempt') == attempt
                        and row.get('head_sha') == source and row.get('status') == 'completed' for row in jobs), 'job provenance incomplete')
    for row in jobs:
        permitted_skip = kind == 'local' and row.get('name', '').endswith('/ publish')
        require(row.get('conclusion') == 'success' or (permitted_skip and row.get('conclusion') == 'skipped'), 'required job did not pass')
        if row.get('conclusion') == 'success':
            steps = row.get('steps')
            require(isinstance(steps, list) and bool(steps)
                    and all(step.get('status') == 'completed' and step.get('conclusion') == 'success'
                        for step in steps if not step.get('name', '').startswith(('Post ', 'Complete job'))), 'required producer step missing, failed or skipped')
            require(any(not step.get('name', '').startswith(('Post ', 'Complete job')) for step in steps), 'required producer steps absent')
        match = re.fullmatch(r'https://api.github.com/repos/' + REPOSITORY + r'/check-runs/([1-9][0-9]*)', row.get('check_run_url', ''))
        require(match is not None, 'actual producer check ID required')
        check = api('/check-runs/' + match[1])
        require(check.get('id') == int(match[1]) and check.get('head_sha') == source
                and check.get('name') == row['name'] and check.get('status') == 'completed'
                and check.get('conclusion') == row['conclusion'] and check.get('app', {}).get('id') == 15368
                and check['app'].get('slug') == 'github-actions' and check['app'].get('owner', {}).get('login') == 'github', 'producer check/application identity differs')
        row['authenticatedCheck'] = check
    names = [row['name'] for row in jobs if row['conclusion'] == 'success']
    required = {'ti': ['TI saved preview and native Docker (x64)', 'TI saved preview and native Docker (arm64)', 'Required native TI source-preview qualification'],
                'local': ['browser', 'audit', 'publish'], 'linux': ['build', 'audit', 'publish', 'Required release qualification'],
                'repository': ['repository'], 'sourceReview': ['review'], 'publication': ['audit', 'publish']}[kind]
    require(all(name in names for name in required), 'mandatory producer jobs absent')
    return {'run': run, 'attempt': exact, 'jobs': jobs}


def authenticate_review(api, selection, source):
    require(isinstance(selection, dict) and set(selection) == {'pull', 'summary', 'receipt', 'ownerReview'}
            and all(type(value) is int and value > 0 for value in selection.values()), 'actual review IDs required')
    pull = api('/pulls/' + str(selection['pull']))
    require(pull.get('base', {}).get('ref') == 'main' and pull.get('base', {}).get('repo', {}).get('full_name') == REPOSITORY
            and pull.get('head', {}).get('repo', {}).get('full_name') == REPOSITORY, 'review PR repository/destination differs')
    comments = pages(api, '/issues/' + str(selection['pull']) + '/comments')
    summaries = [row for row in comments if '<!-- codex-review-state:v1 ' in row.get('body', '')
                 and row.get('user', {}).get('id') == BOT['id']
                 and row.get('performed_via_github_app', {}).get('id') == 1144995]
    require(summaries and max(summaries, key=lambda row: (row.get('updated_at', ''), row['id']))['id'] == selection['summary'], 'current configured summary differs')
    summary = api('/issues/comments/' + str(selection['summary']))
    receipt = api('/issues/comments/' + str(selection['receipt']))
    for row in (summary, receipt):
        require(row.get('issue_url') == f'https://api.github.com/repos/{REPOSITORY}/issues/{selection["pull"]}'
                and all(row.get('user', {}).get(key) == value for key, value in BOT.items())
                and row.get('performed_via_github_app', {}).get('id') == 1144995
                and row['performed_via_github_app'].get('slug') == 'chatgpt-codex-connector'
                and row['performed_via_github_app'].get('owner', {}).get('id') == 14957082, 'configured reviewer API identity differs')
    match = re.findall(r'<!-- codex-review-state:v1 (.*?) -->', summary['body'])
    require(len(match) == 1, 'one genuine configured review state required')
    review = decode(match[0])['code_review']
    reviewed = review.get('commit_sha')
    require(re.fullmatch('[a-f0-9]{40}', reviewed or '') and review.get('status') == 'completed'
            and type(review.get('has_any_findings')) is bool and review.get('has_unresolved_findings') is False, 'configured review incomplete, stale, null or unresolved')
    receipt_commit = re.findall(r'\*\*Reviewed commit:\*\* `([a-f0-9]{10,40})`', receipt['body'])
    require('<!-- codex-review-receipt:v1 -->' in receipt['body'] and len(receipt_commit) == 1
            and reviewed.startswith(receipt_commit[0]), 'configured receipt commit differs')
    source_commit = api('/git/commits/' + source)
    reviewed_commit = api('/git/commits/' + reviewed)
    require(source_commit.get('sha') == source and reviewed_commit.get('sha') == reviewed, 'review commit objects differ')
    require(reviewed_commit['tree']['sha'] == source_commit['tree']['sha'], 'reviewed tree differs from main source')
    if reviewed != source:
        require(pull.get('merged') is True and pull.get('merge_commit_sha') == source
                and pull.get('head', {}).get('sha') == reviewed
                and len(source_commit.get('parents', [])) == 2
                and reviewed in [parent['sha'] for parent in source_commit['parents']], 'normal reviewed-head to main merge mapping required')
    reviews = pages(api, '/pulls/' + str(selection['pull']) + '/reviews')
    owner = api(f'/pulls/{selection["pull"]}/reviews/{selection["ownerReview"]}')
    require(owner.get('id') in [row['id'] for row in reviews] and owner.get('commit_id') == reviewed
            and owner.get('state') in ('COMMENTED', 'APPROVED') and bool(owner.get('body', '').strip())
            and owner.get('author_association') in ('OWNER', 'MEMBER', 'COLLABORATOR'), 'eligible exact-source technical owner review required')
    require(owner['state'] == 'APPROVED' or (owner.get('user', {}).get('login') == REPOSITORY.split('/')[0]
            and owner.get('author_association') == 'OWNER'), 'shared-account COMMENT requires authenticated repository owner')
    require(all(term in owner['body'].lower() for term in ('reviewer', 'role', 'owner', 'authoriz', 'finding', 'disposition')), 'technical review must retain role, authorization, findings and disposition')
    require(re.search(r'(?im)\bdisposition\s*[:* ]+\s*(?:SCOPED_SOURCE_CLEAR|SOURCE_CLEAR|SOURCE CLEAR|CLEAR)\b', owner['body']), 'technical owner review disposition is not source clear')
    latest = {}
    for row in sorted(reviews, key=lambda row: row.get('submitted_at', '')):
        if row.get('state') in ('APPROVED', 'CHANGES_REQUESTED'):
            latest[row['user']['id']] = row['state']
    require('CHANGES_REQUESTED' not in latest.values(), 'outstanding requested changes')
    return {'pull': pull, 'summary': summary, 'receipt': receipt, 'ownerReview': owner,
            'reviews': reviews, 'reviewedCommit': reviewed_commit, 'mainCommit': source_commit}


def unpack(archive, output):
    require(not output.exists(), 'new extraction required')
    output.mkdir()
    with zipfile.ZipFile(archive) as saved:
        require(len(saved.infolist()) <= 25_000, 'archive entry bound')
        names = set(); total = 0
        for row in saved.infolist():
            name = row.filename
            path = PurePosixPath(name.rstrip('/'))
            require(not path.is_absolute() and str(path) == name.rstrip('/') and '\\' not in name
                    and all(part not in ('', '.', '..') for part in path.parts) and name not in names
                    and not stat.S_ISLNK(row.external_attr >> 16) and not row.flag_bits & 1, 'archive path, mode or collision differs')
            names.add(name); total += row.file_size
            require(0 <= row.file_size < LIMIT and total < LIMIT, 'archive expansion bound')
            target = output.joinpath(*path.parts)
            if row.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                require(not target.exists(), 'archive destination collision')
                target.parent.mkdir(parents=True, exist_ok=True)
                with saved.open(row) as src, target.open('xb') as dst:
                    shutil.copyfileobj(src, dst)
    return output


def artifact(api, producer, name, work, suffix, job_name):
    run = producer['run']; run_id = run['id']; attempt = run['run_attempt']
    matches = [row for row in pages(api, f'/actions/runs/{run_id}/artifacts', 'artifacts') if row.get('name') == name]
    require(len(matches) == 1, 'one exact producer artifact required: ' + name)
    row = matches[0]
    require(row.get('expired') is False and row.get('workflow_run', {}).get('id') == run_id
            and row['workflow_run'].get('head_sha') == run['head_sha']
            and re.fullmatch('sha256:[a-f0-9]{64}', row.get('digest', ''))
            and type(row.get('size_in_bytes')) is int and 0 < row['size_in_bytes'] < LIMIT, 'artifact origin/digest incomplete')
    jobs = [job for job in producer['jobs'] if job['name'] == job_name]
    require(len(jobs) == 1, 'artifact producer job missing')
    log = work / (suffix + '-upload.log')
    api.download(f'/actions/jobs/{jobs[0]["id"]}/logs', log, maximum=64_000_000)
    link = f'https://github.com/{REPOSITORY}/actions/runs/{run_id}/artifacts/{row["id"]}'
    require(link in log.read_text(errors='strict'), 'artifact ID not authenticated in exact-attempt producer log')
    archive = work / (suffix + '-artifact.zip')
    observed = api.download(f'/actions/artifacts/{row["id"]}/zip', archive,
        {'bytes': row['size_in_bytes'], 'sha256': row['digest'].removeprefix('sha256:')})
    directory = unpack(archive, work / suffix)
    return directory, {'metadata': row, 'download': observed, 'producerJob': jobs[0],
                       'uploadLogSHA256': digest(log), 'runAttempt': attempt}


def exact_file(root, name):
    matches = [path for path in root.rglob(name) if path.is_file() and not path.is_symlink()]
    require(len(matches) == 1, 'unique retained file required: ' + name)
    return matches[0]


def checksums(root):
    records = load(root / 'artifact-checksums.json')['files']
    observed = []
    for file in sorted(root.rglob('*')):
        require(not file.is_symlink(), 'report links forbidden')
        if file.is_file() and file.name != 'artifact-checksums.json':
            row = identity(file); observed.append({'path': file.relative_to(root).as_posix(), 'bytes': row['bytes'], 'sha256': row['sha256']})
    require(records == observed, 'complete exact report inventory differs')


def committed_entries(source, builder):
    raw = subprocess.check_output(['git', '--no-replace-objects', 'ls-tree', '-rz', source], cwd=ROOT)
    selected = {}
    for record in raw.split(b'\0'):
        if not record:
            continue
        metadata, name = record.split(b'\t'); mode, kind, oid = metadata.decode().split(); name = name.decode()
        roots = [*builder.ROOTS, *builder.TI_ROOTS]
        keep = any(name.startswith(prefix + '/') for prefix in roots) or name in [*builder.TI_FILES, *builder.EXTRA_FILES]
        if not keep or '__pycache__' in PurePosixPath(name).parts or name.endswith('.pyc'):
            continue
        require(kind == 'blob' and mode in ('100644', '100755'), 'nonregular committed package source')
        selected[name] = (oid, 0o755 if mode == '100755' else 0o644)
    unique_ids = list(dict.fromkeys(oid for oid, _ in selected.values()))
    data = subprocess.check_output(['git', '--no-replace-objects', 'cat-file', '--batch'],
                                  input=('\n'.join(unique_ids) + '\n').encode(), cwd=ROOT)
    offset = 0; blobs = {}
    for oid in unique_ids:
        end = data.index(b'\n', offset); actual, kind, size = data[offset:end].decode().split(); size = int(size)
        require(actual == oid and kind == 'blob' and size < 8_000_000, 'committed blob identity differs')
        offset = end + 1; blobs[oid] = data[offset:offset + size]; offset += size + 1
    require(offset == len(data), 'Git blob stream differs')
    return {name: (blobs[oid], mode) for name, (oid, mode) in selected.items()}


def compare_members(entries, expected, dependency_verifier):
    tracked = {name: value for name, value in entries.items() if not name.startswith('fleet/node_modules/')}
    require(tracked == expected, 'package tracked bytes/modes/member coverage differ from Git source')
    return dependency_verifier(entries)


def audit_package(archive, receipt, source, expected, installer, builder):
    require(receipt.get('schema') == 'agi-fleet/ti-source-package-receipt/v1' and receipt.get('version') == VERSION
            and receipt.get('commit') == source and receipt.get('workingTreeDirty') is False
            and receipt.get('archive') == ARCHIVE and receipt.get('operatorInstaller') is False
            and receipt.get('productionQualified') is False, 'TI package receipt source/scope differs')
    observed = identity(archive)
    require(observed['name'] == ARCHIVE and observed['bytes'] == receipt.get('bytes') and observed['sha256'] == receipt.get('sha256'), 'package receipt archive identity differs')
    manifest, prefix = installer.inspect_archive(archive, observed['sha256'])
    require(manifest.get('commit') == source and manifest.get('version') == VERSION
            and manifest.get('workingTreeDirty') is False and manifest.get('operatorInstaller') is False
            and manifest.get('nativeAcceptance') == 'NOT_RUN', 'saved manifest source/scope differs')
    with zipfile.ZipFile(archive) as saved:
        entries = {row['path']: (saved.read(prefix + '/' + row['path']), row['mode']) for row in manifest['files']}
        manifest_raw = saved.read(prefix + '/local-preview-manifest.json')
        inventory_rows = [{'name': row.filename[len(prefix) + 1:], 'bytes': row.file_size,
                           'sha256': sha(saved.read(row)), 'mode': stat.S_IMODE(row.external_attr >> 16)}
                          for row in saved.infolist() if not row.is_dir()]
    inventory_rows.sort(key=lambda row: row['name'].encode('utf-16-be'))
    extracted_hash = sha(json.dumps(inventory_rows, ensure_ascii=False, separators=(',', ':')).encode())
    provenance = compare_members(entries, expected, builder.verify_dependency_provenance)
    require(provenance == manifest.get('dependencyProvenance') == receipt.get('dependencyProvenance'), 'dependency provenance differs')
    inventory = entries['local-runtime/transformation/source-inventory.json'][0]
    require(manifest.get('tiInventorySha256') == receipt.get('inventorySha256') == sha(inventory)
            and manifest.get('tiProfileSha256') == sha(entries['local-runtime/transformation/release-profile.json'][0])
            and receipt.get('files') == len(manifest['files']), 'finite inventory/profile binding differs')
    return {'archive': observed, 'manifest': manifest, 'manifestSHA256': sha(manifest_raw),
            'inventorySHA256': sha(inventory), 'receipt': receipt,
            'extractedInventory': {'manifestSha256': sha(manifest_raw), 'inventoryBeforeSha256': extracted_hash,
                'inventoryAfterSha256': extracted_hash, 'unchanged': True}}


def tap(file, expected):
    text = file.read_text()
    values = {}
    for key in ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'):
        found = re.findall(r'^# ' + key + r' (\d+)\s*$', text, re.M)
        require(len(found) == 1, 'complete unambiguous TI TAP summary required')
        values[key] = int(found[0])
    require(values['tests'] == values['pass'] == expected and all(values[key] == 0 for key in ('fail', 'cancelled', 'skipped', 'todo'))
            and not re.search(r'^\s*not ok\b|^Bail out!', text, re.M), 'TI TAP did not fully pass')


def audit_ti_reports(root, package, source, producer, arch):
    checksums(root)
    run = producer['run']; receipt = package['receipt']; manifest_sha = package['manifestSHA256']
    context = load(root / 'execution-context.json')
    require(context.get('fleetCommit') == source and context.get('runId') == str(run['id'])
            and context.get('runAttempt') == str(run['run_attempt']) and context.get('matrixArchitecture') == arch
            and context.get('node') == 'v24.21.0' and context.get('productionQualified') is False, 'TI retained execution context differs')
    require(load(root / 'source-pins.json') == load(ROOT / 'engineering/transformation/source-pins.json')
            and load(root / 'package-receipt.json') == receipt, 'TI retained pins/receipt differ')
    require(load(root / 'package-observation.json') == package['extractedInventory'], 'original extracted package inventory or before/after identity differs')
    binding = load(root / 'installed-binding.json'); installed = load(root / 'install-receipt.json')
    require(binding.get('schema') == 'agi-fleet/ti-normal-installation-binding/v1'
            and type(binding.get('uid')) is int and binding['uid'] > 0
            and binding.get('started') is False and binding.get('authority') == 'none'
            and binding.get('archiveSHA256') == receipt['sha256'] and binding.get('sourceCommit') == source
            and binding.get('manifestSHA256') == manifest_sha
            and binding.get('installerReceiptSHA256') == digest(root / 'install-receipt.json'), 'normal installation binding differs')
    require(installed.get('installation') == binding.get('installation') and installed.get('state') == binding.get('state')
            and installed.get('archiveSHA256') == receipt['sha256'] and installed.get('sourceCommit') == source
            and installed.get('version') == VERSION and installed.get('manifestSHA256') == manifest_sha
            and installed.get('started') is False and installed.get('authority') == 'none', 'actual installer receipt differs')
    node = installed['node']; pins = load(ROOT / 'fleet/shared/runtime/compute/runtime-artifacts.lock.json')['node']
    expected_node = next(row for row in pins['archives'] if row['platform'] == 'linux-' + arch)
    require(node.get('version') == pins['preferredVersion'] == '24.21.0' and node.get('platform') == 'linux-' + arch
            and node.get('archiveSHA256') == expected_node['sha256'] and node.get('binarySHA256') == binding.get('nodeBinarySHA256')
            and re.fullmatch('[a-f0-9]{64}', binding.get('nodeBinarySHA256', '')), 'installed Node pin differs')
    version = PurePosixPath(binding['installation']) / 'versions' / receipt['sha256']
    require(PurePosixPath(binding['installation']).is_absolute() and binding.get('application') == str(version / 'application')
            and binding.get('nodeExecutable') == str(version / 'runtime/node'), 'actual normal versioned paths required')
    after = load(root / 'installed-after.json')
    require(after.get('unchanged') is True and after.get('receipt') == {key: value for key, value in installed.items() if key not in ('installation', 'state', 'started', 'authority')}, 'postjourney complete installed verification differs')
    require(load(root / 'install-preflight.json').get('readyForInstallInspection') is True, 'installer preflight did not pass')
    qualification = load(root / 'journey/qualification.json'); execution = qualification['executionContext']
    require(qualification.get('schema') == 'agi-fleet/ti-saved-native-qualification/v1'
            and qualification.get('sourcePreviewVersion') == VERSION
            and qualification.get('executionClass') == 'EXISTING_NATIVE_DOCKER_SCRIPTED_BROWSER'
            and qualification.get('installationExecution') == 'NORMAL_INSTALLER_APPLICATION_AND_NODE'
            and qualification.get('installation') == binding
            and all(qualification.get(key) is True for key in ('exactGrant', 'oneUse', 'replayRefused', 'retainedCaptureIdempotent', 'actualBrowser', 'containerClosed', 'processGroupGone'))
            and qualification.get('providerRequests') == 0 and qualification.get('independentReview') is False
            and qualification.get('productionQualified') is False and qualification.get('authority') == 'none', 'installed native TI journey incomplete')
    require(execution.get('githubRunId') == str(run['id']) and execution.get('githubRunAttempt') == str(run['run_attempt'])
            and execution.get('githubSha') == source and execution.get('architecture') == arch and execution.get('node') == 'v24.21.0'
            and execution.get('application') == binding['application'] and execution.get('nodeExecutable') == binding['nodeExecutable']
            and execution.get('uid') == binding['uid'], 'installed execution identity differs')
    source_identity = qualification['sourceIdentity']
    require(source_identity.get('fleetCommit') == source and source_identity.get('manifestSha256') == manifest_sha
            and source_identity.get('pins') == load(ROOT / 'engineering/transformation/source-pins.json')
            and source_identity.get('sourceConfigurationSha256') == digest(root / 'installed-sources.json'), 'TI source identity differs')
    installed_sources = load(root / 'installed-sources.json')
    require(set(installed_sources) == {'alpha', 'manager', 'jobs'} and all(
        value.get('commit') == source_identity['pins'][key]['commit'] and PurePosixPath(value.get('root', '')).is_absolute()
        for key, value in installed_sources.items()), 'operator source configuration differs')
    image = qualification.get('image'); require(re.fullmatch('sha256:[a-f0-9]{64}', image or ''), 'native image digest required')
    require(load(root / 'worker-image-inspect.json')[0]['Id'] == image, 'actual Docker worker identity differs')
    require((root / 'journey/completed/project.json').read_bytes() == (root / 'journey/capture/project.json').read_bytes(), 'retained capture project differs')
    project = load(root / 'journey/completed/project.json')
    require(project.get('schema') == 'agi-fleet/ti-project/v1' and project.get('projectId') == qualification.get('projectId')
            and project.get('authority') == 'none' and project.get('qualification') == 'not-evaluated'
            and project.get('settlement') == 'not-connected' and 1 <= len(project.get('history', [])) <= 24, 'retained project scope differs')
    for event in project['history']:
        require(event.get('sha256') == sha(event['raw'].encode()), 'retained project event hash differs')
    returns = [event['raw'] for event in project['history'] if event['kind'] == 'computer-return']
    handoffs = [event['raw'] for event in project['history'] if event['kind'] == 'computer-handoff']
    require(len(returns) == len(handoffs) == 1
            and (root / 'journey/native-artifacts/computer-return.json').read_text() == returns[0]
            and (root / 'journey/native-artifacts/handoff.json').read_text() == handoffs[0], 'native raw return/handoff differs from same project history')
    for directory in ('demo', 'completed', 'capture'):
        folder = root / 'journey' / directory
        saved = load(folder / 'checksums.json')
        require(saved.get('authority') == 'none' and saved.get('independentReview') is False and saved.get('productionQualified') is False, 'public project export scope differs')
        actual = [{'name': file.name, 'sha256': digest(file), 'bytes': file.stat().st_size}
                  for file in sorted(folder.iterdir()) if file.is_file() and file.name != 'checksums.json']
        require(saved.get('files') == actual, 'project export byte inventory differs')
    commands = load(root / 'journey/commands.json')['commands']
    require(len(commands) == 6, 'complete dedicated command sequence required')
    require([row['argv'][2] for row in commands] == ['demo', 'browser-prepare', 'browser-run', 'browser-run', 'browser-run', 'browser-capture'], 'dedicated command sequence differs')
    for index, row in enumerate(commands):
        require(row['argv'][:2] == [binding['nodeExecutable'], binding['application'] + '/local-runtime/transformation/cli.mjs']
                and row.get('signal') is None and row.get('status') == (1 if index in (2, 4) else 0), 'actual installed command/refusal differs')
    require('TI_EXACT_BROWSER_GRANT_REQUIRED' in commands[2]['stderr'] and 'GRANT_UNAVAILABLE' in commands[4]['stderr'], 'actual wrong-grant/replay refusals missing')
    completed = decode(commands[3]['stdout']); captured = decode(commands[5]['stdout'])
    require(completed.get('nativeState') == 'complete' and completed.get('authority') == 'none'
            and captured.get('recovery') == 'retained-history-only-no-replay', 'native return/capture completion differs')
    tests = sum(len(re.findall(r'^test\(', file.read_text(), re.M)) for file in (ROOT / 'engineering/transformation').glob('*.test.mjs'))
    for name in ('test-output.txt', 'installed-test-output.txt'):
        tap(root / name, tests)
    pytests = sum(isinstance(node, ast.FunctionDef) and node.name.startswith('test_') for file in
                  (ROOT / 'engineering/transformation').glob('test_*.py') for node in ast.walk(ast.parse(file.read_text())))
    for name in ('python-test-output.txt', 'installed-python-test-output.txt'):
        text = (root / name).read_text()
        require(len(re.findall(r'^Ran ' + str(pytests) + r' tests? in ', text, re.M)) == 1
                and re.search(r'^OK\s*$', text, re.M) and not re.search(r'^FAILED|\bskipped=', text, re.M), 'complete TI Python tests required')
    native = root / 'journey/native-artifacts'
    require((native / 'visible-text.txt').is_file() and 'Independent usefulness review pending' in (native / 'visible-text.txt').read_text()
            and any(native.glob('screen-*.png')), 'retained native screenshots/text required')
    for file in native.iterdir():
        require(file.is_file() and re.fullmatch(r'(?:run\.json|receipt\.json|signed-receipt\.json|handoff\.json|computer-return\.json|visible-text\.txt|screen-\d{3}\.png)', file.name), 'native artifact coverage differs')
        if file.suffix == '.png':
            require(file.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'), 'native screenshot encoding differs')
    return {'execution': context, 'installation': binding, 'qualification': qualification,
            'reportInventorySHA256': digest(root / 'artifact-checksums.json'), 'sourcePreview': package}


@contextlib.contextmanager
def producer_context(source, run):
    # Existing auditors validate the authenticated ORIGINAL producer, not this new
    # collector workflow. Restore collector context immediately afterward.
    values = {'GITHUB_SHA': source, 'GITHUB_RUN_ID': str(run['id']), 'GITHUB_RUN_ATTEMPT': str(run['run_attempt'])}
    prior = {key: os.environ.get(key) for key in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for key, value in prior.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def public_release(api, tag, source, names, work, prefix):
    require(tag_commit(api, tag) == source, 'prerequisite public tag source differs')
    release = api('/releases/tags/' + tag)
    require(release.get('tag_name') == tag and release.get('draft') is False and release.get('prerelease') is True
            and release.get('target_commitish') == source, 'prerequisite release identity/classification differs')
    assets = pages(api, f'/releases/{release["id"]}/assets')
    require(len(assets) == len(names) and {row['name'] for row in assets} == set(names), 'public prerequisite asset set differs')
    directory = work / prefix; directory.mkdir()
    for row in assets:
        require(row.get('state') == 'uploaded' and row.get('uploader', {}).get('login') == 'github-actions[bot]'
                and re.fullmatch('sha256:[a-f0-9]{64}', row.get('digest', '')), 'authenticated complete public asset required')
        api.download('/releases/assets/' + str(row['id']), directory / row['name'],
                     {'bytes': row['size'], 'sha256': row['digest'].removeprefix('sha256:')})
    return directory, {'release': release, 'assets': assets}


def prerequisite_releases(api, producers, source, work):
    local_names = ['agi-fleet-local-0.1.0-alpha.6.zip', 'Local-Skills-Evidence-0.1.0-alpha.6.zip',
                   'Local-Skills-Manifest-0.1.0-alpha.6.json', 'SHA256SUMS-local-0.1.0-alpha.6.txt']
    linux_names = ['AGI_Fleet_Linux_v1.1.5.zip', 'Linux-Qualification-Evidence-v1.1.5.zip',
                   'Release-Manifest-v1.1.5.json', 'SHA256SUMS-v1.1.5.txt']
    linux, linux_record = public_release(api, 'v1.1.5-qualification', source, linux_names, work, 'linux-public')
    local, local_record = public_release(api, 'v0.1.0-local-skills-preview.6', source, local_names, work, 'local-public')
    sys.path.insert(0, str(ROOT / 'engineering'))
    linux_publisher = module('ti_inherited_linux_publisher', 'engineering/publish-next-release.py')
    local_publisher = module('ti_inherited_local_publisher', 'local-runtime/release.py')
    linux_manifest = load(linux / linux_names[2]); local_manifest = load(local / local_names[2])
    for directory, names in ((linux, linux_names), (local, local_names)):
        require((directory / names[3]).read_text() == ''.join(digest(directory / name) + '  ' + name + '\n' for name in names[:3]), 'public prerequisite checksums differ')
    with producer_context(source, producers['linux']['run']):
        require(str(linux_manifest.get('workflowRun')) == os.environ['GITHUB_RUN_ID'], 'public Linux producer run differs')
        linux_publisher.validate(linux_manifest, linux_manifest['audit'], source)
    # Authenticate the immutable original audited artifact and its actual attempt.
    retained, linux_artifact = artifact(api, producers['linux'], 'next-publication', work, 'linux-audited', 'audit')
    for name in linux_names[1:]:
        require(exact_file(retained, name).read_bytes() == (linux / name).read_bytes(), 'published Linux asset differs from original audited artifact')
    require(identity(linux / linux_names[0]) == {'name': linux_manifest['name'], 'bytes': linux_manifest['bytes'], 'sha256': linux_manifest['sha256']}, 'public Linux package differs')
    local_outer = unpack(local / local_names[1], work / 'local-public-evidence')
    evidence = unpack(local_outer / 'local-evidence.zip', work / 'local-original-evidence')
    for arch in ('x64', 'arm64'):
        folder = evidence / ('local-skills-preview-' + arch) / 'local-preview'; folder.mkdir(parents=True)
        shutil.copyfile(local / local_names[0], folder / local_names[0])
    with producer_context(source, producers['local']['run']):
        reconstructed = local_publisher.audit(evidence, source, os.environ['GITHUB_RUN_ID'])
        retained_local = load(local_outer / 'local-audit.json')
        require(reconstructed == retained_local, 'original alpha.6 complete audit does not reproduce')
        fleet_manifest = load(local_outer / 'fleet-regression-manifest.json')
        linux_publisher.validate(fleet_manifest, fleet_manifest['audit'], source)
    require(identity(local_outer / 'fleet-regression-evidence.zip') == {**fleet_manifest['evidence'], 'name': 'fleet-regression-evidence.zip'}, 'inherited Fleet evidence differs')
    require(str(local_manifest.get('workflowRun')) == str(producers['local']['run']['id'])
            and local_manifest.get('workflowAttempt') == str(producers['local']['run']['run_attempt'])
            and {key: value for key, value in local_manifest.items() if key not in ('schema', 'evidence', 'fleetRegression', 'nodePrerequisites')} ==
                {key: value for key, value in reconstructed.items() if key != 'schema'}
            and local_manifest.get('schema') == 'agi-fleet/local-published-preview/v1'
            and local_manifest.get('evidence') == identity(local / local_names[1])
            and local_manifest.get('fleetRegression') == fleet_manifest['audit']
            and local_manifest.get('nodePrerequisites') == load(ROOT / 'fleet/shared/runtime/compute/runtime-artifacts.lock.json')['node'], 'published alpha.6 manifest differs from actual complete audit')
    retained, local_artifact = artifact(api, producers['local'], 'audited-local-preview', work, 'local-audited', 'audit')
    require(exact_file(retained, 'local-audit.json').read_bytes() == (local_outer / 'local-audit.json').read_bytes()
            and exact_file(retained, 'local-evidence.zip').read_bytes() == (local_outer / 'local-evidence.zip').read_bytes()
            and exact_file(retained, local_names[0]).read_bytes() == (local / local_names[0]).read_bytes(), 'published alpha.6 bytes differ from original audited artifact')
    return {'linux': {**linux_record, 'manifest': linux_manifest, 'artifact': linux_artifact},
            'local': {**local_record, 'manifest': local_manifest, 'artifact': local_artifact},
            'legacyStopRecovery': 'REPLAYED_UNCHANGED_ALPHA6_READ_ONLY_SEMANTIC_AUDITOR',
            'legacyInstalledService': 'REPLAYED_UNCHANGED_ALPHA6_COMPLETE_AUDITOR'}


def source_review_artifact(api, producer, source, expected_tree, work):
    directory, record = artifact(api, producer, 'exact-review-source', work, 'source-review', 'review')
    receipt_file = exact_file(directory, 'source-receipt.json'); receipt = load(receipt_file)
    saved = exact_file(directory, 'AGI-Fleet-Linux-review-source.zip')
    run = producer['run']
    require(receipt.get('schema') == 'agi-fleet-review-source/v1' and receipt.get('repository') == REPOSITORY
            and receipt.get('commit') == source and receipt.get('workflowRun') == str(run['id'])
            and receipt.get('event') == run['event'] and receipt.get('productionQualified') is False
            and receipt.get('releaseEligible') is False
            and identity(saved) == {'name': receipt.get('name'), 'bytes': receipt.get('bytes'), 'sha256': receipt.get('sha256')}, 'actual exact-main source-review archive differs')
    require(exact_file(directory, 'SHA256SUMS.txt').read_text() == receipt['sha256'] + '  ' + receipt['name'] + '\n', 'source-review checksum differs')
    # Git archive bytes can vary in ZIP metadata; compare every tracked member to S.
    metadata = subprocess.check_output(['git', '--no-replace-objects', 'ls-tree', '-rz', source], cwd=ROOT)
    rows = []
    for item in metadata.split(b'\0'):
        if item:
            info, name = item.split(b'\t'); mode, kind, oid = info.decode().split(); rows.append((name.decode(), mode, kind, oid))
    with zipfile.ZipFile(saved) as archive:
        require({row.filename for row in archive.infolist() if not row.is_dir()} == {name for name, _, _, _ in rows}, 'review source complete coverage differs')
        for name, mode, kind, oid in rows:
            require(kind == 'blob' and mode in ('100644', '100755'), 'review source regular Git members required')
            data = archive.read(name)
            require(hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() == oid, 'review archive Git blob differs')
            stored_mode = stat.S_IMODE(archive.getinfo(name).external_attr >> 16)
            require(stored_mode in (0, 0o644, 0o755) and (stored_mode == 0 or stored_mode == (0o755 if mode == '100755' else 0o644)), 'review ZIP mode differs')
    require(subprocess.check_output(['git', 'rev-parse', source + '^{tree}'], cwd=ROOT, text=True).strip() == expected_tree, 'source-review tree differs')
    return {'receipt': receipt, 'artifact': record, 'tree': expected_tree}


def write_zip(file, entries):
    with zipfile.ZipFile(file, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
        for name, data in sorted(entries.items()):
            require(0 <= len(data) < LIMIT, 'evidence member bound')
            info = zipfile.ZipInfo(name, (2026, 10, 19, 0, 0, 0)); info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            target.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    identity(file)


def package_assets(packages, output):
    same = packages['x64']['package']['archive'] == packages['arm64']['package']['archive']
    require(packages['x64']['package']['manifest'] == packages['arm64']['package']['manifest']
            and packages['x64']['package']['manifestSHA256'] == packages['arm64']['package']['manifestSHA256'], 'architecture manifests/members differ')
    if same:
        target = output / ARCHIVE; shutil.copyfile(packages['x64']['file'], target)
        return [target], 'IDENTICAL_RAW_ARCHIVES_BOTH_NATIVE_ARCHITECTURES'
    assets = []
    for arch in ('x64', 'arm64'):
        target = output / ('Local-TI-Package-' + VERSION + '-' + arch + '.zip')
        # Outer container only: the saved qualified inner ZIP is copied untouched.
        write_zip(target, {ARCHIVE: packages[arch]['file'].read_bytes(),
                           'package-receipt.json': packages[arch]['receiptFile'].read_bytes()})
        with zipfile.ZipFile(target) as saved:
            require(sha(saved.read(ARCHIVE)) == packages[arch]['package']['archive']['sha256'], 'inner archive changed')
        assets.append(target)
    return assets, 'DISTINCT_RAW_SERIALIZATION_IDENTICAL_SOURCE_MEMBERS_ARCH_LABELLED_CONTAINERS'


def notes(manifest, assets):
    source = manifest['source']['commit']; runs = manifest['producers']
    text = ('## Local TI alpha.7 — source preview / Aperçu source\n\n'
            'Retain one public, non-personal TI project, its actual free native result and separate USDC/AGIALPHA inspections. '
            'Both currency allowances are zero; paid TI is refused. Browser work requires a separate exact one-use grant. '
            'The native return and method remain pending separately supplied review.\n\n'
            '**Development source preview. Not a production-qualified operator installer or completed handoff.** '
            'Linux x64 and ARM64 saved packages, normal installed application/Node and native Docker browser paths passed their bounded gates. '
            'The separate unchanged alpha.6 service gate covers in-flight STOP, reconciliation and a fresh attempt. '
            'No physical, live-provider, independent scientific/economic, human-accessibility or endurance qualification is claimed.\n\n'
            '**Aperçu source de développement, sans qualification de production ni transfert complet.** '
            'Le projet public conserve les deux inspections, avec des plafonds de zéro USDC et AGIALPHA. '
            'Le navigateur exige une autorisation distincte à usage unique; retour et méthode restent en attente d’un examen fourni séparément. '
            'Les parcours Linux x64/ARM64 utilisent l’application et Node réellement installés. L’ARRÊT, la réconciliation et la nouvelle tentative '
            'restent vérifiés par le parcours alpha.6 distinct. Les autres limites demeurent ouvertes.\n\n'
            f'[Version-matched guide / Guide]({"https://github.com/" + REPOSITORY + "/blob/" + source + "/docs/transformational-project.md"}). '
            'Verify checksums before extraction. Architecture-labelled outer containers, when present, contain the untouched canonical inner ZIP '
            'and receipt; extract that container first, then give the inner ZIP to the normal installer. GitHub source archives omit dependencies. '
            'Node 24.21.0 is a separately downloaded hash-pinned prerequisite. Installation starts no work and grants no authority.\n\n'
            f'Exact main source: `{source}`; tree `{manifest["source"]["tree"]}`. Package mode: `{manifest["packageMode"]}`.\n\n')
    for kind in WORKFLOWS:
        run = runs[kind]['run']; text += f'- {kind}: [run {run["id"]}, attempt {run["run_attempt"]}](https://github.com/{REPOSITORY}/actions/runs/{run["id"]}/attempts/{run["run_attempt"]}).\n'
    text += '\n| Asset | Bytes | SHA-256 |\n| --- | ---: | --- |\n'
    return text + ''.join(f'| {file.name} | {file.stat().st_size} | `{digest(file)}` |\n' for file in assets)


def audit(api, source, selections, output):
    require(re.fullmatch('[a-f0-9]{40}', source or '') and isinstance(selections, dict)
            and set(selections) == {*WORKFLOWS, 'review'}, 'complete actual producer/review selectors required')
    require(not output.exists() and output.parent.resolve() == output.parent, 'new physical publication output required')
    require(os.environ.get('GITHUB_REPOSITORY') == REPOSITORY and os.environ.get('GITHUB_REF') == 'refs/heads/main'
            and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch' and os.environ.get('GITHUB_SHA') == source
            and re.fullmatch('[1-9][0-9]*', os.environ.get('GITHUB_RUN_ID', ''))
            and re.fullmatch('[1-9][0-9]*', os.environ.get('GITHUB_RUN_ATTEMPT', ''))
            and subprocess.check_output(['git', '--no-replace-objects', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == source, 'authorized exact-main manual workflow required')
    for arguments in (['diff', '--quiet', '--no-ext-diff', source, '--'], ['diff', '--cached', '--quiet', '--no-ext-diff', '--']):
        require(subprocess.run(['git', '--no-replace-objects', *arguments], cwd=ROOT, check=False).returncode == 0, 'source checkout differs from committed source')
    current_main(api, source)
    commit = api('/git/commits/' + source)
    require(commit.get('sha') == source and commit.get('tree', {}).get('sha') == subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=ROOT, text=True).strip(), 'API/source tree differs')
    producers = {kind: authenticate_run(api, selections[kind], kind, source) for kind in WORKFLOWS}
    review = authenticate_review(api, selections['review'], source)
    pins = load(ROOT / 'engineering/transformation/source-pins.json')
    require(pins.get('schema') == 'agi-fleet/ti-installed-source-pins/v1' and pins.get('publicNonpersonalOnly') is True
            and pins.get('paidTI') is False and pins.get('liveProvider') is False and pins.get('productionQualified') is False
            and pins.get('importedAuthority') == 'none', 'source pin policy differs')
    for key in ('alpha', 'manager', 'jobs', 'computer'):
        require(re.fullmatch('[a-f0-9]{40}', pins.get(key, {}).get('commit', ''))
                and re.fullmatch('[a-f0-9]{40}', pins[key].get('tree', '')), 'nonnull immutable dependency source required')
    profile = load(ROOT / 'local-runtime/transformation/release-profile.json')
    require(profile.get('schema') == 'agi-fleet/ti-source-preview-release/v1' and profile.get('version') == VERSION
            and profile.get('tag') == TAG and profile.get('archive') == ARCHIVE and profile.get('name') == TITLE
            and all(profile.get(key) is False for key in ('operatorInstaller', 'productionQualified', 'fullHandoffComplete')), 'versioned TI profile differs')
    builder = module('ti_source_package_builder', 'local-runtime/transformation/package.py')
    installer = module('ti_source_installer', 'local-runtime/install.py')
    require(load(builder.INVENTORY) == builder.reviewed_inventory(), 'reviewed finite source inventory differs')
    expected = committed_entries(source, builder)
    with tempfile.TemporaryDirectory(prefix='ti-publication-retained-') as temporary:
        work = Path(temporary)
        prerequisite = prerequisite_releases(api, producers, source, work)
        review_source = source_review_artifact(api, producers['sourceReview'], source, commit['tree']['sha'], work)
        packages = {}; evidence = {}
        for arch in ('x64', 'arm64'):
            run = producers['ti']['run']
            name = f'ti-source-preview-{arch}-{source}-{run["id"]}-{run["run_attempt"]}'
            directory, artifact_record = artifact(api, producers['ti'], name, work, 'ti-' + arch,
                                                 'TI saved preview and native Docker (' + arch + ')')
            saved = exact_file(directory, ARCHIVE)
            receipt_file = saved.parent / 'package-receipt.json'; receipt = load(receipt_file)
            package = audit_package(saved, receipt, source, expected, installer, builder)
            report = exact_file(directory, 'artifact-checksums.json').parent
            observation = audit_ti_reports(report, package, source, producers['ti'], arch)
            packages[arch] = {'file': saved, 'receiptFile': receipt_file, 'package': package}
            evidence[arch] = {'artifact': artifact_record, 'observations': observation}
        # Source manifests contain exact complete member hashes/modes; both already
        # match Git S and the same committed dependency reference independently.
        require(packages['x64']['package']['manifest'] == packages['arm64']['package']['manifest'], 'architecture content divergence')
        output.mkdir()
        assets, mode = package_assets(packages, output)
        evidence_file = output / ('Local-TI-Evidence-' + VERSION + '.zip')
        members = {'authenticated-producers.json': encoded(producers), 'configured-owner-review.json': encoded(review),
                   'source-review.json': encoded(review_source), 'prerequisite-releases.json': encoded(prerequisite)}
        for arch in ('x64', 'arm64'):
            directory = work / ('ti-' + arch)
            root = exact_file(directory, 'artifact-checksums.json').parent
            for file in root.rglob('*'):
                if file.is_file():
                    members[arch + '/reports/' + file.relative_to(root).as_posix()] = file.read_bytes()
            members[arch + '/package-receipt.json'] = packages[arch]['receiptFile'].read_bytes()
        write_zip(evidence_file, members); assets.append(evidence_file)
        manifest = {**profile, 'schema': SCHEMA, 'status': 'PASS', 'source': {'commit': source, 'tree': commit['tree']['sha']},
                    'sourcePins': pins, 'producers': producers, 'review': review, 'sourceReview': review_source,
                    'prerequisites': prerequisite, 'architectures': evidence, 'packageMode': mode,
                    'packages': {arch: packages[arch]['package'] for arch in ('x64', 'arm64')},
                    'nodePrerequisites': load(ROOT / 'fleet/shared/runtime/compute/runtime-artifacts.lock.json')['node'],
                    'publicationAuditContext': {'repository': REPOSITORY, 'commit': source,
                        'workflowRun': os.environ.get('GITHUB_RUN_ID'), 'workflowAttempt': os.environ.get('GITHUB_RUN_ATTEMPT'),
                        'event': 'workflow_dispatch', 'workflow': '.github/workflows/transformation-release.yml'},
                    'evidence': identity(evidence_file), 'packageAssets': [identity(file) for file in assets[:-1]],
                    'physicalQualification': 'NOT_RUN', 'liveProviderQualification': 'NOT_RUN',
                    'independentEconomicReview': 'NOT_RUN', 'dedicatedInFlightStop': 'NOT_CLAIMED_SEPARATE_UNCHANGED_ALPHA6_GATE',
                    'providerRequests': 0, 'authority': 'none'}
        manifest_file = output / ('Local-TI-Manifest-' + VERSION + '.json'); manifest_file.write_bytes(encoded(manifest)); assets.append(manifest_file)
        body = notes(manifest, assets)
        checksum = output / ('SHA256SUMS-local-ti-' + VERSION + '.txt')
        checksum.write_text(''.join(digest(file) + '  ' + file.name + '\n' for file in assets)); assets.append(checksum)
        plan = {'schema': 'agi-fleet/ti-publication-plan/v1', 'source': source, 'tree': commit['tree']['sha'],
                'tag': TAG, 'name': TITLE, 'body': body, 'assets': [identity(file) for file in assets],
                'selectors': selections, 'manifestSHA256': digest(manifest_file)}
        (output / 'publication-plan.json').write_bytes(encoded(plan))
    return plan


def verify_remote(api, release, plan, assets, work):
    require(release.get('tag_name') == TAG and release.get('target_commitish') == plan['source']
            and release.get('name') == TITLE and release.get('body') == plan['body'] and release.get('prerelease') is True, 'remote source/classification/canonical notes differ')
    remote = pages(api, f'/releases/{release["id"]}/assets')
    require(len(remote) == len(assets) and {row['name'] for row in remote} == set(assets), 'remote exact asset set differs')
    for row in remote:
        expected = assets[row['name']]
        require(row.get('state') == 'uploaded' and row.get('size') == expected['bytes']
                and row.get('digest') == 'sha256:' + expected['sha256'], 'remote asset digest differs; replacement forbidden')
        file = work / (str(row['id']) + '.bin')
        api.download('/releases/assets/' + str(row['id']), file, expected)
    require(tag_commit(api, TAG) == plan['source'], 'remote tag changed')
    return remote


def publish(api, output, refresh):
    plan = load(output / 'publication-plan.json')
    require(isinstance(plan, dict) and plan.get('schema') == 'agi-fleet/ti-publication-plan/v1' and plan.get('tag') == TAG
            and plan.get('name') == TITLE and re.fullmatch('[a-f0-9]{40}', plan.get('source', '')), 'audited publication plan required')
    source = plan['source']; current_main(api, source)
    files = {row['name']: output / row['name'] for row in plan['assets']}
    require(len(files) == len(plan['assets']) and all(identity(files[row['name']]) == row for row in plan['assets']), 'prepared assets changed')
    manifest = load(output / ('Local-TI-Manifest-' + VERSION + '.json'))
    require(manifest.get('schema') == SCHEMA and manifest.get('source') == {'commit': source, 'tree': plan['tree']}
            and digest(output / ('Local-TI-Manifest-' + VERSION + '.json')) == plan['manifestSHA256'], 'versioned source manifest differs')
    require(plan['body'] == notes(manifest, [files[row['name']] for row in plan['assets']
                if row['name'] != 'SHA256SUMS-local-ti-' + VERSION + '.txt']), 'prepared canonical notes differ')
    refresh(plan)
    existing_tag = tag_commit(api, TAG)
    existing = [row for row in pages(api, '/releases') if row.get('tag_name') == TAG]
    if existing_tag is not None:
        require(existing_tag == source and len(existing) == 1 and existing[0].get('draft') is False, 'existing tag/draft cannot be moved or resumed')
        with tempfile.TemporaryDirectory(prefix='ti-readonly-existing-') as temporary:
            release = api('/releases/' + str(existing[0]['id']))
            require(release.get('draft') is False and release.get('prerelease') is True, 'fresh existing release is not a public prerelease')
            verify_remote(api, release, plan, {row['name']: row for row in plan['assets']}, Path(temporary))
        latest = maybe(api, '/releases/latest')
        require(latest is None or latest.get('id') != release['id'], 'existing preview became latest full release')
        return {'status': 'ALREADY_PUBLISHED_EXACT_READ_ONLY', 'url': release['html_url'], 'source': source}
    require(not existing, 'existing draft reservation differs; no replacement')
    current_main(api, source)
    created = api('/git/refs', method='POST', data={'ref': 'refs/tags/' + TAG, 'sha': source})
    require(created.get('ref') == 'refs/tags/' + TAG and created.get('object', {}).get('type') == 'commit'
            and created['object'].get('sha') == source and tag_commit(api, TAG) == source, 'fresh exact-source tag reservation not verified')
    # A verified, readable tag at S exists BEFORE any release draft or visibility.
    release = api('/releases', method='POST', data={'tag_name': TAG, 'target_commitish': source,
                  'name': TITLE, 'body': plan['body'], 'draft': True, 'prerelease': True, 'make_latest': 'false'})
    require(release.get('draft') is True, 'new release must remain draft')
    for name, file in files.items():
        api(f'/releases/{release["id"]}/assets?name=' + urllib.parse.quote(name, safe=''),
            method='POST', data=file.read_bytes(), upload=True)
    with tempfile.TemporaryDirectory(prefix='ti-remote-previsibility-') as temporary:
        observed = api('/releases/' + str(release['id']))
        require(observed.get('draft') is True, 'release became visible before final verification')
        verify_remote(api, observed, plan, {row['name']: row for row in plan['assets']}, Path(temporary))
    refresh(plan); current_main(api, source)
    require(tag_commit(api, TAG) == source, 'tag lease drift before first visibility')
    observed = api('/releases/' + str(release['id']))
    require(observed.get('draft') is True and observed.get('body') == plan['body'], 'draft notes/classification changed')
    api('/releases/' + str(release['id']), method='PATCH', data={'draft': False, 'prerelease': True,
        'make_latest': 'false', 'body': plan['body']})
    with tempfile.TemporaryDirectory(prefix='ti-remote-public-') as temporary:
        observed = api('/releases/' + str(release['id']))
        require(observed.get('draft') is False and observed.get('prerelease') is True, 'public prerelease classification differs')
        verify_remote(api, observed, plan, {row['name']: row for row in plan['assets']}, Path(temporary))
    latest = maybe(api, '/releases/latest')
    require(latest is None or latest.get('id') != observed['id'], 'source preview became latest full release')
    return {'status': 'PUBLISHED_VERIFIED', 'url': observed['html_url'], 'source': source,
            'tag': TAG, 'assets': plan['assets'], 'productionQualified': False}


def refresh_proof(api, plan):
    current_main(api, plan['source'])
    manifest = load(ROOT / 'local-runtime/transformation/release-profile.json')
    require(manifest.get('tag') == TAG and manifest.get('version') == VERSION, 'current profile differs')
    original = load(Path(plan['_output']) / ('Local-TI-Manifest-' + VERSION + '.json'))
    for kind in WORKFLOWS:
        require(authenticate_run(api, plan['selectors'][kind], kind, plan['source']) == original['producers'][kind], 'producer proof changed before visibility')
    require(authenticate_review(api, plan['selectors']['review'], plan['source']) == original['review'], 'configured/owner review changed before visibility')
    for tag, key in [('v1.1.5-qualification', 'linux'), ('v0.1.0-local-skills-preview.6', 'local')]:
        previous = original['prerequisites'][key]
        release = api('/releases/' + str(previous['release']['id']))
        require(tag_commit(api, tag) == plan['source'] and release.get('draft') is False and release.get('prerelease') is True
                and release.get('body') == previous['release'].get('body')
                and stable_asset_set(pages(api, f'/releases/{release["id"]}/assets')) == stable_asset_set(previous['assets']), 'prerequisite public source/assets changed')


def stable_api(value):
    """Exclude only the download counter of actual API asset records.

    Full original records remain retained. IDs, names, bytes, digests, state,
    uploader and every other field still participate in the integrity comparison.
    """
    if isinstance(value, dict):
        asset = {'id', 'name', 'size', 'digest'} <= set(value)
        return {key: stable_api(item) for key, item in value.items()
                if not (asset and key == 'download_count')}
    if isinstance(value, list):
        return [stable_api(item) for item in value]
    return value


def stable_asset_set(records):
    return sorted((stable_api(row) for row in records), key=lambda row: (row['name'], row['id']))


def retry_bindings(original, current, published, current_output):
    """Verify original immutable bytes against freshly audited qualified inputs.

    The old collector is not relabelled as the current verification run. Outer
    ZIP serialization and retained API download counters are metadata; native
    reports, receipts and the actually qualified inner archives must stay exact.
    """
    excluded = {'publicationAuditContext', 'evidence', 'packageAssets'}
    require(stable_api({key: value for key, value in original.items() if key not in excluded}) ==
            stable_api({key: value for key, value in current.items() if key not in excluded}), 'existing qualification/source/producer bindings differ')
    names = ([ARCHIVE] if original.get('packageMode') == 'IDENTICAL_RAW_ARCHIVES_BOTH_NATIVE_ARCHITECTURES' else
             ['Local-TI-Package-' + VERSION + '-' + arch + '.zip' for arch in ('x64', 'arm64')])
    require(original.get('packageMode') in ('IDENTICAL_RAW_ARCHIVES_BOTH_NATIVE_ARCHITECTURES',
            'DISTINCT_RAW_SERIALIZATION_IDENTICAL_SOURCE_MEMBERS_ARCH_LABELLED_CONTAINERS')
            and original.get('packageAssets') == [identity(published / name) for name in names], 'existing package container identities differ')
    evidence_name = 'Local-TI-Evidence-' + VERSION + '.zip'
    require(original.get('evidence') == identity(published / evidence_name), 'existing exact evidence bytes differ')
    metadata = {'authenticated-producers.json', 'configured-owner-review.json', 'source-review.json', 'prerequisite-releases.json'}
    with zipfile.ZipFile(published / evidence_name) as old, zipfile.ZipFile(current_output / evidence_name) as fresh:
        require(old.namelist() == fresh.namelist() and len(old.namelist()) == len(set(old.namelist())), 'existing evidence coverage differs')
        for name in old.namelist():
            old_raw, fresh_raw = old.read(name), fresh.read(name)
            require((stable_api(decode(old_raw)) == stable_api(decode(fresh_raw))) if name in metadata else old_raw == fresh_raw,
                    'existing retained report/receipt/proof bytes differ: ' + name)
        if names == [ARCHIVE]:
            require(identity(published / ARCHIVE) == current['packages']['x64']['archive'] == current['packages']['arm64']['archive'], 'existing common package is not both actual qualified archives')
        else:
            for arch, name in zip(('x64', 'arm64'), names):
                with zipfile.ZipFile(published / name) as container:
                    require(sorted(container.namelist()) == [ARCHIVE, 'package-receipt.json'], 'existing architecture container layout differs')
                    require(sha(container.read(ARCHIVE)) == current['packages'][arch]['archive']['sha256']
                            and len(container.read(ARCHIVE)) == current['packages'][arch]['archive']['bytes']
                            and container.read('package-receipt.json') == fresh.read(arch + '/package-receipt.json'), 'existing untouched qualified inner ZIP/receipt differs')
    return names


def read_only_retry(api, output, plan):
    """Authenticate the original publication and verify its exact existing bytes."""
    source = plan['source']; current_main(api, source)
    require(tag_commit(api, TAG) == source, 'existing tag source differs')
    release = api('/releases/tags/' + TAG)
    require(release.get('draft') is False and release.get('prerelease') is True
            and release.get('tag_name') == TAG and release.get('target_commitish') == source, 'existing publication is not a matching public prerelease')
    assets = pages(api, f'/releases/{release["id"]}/assets')
    names = {row['name'] for row in assets}
    manifest_name = 'Local-TI-Manifest-' + VERSION + '.json'
    evidence_name = 'Local-TI-Evidence-' + VERSION + '.zip'
    checksum_name = 'SHA256SUMS-local-ti-' + VERSION + '.txt'
    common = {ARCHIVE, evidence_name, manifest_name, checksum_name}
    separate = {'Local-TI-Package-' + VERSION + '-' + arch + '.zip' for arch in ('x64', 'arm64')} | {evidence_name, manifest_name, checksum_name}
    require(len(names) == len(assets) and names in (common, separate), 'existing exact public asset set differs')
    current = load(output / manifest_name)
    with tempfile.TemporaryDirectory(prefix='ti-original-publication-') as temporary:
        work = Path(temporary)
        for row in assets:
            require(row.get('state') == 'uploaded' and row.get('uploader', {}).get('login') == 'github-actions[bot]'
                    and re.fullmatch('sha256:[a-f0-9]{64}', row.get('digest', '')), 'existing public asset origin/digest missing')
            api.download('/releases/assets/' + str(row['id']), work / row['name'],
                         {'bytes': row['size'], 'sha256': row['digest'].removeprefix('sha256:')})
        original = load(work / manifest_name)
        require(original.get('schema') == SCHEMA and original.get('source') == {'commit': source, 'tree': plan['tree']}, 'existing published source schema differs')
        package_names = retry_bindings(original, current, work, output)
        context = original.get('publicationAuditContext')
        require(isinstance(context, dict) and set(context) == {'repository', 'commit', 'workflowRun', 'workflowAttempt', 'event', 'workflow'}
                and context.get('repository') == REPOSITORY and context.get('commit') == source
                and context.get('event') == 'workflow_dispatch' and context.get('workflow') == '.github/workflows/transformation-release.yml'
                and re.fullmatch('[1-9][0-9]*', context.get('workflowRun', ''))
                and re.fullmatch('[1-9][0-9]*', context.get('workflowAttempt', '')), 'original publication collector identity missing')
        collector = authenticate_run(api, context['workflowRun'] + ':' + context['workflowAttempt'],
                                     'publication', source, historical_collector=True)
        ordered = [work / name for name in [*package_names, evidence_name, manifest_name]]
        require((work / checksum_name).read_text() == ''.join(digest(file) + '  ' + file.name + '\n' for file in ordered), 'original exact public checksum bytes differ')
        require(release.get('name') == TITLE and release.get('body') == notes(original, ordered), 'original canonical published notes differ')
        original_plan = {'source': source, 'body': release['body']}
        remote = work / 'remote'; remote.mkdir()
        verify_remote(api, release, original_plan, {file.name: identity(file) for file in [*ordered, work / checksum_name]}, remote)
        # Fresh classification is checked after all downloads, not inferred from
        # an earlier list row. This branch contains no API mutation operation.
        observed = api('/releases/' + str(release['id']))
        require(observed.get('draft') is False and observed.get('prerelease') is True
                and observed.get('name') == TITLE and observed.get('body') == release['body'], 'fresh existing release classification/notes differ')
        require(stable_asset_set(pages(api, f'/releases/{release["id"]}/assets')) == stable_asset_set(assets), 'existing public asset lease changed')
        latest = maybe(api, '/releases/latest')
        require(latest is None or latest.get('id') != release['id'], 'existing preview is latest full release')
        refresh_proof(api, {**plan, '_output': str(output)})
        current_main(api, source); require(tag_commit(api, TAG) == source, 'existing tag changed during verification')
        result = {'status': 'ALREADY_PUBLISHED_EXACT_READ_ONLY', 'url': observed['html_url'], 'source': source,
                  'originalPublicationContext': context, 'originalCollectorAuthentication': collector,
                  'verificationContext': current['publicationAuditContext'],
                  'assets': [identity(file) for file in [*ordered, work / checksum_name]], 'productionQualified': False}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-source', required=True)
    parser.add_argument('--selectors', required=True, help='JSON selectors for actual ti/local/linux/repository/sourceReview run:attempt and review API IDs')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--publish', action='store_true', help='Explicitly publish only after the complete retained-evidence audit')
    args = parser.parse_args()
    api = GitHub(os.environ.get('GH_TOKEN'))
    output = args.output.absolute()
    plan = audit(api, args.expected_source, decode(args.selectors), output)
    if args.publish:
        if tag_commit(api, TAG) is not None:
            result = read_only_retry(api, output, plan)
        else:
            result = publish(api, output, lambda proof: refresh_proof(api, {**proof, '_output': str(output)}))
    else:
        result = {'status': 'AUDITED_NOT_PUBLISHED', 'source': plan['source'], 'assets': plan['assets'], 'productionQualified': False}
    (output / 'verification-result.json').write_bytes(encoded(result))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
