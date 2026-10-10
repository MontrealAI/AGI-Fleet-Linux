#!/usr/bin/env python3
from pathlib import Path
from urllib.parse import quote
import json,hashlib,uuid,datetime,os,argparse
parser=argparse.ArgumentParser(description='Inventory the actual bundled production npm installations without registry access.')
parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
parser.add_argument('--epoch',type=int,required=True)
args=parser.parse_args()
ROOT=args.root.resolve()
TIME=datetime.datetime.fromtimestamp(args.epoch,datetime.timezone.utc).isoformat().replace('+00:00','Z')
sha=lambda b:hashlib.sha256(b).hexdigest()
def package_hash(directory):
 rows=[]
 for p in sorted(directory.rglob('*')):
  if not p.is_file() or p.is_symlink():continue
  rel=p.relative_to(directory).as_posix()
  if 'node_modules' in Path(rel).parts:continue
  rows.append([rel,sha(p.read_bytes())])
 return sha(json.dumps(rows,separators=(',',':'),ensure_ascii=False).encode()),len(rows)
def build(destination,apps):
 components=[];dependencies=[];all_refs=set();app_refs=[]
 for role,app in apps:
  pkg=json.loads((app/'package.json').read_text());lock=json.loads((app/'package-lock.json').read_text());app_ref='application:'+role;app_refs.append(app_ref)
  properties=[{'name':'agi:installation-path','value':'.' if app==destination else app.relative_to(destination).as_posix()},{'name':'agi:package-json-sha256','value':sha((app/'package.json').read_bytes())}]
  application={'type':'application','bom-ref':app_ref,'name':pkg['name'],'version':pkg['version'],'properties':properties}
  if app==destination:main=application
  else:components.append(application)
  installed={}
  for loc,record in lock['packages'].items():
   p=app/loc/'package.json'
   if not loc or not p.is_file():continue
   if record.get('dev'):continue
   meta=json.loads(p.read_text());assert meta['version']==record['version'],loc
   ref=role+':'+loc;installed[loc]=(ref,meta)
  missing=[loc for loc,meta in lock['packages'].items() if loc and not meta.get('dev',False) and loc not in installed]
  assert not missing,missing
  def resolve(name,location=''):
   parts=Path(location).parts
   current=app/location if location else app
   while True:
    candidate=(current/'node_modules'/name).relative_to(app).as_posix()
    if candidate in installed:return installed[candidate][0]
    if current==app:break
    current=current.parent
   raise AssertionError((location,name,'missing installed dependency'))
  dependencies.append({'ref':app_ref,'dependsOn':sorted(resolve(name) for name in pkg.get('dependencies',{}))})
  for loc,(ref,meta) in installed.items():
   directory=app/loc;record=lock['packages'][loc];tree,count=package_hash(directory)
   component={'type':'library','bom-ref':ref,'name':meta['name'],'version':meta['version'],'scope':'required','purl':'pkg:npm/'+quote(meta['name'],safe='/')+'@'+quote(meta['version'],safe='.'),'properties':[{'name':'agi:installation-path','value':(directory.relative_to(destination)).as_posix()},{'name':'agi:package-json-sha256','value':sha((directory/'package.json').read_bytes())},{'name':'agi:installed-tree-sha256','value':tree},{'name':'agi:installed-file-count','value':str(count)},{'name':'agi:installed-tree-hash-format','value':'SHA-256 of compact UTF-8 JSON array of [relative POSIX path, file SHA-256] pairs, sorted by path; excludes nested node_modules and symlinks.'},{'name':'agi:inventory-source','value':'bundled package.json plus production entries in package-lock.json; no registry query'},{'name':'agi:lock-integrity','value':record.get('integrity','not recorded')}]}
   license=meta.get('license')
   if isinstance(license,str):component['licenses']=[{'license':{'id':license}}]
   if record.get('resolved'):component['externalReferences']=[{'type':'distribution','url':record['resolved'],'comment':'Lockfile source URL; not a claim that the registry was queried during this build.'}]
   components.append(component);dependencies.append({'ref':ref,'dependsOn':sorted(resolve(name,loc) for name in meta.get('dependencies',{}))})
  all_refs.update(x[0] for x in installed.values());all_refs.add(app_ref)
 if len(app_refs)>1:
  next(x for x in dependencies if x['ref']==app_refs[0])['dependsOn']+=app_refs[1:]
 scope='Included npm production dependency installations only. Excludes development tools absent from the delivered node_modules, external Node binaries, Docker Desktop, installed OpenClaw, operating-system packages, and built container contents. License declarations are recorded from package metadata. No vulnerability scan, publisher signature, live service qualification, or supplier attestation is implied.'
 basis=json.dumps({'main':main,'components':components,'dependencies':dependencies},sort_keys=True,separators=(',',':'))
 bom={'bomFormat':'CycloneDX','specVersion':'1.5','serialNumber':'urn:uuid:'+str(uuid.uuid5(uuid.NAMESPACE_URL,'agi-sbom:'+sha(basis.encode()))),'version':1,'metadata':{'timestamp':TIME,'component':main,'properties':[{'name':'agi:scope','value':scope},{'name':'agi:integrity-method','value':'Installed-file inventories plus lockfile integrity are recorded separately; lockfile tarball integrity is not misrepresented as an installed-tree checksum.'},{'name':'agi:reproducibility','value':'Regenerate from the exact delivered package tree and lockfiles; SOURCE_DATE_EPOCH controls the metadata timestamp.'}]},'components':components,'dependencies':dependencies}
 references={bom['metadata']['component']['bom-ref']}|{x['bom-ref'] for x in components}
 assert len(references)==len(components)+1
 for d in dependencies:assert d['ref'] in references and all(x in references for x in d['dependsOn'])
 out=destination/'docs/SBOM.cdx.json';out.write_text(json.dumps(bom,indent=2,ensure_ascii=False)+'\n')
 return {'file':str(out),'applications':len(apps),'npmInstallations':sum(x['type']=='library' for x in components),'sha256':sha(out.read_bytes()),'timestamp':TIME}
registry=json.loads((ROOT/'config/role-registry.json').read_text())['roles']
roles=[('fleet',ROOT),*[(role,ROOT/'packages'/c['package']) for role,c in registry.items()]]
reports=[build(ROOT,roles)]
reports.extend(build(app,[(role,app)]) for role,app in roles if role!='fleet')
print(json.dumps(reports,indent=2))
