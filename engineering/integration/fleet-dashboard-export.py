"""Real saved-service dashboard controls/exports; credential is private stdin only."""
import hashlib
import base64
import importlib.metadata
import json
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect


def sha(raw):return hashlib.sha256(raw).hexdigest()

def json_sha(value):
    return sha(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())

def progress(phase,**values):
    # Only explicit public grant identifiers/digests cross this private pipe.
    print(json.dumps({'phase':phase,**values},separators=(',',':'),ensure_ascii=False),flush=True)

def permission(expected,**bindings):
    raw=sys.stdin.buffer.readline(16001)
    if not raw or len(raw)>16000:raise ValueError('DASHBOARD_CONTROL_PERMISSION_LIMIT')
    value=json.loads(raw)
    if value!={'continue':expected,**bindings}:raise ValueError('DASHBOARD_CONTROL_PERMISSION_BINDING')

def controls(request,origin,output,restrict,external,errors,started):
    mode=request['mode'];language=request['language']
    if mode not in {'execute','interrupt','stop','reconcile'} or language not in {'en','fr'}:raise ValueError('DASHBOARD_CONTROL_MODE')
    steps=[];screens=[];prepared=None;authorized=None;terminal=None;stop=None;plan=None;reconciled=None;run_elapsed=None
    def click(locator,name):locator.click();steps.append(name)
    def snapshot(page,stage):
        assert page.locator('#token').input_value()==''
        raw=page.screenshot(full_page=False)
        if not raw.startswith(bytes.fromhex('89504e470d0a1a0a')) or len(raw)>1_500_000:raise ValueError('DASHBOARD_CONTROL_SCREEN_LIMIT')
        screens.append({'stage':stage,'mediaType':'image/png','bytes':len(raw),'sha256':sha(raw),'contentBase64':base64.b64encode(raw).decode()})
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(headless=True)
        try:
            context=browser.new_context(accept_downloads=True,viewport={'width':1440,'height':1100});context.route('**/*',restrict)
            page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
            def response(action,perform):
                with page.expect_response(lambda item:urlsplit(item.url).path=='/v1/'+action,timeout=210000) as pending:perform()
                value=pending.value
                if value.status!=200:raise ValueError('DASHBOARD_CONTROL_RESPONSE')
                return value.json()
            page.goto(origin+'/',wait_until='networkidle')
            assert page.locator('#token').get_attribute('type')=='password'
            page.locator('#token').fill(request['token']);click(page.locator('#connect'),'connect');page.locator('#connected').wait_for(state='visible')
            assert page.locator('#token').input_value()==''
            if language=='fr':click(page.locator('#language'),'language-fr')
            if mode in {'execute','interrupt'}:
                if request.get('resume'):
                    page.locator('#resume').wait_for(state='visible');response('resume',lambda:click(page.locator('#resume'),'resume'))
                    page.locator('#resume').wait_for(state='hidden')
                row=page.locator('#actors .actor').filter(has_text=request['actorName']);expect(row).to_have_count(1)
                response('activate',lambda:click(row.get_by_role('button',name='Activer' if language=='fr' else 'Activate',exact=True),'activate'))
                response('doctor',lambda:click(page.locator('#doctor'),'doctor'))
                page.locator('#actor').select_option(request['actor']);steps.append('select-actor')
                page.locator('#computerFile').set_input_files('/input/handoff.json');steps.append('upload-exact-handoff')
                page.locator('#computerPublic').check();steps.append('confirm-public-inputs')
                response('prepare',lambda:click(page.locator('#computerPrepare'),'computerPrepare'))
                page.locator('#grant').wait_for(state='visible');prepared=json.loads(page.locator('#grantDetails').inner_text())
                assert prepared['actor']==request['actor']
                assert prepared['task']['input']['handoffRaw']==Path('/input/handoff.json').read_bytes().decode('utf-8')
                assert prepared['task']['action']=='alpha-computer-run' and prepared['task']['input']['publicNonpersonal'] is True
                view={key:prepared[key] for key in ['grant','actor','commitment']};view['taskSha256']=json_sha(prepared['task'])
                snapshot(page,'prepared');progress('prepared',**view);permission('authorize',grant=prepared['grant'],commitment=prepared['commitment'])
                authorized=response('authorize',lambda:click(page.locator('#authorize'),'authorize'))
                assert authorized=={'grant':prepared['grant'],'state':'authorized'}
                progress('authorized',grant=prepared['grant'],commitment=prepared['commitment']);permission('run',grant=prepared['grant'])
                expect(page.locator('#run')).to_be_enabled()
                timing={}
                def request_started(value):
                    if urlsplit(value.url).path=='/v1/run':timing['start']=time.monotonic()
                page.on('request',request_started)
                with page.expect_response(lambda item:urlsplit(item.url).path=='/v1/run',timeout=210000) as pending:
                    click(page.locator('#run'),'run')
                    if mode=='interrupt':
                        progress('run-started',grant=prepared['grant'],commitment=prepared['commitment'])
                        permission('stop',grant=prepared['grant'])
                        page.locator('#stop').scroll_into_view_if_needed();snapshot(page,'before-stop')
                        stop=response('stop',lambda:click(page.locator('#stop'),'stop'))
                returned=pending.value;terminal=returned.json();run_elapsed=time.monotonic()-timing['start']
                if returned.status!=(400 if mode=='interrupt' else 200):raise ValueError('DASHBOARD_RUN_RESPONSE')
                if mode=='interrupt':assert isinstance(terminal.get('error'),str) and terminal.get('run')
                else:assert terminal.get('state')=='complete' and terminal.get('run')
                response('status',lambda:click(page.locator('#refresh'),'refresh'))
                result=page.locator('#runs .run').filter(has_text=terminal['run']);expect(result).to_have_count(1)
                expect(result).to_contain_text('uncertain' if mode=='interrupt' else 'complete')
                result.scroll_into_view_if_needed();snapshot(page,'terminal')
            elif mode=='stop':
                page.locator('#stop').scroll_into_view_if_needed();stop=response('stop',lambda:click(page.locator('#stop'),'stop'))
                page.locator('#resume').wait_for(state='visible');snapshot(page,'stopped')
            else:
                result=page.locator('#runs .run').filter(has_text=request['run']);expect(result).to_have_count(1);expect(result).to_contain_text('uncertain')
                response('reconciliation',lambda:click(result.get_by_role('button',name='Examiner la reprise' if language=='fr' else 'Inspect recovery',exact=True),'inspect-recovery'))
                plan=json.loads(page.locator('#recoveryDetails').inner_text());expect(page.locator('#reconcile')).to_be_enabled()
                selected={key:plan[key] for key in ['run','commitment','eligible','kind','replayAllowed','observationSha256']}
                snapshot(page,'reconciliation');progress('reconciliation-ready',**selected);permission('reconcile',run=plan['run'],commitment=plan['commitment'])
                reconciled=response('reconcile',lambda:click(page.locator('#reconcile'),'reconcile'))
                response('status',lambda:click(page.locator('#refresh'),'refresh'))
                expect(page.locator('#runs .run').filter(has_text=request['run'])).to_contain_text('reconciled');snapshot(page,'reconciled')
            assert not external and not errors and page.locator('#token').input_value()==''
            summary={'schema':'agi-fleet/real-dashboard-control-observation/v1','evidenceClass':'REAL_CHROMIUM_ACTUAL_SAVED_SERVICE_CONTROLS','mode':mode,'language':language,'image':request['image'],'driverSha256':sha(Path(__file__).read_bytes()),'browserVersion':browser.version,'playwrightVersion':importlib.metadata.version('playwright'),'networkMode':'host; driver restricts every request to the existing loopback service origin','osNetworkIsolationClaim':False,'nativeWorkerNetwork':'none','credentialFieldMasked':True,'credentialFieldCleared':True,'credentialRetainedInEvidence':False,'traceRecorded':False,'providerRequests':0,'realWallets':False,'actor':request['actor'],'automationSteps':steps,'automationStepCount':len(steps),'screenshots':screens,'unexpectedExternalRequests':external,'pageErrors':errors,'guiAutomatedElapsedSeconds':time.monotonic()-started,'runRequestElapsedSeconds':run_elapsed,'humanElapsedMinutes':None,'deviceCost':None}
            if prepared:summary['preparation']={**{key:prepared[key] for key in ['grant','actor','commitment']},'taskSha256':json_sha(prepared['task'])}
            if authorized:summary['authorization']=authorized
            if terminal:summary['run']={'id':terminal['run'],'state':terminal.get('state'),'error':terminal.get('error'),'receiptSha256':json_sha(terminal['receipt']) if 'receipt' in terminal else None}
            if stop:summary['stop']={key:stop[key] for key in ['state','cleanup']}
            if plan:summary['reconciliation']={key:plan[key] for key in ['run','commitment','eligible','kind','replayAllowed','observationSha256']}
            if reconciled:summary['reconciled']={'run':request['run'],'state':reconciled['state'],'receiptSha256':json_sha(reconciled['receipt'])}
            (output/'dashboard-controls.json').write_text(json.dumps(summary,ensure_ascii=False,separators=(',',':'))+'\n')
            # No headers, scoped credentials or arbitrary response fields are retained.
            result={'terminal':{key:terminal[key] for key in ['run','state','receipt','error'] if key in terminal} if terminal else None,'stop':{key:stop[key] for key in ['state','cleanup']} if stop else None,'reconciled':{key:reconciled[key] for key in ['run','state','receipt'] if key in reconciled} if reconciled else None}
            progress('complete',**result);context.close()
        finally:browser.close()

def main():
    raw=sys.stdin.buffer.readline(16001)
    if len(raw)>16000:raise ValueError('DASHBOARD_INPUT_LIMIT')
    request=json.loads(raw);origin=request['url'];url=urlsplit(origin)
    if url.scheme!='http' or url.hostname!='127.0.0.1' or not url.port or url.path:raise ValueError('DASHBOARD_LOOPBACK_ONLY')
    output=Path('/output');external=[];errors=[];cases=[];started=time.monotonic()
    def restrict(route):
        selected=urlsplit(route.request.url)
        if selected.scheme in {'blob','data'} or selected.scheme=='http' and selected.hostname=='127.0.0.1' and selected.port==url.port:route.continue_()
        else:external.append(route.request.url);route.abort('blockedbyclient')
    def download(page,selector,file):
        with page.expect_download() as pending:page.locator(selector).click()
        result=pending.value;result.save_as(file);return {'file':file.name,'suggestedFilename':result.suggested_filename,'sha256':sha(file.read_bytes()),'bytes':file.stat().st_size}
    if 'mode' in request:
        controls(request,origin,output,restrict,external,errors,started)
        return
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(headless=True)
        try:
            for language in ['en','fr']:
                context=browser.new_context(accept_downloads=True,viewport={'width':1440,'height':1100});context.route('**/*',restrict);page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
                directory=output/language;directory.mkdir()
                page.goto(origin+'/',wait_until='networkidle');assert page.locator('#token').get_attribute('type')=='password';page.locator('#token').fill(request['token']);page.locator('#connect').click();page.locator('#connected').wait_for(state='visible');assert page.locator('#token').input_value()==''
                if language=='fr':page.locator('#language').click()
                row=page.locator('#runs .run').filter(has_text=request['run']);row.get_by_role('button',name='Voir le résultat' if language=='fr' else 'View output',exact=True).click()
                returned=download(page,'#runs .run:has-text("'+request['run']+'") [data-computer-export]',directory/'computer-return.json');assert returned['sha256']==request['nativeReturnSha256']
                artifact=request['artifact'];assert artifact['name'].startswith('screen-') and artifact['name'].endswith('.png')
                screenshot=download(page,'#runs .run:has-text("'+request['run']+'") [data-computer-artifact="'+artifact['name']+'"]',directory/artifact['name']);assert screenshot['sha256']==artifact['sha256'] and screenshot['bytes']==artifact['bytes']
                row.screenshot(path=directory/'dashboard.png');assert page.locator('#token').input_value()==''
                cases.append({'language':language,'run':request['run'],'actor':request['actor'],'return':returned,'artifact':screenshot,'credentialFieldMasked':True,'credentialFieldCleared':True,'actualDashboardControls':True});context.close()
            assert not external and not errors
            value={'schema':'agi-fleet/real-dashboard-export-observation/v1','evidenceClass':'REAL_CHROMIUM_ACTUAL_SAVED_SERVICE_OUTPUT','image':request['image'],'networkMode':'host; driver restricts every request to the existing loopback service origin','osNetworkIsolationClaim':False,'nativeWorkerNetwork':'none','browserVersion':browser.version,'playwrightVersion':importlib.metadata.version('playwright'),'driverSha256':sha(Path(__file__).read_bytes()),'cases':cases,'unexpectedExternalRequests':external,'pageErrors':errors,'traceRecorded':False,'credentialRetainedInEvidence':False,'providerRequests':0,'realWallets':False,'elapsedSeconds':time.monotonic()-started}
            (output/'dashboard-export-evidence.json').write_text(json.dumps(value,indent=2)+'\n')
        finally:browser.close()
    print(json.dumps({'actualDashboardExports':len(cases),'credentialRetainedInEvidence':False,'realWallets':False}))


if __name__=='__main__':
    try:main()
    except BaseException:
        # Playwright call logs may include a fill value. Never emit exception text
        # or a traceback from the process that receives the private credential.
        sys.stderr.write('DASHBOARD_DRIVER_FAILED\n');sys.exit(1)
