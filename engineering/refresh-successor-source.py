#!/usr/bin/env python3
"""Materialize current edition welcome sources and refresh the reviewed inventory.

Run only after reviewing changes. This does not qualify or publish anything.
"""
import hashlib,importlib.util,json,shutil,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
builder=module('builder',ROOT/'engineering/build-next-release.py')
preparation=module('preparation',ROOT/'fleet/scripts/prepare-release.py')
spec=json.loads((ROOT/'engineering/next-release.json').read_text());source=ROOT/'fleet'
prior=json.loads((source/'source-inventory.json').read_text())
with tempfile.TemporaryDirectory(prefix='fleet-welcome-') as temporary:
    stage=Path(temporary);(stage/'config').mkdir();shutil.copyfile(source/'config/role-registry.json',stage/'config/role-registry.json');(stage/'NOTICE.md').write_text('Temporary root notice, not copied into the mirror.\n')
    builder.add_operator_guides(stage,ROOT,spec['version'],subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip())
    for row in prior['files']:
        relative=Path(row['path'])
        if len(relative.parts)==3 and relative.parts[0]=='packages' and relative.name in ('README.md','README.html','START_HERE.md','START_HERE.html','Linux-Guide.html','Linux-Guide.txt','READ_ME_FIRST.txt'):
            shutil.copyfile(stage/relative,source/relative)
records=[{'path':name,'sha256':preparation.file_sha(file),'executable':bool(file.stat().st_mode&0o111)} for name,file in preparation.tree_files(source,preparation.source_path).items()]
prior['files']=records;prior['revisionSHA256']=hashlib.sha256(json.dumps(records,sort_keys=True,separators=(',',':')).encode()).hexdigest()
(source/'source-inventory.json').write_text(json.dumps(prior,indent=2)+'\n')
spec['sourceFiles']=len(records);spec['sourceRevisionSHA256']=prior['revisionSHA256'];(ROOT/'engineering/next-release.json').write_text(json.dumps(spec,indent=2)+'\n')
print(json.dumps({'sourceFiles':len(records),'sourceRevisionSHA256':prior['revisionSHA256']}))
