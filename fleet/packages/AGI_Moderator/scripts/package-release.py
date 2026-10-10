#!/usr/bin/env python3
from pathlib import Path
import argparse,hashlib,json,os,stat,zipfile,datetime,subprocess
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--out',type=Path,required=True);a=p.parse_args();root=a.root.resolve();out=a.out.resolve();assert not out.is_relative_to(root)
c=json.loads((root/'config/companion-releases.json').read_text());registry=json.loads((root/'config/role-registry.json').read_text())['roles'];role=c['role'];version=json.loads((root/'package.json').read_text())['version'];assert version==registry[role]['version']
subprocess.run(['node',str(root/'scripts/check-guides.mjs')],check=True,capture_output=True,text=True)
blocked=['assistant-state.json.approval-pending','.env', 'AGI-Fleet-Encrypted-Backup.json', 'AGI-Fleet-Evidence.json', 'AGI-Fleet-OpenClaw-Setup.json', 'AGI-Fleet-Read-Only-Monitor.json', 'AGI-Fleet-Workload.json', 'COMPUTE_STOP', 'RECOVERY_REQUIRED.json', 'RUNNING.lock', 'STOP', 'activation.json', 'admission-policy.json', 'agent.config.json', 'application.lock', 'capability-ledger.json', 'commissioning.json', 'config.json', 'device-key.pem', 'funding-policy.json', 'gateway-token.txt', 'issuer-private.pem', 'monitor-access.json', 'native-config.json', 'node.config.json', 'openclaw.json', 'panel.json', 'pilot.json', 'private-key.json', 'process.lock', 'recovered-commissioning.json', 'release-profile.json', 'restore-in-progress.json', 'review-funding-policy.json', 'review-protection-policy.json', 'setup-progress.json', 'unretained-review-policy.json', 'vault.json']
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
 if 'node_modules' in record.parts:continue
 try:data=json.loads(record.read_text())
 except (ValueError,UnicodeError):continue
 if isinstance(data,dict) and (data.get('purpose') in {'agi-node-backup/v2','agi-agent-backup/v2'} or isinstance(data.get('schema'),str) and data.get('schema') in {'agi-native-job/v1','agi-native-project/v1','agi-native-config/v1','agi-native-receipt/v1','agi-native-authority/v1','agi-project-repair/v1'} or isinstance(data.get('header'),dict) and data['header'].get('schema')=='agi-private-envelope/v1'):
  raise SystemExit('Private operator record found: '+str(record.relative_to(root)))
for dep in ['hardhat','solc','marked']:
 if (root/'node_modules'/dep).exists():raise SystemExit('Development dependency in production package: '+dep)
for item in root.rglob('*'):
 if item.is_symlink():raise SystemExit('Links must be materialized before packaging: '+str(item.relative_to(root)))
 if not item.is_dir() and not item.is_file():raise SystemExit('Special filesystem object in package: '+str(item.relative_to(root)))
 if item.is_file() and item.stat().st_nlink!=1:raise SystemExit('Hard links are not packaged: '+str(item.relative_to(root)))

files=[]
for f in sorted(root.rglob('*'),key=lambda item:item.relative_to(root).as_posix()):
 if any(part in {'__pycache__','.pytest_cache','.git'} for part in f.parts) or f.suffix=='.pyc':continue
 if not f.is_file():continue
 assert not f.is_symlink() and f.resolve().is_relative_to(root)
 assert f.name not in blocked and not f.name.endswith(tuple(ext+tail for ext in ('.sqlite','.sqlite3') for tail in ('','-wal','-shm','-journal'))+('-private.pem','.encrypted','.encrypted.json','.agiagentbackup','.aginodebackup'))
 if any(x in f.parts for x in ['admission','funding']) and ('inbox' in f.parts or 'evidence' in f.parts):raise SystemExit('Private admission/funding state in package')
 if f==root/'MANIFEST.sha256':continue
 with f.open('rb')as src:assert src.read(16)!=b'SQLite format 3\0'
 files.append(f)
manifest=''.join(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+f.relative_to(root).as_posix()+'\n' for f in files);(root/'MANIFEST.sha256').write_text(manifest);files.append(root/'MANIFEST.sha256')
for dep in ['ethers','ajv']:assert (root/'node_modules'/dep/'package.json').exists()
prefix=registry[role]['package']+'_Private_v'+version;out.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9)as z:
 for f in sorted(files):
  info=zipfile.ZipInfo(prefix+'/'+f.relative_to(root).as_posix(),date_time=datetime.datetime.fromtimestamp(int(os.environ.get('SOURCE_DATE_EPOCH','1791244800')),datetime.timezone.utc).timetuple()[:6]);info.create_system=3;info.external_attr=(stat.S_IFREG|(0o755 if os.access(f,os.X_OK) else 0o644))<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,f.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(out)as z:
 assert z.testzip()is None
 for line in manifest.splitlines():
  sha,name=line.split('  ',1);assert hashlib.sha256(z.read(prefix+'/'+name)).hexdigest()==sha
print(json.dumps({'file':str(out),'version':version,'files':len(files),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'crcVerified':True,'allManifestsVerified':True},indent=2))

from final_archive_gate import validate_final_archive
validate_final_archive(out, root / "scripts")
