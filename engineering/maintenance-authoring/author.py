"""Create only a new review branch from an exact locally reviewed Git tree.

This helper stays outside the resulting candidate. It cannot merge or publish.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request

REPO = 'MontrealAI/AGI-Fleet-Linux'
BASE = '770666eaa79791d79f7fa00175c43a052dcc11d2'
BASE_TREE = '9cde3e1ce5dc0ec5a34862c7d31b671559f42811'
EXPECTED_TREE = '198d90d86facdfac3a55d8fd38f103645b0a3428'
TARGET = 'codex/linux-1.1.1-qualification-20261014'
ROOT = Path(sys.argv[1]).resolve(strict=True)
assert os.environ['GITHUB_REPOSITORY'] == REPO
assert os.environ['GITHUB_REF'] == 'refs/heads/codex/prepare-linux-1.1.1-20261014'

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

assert git('rev-parse', 'HEAD').decode().strip() == BASE
assert git('rev-parse', 'HEAD^{tree}').decode().strip() == BASE_TREE
assert git('write-tree').decode().strip() == EXPECTED_TREE
assert not git('diff', '--name-only')
names = git('diff', '--cached', '--name-only', '-z', BASE).decode().rstrip('\0').split('\0')
assert len(names) == 101 and all(not n.startswith('engineering/maintenance-authoring/') for n in names)
assert '.github/workflows/maintenance-authoring.yml' not in names
entries = {}
for row in git('ls-files', '--stage', '-z').decode().rstrip('\0').split('\0'):
    meta, name = row.split('\t', 1)
    mode, sha, stage = meta.split()
    assert stage == '0'
    entries[name] = (mode, sha)


def api(path, data=None):
    assert path.startswith('/git/')
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + path,
        data=None if data is None else json.dumps(data).encode(),
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)

try:
    existing = api('/git/ref/heads/' + TARGET)
except urllib.error.HTTPError as error:
    if error.code != 404:
        raise
else:
    raise SystemExit('Target branch already exists; refusing any update: ' + existing['ref'])

uploaded = set()
tree = []
for name in names:
    mode, expected = entries[name]
    assert mode in ('100644', '100755')
    file = ROOT / name
    assert file.is_file() and not file.is_symlink() and file.resolve().is_relative_to(ROOT)
    content = file.read_bytes()
    assert hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest() == expected
    if expected not in uploaded:
        blob = api('/git/blobs', {'content': content.decode('utf-8'), 'encoding': 'utf-8'})
        assert blob['sha'] == expected
        uploaded.add(expected)
    tree.append({'path': name, 'mode': mode, 'type': 'blob', 'sha': expected})
created_tree = api('/git/trees', {'base_tree': BASE_TREE, 'tree': tree})
assert created_tree['sha'] == EXPECTED_TREE
commit = api('/git/commits', {'message': 'Prepare Linux 1.1.1 maintenance qualification with preserved runtime and release gates',
    'tree': EXPECTED_TREE, 'parents': [BASE]})
assert commit['tree']['sha'] == EXPECTED_TREE and [p['sha'] for p in commit['parents']] == [BASE]
created = api('/git/refs', {'ref': 'refs/heads/' + TARGET, 'sha': commit['sha']})
assert created['ref'] == 'refs/heads/' + TARGET and created['object']['sha'] == commit['sha']
receipt = {'schema': 'agi-fleet-exact-tree-authoring/v1', 'repository': REPO, 'baseCommit': BASE,
    'tree': EXPECTED_TREE, 'commit': commit['sha'], 'branch': TARGET, 'changedFiles': len(names),
    'workflowCommit': os.environ['GITHUB_SHA'], 'workflowRun': os.environ['GITHUB_RUN_ID'],
    'merged': False, 'releasePublished': False, 'productionQualified': False}
output = Path(os.environ['RUNNER_TEMP']) / 'maintenance-authoring'
output.mkdir(exist_ok=True)
(output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
