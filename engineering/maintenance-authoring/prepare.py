import hashlib, importlib.util, json, pathlib, plistlib, re, subprocess, sys
ROOT=pathlib.Path(sys.argv[1]).resolve(strict=True)
OLD='1.1.0'; NEW='1.1.1'; BASE_TREE='9cde3e1ce5dc0ec5a34862c7d31b671559f42811'
assert subprocess.check_output(['git','rev-parse','HEAD^{tree}'],cwd=ROOT,text=True).strip()==BASE_TREE
base_inventory=json.loads((ROOT/'fleet/source-inventory.json').read_text())
before={row['path']:(ROOT/'fleet'/row['path']).read_bytes() for row in base_inventory['files']}

def dump(file,data):file.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
def replace(file,old,new,count=None):
    path=ROOT/file;text=path.read_text()
    if count is not None:assert text.count(old)==count,(file,old,text.count(old))
    assert old in text,(file,old)
    path.write_text(text.replace(old,new))

editions=[ROOT/'fleet',*sorted((ROOT/'fleet/packages').glob('AGI_*'))]
roles=['fleet','agent','node','moderator','employer','evidence','recovery']
assert len(editions)==7
for app in editions:
    for filename in ('package.json','package-lock.json'):
        p=app/filename;data=json.loads(p.read_text()); assert data['version']==OLD; data['version']=NEW
        if filename=='package-lock.json': assert data['packages']['']['version']==OLD;data['packages']['']['version']=NEW
        dump(p,data)
    p=app/'config/companion-releases.json';data=json.loads(p.read_text())
    for role in roles:assert data[role]==OLD;data[role]=NEW
    dump(p,data)
    p=app/'config/role-registry.json'
    if p.is_file():
        data=json.loads(p.read_text());assert data['fleet']==OLD;data['fleet']=NEW
        for role in data['roles'].values():assert role['version']==OLD;role['version']=NEW
        dump(p,data)
    for p in app.glob('*.app/Contents/Info.plist'):
        data=plistlib.loads(p.read_bytes());assert data['CFBundleVersion']==data['CFBundleShortVersionString']==OLD
        data['CFBundleVersion']=data['CFBundleShortVersionString']=NEW;p.write_bytes(plistlib.dumps(data,sort_keys=False))
    for name in ('app/index.html','web/index.html'):
        p=app/name
        if p.is_file():
            s=p.read_text().replace('id="appVersion">'+OLD+'<','id="appVersion">'+NEW+'<')
            s=s.replace('/AGI-Fleet-Linux/blob/v'+OLD+'-qualification/','/AGI-Fleet-Linux/blob/v'+NEW+'-qualification/')
            p.write_text(s)

spec=importlib.util.spec_from_file_location('candidate_builder',ROOT/'engineering/build-next-release.py')
builder=importlib.util.module_from_spec(spec);sys.path.insert(0,str(ROOT/'engineering'));spec.loader.exec_module(builder)
for app in editions[1:]:
    role=app.name.removeprefix('AGI_').lower()
    welcome=(app/'README.md').read_text().replace('AGI Fleet Linux '+OLD,'AGI Fleet Linux '+NEW)
    for name in ('README.md','START_HERE.md'):(app/name).write_text(welcome)
    rendered=builder.render_markdown(welcome).replace('<body>','<body><span id="agi-fleet-linux-1011"></span>')
    for name in ('README.html','START_HERE.html','Linux-Guide.html'):(app/name).write_text(rendered)
    (app/'Linux-Guide.txt').write_text(builder.plain_text_guide(NEW,role))
    (app/'READ_ME_FIRST.txt').write_text(f'AGI Fleet Linux {NEW}\nOpen START_HERE.html for the current Linux installation and qualification guide.\nProduction and physical qualification remain pending.\n')

for file in ('.github/workflows/next-release.yml','engineering/publish-next-release.py','engineering/tests/test_next_publication.py','engineering/tests/test_publication_note_race.py','docs/FRESH_INSTALL.md','docs/TROUBLESHOOTING.md','docs/PHYSICAL_QUALIFICATION.md','docs/DEVELOPMENT.md','engineering/README.md'):
    path=ROOT/file;s=path.read_text().replace(OLD,NEW).replace('RELEASE_NOTES_1_1_0.md','RELEASE_NOTES_1_1_1.md');path.write_text(s)
replace('engineering/publish-next-release.py','(2026, 10, 13, 0, 0, 0)','(2026, 10, 14, 0, 0, 0)',1)
p=ROOT/'docs/physical-qualification-template.json';data=json.loads(p.read_text());assert data['release']==OLD;data['release']=NEW;dump(p,data)
frozen='https://github.com/MontrealAI/AGI-Fleet-Linux/blob/v1.1.0-qualification/docs/FRESH_INSTALL.md'
for file in ('docs/START_HERE.md','docs/COMMENCER_ICI.md'):
    p=ROOT/file;s=p.read_text().replace('](FRESH_INSTALL.md)',']('+frozen+')')
    if file.endswith('START_HERE.md'):
        s+='\n## Preparing Linux 1.1.1\n\nThe current source prepares the **Linux 1.1.1 maintenance candidate**. Use its [version-matched installation guide](FRESH_INSTALL.md) only after that exact archive has passed the complete publication gates. The published Linux 1.1.0 links above deliberately remain tied to the prior verified release; do not mix the two sets of commands. [Maintenance scope and acceptance](RELEASE_NOTES_1_1_1.md).\n'
    else:
        s+='\n## Préparation de Linux 1.1.1\n\nLes sources actuelles préparent la **préversion de maintenance Linux 1.1.1**. Utilisez son [guide d’installation correspondant](FRESH_INSTALL.md) uniquement après la réussite de toutes les vérifications de publication de cette archive précise. Les liens Linux 1.1.0 ci-dessus restent volontairement liés à la publication antérieure vérifiée; ne mélangez pas les commandes des deux versions. [Portée et acceptation de la maintenance](RELEASE_NOTES_1_1_1.md).\n'
    p.write_text(s)
replace('README.md','# AGI Fleet · Linux & Apple silicon Mac\n','# AGI Fleet · Linux & Apple silicon Mac\n\n**Linux 1.1.1 maintenance candidate:** the current source prepares clearer English/French guidance and safer release publication. [Scope and qualification requirements](docs/RELEASE_NOTES_1_1_1.md). It is not downloadable as an operator release until its own tagged publication passes. Published Linux 1.1.0 remains separate; use its [frozen installation guide]('+frozen+'), not commands for the new candidate.\n',1)
replace('docs/FRESH_INSTALL.md','Historical 1.0.9 results do not qualify changed 1.1.1 source.','Historical 1.0.9 or 1.1.0 results do not qualify this new archive. If the 1.1.1 release or its exact acceptance evidence is absent, stop: this source guide is not permission to install an unpublished candidate. The prior 1.1.0 guide remains available at its frozen release tag.',1)
replace('engineering/build-next-release.py',"def render_markdown(text, back='START_HERE.html'):","def render_markdown(text, back='START_HERE.html', *, language='en'):",1)
replace('engineering/build-next-release.py','    lines, result, paragraph = text.splitlines(), [], []',"    require(language in ('en', 'fr'), 'Unsupported guide language')\n    navigation = 'Commencer ici' if language == 'fr' else 'Start here'\n    lines, result, paragraph = text.splitlines(), [], []",1)
replace('engineering/build-next-release.py',"return '<!doctype html><html lang=\"en\"><head>","return '<!doctype html><html lang=\"' + language + '\"><head>",1)
replace('engineering/build-next-release.py',"+ '\">Start here</a></nav>'", "+ '\">' + navigation + '</a></nav>'",1)
replace('engineering/build-next-release.py',"destination.with_suffix('.html').write_text(render_markdown(text, back))", "destination.with_suffix('.html').write_text(render_markdown(text, back,\n                language='fr' if relative.as_posix() == 'docs/COMMENCER_ICI.md' else 'en'))",1)
records=[];changed=[]
for row in base_inventory['files']:
    path=ROOT/'fleet'/row['path']; b=path.read_bytes(); new={**row,'sha256':hashlib.sha256(b).hexdigest()};records.append(new)
    if before[row['path']]!=b:changed.append({'path':row['path'],'beforeSHA256':row['sha256'],'afterSHA256':new['sha256']})
assert len(records)==5914
inventory={**base_inventory,'files':records,'revisionSHA256':hashlib.sha256(json.dumps(records,sort_keys=True,separators=(',',':')).encode()).hexdigest()}
dump(ROOT/'fleet/source-inventory.json',inventory)
p=ROOT/'engineering/next-release.json';data=json.loads(p.read_text())
data.update(version=NEW,tag='v'+NEW+'-qualification',prefix='AGI_Fleet_Linux_v'+NEW,name='AGI_Fleet_Linux_v'+NEW+'.zip',sourceDateEpoch=1791936000,sourceRevisionSHA256=inventory['revisionSHA256']);dump(p,data)
receipt={'schema':'agi-linux-maintenance-scope/v1','version':NEW,'basisCommit':'770666eaa79791d79f7fa00175c43a052dcc11d2','basisTree':BASE_TREE,'basisSourceRevisionSHA256':base_inventory['revisionSHA256'],'candidateSourceRevisionSHA256':inventory['revisionSHA256'],'sourceFiles':len(records),'changedSourceFiles':changed,'runtimeLogicChanged':False,'dependencyVersionsChanged':False,'contractArtifactsChanged':False,'productionQualified':False,'localSkillsIncluded':False}
dump(ROOT/'engineering/linux-1.1.1-maintenance-scope.json',receipt)
HERE=pathlib.Path(__file__).resolve().parent
(ROOT/'docs/RELEASE_NOTES_1_1_1.md').write_bytes((HERE/'notes.md').read_bytes())
(ROOT/'engineering/tests/test_maintenance_release.py').write_bytes((HERE/'test_maintenance_release.py').read_bytes())
subprocess.run([sys.executable,str(ROOT/'macos/preview/check.py'),'--write-inventory'],cwd=ROOT,check=True)
print(json.dumps({'sourceRevision':inventory['revisionSHA256'],'sourceFiles':len(records),'changedSourceFiles':len(changed)},indent=2))
