#!/usr/bin/env python3
"""Publish only the reviewed, re-audited integration evidence; preserve release bytes."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile

from release_tools import ASSET, REPOSITORY, ROOT, SHA256, SIZE, require, sha


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'engineering' / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def main():
    publisher = module('native_publisher', 'publish-qualified-release.py')
    auditor = module('job_auditor', 'audit-job-evidence.py')
    metadata = json.loads((ROOT / 'validation/Linux-Job-Integration-Evidence-v1.0.9.json').read_text())
    require(metadata['releaseSHA256'] == SHA256 and metadata['productionQualified'] is False,
            'Invalid integration classification')
    token = os.environ['GH_TOKEN']
    prefix = f'/repos/{REPOSITORY}'
    release = publisher.api(prefix + '/releases/tags/v1.0.9-qualification', token)
    require(not release['draft'] and release['prerelease'], 'Release must remain a published prerelease')
    assets = {asset['name']: asset for asset in release['assets']}
    require(assets[ASSET]['size'] == SIZE and assets[ASSET]['digest'] == 'sha256:' + SHA256,
            'Published Fleet identity differs')
    run = publisher.api(prefix + '/actions/runs/' + metadata['workflowRun'], token)
    require(run['conclusion'] == 'success' and run['head_sha'] == metadata['workflowCommit']
            and run['event'] == 'push', 'Integration run provenance differs')
    jobs = publisher.api(prefix + '/actions/runs/' + metadata['workflowRun'] + '/jobs', token)['jobs']
    require(len(jobs) == 2 and all(job['conclusion'] == 'success' for job in jobs), 'Both integration jobs must pass')
    with tempfile.TemporaryDirectory(prefix='agi-job-publication-') as temporary:
        work = Path(temporary)
        artifacts = {}
        for architecture, expected in metadata['artifacts'].items():
            artifact = publisher.api(prefix + '/actions/artifacts/' + str(expected['id']), token)
            require(not artifact['expired'] and artifact['workflow_run']['id'] == int(metadata['workflowRun'])
                    and artifact['digest'] == 'sha256:' + expected['sha256'], 'Original artifact provenance differs')
            artifacts[architecture] = work / (architecture + '.zip')
            publisher.artifact(expected, token, artifacts[architecture])
        bundle = work / metadata['name']
        reproduced = auditor.build(artifacts, metadata['workflowRun'], metadata['workflowCommit'], bundle)
        require(all(metadata[key] == value for key, value in reproduced.items()), 'Re-audited integration evidence differs')
        require(metadata['audit'] == json.loads((ROOT / 'validation/job-integration-audit.json').read_text()),
                'Reviewed audit differs')
        if bundle.name in assets:
            require(assets[bundle.name]['size'] == metadata['bytes']
                    and assets[bundle.name]['digest'] == 'sha256:' + metadata['sha256'],
                    'Existing integration evidence differs; refusing replacement')
        else:
            uploaded = publisher.api(prefix + f'/releases/{release["id"]}/assets?name=' + bundle.name,
                                     token, 'POST', bundle.read_bytes(), 'application/zip', upload=True)
            require(uploaded['digest'] == 'sha256:' + metadata['sha256'], 'Uploaded evidence digest differs')
        checksums = work / 'SHA256SUMS-job-integration-v1.0.9.txt'
        checksums.write_text(f'{SHA256}  {ASSET}\n{metadata["sha256"]}  {bundle.name}\n')
        if checksums.name in assets:
            require(assets[checksums.name]['size'] == checksums.stat().st_size
                    and assets[checksums.name]['digest'] == 'sha256:' + sha(checksums),
                    'Existing integration checksums differ; refusing replacement')
        else:
            publisher.api(prefix + f'/releases/{release["id"]}/assets?name=' + checksums.name, token, 'POST',
                          checksums.read_bytes(), 'text/plain', upload=True)
        publisher.api(prefix + f'/releases/{release["id"]}', token, 'PATCH', json.dumps({
            'body': (ROOT / 'docs/RELEASE_NOTES_1_0_9.md').read_text(), 'prerelease': True,
        }).encode())
    print(json.dumps({'status': 'PUBLISHED', 'evidence': metadata['name'], 'sha256': metadata['sha256'],
                      'jobIntegration': 'PASS', 'productionQualified': False}, indent=2))


if __name__ == '__main__':
    main()
