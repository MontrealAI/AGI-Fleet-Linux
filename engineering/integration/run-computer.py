"""Run a project-bound native Alpha session with real browser actions and disclosed scripted advice."""
import argparse
import base64
import hashlib
import json
import importlib.metadata
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
from source_guard import verify_sources,verify_dependency_lock


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--alpha-root',type=Path,required=True)
    parser.add_argument('--jobs-root',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--actuator',choices=['docker','host-laboratory'],default='docker')
    parser.add_argument('--image')
    parser.add_argument('--chromium-executable',type=Path)
    parser.add_argument('--inject-error',choices=['late'])
    parser.add_argument('--node',default='node')
    parser.add_argument('--prepare-only',action='store_true')
    args=parser.parse_args()
    alpha=args.alpha_root.resolve(strict=True);jobs=args.jobs_root.resolve(strict=True)
    out=args.output.absolute()
    if out.exists() or out.is_symlink():raise ValueError('Choose an absent evidence directory')
    if not args.prepare_only and args.actuator=='docker' and not args.image:raise ValueError('Docker requires an immutable locally built image identity')
    if not args.prepare_only and args.actuator=='host-laboratory' and not args.chromium_executable:raise ValueError('Host laboratory requires explicit Chromium')
    out.mkdir(parents=True,mode=0o700)
    started=time.monotonic()
    snapshot=verify_sources(alpha,jobs)
    selected=json.loads(Path(__file__).with_name('compatibility-set.json').read_text(encoding='utf-8'))
    if any(snapshot[name]['commit']!=selected[name] for name in ['alpha','jobs']):raise ValueError('Current checkouts must equal the selected exact compatibility source commits')
    verify_dependency_lock(alpha,Path(__file__).with_name('requirements-native.lock'))
    bundle=json.loads(subprocess.check_output([args.node,str(Path(__file__).with_name('prepare-computer.mjs')),str(alpha),str(jobs)],timeout=90))
    for name,key in [('handoff.json','handoffRaw'),('frozen-mission-report.json','reportRaw'),('project.json','projectRaw')]:
        (out/name).write_text(bundle[key],encoding='utf-8');os.chmod(out/name,0o600)
    report=json.loads(bundle['reportRaw'])
    quantities={entry['supplierId']:entry['units'] for entry in report['frozen']['plan']['allocations']}
    if args.inject_error=='late':quantities={'laurentian':report['mission']['requirements']['totalUnits']}
    actions=[{'type':'move','x':500,'y':300}]
    for supplier in ['stellar','laurentian','boreal']:
        actions.extend([{'type':'keypress','keys':['TAB']},{'type':'keypress','keys':['CTRL','A']},{'type':'type','text':str(quantities.get(supplier,0))}])
    actions.extend([{'type':'keypress','keys':['TAB']},{'type':'keypress','keys':['ENTER']},{'type':'scroll','x':900,'y':700,'scroll_x':0,'scroll_y':450},{'type':'wait'}])
    (out/'actions.json').write_text(json.dumps(actions,separators=(',',':')),encoding='utf-8');os.chmod(out/'actions.json',0o600)
    if args.prepare_only:
        if verify_sources(alpha,jobs)!=snapshot:raise ValueError('Source changed while preparing the inert handoff')
        print(json.dumps({'prepared':True,'executed':False,'output':str(out),'authority':'none'}));return
    sys.path.insert(0,str(alpha))
    from alpha_factory_v1.core.runtime.store import Journal
    from alpha_factory_v1.core.runtime.successor import computer
    from alpha_factory_v1.core.runtime.successor.computer_handoff import ComputerHandoff,write_computer_return
    handoff=ComputerHandoff.model_validate_json(bundle['handoffRaw'])
    batches=[actions[index:index+5] for index in range(0,len(actions),5)]
    class ScriptedAdvice:
        identity={'mode':'responses','model':'SCRIPTED_COMPUTER_FIXTURE_NOT_LIVE_MODEL','endpoint':'http://127.0.0.1/fixture-no-network'}
        def __init__(self):self.calls=0
        def next(self,task,observation):
            image=base64.b64decode(observation['png'],validate=True)
            if image[:8]!=b'\x89PNG\r\n\x1a\n':raise ValueError('Actual PNG required')
            index=self.calls;self.calls+=1
            return {'actions':batches[index] if index<len(batches) else [],'done':index>=len(batches),'summary':'Scripted browser transport completed; task acceptance requires separate verifier.' if index>=len(batches) else ''}
    class HostLaboratory(computer.DockerComputer):
        def __init__(self,image,task,checkpoint):
            self.name='EXPLICIT_HOST_LABORATORY_NO_CONTAINER_ISOLATION';self.checkpoint=checkpoint
            self.broker=computer.ReadBroker(task.allowed_urls,checkpoint);self.inbox=queue.Queue(maxsize=4)
            launcher=jobs/'integrations/alpha-agent/successor-computer-worker-launch.py'
            command=[sys.executable,'-B',str(launcher),'--worker',str(computer.WORKER),'--runtime-record',str(out/'worker-runtime.json'),'--chromium-executable',str(args.chromium_executable.resolve(strict=True))]
            environment={key:value for key,value in os.environ.items() if key in {'PATH','HOME','LANG','LC_ALL','TZ','TMPDIR','LD_LIBRARY_PATH','PLAYWRIGHT_BROWSERS_PATH'}}
            self.log=(out/'worker-stderr.log').open('x')
            self.process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.log,start_new_session=True,env=environment)
            def read():
                try:
                    while True:
                        line=self.process.stdout.readline(computer.MAX_MESSAGE+1)
                        if not line or len(line)>computer.MAX_MESSAGE:raise ValueError('Native worker ended or exceeded message bound')
                        self.inbox.put(line)
                except Exception as error:self.inbox.put(error)
            threading.Thread(target=read,daemon=True).start()
            self.send({'operation':'start','html':task.html})
        def close(self):
            sys.path.insert(0,str(jobs/'integrations/alpha-agent'))
            from supplier_browser_lab_support import terminate_group
            self.cleanup=terminate_group(self.process);self.log.close()
            (out/'cleanup.json').write_text(json.dumps(self.cleanup),encoding='utf-8')
            if not self.cleanup['groupClosed']:raise ValueError('Actual worker process group did not close')
    advisor=ScriptedAdvice()
    image=args.image or 'sha256:'+hashlib.sha256(args.chromium_executable.read_bytes()).hexdigest()
    journal=Journal.initialize(out/'operator-journal')
    permit=computer.commitment(handoff.task,advisor,image,handoff.context())
    run_dir=out/'native'
    try:
        computer.run_session(journal,handoff.task,advisor,image,run_dir,permit,execution_context=handoff.context(),factory=computer.DockerComputer if args.actuator=='docker' else HostLaboratory)
    finally:
        if (run_dir/'receipt.json').is_file():write_computer_return(handoff,journal,advisor,image,run_dir)
    returned=json.loads((run_dir/'computer-return.json').read_text())
    (out/'computer-return.json').write_text(json.dumps(returned,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    if verify_sources(alpha,jobs)!=snapshot:raise ValueError('Imported source changed during execution; retain this run and use a new exact source')
    evidence={'schema':'agi-fleet/four-repository-computer-observation/v1','actuator':args.actuator,'realBrowser':True,'scriptedAdvice':True,'fixtureAdviceCalls':advisor.calls,'liveProvider':False,'dockerIsolation':args.actuator=='docker','providerBilledCost':None,'providerRequests':0,'humanMinutes':None,'deviceCost':None,'elapsedSeconds':time.monotonic()-started,'independentReview':False,'onChainTransactions':0,'productionQualified':False,'authority':'none','settlement':'not-connected','injectedError':args.inject_error,'nativeSession':{'state':returned['receipt']['state'],'actions':returned['receipt']['actions_reserved'],'turns':returned['receipt']['turns_reserved'],'screenshots':len(returned['receipt']['screenshots'])},'sourceCommits':{name:subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip() for name,root in [('alpha',alpha),('jobs',jobs)]},'sourceGitChanges':{name:subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=root,text=True).splitlines() for name,root in [('alpha',alpha),('jobs',jobs)]},'stableSourceFiles':snapshot,'hostRuntime':{'python':sys.version.split()[0],**{name:importlib.metadata.version(name) for name in ['pydantic','httpx','cryptography']}}}
    (out/'browser-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(evidence,indent=2))


if __name__=='__main__':main()
