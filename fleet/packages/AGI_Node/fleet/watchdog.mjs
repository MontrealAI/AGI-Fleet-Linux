import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
const requireValue = (v, message) => {
  if (!v) throw Error(message);
};
const write = (file, value) => {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
};
export function heartbeatURL(value) {
  requireValue(
    typeof value === "string" && value.length <= 2048,
    "Enter a private HTTPS heartbeat URL.",
  );
  let u;
  try {
    u = new URL(value);
  } catch {
    throw Error("Enter a private HTTPS heartbeat URL.");
  }
  requireValue(
    u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      (!u.port || u.port === "443") &&
      !isIP(u.hostname.replaceAll("[", "").replaceAll("]", "")) &&
      /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(u.hostname) &&
      !/(^|\.)(localhost|local|internal|test|invalid)$/i.test(u.hostname),
    "Use the public HTTPS endpoint of your chosen external heartbeat service, without URL user/password credentials.",
  );
  return u.href;
}
export class Watchdog {
  constructor(home, { fetchImpl = fetch, clock = Date.now } = {}) {
    this.file = path.join(home, "watchdog.json");
    this.stateFile = path.join(home, "watchdog-state.json");
    this.fetch = fetchImpl;
    this.clock = clock;
    this.lastAttempt = -Infinity;
    this.busy = false;
    this.revision = 0;
    this.config = null;
    this.state = {};
    if (fs.existsSync(this.file)) {
      requireValue(
        fs.statSync(this.file).size <= 8192,
        "Heartbeat configuration invalid.",
      );
      const c = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (c.enabled) this.config = this.validate(c);
    }
    if (
      fs.existsSync(this.stateFile) &&
      fs.statSync(this.stateFile).size <= 4096
    ) {
      try {
        this.state = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
      } catch {}
    }
  }
  validate(c) {
    requireValue(
      Array.isArray(c.expected) &&
        c.expected.length > 0 &&
        c.expected.length <= 32 &&
        new Set(c.expected).size === c.expected.length &&
        c.expected.every((id) => /^[a-f0-9-]{36}$/.test(id)),
      "Add every expected machine before configuring external alerts.",
    );
    const aliveURL = heartbeatURL(c.aliveURL),
      healthyURL = heartbeatURL(c.healthyURL);
    requireValue(
      aliveURL !== healthyURL,
      "Create two distinct external checks: monitor alive and fleet healthy.",
    );
    return {
      enabled: true,
      aliveURL,
      healthyURL,
      expected: [...c.expected].sort(),
    };
  }
  configure(input, actors) {
    requireValue(
      input.consent === true,
      "Confirm that you authorize empty heartbeat requests to the selected external service.",
    );
    const next = this.validate({ ...input, expected: actors.map((a) => a.id) });
    write(this.stateFile, {});
    write(this.file, next);
    this.config = next;
    this.state = {};
    this.lastAttempt = -Infinity;
    this.revision++;
    return this.summary(actors);
  }
  disable() {
    write(this.file, { enabled: false });
    this.config = null;
    this.state = {};
    this.revision++;
    write(this.stateFile, {});
    return { disabled: true };
  }
  matches(actors) {
    return Boolean(
      this.config &&
        JSON.stringify(actors.map((a) => a.id).sort()) ===
          JSON.stringify(this.config.expected),
    );
  }
  summary(actors = []) {
    // Never expose endpoint URLs/tokens, actor identities or copied private config.
    return {
      enabled: Boolean(this.config),
      expectedActors: this.config?.expected.length ?? 0,
      rosterMatches: this.matches(actors),
      intervalSeconds: 60,
      lastAttemptAt:
        typeof this.state.lastAttemptAt === "string"
          ? this.state.lastAttemptAt
          : null,
      aliveAcceptedAt:
        typeof this.state.aliveAcceptedAt === "string"
          ? this.state.aliveAcceptedAt
          : null,
      healthyAcceptedAt:
        typeof this.state.healthyAcceptedAt === "string"
          ? this.state.healthyAcceptedAt
          : null,
      state: [
        "accepted",
        "unhealthy",
        "delivery-failed",
        "roster-changed",
      ].includes(this.state.state)
        ? this.state.state
        : "not-tested",
      qualification:
        "HTTP acceptance is not proof that an alert reached you. Configure missed-heartbeat alerts externally and test loss of this monitor host. No balances, addresses, evidence or keys are sent.",
    };
  }
  async tick(report) {
    if (
      !this.config ||
      this.busy ||
      performance.now() - this.lastAttempt < 60000
    )
      return;
    this.busy = true;
    this.lastAttempt = performance.now();
    const config = this.config,
      revision = this.revision,
      now = this.clock(),
      at = new Date(now).toISOString();
    const post = async (url) => {
      try {
        const r = await this.fetch(url, {
          method: "POST",
          body: "",
          redirect: "error",
          signal: AbortSignal.timeout(4000),
          headers: { "Content-Type": "text/plain" },
        });
        await r.body?.cancel();
        return r.ok;
      } catch {
        return false;
      }
    };
    try {
      const alive = await post(config.aliveURL);
      if (revision !== this.revision) return;
      const rosterMatches = this.matches(report.actors);
      const healthy =
        rosterMatches &&
        !report.storageError &&
        report.actors.every((a) => {
          const age = now - Date.parse(a.checkedAt);
          return (
            a.state === "healthy" &&
            Number.isFinite(age) &&
            age >= 0 &&
            age < 90000
          );
        });
      const accepted = healthy ? await post(config.healthyURL) : false;
      if (revision !== this.revision) return;
      this.state = {
        ...this.state,
        lastAttemptAt: at,
        ...(alive ? { aliveAcceptedAt: at } : {}),
        ...(accepted ? { healthyAcceptedAt: at } : {}),
        state:
          !alive || (healthy && !accepted)
            ? "delivery-failed"
            : !rosterMatches
              ? "roster-changed"
              : healthy
                ? "accepted"
                : "unhealthy",
      };
      write(this.stateFile, this.state);
    } finally {
      this.busy = false;
    }
  }
}
