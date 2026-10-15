#!/usr/bin/env python3
"""Fail if SUCCESSOR removes original paths, modes, anchors, diagrams or history."""
import hashlib,json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PROFILE_ROLES=('Agent','Node','Employer','Moderator','Evidence','Recovery')
PROFILE_PARENT_ROLES=('Employer','Moderator','Evidence','Recovery')
PROFILE_RUNTIME_PATHS=frozenset(
    [f'fleet/packages/AGI_{role}/src/{name}.mjs' for role in PROFILE_ROLES for name in ('chain','config')]
    +[f'fleet/packages/AGI_{parent}/packages/AGI_{role}/src/{name}.mjs' for parent in PROFILE_PARENT_ROLES for role in ('Agent','Node') for name in ('chain','config')])
PROFILE_OPERATOR_PATHS=frozenset(['fleet/shared/operator/ops/config.mjs']
    +[f'fleet/packages/AGI_{role}/shared/operator/ops/config.mjs' for role in PROFILE_PARENT_ROLES])
PROFILE_VERIFIER_PATHS=frozenset(f'fleet/packages/AGI_{role}/scripts/verify-contract-artifacts.mjs' for role in ('Agent','Node'))
def require(condition,message):
    if not condition:raise ValueError(message)
def sha(b):return hashlib.sha256(b).hexdigest()
def reason(name):
    p=Path(name)
    if name in PROFILE_RUNTIME_PATHS:return 'Select only reviewed hash-pinned contract profiles and verify the entire selected deployment graph before transactions; omitted profile retains legacy defaults, budget and STOP identity.'
    if name in PROFILE_OPERATOR_PATHS:return 'Carry the optional finite reviewed contract profile through operator configuration; retain omitted-profile legacy configuration and reject arbitrary profile overrides.'
    if name in PROFILE_VERIFIER_PATHS:return 'Recompile the explicitly selected reviewed profile from its hash-bound compiler inputs and compare all 11 complete artifacts; preserve legacy default and exact equality checks.'
    if name in ('macos/build.py','macos/tests/test_build.py'):return 'Keep the Mac build bound to its original verified Linux archive as the active Linux download pointer and source advance; retain all archive-integrity and qualification requirements.'
    if name=='macos/preview/tests/test_materialize.py':return 'Compare the materialized basis to the exact current candidate instead of a stale version literal; retain the prior test in successor/history.'
    if name=='macos/preview/source-inventory.json':return 'Rebind the current Mac preview input inventory to reviewed shared sources; preserve its prior bytes in successor/history; inherit no qualification.'
    if name.startswith('website/'):return 'Add Builder entry point; retain concurrent published-release installation links and existing routes.'
    if name.startswith('engineering/') or name.startswith('.github/workflows/'):return 'Extend source-bound qualification, browser, saved-archive and publication gates for the distinct 1.1.0 candidate.'
    if name=='README.md':return 'Add bilingual Builder entry points without removing installation or release history.'
    if name.startswith('docs/') and p.name in ('JOB_INTEGRATION.md','FRESH_INSTALL.md','TROUBLESHOOTING.md','DEVELOPMENT.md','PHYSICAL_QUALIFICATION.md','physical-qualification-template.json'):return 'Bind active commands and blank ledger to the new candidate; all physical observations remain empty and NOT_RUN.'
    if name=='fleet/source-inventory.json' or name.endswith('/shared/runtime-inventory.json'):return 'Regenerate exact source and role-copy integrity records; no qualification inferred.'
    if name.startswith('fleet/'):
        if p.name in ('package.json','package-lock.json','companion-releases.json','role-registry.json','Info.plist'):return 'Coordinate the seven Linux release identities; retain dependencies and protocol rules.'
        if p.name in ('README.md','README.html','START_HERE.md','START_HERE.html','Linux-Guide.html','Linux-Guide.txt','READ_ME_FIRST.txt') and len(p.parts)==4:return 'Add offline Builder entry points to generated edition welcome; retain every existing installation and safety instruction.'
        if p.name in ('studio.mjs','studio.js','app.js','index.html','backup-verification.mjs','controller.mjs','messages.mjs','operational-state.mjs'):return 'Promote reviewed Studio format and explicit backup exclusion support; add installed Builder entry point while retaining existing actions.'
        if p.name in ('server.mjs','companion.mjs'):return 'Add authenticated SUCCESSOR routes and expose already-validated compute runtime observations through the existing Controller.'
        if p.name=='runtime.mjs':return 'Permit inert parent-plan provenance; keep dependency and delegation refusal and all public-scope checks.'
    raise ValueError('Unclassified original-file modification: '+name)
def check():
    baseline=json.loads((ROOT/'successor/preservation-baseline.json').read_text());changed=[];unchanged=0
    for row in baseline['files']:
        p=ROOT/row['path'];require(p.is_file() and not p.is_symlink(),'Original path missing: '+row['path'])
        require(bool(p.stat().st_mode&0o111)==(row['mode']=='100755'),'Executable mode changed: '+row['path'])
        content=p.read_bytes();digest=sha(content)
        if 'anchors' in row:
            now=set(re.findall(r'\bid=["\']([^"\']+)',content.decode()))
            missing=set(row['anchors'])-now
            # Generated release heading changes retain the old anchor as an explicit alias.
            require(not missing,'Original anchors missing: '+row['path']+' '+str(missing))
        if 'diagrams' in row:
            diagrams=[sha(s.encode()) for s in re.findall(r'```mermaid\s*\n(.*?)```',content.decode(),re.S)]
            require(all(x in diagrams for x in row['diagrams']),'Original diagram changed: '+row['path'])
        if digest==row['sha256']:unchanged+=1
        else:changed.append({'path':row['path'],'before':row['sha256'],'after':digest,'reason':reason(row['path'])})
    return {'schema':'agi-fleet/preservation-check/v1','status':'PASS','baselineCommit':baseline['commit'],'originalPaths':len(baseline['files']),'unchanged':unchanged,'modified':changed,'removed':[],'modeChanges':[],'anchorRemovals':[],'diagramRemovals':[]}
if __name__=='__main__':
    result=check()
    if len(sys.argv)==3 and sys.argv[1]=='--out':Path(sys.argv[2]).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='modified'}|{'modificationsExplained':len(result['modified'])}))
