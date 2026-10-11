#!/usr/bin/env python3
"""Prepare and publish an immutable, independently audited Mac prerelease."""
import argparse
import json
import os
from pathlib import Path
import stat
import tempfile
import urllib.error
import urllib.parse
import zipfile

from audit import (ROOT, REPOSITORY, LIMIT, audit, decode_json, module, read_json,
                   regular_tree, require, sha, validate_metadata, write_json)
from release_tools import extract

VERSION = '1.20.2'
EVIDENCE = 'macOS-Qualification-Evidence-v' + VERSION + '.zip'
MANIFEST = 'Release-Manifest-macOS-v' + VERSION + '.json'
CHECKSUMS = 'SHA256SUMS-macOS-v' + VERSION + '.txt'
NOTES = 'Release-Notes-macOS-v' + VERSION + '.md'


def pack_evidence(release, evidence, audit_file, output):
    files = {'audit.json': audit_file}
    for root, prefix in ((release, 'packaging'), (evidence, 'validation')):
        regular_tree(root)
        for path in sorted(root.rglob('*')):
            if path.is_file() and path.suffix != '.zip':
                files[prefix + '/' + path.relative_to(root).as_posix()] = path
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as saved:
        for name, path in sorted(files.items()):
            require(path.stat().st_size < LIMIT, 'Evidence member exceeds size ceiling')
            item = zipfile.ZipInfo(name, (2026, 10, 10, 12, 0, 0))
            item.create_system = 3
            item.external_attr = (stat.S_IFREG | 0o644) << 16
            saved.writestr(item, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    require(0 < output.stat().st_size < LIMIT, 'Evidence ZIP exceeds the size ceiling')


def prepare(release, evidence, output, commit, repository, run_id):
    require(not output.exists() and not output.is_symlink(), 'Publication output must be absent')
    result = audit(release, evidence, commit, repository, run_id)
    metadata = read_json(release / 'release.json')
    output.mkdir()
    write_json(output / 'audit.json', result)
    pack_evidence(release, evidence, output / 'audit.json', output / EVIDENCE)
    manifest = {**metadata, 'schema': 'agi-macos-published-release/v1',
                'workflowCommit': commit, 'repository': repository, 'workflowRun': str(run_id),
                'nativeAcceptance': 'PASS', 'jobIntegrationAcceptance': 'PASS',
                'operatorGate': 'OPEN_FOR_CONTROLLED_FRESH_INSTALL', 'physicalQualification': 'NOT_RUN',
                'productionQualified': False, 'signedNotarized': False, 'audit': result,
                'evidence': {'name': EVIDENCE, 'bytes': (output / EVIDENCE).stat().st_size,
                             'sha256': sha(output / EVIDENCE)}}
    write_json(output / MANIFEST, manifest)
    identity_assets = [release / metadata['name'], output / EVIDENCE, output / MANIFEST]
    notes = (ROOT / 'macos/docs/RELEASE_NOTES.md').read_text()
    notes += '\n## Published artifact identities\n\n| Asset | Bytes | SHA-256 |\n| --- | ---: | --- |\n'
    notes += ''.join(f'| {path.name} | {path.stat().st_size:,} | `{sha(path)}` |\n' for path in identity_assets)
    notes += (f'\nValidated commit: `{commit}`. [Retained workflow evidence]'
              f'(https://github.com/{repository}/actions/runs/{run_id}).\n\n'
              'Both native Apple silicon CI suites passed. The native macOS AGIJobManager integration '
              'passed 8 standalone scripts and 777 Manager tests against the exact saved archive. '
              'Physical M1/M2 installation, Docker Desktop, desktop permissions, OAuth, reboot and '
              '72-hour qualification remain NOT_RUN. Production qualification and Apple signing/'
              'notarization are not claimed. This prerelease opens controlled fresh-install qualification.\n')
    (output / NOTES).write_text(notes)
    assets = [*identity_assets, output / NOTES]
    (output / CHECKSUMS).write_text(''.join(sha(path) + '  ' + path.name + '\n' for path in assets))
    return {'status': 'PREPARED', 'assets': [path.name for path in assets] + [CHECKSUMS],
            'sha256': metadata['sha256'], 'productionQualified': False}


def checksum_inventory(path):
    result = {}
    import re
    for line in path.read_text().splitlines():
        require(re.fullmatch('[0-9a-f]{64}  [A-Za-z0-9_.-]+', line), 'Malformed publication checksum')
        checksum, name = line.split('  ', 1)
        require(name not in result, 'Duplicate publication checksum')
        result[name] = checksum
    return result


def validate_prepared(release, output, commit, repository, run_id):
    regular_tree(release); regular_tree(output)
    metadata = read_json(release / 'release.json')
    validate_metadata(metadata, commit, repository, run_id)
    manifest = read_json(output / MANIFEST)
    require(manifest['schema'] == 'agi-macos-published-release/v1' and manifest['repository'] == repository
            and manifest['workflowCommit'] == commit and manifest['workflowRun'] == str(run_id),
            'Published manifest provenance differs')
    for key, value in metadata.items():
        if key not in ('schema', 'nativeAcceptance', 'operatorGate'):
            require(manifest.get(key) == value, 'Published candidate identity differs: ' + key)
    require(manifest['nativeAcceptance'] == manifest['jobIntegrationAcceptance'] == 'PASS'
            and manifest['operatorGate'] == 'OPEN_FOR_CONTROLLED_FRESH_INSTALL'
            and manifest['physicalQualification'] == 'NOT_RUN' and manifest['productionQualified'] is False
            and manifest['signedNotarized'] is False, 'Published qualification scope differs')
    assets = [release / metadata['name'], output / EVIDENCE, output / MANIFEST, output / NOTES, output / CHECKSUMS]
    expected = checksum_inventory(output / CHECKSUMS)
    require(set(expected) == {path.name for path in assets[:-1]}, 'Publication checksum coverage differs')
    for path in assets:
        require(path.is_file() and not path.is_symlink() and 0 < path.stat().st_size < LIMIT, 'Unsafe publication asset')
        if path.name in expected:
            require(sha(path) == expected[path.name], 'Prepared publication bytes changed: ' + path.name)
    require(sha(assets[0]) == metadata['sha256'] and assets[0].stat().st_size == metadata['bytes'], 'Candidate changed')
    require(manifest['evidence'] == {'name': EVIDENCE, 'bytes': assets[1].stat().st_size,
                                    'sha256': sha(assets[1])}, 'Evidence archive identity differs')
    with tempfile.TemporaryDirectory(prefix='agi-macos-publication-audit-') as temporary:
        unpacked = Path(temporary) / 'evidence'
        extract(output / EVIDENCE, unpacked)
        require(read_json(unpacked / 'packaging/release.json') == metadata
                and sha(unpacked / 'packaging/release.json') == sha(release / 'release.json'), 'Packaged candidate metadata differs')
        result = audit(release, unpacked / 'validation', commit, repository, run_id)
        require(result == manifest['audit'] == read_json(unpacked / 'audit.json') == read_json(output / 'audit.json'),
                'Independent re-audit differs from prepared publication')
    return metadata, manifest, assets


def publication_environment(commit, repository, run_id):
    require(os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('GITHUB_REPOSITORY') == repository
            and os.environ.get('GITHUB_SHA') == commit
            and os.environ.get('GITHUB_RUN_ID') == str(run_id)
            and os.environ.get('GITHUB_REF') == 'refs/heads/main'
            and os.environ.get('GITHUB_EVENT_NAME') in ('push', 'workflow_dispatch'),
            'Publication requires the reviewed main-branch GitHub Actions run')
    token = os.environ.get('GH_TOKEN')
    require(isinstance(token, str) and bool(token), 'Publication requires GH_TOKEN')
    return token


def publish(release_dir, output, commit, repository, run_id):
    token = publication_environment(commit, repository, run_id)
    metadata, manifest, assets = validate_prepared(release_dir, output, commit, repository, run_id)
    helper = module('macos_github_publisher', ROOT / 'engineering/publish-qualified-release.py')
    prefix = '/repos/' + repository
    api = lambda path, **kwargs: helper.api(prefix + path, token, **kwargs)
    def get_or_missing(path):
        try:
            return api(path)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            return None
    def tag_matches(tag):
        require(tag['object']['type'] == 'commit' and tag['object']['sha'] == commit, 'Release tag targets different source')
    tag_path = '/git/ref/tags/' + metadata['tag']
    tag = get_or_missing(tag_path)
    if tag is None:
        tag = api('/git/refs', method='POST', data=json.dumps({'ref': 'refs/tags/' + metadata['tag'], 'sha': commit}).encode())
    tag_matches(tag)
    release = get_or_missing('/releases/tags/' + metadata['tag'])
    notes = (output / NOTES).read_text()
    if release is None:
        release = api('/releases', method='POST', data=json.dumps({
            'tag_name': metadata['tag'], 'target_commitish': commit,
            'name': 'macOS ' + VERSION + ' — native Apple silicon qualification candidate',
            'body': notes, 'draft': True, 'prerelease': True, 'make_latest': 'false'}).encode())
    require(release['prerelease'] is True and release['target_commitish'] == commit
            and release['tag_name'] == metadata['tag'] and release['body'] == notes,
            'Existing release differs; refusing replacement')
    existing = {entry['name']: entry for entry in release['assets']}
    require(len(existing) == len(release['assets']) and set(existing) <= {path.name for path in assets},
            'Unexpected or duplicate existing release assets')
    for path in assets:
        if path.name in existing:
            entry = existing[path.name]
            require(entry['size'] == path.stat().st_size and entry['digest'] == 'sha256:' + sha(path),
                    'Existing asset differs; refusing replacement')
        else:
            require(release['draft'], 'Cannot add missing assets to an immutable published candidate')
            api(f'/releases/{release["id"]}/assets?name=' + urllib.parse.quote(path.name), method='POST',
                data=path.read_bytes(), content_type='application/zip' if path.suffix == '.zip'
                else 'application/octet-stream', upload=True)
    observed = api(f'/releases/{release["id"]}')
    remote = {entry['name']: entry for entry in observed['assets']}
    require(len(remote) == len(observed['assets']) and set(remote) == {path.name for path in assets}
            and all(remote[path.name]['digest'] == 'sha256:' + sha(path)
                    and remote[path.name]['size'] == path.stat().st_size for path in assets),
            'Remote publication bytes differ')
    tag_matches(api(tag_path))
    if observed['draft']:
        observed = api(f'/releases/{release["id"]}', method='PATCH', data=json.dumps({
            'draft': False, 'prerelease': True, 'make_latest': 'false'}).encode())
    require(observed['draft'] is False and observed['prerelease'] is True, 'Published release classification differs')
    tag_matches(api(tag_path))
    return {'status': 'PUBLISHED', 'url': observed['html_url'], 'sha256': metadata['sha256'],
            'productionQualified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'publish'))
    parser.add_argument('--release-dir', type=Path, required=True)
    parser.add_argument('--evidence-dir', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--commit', default=os.environ.get('GITHUB_SHA'))
    parser.add_argument('--repository', default=os.environ.get('GITHUB_REPOSITORY', REPOSITORY))
    parser.add_argument('--run-id', default=os.environ.get('GITHUB_RUN_ID'))
    args = parser.parse_args()
    if args.command == 'prepare':
        require(args.evidence_dir is not None, 'Preparation requires --evidence-dir')
        result = prepare(args.release_dir, args.evidence_dir, args.output, args.commit, args.repository, args.run_id)
    else:
        result = publish(args.release_dir, args.output, args.commit, args.repository, args.run_id)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
