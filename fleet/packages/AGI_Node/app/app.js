let publicBrowserUI = null, statusRefreshSequence = 0;
const $ = (id) => document.getElementById(id);
let csrf = "",
  state = null,
  shownView = "overview",
  step = 1,
  demo = false,
  configStamp = "",
  activation = null,
  working = 0,
  latestNotice = null;
const human = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ");
const el = (tag, text = "", className = "") => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
};
const number = (value, digits = 4) => {
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: digits })
    : "—";
};
function say(text, error = false) {
  $("feedback").hidden = false;
  $("feedback").className = error ? "error" : "success";
  $("feedback").textContent = text;
}
async function request(route, body) {
  const response = await fetch(route, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-AGI-CSRF": csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = Error(
      (result.error?.title ?? "Action could not complete") +
        ". " +
        (result.error?.action ?? ""),
    );
    error.code = result.error?.code;
    throw error;
  }
  return result;
}
async function action(button, work) {
  if (demo) {
    say(
      "Return to your node to change real settings. The demo never operates a wallet.",
      true,
    );
    return;
  }
  working++;
  if (button) button.disabled = true;
  try {
    await work();
    await refresh();
  } catch (error) {
    say(error.message, true);
  } finally {
    working--;
    if (button) button.disabled = false;
    if (button?.id === "backup-saved") genesis.syncBackup();
    syncComputeIdentityControls();
  }
}
function showView(view) {
  walletUI.clear();
  if (
    demo &&
    ["setup", "wallet", "models", "companion", "help", "studio"].includes(view)
  ) {
    demo = false;
    $("demo-banner").hidden = true;
  }
  shownView = view;
  for (const section of document.querySelectorAll(".view"))
    section.hidden = section.id !== "view-" + view;
  for (const button of document.querySelectorAll("nav [data-view]"))
    button.classList.toggle("selected", button.dataset.view === view);
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}
function showStep(value) {
  step = Number(value);
  showView("setup");
  for (const section of document.querySelectorAll(".setup-step"))
    section.hidden = section.id !== "step-" + step;
  for (const button of document.querySelectorAll("[data-step]"))
    button.classList.toggle("active", Number(button.dataset.step) === step);
}
for (const button of document.querySelectorAll("[data-view]"))
  button.addEventListener("click", () => showView(button.dataset.view));
for (const button of document.querySelectorAll("[data-step]"))
  button.addEventListener("click", () => showStep(button.dataset.step));
const genesis=window.AGIGenesis({api:(route,body)=>request('/api/'+route,body),refresh,role:'node',goWallet:()=>{showStep(3);const target=$('walletNew').hidden?$('revealPassword'):$('walletWords');target.scrollIntoView({block:'center'});target.focus();},goCompute:()=>showView('companion'),goStudio:()=>showView('studio'),goBackup:()=>{showView('wallet');$('verifyBackupFile').focus();},goSetup:()=>{showStep(1);$('vault-password').focus();},goUnlock:()=>{$('unlock-dialog').showModal();$('unlock-password').focus();}});
const walletUI = window.AGIWalletUI({api:(route,body)=>request("/api/"+route,body),refresh,message:say,enabled:()=>!demo,continueBackup:()=>{showView("wallet");$("backup-password").focus();},name:"Node",launcher:"Launch.sh",seedLauncher:"Launch.sh"});
const samples = {
  csv: {
    spec: {
      schema: "agi-node-job/v1",
      profile: "csv-table/v1",
      title: "Deliver a checked product catalogue",
      columns: [
        { name: "product_id", type: "string", required: true, min: 3, max: 20 },
        {
          name: "price_usdc",
          type: "number",
          required: true,
          min: 1,
          max: 100,
        },
        { name: "available", type: "boolean", required: true },
      ],
      minRows: 2,
      maxRows: 100,
      uniqueBy: ["product_id"],
    },
    delivery:
      "product_id,price_usdc,available\nAGI-001,25,true\nAGI-002,50,false\n",
  },
  json: {
    spec: {
      schema: "agi-node-job/v1",
      profile: "json-schema-2020-12/v1",
      title: "Deliver a complete quality record",
      acceptanceSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          productId: { type: "string", const: "AGI-001" },
          priceUSDC: { type: "number", minimum: 1, maximum: 100 },
          available: { type: "boolean" },
        },
        required: ["productId", "priceUSDC", "available"],
        additionalProperties: false,
      },
    },
    delivery: JSON.stringify(
      { productId: "AGI-001", priceUSDC: 25, available: true },
      null,
      2,
    ),
  },
  text: {
    spec: {
      schema: "agi-node-job/v1",
      profile: "text-checks/v1",
      title: "Deliver a notice with exact required wording",
      checks: [
        { id: "heading", op: "startsWith", value: "Delivery report" },
        { id: "required-phrase", op: "contains", value: "Evidence verified" },
        { id: "no-placeholder", op: "excludes", value: "TODO" },
        { id: "word-count", op: "wordCount", min: 8, max: 80 },
      ],
    },
    delivery:
      "Delivery report\nEvidence verified against the complete acceptance criteria.\nThe requested record is ready for review.\n",
  },
};
function sample(name) {
  $("lab-spec").value = JSON.stringify(samples[name].spec, null, 2);
  $("lab-delivery").value = samples[name].delivery;
  $("lab-result").replaceChildren();
}
const base64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192)
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(out);
};
function download(name, value, type = "application/json") {
  const url = URL.createObjectURL(
      new Blob(
        [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
        { type },
      ),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function exploreDemo() {
  try {
    const pass = await request("/api/lab", {
        specification: JSON.stringify(samples.csv.spec),
        delivery: base64(samples.csv.delivery),
      }),
      fail = await request("/api/lab", {
        specification: JSON.stringify(samples.csv.spec),
        delivery: base64(samples.csv.delivery.replace("25,true", "999,true")),
      }),
      jpass = await request("/api/lab", {
        specification: JSON.stringify(samples.json.spec),
        delivery: base64(samples.json.delivery),
      });
    demo = true;
    demoState = {
      ...state,
      vaultExists: false,
      unlocked: false,
      enrolled: false,
      running: false,
      mode: "demo",
      health: null,
      runtime: { status: "demo" },
      counts: [],
      votedTotal: 0,
      jobs: [
        {
          id: "105",
          status: "abstained",
          reason: "EVIDENCE_UNAVAILABLE",
          explanation: {
            title: "Evidence unavailable",
            action: "The node will retry without inventing a vote.",
          },
        },
        {
          id: "104",
          status: "unsupported",
          reason: "UNSUPPORTED_SPECIFICATION",
          explanation: {
            title: "Unsupported acceptance criteria",
            action: "No vote is cast.",
          },
        },
        {
          id: "103",
          status: "would-approve",
          reason: "ALL_ACCEPTANCE_CHECKS_PASS",
          review: jpass,
        },
        {
          id: "102",
          status: "would-reject",
          reason: "ACCEPTANCE_CHECK_FAILED",
          review: fail,
        },
        {
          id: "101",
          status: "would-approve",
          reason: "ALL_ACCEPTANCE_CHECKS_PASS",
          review: pass,
        },
      ],
      transactions: [],
      incidents: [],
    };
    shownView = "overview";
    showView("overview");
    $("demo-banner").hidden = false;
    render();
  } catch (error) {
    say(error.message, true);
  }
}
let demoState = null;
function checks(list) {
  const ul = el("ul", "", "checklist");
  for (const item of list) {
    const li = el(
      "li",
      (item.passed ? "Passed: " : "Failed: ") +
        item.id +
        (item.row ? " · row " + item.row : ""),
      item.passed ? "pass" : "",
    );
    ul.append(li);
  }
  return ul;
}
function jobDetails(job) {
  $("job-title").textContent = "Job " + job.id;
  const box = $("job-details");
  box.replaceChildren(el("p", job.explanation?.title ?? human(job.reason)));
  if (job.explanation?.action) box.append(el("p", job.explanation.action));
  if (job.review) {
    box.append(
      el("p", "Decision: " + human(job.review.decision)),
      checks(job.review.checks ?? []),
    );
    for (const [name, value] of [
      ["Review profile", job.review.profile],
      ["Specification SHA-256", job.review.specHash],
      ["Delivery SHA-256", job.review.deliveryHash],
    ])
      if (value) box.append(el("h3", name), el("code", value, "address"));
  } else
    box.append(
      el("p", "No financial decision was authorized for this review."),
    );
  $("job-dialog").showModal();
}
function jobs(container, rows) {
  container.replaceChildren();
  if (!rows.length) {
    container.append(
      el(
        "p",
        "No opportunities yet. Eligible finalized completion requests appear here once your connected node is observing.",
        "muted",
      ),
    );
    return;
  }
  for (const job of rows) {
    const button = el("button", "", "job-row"),
      reject =
        job.reason === "ACCEPTANCE_CHECK_FAILED" ||
        job.review?.decision === "reject",
      abstain = ["abstained", "unsupported"].includes(job.status);
    button.append(
      el("b", "Job " + job.id),
      el(
        "span",
        human(job.status),
        "badge" + (abstain ? " warn" : reject ? " fail" : ""),
      ),
      el("span", job.explanation?.title ?? human(job.reason), "job-reason"),
      el("span", "↗"),
    );
    button.addEventListener("click", () => jobDetails(job));
    container.append(button);
  }
}
function hydrate(c) {
  const stamp = JSON.stringify(c);
  if (stamp === configStamp) return;
  configStamp = stamp;
  $("chain").value = String(c.chainId);
  $("manager").value = c.manager ?? "";
  $("deployment-block").value = c.deploymentBlock ?? 0;
  $("buyers").value = c.trustedBuyers.join("\n");
  $("excluded").value = c.excludedParties.join("\n");
  $("hosts").value = c.allowedHttpsHosts.join("\n");
  $("gateway").value = c.ipfsGateway;
  $("club-label").value = c.label;
  $("proof").value = JSON.stringify(c.proof);
  for (const [id, key] of [
    ["max-bond", "maxBondUSDC"],
    ["max-open", "maxOpenBondUSDC"],
    ["max-daily-bond", "maxBond24hUSDC"],
    ["max-daily-gas", "maxGas24hETH"],
    ["max-tx-eth", "maxTxETH"],
    ["max-job", "maxJobUSDC"],
    ["max-fee", "maxFeeGwei"],
  ])
    $(id).value = c.limits[key];
  $("txGasUnits").value = c.limits.maxTxGas;
  $("finalizeGasUnits").value = c.limits.maxFinalizeGas;
  $("auto-claim").checked = c.autoClaim;
  $("auto-finalize").checked = c.autoFinalizeOwnJobs;
  $("ai-enabled").checked = c.ai.enabled;
  $("cloud-veto").checked = c.ai.cloudVeto === true;
  $("cloud-public").checked = c.ai.cloudPublicOnly === true;
  $("computer-review").checked = c.ai.reviewComputerWork === true;
  $("image-review").checked = c.ai.reviewImages === true;
}
let companionStamp = "";
function renderCompanion() {
  const a = state.companion;
  if (!a) return;
  const stamp = JSON.stringify(a.config);
  if (stamp !== companionStamp) {
    companionStamp = stamp;
    $("companion-enabled").checked = a.config.enabled;
    $("companion-auto").checked = a.config.autoBrief;
    $("companion-port").value = a.config.port;
    $("companion-agent").value = a.config.agent;
    $("companion-cap").value = a.config.maxCalls24h;
    $("companion-ack").checked = a.config.acknowledged;
  }
  $("companion-status").textContent = companionStatusText(a);
  $("companion-usage").textContent =
    companionUsageText(a);
  $("companion-notice").textContent = a.lastError
    ? (a.error?.title ?? human(a.lastError)) +
      (a.nextAttemptAt
        ? " · Next attempt after " +
          new Date(a.nextAttemptAt).toLocaleTimeString()
        : "")
    : "Wallet permissions are managed by AGI Node.";
  if (a.lastBrief)
    $("companion-brief").textContent =
      a.lastBrief.summary +
      " — AI summary at " +
      new Date(a.lastBrief.at).toLocaleString() +
      ". Advisory; compare with the latest Overview.";
  else
    $("companion-brief").textContent =
      "Your operating summary will appear here. AI explanations are advisory; check the node’s recorded status before acting.";
}
function render() {
  publicBrowserUI?.sync();
  if (!state) return;
  genesis.render(state);
  document.querySelector(".genesis-center").hidden = demo;
  const s = demo ? demoState : state,
    c = s.config;
  if (!demo) {
    hydrate(c);
    renderCompanion();
  }
  $("demo-banner").hidden = !demo;
  $("operation").hidden = !state.operation;
  $("operation").textContent = state.operation ? state.operation + "…" : "";
  $("unlock-top").hidden = !s.vaultExists || s.unlocked || demo;
  $("lock-top").hidden = !s.unlocked || demo;
  $("network-pill").textContent = demo
    ? "SIMULATION"
    : c.chainId === 1
      ? "ETHEREUM MAINNET"
      : "SEPOLIA TESTNET";
  $("live-pill").textContent = demo
    ? "NO TRANSACTIONS"
    : s.running
      ? s.mode.toUpperCase()
      : "PRIVATE";
  const setupComplete =
    s.vaultExists &&
    s.walletPresent &&
    s.enrolled &&
    c.trustedBuyers.length > 0;
  let title = "Your private node is ready to set up.",
    description =
      "Use the guided setup, or explore a simulation with no wallet.",
    caption = "GETTING STARTED",
    primary = "Set up my node";
  if (demo) {
    title = "Explore your review operator.";
    description =
      "These synthetic deliveries were checked by the real review engine. No wallet or blockchain is involved.";
    caption = "SAFE DEMONSTRATION";
    primary = "Set up my real node";
  } else if (s.vaultExists && !s.unlocked) {
    title = "Your node is locked.";
    description =
      "Unlock your encrypted vault to continue setup or resume operation.";
    caption = "KEYS ENCRYPTED";
    primary = "Unlock my node";
  } else if (setupComplete && !s.running) {
    title = "Ready to observe.";
    description =
      "Start monitoring supported opportunities before authorizing live validation.";
    caption = "YOUR SCOPE IS CONFIGURED";
    primary = "Start observing";
  }
  if (!demo && s.restarting) {
    title = "Recovering the review process.";
    description =
      "The supervisor is restarting the worker with its existing journal. A new transaction will not bypass the recorded pending one.";
    caption = "AUTOMATIC RECOVERY";
  } else if (!demo && s.running) {
    primary = "View review activity";
    if (s.paused) {
      title = "New signing is paused.";
      caption = "YOU REMAIN IN CONTROL";
      description =
        "Monitoring continues. Already broadcast transactions can still execute.";
    } else {
      title =
        s.mode === "live"
          ? "Your node is validating."
          : "Your node is observing.";
      caption =
        s.mode === "live" ? "BOUNDED LIVE AUTHORITY" : "NO TRANSACTIONS SIGNED";
      description =
        s.runtime?.message ??
        "Monitoring finalized opportunities within your chosen scope.";
      if (s.runtime?.status === "attention") {
        title = "Your node needs attention.";
        description = s.incidents[0]?.action ?? description;
        caption = "CHECK THE RECORDED NOTICE";
      }
    }
  }
  $("node-state").textContent = title;
  $("node-description").textContent = description;
  $("state-caption").textContent = caption;
  $("primary-action").textContent = primary;
  $("pause-action").hidden =
    demo || !s.running || s.mode !== "live" || s.paused;
  $("resume-action").hidden = demo || !s.paused;
  $("stop-action").hidden = demo || (!s.running && !s.restarting);
  $("authorize-button").hidden =
    demo || !setupComplete || s.running || !s.unlocked;
  $("authorize-button").textContent = "Review & authorize live validation";
  $("balance-usdc").textContent = s.health ? number(s.health.usdc, 2) : "—";
  $("balance-eth").textContent = s.health ? number(s.health.eth, 5) : "—";
  $("exposure").textContent =
    s.metrics?.openBondUSDC !== undefined
      ? number(Number(s.metrics.openBondUSDC) / 1e6, 2)
      : s.runtime?.openBondUSDC !== undefined
        ? number(Number(s.runtime.openBondUSDC) / 1e6, 2)
        : "—";
  $("vote-count").textContent = s.votedTotal ?? 0;
  const b = s.budgets;
  $("bond-budget").textContent =
    number(b.bondUsedUSDC, 2) + " / " + b.bondLimitUSDC + " USDC";
  $("gas-budget").textContent =
    number(b.gasUsedETH, 6) + " / " + b.gasLimitETH + " ETH";
  $("bond-progress").value = Math.min(
    100,
    (100 * Number(b.bondUsedUSDC)) / Number(b.bondLimitUSDC),
  );
  $("gas-progress").value = Math.min(
    100,
    (100 * Number(b.gasUsedETH)) / Number(b.gasLimitETH),
  );
  const readiness = [
    [
      "Verification RPC configured",
      s.operations?.verificationConfigured === true,
    ],
    ["Related-party independence reviewed", c.independenceReviewed === true],
    ["Encrypted vault ready", s.vaultExists],
    ["Dedicated wallet configured", s.walletPresent],
    ["Contract and linked libraries enrolled", s.enrolled],
    ["Buyers and spending limits selected", c.trustedBuyers.length > 0],
    ["Encrypted backup saved", s.settings.backupSaved],
    ["Current validator eligibility checked", s.health?.eligible === true],
  ];
  if (c.chainId === 1)
    readiness.push([
      "Mainnet commissioning recorded",
      s.operations?.cases?.every((x) => x.status === "pass") === true,
    ]);
  $("readiness").replaceChildren(
    ...readiness.map(([text, pass]) => el("li", text, pass ? "pass" : "")),
  );
  $("checked-at").textContent = s.health?.checkedAt
    ? "Last readiness check: " + new Date(s.health.checkedAt).toLocaleString()
    : "Run a readiness check after enrollment.";
  jobs($("overview-jobs"), s.jobs.slice(0, 5));
  jobs($("all-jobs"), s.jobs);
  $("transactions").replaceChildren(
    ...s.transactions.map((t) => {
      const row = el("div");
      row.append(
        el(
          "strong",
          human(t.kind) +
            " · " +
            human(t.state) +
            (t.status === 0 ? " · reverted" : ""),
        ),
        el("p", t.job !== null ? "Job " + t.job : "Wallet maintenance"),
        el("code", t.hash),
      );
      return row;
    }),
  );
  if (!s.transactions.length)
    $("transactions").append(el("p", "No signed transactions.", "muted"));
  $("performance").textContent =
    s.metrics?.cycleMs !== undefined
      ? `Last cycle: ${number(s.metrics.cycleMs, 0)} ms · Verified-content cache: ${s.metrics.cacheHits} hits / ${s.metrics.cacheMisses} misses · Worker memory: ${number(s.metrics.memoryRSS / 1048576, 1)} MB · Finalized scan block: ${s.cursor?.number ?? "catching up"}`
      : "Operating measurements appear after your node starts.";
  $("vault-form").hidden = s.unlocked;
  $("vault-ready").hidden = !s.unlocked;
  $("vault-repeat-label").hidden = s.vaultExists;
  $("vault-repeat").required = !s.vaultExists;
  $("vault-submit").textContent = s.vaultExists
    ? "Unlock my vault"
    : "Create my encrypted vault";
  walletUI.render({address:c.validator,unlocked:s.unlocked,running:s.running,recovery:s.walletRecovery ?? {type:"none"},profile:s.walletProfile});
  $("keystoreImport").hidden = s.walletPresent;
  $("wallet-address").value = c.validator || "";
  $("copy-wallet").disabled = !c.validator;
  $("restore-check").hidden = !s.settings.restored;
  $("mac-background").hidden = !s.backgroundSupported;
  $("other-platform").hidden = s.backgroundSupported;
  if (!document.activeElement?.closest("#mac-background")) {
    $("remember-unlock").checked = s.settings.remember;
    $("background-enabled").checked = s.settings.background;
    $("resume-launch").checked = s.settings.resumeOnLaunch;
  }
  $("incidents").replaceChildren(
    ...s.incidents.map((item) => {
      const row = el("div", "", "incident");
      row.append(
        el("h3", item.title),
        el("p", item.action),
        el("small", new Date(item.at).toLocaleString()),
      );
      return row;
    }),
  );
  if (!s.incidents.length)
    $("incidents").append(el("p", "No notices recorded.", "muted"));
  if (!demo && s.incidents[0] && s.incidents[0].at !== latestNotice) {
    const previous = latestNotice;
    latestNotice = s.incidents[0].at;
    if (
      previous &&
      localStorage.getItem("agi-alerts") === "yes" &&
      "Notification" in window &&
      Notification.permission === "granted"
    )
      new Notification("AGI Node needs attention", {
        body: s.incidents[0].title,
      });
  }
}
async function refresh() {
  const sequence=++statusRefreshSequence;
  try {
    const nextState = await request("/api/status");
    if(sequence!==statusRefreshSequence)return;
    state=nextState;
    syncComputeIdentityState(state.companion);
    publicBrowserUI?.sync();
    csrf = state.csrf;
    for(const version of document.querySelectorAll("[data-app-version]")) version.textContent = state.version;
    $("connection-error").hidden = true;
    render();
  } catch {
    walletUI.clear();
    $("connection-error").hidden = false;
  }
}
const click = (id, work) =>
  $(id).addEventListener("click", (event) => action(event.currentTarget, work));
const submit = (id, work) =>
  $(id).addEventListener("submit", (event) => {
    event.preventDefault();
    action(event.submitter, work);
  });
$("primary-action").addEventListener("click", () => {
  if (demo) {
    demo = false;
    showStep(1);
    return;
  }
  if (!state.vaultExists) {
    showStep(1);
    return;
  }
  if (!state.unlocked) {
    $("unlock-dialog").showModal();
    return;
  }
  if (state.running) {
    showView("work");
    return;
  }
  if (
    !state.enrolled ||
    !state.walletPresent ||
    !state.config.trustedBuyers.length
  ) {
    showStep(
      !state.walletPresent ? 3 : !state.config.trustedBuyers.length ? 4 : 5,
    );
    return;
  }
  action($("primary-action"), async () => {
    await request("/api/start", { mode: "observe" });
    say("Observation started. No transactions will be signed.");
  });
});
$("demo-toggle").addEventListener("click", exploreDemo);
$("exit-demo").addEventListener("click", () => {
  demo = false;
  render();
});
$("unlock-top").addEventListener("click", () => $("unlock-dialog").showModal());
$("cancel-unlock").addEventListener("click", () => $("unlock-dialog").close());
$("close-job").addEventListener("click", () => $("job-dialog").close());
submit("unlock-form", async () => {
  try {
    await request("/api/unlock", { password: $("unlock-password").value });
    $("unlock-dialog").close();
    say("Your node is unlocked.");
  } finally {
    $("unlock-password").value = "";
  }
});
click("lock-top", async () => {
  walletUI.clear();
  await request("/api/lock", {});
  say("Node stopped and vault locked.");
});
submit("vault-form", async () => {
  const password = $("vault-password").value;
  if (!state.vaultExists && password !== $("vault-repeat").value)
    throw Error("The two passwords do not match.");
  try {
    await request(state.vaultExists ? "/api/unlock" : "/api/vault/create", {
      password,
    });
    say("Your encrypted vault is ready.");
    showStep(2);
  } finally {
    $("vault-password").value = "";
    $("vault-repeat").value = "";
  }
});
async function saveConnection() {
  await request("/api/config", {
    chainId: Number($("chain").value),
    manager: $("manager").value.trim(),
    deploymentBlock: Number($("deployment-block").value || 0),
  });
  if ($("rpc-url").value) {
    await request("/api/rpc", { url: $("rpc-url").value.trim() });
    $("rpc-url").value = "";
  }
}
submit("connection-form", async () => {
  await saveConnection();
  say("Connection settings saved. Your private RPC URL is encrypted.");
  showStep(3);
});
click("discover-button", async () => {
  await saveConnection();
  const result = await request("/api/discover", {
    transactionHash: $("deployment-tx").value.trim(),
  });
  $("manager").value = result.manager;
  $("deployment-block").value = result.deploymentBlock;
  say("Found the direct deployment and its exact creation block.");
});
click("import-wallet", async () => {
  const file = $("keystore-file").files[0];
  if (!file || file.size > 1048576)
    throw Error("Choose a compatible encrypted JSON keystore under 1 MB.");
  try {
    await request("/api/wallet/import", {
      keystore: await file.text(),
      password: $("import-password").value,
    });
    say("Encrypted wallet imported locally.");
  } finally {
    $("import-password").value = "";
    $("keystore-file").value = "";
  }
});
const split = (value) =>
  value
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
submit("scope-form", async () => {
  let proof;
  try {
    proof = JSON.parse($("proof").value || "[]");
  } catch {
    throw Error("The optional Merkle proof must be an array such as [].");
  }
  const limits = { ...state.config.limits };
  for (const [id, key] of [
    ["max-bond", "maxBondUSDC"],
    ["max-open", "maxOpenBondUSDC"],
    ["max-daily-bond", "maxBond24hUSDC"],
    ["max-daily-gas", "maxGas24hETH"],
    ["max-tx-eth", "maxTxETH"],
    ["max-job", "maxJobUSDC"],
    ["max-fee", "maxFeeGwei"],
  ])
    limits[key] = $(id).value.trim();
  limits.maxTxGas = Number($("txGasUnits").value);
  limits.maxFinalizeGas = Number($("finalizeGasUnits").value);
  await request("/api/config", {
    trustedBuyers: split($("buyers").value),
    excludedParties: split($("excluded").value),
    allowedHttpsHosts: split($("hosts").value),
    label: $("club-label").value.trim(),
    proof,
    ipfsGateway: $("gateway").value.trim(),
    limits,
    autoClaim: $("auto-claim").checked,
    autoFinalizeOwnJobs: $("auto-finalize").checked,
  });
  say(
    "Your scope and limits are saved. Changes require a fresh live authorization.",
  );
  showStep(5);
});
click("enroll-button", async () => {
  const h = await request("/api/enroll", {});
  $("enrollment-result").textContent = h.eligible
    ? "Contract and linked libraries match. This wallet currently has a validator credential."
    : "Contract and libraries match. This wallet still needs validator eligibility before live use.";
  say(
    "Deployment fingerprint check passed. Save a backup and start observation.",
  );
});
click("check-button", async () => {
  const h = await request("/api/check", {});
  say(
    h.eligible
      ? "Connection, fingerprints and validator eligibility passed. Review wallet funding and budgets."
      : "Connection and fingerprints passed. Validator eligibility still needs attention.",
    !h.eligible,
  );
});
click("observe-setup", async () => {
  await request("/api/start", { mode: "observe" });
  showView("overview");
  say("Observation started. No transactions will be signed.");
});
click("pause-action", async () => {
  await request("/api/pause", {});
  say("New signing paused. Already submitted transactions can still execute.");
});
click("resume-action", async () => {
  await request("/api/resume", {});
  say("Checks passed and the signing pause was removed.");
});
click("stop-action", async () => {
  await request("/api/stop", {});
  say("Node stopped safely. Its transaction journal is preserved.");
});
click("authorize-button", async () => {
  activation = await request("/api/activation/challenge", {});
  const box = $("activation-summary");
  box.replaceChildren(
    el(
      "p",
      activation.chainId === 1
        ? "Ethereum mainnet · real funds"
        : "Sepolia · test funds",
    ),
    el("code", activation.validator, "address"),
    el(
      "p",
      `Up to ${activation.limits.maxBondUSDC} USDC per bond; ${activation.limits.maxOpenBondUSDC} USDC open exposure; ${activation.limits.maxBond24hUSDC} USDC gross bonds and ${activation.limits.maxGas24hETH} ETH gas per rolling 24 hours.`,
    ),
  );
  $("risk-ack").checked = false;
  $("independence-ack").checked = false;
  $("activation-dialog").showModal();
});
$("cancel-activate").addEventListener("click", () =>
  $("activation-dialog").close(),
);
click("activate-live", async () => {
  if (!$("risk-ack").checked || !$("independence-ack").checked)
    throw Error("Read and confirm both authorization statements.");
  await request("/api/activate", {
    id: activation?.id,
    acknowledgeRisk: true,
    independentReview: true,
  });
  await request("/api/start", { mode: "live" });
  $("activation-dialog").close();
  showView("overview");
  say("Live validation started within your exact authorized scope and limits.");
});
click("copy-wallet", () => walletUI.copyAddress("wallet-address", "wallet-copy-status"));
submit("backup-form", async () => {
  try {
    const result = await request("/api/backup", {
      password: $("backup-password").value,
    });
    download(
      `AGI-Node-${state.walletProfile === "seed" ? "seed" : "original"}-${state.config.validator.slice(0,10)}-Backup-` +
        new Date().toISOString().slice(0, 10) +
        ".aginodebackup",
      result,
    );
    $("backup-saved").hidden = false;
    say(
      "Encrypted backup downloaded. Select the actual downloaded file below and verify it before confirming off-machine storage. The node is stopped.",
    );
  } finally {
    $("backup-password").value = "";
  }
});
click("backup-saved", async () => {
  await request("/api/backup/saved", {});
  $("backup-saved").hidden = true;
  say(
    "Backup confirmation saved. You can proceed to observation or review live authorization.",
  );
});
submit("restore-form", async () => {
  const file = $("backup-file").files[0];
  if (!file || file.size > 64 * 1024 * 1024)
    throw Error("Choose an encrypted AGI Node backup smaller than 64 MB.");
  try {
    const backup = JSON.parse(await file.text());
    await request("/api/restore", {
      backup,
      password: $("restore-password").value,
      acknowledge: $("restore-ack").checked,
    });
    say(
      "Backup restored. Check restored wallet history before authorizing live operation.",
    );
    configStamp = "";
  } finally {
    $("restore-password").value = "";
    $("backup-file").value = "";
  }
});
click("restore-check", async () => {
  await request("/api/restore/check", {});
  say(
    "Recorded wallet history reconciled. Review your settings and authorize live operation again.",
  );
});
click("export-report", async () => {
  download(
    "AGI-Node-Report-" + new Date().toISOString().slice(0, 10) + ".json",
    await request("/api/report"),
  );
  say("Private report downloaded. Review it before sharing.");
});
click("companion-kit", async () => {
  const kit = await request("/api/companion/kit", {
    acknowledge: $("companion-ack").checked,
    mode: $("companion-mode").value,
  });
  download("AGI-Node-OpenClaw-Setup.json", kit);
  say(
    "Private initial setup file downloaded. This rotates the connection token. A signer-only in-place update does not require this file. For an explicitly chosen initial installation, privately transfer it to the separate Standard compute account with that account ownership and 0600 permissions, then follow the clean-install guide. Review the authenticated identity before testing; preserve retained profiles and evidence.",
  );
});
click("companion-save", async () => {
  await request("/api/companion/config", {
    config: {
      ...state.companion.config,
      enabled: $("companion-enabled").checked,
      autoBrief: $("companion-auto").checked,
      port: Number($("companion-port").value),
      agent: $("companion-agent").value.trim(),
      maxCalls24h: Number($("companion-cap").value),
      acknowledged: $("companion-ack").checked,
    },
    token: $("companion-token").value.trim(),
  });
  $("companion-token").value = "";
  say(
    "Preferences saved. Test the connection, save a new backup, and authorize live operation again when ready.",
  );
});
click("companion-computer-test", async () => {
  const r=await request("/api/companion/workstation-test",{});download("AGI-Computer-Review.json",r);say("Computer review: "+r.verdict+". "+r.note);
});
click("companion-image-test", async () => {
  const r=await request("/api/companion/image-test",{});say("Visual test: "+r.verdict+". "+r.note);
});
click("companion-test", async () => {
  await request("/api/companion/test", {});
  say(
    "OpenClaw returned the expected response. Check its /codex status to confirm subscription billing. This connection test does not certify model quality or host isolation.",
  );
});
click("companion-summarize", async () => {
  const result = await request("/api/companion/brief", {});
  say(
    result.cached
      ? "Reused a recent summary to conserve your allowance."
      : "Your operating summary is ready.",
  );
});
click("cloud-save", async () => {
  await request("/api/config", {
    ai: {
      ...state.config.ai,
      cloudVeto: $("cloud-veto").checked,
      cloudPublicOnly: $("cloud-public").checked,
      reviewComputerWork: $("computer-review").checked,
      reviewImages: $("image-review").checked,
    },
  });
  say(
    "Review requirement saved. Save a new backup and review live authorization before resuming.",
  );
});
click("companion-read", async () => {
  download(
    "AGI-Node-Read-Only.json",
    await request("/api/companion/read-token", {}),
  );
  say(
    "Read-only connection downloaded. Any previous read-only credential is now revoked. Keep this file private.",
  );
});
click("companion-revoke", async () => {
  await request("/api/companion/revoke", {});
  say("Read-only access revoked immediately.");
});
click("companion-preview", async () => {
  const result = await request("/api/companion/preview");
  $("companion-payload").textContent = JSON.stringify(result, null, 2);
  $("companion-payload").hidden = false;
});
click("list-models", async () => {
  const result = await request("/api/models", {});
  $("model-select").replaceChildren(
    ...result.models.map((m) => {
      const option = el(
        "option",
        m.name + " · " + number(m.size / 1e9, 1) + " GB",
      );
      option.value = m.name;
      return option;
    }),
  );
  if (!result.models.length)
    throw Error(
      "Ollama is connected but no models are installed. Install a model in Ollama, then try again.",
    );
  if (state.config.ai.model) $("model-select").value = state.config.ai.model;
  say("Found " + result.models.length + " installed local models.");
});
click("test-model", async () => {
  const result = await request("/api/model/test", {
    model: $("model-select").value,
  });
  $("model-result").textContent =
    "Connection test passed in " +
    number(result.elapsedMs / 1000, 1) +
    " seconds. Model judgment quality has not been qualified.";
});
click("save-model", async () => {
  await request("/api/config", {
    ai: {
      ...state.config.ai,
      enabled: $("ai-enabled").checked,
      model: $("model-select").value,
    },
  });
  say(
    "Local AI preference saved. Review and reauthorize before live operation.",
  );
});
for (const name of ["csv", "json", "text"])
  $("sample-" + name).addEventListener("click", () => sample(name));
$("run-lab").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await request("/api/lab", {
      specification: $("lab-spec").value,
      delivery: base64($("lab-delivery").value),
    });
    const box = el(
      "div",
      "",
      "result" + (result.decision === "reject" ? " reject" : ""),
    );
    box.append(
      el(
        "h3",
        result.decision === "approve"
          ? "Acceptance checks passed"
          : "Acceptance checks failed",
      ),
      el("p", "Local lab only. No vote was cast."),
      checks(result.checks),
    );
    $("lab-result").replaceChildren(box);
  } catch (error) {
    say(error.message, true);
  } finally {
    button.disabled = false;
  }
});
$("download-spec").addEventListener("click", () =>
  download("agi-job-specification.json", $("lab-spec").value),
);
click("save-remember", async () => {
  await request("/api/remember", { enabled: $("remember-unlock").checked });
  say(
    "Automatic-unlock preference saved. Access fails closed if desktop keyring is unavailable.",
  );
});
click("save-background", async () => {
  await request("/api/background", {
    enabled: $("background-enabled").checked,
    resumeOnLaunch: $("resume-launch").checked,
  });
  say(
    "Login preference saved for your next desktop login. Keep the app folder in this location.",
  );
});
click("reindex-button", async () => {
  if (
    !window.confirm(
      "Rebuild the event index? The node must be stopped. Signed transactions and budgets will be kept.",
    )
  )
    return;
  await request("/api/reindex", {});
  say("The next observation run will rebuild the event index from deployment.");
});
$("notifications-button").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    say("This browser does not support notifications.", true);
    return;
  }
  const permission = await Notification.requestPermission();
  localStorage.setItem("agi-alerts", permission === "granted" ? "yes" : "no");
  say(
    permission === "granted"
      ? "Browser alerts enabled while this app tab remains open."
      : "Notifications were not enabled. Notices remain available in the app.",
  );
});
async function initialize() {
  const bootstrap = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  if (bootstrap) {
    try {
      const result = await request("/api/session", { token: bootstrap });
      csrf = result.csrf;
    } catch {}
  }
  sample("csv");
  await refresh();
  setInterval(refresh, 3000);
}
initialize();

$("quit-app").onclick = () =>
  action($("quit-app"), async () => {
    await request("/api/quit", {});
    say("The application is closing. Reopen its launcher to return.");
  });

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
 for(const id of ['companion-test','companion-computer-test','companion-image-test','companion-summarize'])if($(id))$(id).disabled=blocked;
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
click('inspectComputeIdentity',async()=>{
 const generation=++computeIdentityGeneration;clearComputeIdentityReview();computeIdentityBusy=true;syncComputeIdentityControls();
 $('computeIdentityReview').hidden=false;$('computeIdentityResult').textContent='Reading the authenticated proposed identity. This inspection does not request a model response.';
 try{
  const result=await request('/api/companion/identity',{});if(generation!==computeIdentityGeneration)return;
  if(!result.proposal?.id||!Number.isSafeInteger(result.proposal.revision)||!Number.isFinite(result.proposal.expiresAt))throw Error('This signer did not return a reviewable proposal. Apply the coordinated signer update before approving.');
  reviewedComputeIdentity=result;lastIdentityInspectionAt=Date.now();
  $('computeIdentityDetails').textContent='Previously approved: '+(result.boundPolicyHash||'No identity approved yet')+'\nProposed identity: '+result.policyHash+'\nBinding revision: '+result.proposal.revision+'\nReview expires: '+new Date(result.proposal.expiresAt).toLocaleString()+'\nPreviously approved browser reviewer: '+(result.boundPublicWebReviewerFingerprint||'None')+'\nProposed browser reviewer fingerprint: '+(result.publicWeb?.reviewerFingerprint||'None configured')+'\nConfigured capabilities: '+(result.configuredCapabilities??result.capabilities??[]).join(', ')+'\nRuntime advertised capabilities: '+(result.capabilities??[]).join(', ')+'\nAdded capabilities since accepted binding: '+(state?.companion?.configuredCapabilities?.length?((result.configuredCapabilities??result.capabilities??[]).filter(x=>!state.companion.configuredCapabilities.includes(x)).join(', ')||'none'):'previous capability record unavailable')+'\nRemoved capabilities since accepted binding: '+(state?.companion?.configuredCapabilities?.length?(state.companion.configuredCapabilities.filter(x=>!(result.configuredCapabilities??result.capabilities??[]).includes(x)).join(', ')||'none'):'previous capability record unavailable')+'\nRecorded qualification:\n'+['inference','tools','browser','job','production'].map(key=>key+': '+String(result.qualification?.[key]?.status??'NOT TESTED').replaceAll('_',' ')).join('\n');
  $('computeIdentityResult').textContent='Review these exact changes, then consent to one bounded inference probe. The existing binding remains until a successful persisted commit.';
 }catch(error){if(generation===computeIdentityGeneration)$('computeIdentityResult').textContent=error.message;throw error;}
 finally{if(generation===computeIdentityGeneration)computeIdentityBusy=false;syncComputeIdentityControls();}
});
$('computeIdentityConsent').addEventListener('change',syncComputeIdentityControls);
click('approveComputeIdentity',async()=>{
 syncComputeIdentityState(state?.companion);
 if(!reviewedComputeIdentity||!$('computeIdentityConsent').checked)throw Error('Review the current proposed identity and consent before approving.');
 const reviewed=reviewedComputeIdentity,generation=++computeIdentityGeneration;computeIdentityBusy=true;syncComputeIdentityControls();
 $('computeIdentityResult').textContent='Testing the reviewed runtime. Waiting for the server to validate and persist the exact binding; general work remains blocked.';
 try{
  const result=await request('/api/companion/approve-identity',{policyHash:reviewed.policyHash,proposalID:reviewed.proposal.id,revision:reviewed.proposal.revision,acknowledge:true});
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
click('cancelComputeIdentity',async()=>{
 ++computeIdentityGeneration;clearComputeIdentityReview();computeIdentityBusy=false;syncComputeIdentityControls();
 $('computeIdentityResult').textContent='Cancellation requested. Waiting for the recorded outcome; this tab will not approve a late response.';
 await request('/api/companion/cancel',{});
 $('computeIdentityResult').textContent='Cancellation completed. Read the recorded approval outcome before proceeding. Review the current identity again if another test is needed; any reserved slot remains in the local history.';
});

publicBrowserUI = window.AGIPublicBrowser({request: request, refresh, enabled: () => !demo && Boolean(state?.unlocked)});

// A tab regains current server state before its next approval; no model call is made.
window.addEventListener("focus",refresh);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});
setInterval(()=>{if(state?.companion)syncComputeIdentityState(state.companion);},1000);
