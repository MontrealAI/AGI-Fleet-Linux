export function health(snapshot, timestamp = Math.floor(Date.now() / 1000)) {
  const s = snapshot,
    issues = [];
  if (s.error) issues.push(s.error);
  if (s.paused) issues.push("SIGNING_PAUSED");
  if (!s.running) issues.push("SERVICE_STOPPED");
  if (
    !s.lastCycle ||
    timestamp - s.lastCycle.time > Math.max(900, s.config.pollSeconds * 3)
  )
    issues.push("NO_RECENT_CYCLE");
  if (s.status === "settlement-paused") issues.push("SETTLEMENT_PAUSED");
  if (s.stats.exhaustedClaims > 0) issues.push("CLAIM_RETRIES_EXHAUSTED");
  if (s.stats.blockedJobs > 0) issues.push("JOBS_NEED_ATTENTION");
  if (s.stats.openExceptions > 0) issues.push("OPEN_EXCEPTIONS");
  if (s.mode === "live" && (!s.activation || s.activation.expires <= timestamp))
    issues.push("AUTHORITY_EXPIRED");
  return {
    schema: "agi-fleet-health/v1",
    role: s.role,
    version: s.version,
    mode: s.mode,
    status: s.status,
    healthy: issues.length === 0,
    issues: [...new Set(issues)],
    stats: s.stats,
    lastCycle: s.lastCycle?.time ?? null,
    authorityExpires: s.activation?.expires ?? null,
  };
}
