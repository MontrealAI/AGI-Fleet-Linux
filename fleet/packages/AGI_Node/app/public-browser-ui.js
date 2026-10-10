/* Consent and historical reports only. Authority is checked by the signer and compute. */
window.AGIPublicBrowser = function ({request, refresh, enabled = () => true, savedReport = () => null}) {
  const byID = id => document.getElementById(id);
  const consent = byID('publicBrowserConsent'), run = byID('publicBrowserRun');
  const cancel = byID('publicBrowserCancel'), download = byID('publicBrowserDownload');
  const evidence = byID('publicBrowserEvidence'), status = byID('publicBrowserResult');
  const saved = byID('publicBrowserSaved'), evidenceStatus = byID('publicBrowserEvidenceStatus');
  let busy = false, cancelling = false, cancelled = false, report = null, loadedKey = null, loading = null, loadGeneration = 0, protectOutcome = false;
  function message(text, error = false) { status.textContent = text; status.setAttribute('role', error ? 'alert' : 'status'); }
  function renderReport({announce = true} = {}) {
    if (!report) {saved.textContent = '';evidenceStatus.textContent = '';return;}
    const exported = report.qualificationExport?.schema==='agi-public-web-qualification-export/v1'&&Number.isSafeInteger(report.qualificationExport?.payload?.expiresAt);
    const expired = exported && Date.now() >= report.qualificationExport.payload.expiresAt;
    const passed = report.browserEvidence?.status === 'PASS';
    const at=Number.isSafeInteger(report.completedAt)&&report.completedAt>0?new Date(report.completedAt).toLocaleString():'Time unavailable',runtime=typeof report.runtimeSha256==='string'&&/^[a-f0-9]{64}$/.test(report.runtimeSha256)?report.runtimeSha256.slice(0,12)+'…':'unavailable';
    saved.textContent = 'Saved test · ' + at + ' · Runtime ' + runtime + ' · Historical result, not a live health check.';
    evidenceStatus.textContent = expired ? 'Review evidence expired. Download the original for your records; it cannot support a new qualification receipt.' : report.qualificationStatus?.reason || 'Review evidence is not available. Inspect the saved test report before starting another test.';
    if (announce || expired && !busy && !protectOutcome) message((!passed||!exported||expired?'BLOCKED · ':'')+'Browser execution: ' + (passed ? 'passed' : 'not verified') + '. Review evidence: ' + (expired ? 'expired' : exported ? 'ready for independent review' : 'not ready') + '. Browser jobs still require a current, reviewed and imported receipt.', !passed || !exported || expired);
    evidence.textContent = expired ? 'Download expired evidence' : 'Download review evidence';
  }
  function sync() {
    const unlocked = enabled();
    if (!unlocked) {
      consent.checked = false;report = null;loadedKey = null;loadGeneration++;
      saved.textContent = '';evidenceStatus.textContent = '';
      protectOutcome=false;
      if(!busy)message('Unlock the workspace to load the last saved browser test.');
    }
    if(busy||cancelling)consent.checked=false;
    consent.disabled = busy || cancelling || !unlocked;
    run.disabled = busy || cancelling || !unlocked || !consent.checked;
    cancel.disabled = !busy || cancelling;
    download.disabled = busy || !unlocked || !report;
    const downloadableEvidence=report?.qualificationExport?.schema==='agi-public-web-qualification-export/v1'&&Number.isSafeInteger(report.qualificationExport?.payload?.expiresAt);
    evidence.hidden = !downloadableEvidence;
    evidence.disabled = busy || !unlocked || !downloadableEvidence;
    if(report)renderReport({announce:false});
    const summary=savedReport(),key=summary?summary.requestID+':'+summary.completedAt:'none';
    if(unlocked&&!busy&&!cancelling&&!loading&&loadedKey!==key){
      const generation=loadGeneration;loadedKey=key;
      loading=request('/api/companion/public-web-report').then(value=>{
        if(generation!==loadGeneration||!enabled()||busy)return;
        report=value.report??null;
        if(report)renderReport({announce:!protectOutcome});else if(!protectOutcome)message('No completed browser test is saved here. Running a new test uses your connected model allowance.');
      }).catch(error=>{if(generation===loadGeneration&&enabled()&&!busy&&!protectOutcome)message('The saved test report could not be loaded. '+error.message,true);})
        .finally(()=>{loading=null;sync();});
    }
  }
  consent.addEventListener('change', sync);
  run.addEventListener('click', async () => {
    if (busy || cancelling || !enabled() || !consent.checked) return;
    busy = true; cancelled = false; protectOutcome=true;consent.checked = false;loadGeneration++;sync();
    message('Running the fixed browser test. This may take several minutes. You can stop it here or lock the workspace.');
    try {
      const result = await request('/api/companion/public-web-commissioning', {acknowledge: true, allowProviderCalls: true, allowLocalRuntime: true});
      if (!cancelled && enabled()) {report=result&&typeof result==='object'?result:{status:'BLOCKED'};protectOutcome=false;const savedSummary=savedReport();loadedKey=savedSummary?savedSummary.requestID+':'+savedSummary.completedAt:'none';renderReport();}
    } catch (error) {
      protectOutcome=true;
      const expectedStop = cancelled && error.code === 'COMPANION_CANCELLED';
      if(!(cancelled&&status.getAttribute('role')==='alert'))message(expectedStop ? 'Browser test stopped. Consumed model allowance is retained.'+(report?' The previous saved report remains available.':'') : error.message + (report ? ' The previous saved report remains available below.' : ''), !expectedStop);
    } finally {
      busy = false;sync();
      if (cancelled && status.getAttribute('role') !== 'alert') message('Browser test ended. Consumed allowance is retained.'+(report?' The previous saved report remains available.':'')+' Review any compute cleanup alert before trying again.');
      try { await refresh(); } catch { /* Main panel owns connection errors. */ }
    }
  });
  cancel.addEventListener('click', async () => {
    if (!busy || cancelling) return;
    cancelling = true; cancelled = true;protectOutcome=true;sync();
    try {await request('/api/companion/cancel', {});if(status.getAttribute('role')!=='alert')message(busy?'Stop requested. Waiting for the protected session to close. Consumed allowance is retained.':'Browser test ended. Consumed allowance is retained.'+(report?' The previous saved report remains available.':''));}
    catch(error){protectOutcome=true;message(error.message,true);}finally{cancelling=false;sync();}
  });
  function saveJSON(filename,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  download.addEventListener('click',()=>{if(report&&!busy&&enabled())saveJSON('AGI-Public-Browser-Commissioning.json',report);});
  evidence.addEventListener('click',()=>{if(report?.qualificationExport?.schema==='agi-public-web-qualification-export/v1'&&Number.isSafeInteger(report.qualificationExport?.payload?.expiresAt)&&!busy&&enabled())saveJSON('AGI-Browser-Qualification-Evidence.json',report.qualificationExport);});
  sync();return {sync};
};
