"""Fixed workflow path proposal. Pure validation; no installation or mutation."""
from pathlib import Path
import os
import re
from prepare import absent_output, evidence_directory, need

REPOSITORY='MontrealAI/AGI-Fleet-Linux'


def runner_paths(env):
    need(env.get('GITHUB_ACTIONS')=='true' and env.get('RUNNER_ENVIRONMENT')=='github-hosted' and env.get('GITHUB_REPOSITORY')==REPOSITORY, 'Disposable hosted repository context required')
    target={'X64':'linux-x64','ARM64':'linux-arm64'}.get(env.get('RUNNER_ARCH'))
    need(target is not None, 'Runner architecture unsupported')
    for key in ('GITHUB_SHA','GITHUB_WORKFLOW_SHA'):
        need(re.fullmatch('[a-f0-9]{40}',env.get(key,'')) is not None, 'Exact workflow/source commit required')
    need(env['GITHUB_SHA']==env['GITHUB_WORKFLOW_SHA'], 'Workflow must use its exact approved source commit')
    roots={}
    for key in ('GITHUB_WORKSPACE','RUNNER_TEMP'):
        raw=env.get(key,'')
        need(raw and '\n' not in raw and '\r' not in raw, 'Missing or malformed runner root')
        path=Path(raw)
        need(path.is_absolute() and path==path.resolve(strict=True) and path.is_dir() and not path.is_symlink(), 'Canonical existing runner root required')
        need(path.stat().st_uid==os.getuid() and path.stat().st_mode & 0o022 == 0, 'Runner root must be owned and private to its user')
        roots[key]=path
    workspace,temp=roots['GITHUB_WORKSPACE'],roots['RUNNER_TEMP']
    need(not workspace.is_relative_to(temp) and not temp.is_relative_to(workspace), 'Runner source/temp roots must be disjoint')
    root=absent_output(temp/('fleet-alpha-fixed-'+target),(workspace,))
    return {'target':target,'workflowCommit':env['GITHUB_SHA'],'workspace':str(workspace),'root':str(root),'source':str(root/'source'),'downloads':str(root/'downloads'),'tools':str(root/'tools'),'preparation':str(root/'preparation'),'evidence':str(evidence_directory(root/'preparation')),'installationBase':'/opt/agi-fleet-alpha'}
