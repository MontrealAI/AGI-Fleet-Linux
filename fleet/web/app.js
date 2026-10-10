const $ = (id) => document.getElementById(id),
  token = location.hash.slice(1) || sessionStorage.getItem("agi-panel-token");
if (location.hash) {
  sessionStorage.setItem("agi-panel-token", token);
  history.replaceState(null, "", location.pathname);
}
let current,
  loaded = false;
let exceptionAfter = "", exceptionNext = null, laborEstimate = null, humanSubmission = null;
const laborCategories = {buyerAcceptance:"Buyer acceptance",buyerDispute:"Buyer dispute",moderatorRuling:"Moderator ruling",additionalEvidenceRequest:"Additional evidence request"};
$("laborInputs").innerHTML = Object.entries(laborCategories).map(([k,label]) => `<tr><td>${label}</td><td><input id="coverage-${k}" aria-label="${label} eligible percent" type="number" min="0" max="100" value="${k === "additionalEvidenceRequest" ? 0 : 100}"></td><td><input id="completion-${k}" aria-label="${label} automatic completion percent" type="number" min="0" max="100" value="100"></td></tr>`).join("");
const usdc = value => { const n=BigInt(value); return `${(n/1000000n).toLocaleString()}.${(n%1000000n).toString().padStart(6,"0")}`; };
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const explanations = {
  VERIFY_DOWNLOADED_BACKUP_FIRST: "Verify the downloaded file first. Select the actual encrypted backup, enter its password and complete verification before acknowledging off-machine storage.",
  BACKUP_PROFILE_MISMATCH: "This backup belongs to a different profile. Open the original profile or select its current backup. This verification did not change any application files.",
  BACKUP_INTEGRITY: "The backup failed integrity checks. Keep the original file. Download a fresh backup from the intact profile or use a known-good protected copy.",
  BACKUP_WALLET_MISMATCH: "The backup wallet does not match. Check the full public address and choose the correct role/profile backup. No restore was performed.",
  BACKUP_ROLE: "This backup belongs to another role. Use the correct Agent, Node or Fleet-role application.",
  UPGRADE_WALLET_MISMATCH: "The wallet differs from this profile\u2019s recorded identity. Stop and preserve the whole profile. Reopen the original profile and compare its independently recorded public address.",
  EXPECTED_ADDRESS_REQUIRED: "Enter your expected public address. Copy it from your existing independent wallet records. This check never needs recovery words.",
  BACKUP_REQUIRED: "Verify a current backup first. Download the encrypted backup, verify the actual file, then acknowledge that a copy is safely stored off this computer.",

  BACKUP_TOO_LARGE: "This profile exceeds the app backup limit. Preserve all records and make an encrypted backup of the complete stopped profile; see the backup recovery guide.",
  BACKUP_STATE_UNSAFE_FILE: "An operational file is a link or unsupported type. Preserve the profile and inspect it before backing up.",
  BACKUP_STATE_CHANGED: "A record changed during backup. Stop other tools editing this profile and try again.",
  BACKUP_STATE_FORMAT: "The operational backup is not valid. Use another known-good backup.",
  BACKUP_STATE_PATH: "The backup contains an unsupported path. No replacement was installed.",
  BACKUP_STATE_DUPLICATE: "The backup contains conflicting filenames. Use a known-good backup.",
  BACKUP_STATE_INTEGRITY: "A backup record failed its checksum. Preserve the file and use another known-good backup.",
  RECOVERY_RATE_LIMIT: "Too many password or recovery attempts. Wait one minute and try again.",
  RESTORE_INTERRUPTED_RECOVERY_REQUIRED: "Restore was interrupted. Keep this data folder unchanged and restore the known-good backup into a new empty profile. Signing is blocked.",
  RECOVERY_PHRASE_INVALID: "Check the recovery words. Use a valid 12- or 24-word English BIP-39 phrase in the correct order. No wallet was imported.",
  RECOVERY_WORD_COUNT: "Choose 12 or 24 words. The default is a 24-word English BIP-39 recovery phrase.",
  RECOVERY_EXPECTED_ADDRESS_REQUIRED: "Enter the original public address. Use the expected Ethereum address so recovery can verify the correct phrase, passphrase and derivation path.",
  RECOVERY_ADDRESS_MISMATCH: "The recovered address does not match. Check the original words, optional BIP-39 passphrase and derivation path. No wallet was imported.",
  RECOVERY_PATH_INVALID: "Check the Ethereum derivation path. Use m/44'/60'/0'/0/0 unless your original wallet used a different account or address index.",
  RECOVERY_PASSPHRASE_INVALID: "Check the optional BIP-39 passphrase. It must be text of at most 1024 characters. It is different from the vault password.",
  RECOVERY_PHRASE_UNAVAILABLE: "This wallet has no saved recovery phrase. Keep its encrypted Fleet role backup and password. To create a new seed wallet, use the matching role seed-wallet launcher in the extracted folder.",
  RECOVERY_CONFIRMATION_REQUIRED: "Verify your recovery copy first. Open Wallet & backups, show the phrase with your vault password, write it down offline and complete the word check.",
  RECOVERY_CHALLENGE_EXPIRED: "The recovery check expired. Reveal the recovery phrase again with your vault password to start a fresh check.",
  RECOVERY_WORDS_INCORRECT: "The recovery words did not match. Check the numbered words on your offline copy. Reveal the phrase again to restart.",
  RECOVERY_PASSPHRASE_INCORRECT: "The extra recovery passphrase did not match. Use the original BIP-39 passphrase, including spaces and capitalization. Reveal the phrase again to restart.",
  RECOVERY_HISTORY_ACKNOWLEDGEMENT: "Confirm the recovery boundary. The phrase recovers wallet access. An Fleet role that has already signed needs its complete encrypted backup and journal before live operation.",
  RECOVERY_RECORD_INVALID: "Wallet recovery data needs attention. Stop here and preserve the data folder. Restore a known-good encrypted backup in a separate stopped environment.",
  RECOVERY_RECORD_MISMATCH: "Wallet and recovery data disagree. Stop here and preserve the data folder. Do not fund or activate this profile. Restore a known-good encrypted backup.",
  BACKUP_REQUIRED: "Download and verify the actual encrypted backup, then acknowledge off-machine storage.",
  DOWNLOAD_BACKUP_FIRST: "Download a new encrypted backup before confirming it.",
  RECOVERY_HISTORY_REQUIRED: "This recovered wallet needs its original complete backup and journal. A never-used wallet can be checked during deployment verification.",
  WALLET_ALREADY_CONFIGURED: "This profile already has a wallet. Use the matching role seed-wallet launcher for a separate wallet.",

  AUTH_REQUIRED: "Open this panel again using the machine launcher.",
  VAULT_LOCKED: "Unlock the vault first.",
  PASSWORD_OR_FILE_INCORRECT: "The password did not unlock this vault.",
  PASSWORD_LENGTH: "Choose a password with at least 12 characters.",
  STOP_BEFORE_CONFIGURATION:
    "Stop the service and wait for its pending transaction before changing settings.",
  STOP_BEFORE_ENROLLMENT:
    "Stop the service and finish reconciling any pending transaction first.",
  VERIFY_DEPLOYMENT_FIRST:
    "Unlock, save your settings and verify the deployment first.",
  MODERATOR_NOT_APPOINTED:
    "The contract owner must appoint this wallet as a moderator. This service cannot appoint itself.",
  AUTHORITY_NOT_ACTIVE:
    "Standing authority is missing, expired or no longer matches this configuration.",
  USE_NEW_HOME_FOR_IDENTITY:
    "Use a fresh role data folder for a different wallet or deployment. Keep the existing journal.",
  OPERATION_BUSY:
    "The current operation is still finishing. Try again shortly.",
  MAC_ONLY: "This control requires a supported desktop session.",
  MODEL_ID: "Enter the provider/model ID shown by your OpenClaw installation.",
  EVIDENCE_HAS_NO_SIGNING_KEY:
    "Evidence is read-only. Do not give it a wallet private key.",
  WALLET_ALREADY_RUNNING:
    "Another Agent, Node or fleet service is using this wallet under this computer account. Stop that service or choose a different dedicated wallet.",
  LEASE_UNAVAILABLE:
    "The local writer lock could not be acquired. Check storage permissions; do not remove a lock file while a service is running.",
  SETTLEMENT_PAUSED:
    "Settlement is paused on the contract. Claim retries are preserved until settlement resumes.",
  EXTERNAL_NONCE_CHANGED:
    "This wallet has been used outside its retained journal. Stop all writers and reconcile the wallet history.",
  TRANSACTION_DAILY_LIMIT:
    "The authorized transaction limit has been reached. The service retains its work and will check again.",
  GAS_DAILY_LIMIT:
    "The authorized gas budget is reserved. The service will wait for capacity within the rolling budget.",
  INSUFFICIENT_ETH:
    "This signing wallet needs enough ETH for the capped transaction cost.",
  STOP_AND_UNLOCK_FIRST: "Stop this service, unlock the vault and reconcile any pending transaction first.",
  CLAIM_NOT_EXHAUSTED: "This beneficiary does not have an exhausted retry allowance in this journal.",
  CLAIM_REVIEW_REQUIRED: "Review the cause, select a reason and confirm one more bounded retry allowance.",
  WORK_MINUTES: "Enter a whole number of minutes from 1 to 1,440.",
  WORK_REFERENCE: "Use a short reference with letters, numbers, colon, underscore or hyphen. Do not enter secrets.",
  LABOR_ASSUMPTION_RANGE: "Enter a percentage from 0 to 100 for every assumption.",
};
function message(text, bad = false) {
  $("message").textContent = text;
  $("message").className = bad ? "error" : "";
}
async function api(route, body) {
  const r = await fetch("/api/" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await r.json();
  if (!r.ok) throw Error(value.error || "REQUEST_FAILED");
  return value;
}
const list = (id) =>
  $(id)
    .value.split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
function fill(c) {
  for (const k of ["manager", "wallet", "deploymentBlock", "chainId"])
    $(k).value = c[k];
  for (const k of ["trustedBuyers", "excludedParties", "claimBeneficiaries"])
    $(k).value = c[k].join("\n");
  for (const k of ["maxJobUSDC", "maxTransactions24h", "maxGas24hETH"])
    $(k).value = c.limits[k];
  $("independenceConfirmed").checked = c.independenceConfirmed;
  $("modelVeto").checked = c.modelVeto;
  for (const k of ["maxClaimsPerCycle", "shardCount", "shardIndex"])
    $(k).value = c[k];
  $("advanced").value = JSON.stringify(c, null, 2);
}
function draw(s) {
  genesis.render(s);
  walletUI.render({address:s.role === "evidence" ? "" : s.config.wallet,unlocked:s.unlocked,running:s.running,recovery:s.walletRecovery,profile:s.walletProfile});
  $("walletPanel").hidden = s.role === "evidence";
  const roleName = s.role[0].toUpperCase() + s.role.slice(1);
  $("walletProfile").textContent = `${s.walletProfile === "seed" ? "Seed wallet profile" : "Original profile"} · reopen with packages/AGI_${roleName}/Launch.sh`;
  $("legacyRecovery").querySelector("b").textContent = `packages/AGI_${roleName}/Launch.sh`;
  $("appVersion").textContent = "Fleet " + s.version;
  $("wallet").readOnly = Boolean(s.config.wallet);
  $("wallet").value = s.config.wallet;
  $("backupState").textContent = s.backupSaved ? "Current backup confirmed saved." : "Save a current encrypted backup after wallet or configuration changes.";
  $("privateKey").disabled = s.walletKeyPresent !== false;
  current = s;
  $("title").textContent = "Your " + s.role + " machine.";
  $("subtitle").textContent = {
    employer:
      "Accept verified work, open supported disputes and recover unused budgets.",
    evidence:
      "Collect immutable evidence and check the agreed criteria. No signing key.",
    moderator:
      "Resolve supported disputes from evidence, within explicit authority.",
    recovery:
      "Keep eligible jobs and protected payments moving toward closure.",
  }[s.role];
  $("state").textContent = s.status.replaceAll("-", " ");
  $("state").dataset.attention = Boolean(
    s.error ||
      s.paused ||
      s.stats.blockedJobs ||
      s.stats.exhaustedClaims ||
      s.stats.openExceptions ||
      s.status === "settlement-paused",
  );
  $("metrics").innerHTML = [
    ["Jobs tracked", s.stats.jobs],
    ["Open jobs", s.stats.open],
    ["Confirmed actions", s.stats.confirmed],
    ["Pending transactions", s.stats.pending],
    ["Jobs needing attention", s.stats.blockedJobs],
    ["Unpaid beneficiaries", s.stats.unpaidClaims],
  ]
    .map(
      ([l, n]) =>
        `<div class="metric"><strong>${n.toLocaleString()}</strong><span>${l}</span></div>`,
    )
    .join("");
  if (!loaded) {
    fill(s.config);
    loaded = true;
  }
  $("keylabel").hidden = s.role === "evidence" || s.walletRecovery.type === "bip39";
  $("wallet").closest("label").hidden = s.role === "evidence";
  $("independenceConfirmed").closest("label").hidden = s.role !== "moderator";
  for (const id of ["maxTransactions24h", "maxGas24hETH"])
    $(id).closest("label").hidden = s.role === "evidence";
  $("authority").hidden = s.role === "evidence";
  $("claimRenewal").hidden = s.role === "evidence";
  $("workloadSummary").textContent = `${s.stats.confirmed.toLocaleString()} confirmed transactions · ${s.stats.openExceptions.toLocaleString()} open exceptions · ${s.humanMinutesRecorded ? s.humanMinutesRecorded.toLocaleString() + " human minutes recorded (self-reported)" : "No human time recorded; actual workload is unknown"}.`;
  $("humanEntries").replaceChildren();
  for (const entry of s.humanEntries) {
    const row = document.createElement("p"), button = document.createElement("button");
    row.textContent = `${entry.minutes} min · ${entry.category} · ${entry.reference || "no reference"} `;
    button.textContent = "Void mistaken entry";
    button.onclick = async () => { button.disabled = true; try { await api("void-human-work", {id: entry.id}); await refresh(); } catch(e) { message(explanations[e.message] || e.message, true); button.disabled = false; } };
    row.append(button); $("humanEntries").append(row);
  }
  if (!exceptionAfter) drawExceptions(s.exceptions, s.stats.openExceptions);
  $("expectedPhrase").textContent =
    `AUTHORIZE ${s.role.toUpperCase()} ON ${s.config.chainId}`;
  $("authorityStatus").textContent = s.activation
    ? "Authority expires " +
      new Date(s.activation.expires * 1000).toLocaleString() +
      ". Changes to settings require renewed authority."
    : "No standing signing authority.";
  $("deployment").textContent = s.pin
    ? `Verified AGIJobManager ${s.pin.sourceTag}\nChain ${s.pin.chainId} · ${s.pin.manager}\nUSDC ${s.pin.token}`
    : "Deployment has not been verified.";
  $("jobs").innerHTML = s.jobs.length
    ? s.jobs
        .map(
          (j) =>
            `<tr><td>${escape(j.id)}</td><td>${escape(j.status)}</td><td>${escape(j.reason)}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="3">Jobs appear after observation catches up with finalized events.</td></tr>';
  $("claims").innerHTML = s.claims.length
    ? s.claims
        .map(
          (c) =>
            `<div class="claim">${escape(c.beneficiary)}<br>${usdc(c.amount)} USDC last observed · ${escape(c.status)}<br>${c.attempts} attempts this allowance · ${c.lifetime_attempts} lifetime attempts · checked ${c.checked ? new Date(c.checked*1000).toLocaleString() : "before this upgrade"}</div>`,
        )
        .join("")
    : "<p>No unpaid claims currently recorded for the configured beneficiaries.</p>";
  if (s.error)
    message(explanations[s.error] || s.error.replaceAll("_", " "), true);
}
function drawExceptions(items, total) {
  exceptionNext = items.length === 50 ? items.at(-1).key : null;
  $("exceptionCount").textContent = `${total.toLocaleString()} open exceptions · ${items.length} shown${exceptionAfter ? " on this page" : " from the start"}. Refresh returns to the first page.`;
  $("exceptions").innerHTML = items.length ? items.map(e => `<div class="claim"><strong>${escape(e.key)}</strong><br>${escape(explanations[e.code] || e.code.replaceAll("_", " "))}<br>First seen ${new Date(e.first_seen*1000).toLocaleString()} · last seen ${new Date(e.last_seen*1000).toLocaleString()} · ${e.occurrences} observations</div>`).join("") : "<p>No open exceptions on this page. This does not establish zero outstanding funds.</p>";
  $("exceptionNext").disabled = !exceptionNext;
}
function download(value, name) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2) + "\n"], {
        type: "application/json",
      }),
    );
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function refresh() {
  try { draw(await api("status")); } catch(e) { walletUI.clear(); throw e; }
}
function action(id, fn) {
  $(id).onclick = async () => {
    const b = $(id);
    b.disabled = true;
    try {
      await fn();
      await refresh();
      if (!current.error) message("Done. The current state is shown above.");
    } catch (e) {
      message(explanations[e.message] || e.message.replaceAll("_", " "), true);
    } finally {
      b.disabled = false;
      if (b.id === "backupSaved") genesis.syncBackup();
    }
  };
}
action("refresh", async () => { exceptionAfter = ""; await refresh(); });
action("exceptionFirst", async () => { exceptionAfter = ""; await refresh(); });
action("exceptionNext", async () => {
  exceptionAfter = exceptionNext || "";
  const page = await api("exceptions", {after: exceptionAfter, limit: 50});
  drawExceptions(page.items, page.totalOpen);
});
action("workloadExport", async () => download(await api("workload"), "AGI-Fleet-Workload.json"));
action("recordHuman", async () => {
  const data = {category: $("humanCategory").value, minutes: Number($("humanMinutes").value), reference: $("humanReference").value.trim()};
  const fingerprint = JSON.stringify(data);
  if (!humanSubmission || humanSubmission.fingerprint !== fingerprint) humanSubmission = {fingerprint, id: crypto.randomUUID()};
  await api("human-work", {id: humanSubmission.id, ...data});
  humanSubmission = null;
  $("humanReference").value = "";
  $("humanMinutes").value = "";
});
action("renewClaim", async () => {
  await api("renew-claim", {beneficiary: $("renewBeneficiary").value.trim(), reason: $("renewReason").value, confirm: $("renewConfirm").checked});
  $("renewConfirm").checked = false;
});
action("calculateLabor", async () => {
  for (const input of $("laborInputs").querySelectorAll("input")) if (input.value === "" || !input.checkValidity()) throw Error("LABOR_ASSUMPTION_RANGE");
  const assumptions = Object.fromEntries(Object.keys(laborCategories).map(k => [k, {coverage: Number($("coverage-"+k).value)/100, completion: Number($("completion-"+k).value)/100}]));
  laborEstimate = await api("labor-estimate", {caseId: $("laborCase").value, assumptions});
  const hours = n => (n/60).toLocaleString(undefined,{maximumFractionDigits:1});
  $("laborResult").textContent = `Modeled only: ${hours(laborEstimate.baselineMinutes)} baseline hours; ${hours(laborEstimate.potentiallyAvoidedMinutes)} potentially avoided; ${hours(laborEstimate.estimatedRemainingMinutes)} remaining (${(laborEstimate.reductionFraction*100).toFixed(1)}% reduction), plus unmeasured work. At day 180 the source scenario still has ${laborEstimate.scenario.unpaidBeneficiaries} unpaid beneficiaries and ${usdc(laborEstimate.scenario.claimMicroUSDC)} USDC in claims.`;
  $("laborExport").disabled = false;
});
for (const input of [$("laborCase"), ...$("laborInputs").querySelectorAll("input")]) input.addEventListener("input", () => { laborEstimate = null; $("laborExport").disabled = true; $("laborResult").textContent = "Assumptions changed. Calculate again."; });
action("laborExport", async () => { if (laborEstimate) download(laborEstimate, "AGI-Fleet-Labor-Scenario.json"); });
action("unlock", async () => {
  try { await api("unlock", { password: $("password").value }); } finally { $("password").value = ""; }
});
action("lock", () => { walletUI.clear(); return api("lock", {}); });
action("pause", () => api("pause", {}));
action("stop", () => api("stop", {}));
action("save", async () => {
  const c = JSON.parse($("advanced").value);
  for (const k of ["manager", "wallet"]) c[k] = $(k).value.trim();
  for (const k of ["deploymentBlock", "chainId"]) c[k] = Number($(k).value);
  for (const k of ["trustedBuyers", "excludedParties", "claimBeneficiaries"])
    c[k] = list(k);
  for (const k of ["maxJobUSDC", "maxGas24hETH"])
    c.limits[k] = $(k).value.trim();
  c.limits.maxTransactions24h = Number($("maxTransactions24h").value);
  c.independenceConfirmed = $("independenceConfirmed").checked;
  c.modelVeto = $("modelVeto").checked;
  for (const k of ["maxClaimsPerCycle", "shardCount", "shardIndex"])
    c[k] = Number($(k).value);
  const secrets = Object.fromEntries(
    ["rpcURL", "verificationRPCURL", "privateKey"].map((k) => [
      k,
      $(k).value.trim(),
    ]),
  );
  await api("config", { config: c, secrets });
  for (const k of Object.keys(secrets)) $(k).value = "";
  loaded = false;
});
action("useAdvanced", () => fill(JSON.parse($("advanced").value)));
action("enroll", () => api("enroll", {}));
action("observe", () => api("start", { mode: "observe" }));
action("live", () => api("start", { mode: "live" }));
action("activate", () =>
  api("activate", {
    phrase: $("phrase").value,
    days: Number($("days").value),
    independence: $("independenceConfirmed").checked,
  }),
);
action("export", async () =>
  download(await api("export"), "AGI-Fleet-Evidence.json"),
);
action("monitor", async () =>
  download(await api("monitor"), "AGI-Fleet-Read-Only-Monitor.json"),
);
action("kit", async () =>
  download(
    await api("openclaw-kit", { model: $("model").value.trim() }),
    `AGI-${current.role[0].toUpperCase()+current.role.slice(1)}-OpenClaw-Setup.json`,
  ),
);
action("testModel", () => api("test-model", {}));
action("remember", () => api("remember", { enabled: true }));
action("forget", () => api("remember", { enabled: false }));
action("background", () => api("background", { enabled: true }));
action("noBackground", () => api("background", { enabled: false }));
action("backup", async () => {
  try {
    download(await api("backup", {password:$("backupPassword").value}), `AGI-Fleet-${current.role}-${current.walletProfile}-${current.config.wallet.slice(0,10)}-Encrypted-Backup.json`);
    $("backupSaved").hidden = false;
  } finally { $("backupPassword").value = ""; }
});
action("backupSaved", async () => { await api("backup/saved", {}); $("backupSaved").hidden = true; });
action("restore", async () => {
  const f = $("restoreFile").files[0];
  if (!f) throw Error("SELECT_BACKUP_FILE");
  await api("restore", {
    envelope: JSON.parse(await f.text()),
    password: $("backupPassword").value,
  });
  $("backupPassword").value = "";
  loaded = false;
});
let fleetView='overview';
const fleetPanels=[...document.querySelector('main').children].filter(el=>el.tagName==='SECTION');
for(const panel of fleetPanels){const title=panel.querySelector('h2')?.textContent??'';panel.dataset.fleetPanel=panel.classList.contains('genesis-center')||panel.id==='metrics'?'overview':panel.id==='access'||panel.id==='walletPanel'?'wallet':title.startsWith('2.')||title.startsWith('3.')?'connections':title.startsWith('4.')?'authority':title==='Keep this computer ready'?'backup':'activity';}
function fleetShow(view){fleetView=view;window.dispatchEvent(new Event('agi-view-change'));for(const panel of fleetPanels)panel.classList.toggle('fleet-view-hidden',panel.dataset.fleetPanel!==view);for(const button of document.querySelectorAll('[data-fleet-view]')){button.classList.toggle('active',button.dataset.fleetView===view);button.setAttribute('aria-current',button.dataset.fleetView===view?'page':'false');}window.scrollTo(0,0);}
for(const b of document.querySelectorAll('[data-fleet-view]'))b.onclick=()=>fleetShow(b.dataset.fleetView);
fleetShow('overview');
const genesis=window.AGIGenesis({api,refresh,role:'fleet',goWallet:()=>{fleetShow('wallet');const target=$('walletNew').hidden?$('revealPassword'):$('walletWords');target.scrollIntoView({block:'center'});target.focus();},goCompute:()=>fleetShow('connections'),goBackup:()=>{fleetShow('backup');$('verifyBackupFile').scrollIntoView({block:'center'});$('verifyBackupFile').focus();},goSetup:()=>{fleetShow('wallet');$('password').scrollIntoView({block:'center'});$('password').focus();}});
const walletUI = window.AGIWalletUI({api,refresh,message:(text,bad)=>message(explanations[text] || text,bad),continueBackup:()=>{fleetShow("backup");$("backupPassword").scrollIntoView({block:"center"});$("backupPassword").focus();},name:"Fleet",launcher:"packages/AGI_ROLE/Launch.sh",seedLauncher:"packages/AGI_ROLE/Launch.sh"});
refresh().catch((e) => message(explanations[e.message] || e.message, true));
setInterval(() => refresh().catch(() => {}), 5000);
