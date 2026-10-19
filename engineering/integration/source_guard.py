"""Bind the installed importable source closure to exact Git objects before execution."""
import hashlib
import os
from pathlib import Path
import re
import subprocess

IMPORTABLE={'.py','.pyw','.so','.pyd','.mjs','.js','.json'}
ALPHA_SCOPES=[('alpha_factory_v1',False),('alpha_factory_v1/core',False),('alpha_factory_v1/core/runtime',True),('examples/successor-alpha',True),('examples/successor-workbench',True),('examples/build-successor',True),('examples/alpha-discovery',True),('docs/assets/successor',True)]
JOBS_SCOPES=[('packages/successor-core/src',True),('scripts/pages',False),('website/assets',False),('integrations/alpha-agent',False)]


def git(root,*arguments):
    return subprocess.check_output(['git',*arguments],cwd=root,timeout=30)


def verify_tree(root,scopes):
    root=Path(root).resolve(strict=True)
    commit=git(root,'rev-parse','HEAD').decode().strip()
    tracked=set(git(root,'ls-tree','-r','--name-only',commit).decode().splitlines())
    paths=set()
    for relative,recursive in scopes:
        directory=root/relative
        if not directory.is_dir() or directory.is_symlink():raise ValueError('SOURCE_SCOPE_LINK_OR_MISSING')
        for current,directories,files in os.walk(directory,followlinks=False):
            for name in list(directories):
                child=Path(current)/name
                if child.is_symlink():raise ValueError('SOURCE_LINK')
                if name=='__pycache__':directories.remove(name)
            for name in files:
                file=Path(current)/name
                if file.is_symlink():raise ValueError('SOURCE_LINK')
                if file.suffix in IMPORTABLE:paths.add(file)
            if not recursive:directories.clear()
    snapshot={}
    for file in sorted(paths):
        relative=file.relative_to(root).as_posix()
        if relative not in tracked:raise ValueError('SOURCE_UNTRACKED_IMPORTABLE')
        if not file.is_file() or file.resolve(strict=True)!=file:raise ValueError('SOURCE_FILE_OR_PARENT_LINK')
        actual=file.read_bytes();expected=git(root,'show',commit+':'+relative)
        if actual!=expected:raise ValueError('SOURCE_GIT_BYTES_CHANGED')
        snapshot[relative]=hashlib.sha256(actual).hexdigest()
    if git(root,'status','--porcelain','--untracked-files=no').strip():raise ValueError('SOURCE_TRACKED_CHANGES')
    if git(root,'rev-parse','HEAD').decode().strip()!=commit:raise ValueError('SOURCE_HEAD_CHANGED')
    return {'commit':commit,'files':snapshot}


def verify_sources(alpha,jobs):
    return {'alpha':verify_tree(alpha,ALPHA_SCOPES),'jobs':verify_tree(jobs,JOBS_SCOPES)}


def verify_dependency_lock(alpha,lock):
    source=git(alpha,'show','HEAD:requirements-agent.lock').decode('utf-8')
    def blocks(raw):
        entries=list(re.finditer(r'(?m)^([a-z0-9][a-z0-9-]*)==[^\n]+',raw))
        return {entry[1]:raw[entry.start():entries[index+1].start() if index+1<len(entries) else len(raw)] for index,entry in enumerate(entries)}
    selected=blocks(Path(lock).read_text(encoding='utf-8'));upstream=blocks(source)
    expected={'annotated-types','anyio','certifi','cffi','cryptography','h11','httpcore','httpx','idna','pycparser','pydantic','pydantic-core','typing-extensions','typing-inspection'}
    if set(selected)!=expected or any(selected[name]!=upstream.get(name) for name in selected):raise ValueError('DEPENDENCY_LOCK_DIFFERS_FROM_ALPHA_HASHED_PROFILE')
    return len(selected)


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--alpha-root',type=Path,required=True);parser.add_argument('--dependency-lock',type=Path,required=True);args=parser.parse_args()
    print('Verified exact Alpha hash-locked native dependency blocks:',verify_dependency_lock(args.alpha_root,args.dependency_lock))
