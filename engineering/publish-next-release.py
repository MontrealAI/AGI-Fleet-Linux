#!/usr/bin/env python3
"""Publish a new immutable candidate only after independent two-architecture audit."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import urllib.error
import zipfile

from release_tools import ROOT, REPOSITORY, LIMIT, require, sha
from release_note_links import render_release_note_links
from contract_profiles import CONTRACT_PROFILES


def load(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def validate(metadata, audit, commit):
    require(re.fullmatch(r'[0-9a-f]{40}', commit or '') is not None, 'An exact workflow commit is required')
    specification = load(ROOT / 'engineering/next-release.json')
    for key in ('version', 'tag', 'name', 'sourceRevisionSHA256', 'sourceFiles', 'native', 'integration'):
        require(metadata.get(key) == specification.get(key), 'Release specification differs: ' + key)
    require(metadata.get('repositoryCommit') == metadata.get('workflowCommit') == commit,
            'Candidate was built from a different commit')
    run_id = str(audit.get('workflowRun', ''))
    require(re.fullmatch(r'[1-9][0-9]*', run_id) is not None, 'An exact workflow run is required')
    require(not os.environ.get('GITHUB_RUN_ID') or os.environ['GITHUB_RUN_ID'] == run_id,
            'Publication workflow run differs')
    require(metadata['version'] == '1.1.4' and metadata['tag'] == 'v1.1.4-qualification'
            and metadata['name'] == 'AGI_Fleet_Linux_v1.1.4.zip', 'Unexpected release identity')
    require(0 < metadata['bytes'] < LIMIT and re.fullmatch('[0-9a-f]{64}', metadata['sha256']), 'Invalid archive identity')
    require(audit['status'] == 'PASS' and audit['releaseSHA256'] == metadata['sha256']
            and audit['productionQualified'] is False and audit['workflowCommit'] == commit,
            'Release audit is incomplete or belongs to another commit')
    require(audit['sourceRevisionSHA256'] == metadata['sourceRevisionSHA256']
            and audit['physicalQualification'] == 'NOT_RUN' and audit['architectures'] == ['x64', 'arm64'],
            'Audit source or qualification scope differs')
    successor = audit.get('successorAcceptance', {})
    require(successor.get('status') == 'PASS' and successor.get('archiveSHA256') == metadata['sha256']
            and successor.get('sourceRevisionSHA256') == metadata['sourceRevisionSHA256']
            and successor.get('workflowCommit') == commit and str(successor.get('workflowRun')) == run_id
            and successor.get('authority') == 'none', 'Saved-archive SUCCESSOR acceptance differs')
    expected = specification['native']
    integration = specification['integration']
    require(audit.get('version') == metadata['version'] and audit.get('integrationTarget') == integration,
            'Audit release or integration target differs')
    native_logs = integration_logs = 0
    for group in ('native', 'integration'):
        runs = audit[group]
        require(len(runs) == 2 and {run['architecture'] for run in runs} == {'x64', 'arm64'}, 'Missing architecture')
        for run in runs:
            require(run['status'] == 'PASS' and run['workflowCommit'] == commit and run['productionQualified'] is False,
                    'Incomplete per-architecture acceptance')
            require(str(run.get('workflowRun')) == run_id, 'Mixed workflow runs cannot be published')
            if group == 'native':
                for scope, target in expected.items():
                    result = run['runs'][scope]
                    require(result['status'] == 'PASS' and result['verifiedLogs'] == target['files']
                            and result['counts']['tests'] == result['counts']['pass'] == target['tests']
                            and all(result['counts'][key] == 0 for key in ('fail', 'cancelled', 'skipped', 'todo')),
                            'Native acceptance count differs')
                    native_logs += result['verifiedLogs']
            else:
                require(run.get('managerCommit') == integration['commit']
                        and run['standaloneIntegrationScripts'] == integration['standaloneScripts']
                        and run['managerTestsPassed'] == integration['managerTests']
                        and run['productionSourcesMatched'] == run['contractArtifactsMatched'] == integration['contractArtifacts']
                        and run.get('verifiedLogs') == 19,
                        'Integration acceptance count differs')
                integration_logs += run['verifiedLogs']
    profiles = audit.get('contractProfiles', [])
    profile_id = 'manager-1.17.0-b7218196'
    profile = CONTRACT_PROFILES[profile_id]
    require(len(profiles) == 2 and {row.get('architecture') for row in profiles} == {'x64', 'arm64'},
            'Both saved-archive contract-profile architectures are required')
    for row in profiles:
        require(row.get('status') == 'PASS' and row.get('productionQualified') is False
                and row.get('workflowCommit') == commit and str(row.get('workflowRun')) == run_id
                and row.get('archiveSHA256') == metadata['sha256']
                and row.get('sourceRevisionSHA256') == metadata['sourceRevisionSHA256']
                and row.get('profile') == profile_id
                and row.get('profileManifestSHA256') == profile['manifestSHA256']
                and row.get('managerCommit') == profile['commit']
                and row.get('managerTestsPassed') == profile['managerTests']
                and row.get('standaloneIntegrationScripts') == 8
                and row.get('contractArtifactsMatched') == 11
                and row.get('verifiedLogs') == 12 and row.get('completeArchiveUnchanged') is True,
                'Saved-archive contract-profile acceptance differs')
    require(audit.get('verifiedTapLogs') == native_logs and audit.get('verifiedIntegrationLogs') == integration_logs,
            'Audit log coverage differs')


def publication_notes(assets, commit, workflow_run):
    require(re.fullmatch(r'[1-9][0-9]*', str(workflow_run or '')) is not None,
            'Release notes require an exact workflow run')
    source = 'docs/RELEASE_NOTES_1_1_4.md'
    notes = render_release_note_links((ROOT / source).read_text(), root=ROOT,
        source=source, repository=REPOSITORY, commit=commit)
    notes += '\n## Published artifact identities\n\n| Asset | Bytes | SHA-256 |\n| --- | ---: | --- |\n'
    notes += ''.join(f'| {path.name} | {path.stat().st_size:,} | `{sha(path)}` |\n' for path in assets)
    notes += f'\nValidated commit: `{commit}`. [Complete workflow evidence](https://github.com/{REPOSITORY}/actions/runs/{workflow_run}).\n'
    return notes


def prepare(release, evidence, output):
    metadata, audit = load(release / 'release.json'), load(evidence / 'audit.json')
    commit = os.environ.get('GITHUB_SHA')
    validate(metadata, audit, commit)
    archive = release / metadata['name']
    require(sha(archive) == metadata['sha256'] and archive.stat().st_size == metadata['bytes'], 'Candidate archive changed')
    require(not output.exists() and not output.is_symlink(), 'Publication output must be absent')
    output.mkdir()
    name = 'Linux-Qualification-Evidence-v1.1.4.zip'
    with zipfile.ZipFile(output / name, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
        for root, prefix in [(evidence, 'validation'), (release / 'AGI_Fleet_Linux_v1.1.4-checks', 'packaging')]:
            require(root.is_dir(), 'Missing retained evidence: ' + str(root))
            for path in sorted(root.rglob('*')):
                require(not path.is_symlink(), 'Evidence links are forbidden')
                if not path.is_file():
                    continue
                require(path.stat().st_size < LIMIT, 'Evidence member exceeds size ceiling')
                info = zipfile.ZipInfo(prefix + '/' + path.relative_to(root).as_posix(), (2026, 10, 14, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                target.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    require((output / name).stat().st_size < LIMIT, 'Evidence ZIP exceeds size ceiling')
    manifest = {**metadata, 'schema': 'agi-linux-published-release/v1', 'workflowCommit': commit,
        'workflowRun': os.environ.get('GITHUB_RUN_ID'), 'nativeAcceptance': 'PASS', 'jobIntegrationAcceptance': 'PASS',
        'operatorGate': 'OPEN_FOR_CONTROLLED_FRESH_INSTALL',
        'productionQualified': False, 'physicalQualification': 'NOT_RUN', 'audit': audit,
        'evidence': {'name': name, 'bytes': (output / name).stat().st_size, 'sha256': sha(output / name)}}
    write(output / 'Release-Manifest-v1.1.4.json', manifest)
    assets = [archive, output / name, output / 'Release-Manifest-v1.1.4.json']
    (output / 'SHA256SUMS-v1.1.4.txt').write_text(''.join(sha(path) + '  ' + path.name + '\n' for path in assets))
    (output / 'release-notes.md').write_text(publication_notes(assets, commit, manifest['workflowRun']))
    print(json.dumps({'status': 'PREPARED', 'assets': [p.name for p in assets], 'productionQualified': False}))


def publish(release_dir, output):
    metadata = load(release_dir / 'release.json')
    manifest = load(output / 'Release-Manifest-v1.1.4.json')
    commit = os.environ.get('GITHUB_SHA')
    validate(metadata, manifest['audit'], commit)
    require(manifest['workflowCommit'] == commit and manifest['sha256'] == metadata['sha256'], 'Publication identity differs')
    assets = [release_dir / metadata['name'], output / manifest['evidence']['name'],
              output / 'Release-Manifest-v1.1.4.json', output / 'SHA256SUMS-v1.1.4.txt']
    expected = {line.split('  ', 1)[1]: line.split('  ', 1)[0] for line in assets[-1].read_text().splitlines()}
    require(set(expected) == {p.name for p in assets[:-1]}, 'Checksum coverage differs')
    for path in assets:
        require(path.is_file() and not path.is_symlink() and path.stat().st_size < LIMIT, 'Unsafe publication asset')
        if path.name in expected:
            require(sha(path) == expected[path.name], 'Publication bytes changed: ' + path.name)
    require(sha(assets[0]) == metadata['sha256'] and assets[0].stat().st_size == metadata['bytes'], 'Candidate changed')
    require(sha(assets[1]) == manifest['evidence']['sha256'], 'Evidence changed')
    notes = publication_notes(assets[:-1], commit, manifest['workflowRun'])
    require((output / 'release-notes.md').read_text() == notes,
            'Release notes differ from the exact reviewed source and artifact identities')
    spec = importlib.util.spec_from_file_location('baseline_publisher', ROOT / 'engineering/publish-qualified-release.py')
    publisher = importlib.util.module_from_spec(spec); spec.loader.exec_module(publisher)
    token = os.environ['GH_TOKEN']
    prefix = '/repos/' + REPOSITORY
    api = lambda path, **kwargs: publisher.api(prefix + path, token, **kwargs)
    try:
        tag = api('/git/ref/tags/' + metadata['tag'])
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        tag = api('/git/refs', method='POST', data=json.dumps({'ref': 'refs/tags/' + metadata['tag'], 'sha': commit}).encode())
    require(tag['object']['type'] == 'commit' and tag['object']['sha'] == commit, 'Release tag targets different source')
    try:
        release = api('/releases/tags/' + metadata['tag'])
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        release = api('/releases', method='POST', data=json.dumps({'tag_name': metadata['tag'],
            'target_commitish': commit, 'name': 'Linux 1.1.4 — exact-archive SUCCESSOR Ω + Fleet / AGIJobManager 1.16.1 qualification',
            'body': notes, 'draft': True, 'prerelease': True}).encode())
    require(release['prerelease'] is True and release['target_commitish'] == commit, 'Existing release targets different source')
    ref = api('/git/ref/tags/' + metadata['tag']) if not release['draft'] else None
    if ref is not None:
        require(ref['object']['type'] == 'commit' and ref['object']['sha'] == commit, 'Published tag differs')
    existing = {entry['name']: entry for entry in release['assets']}
    require(set(existing) <= {path.name for path in assets}, 'Unexpected existing release assets')
    for path in assets:
        if path.name in existing:
            entry = existing[path.name]
            require(entry['size'] == path.stat().st_size and entry['digest'] == 'sha256:' + sha(path), 'Existing asset differs; refusing replacement')
        else:
            require(release['draft'], 'Cannot add missing files to an already published immutable candidate')
            api(f'/releases/{release["id"]}/assets?name=' + path.name, method='POST', data=path.read_bytes(),
                content_type='application/zip' if path.suffix == '.zip' else 'application/octet-stream', upload=True)
    observed = api(f'/releases/{release["id"]}')
    require(observed.get('body') == notes, 'Remote release notes differ from reviewed publication text')
    remote = {item['name']: item for item in observed['assets']}
    require(set(remote) == {p.name for p in assets} and all(remote[p.name]['digest'] == 'sha256:' + sha(p)
        and remote[p.name]['size'] == p.stat().st_size for p in assets), 'Remote publication verification failed')
    tag = api('/git/ref/tags/' + metadata['tag'])
    require(tag['object']['type'] == 'commit' and tag['object']['sha'] == commit, 'Tag changed before publication')
    if release['draft']:
        observed = api(f'/releases/{release["id"]}', method='PATCH', data=json.dumps({'draft': False, 'prerelease': True, 'make_latest': 'false', 'body': notes}).encode())
    require(not observed['draft'] and observed['prerelease'], 'Release publication classification differs')
    require(observed.get('body') == notes, 'Published release notes differ from reviewed publication text')
    tag = api('/git/ref/tags/' + metadata['tag'])
    require(tag['object']['type'] == 'commit' and tag['object']['sha'] == commit, 'Published tag identity differs')
    print(json.dumps({'status': 'PUBLISHED', 'url': observed['html_url'], 'sha256': metadata['sha256'], 'productionQualified': False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-dir', type=Path, required=True)
    parser.add_argument('--evidence-dir', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    if args.prepare_only:
        require(args.evidence_dir is not None, '--evidence-dir is required for preparation')
        prepare(args.release_dir, args.evidence_dir, args.output)
    else:
        publish(args.release_dir, args.output)


if __name__ == '__main__':
    main()
