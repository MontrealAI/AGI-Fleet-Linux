#!/usr/bin/env python3
"""Rebuild downloadable editable sources extracted from the exact saved archive."""
import argparse, hashlib, json, os, re, subprocess, tempfile, zipfile
from pathlib import Path

def require(condition, message):
    if not condition:
        raise ValueError(message)

def portable_counts(output):
    rows=re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$',output,re.M)
    counts={name:int(value) for name,value in rows}
    require(len(rows)==6 and counts=={'tests':17,'pass':17,'fail':0,'cancelled':0,'skipped':0,'todo':0},output)
    return counts

def check(archive, node):
    with tempfile.TemporaryDirectory(prefix='successor-rebuild-') as temp:
        root=Path(temp)
        with zipfile.ZipFile(archive) as z:
            prefix=z.namelist()[0].split('/')[0]
            base=prefix+'/docs/successor/'
            source=root/'source.zip';source.write_bytes(z.read(base+'SUCCESSOR-Omega-Fleet-source.zip'))
            pages={lang:z.read(base+'My-SUCCESSOR-Omega-'+lang+'.html') for lang in ('en','fr')}
            for role in ('Agent','Node','Moderator','Employer','Evidence','Recovery'):
                for lang,data in pages.items():
                    require(z.read(prefix+'/packages/AGI_'+role+'/docs/successor/My-SUCCESSOR-Omega-'+lang+'.html')==data,'Role edition differs: '+role+'/'+lang)
        extracted=root/'source';extracted.mkdir()
        with zipfile.ZipFile(source) as z:
            require(sum(i.file_size for i in z.infolist())<8*1024*1024,'Editable source archive exceeds size bound')
            for i in z.infolist():
                p=Path(i.filename)
                require(not p.is_absolute() and all(x not in ('..','.') for x in p.parts),'Unsafe editable source path')
            z.extractall(extracted)
        # upstream sourceZip places files below SUCCESSOR-Omega-source/
        candidates=list(extracted.rglob('build.mjs'))
        builds=[p for p in candidates if 'vendor' not in p.relative_to(extracted).parts]
        require(len(builds)==1,'Expected exactly one editable source builder')
        source_root=builds[0].parent
        result=subprocess.run([node,str(builds[0]),'--out',str(root/'rebuilt')],capture_output=True,text=True)
        require(result.returncode==0,result.stderr)
        for lang,data in pages.items():require((root/'rebuilt'/('My-SUCCESSOR-Omega-'+lang+'.html')).read_bytes()==data,'Editable rebuild differs: '+lang)
        test=subprocess.run([node,'--test','--test-reporter=tap',str(source_root/'vendor/manager/scripts/successor/portable.test.mjs')],capture_output=True,text=True)
        require(test.returncode==0,test.stdout+test.stderr)
        counts=portable_counts(test.stdout)
        return {'schema':'agi-fleet/successor-archive-check/v1','status':'PASS','archiveSHA256':hashlib.file_digest(open(archive,'rb'),'sha256').hexdigest(),'editionCopies':7,'languages':['en','fr'],'editableSourceRebuild':'BYTE_IDENTICAL','freshPortableTests':counts['tests'],'authority':'none'}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--archive',required=True);p.add_argument('--node',default='node');p.add_argument('--out',required=True);a=p.parse_args();value=check(a.archive,a.node);Path(a.out).write_text(json.dumps(value,indent=2)+'\n');print(json.dumps(value))
