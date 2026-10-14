import {COMPUTE_ROLES, VERSION, keys} from '../contracts.mjs';

const HOST_CODES = new Set([
  'PLATFORM_NOT_QUALIFIED', 'NODE_VERSION_UNSUPPORTED',
  'SANDBOX_PREREQUISITE_MISSING', 'SANDBOX_EXECUTABLE_UNTRUSTED',
  'SANDBOX_PROBE_TIMEOUT', 'SANDBOX_NAMESPACE_DENIED',
  'SANDBOX_WORKING_DIRECTORY', 'SANDBOX_LOADER_UNAVAILABLE',
  'SANDBOX_UNAVAILABLE', 'INSTALLATION_INCOMPLETE',
]);

// Construct a fresh allowlist. Never serialize status, actors, grants, events,
// backend help/stderr, or run receipts and then try to redact their secrets.
export function diagnostics(runtime, input, principal) {
  runtime.scope(principal, 'diagnostics');
  keys(input, []);
  const host = runtime.doctor();
  const roles = Object.fromEntries(COMPUTE_ROLES.map(role => [role, 0]));
  for (const actor of runtime.store.listActors()) {
    if (Object.hasOwn(roles, actor.role)) roles[actor.role]++;
  }
  const counts = (table, states) => Object.fromEntries(states.map(state => [state,
    runtime.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE state=?`).get(state).n,
  ]));
  return {
    schema: 'agi-fleet/local-diagnostics/v1',
    runtime: VERSION,
    system: {platform: process.platform, architecture: process.arch, node: process.versions.node},
    readiness: {
      operationalProbe: host.supported === true ? 'PASS' : 'BLOCKED',
      code: host.supported === true ? null : (HOST_CODES.has(host.code) ? host.code : 'HOST_CHECK_BLOCKED'),
      physicalQualification: 'NOT_RUN',
    },
    controls: {stopped: runtime.emergency === true || runtime.store.meta('stopped') === true,
      paused: runtime.store.meta('paused') === true},
    actorsByRole: roles,
    grants: counts('grants', ['prepared', 'authorized', 'consumed', 'revoked']),
    runs: counts('runs', ['running', 'complete', 'uncertain', 'reconciled']),
    productionQualified: false,
    economicAuthority: false,
    liveProviderQualification: 'NOT_RUN',
  };
}
