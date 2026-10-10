from pathlib import Path
import argparse,hashlib,json,shutil
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--check',action='store_true');a=p.parse_args();root=a.root.resolve();lib=root/'shared/operator';roles=json.loads((root/'config/role-registry.json').read_text())['roles'];results={}
files={f.relative_to(lib).as_posix():f for f in lib.rglob('*') if f.is_file() and '__pycache__' not in f.parts}
for role,app in [('fleet',root),*[(role,root/'packages'/c['package']) for role,c in roles.items() if role not in ('agent','node')]]:
 dest=app/'shared/operator'
 if not a.check and app!=root:
  if dest.exists():shutil.rmtree(dest)
  shutil.copytree(lib,dest)
 for name,f in files.items():assert (dest/name).read_bytes()==f.read_bytes(),(role,name,'shared-operator-divergence')
 if a.check:
  observed={f.relative_to(dest).as_posix() for f in dest.rglob('*') if f.is_file() and '__pycache__' not in f.parts and f.suffix!='.pyc'}
  assert observed==set(files),(role,'unexpected-shared-library-members',sorted(observed.symmetric_difference(files)))
 for name,f in files.items():
  if not name.startswith('ops/') or name in ('ops/consumer.mjs','ops/bootstrap-entry.mjs'):continue
  relative=name[4:];target=app/'ops'/relative;target.parent.mkdir(parents=True,exist_ok=True)
  expected="import '../shared/operator/ops/bootstrap-entry.mjs';\nexport * from '../shared/operator/ops/"+relative+"';\n"
  if not a.check:target.write_text(expected)
  assert target.read_text()==expected,(role,relative,'operator-entry-divergence')
 results[role]={'sharedFiles':len(files),'byteEquivalent':True}
print(json.dumps({'roles':results},indent=2))
