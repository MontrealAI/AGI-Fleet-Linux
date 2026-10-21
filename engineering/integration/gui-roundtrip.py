"""Exercise real public-site controls using actual native service evidence; no model or wallet."""
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

def require_alpha_import_observation(observation):
    checking=['Checking the complete learning archive locally…','Vérification locale de l’archive d’apprentissage complète…']
    success=['Learning archive restored and rechecked.','Archive d’apprentissage restaurée et contrôlée.']
    events=observation['events']
    checked=next((index for index,text in enumerate(events) if any(text.startswith(value) for value in checking)),None)
    if checked is None or not any(any(text.startswith(value) for value in success) for text in events[checked+1:]) or not any(observation['status'].startswith(value) for value in success) or observation['errorVisible']:raise ValueError('ALPHA_IMPORT_NOT_POSITIVELY_OBSERVED')

def import_alpha_history(page,selector,file):
    # Observe this operation's actual status transitions without changing application state.
    page.evaluate('''() => {
      const status=document.querySelector('#status'), observation={events:[]};
      observation.observer=new MutationObserver(records=>{for(const record of records){if(record.type==='childList')for(const node of record.addedNodes)observation.events.push(node.textContent);else observation.events.push(record.target.textContent);}});
      observation.observer.observe(status,{childList:true,characterData:true,subtree:true});window.__fleetArchiveImportObservation=observation;
    }''')
    page.locator(selector).set_input_files(file);expect(page.locator(selector)).to_have_value('')
    observation=page.evaluate('''() => {const observation=window.__fleetArchiveImportObservation;observation.observer.disconnect();const error=document.querySelector('#error');return {events:observation.events,status:document.querySelector('#status').textContent,errorVisible:!!error&&!error.hidden&&getComputedStyle(error).display!=='none'};}''')
    require_alpha_import_observation(observation);return observation

def inventory(root):
    rows=[]
    for file in sorted(root.rglob('*')):
        if file.is_symlink():raise ValueError('GUI_SITE_LINK')
        if file.is_file():rows.append({'name':file.relative_to(root).as_posix(),'bytes':file.stat().st_size,'sha256':sha(file.read_bytes())})
    # Match the verifier's flattened relative-name UTF-16 code-unit ordering.
    rows.sort(key=lambda row:row['name'].encode('utf-16-be'))
    return {'files':len(rows),'sha256':sha(json.dumps(rows,separators=(',',':'),ensure_ascii=False).encode())}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['alpha-site','jobs-site','manager-site','inputs','output']:parser.add_argument('--'+name,type=Path,required=True)
    for name in ['image','alpha-commit','jobs-commit','manager-commit','fleet-commit']:parser.add_argument('--'+name,required=True)
    args=parser.parse_args();roots={'AGI-Alpha-Agent-v0':args.alpha_site.resolve(strict=True),'AGIJobsv0':args.jobs_site.resolve(strict=True),'AGIJobManager':args.manager_site.resolve(strict=True)}
    args.output.mkdir(parents=True,exist_ok=True)
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self,*unused):pass
        def translate_path(self,raw):
            parts=unquote(urlsplit(raw).path).lstrip('/').split('/',1)
            if parts[0] not in roots and parts[0]!='Fleet-Journey-Evidence':return '/nonexistent-reviewed-site'
            root=args.output.resolve() if parts[0]=='Fleet-Journey-Evidence' else roots[parts[0]];target=(root/(parts[1] if len(parts)>1 else '')).resolve()
            if not target.is_relative_to(root):raise ValueError('GUI_SITE_PATH')
            return str(target)
        def end_headers(self):self.send_header('Cache-Control','no-store');super().end_headers()
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base='http://127.0.0.1:'+str(server.server_port)
    errors=[];external=[];cases=[];reverse_imports=[];started=time.monotonic()
    def download(page,selector,file):
        with page.expect_download() as waiting:page.locator(selector).click()
        artifact=waiting.value;artifact.save_as(file)
        return {'file':file.name,'suggestedFilename':artifact.suggested_filename,'bytes':file.stat().st_size,'sha256':sha(file.read_bytes())}
    def restrict(route):
        url=urlsplit(route.request.url)
        if url.scheme in {'blob','data'} or url.hostname=='127.0.0.1' and url.port==server.server_port:route.continue_()
        else:external.append(route.request.url);route.abort('blockedbyclient')
    try:
        with sync_playwright() as playwright:
            browser=playwright.chromium.launch(headless=True)
            try:
                # Use the normal raw-history receiver and complete-archive controls.
                # No task-supplied JavaScript or browser state injection is involved.
                for language in ['en','fr']:
                    directory=args.output/('alpha-'+language);directory.mkdir()
                    context=browser.new_context(accept_downloads=True,viewport={'width':1440,'height':1100});context.route('**/*',restrict)
                    page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)));begin=time.monotonic()
                    url=base+'/AGI-Alpha-Agent-v0/successor/alpha/'+('?lang=fr' if language=='fr' else '')
                    page.goto(url,wait_until='networkidle');initial_import=import_alpha_history(page,'#restore-learning-top',args.inputs/'initial-alpha-project.json');merged_import=import_alpha_history(page,'#restore-computer-history',args.inputs/'recovery-retained-history.json');page.locator('#computer-history-panel').wait_for(state='visible')
                    assert '4' in page.locator('#computer-history-count').inner_text()
                    records=[download(page,'#computer-save-history',directory/'complete-alpha-project.json'),download(page,'#computer-save-workspace',directory/'complete-alpha-workspace.html')]
                    page.locator('#computer-history-panel').screenshot(path=directory/'created.png')
                    page.reload(wait_until='networkidle');import_alpha_history(page,'#restore-learning-top',directory/'complete-alpha-project.json');page.locator('#computer-history-panel').wait_for(state='visible')
                    reopened=download(page,'#computer-save-history',directory/'reopened-complete-alpha-project.json');assert (directory/'complete-alpha-project.json').read_bytes()==(directory/'reopened-complete-alpha-project.json').read_bytes()
                    page.locator('#computer-history-panel').screenshot(path=directory/'reopened.png')
                    page.goto(base+'/Fleet-Journey-Evidence/alpha-'+language+'/complete-alpha-workspace.html',wait_until='networkidle');page.locator('#computer-history-panel').wait_for(state='visible');assert '4' in page.locator('#computer-history-count').inner_text()
                    portable_reopened=download(page,'#computer-save-history',directory/'portable-reopened-complete-alpha-project.json');assert (directory/'complete-alpha-project.json').read_bytes()==(directory/'portable-reopened-complete-alpha-project.json').read_bytes();page.locator('#computer-history-panel').screenshot(path=directory/'portable-reopened.png')
                    cases.append({'route':'alpha','language':language,'urlPath':urlsplit(url).path,'actualChromium':True,'normalCompleteArchiveControls':True,'initialArchiveImport':initial_import,'serviceHistoryImport':merged_import,'initialPendingPreparationRetained':True,'sameRouteArchiveReopened':True,'portableWorkspaceReopened':True,'reopenedBytesUnchanged':True,'walletConnected':False,'providerRequests':0,'elapsedSeconds':time.monotonic()-begin,'downloads':records+[reopened,portable_reopened]});context.close()
                for route in ['jobs','manager']:
                    for language in ['en','fr']:
                        directory=args.output/(route+'-'+language);directory.mkdir()
                        context=browser.new_context(accept_downloads=True,viewport={'width':1440,'height':1100});context.route('**/*',restrict)
                        page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)));begin=time.monotonic()
                        if route=='jobs':
                            url=base+'/AGIJobsv0/successor/computer/'+('fr/' if language=='fr' else '')
                            page.goto(url,wait_until='networkidle');page.locator('[data-computer-receipt][data-ready="true"]').wait_for()
                            assert not page.locator('#cr-public').is_checked() and not page.locator('#cr-approve-draft').is_checked()
                            for selector,name in [('#cr-native-handoff','handoff.json'),('#cr-native-return','computer-return.json'),('#cr-native-report','frozen-mission-report.json')]:page.locator(selector).set_input_files(args.inputs/name)
                            page.locator('#cr-native-history').set_input_files(args.inputs/'initial-alpha-project.json')
                            page.locator('#cr-public').check();page.locator('#cr-amount').fill('7');page.locator('#cr-network').select_option('1');page.locator('#cr-approve-draft').check();page.locator('#cr-create').click();page.locator('#cr-draft-download').wait_for(state='visible')
                            expect(page.locator('#cr-draft-download')).to_be_enabled()
                            initial_records=[download(page,'#cr-draft-download',directory/'initial-proposal.json'),download(page,'#cr-archive-download',directory/'initial-project-archive.json')]
                            page.reload(wait_until='networkidle');page.locator('[data-computer-receipt][data-ready="true"]').wait_for();page.locator('#cr-public').check();page.locator('#cr-reopen').set_input_files(directory/'initial-project-archive.json');expect(page.locator('#cr-archive-download')).to_be_enabled()
                            for selector,name in [('#cr-native-handoff','handoff.json'),('#cr-native-return','computer-return.json'),('#cr-native-report','frozen-mission-report.json')]:page.locator(selector).set_input_files(args.inputs/name)
                            page.locator('#cr-native-history').set_input_files(args.output/'alpha-en/complete-alpha-project.json');page.locator('#cr-public').uncheck();page.locator('#cr-public').check();page.locator('#cr-amount').fill('7');page.locator('#cr-network').select_option('1');page.locator('#cr-approve-draft').check();page.locator('#cr-create').click();expect(page.locator('#cr-draft-download')).to_be_enabled()
                            create_screen=directory/'created.png';page.locator('[data-computer-receipt]').screenshot(path=create_screen)
                            records=[download(page,'#cr-draft-download',directory/'proposal.json'),download(page,'#cr-archive-download',directory/'project-archive.json'),download(page,'#cr-history-download',directory/'alpha-history.json'),download(page,'#cr-alpha-download',directory/'original-alpha-project.json')]
                            page.reload(wait_until='networkidle');page.locator('[data-computer-receipt][data-ready="true"]').wait_for();assert not page.locator('#cr-public').is_checked() and not page.locator('#cr-approve-draft').is_checked()
                            page.locator('#cr-public').check();page.locator('#cr-reopen').set_input_files(directory/'project-archive.json');expect(page.locator('#cr-archive-download')).to_be_enabled()
                            reopened=download(page,'#cr-archive-download',directory/'reopened-project-archive.json');assert (directory/'project-archive.json').read_bytes()==(directory/'reopened-project-archive.json').read_bytes();assert not page.locator('#cr-approve-draft').is_checked()
                            reopened_original=download(page,'#cr-alpha-download',directory/'reopened-original-alpha-project.json')
                            page.locator('[data-computer-receipt]').screenshot(path=directory/'reopened.png')
                        else:
                            url=base+'/AGIJobManager/'+('fr/' if language=='fr' else '')+'computer-receipt/'
                            page.goto(url,wait_until='networkidle');page.locator('#public-input').wait_for();assert not page.locator('#public-input').is_checked() and not page.locator('#restore-consent').is_checked()
                            for selector,name in [('#handoff-file','handoff.json'),('#return-file','computer-return.json'),('#report-file','frozen-mission-report.json')]:page.locator(selector).set_input_files(args.inputs/name)
                            page.locator('#native-history-file').set_input_files(args.inputs/'initial-alpha-project.json')
                            page.locator('#budget').fill('25.00');page.locator('#public-input').check();page.locator('#prepare').click();page.locator('#result').wait_for(state='visible')
                            initial_records=[download(page,'#download-draft',directory/'initial-proposal.json'),download(page,'#download-history',directory/'initial-project-archive.json')]
                            page.reload(wait_until='networkidle');page.locator('#history-file').set_input_files(directory/'initial-project-archive.json');page.locator('#restore-consent').check();page.locator('#restore').click();page.locator('#result').wait_for(state='visible')
                            for selector,name in [('#handoff-file','handoff.json'),('#return-file','computer-return.json'),('#report-file','frozen-mission-report.json')]:page.locator(selector).set_input_files(args.inputs/name)
                            page.locator('#native-history-file').set_input_files(args.output/'alpha-en/complete-alpha-project.json');page.locator('#budget').fill('25.00');page.locator('#public-input').check();page.locator('#prepare').click();page.locator('#result').wait_for(state='visible')
                            page.locator('#result').screenshot(path=directory/'created.png')
                            records=[download(page,'#download-draft',directory/'proposal.json'),download(page,'#download-history',directory/'project-archive.json'),download(page,'#download-alpha',directory/'alpha-history.json'),download(page,'#download-alpha-workspace',directory/'original-alpha-project.json')]
                            page.reload(wait_until='networkidle');assert not page.locator('#public-input').is_checked() and not page.locator('#restore-consent').is_checked();page.locator('#history-file').set_input_files(directory/'project-archive.json');page.locator('#restore-consent').check();page.locator('#restore').click();page.locator('#result').wait_for(state='visible')
                            reopened=download(page,'#download-history',directory/'reopened-project-archive.json');assert (directory/'project-archive.json').read_bytes()==(directory/'reopened-project-archive.json').read_bytes();assert not page.locator('#public-input').is_checked();page.locator('#result').screenshot(path=directory/'reopened.png')
                            reopened_original=download(page,'#download-alpha-workspace',directory/'reopened-original-alpha-project.json')
                        assert not errors,errors
                        for name in ['original-alpha-project.json','reopened-original-alpha-project.json']:assert (directory/name).read_bytes()==(args.output/'alpha-en/complete-alpha-project.json').read_bytes()
                        cases.append({'route':route,'language':language,'urlPath':urlsplit(url).path,'actualChromium':True,'freshConsentRequired':True,'initialRouteArchiveReopened':True,'unsignedProposalsCreated':2,'sameRouteArchiveReopened':True,'reopenedBytesUnchanged':True,'walletConnected':False,'providerRequests':0,'elapsedSeconds':time.monotonic()-begin,'downloads':initial_records+records+[reopened,reopened_original]});context.close()
                for route in ['jobs','manager']:
                    directory=args.output/('reverse-'+route);directory.mkdir();begin=time.monotonic()
                    context=browser.new_context(accept_downloads=True,viewport={'width':1440,'height':1100});context.route('**/*',restrict);page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
                    page.goto(base+'/AGI-Alpha-Agent-v0/successor/alpha/',wait_until='networkidle');import_alpha_history(page,'#restore-learning-top',args.output/'alpha-en/complete-alpha-project.json');page.locator('#computer-history-panel').wait_for(state='visible')
                    source=args.output/(route+'-en/alpha-history.json');rejected=json.loads(source.read_text());rejected['schema']='unsupported-protocol-negative';rejected_file=directory/'rejected-history.json';rejected_file.write_text(json.dumps(rejected,separators=(',',':')))
                    try:import_alpha_history(page,'#restore-computer-history',rejected_file)
                    except ValueError as error:
                        if str(error)!='ALPHA_IMPORT_NOT_POSITIVELY_OBSERVED':raise
                    else:raise ValueError('REJECTED_ALPHA_IMPORT_WAS_COUNTED_AS_SUCCESS')
                    assert page.locator('#error').is_visible();negative_download=download(page,'#computer-save-history',directory/'after-rejected-import.json');assert (directory/'after-rejected-import.json').read_bytes()==(args.output/'alpha-en/complete-alpha-project.json').read_bytes()
                    page.reload(wait_until='networkidle');import_alpha_history(page,'#restore-learning-top',args.output/'alpha-en/complete-alpha-project.json');import_observation=import_alpha_history(page,'#restore-computer-history',source)
                    record=download(page,'#computer-save-history',directory/'complete-alpha-project.json');assert (directory/'complete-alpha-project.json').read_bytes()==(args.output/'alpha-en/complete-alpha-project.json').read_bytes();page.locator('#computer-history-panel').screenshot(path=directory/'reopened.png')
                    reverse_imports.append({'route':route,'normalAlphaReceiver':True,'importObservation':import_observation,'rejectedImportRefusedByDriver':True,'rejectedInputSha256':sha(rejected_file.read_bytes()),'archiveAfterRejection':negative_download,'sourceHistorySha256':sha(source.read_bytes()),'originalCompleteArchivePreserved':True,'download':record,'elapsedSeconds':time.monotonic()-begin});context.close()
                assert not external,external
                evidence={'schema':'agi-fleet/actual-route-gui-observation/v1','evidenceClass':'REAL_CHROMIUM_PUBLIC_UI_SCRIPTED_DRIVER','networkMode':'none','image':args.image,'browserVersion':browser.version,'playwrightVersion':importlib.metadata.version('playwright'),'driverSha256':sha(Path(__file__).read_bytes()),'sourceCommits':{'alpha':args.alpha_commit,'jobs':args.jobs_commit,'manager':args.manager_commit,'fleet':args.fleet_commit},'siteInventories':{name:inventory(root) for name,root in roots.items()},'inputFiles':{name:sha((args.inputs/name).read_bytes()) for name in ['handoff.json','computer-return.json','frozen-mission-report.json','recovery-retained-history.json','initial-alpha-project.json']},'cases':cases,'reverseImports':reverse_imports,'unexpectedExternalRequests':external,'pageErrors':errors,'providerRequests':0,'providerBilledCost':0,'realWallets':False,'authority':'none','currencyConversion':False,'crossRouteArchiveRestoreClaim':False,'elapsedSeconds':time.monotonic()-started,'humanMinutes':None,'deviceCost':None}
                (args.output/'browser-gui-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
            finally:browser.close()
    finally:server.shutdown();server.server_close();thread.join(timeout=5)
    print(json.dumps({'actualGuiCases':len(cases),'sameRouteReopenings':len(cases),'realWallets':False,'productionQualified':False}))


if __name__=='__main__':main()
