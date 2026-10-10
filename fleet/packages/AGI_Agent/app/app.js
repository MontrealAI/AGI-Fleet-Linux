let publicBrowserUI = null, statusRefreshSequence = 0;
const $ = (id) => document.getElementById(id);
let csrf = "",
  state = null,
  lastConfig = "",
  lastSettings = "",
  challenge = null;
const titles = {
  studio: "Work Studio",
  operations: "Operations",
  overview: "Overview",
  setup: "Wallet & setup",
  intelligence: "Intelligence & delivery",
  policy: "Jobs & limits",
  activity: "Activity",
  recovery: "Backup & startup",
  help: "Help & recovery",
};
function show(view) {
  if (typeof clearWalletSecrets === "function") clearWalletSecrets();
  for (const section of document.querySelectorAll(".view"))
    section.hidden = section.id !== view;
  for (const b of document.querySelectorAll("[data-view]"))
    b.classList.toggle("active", b.dataset.view === view);
  $("pageTitle").textContent = titles[view];
}
for (const b of document.querySelectorAll("[data-view],[data-go]"))
  b.onclick = () => show(b.dataset.view ?? b.dataset.go);
function notice(text, good = false) {
  $("notice").textContent = text;
  $("notice").className = good ? "success" : "";
  $("notice").hidden = false;
}
async function api(route, input) {
  const r = await fetch(route, {
    method: input === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers:
      input === undefined
        ? {}
        : { "Content-Type": "application/json", "X-AGI-CSRF": csrf },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const body = await r.json();
  if (!r.ok) {const error=Error(body.error?.title + ". " + body.error?.action);error.code=body.error?.code;throw error;}
  return body;
}
function action(id, fn) {
  $(id).addEventListener(
    $(id).tagName === "FORM" ? "submit" : "click",
    async (e) => {
      e.preventDefault();
      const b =
        $(id).tagName === "FORM" ? $(id).querySelector("button") : $(id);
      b.disabled = true;
      try {
        await fn();
        await refresh();
      } catch (e) {
        notice(e.message);
      } finally {
        b.disabled = false;
      if (b.id === "backupSaved") genesis.syncBackup();
      syncComputeIdentityControls();
      }
    },
  );
}
function download(name, value, type = "application/json") {
  const url = URL.createObjectURL(
    new Blob(
      [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
      { type },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const list = (id) =>
  $(id)
    .value.split(/[\s,]+/)
    .filter(Boolean);
const human = (s) =>
  String(s ?? "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .toLowerCase();
function cell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}
function fill(s) {
  const c = s.config,
    key = JSON.stringify(c);
  if (key === lastConfig) return;
  lastConfig = key;
  const values = {
    chain: c.chainId,
    manager: c.manager,
    block: c.deploymentBlock || "",
    buyers: c.trustedBuyers.join("\n"),
    excluded: c.excludedParties.join("\n"),
    proof: c.proof.join("\n"),
    label: c.label,
    gateway: c.ipfsGateway,
    hosts: c.allowedHttpsHosts.join("\n"),
    minReward: c.execution.minRewardUSDC,
    maxBond: c.limits.maxBondUSDC,
    openBond: c.limits.maxOpenBondUSDC,
    dailyBond: c.limits.maxBond24hUSDC,
    maxJob: c.limits.maxJobUSDC,
    txETH: c.limits.maxTxETH,
    recoveryFinalizeGas: c.limits.maxFinalizeGas,
    recoveryTxETH: c.limits.maxTxETH,
    recoveryDailyETH: c.limits.maxGas24hETH,
    txGasUnits: c.limits.maxTxGas,
    finalizeGasUnits: c.limits.maxFinalizeGas,
    dailyGas: c.limits.maxGas24hETH,
    dailyTx: c.limits.maxTransactions24h,
    activeJobs: c.execution.maxActiveJobs,
    shardCount: c.execution.shardCount,
    shardIndex: c.execution.shardIndex,
  };
  for (const [id, v] of Object.entries(values)) $(id).value = v;
  for (const [id, v] of Object.entries({
    publicData: c.execution.publicDataOnly,
    publicPublishing: c.execution.publicPublishing,
    envelopes: c.execution.allowEnvelopes,
    computerJobs: c.execution.allowComputerWork === true,
    imageJobs: c.execution.allowImages === true,
    autoClaim: c.autoClaim,
    finalize: c.autoFinalizeOwnJobs,
  }))
    $(id).checked = v;
}
async function refresh() {
  const sequence=++statusRefreshSequence;
  try {
    const s = await api("/api/status");
    if(sequence!==statusRefreshSequence)return;
    state = s; syncComputeIdentityState(s.companion); genesis.render(s);
    publicBrowserUI?.sync();
    if ($("appVersion")) $("appVersion").textContent = s.version;
    $("vaultForm").hidden = s.unlocked;
    csrf = s.csrf;
    fill(s);
    $("disconnected").hidden = true;
    $("vaultAction").textContent = s.vaultExists
      ? "Unlock vault"
      : "Create encrypted vault";
    $("vaultState").textContent = s.unlocked
      ? "Unlocked on this computer."
      : s.vaultExists
        ? "Locked. Enter your password to continue."
        : "No vault yet.";
    renderWallet(s);
    $("wallet").disabled = s.walletPresent || !s.unlocked;
    $("mode").textContent = s.paused ? "Signing paused" : s.mode;
    $("headline").textContent = s.running
      ? s.mode === "live"
        ? "Working within your authority."
        : "Previewing opportunities."
      : "Ready when you are.";
    $("runtime").textContent =
      s.runtime?.message ||
      human(s.runtime?.reason || s.runtime?.status) ||
      "Complete the three setup steps, save a backup, then preview opportunities.";
    $("freshness").textContent = s.runtime?.updated
      ? "Last cycle: " + new Date(s.runtime.updated).toLocaleString()
      : "No chain cycle yet.";
    $("assigned").textContent = s.assignedTotal;
    $("txCount").textContent =
      s.budgets.transactions + " / " + s.budgets.transactionLimit;
    $("gas").textContent = s.budgets.gasUsedETH + " ETH";
    $("aiCalls").textContent =
      (s.companion.usage?.reservedSlots24h ?? s.companion.calls24h ?? 0) + " local slots / " + (s.companion.limits?.effectiveCalls24h ?? "effective limit unverified");
    const ready = [
      [
        s.operations?.verificationConfigured === true,
        "Verification RPC configured",
      ],
      [
        s.config.independenceReviewed === true,
        "Related-party independence reviewed",
      ],
      [s.vaultExists && s.unlocked, "Vault unlocked"],
      [s.walletPresent, "Dedicated wallet created"],
      ...(s.walletRecovery?.type === "bip39" ? [[s.walletRecovery.confirmed, "Recovery phrase copy verified"]] : []),
      [s.enrolled, "Exact deployment verified"],
      [s.companion.testedAt > 0, "Inference test recorded"],
      [s.config.trustedBuyers.length > 0, "Buyer scope chosen"],
      [
        s.config.execution.publicDataOnly &&
          s.config.execution.publicPublishing,
        "Public data and publishing authorized",
      ],
      [s.settings.backupSaved, "Current encrypted backup saved"],
    ];
    if (s.config.chainId === 1)
      ready.push([
        s.operations?.cases?.every((x) => x.status === "pass") === true,
        "Mainnet commissioning recorded",
      ]);
    $("readiness").replaceChildren(
      ...ready.map(([ok, label]) => {
        const li = document.createElement("li");
        li.textContent = (ok ? "✓ " : "○ ") + label;
        return li;
      }),
    );
    $("health").textContent = s.health
      ? `ETH: ${s.health.eth} · USDC: ${s.health.usdc} · ${s.health.eligible ? "Role authorization verified via " + s.health.route + ". Rechecked before new work." : s.health.eligibility === "unverified" ? "Role authorization unverified. Check connection, wallet and identity." : "Wallet is not authorized for the Agent role. Check eligibility settings."}`
      : "Verify the deployment to check this wallet.";
    $("aiStatus").textContent = companionStatusText(s.companion);
    if (document.activeElement !== $("calls"))
      $("calls").value = s.companion.config.maxCalls24h;
    $("briefText").textContent = s.companion.lastBrief?.summary ?? "";
    const rows = s.jobs.map((j) => {
      const tr = document.createElement("tr");
      tr.append(
        cell(j.id),
        cell(human(j.status)),
        cell(j.explanation?.title ?? human(j.reason)),
      );
      const td = cell("");
      if (
        [
          "ready",
          "assigned",
          "submitted",
          "terminal",
          "disputed",
          "attention",
        ].includes(j.status)
      ) {
        const b = document.createElement("button");
        b.textContent = "Download";
        b.onclick = async () => {
          try {
            const d = await api("/api/delivery?id=" + encodeURIComponent(j.id));
            if(d.file){const bytes=Uint8Array.from(atob(d.file),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:d.mediaType}));const a=document.createElement("a");a.href=url;a.download="AGI-Job-"+j.id+"."+d.extension;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}else download("AGI-Job-" + j.id + ".txt", d.content, "text/plain");
          } catch (e) {
            notice(e.message);
          }
        };
        td.append(b);
      }
      tr.append(td);
      return tr;
    });
    $("jobs").replaceChildren(...rows);
    $("empty").hidden = rows.length > 0;
    $("transactions").replaceChildren(
      ...s.transactions.map((t) => {
        const d = document.createElement("div");
        d.className = "tx";
        d.textContent = `${human(t.kind)} · ${human(t.state)}${t.status === 0 ? " · reverted" : ""} · Job ${t.job ?? "—"} · ${t.hash}`;
        return d;
      }),
    );
    $("incidents").replaceChildren(
      ...s.incidents.map((i) => {
        const d = document.createElement("div");
        d.className = "incident";
        d.textContent = `${i.title}. ${i.action}`;
        return d;
      }),
    );
    const settingsKey = JSON.stringify([
      s.settings,
      s.companion.config.autoBrief,
    ]);
    if (settingsKey !== lastSettings) {
      lastSettings = settingsKey;
      $("remember").checked = s.settings.remember;
      $("background").checked = s.settings.background;
      $("autoResume").checked = s.settings.resumeOnLaunch;
      $("autoBrief").checked = s.companion.config.autoBrief;
    }
    $("remember").disabled = !s.keychainSupported;
    $("saveRemember").disabled = !s.keychainSupported;
    $("saveStartup").disabled = !s.backgroundSupported;
  } catch (e) {
    clearWalletSecrets();
    $("disconnected").hidden = false;
  }
}
action("vaultForm", async () => {
  try {
    await api(state.vaultExists ? "/api/unlock" : "/api/vault/create", { password: $("password").value });
  } finally { $("password").value = ""; }
  notice("Your vault is unlocked.", true);
});
action("quit", async () => {
  await api("/api/quit", {});
  notice("The application is closing. You can close this tab.", true);
});

action("rpcForm", async () => {
  await api("/api/rpc", { url: $("rpc").value });
  $("rpc").value = "";
  notice("Blockchain connection saved securely.", true);
});
action("deploymentForm", async () => {
  await api("/api/config", {
    chainId: Number($("chain").value),
    manager: $("manager").value.trim(),
    deploymentBlock: Number($("block").value),
  });
  notice(
    "Deployment saved. Add approved buyers, then verify the contract.",
    true,
  );
});
action("discoverForm", async () => {
  await api("/api/discover", { transactionHash: $("receipt").value.trim() });
  notice("Deployment found.", true);
});
for (const [id, route, msg] of [
  ["enroll", "enroll", "Exact manager and library code verified."],
  ["check", "check", "Wallet and contract checked."],
  ["stop", "stop", "Worker stopped. Accepted job deadlines continue."],
  ["lock", "lock", "Worker stopped and wallet locked."],
  [
    "pause",
    "pause",
    "New signing paused. Already broadcast transactions can still execute.",
  ],
  ["resume", "resume", "Signing pause cleared after checks."],
])
  action(id, async () => {
    if (id === "lock") clearWalletSecrets();
    await api("/api/" + route, {});
    notice(msg, true);
  });
action("observe", async () => {
  await api("/api/start", { mode: "observe" });
  notice(
    "Preview mode started. No AI requests, uploads or transactions.",
    true,
  );
});
action("live", async () => {
  await api("/api/start", { mode: "live" });
  notice("Autonomous work started within your authorized limits.", true);
});
action("authorize", async () => {
  challenge = await api("/api/activation/challenge", {});
  $("authorityDetails").textContent = JSON.stringify(challenge, null, 2);
  $("riskAck").checked = false;
  $("scopeAck").checked = false;
  $("authorization").showModal();
});
action("confirmAuthority", async () => {
  if (!$("riskAck").checked || !$("scopeAck").checked)
    throw Error("Review both choices before authorizing.");
  await api("/api/activate", {
    id: challenge.id,
    acknowledgeRisk: true,
    independentReview: true,
  });
  $("authorization").close();
  notice("Authority recorded. Choose Start autonomous work when ready.", true);
});
action("kit", async () => {
  if (!$("kitConsent").checked)
    throw Error("Review and confirm the connection choice first.");
  download(
    "AGI-Agent-OpenClaw-Setup.json",
    await api("/api/companion/kit", { acknowledge: true, mode: $("workMode").value }),
  );
  notice(
    "Private initial setup file downloaded. This rotates the connection token. A signer-only in-place update does not require this file. For an explicitly chosen initial installation, privately transfer it to the separate Standard compute account with that account ownership and 0600 permissions, then follow the clean-install guide. Preserve retained profiles and evidence.",
    true,
  );
});
action("testComputer", async () => {
  const r=await api("/api/companion/workstation-test",{});
  const bytes=Uint8Array.from(atob(r.zip),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:"application/zip"}));
  const link=document.createElement("a");link.href=url;link.download="AGI-Test-Documents.zip";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice(r.note,true);
});
action("testImage", async () => {
  const r=await api("/api/companion/image-test",{});
  const bytes=Uint8Array.from(atob(r.image),c=>c.charCodeAt(0)), url=URL.createObjectURL(new Blob([bytes],{type:"image/png"}));
  const link=document.createElement("a");link.href=url;link.download="AGI-Test-Image.png";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  notice(r.note,true);
});
action("testAI", async () => {
  await api("/api/companion/test", {});
  notice("OpenClaw returned a valid model response.", true);
});
action("aiSettings", async () => {
  await api("/api/companion/config", {
    config: {
      ...state.companion.config,
      maxCalls24h: Number($("calls").value),
      autoBrief: $("autoBrief").checked,
    },
  });
  notice(
    "AI preferences saved. Test the connection again before live operation.",
    true,
  );
});
action("brief", async () => {
  const r = await api("/api/companion/brief", {});
  $("briefText").textContent = r.summary;
});
action("publisher", async () => {
  const r = await api("/api/publisher/check", {});
  $("publisherStatus").textContent =
    "Local IPFS service connected · Kubo " +
    r.version +
    ". Public retrieval is checked for each deliverable.";
});
action("saveConsent", async () => {
  await api("/api/config", {
    execution: {
      ...state.config.execution,
      publicDataOnly: $("publicData").checked,
      publicPublishing: $("publicPublishing").checked,
    },
  });
  notice("Your public-data choices are saved.", true);
});
action("policyForm", async () => {
  const c = state.config;
  await api("/api/config", {
    trustedBuyers: list("buyers"),
    excludedParties: list("excluded"),
    label: $("label").value.trim(),
    proof: list("proof"),
    allowedHttpsHosts: list("hosts"),
    ipfsGateway: $("gateway").value.trim(),
    autoClaim: $("autoClaim").checked,
    autoFinalizeOwnJobs: $("finalize").checked,
    execution: {
      ...c.execution,
      minRewardUSDC: $("minReward").value,
      maxActiveJobs: Number($("activeJobs").value),
      shardIndex: Number($("shardIndex").value),
      shardCount: Number($("shardCount").value),
      allowEnvelopes: $("envelopes").checked,
      allowComputerWork: $("computerJobs").checked,
      allowImages: $("imageJobs").checked,
    },
    limits: {
      ...c.limits,
      maxBondUSDC: $("maxBond").value,
      maxOpenBondUSDC: $("openBond").value,
      maxBond24hUSDC: $("dailyBond").value,
      maxJobUSDC: $("maxJob").value,
      maxTxETH: $("txETH").value,
      maxTxGas: Number($("txGasUnits").value),
      maxFinalizeGas: Number($("finalizeGasUnits").value),
      maxGas24hETH: $("dailyGas").value,
      maxTransactions24h: Number($("dailyTx").value),
    },
  });
  notice(
    "Policy saved. Save a new backup before authorizing live operation.",
    true,
  );
});
action("settlementBudgetForm", async () => {
  await api("/api/settlement-budget", {
    acknowledge: $("recoveryConsent").checked,
    limits: {
      maxFinalizeGas: Number($("recoveryFinalizeGas").value),
      maxTxETH: $("recoveryTxETH").value.trim(),
      maxGas24hETH: $("recoveryDailyETH").value.trim(),
    },
  });
  $("recoveryConsent").checked = false;
  notice(
    "Settlement budgets saved. Prepared work and transaction history are retained. Review commissioning evidence, save a NEW backup and authorize again. Any STOP remains in place.",
    true,
  );
});
action("backupForm", async () => {
  download(
    `AGI-Agent-${state.walletProfile === "seed" ? "seed-profile" : "original-profile"}-${state.config.agent.slice(0,10)}-encrypted-backup.agiagentbackup`,
    await api("/api/backup", { password: $("backupPassword").value }),
  );
  $("backupPassword").value = "";
  notice("Select the actual downloaded file below, verify it, then store a copy off this computer.", true);
});
action("backupSaved", async () => {
  await api("/api/backup/saved", {});
  notice("Backup confirmed.", true);
});
action("restoreForm", async () => {
  const file = $("backupFile").files[0];
  if (!file || file.size > 64 * 1024 * 1024)
    throw Error("Choose a valid backup under 64 MiB.");
  await api("/api/restore", {
    backup: JSON.parse(await file.text()),
    password: $("restorePassword").value,
    acknowledge: $("restoreConsent").checked,
  });
  $("restorePassword").value = "";
  lastConfig = "";
  notice(
    "Backup restored. Reconnect OpenClaw, verify IPFS availability and reconcile wallet history before live operation.",
    true,
  );
});
action("reconcile", async () => {
  await api("/api/restore/check", {});
  notice(
    "Recorded transaction history checked. Create a current backup and authorize again.",
    true,
  );
});
action("saveRemember", async () => {
  await api("/api/remember", { enabled: $("remember").checked });
  notice("Mac unlock choice saved.", true);
});
action("saveStartup", async () => {
  await api("/api/background", {
    enabled: $("background").checked,
    resumeOnLaunch: $("autoResume").checked,
  });
  notice("Startup choice saved for your next Mac login.", true);
});
action("report", async () =>
  download("AGI-Agent-operating-report.json", await api("/api/report")),
);
action("demo", async () => {
  const spec = {
      schema: "agi-node-job/v1",
      profile: "json-rules/v1",
      title: "Return a ready status",
      rules: [{ id: "status", path: "/status", op: "equals", value: "ready" }],
    },
    delivery = JSON.stringify({ status: "ready" });
  const r = await api("/api/lab", {
    specification: JSON.stringify(spec),
    delivery: btoa(delivery),
  });
  $("demoResult").textContent =
    `Example delivery: ${delivery}\nFormal check: ${r.decision === "approve" ? "PASS" : "FAIL"}\nNo external services, wallet or publishing were used.\nThis demonstrates formal checking, not model intelligence.`;
});
const genesis=window.AGIGenesis({api:(route,body)=>api('/api/'+route,body),refresh,role:'agent',goWallet:()=>{show('setup');const target=$('walletNew').hidden?$('revealPassword'):$('walletWords');target.scrollIntoView({block:'center'});target.focus();},goCompute:()=>show('intelligence'),goStudio:()=>show('studio'),goBackup:()=>{show('recovery');$('verifyBackupFile').focus();},goSetup:()=>{show('setup');$('password').focus();}});
const walletUI=window.AGIWalletUI({api:(route,body)=>api('/api/'+route,body),refresh,message:(text,bad)=>notice(text,!bad),name:'Agent',launcher:'Launch.sh',seedLauncher:'Launch.sh',createID:'wallet',continueBackup:()=>{show('recovery');$('backupPassword').focus();}});
function clearWalletSecrets(){walletUI.clear();}
function renderWallet(s){walletUI.render({address:s.config.agent,unlocked:s.unlocked,running:s.running,recovery:s.walletRecovery,profile:s.walletProfile});$('overviewAddress').value=s.config.agent||'';$('overviewWallet').hidden=!s.config.agent;$('copyOverviewAddress').disabled=!s.config.agent;}
action('copyOverviewAddress',()=>walletUI.copyAddress('overviewAddress','overviewCopyStatus'));
(async () => {
  try {
    const token = location.hash.slice(1);
    history.replaceState(null, "", location.pathname);
    if (token) {
      const r = await api("/api/session", { token });
      csrf = r.csrf;
    }
    await refresh();
    setInterval(refresh, 5000);
  } catch (e) {
    notice(e.message);
    $("disconnected").hidden = false;
  }
})();

function companionAvailability(a){
 const errors={COMPANION_COMPUTE_POLICY_CHANGED:'awaiting_identity_approval',COMPANION_COMPUTE_APPROVAL_CHANGED:'awaiting_identity_approval',COMPANION_COOLDOWN:'local_pacing',COMPANION_RATE_LIMITED:'provider_rate_limit',COMPANION_DAILY_LIMIT:'daily_allowance_exhausted',COMPANION_AUTH_FAILED:'authentication_required',COMPANION_TOKEN_REQUIRED:'authentication_required',COMPANION_BUSY:'request_in_progress',COMPANION_UNAVAILABLE:'compute_unavailable',COMPANION_COMPUTE_UNAVAILABLE:'compute_unavailable',COMPANION_COMPUTE_CLEANUP_REQUIRED:'cleanup_reconciliation_required',COMPANION_APPROVAL_RECONCILIATION_REQUIRED:'approval_reconciliation_required'};
 const cause=a?.pacing?.cause??(a?.busy?'request_in_progress':errors[a?.lastError])??(a?.approval?.awaitingApproval?'awaiting_identity_approval':'ready');
 const labels={approval_reconciliation_required:'Approval persistence reconciliation required. Further inference is blocked. Preserve the existing signer state and use the reviewed recovery procedure.',awaiting_identity_approval:'Awaiting identity approval. Review the authenticated proposed identity below.',local_pacing:'Local request pacing.',provider_rate_limit:'Provider rate limit. Check the subscription usage shown by the provider.',daily_allowance_exhausted:'Local daily allowance exhausted.',authentication_required:'Authentication required. Check the existing dedicated connection.',request_in_progress:'Request in progress. Wait for its recorded outcome or cancel it.',compute_unavailable:'Compute unavailable. Inspect the existing compute account before retrying.',cleanup_reconciliation_required:'Cleanup reconciliation required. Preserve the compute account and STOP evidence; use the reviewed recovery procedure.',ready:'No local pacing block recorded. Current compute availability requires an authenticated check.'};
 const next=a?.pacing?a.pacing.nextAttemptAt:a?.nextAttemptAt,remaining=Number.isFinite(next)?Math.max(0,Math.ceil((next-Date.now())/1000)):0;
 const local=a?.pacing?.localRetryAt,localRemaining=Number.isFinite(local)?Math.max(0,Math.ceil((local-Date.now())/1000)):0;
 if(cause==='daily_allowance_exhausted'&&a?.pacing?.source==='compute')return 'Compute daily allowance exhausted. The compute reset time is not reported.'+(localRemaining>0?' Local earliest retry: '+new Date(local).toLocaleString()+' ('+localRemaining+' seconds). This is local request pacing, not an allowance reset.':'');
 return (labels[cause]??'Current availability is unverified.')+(remaining>0?' '+remaining+' seconds remaining. Next attempt: '+new Date(next).toLocaleString()+'.':'');
}
function companionUsageText(a){
 const limits=a?.limits??{},usage=a?.usage??{},configured=limits.configuredSignerCalls24h??a?.config?.maxCalls24h??'unknown';
 const compute=Number.isFinite(limits.computeRuns24h)?limits.computeRuns24h+' workflow starts / 24 h':'unreported by this compute runtime';
 const images=Number.isFinite(limits.computeImages24h)?limits.computeImages24h+' / 24 h':'unreported';
 const effective=Number.isFinite(limits.effectiveCalls24h)?limits.effectiveCalls24h+' workflow starts / 24 h':'unknown until the compute limit is verified';
 const capacity=a?.cleanupCapacity;const cleanup=capacity?' Cleanup evidence: '+capacity.activeAttempts+' active attempts, '+capacity.archivedAttempts+' archived; '+capacity.remainingAttempts+' active slots available. '+(capacity.warning==='NONE'?'Completed evidence rotates automatically and remains retained.':'Capacity attention: '+String(capacity.warning).replaceAll('_',' ')+'. Inspect Inspect.sh in the compute account.') :'';
 return 'Configured signer limit: '+configured+' reserved slots / 24 h. Compute enforced limit: '+compute+'. Compute image limit: '+images+'. Effective workflow limit: '+effective+'. Attempt totals: unreported. Local reserved slots: '+(usage.reservedSlots24h??a?.calls24h??0)+'. Dispatched requests: '+(usage.dispatchedRequests24h??'unknown')+'. Compute reserved image attempts: '+(usage.computeReservedImages24h??'unreported')+'. Actual provider calls, tool runs and billable usage: unknown; local counters are not provider consumption.'+cleanup;
}
function companionStatusText(a){
 const tested=Number.isFinite(a?.testedAt)&&a.testedAt>0;
 const history=tested?'Inference test recorded '+new Date(a.testedAt).toLocaleString()+'.':'No successful inference test recorded.';
 const status=key=>String(a?.qualification?.[key]?.status??'NOT TESTED').replaceAll('_',' ');
 const browserScope=a?.qualification?.browser?.scope==='Limited technical browser commissioning'?' (limited technical commissioning; further security checks pending)':'';
 return (a?.config?.enabled?'':'Companion is off. ')+companionAvailability(a)+' '+history+' Recorded checks — Tools: '+status('tools')+' · Browser transport: '+status('browser')+browserScope+' · Independent acceptance: unverified · Settlement: unverified · Production: '+status('production')+'.';
}
let reviewedComputeIdentity=null, computeIdentityBusy=false, computeIdentityGeneration=0, lastIdentityInspectionAt=null;
function clearComputeIdentityReview(){reviewedComputeIdentity=null;$('computeIdentityConsent').checked=false;}
function syncComputeIdentityControls(){
 const a=state?.companion,next=a?.pacing?(a.pacing.nextAttemptAt??a.pacing.localRetryAt):a?.nextAttemptAt;
 const paced=['local_pacing','provider_rate_limit','daily_allowance_exhausted'].includes(a?.pacing?.cause)&&Number.isFinite(next)&&next>Date.now();
 $('approveComputeIdentity').disabled=computeIdentityBusy||Boolean(a?.busy||a?.approval?.active)||paced||!reviewedComputeIdentity||!$('computeIdentityConsent').checked;
 $('computeIdentityConsent').disabled=computeIdentityBusy;
 $('inspectComputeIdentity').disabled=computeIdentityBusy;
 $('cancelComputeIdentity').disabled=!computeIdentityBusy&&!reviewedComputeIdentity&&!a?.approval?.active;
 $('computeIdentityReview').setAttribute('aria-busy',String(computeIdentityBusy));
 const blocked=computeIdentityBusy||Boolean(a?.busy||a?.approval?.active||a?.approval?.awaitingApproval)||paced||['cleanup_reconciliation_required','approval_reconciliation_required','authentication_required','compute_unavailable','daily_allowance_exhausted'].includes(a?.pacing?.cause);
 for(const id of ['testAI','testComputer','testImage','brief'])if($(id))$(id).disabled=blocked;
}
function syncComputeIdentityState(a){
 if(reviewedComputeIdentity&&!computeIdentityBusy){
  if(reviewedComputeIdentity.proposal.expiresAt<=Date.now()){
   clearComputeIdentityReview();$('computeIdentityResult').textContent='The reviewed proposal expired. Review the current identity again; no approval was submitted.';
  }else if(Number.isSafeInteger(a?.bindingRevision)&&a.bindingRevision!==reviewedComputeIdentity.proposal.revision){
   clearComputeIdentityReview();$('computeIdentityResult').textContent='The saved binding changed, possibly in another tab. Review the current identity again before approving.';
  }
 }
 const status=$('computeAvailability');if(status)status.textContent=companionAvailability(a);
 const stages=$('computeCommissioningStages');if(stages)stages.textContent='Installation: use the retained compute installation report; not revalidated by this panel.\nAuthenticated transport: '+(lastIdentityInspectionAt?'identity read '+new Date(lastIdentityInspectionAt).toLocaleString():'not inspected in this tab')+'.\nIdentity binding: '+(a?.approval?.awaitingApproval?'approval required':a?.computePolicy?'recorded; revision '+(a.bindingRevision??'unreported'):'not approved')+'.\nInference: '+(a?.testedAt?'recorded '+new Date(a.testedAt).toLocaleString():'not tested')+'.\nTool execution: '+String(a?.qualification?.tools?.status??'NOT TESTED').replaceAll('_',' ')+'.\nIndependent acceptance: unverified.\nSettlement: unverified.\nProduction: '+String(a?.qualification?.production?.status??'NOT TESTED').replaceAll('_',' ')+'.';
 const usage=$('computeAllowance');if(usage)usage.textContent=companionUsageText(a);
 const auto=$('automaticBriefRule');if(auto)auto.textContent=a?.automaticBriefs?.suspended?'Automatic explanations are paused until a successful explicit identity or inference test in this app session, and while identity approval is pending. Your saved preference is retained. Read-only status uses no model allowance.':'Automatic explanations are '+(a?.automaticBriefs?.enabled?'enabled':'off')+'. When enabled, they use allowance and pause during identity review and approval. Read-only status uses no model allowance.';
 const outcome=$('computeApprovalOutcome'),last=a?.approval?.last;
 if(outcome)outcome.textContent=last?'Last recorded approval: '+(last.status??last.completionState??'unknown')+' · Operation '+(last.operationID??last.id??'unreported')+(last.failureCode?' · '+last.failureCode:'')+'.':'No persisted approval outcome recorded.';
 syncComputeIdentityControls();
}
action('inspectComputeIdentity',async()=>{
 const generation=++computeIdentityGeneration;clearComputeIdentityReview();computeIdentityBusy=true;syncComputeIdentityControls();
 $('computeIdentityReview').hidden=false;$('computeIdentityResult').textContent='Reading the authenticated proposed identity. This inspection does not request a model response.';
 try{
  const result=await api('/api/companion/identity',{});if(generation!==computeIdentityGeneration)return;
  if(!result.proposal?.id||!Number.isSafeInteger(result.proposal.revision)||!Number.isFinite(result.proposal.expiresAt))throw Error('This signer did not return a reviewable proposal. Apply the coordinated signer update before approving.');
  reviewedComputeIdentity=result;lastIdentityInspectionAt=Date.now();
  $('computeIdentityDetails').textContent='Previously approved: '+(result.boundPolicyHash||'No identity approved yet')+'\nProposed identity: '+result.policyHash+'\nBinding revision: '+result.proposal.revision+'\nReview expires: '+new Date(result.proposal.expiresAt).toLocaleString()+'\nPreviously approved browser reviewer: '+(result.boundPublicWebReviewerFingerprint||'None')+'\nProposed browser reviewer fingerprint: '+(result.publicWeb?.reviewerFingerprint||'None configured')+'\nConfigured capabilities: '+(result.configuredCapabilities??result.capabilities??[]).join(', ')+'\nRuntime advertised capabilities: '+(result.capabilities??[]).join(', ')+'\nAdded capabilities since accepted binding: '+(state?.companion?.configuredCapabilities?.length?((result.configuredCapabilities??result.capabilities??[]).filter(x=>!state.companion.configuredCapabilities.includes(x)).join(', ')||'none'):'previous capability record unavailable')+'\nRemoved capabilities since accepted binding: '+(state?.companion?.configuredCapabilities?.length?(state.companion.configuredCapabilities.filter(x=>!(result.configuredCapabilities??result.capabilities??[]).includes(x)).join(', ')||'none'):'previous capability record unavailable')+'\nRecorded qualification:\n'+['inference','tools','browser','job','production'].map(key=>key+': '+String(result.qualification?.[key]?.status??'NOT TESTED').replaceAll('_',' ')).join('\n');
  $('computeIdentityResult').textContent='Review these exact changes, then consent to one bounded inference probe. The existing binding remains until a successful persisted commit.';
 }catch(error){if(generation===computeIdentityGeneration)$('computeIdentityResult').textContent=error.message;throw error;}
 finally{if(generation===computeIdentityGeneration)computeIdentityBusy=false;syncComputeIdentityControls();}
});
$('computeIdentityConsent').addEventListener('change',syncComputeIdentityControls);
action('approveComputeIdentity',async()=>{
 syncComputeIdentityState(state?.companion);
 if(!reviewedComputeIdentity||!$('computeIdentityConsent').checked)throw Error('Review the current proposed identity and consent before approving.');
 const reviewed=reviewedComputeIdentity,generation=++computeIdentityGeneration;computeIdentityBusy=true;syncComputeIdentityControls();
 $('computeIdentityResult').textContent='Testing the reviewed runtime. Waiting for the server to validate and persist the exact binding; general work remains blocked.';
 try{
  const result=await api('/api/companion/approve-identity',{policyHash:reviewed.policyHash,proposalID:reviewed.proposal.id,revision:reviewed.proposal.revision,acknowledge:true});
  if(generation!==computeIdentityGeneration)return;
  if(result.persisted!==true||result.approvalStatus!=='committed'||result.policyHash!==reviewed.policyHash||result.bindingRevision<=reviewed.proposal.revision)throw Error('Approval returned no verified persisted binding. Read the recorded outcome before another attempt.');
  clearComputeIdentityReview();$('computeIdentityResult').textContent=result.reconciliationRequired?'The reviewed binding was committed, but approval persistence cleanup requires reconciliation. Operation '+result.operationID+'. Further inference remains blocked. Preserve the state and use the reviewed recovery procedure.':'Identity approval persisted after a successful inference test. Operation '+result.operationID+'. Tool execution, independent acceptance, settlement and production qualification remain separate checks.';
 }catch(error){
  if(generation===computeIdentityGeneration){
   const retained=['COMPANION_COOLDOWN','COMPANION_BUSY','COMPANION_DAILY_LIMIT','COMPANION_RATE_LIMITED'].includes(error.code);
   if(!retained)clearComputeIdentityReview();
   $('computeIdentityResult').textContent=error.message+(retained?' Your exact reviewed proposal and consent are retained until expiry. Check the cause and next-attempt time; this does not start an automatic retry.':' No successful approval is assumed. Read the recorded outcome, then review the current identity before another attempt.');
   await refresh();
  }
  throw error;
 }finally{if(generation===computeIdentityGeneration)computeIdentityBusy=false;syncComputeIdentityControls();}
});
action('cancelComputeIdentity',async()=>{
 ++computeIdentityGeneration;clearComputeIdentityReview();computeIdentityBusy=false;syncComputeIdentityControls();
 $('computeIdentityResult').textContent='Cancellation requested. Waiting for the recorded outcome; this tab will not approve a late response.';
 await api('/api/companion/cancel',{});
 $('computeIdentityResult').textContent='Cancellation completed. Read the recorded approval outcome before proceeding. Review the current identity again if another test is needed; any reserved slot remains in the local history.';
});

publicBrowserUI = window.AGIPublicBrowser({request: api, refresh, enabled: () => Boolean(state?.unlocked), savedReport: () => state?.companion?.publicWebReport??null});

// A tab regains current server state before its next approval; no model call is made.
window.addEventListener("focus",refresh);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});
setInterval(()=>{if(state?.companion)syncComputeIdentityState(state.companion);},1000);
