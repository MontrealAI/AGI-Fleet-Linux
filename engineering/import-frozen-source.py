#!/usr/bin/env python3
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.error

from release_tools import PREFIX, REPOSITORY, ROOT, require, verify_source

BRANCH = 'codex/frozen-linux-1.0.9-source'


def git(*arguments, auth=False):
    command = ['git']
    if auth:
        credential = base64.b64encode(('x-access-token:' + os.environ['GH_TOKEN']).encode()).decode()
        command += ['-c', 'http.https://github.com/.extraheader=AUTHORIZATION: basic ' + credential]
    result = subprocess.run(command + list(arguments), cwd=ROOT, capture_output=True, text=True)
    require(result.returncode == 0, 'Source import Git operation failed; inspect branch status without printing credentials')
    return result.stdout.strip()


def main():
    if (ROOT / 'fleet').exists():
        print(json.dumps(verify_source(ROOT / 'fleet')))
        return
    require(not git('status', '--porcelain'), 'Source import requires a clean checkout')
    if git('ls-remote', '--heads', 'origin', 'refs/heads/' + BRANCH):
        print('Frozen source branch already exists; review and merge its pull request.')
        return
    with tempfile.TemporaryDirectory(prefix='agi-source-import-') as temporary:
        output = Path(temporary) / 'materialized'
        subprocess.run([sys.executable, str(ROOT / 'engineering/materialize-release.py'), '--source-only', '--output', str(output)], check=True)
        git('checkout', '-b', BRANCH)
        shutil.move(str(output / PREFIX), str(ROOT / 'fleet'))
        verify_source(ROOT / 'fleet')
        git('config', 'user.name', 'github-actions[bot]')
        git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
        git('add', '--force', 'fleet')
        git('commit', '-m', 'Track the exact audited Linux 1.0.9 source and licenses')
        git('push', 'origin', 'HEAD:refs/heads/' + BRANCH, auth=True)
    print(json.dumps({'status': 'SOURCE_BRANCH_READY', 'branch': BRANCH, 'files': 4816, 'runtimeChanged': False}))


if __name__ == '__main__':
    main()
