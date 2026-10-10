#!/usr/bin/env python3
"""Package an already-tested production-only tree; never include operator state."""
import argparse, hashlib, json, os, stat, zipfile
from pathlib import Path
import datetime

def is_sqlite_state(file):
    # Pinned upstream source filenames may contain ".sqlite". Detect actual
    # database/sidecar names and SQLite file bytes without excluding valid source.
    suffixes=tuple(ext+tail for ext in ('.sqlite','.sqlite3') for tail in ('','-wal','-shm','-journal'))
    if file.name.endswith(suffixes): return True
    with file.open('rb') as source: return source.read(16)==b'SQLite format 3\x00'

import subprocess
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--out',type=Path,required=True);args=p.parse_args();root=args.root.resolve();target=args.out.resolve()
if target.is_relative_to(root):raise SystemExit('Choose an output path outside the application tree.')
for name in ['hardhat','solc','marked']:
 if (root/'node_modules'/name).exists():raise SystemExit('Use a fresh staging tree with npm ci --omit=dev --ignore-scripts first.')
for name in ['ethers','ajv']:
 if not (root/'node_modules'/name/'package.json').exists():raise SystemExit('Production dependencies must be installed in staging.')
version=json.loads((root/'package.json').read_text())['version'];prefix='AGI_Node_Private_v'+version
folders=['qualification','shared','evidence','workforce','config','compute','fleet','src','app','web','contract','docs','tests','examples','ops','scripts','node_modules','AGI Node.app']
names=['Cleanup-Evidence.command','Verify-Package.command','Update-Signer.command','STANDARD_FINALIZATION_HOTFIX.md','Continue-Standard-Readiness.command','STANDARD_AUTHORITY_HOTFIX.md','Continue-Standard-Install.command','STANDARD_RETRY_HOTFIX.md','Install.command','Verified-Install.command','Experimental-Migration.command', 'Continue-Fresh-Readiness.command','Resume-Fresh-OAuth.command','Clean-Install-Compute.command','Retry-Clean-Install.command','Retry-Standard-Install.command','Retry-Verified-Install.command','Prepare-Compute-Runtime.command','Restart-Compute.command','Import-Public-Browser-Qualification.command','Configure-Public-Browser.command','Repair-Compute.command','Administrator-DNS.command','release-manifest.json','source-inventory.json','changed-files.json','source-changes.patch','START_HERE.md','Qualify-Mac.command','READ_ME_FIRST.txt','Launch-Seed-Wallet.command','Launch-Native-Workforce.command','Launch-Native-Workforce.sh','README.md','README.html','NOTICE.md','NOTICE.html','LICENSE','START_HERE.html','package.json','package-lock.json','node.config.example.json','hardhat.config.js','Launch-AGI-Node.command','Launch-AGI-Node.sh','Launch-AGI-Node.cmd','Launch-Demo.command','Launch-Demo.sh','Launch-Demo.cmd','Setup-OpenClaw.command','Setup-OpenClaw.sh','Setup-OpenClaw.cmd']
files=[root/n for n in names]
for folder in folders:
 files.extend(x for x in (root/folder).rglob('*') if x.is_file() and not any(part in {'__pycache__','.rsync-tmp','.pytest_cache'} for part in x.parts) and x.suffix!='.pyc')
files=sorted(files,key=lambda x:x.relative_to(root).as_posix())
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

for f in files:
 if not f.resolve().is_relative_to(root):raise SystemExit('An included link points outside the application tree.')
 if (('admission' in f.parts or 'funding' in f.parts) and ('inbox' in f.parts or 'evidence' in f.parts)):raise SystemExit('Private qualification state found; refusing packaging')
 if f.name in ['release-profile.json','setup-progress.json','admission-policy.json','funding-policy.json','issuer-private.pem', 'unretained-review-policy.json', 'capability-ledger.json', 'review-protection-policy.json', 'review-funding-policy.json','recovered-commissioning.json','pilot.json','commissioning.json','restore-in-progress.json','vault.json','activation.json','launch.json','node.config.json','RUNNING.lock','application.lock','assistant.json','assistant-state.json','commissioning.json','pilot.json','watchdog.json','watchdog-state.json','monitor-access.json','connections.json','observations.json','AGI-Node-OpenClaw-Setup.json','AGI-Node-Read-Only.json'] or f.suffix in ['.sqlite','.aginodebackup']:raise SystemExit('Operator state found in release paths; refusing packaging.')
manifest=''.join(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+f.relative_to(root).as_posix()+'\n' for f in files)
checked = subprocess.run(['node', str(root/'scripts/check-guides.mjs')], capture_output=True, text=True)
if checked.returncode: raise SystemExit(checked.stdout + checked.stderr)
(root/'MANIFEST.sha256').write_text(manifest);files.append(root/'MANIFEST.sha256');target.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in files:
  info=zipfile.ZipInfo(prefix+'/'+f.relative_to(root).as_posix(),date_time=datetime.datetime.fromtimestamp(int(os.environ.get('SOURCE_DATE_EPOCH','1790899200')),datetime.timezone.utc).timetuple()[:6]);info.create_system=3;info.external_attr=(stat.S_IFREG|(0o755 if os.access(f,os.X_OK) else 0o644))<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,manifest.encode() if f.name=='MANIFEST.sha256' and f.parent==root else f.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
print(json.dumps({'file':str(target),'version':version,'files':len(files),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()},indent=2))

# Verify the actual distributable, including every native runtime entry point.
with zipfile.ZipFile(target) as archive:
 if archive.testzip() is not None: raise SystemExit("Archive CRC verification failed")
 for line in manifest.splitlines():
  expected, name = line.split("  ", 1)
  if hashlib.sha256(archive.read(prefix+"/"+name)).hexdigest() != expected: raise SystemExit("Archive manifest mismatch: "+name)
 for name in ["workforce/cli.mjs", "workforce/runner.mjs", "workforce/project.mjs", "workforce/core/workforce.cjs", "workforce/core/workforce-outcomes.cjs", "workforce/core/capacity-plan.cjs", "workforce/core/project-economics.cjs", "docs/PROJECT_ECONOMICS.html", "docs/VALUE_TIER_PILOT.html", "examples/project-economics-100.json", "examples/project-economics-1000.json", "examples/project-economics-10000.json", "Launch-Native-Workforce.command"]:
  if prefix+"/"+name not in archive.namelist(): raise SystemExit("Native runtime missing from archive: "+name)

from final_archive_gate import validate_final_archive
validate_final_archive(target, root / "scripts")
