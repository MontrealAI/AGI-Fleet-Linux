const token = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
const $ = (id) => document.getElementById(id);
const human = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ");
function row(values) {
  const r = document.createElement("tr");
  for (const v of values) {
    const c = document.createElement("td");
    c.textContent = String(v);
    r.append(c);
  }
  return r;
}
async function refresh() {
  try {
    const r = await fetch("/api/status", {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
    });
    if (!r.ok) throw Error();
    const s = await r.json(),
      x = s.runtime ?? {};
    const counts = Object.fromEntries(s.counts.map((c) => [c.status, c.count]));
    $("mode").textContent = x.mode ?? "STARTING";
    $("status").textContent = human(x.status) || "Waiting for first cycle";
    $("message").textContent = x.message ?? human(x.reason);
    $("notice").textContent = x.reason
      ? "Attention: " + human(x.reason) + ". Check the troubleshooting guide."
      : "";
    $("reviewed").textContent =
      (counts.reviewed ?? 0) +
      (counts["would-approve"] ?? 0) +
      (counts["would-reject"] ?? 0);
    $("voted").textContent = s.votedTotal ?? 0;
    $("abstained").textContent =
      (counts.abstained ?? 0) + (counts.unsupported ?? 0);
    $("cursor").textContent = s.cursor?.number ?? "—";
    $("jobs").replaceChildren(
      ...s.jobs.map((j) => row([j.id, human(j.status), human(j.reason)])),
    );
    $("empty").hidden = s.jobs.length > 0;
    $("transactions").replaceChildren(
      ...s.transactions.map((t) => {
        const p = document.createElement("p");
        p.textContent = human(t.kind) + " · " + human(t.state) + " · " + t.hash;
        return p;
      }),
    );
    if (!s.transactions.length) {
      const p = document.createElement("p");
      p.textContent = "No signed transactions.";
      $("transactions").append(p);
    }
    $("updated").textContent =
      "Updated " +
      (x.updated ? new Date(x.updated).toLocaleTimeString() : "just now");
  } catch {
    $("status").textContent = "Dashboard disconnected";
    $("message").textContent =
      "Start the node and open the complete private dashboard link printed in its terminal.";
  }
}
refresh();
setInterval(refresh, 5000);
