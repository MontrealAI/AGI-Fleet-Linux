let token = "",
  busy = false,
  notifications = false,
  first = true;
const $ = (id) => document.getElementById(id),
  previous = new Map();
const node = (tag, text) => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
async function request(route, body) {
  const r = await fetch(route, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error);
  return d;
}
function alert(title, body) {
  if (notifications && Notification.permission === "granted")
    new Notification(title, { body });
}
async function refresh() {
  if (busy || !token) return;
  busy = true;
  try {
    const r = await request("/api/status");
    $("notice").textContent = r.storageError
      ? "Observation storage failed. Check disk space and permissions."
      : "Updated " + new Date().toLocaleTimeString();
    if (r.watchdog)
      $("watchdogState").textContent = r.watchdog.enabled
        ? "External checks: " +
          r.watchdog.state +
          " · expected machines: " +
          r.watchdog.expectedActors +
          " · roster " +
          (r.watchdog.rosterMatches ? "matches" : "CHANGED") +
          " · last alive accepted: " +
          (r.watchdog.aliveAcceptedAt ?? "not yet") +
          " · last healthy accepted: " +
          (r.watchdog.healthyAcceptedAt ?? "not yet")
        : "External heartbeat checks are disabled. Browser alerts alone cannot detect failure of this monitor Mac.";
    $("actors").replaceChildren(
      ...r.actors.map((a) => {
        const box = node("article", "");
        box.className = "panel " + a.state;
        box.append(
          node("p", a.role.toUpperCase()),
          node("h2", a.name),
          node("strong", a.state.toUpperCase()),
        );
        const s = a.status;
        if (s) {
          for (const line of [
            "Cycle: " + (s.worker.lastSuccessAt ?? "not yet"),
            "RPC: " +
              s.rpc.state +
              " · finalized " +
              (s.rpc.finalizedBlock ?? "unknown"),
            "OpenClaw: " + s.openclaw.gateway,
            "AI calls: " +
              s.openclaw.calls24h +
              " / " +
              s.openclaw.limit24h +
              (s.openclaw.retryAt
                ? " · backoff until " + s.openclaw.retryAt
                : ""),
            "IPFS: " + s.ipfs.localPublisher,
            "Wallet: " +
              (s.wallet.eth ?? "unknown") +
              " ETH / " +
              (s.wallet.usdc ?? "unknown") +
              " USDC",
            "Active jobs: " +
              s.activeJobs +
              " · pending transaction: " +
              (s.pendingTransaction ? s.pendingTransaction.kind : "none"),
            "Disk free: " +
              (s.disk.freeBytes === null
                ? "unknown"
                : (s.disk.freeBytes / 1024 ** 3).toFixed(1) + " GiB"),
            "App " +
              s.version +
              " · Node " +
              s.software.node +
              " · OpenClaw pin " +
              s.software.openclawPinned,
          ])
            box.append(node("p", line));
        } else
          box.append(
            node(
              "p",
              "No current sample. Check the tunnel, app and read token.",
            ),
          );
        if (a.history)
          box.append(
            node(
              "p",
              "Observed samples: " +
                a.history.samples +
                " · needing attention: " +
                a.history.unhealthySamples,
            ),
          );
        const b = node("button", "Remove connection");
        b.onclick = async () => {
          try {
            await request("/api/remove", { id: a.id });
            await refresh();
          } catch (e) {
            $("notice").textContent = e.message;
          }
        };
        box.append(b);
        if (!first && previous.get(a.id) !== a.state && a.state !== "healthy")
          alert(a.name + ": " + a.state, "Check AGI Fleet Monitor.");
        previous.set(a.id, a.state);
        return box;
      }),
    );
    first = false;
  } catch {
    $("notice").textContent =
      "MONITOR DISCONNECTED. Displayed data is stale. Reopen Fleet Monitor.";
    for (const card of $("actors").children) {
      card.className = "panel offline";
      card.querySelector("strong").textContent = "STALE";
    }
  } finally {
    busy = false;
  }
}
$("add").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const f = $("file").files[0];
    if (!f || f.size > 4096)
      throw Error("Choose a monitoring JSON file smaller than 4 KB.");
    await request("/api/add", {
      name: $("name").value,
      forwardPort: Number($("port").value),
      connection: JSON.parse(await f.text()),
    });
    $("file").value = "";
    await refresh();
  } catch (e) {
    $("notice").textContent = e.message;
  }
};
$("export").onclick = async () => {
  try {
    const r = await request("/api/report"),
      u = URL.createObjectURL(
        new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }),
      ),
      a = node("a", "");
    a.href = u;
    a.download = "AGI-Fleet-Observations.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  } catch (e) {
    $("notice").textContent = e.message;
  }
};
$("alerts").onclick = async () => {
  if (!("Notification" in window)) {
    $("notice").textContent = "Browser notifications unavailable.";
    return;
  }
  notifications = (await Notification.requestPermission()) === "granted";
  $("notice").textContent = notifications
    ? "Browser alerts enabled while this page remains open."
    : "Browser alerts were not enabled.";
};
$("quit").onclick = async () => {
  try {
    await request("/api/quit", {});
    token = "";
    $("notice").textContent =
      "Monitor process stopped. If supervised, it restarts automatically. Use Remove-Supervised-Monitor.command to stop the services. AGI workers are unaffected.";
  } catch (e) {
    $("notice").textContent = e.message;
  }
};
(async () => {
  const bootstrap = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  try {
    const r = await request("/api/session", { token: bootstrap });
    token = r.token;
    await refresh();
    setInterval(refresh, 10000);
  } catch (e) {
    $("notice").textContent = e.message;
  }
})();

$("watchdogForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await request("/api/watchdog", {
      aliveURL: $("aliveURL").value.trim(),
      healthyURL: $("healthyURL").value.trim(),
      consent: $("watchdogConsent").checked,
    });
    $("watchdogForm").reset();
    await refresh();
  } catch (e) {
    $("notice").textContent = e.message;
  }
};
$("disableWatchdog").onclick = async () => {
  try {
    await request("/api/watchdog/disable", {});
    await refresh();
  } catch (e) {
    $("notice").textContent = e.message;
  }
};
