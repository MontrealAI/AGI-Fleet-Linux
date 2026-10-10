from pathlib import Path
import argparse,hashlib,json,shutil

p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--check',action='store_true');a=p.parse_args();root=a.root.resolve();canonical=root/'shared/runtime'
roles=json.loads((root/'config/role-registry.json').read_text())['roles'];report={}
files={f.relative_to(canonical).as_posix():f for f in canonical.rglob('*') if f.is_file() and '__pycache__' not in f.parts and f.suffix!='.pyc'}
for role,c in roles.items():
 app=root/'packages'/c['package'];dest=app/'shared/runtime'
 if not app.exists():continue
 if not a.check:
  if dest.exists():shutil.rmtree(dest)
  shutil.copytree(canonical,dest)
  for name,f in files.items():
   if not name.startswith('compute/'):continue
   relative=name[len('compute/'):];target=app/'compute'/relative;target.parent.mkdir(parents=True,exist_ok=True)
   if '/' not in relative and relative.endswith('.mjs'):
    target.write_text("import '../shared/runtime/compute/bootstrap-entry.mjs';\nexport * from '../shared/runtime/compute/"+relative+"';\n")
   else:shutil.copyfile(f,target)
 for name,f in files.items():
  target=dest/name
  assert target.is_file() and not target.is_symlink() and target.read_bytes()==f.read_bytes(),(role,name,'shared-runtime-divergence')
 for name,f in files.items():
  if not name.startswith('compute/'):continue
  rel=name[len('compute/'):];target=app/'compute'/rel
  expected=("import '../shared/runtime/compute/bootstrap-entry.mjs';\nexport * from '../shared/runtime/compute/"+rel+"';\n").encode() if '/' not in rel and rel.endswith('.mjs') else f.read_bytes()
  assert target.is_file() and target.read_bytes()==expected,(role,rel,'shared-entry-divergence')
 report[role]={'sharedFiles':len(files),'byteEquivalent':True,'entryAdaptersEquivalent':True}
manifest={'schema':'agi-shared-runtime-inventory/v1','runtimeVersion':'1.0.0','files':[{'path':name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for name,f in sorted(files.items())]}
manifest['revisionSHA256']=hashlib.sha256(json.dumps(manifest['files'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
if not a.check:(root/'shared/runtime-inventory.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'roles':report,'sharedRevisionSHA256':manifest['revisionSHA256']},indent=2))
