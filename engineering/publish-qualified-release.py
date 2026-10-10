#!/usr/bin/env python3
import argparse
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import urllib.error
import urllib.request

from release_tools import ASSET, REPOSITORY, ROOT, SHA256, SIZE, URL, download, require, sha


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


def api(path, token, method='GET', data=None, content_type='application/json', upload=False):
    host = 'https://uploads.github.com' if upload else 'https://api.github.com'
    request = urllib.request.Request(host + path, data=data, method=method, headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
        'Content-Type': content_type, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'AGI-Fleet-Linux-publisher'})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=120) as response:
        return json.load(response)


def artifact(expected, token, output):
    request = urllib.request.Request(f'https://api.github.com/repos/{REPOSITORY}/actions/artifacts/{expected["id"]}/zip',
                                    headers={'Authorization': 'Bearer ' + token, 'User-Agent': 'AGI-Fleet-Linux-publisher'})
    try:
        urllib.request.build_opener(NoRedirect).open(request, timeout=120)
        raise ValueError('Artifact endpoint did not redirect')
    except urllib.error.HTTPError as error:
        require(error.code == 302, 'Artifact download unavailable; preserve the published evidence instead')
        location = error.headers['Location']
        require(location.startswith('https://'), 'Non-HTTPS artifact redirect')
    download(location, output, expected['sha256'], expected['bytes'])


def main():
    parser = argparse.ArgumentParser(description='Publish only the independently audited 1.0.9 evidence and qualification notes; preserve the frozen implementation.')
    parser.parse_args()
    token = os.environ['GH_TOKEN']
    prefix = f'/repos/{REPOSITORY}'
    release = api(prefix + '/releases/tags/v1.0.9-qualification', token)
    require(not release['draft'] and release['prerelease'], 'Release must remain a published prerelease')
    assets = {entry['name']: entry for entry in release['assets']}
    require(ASSET in assets and assets[ASSET]['size'] == SIZE and assets[ASSET]['digest'] == 'sha256:' + SHA256,
            'Published implementation identity differs')
    metadata = json.loads((ROOT / 'validation/Linux-Native-Evidence-v1.0.9.json').read_text())
    evidence_name = metadata['name']
    with tempfile.TemporaryDirectory(prefix='agi-native-publication-') as temporary:
        work = Path(temporary)
        evidence = work / evidence_name
        if evidence_name in assets:
            existing = assets[evidence_name]
            require(existing['size'] == metadata['bytes'] and existing['digest'] == 'sha256:' + metadata['sha256'],
                    'Existing evidence differs; refusing to replace it')
        else:
            spec = importlib.util.spec_from_file_location('native_bundle', ROOT / 'engineering/build-native-evidence.py')
            builder = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(builder)
            artifacts = {}
            for architecture, expected in builder.ARTIFACTS.items():
                artifacts[architecture] = work / (architecture + '.zip')
                artifact(expected, token, artifacts[architecture])
            frozen = work / ASSET
            download(URL, frozen, SHA256, SIZE)
            report = builder.build(artifacts, frozen, evidence)
            require(report['bytes'] == metadata['bytes'] and report['sha256'] == metadata['sha256'], 'Evidence bundle identity differs')
            api(prefix + f'/releases/{release["id"]}/assets?name=' + evidence_name, token, 'POST',
                evidence.read_bytes(), 'application/zip', upload=True)
        checksums = f'{SHA256}  {ASSET}\n{metadata["sha256"]}  {evidence_name}\n'.encode()
        name = 'SHA256SUMS-v1.0.9.txt'
        if name in assets:
            require(assets[name]['size'] == len(checksums) and assets[name]['digest'] == 'sha256:' + __import__('hashlib').sha256(checksums).hexdigest(),
                    'Existing checksums differ; refusing to replace them')
        else:
            api(prefix + f'/releases/{release["id"]}/assets?name=' + name, token, 'POST', checksums, 'text/plain', upload=True)
        result = api(prefix + f'/releases/{release["id"]}', token, 'PATCH', json.dumps({
            'name': 'Linux 1.0.9 — audited native PASS; physical qualification candidate',
            'body': (ROOT / 'docs/RELEASE_NOTES_1_0_9.md').read_text(), 'prerelease': True}).encode())
        require(result['prerelease'] is True, 'Release classification changed')
    print(json.dumps({'status': 'PUBLISHED', 'release': result['html_url'], 'implementationSHA256': SHA256,
                      'nativeAcceptance': 'PASS', 'productionQualified': False}, indent=2))


if __name__ == '__main__':
    main()
