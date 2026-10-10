window.AGIGenesis=function({api,refresh,role,goBackup=()=>{},goSetup=()=>{},goUnlock=goSetup,goCompute=goSetup,goStudio=goSetup,goWallet=goSetup}){
 const experience=window.AGIExperience({role,goSetup,goBackup,goCompute,goStudio,goWallet});
 const $=id=>document.getElementById(id);let state=null,machineObserved=false,verifying=false,returnToBackup=false;
 const errors={"VERIFY_DOWNLOADED_BACKUP_FIRST": "Verify the downloaded file first. Select the actual encrypted backup, enter its password and complete verification before acknowledging off-machine storage.", "BACKUP_PROFILE_MISMATCH": "This backup belongs to a different profile. Open the original profile or select its current backup. This verification did not change any application files.", "BACKUP_INTEGRITY": "The backup failed integrity checks. Keep the original file. Download a fresh backup from the intact profile or use a known-good protected copy.", "BACKUP_WALLET_MISMATCH": "The backup wallet does not match. Check the full public address and choose the correct role/profile backup. No restore was performed.", "BACKUP_ROLE": "This backup belongs to another role. Use the correct Agent, Node or Fleet-role application.", "UPGRADE_WALLET_MISMATCH": "The wallet differs from this profile\u2019s recorded identity. Stop and preserve the whole profile. Reopen the original profile and compare its independently recorded public address.", "EXPECTED_ADDRESS_REQUIRED": "Enter your expected public address. Copy it from your existing independent wallet records. This check never needs recovery words.", "BACKUP_REQUIRED": "Verify a current backup first. Download the encrypted backup, verify the actual file, then acknowledge that a copy is safely stored off this computer.", "PASSWORD_OR_FILE_INCORRECT": "The password or encrypted file is incorrect. Re-enter the backup password or choose the correct downloaded file."};
 const humanError=e=>errors[e?.code??e?.message??e]??e?.message??String(e);
 errors.NODE_LOCKED='Unlock this '+(role==='fleet'?'role':role)+' vault before verifying. The backup password does not unlock the running application. Select “Unlock to verify”; your file selection will be kept.';
 errors.STOP_AND_UNLOCK_FIRST='Stop this role and unlock its vault before verifying. Your file selection is kept; no restore was performed.';
 errors.STOP_BEFORE_CHANGING_SETTINGS='Stop the worker before verifying this backup. Your file selection is kept; no restore was performed.';
 function backupResult(text,kind='info',focus=false){const el=$('backupVerificationResult');el.textContent=text;el.dataset.state=kind;el.setAttribute('role',kind==='error'?'alert':'status');if(focus){el.focus({preventScroll:true});el.scrollIntoView({block:'nearest'});}}
 function backupControls(s){
  const locked=!s?.unlocked,running=Boolean(s?.running),button=$('verifyBackupForm').querySelector('button[type="submit"]');
  button.disabled=verifying||locked||running;
  button.textContent=verifying?'Verifying selected file…':locked?'Unlock before verifying':running?'Stop before verifying':'Verify downloaded backup';
  $('verifyBackupForm').setAttribute('aria-busy',String(verifying));
  $('verifyBackupFile').disabled=verifying;$('verifyBackupPassword').disabled=verifying||locked;
  $('backupUnlock').hidden=!locked;$('backupUnlock').disabled=verifying;
  $('backupPrerequisite').textContent=locked?(role==='fleet'?'Your vault is locked. Unlock first, then enter the backup password below. Your file selection will be kept.':'Your vault is locked. Downloading a backup accepts its password but does not unlock this application. Unlock first, then enter the backup password below.'):running?'Stop the worker using the app’s Stop control, then verify this file. Verification never stops work automatically.':'Vault unlocked. Select the encrypted file you downloaded and enter that file’s password. Verification does not restore your profile.';
  const saved=$('backupSaved')??$('backup-saved'),b=s?.backup??{};
  if(saved){saved.disabled=verifying||locked||!b.verified||b.safelyStored;saved.hidden=false;saved.textContent=b.safelyStored?'✓ Off-machine copy acknowledged':'I stored a verified copy safely off this computer';}
 }

 function status(text,bad=false){$('genesis-message').textContent=text;$('genesis-message').hidden=false;$('genesis-message').setAttribute('role',bad?'alert':'status');}
 function gate(title,value,detail){
  const parent=$('genesis-gates');let el=[...parent.children].find(n=>n.dataset.gate===title);
  if(!el){el=document.createElement('div');el.className='genesis-gate';el.dataset.gate=title;const tag=document.createElement('span'),h=document.createElement('h4'),p=document.createElement('p'),more=document.createElement('details'),summary=document.createElement('summary'),full=document.createElement('p'),instruction=document.createElement('p');tag.className='genesis-tag';summary.textContent='Evidence & next step';more.append(summary,full,instruction);el.append(tag,h,p,more);parent.append(el);}
  const [tag,h,p,more]=el.children;tag.dataset.state=value;tag.textContent={verified:'✓ VERIFIED',measured:'● OBSERVED',blocked:'! ACTION NEEDED',unknown:'○ UNVERIFIED'}[value];h.textContent=title;p.textContent=({Machine:'Hardware, isolation and the compute account.',Recovery:'Wallet recovery and the current encrypted file.',Compute:'OpenClaw, desktop tools and model access.',Delivery:'Public output, retrieval and retention.',Chain:'Network, permissions and transaction evidence.',Commissioning:'Buyer use, independent review and settlement.'})[title]??detail;
  more.children[1].textContent=detail;more.children[2].textContent=({Machine:'Measure this computer, then run the Linux commissioning guide in the Standard compute account. Retain all attempts, including failures.',Recovery:'Compare the complete existing address. Keep verified recovery words unchanged. Download a fresh encrypted backup, verify that exact file and store protected copies off this computer.',Compute:'Open the role’s OpenClaw panel, complete the separate-account installer and retain its desktop, OAuth and service results. Test a useful Studio output.',Delivery:'Confirm public-data consent and publication settings. Verify a real output and its retention before offering delivery.',Chain:'Use the role’s chain panel and verify each configured address, permission and receipt. Funding alone is not readiness.',Commissioning:'Retain scoped evidence of buyer use, unrelated reviewers, settlement, recovery, alerts and the required soak. Operator records are observations, not an independent certification.'})[title]??'Follow the commissioning guide.';
 }

 function render(s){const previous=state;state=s;experience.render(s);
  if(!verifying&&previous?.backup?.verified&&!s.backup?.verified)backupResult('The current backup needs verification. Select the latest downloaded file.');
  backupControls(s);
  if(returnToBackup&&s.unlocked){returnToBackup=false;queueMicrotask(()=>{goBackup();$('verifyBackupPassword').focus();});}
const actualRole=s.role??role,address=s.config?.agent??s.config?.validator??s.config?.wallet,recovery=s.walletRecovery??{},b=s.backup??{},evidence=actualRole==='evidence';
  const c=s.compatibility;if(c)$('genesis-compatibility').textContent=`Installed software: Fleet ${c.fleet} · Agent ${c.agent} · Node ${c.node}\nThis panel’s Node.js: ${c.nodeRuntime} · supported ${c.nodeRange}\nPinned OpenClaw: ${c.openclaw} · compute account must be checked separately\nPublic contract release: ${c.public}\nImmutable provenance: ${c.contractProvenance}`;
  document.body.dataset.role=actualRole;$('genesis-role').textContent=actualRole.toUpperCase()+' / PRIVATE OPERATOR';$('genesis-release').textContent='GENESIS · '+s.version;
  const cases=s.operations?.cases??[],recorded=cases.length>0&&cases.every(c=>c.status==='pass');
  [
   gate('Machine',machineObserved?'measured':'unknown',machineObserved?'Facts measured in this account. Compute-account isolation, M1 8-GB resources, FileVault restart and Screen Sharing still require physical evidence.':'Measure this account. Hardware, OS, account type, disk, pressure, Docker and isolation must be checked on the compute Mac.'),
   gate('Recovery',b.safelyStored&&(evidence||recovery.confirmed||recovery.type==='private-key')?'verified':'blocked',`${evidence?'Keyless evidence role.':recovery.confirmed?'Wallet recovery copy verified.':address?'Check the existing wallet recovery method.':'Dedicated wallet not configured.'} ${b.safelyStored?'Current encrypted file verified; off-machine storage acknowledged.':b.verified?'Current file verified; off-machine storage pending.':b.downloaded?'Downloaded file awaits verification.':'Fresh encrypted backup required.'}`),
   gate('Compute',s.companion?.connected?'measured':'unknown',s.companion?.connected?'Connection observed. Desktop, Office, browser, each OAuth role and login-service reliability need their own compute-account evidence.':'Connection, exact desktop actions, Office, browser, role OAuth and service startup are unverified.'),
   gate('Delivery','unknown','Public-data consent, publication configuration, IPFS retention and buyer-readable output need explicit evidence. A local preview does not verify publication.'),
   gate('Chain','unknown','Verify the network, contract addresses, permissions, balances and transaction receipts for this role. Model and desktop checks do not verify chain readiness.'),
   gate('Commissioning',recorded?'measured':'blocked',recorded?'Operator-recorded cases passed for this scope. Buyer use, unrelated review, settlement, restore, alerts and 72-hour soak still require retained evidence.':'Complete useful buyer output, unrelated review, paid settlement, recovery, alerts, a full cycle and at least 72 hours of observed operation.')
  ];
  $('genesis-boundary').textContent='LOCAL STUDIO · Inspect useful work without funding, job submission or publication. Provider allowance may be consumed. Live commerce has separate authorization and commissioning gates.';
  const done=[Boolean(address),Boolean(recovery.confirmed),Boolean(recovery.confirmed),Boolean(b.downloaded),Boolean(b.verified),Boolean(b.safelyStored&&(recovery.confirmed||recovery.type==='private-key'))];
  document.querySelectorAll('.genesis-journey li').forEach((el,i)=>el.dataset.done=String(done[i]));
  $('backupProof').textContent=b.safelyStored?'✓ Backup verified and off-machine storage acknowledged.':b.verified?'✓ Encrypted backup verified. Now confirm your off-machine copy.':b.downloaded?'Downloaded · cryptographic verification pending.':'No current verified backup.';

  const u=s.upgrade; if(u){$('genesis-upgrade').textContent=`Expected address: ${u.expectedAddress??'No wallet yet'}\nCurrent address:  ${u.currentAddress??'No wallet yet'}\n${u.match?'MATCH ✓':'Compare your independently recorded address'}\nProfile: ${u.profile} · previous release: ${u.previousVersion??'new profile'}\nCurrent release: ${u.release}\nHistory file or records: ${u.historyPresent?'present':'not yet observed'}\n${u.source}`;}
 }
 async function action(fn,button){button.disabled=true;try{await fn();await refresh();}catch(e){status(humanError(e),true);if(button.closest("#verifyBackupForm")){$("backupVerificationResult").textContent=humanError(e);$("backupVerificationResult").setAttribute("role","alert");}}finally{button.disabled=false;}}
 $('genesis-preflight').onclick=e=>action(async()=>{const r=await api('preflight',{});machineObserved=true;const dl=$('genesis-facts');dl.replaceChildren();for(const[k,v]of Object.entries(r.facts)){const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k.replace(/([A-Z])/g,' $1').toLowerCase();dd.textContent=v===null?'Unknown':String(v);div.append(dt,dd);dl.append(div);}$('genesis-machine').open=true;status('Measured this account. These facts do not prove compute-account isolation or physical-Mac qualification.');},e.currentTarget);
 $('genesis-diagnostics').onclick=e=>action(async()=>{const r=await api('diagnostics',{}),url=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='AGI-Genesis-sanitized-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Sanitized diagnostics downloaded. Contains measured facts and status codes, with no raw logs or credentials.');},e.currentTarget);
 $('genesis-compare').onsubmit=e=>{e.preventDefault();action(async()=>{const r=await api('upgrade/check',{expectedAddress:$('genesis-expected').value.trim()});status(r.match?'✓ Expected address matches the current wallet. Keep this profile and make a fresh backup.':'ADDRESS MISMATCH. Stop and reopen the original profile. Do not create a replacement wallet to fix an upgrade.',!r.match);},e.currentTarget.querySelector('button'));};
 $('verifyBackupForm').onsubmit=async e=>{
  e.preventDefault();if(verifying)return;
  if(!state?.unlocked||state.running){backupResult(humanError(!state?.unlocked?'NODE_LOCKED':'STOP_AND_UNLOCK_FIRST'),'error',true);backupControls(state);return;}
  verifying=true;backupControls(state);backupResult('Verifying selected file… Keep this window open. The password will clear when this attempt finishes.','pending');
  try{
   const file=$('verifyBackupFile').files[0];if(!file||file.size>=64*1024*1024)throw Error('Choose the downloaded encrypted backup under 64 MiB.');
   let envelope;try{envelope=JSON.parse(await file.text());}catch{throw Error('The selected file is not a valid JSON backup. Choose the encrypted backup downloaded by this application.');}
   const r=await api('backup/verify',{[role==='fleet'?'envelope':'backup']:envelope,password:$('verifyBackupPassword').value});
   await refresh();
   backupResult(`${r.currentReady?'✓ ENCRYPTED BACKUP VERIFIED':'HISTORICAL BACKUP CHECKED — CURRENT BACKUP STILL REQUIRED'}\nWallet identity matches · schema and integrity checked\nApplication state: ${r.checks.applicationState?'verified':'historical coverage only'}\nJournal: ${r.checks.database}\nCreated: ${r.createdAt??'not recorded in this historical file'}\nVerified: ${r.verifiedAt}\n${r.note}`,r.currentReady?'success':'info',true);
   status(r.note);
  }catch(e){try{await refresh();}catch{}backupResult(humanError(e),'error',true);status(humanError(e),true);}
  finally{$('verifyBackupPassword').value='';verifying=false;backupControls(state);}
 };
 $('verifyBackupFile').addEventListener('change',()=>{if(!verifying){$('verifyBackupPassword').value='';backupResult(state?.unlocked?'File selected. Enter its backup password, then choose Verify downloaded backup.':'File selected. Choose Unlock to verify; this selection will be kept.');}});
 $('backupUnlock').onclick=()=>{returnToBackup=true;$('verifyBackupPassword').value='';goUnlock();};
 $('genesis-backup').onclick=goBackup;$('genesis-setup').onclick=goSetup;
 return {render,syncBackup:()=>backupControls(state)};
};
