"""Form a mission in Alpha, then create its handoff through Jobs; no wallet or model."""
import argparse
import hashlib
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
import importlib.metadata
import json
from pathlib import Path
import threading
import time
from urllib.parse import unquote,urlsplit
from playwright.sync_api import sync_playwright,expect


def sha(raw):return hashlib.sha256(raw).hexdigest()
def inventory(root):
    rows=[]
    for file in sorted(root.rglob('*')):
        if file.is_symlink():raise ValueError('GUI_SITE_LINK')
        if file.is_file():rows.append({'name':file.relative_to(root).as_posix(),'bytes':file.stat().st_size,'sha256':sha(file.read_bytes())})
    return {'files':len(rows),'sha256':sha(json.dumps(rows,separators=(',',':'),ensure_ascii=False).encode())}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['alpha-site','jobs-site','inputs','output']:parser.add_argument('--'+name,type=Path,required=True)
    for name in ['image','alpha-commit','jobs-commit','fleet-commit']:parser.add_argument('--'+name,required=True)
    args=parser.parse_args();roots={'AGI-Alpha-Agent-v0':args.alpha_site.resolve(strict=True),'AGIJobsv0':args.jobs_site.resolve(strict=True)};args.output.mkdir(parents=True,exist_ok=True)
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self,*unused):pass
        def translate_path(self,raw):
            parts=unquote(urlsplit(raw).path).lstrip('/').split('/',1)
            if parts[0] not in roots:return '/nonexistent-reviewed-site'
            root=roots[parts[0]];target=(root/(parts[1] if len(parts)>1 else '')).resolve()
            if not target.is_relative_to(root):raise ValueError('GUI_SITE_PATH')
            return str(target)
        def end_headers(self):self.send_header('Cache-Control','no-store');super().end_headers()
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();origin='http://127.0.0.1:'+str(server.server_port)
    errors=[];external=[];steps=[];started=time.monotonic()
    def restrict(route):
        url=urlsplit(route.request.url)
        if url.scheme in {'blob','data'} or url.hostname=='127.0.0.1' and url.port==server.server_port:route.continue_()
        else:external.append(route.request.url);route.abort('blockedbyclient')
    def download(page,selector,name):
        with page.expect_download() as waiting:page.locator(selector).click()
        artifact=waiting.value;file=args.output/name;artifact.save_as(file)
        steps.append('download '+name)
        return {'file':name,'suggestedFilename':artifact.suggested_filename,'bytes':file.stat().st_size,'sha256':sha(file.read_bytes())}
    try:
        with sync_playwright() as playwright:
            browser=playwright.chromium.launch(headless=True)
            try:
                context=browser.new_context(accept_downloads=True,viewport={'width':1440,'height':1100});context.route('**/*',restrict);page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
                starter=json.loads((args.inputs/'handoff.json').read_text());strategy=starter['strategy'];task=starter['task'];starter_project=json.loads(starter['projectRaw']);report=json.loads((args.inputs/'frozen-mission-report.json').read_text())
                page.goto(origin+'/AGI-Alpha-Agent-v0/successor/alpha/',wait_until='networkidle');steps.append('open normal Alpha mission form')
                formation_started=time.monotonic()
                page.locator('#computer-example').select_option('custom');steps.append('select custom Alpha mission')
                for selector in ['#computer-strategy-panel > summary','.computer-advanced > summary']:page.locator(selector).click();steps.append('open '+selector)
                fields={'computer-project-name':starter_project['name'],'computer-outcome':strategy['originalGoal'],'computer-value-hypothesis':strategy['valueHypothesis'],'computer-context':json.dumps(report['mission'],ensure_ascii=False),'computer-acceptance':'\n'.join(strategy['successCriteria']),'computer-urls':'','computer-strategy':'\n'.join(strategy['hypotheses']),'computer-combination':strategy['combination'],'computer-reframe':strategy['reframing'],'computer-html':'','computer-license':task['license'],'computer-actions':str(task['max_actions']),'computer-seconds':str(task['max_seconds']),'computer-review-minutes':str(task['review_minutes'])}
                assert len(fields['computer-context'])<=4000
                for selector,value in fields.items():page.locator('#'+selector).fill(value);steps.append('fill '+selector)
                for selector,value in [('computer-approach',strategy['selected']),('computer-rights',task['input_rights'])]:page.locator('#'+selector).select_option(value);steps.append('select '+selector)
                page.locator('#computer-build-surface').click();steps.append('build Alpha work surface from public brief');page.locator('#computer-prepare').click();steps.append('prepare new Alpha mission');expect(page.locator('#computer-status')).to_contain_text('Mission prepared and retained in your project.');expect(page.locator('#computer-download')).to_be_enabled();expect(page.locator('#computer-error')).to_be_hidden();expect(page.locator('#computer-history-count')).to_contain_text('1')
                alpha_downloads=[download(page,'#computer-download','initial-alpha-handoff.json'),download(page,'#computer-save-history','initial-alpha-project.json')];page.locator('#computer-form').screenshot(path=args.output/'alpha-formed.png')
                initial=json.loads((args.output/'initial-alpha-project.json').read_text());project_id=initial['project']['id'];formation_elapsed=time.monotonic()-formation_started
                page.goto(origin+'/AGIJobsv0/successor/computer/',wait_until='networkidle');steps.append('open Jobs forward receiver');page.locator('[data-computer-receipt][data-ready="true"]').wait_for()
                assert not page.locator('#cr-public').is_checked() and not page.locator('#cr-approve-handoff').is_checked()
                page.locator('#cr-public').check();steps.append('confirm public inputs');page.locator('#cr-project').set_input_files(args.output/'initial-alpha-project.json');steps.append('upload exact Alpha GUI archive');page.locator('#cr-report').set_input_files(args.inputs/'frozen-mission-report.json');steps.append('upload frozen public report');page.locator('#cr-read').click();steps.append('read project and report');expect(page.locator('#cr-forward-summary')).to_contain_text(project_id)
                page.locator('#cr-approve-handoff').check();steps.append('approve Jobs handoff');page.locator('#cr-prepare').click();steps.append('prepare Jobs handoff');expect(page.locator('#cr-handoff-download')).to_be_enabled()
                downloads=[download(page,'#cr-handoff-download','handoff.json'),download(page,'#cr-report-download','frozen-mission-report.json')];page.locator('[data-computer-receipt]').screenshot(path=args.output/'forward.png')
                assert not errors and not external
                observation={'schema':'agi-fleet/actual-jobs-forward-observation/v1','evidenceClass':'REAL_CHROMIUM_PUBLIC_UI_SCRIPTED_DRIVER','networkMode':'none','image':args.image,'browserVersion':browser.version,'playwrightVersion':importlib.metadata.version('playwright'),'driverSha256':sha(Path(__file__).read_bytes()),'sourceCommits':{'alpha':args.alpha_commit,'jobs':args.jobs_commit,'fleet':args.fleet_commit},'siteInventories':{name:inventory(root) for name,root in roots.items()},'inputFiles':{name:sha((args.inputs/name).read_bytes()) for name in ['project.json','handoff.json','frozen-mission-report.json']},'freshPublicConsent':True,'freshHandoffApproval':True,'actualForwardControls':True,'publicSyntheticFormValues':True,'publicStarterProject':False,'alphaNewGoalFormDriven':True,'alphaPreparationExecuted':False,'initialAlphaArchiveSha256':sha((args.output/'initial-alpha-project.json').read_bytes()),'initialAlphaPreparedAttempts':1,'alphaFormElapsedSeconds':formation_elapsed,'automationSteps':steps,'automationStepCount':len(steps),'automationStepScope':'ALPHA_FORMATION_AND_JOBS_FORWARD_ONLY','humanMinutes':None,'alphaDownloads':alpha_downloads,'downloads':downloads,'unexpectedExternalRequests':external,'pageErrors':errors,'providerRequests':0,'realWallets':False,'elapsedSeconds':time.monotonic()-started}
                (args.output/'forward-browser-evidence.json').write_text(json.dumps(observation,indent=2)+'\n');context.close()
            finally:browser.close()
    finally:server.shutdown();server.server_close();thread.join(timeout=5)
    print(json.dumps({'actualJobsGuiHandoffCreated':True,'nativeExecution':False,'realWallets':False}))


if __name__=='__main__':main()
