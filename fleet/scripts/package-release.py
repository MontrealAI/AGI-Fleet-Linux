#!/usr/bin/env python3
"""Package a clean, locally verified fleet tree; never include operator state."""
import argparse
import hashlib
import json
import os
from pathlib import Path

def is_sqlite_state(file):
    # Pinned upstream source filenames may contain ".sqlite". Detect actual
    # database/sidecar names and SQLite file bytes without excluding valid source.
    suffixes=tuple(ext+tail for ext in ('.sqlite','.sqlite3') for tail in ('','-wal','-shm','-journal'))
    if file.name.endswith(suffixes): return True
    with file.open('rb') as source: return source.read(16)==b'SQLite format 3\x00'

import stat
import subprocess
import zipfile
import datetime

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
root, out = args.root.resolve(), args.out.resolve()
registry=json.loads((root/'config/role-registry.json').read_text())['roles']
apps=[root,*[root/'packages'/c['package'] for c in registry.values()]]
for name in ('sync-shared-runtime.py','sync-shared-operator.py','sync-release-tools.py'):
    subprocess.run([__import__('sys').executable,str(root/'scripts'/name),'--root',str(root),'--check'],check=True)
if out.is_relative_to(root):
    raise SystemExit('The ZIP output must be outside the application tree.')
blocked = {'release-profile.json','setup-progress.json','recovered-commissioning.json','pilot.json','commissioning.json','restore-in-progress.json','vault.json', 'config.json', 'panel.json', 'process.lock', 'STOP',
           'monitor-access.json', 'AGI-Fleet-Read-Only-Monitor.json',
           'AGI-Fleet-OpenClaw-Setup.json', 'AGI-Fleet-Encrypted-Backup.json',
           'AGI-Fleet-Workload.json', 'AGI-Fleet-Evidence.json',
           'activation.json', 'agent.config.json', 'node.config.json',
           'RUNNING.lock', 'application.lock', '.env', 'admission-policy.json', 'funding-policy.json', 'issuer-private.pem', 'unretained-review-policy.json', 'capability-ledger.json', 'review-protection-policy.json', 'review-funding-policy.json'}
for private_record in root.rglob('*.json'):
    if 'node_modules' in private_record.parts: continue
    try: private_data=json.loads(private_record.read_text())
    except (ValueError,UnicodeError): continue
    if isinstance(private_data,dict) and isinstance(private_data.get('schema'),str) and private_data['schema'] in ['agi-agent-openclaw-setup/v1', 'agi-fleet-role-openclaw-setup/v2', 'agi-node-openclaw-setup/v1']:
        raise SystemExit('Private setup kit found; refusing packaging: '+str(private_record.relative_to(root)))
for private_file in root.rglob('*'):
    if private_file.is_file() and private_file.name in {'compute-settings.json','compute-journal.json','setup-diagnostics.json'}:
        raise SystemExit('Private commissioning state found; refusing packaging: '+str(private_file.relative_to(root)))

for record in root.rglob('*.json'):
    if 'node_modules' in record.parts: continue
    try: data = json.loads(record.read_text())
    except (ValueError, UnicodeError): continue
    if isinstance(data, dict) and (data.get('purpose') in {'agi-node-backup/v2','agi-agent-backup/v2'} or (isinstance(data.get('schema'),str) and data['schema'] in {'agi-native-job/v1','agi-native-project/v1','agi-native-config/v1','agi-native-receipt/v1','agi-native-authority/v1','agi-project-repair/v1'}) or (isinstance(data.get('header'),dict) and data['header'].get('schema') == 'agi-private-envelope/v1')):
        raise SystemExit('Private native/project record found: ' + str(record))
for candidate in root.rglob('*'):
    if candidate.is_file() and (candidate.name in {'assistant-state.json.approval-pending','native-config.json','gateway-token.txt','openclaw.json','device-key.pem','RECOVERY_REQUIRED.json'} or candidate.name.endswith(('-private.pem','.encrypted','.encrypted.json')) or is_sqlite_state(candidate)):
        raise SystemExit('Private native operator state found: ' + str(candidate))

for f in root.rglob('*'):
    if f.is_symlink() and (not f.resolve().is_relative_to(root) or f.is_dir()):
        raise SystemExit('Materialize directory links; never package external dependencies: ' + str(f))
    if not f.is_file():
        continue
    if not f.resolve().is_relative_to(root):
        raise SystemExit('External symbolic link: ' + str(f))
    if (any(x in f.parts for x in ['admission','funding']) and ('inbox' in f.parts or 'evidence' in f.parts)) or f.name in blocked or is_sqlite_state(f) or f.suffix in {'.agiagentbackup', '.aginodebackup'}:
        raise SystemExit('Private operator state found: ' + str(f))
for app in apps:
    for dependency in ['ajv', 'ethers']:
        if not (app/'node_modules'/dependency/'package.json').exists():
            raise SystemExit('Missing production dependency: ' + str(app/dependency))

# A distributable must carry usable, current standalone instructions.
for app in apps:
    checked = subprocess.run(['node', str(app/'scripts/check-guides.mjs')], capture_output=True, text=True)
    if checked.returncode: raise SystemExit(checked.stdout + checked.stderr)

def distributable(f):
    return f.is_file() and not any(part in {"__pycache__", ".rsync-tmp", ".pytest_cache"} for part in f.parts) and f.suffix != ".pyc"

def inventory(folder):
    files = sorted((f for f in folder.rglob('*') if distributable(f)
                    and f != folder/'MANIFEST.sha256'),
                   key=lambda f: f.relative_to(folder).as_posix())
    (folder/'MANIFEST.sha256').write_text(''.join(
        hashlib.sha256(f.read_bytes()).hexdigest() + '  ' +
        f.relative_to(folder).as_posix() + '\n' for f in files))

for app in [c['package'] for c in registry.values()]:
    inventory(root/'packages'/app)
inventory(root)
version = json.loads((root/'package.json').read_text())['version']
archive_prefix = ('AGI_Fleet_Linux_v' if json.loads((root/'release-manifest.json').read_text()).get('platformEdition')=='Ubuntu 24.04 LTS' else 'AGI_Autonomous_Fleet_v')+version
files = sorted((f for f in root.rglob('*') if distributable(f)),
               key=lambda f: f.relative_to(root).as_posix())
out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in files:
        info = zipfile.ZipInfo(archive_prefix+'/'+f.relative_to(root).as_posix(),
                               date_time=datetime.datetime.fromtimestamp(int(os.environ.get('SOURCE_DATE_EPOCH','1790899200')),datetime.timezone.utc).timetuple()[:6])
        info.create_system = 3
        info.external_attr = (stat.S_IFREG | (0o755 if os.access(f, os.X_OK) else 0o644)) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, f.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
with zipfile.ZipFile(out) as z:
    for app in ['',*['packages/'+c['package']+'/' for c in registry.values()]]:
        for dependency in ['ajv', 'ethers']:
            name=archive_prefix+'/'+app+'node_modules/'+dependency+'/package.json'
            if name not in z.namelist():
                raise SystemExit('Production dependency omitted from ZIP: ' + name)
    if z.testzip() is not None:
        raise SystemExit('Archive CRC verification failed.')
    # Verify what was actually written, including nested companion inventories.
    prefix = archive_prefix+'/'
    for app in ['',*['packages/'+c['package']+'/' for c in registry.values()]]:
        for line in z.read(prefix+app+'MANIFEST.sha256').decode().splitlines():
            expected, name = line.split('  ', 1)
            member = prefix+app+name
            if member not in z.namelist() or hashlib.sha256(z.read(member)).hexdigest() != expected:
                raise SystemExit('Archive manifest mismatch: '+member)

print(json.dumps({'file': str(out), 'files': len(files), 'bytes': out.stat().st_size,
                  'sha256': hashlib.sha256(out.read_bytes()).hexdigest(),
                  'crcVerified': True, 'allManifestsVerified': True}, indent=2))

from final_archive_gate import validate_final_archive
validate_final_archive(out, root / "scripts")
