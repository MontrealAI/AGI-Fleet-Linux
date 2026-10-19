"""Read-only real Fleet dashboard exports; credential arrives only on private stdin."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright


def sha(raw):return hashlib.sha256(raw).hexdigest()

def main():
    raw=sys.stdin.buffer.read(16001)
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
