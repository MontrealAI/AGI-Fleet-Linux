#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Verify and extract an exact Git review-source ZIP; no installer claim."""
import hashlib,json,pathlib,stat,subprocess,sys,zipfile

repo,commit,archive_name,destination_name,report_name,origin=sys.argv[1:]
archive=pathlib.Path(archive_name).resolve();destination=pathlib.Path(destination_name).resolve()
report=pathlib.Path(report_name).resolve()
assert not destination.exists() and not report.exists(), 'Preserve earlier evidence'
git=lambda *args:subprocess.check_output(['git','-C',repo,*args])
assert git('rev-parse',commit).decode().strip()==commit
tree=git('rev-parse',commit+'^{tree}').decode().strip()
expected={}
for record in git('ls-tree','-rz',commit).split(b'\0'):
    if not record:continue
    header,name=record.split(b'\t',1);mode,kind,blob=header.decode().split()
    assert kind=='blob' and mode in ('100644','100755'), 'Only ordinary source files are supported'
    expected[name.decode()]={'mode':mode,'gitBlob':blob}
expected_dirs={parent.as_posix()+'/' for name in expected for parent in pathlib.PurePosixPath(name).parents if parent.as_posix()!='.'}
digest=hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()
observed={};directories=set();total=0
with zipfile.ZipFile(archive) as source:
    assert source.comment.decode()==commit, 'ZIP comment must bind the tested commit'
    infos=source.infolist();assert len({i.filename for i in infos})==len(infos), 'Duplicate ZIP member'
    for item in infos:
        name=item.filename;parts=pathlib.PurePosixPath(name).parts
        assert parts and not name.startswith('/') and '\\' not in name and all(part not in ('.','..') for part in parts)
        if item.is_dir():directories.add(name);continue
        assert name in expected, 'Unexpected archive member '+name
        attrs=item.external_attr>>16
        mode='100644' if attrs==0 else '100755' if stat.S_ISREG(attrs) and stat.S_IMODE(attrs)==0o755 else None
        assert mode==expected[name]['mode'], 'Archive member mode changed '+name
        data=source.read(item);total+=len(data)
        blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
        assert blob==expected[name]['gitBlob'], 'Git blob mismatch '+name
        observed[name]={'gitBlob':blob,'mode':mode,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    assert set(observed)==set(expected) and directories==expected_dirs, 'Archive must cover the exact Git tree'
    destination.mkdir()
    for item in infos:
        target=destination/item.filename
        if item.is_dir():target.mkdir(parents=True,exist_ok=True);continue
        target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(source.read(item))
        target.chmod(0o755 if observed[item.filename]['mode']=='100755' else 0o644)
for name,record in observed.items():
    target=destination/name
    assert target.is_file() and not target.is_symlink()
    assert hashlib.file_digest(target.open('rb'),'sha256').hexdigest()==record['sha256']
discovery={name:record for name,record in observed.items() if name.startswith('discovery-lab/') or name=='engineering/tests/test_discovery_lab.py'}
data={'schema':'agi-fleet/local-review-archive-verification/v1','repository':'MontrealAI/AGI-Fleet-Linux',
    'commit':commit,'tree':tree,'archive':str(archive),'archiveBytes':archive.stat().st_size,'archiveSha256':digest,
    'origin':origin,'zipCommitCommentVerified':True,'files':len(observed),'directories':len(directories),
    'uncompressedBytes':total,'allGitBlobsVerified':True,'allExtractedBytesVerified':True,
    'extraction':str(destination),'discoverySources':discovery,
    'scope':'Exact distributable Git review source. Direct local review only; no operator installer, qualified release, or remotely provisioned execution.',
    'productionQualified':False,'releaseEligible':False,'remoteExecution':'unprovisioned'}
report.write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({key:data[key] for key in ('commit','tree','archiveSha256','archiveBytes','files','directories','origin')}))
