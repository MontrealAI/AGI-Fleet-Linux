(() => {
  const el = (id) => document.getElementById(id);
  let busy = false,
    current = null;
  const message = (s) => {
    el("opsNotice").textContent = s;
  };
  async function request(route, body) {
    let csrf;
    if (body !== undefined) {
      const s = await fetch("/api/status", { cache: "no-store" });
      if (!s.ok) throw Error("Reopen the app from its launcher.");
      csrf = (await s.json()).csrf;
    }
    const r = await fetch(route, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      headers:
        body === undefined
          ? {}
          : { "Content-Type": "application/json", "X-AGI-CSRF": csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const d = await r.json();
    if (!r.ok)
      throw Error(
        (d.error?.title ?? "Action unavailable") +
          ". " +
          (d.error?.action ?? ""),
      );
    return d;
  }
  function download(name, value) {
    const u = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  async function refresh() {
    try {
      const next = await request("/api/operations");
      const scopeChanged = current?.scope !== next.scope;
      const hadCurrent = current !== null;
      current = next;
      el("opsRPCState").textContent = current.verificationConfigured
        ? "Verification connection saved."
        : "Unlock and add the verification connection before live operation.";
      el("opsIdentityState").textContent = current.independenceReviewed
        ? "Independence review recorded."
        : "Independence review is required before live operation.";
      if (!el("opsCase").options.length)
        for (const x of current.cases) {
          const o = document.createElement("option");
          o.value = x.id;
          o.textContent = x.title;
          el("opsCase").append(o);
        }
      el("opsCases").replaceChildren(
        ...current.cases.map((x) => {
          const li = document.createElement("li");
          li.textContent = x.title + " — " + x.status.toUpperCase();
          return li;
        }),
      );
      if (scopeChanged) {
        const selected = current.cases.find(
          (x) => x.id === el("opsCase").value,
        );
        el("opsResult").value = selected?.status ?? "pending";
        el("opsEvidence").value = selected?.evidence ?? "";
        el("opsIndependent").checked = current.independenceReviewed;
        if (hadCurrent)
          message(
            "Settings or lock state changed. Review the current evidence; earlier passes are not reused.",
          );
      }
      await refreshPilot();
      const m = current.monitor;
      el("opsHealth").textContent = [
        "Overall: " + m.state.toUpperCase(),
        "Successful cycle: " + (m.worker.lastSuccessAt ?? "not yet"),
        "RPC: " +
          m.rpc.state +
          " · finalized block: " +
          (m.rpc.finalizedBlock ?? "unknown"),
        "OpenClaw gateway: " + m.openclaw.gateway,
        "IPFS publisher: " + m.ipfs.localPublisher,
        "Wallet: " +
          (m.wallet.eth ?? "unknown") +
          " ETH / " +
          (m.wallet.usdc ?? "unknown") +
          " USDC",
        "Disk free: " +
          (m.disk.freeBytes === null
            ? "unknown"
            : (m.disk.freeBytes / 1024 ** 3).toFixed(1) + " GiB"),
      ].join("\n");
    } catch {
      el("opsHealth").textContent =
        "Reopen the app from its launcher to connect.";
    }
  }
  function action(id, work) {
    const node = el(id);
    node.addEventListener(
      node.tagName === "FORM" ? "submit" : "click",
      async (e) => {
        e.preventDefault();
        if (busy) return;
        busy = true;
        const b = node.tagName === "FORM" ? node.querySelector("button") : node;
        b.disabled = true;
        try {
          await work();
          message("Saved. Review the updated status below.");
          await refresh();
        } catch (e) {
          message(e.message);
        } finally {
          busy = false;
          b.disabled = false;
        }
      },
    );
  }
  action("opsRPC", async () => {
    await request("/api/rpc", {
      url: el("opsPrimary").value.trim(),
      verificationURL: el("opsWitness").value.trim(),
    });
    el("opsPrimary").value = "";
    el("opsWitness").value = "";
  });
  action("opsExportIdentity", async () =>
    download("AGI-Public-Identity.json", await request("/api/identity")),
  );
  action("opsImportIdentity", async () => {
    const f = el("opsPeer").files[0];
    if (!f || f.size > 4096)
      throw Error("Choose a public identity JSON file smaller than 4 KB.");
    await request("/api/operations/peer", {
      identity: JSON.parse(await f.text()),
    });
    el("opsPeer").value = "";
  });
  action("opsIndependence", () =>
    request("/api/config", {
      independenceReviewed: el("opsIndependent").checked,
    }),
  );
  action("opsMonitorAccess", async () => {
    const d = await request("/api/monitor/access", {});
    download("AGI-" + d.role + "-Monitor.json", d);
  });
  action("opsRevoke", () => request("/api/companion/revoke", {}));
  action("opsProbe", () => request("/api/operations/probe", {}));
  action("opsCommission", () =>
    request("/api/operations/record", {
      id: el("opsCase").value,
      status: el("opsResult").value,
      evidence: el("opsEvidence").value,
    }),
  );
  el("opsCase").onchange = () => {
    const r = current?.cases.find((x) => x.id === el("opsCase").value);
    el("opsResult").value = r?.status ?? "pending";
    el("opsEvidence").value = r?.evidence ?? "";
  };
  action("opsExportReport", async () =>
    download(
      "AGI-Commissioning-Evidence.json",
      await request("/api/operations/evidence"),
    ),
  );

  let pilot = null;
  function utcNow() {
    return new Date().toISOString().slice(0, 23);
  }
  el("pilotTime").value = utcNow();
  async function refreshPilot() {
    try {
      pilot = await request("/api/pilot");
      const run = pilot.runs.at(-1),
        active = run && run.endedAt === null;
      el("pilotStart").hidden = Boolean(active);
      el("pilotActive").hidden = !active || run.scopeMatches !== true;
      el("pilotFinish").disabled = !active;
      el("pilotExport").disabled = !run;
      el("pilotScopeNotice").textContent =
        active && run.scopeMatches !== true
          ? "Unlock to continue. If software or settings changed, finish this period, export it, and start a new one. Previous records remain labeled with their original scope."
          : "";
      if (!run) {
        el("pilotSummary").textContent =
          "No measurement period started. No real-world capacity has been measured here.";
        return;
      }
      const s = run.summary;
      el("pilotSummary").textContent = [
        run.label + (active ? " · recording" : " · finished"),
        "Started: " + new Date(run.startedAt).toISOString(),
        "Elapsed: " +
          (s.elapsedSeconds / 3600).toFixed(1) +
          " hours (including downtime)",
        "Operator-reported independently reviewed settlements: " +
          s.counts["settled-reviewed"],
        "Other paid outcomes: " + s.counts["settled-other"],
        "Failed: " + s.counts.failed + " · unresolved: " + s.counts.unresolved,
        "Reviewed settlements/day: " +
          (s.operatorReportedReviewedSettlementsPerDay ??
            "available after 24 hours"),
        "Reported revenue: " + s.receivedUSDC + " USDC (not profit)",
        "Reported gas: " +
          (s.costs.gasETH ?? "unknown") +
          " ETH · other costs: " +
          (s.costs.externalUSD ?? "unknown") +
          " USD",
        "Reported lost bonds / nonrefundable costs: " +
          (s.costs.lostUSDC ?? "unknown") +
          " USDC",
        "Recorded interventions: " +
          s.interventions +
          " · " +
          s.interventionMinutes +
          " minutes",
        "Local journal confirmed transactions: " +
          (run.journal
            ? run.journal.confirmedTransactions.reduce((n, t) => n + t.count, 0)
            : "unknown"),
        "Transactions are not completed jobs. Outcome evidence has not been independently verified.",
        ...(s.clockValid
          ? []
          : ["Clock changed: check system time before using this report."]),
      ].join("\n");
    } catch {
      el("pilotSummary").textContent =
        "Pilot report unavailable. Reopen the app or check the local pilot notebook; worker status is separate.";
    }
  }
  action("pilotStart", async () => {
    await request("/api/pilot/start", { label: el("pilotLabel").value });
    el("pilotTime").value = utcNow();
  });
  action("pilotJob", async () => {
    await request("/api/pilot/job", {
      jobId: el("pilotJobId").value.trim(),
      status: el("pilotOutcome").value,
      receipt: el("pilotReceipt").value.trim(),
      receivedUSDC: el("pilotReceived").value.trim(),
      settledAt: el("pilotTime").value
        ? Date.parse(el("pilotTime").value + "Z")
        : null,
      evidence: el("pilotJobEvidence").value,
      attest: el("pilotAttest").checked,
    });
    el("pilotJob").reset();
    el("pilotTime").value = utcNow();
  });
  action("pilotIntervention", async () => {
    await request("/api/pilot/intervention", {
      minutes: Number(el("pilotMinutes").value),
      evidence: el("pilotInterventionEvidence").value,
    });
    el("pilotIntervention").reset();
  });
  action("pilotCosts", () =>
    request("/api/pilot/costs", {
      gasETH: el("pilotGas").value.trim(),
      lostUSDC: el("pilotLost").value.trim(),
      externalUSD: el("pilotExternal").value.trim(),
      evidence: el("pilotCostEvidence").value,
    }),
  );
  action("pilotFinish", () => request("/api/pilot/finish", {}));
  action("pilotExport", async () => {
    const report = await request("/api/pilot");
    download("AGI-" + report.role + "-Pilot-Report.json", report);
  });

  setTimeout(refresh, 1500);
  setInterval(() => {
    if (!busy && !el("opsHealth").closest(".view").hidden) void refresh();
  }, 10000);
})();
