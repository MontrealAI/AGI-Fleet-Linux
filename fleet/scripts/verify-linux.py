#!/usr/bin/env python3
"""Read-only verification of the complete extracted Linux Fleet package."""
import hashlib,json,pathlib,re,stat,sys
root=pathlib.Path(__file__).resolve().parents[1]
def need(v,m):
 if not v:raise ValueError(m)
def digest(p):
 with p.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def main():
 registry=json.loads((root/'config/role-registry.json').read_text())['roles'];apps=[root,*[root/'packages'/x['package'] for x in registry.values()]];checked=0
 for app in apps:
  expected={}
  for line in (app/'MANIFEST.sha256').read_text().splitlines():
   h,n=line.split('  ',1);p=pathlib.PurePosixPath(n);need(re.fullmatch('[a-f0-9]{64}',h) and not p.is_absolute() and all(x not in ('','..','.') for x in n.split('/')) and n not in expected,'Invalid manifest');expected[n]=h
  actual={p.relative_to(app).as_posix():p for p in app.rglob('*') if p.is_file() and p!=app/'MANIFEST.sha256' and '__pycache__' not in p.parts and p.suffix!='.pyc'}
  need(set(expected)==set(actual),'Manifest coverage differs')
  for n,h in expected.items():
   p=actual[n];need(not p.is_symlink() and stat.S_ISREG(p.stat().st_mode) and p.stat().st_size<450000000 and digest(p)==h,'File differs: '+n);checked+=1
  inventory=json.loads((app/'source-inventory.json').read_text());records=inventory['files'];need(hashlib.sha256(json.dumps(records,sort_keys=True,separators=(',',':')).encode()).hexdigest()==inventory['revisionSHA256'],'Source identity differs')
  for item in records:need(digest(app/item['path'])==item['sha256'] and bool((app/item['path']).stat().st_mode&0o111)==item['executable'],'Source bytes or executable mode differ')
 print(json.dumps({'status':'PASS','manifestEntriesVerified':checked,'editions':len(apps),'maximumFileBytesExclusive':450000000,'qualification':'Integrity only; native installation acceptance is separate.'},indent=2))
if __name__=='__main__':
 try:main()
 except (OSError,ValueError,KeyError) as e:print('Verification failed: '+str(e),file=sys.stderr);sys.exit(1)
