#!/usr/bin/env python3
"""Rebuild downloadable editable sources extracted from the exact saved archive."""
import argparse, hashlib, json, os, re, subprocess, tempfile, zipfile
from pathlib import Path

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
                    assert z.read(prefix+'/packages/AGI_'+role+'/docs/successor/My-SUCCESSOR-Omega-'+lang+'.html')==data
        extracted=root/'source';extracted.mkdir()
        with zipfile.ZipFile(source) as z:
            assert sum(i.file_size for i in z.infolist())<8*1024*1024
            for i in z.infolist():
                p=Path(i.filename)
                assert not p.is_absolute() and all(x not in ('..','.') for x in p.parts)
            z.extractall(extracted)
        # upstream sourceZip places files below SUCCESSOR-Omega-source/
        candidates=list(extracted.rglob('build.mjs'))
        builds=[p for p in candidates if 'vendor' not in p.relative_to(extracted).parts]
        assert len(builds)==1
        source_root=builds[0].parent
        result=subprocess.run([node,str(builds[0]),'--out',str(root/'rebuilt')],capture_output=True,text=True)
        assert result.returncode==0,result.stderr
        for lang,data in pages.items():assert (root/'rebuilt'/('My-SUCCESSOR-Omega-'+lang+'.html')).read_bytes()==data,'Editable rebuild differs: '+lang
        test=subprocess.run([node,'--test','--test-reporter=tap',str(source_root/'vendor/manager/scripts/successor/portable.test.mjs')],capture_output=True,text=True)
        assert test.returncode==0,test.stdout+test.stderr
        counts={name:int(value) for name,value in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$',test.stdout,re.M)}
        assert counts=={'tests':13,'pass':13,'fail':0,'cancelled':0,'skipped':0,'todo':0},test.stdout
        return {'schema':'agi-fleet/successor-archive-check/v1','status':'PASS','archiveSHA256':hashlib.file_digest(open(archive,'rb'),'sha256').hexdigest(),'editionCopies':7,'languages':['en','fr'],'editableSourceRebuild':'BYTE_IDENTICAL','freshPortableTests':counts['tests'],'authority':'none'}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--archive',required=True);p.add_argument('--node',default='node');p.add_argument('--out',required=True);a=p.parse_args();value=check(a.archive,a.node);Path(a.out).write_text(json.dumps(value,indent=2)+'\n');print(json.dumps(value))
