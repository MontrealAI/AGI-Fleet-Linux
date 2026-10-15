export type Role = 'agent' | 'node' | 'moderator' | 'employer' | 'evidence' | 'recovery';
export type Workspace = 'files';
export interface TaskV1 {
  schema: 'agi-fleet/local-task/v1';
  action: 'alpha-run' | 'successor-run' | 'successor-check' | 'protocol-inspect' | 'evidence-inspect';
  workspace: Workspace;
  input: Record<string, unknown>;
  review: 'none' | 'internal' | 'independent';
  sourceActor: string | null;
  sourceController: string | null;
}
export interface PrepareRequest { actor: string; task: TaskV1 }
export interface AdmissionV1 {
  schema: 'agi-fleet/local-admission/v1';
  status: 'SUPPORTABLE' | 'MISSING_PREREQUISITE' | 'OUTSIDE_SCOPE';
  checkedAt: number; expiresAt: number; recheck: string;
  issues: Array<{code: string; kind: 'OUTSIDE_SCOPE' | 'MISSING_PREREQUISITE'; help: string}>;
  binding: {
    mode: 'local-skills'; platform: string; arch: string; machine: string;
    session: string | null; backend: string | null; hostIdentity: string | null;
    runtime: string; sourceSha256: string; node: string; packageSha256: string;
    registrySha256: string; actor: string; role: Role; controller: string; generation: number;
    provider: {route: 'none'; model: null; authentication: 'not-required'; modelCalls: 0};
    tools: {actions: string[]; capabilities: string[]; network: string; inference: string; files: string; browser: string; desktop: string};
    taskFamily: string | null; taskSha256: string; permissions: 'bounded-offline-only';
    review: {kind: TaskV1['review'] | null; sourceActor: string | null; sourceController: string | null; independent: false};
  };
  bindingSha256: string;
  qualification: {
    implemented: 'BOUNDED_OFFLINE_ONLY'; componentTested: 'REQUIRES_EXACT_SOURCE_EVIDENCE';
    nativeTested: 'REQUIRES_EXACT_SOURCE_EVIDENCE';
    hostProbe: 'NATIVE_HOST_PROBE_PASS' | 'SYNTHETIC_OR_UNVERIFIED_PROBE' | 'BLOCKED';
    liveObserved: 'NOT_RUN'; operationallyQualified: false; independentlyReviewed: 'NOT_VERIFIED';
    commerciallyMeasured: 'NOT_RUN'; productionQualified: false;
  };
  acceptedContract: {
    taskSha256: string; inputs: string; rights: string; requestedResult: string;
    operation: TaskV1['action']; taskFamily: string; deliverables: string[]; checks: string;
    authority: string; limits: PreparedGrant['limits']; deadline: number; recovery: string;
  } | null;
}
export interface PreparedGrant {
  grant: string; commitment: string; actor: string; task: TaskV1;
  expiresAt: number; confirmationRequired: true;
  limits: { wallMs: 15000; cpuSeconds: 10; heapMiB: 128; outputBytes: 2000000; modelCalls: 0; spendUSDC: '0'; actions: 1 };
}
export interface AuthorizeRequest { grant: string; commitment: string; confirm: true }
export interface RunRequest { actor: string; grant: string }
export interface Artifact { name: string; mediaType: string; content: string }
export interface PortableRoleV1 {
  payload: { schema: 'agi-fleet/portable-role/v1'; role: Role; name: string; sourceActor: string; packageSha256: string; authority: 'none' };
  sha256: string;
}
export type OperatorOperation = 'create'|'activate'|'authorize'|'grant-inspect'|'client'|'revoke'|'revoke-client'|'pause'|'stop'|'resume'|'reconciliation'|'reconcile'|'import'|'export'|'doctor'|'diagnostics'|'project-assemble'|'project-select'|'project-export'|'project-import'|'project-continue-history';
export type ScopedOperation = 'status'|'client-info'|'inspect'|'admission'|'prepare'|'run'|'cancel'|'output';
export interface DiagnosticsV1 {
  schema: 'agi-fleet/local-diagnostics/v1';
  runtime: string;
  system: { platform: string; architecture: string; node: string };
  readiness: { operationalProbe: 'PASS'|'BLOCKED'; code: string|null; physicalQualification: 'NOT_RUN' };
  controls: { stopped: boolean; paused: boolean };
  actorsByRole: Record<Role, number>;
  grants: Record<'prepared'|'authorized'|'consumed'|'revoked', number>;
  runs: Record<'running'|'complete'|'uncertain'|'reconciled', number>;
  productionQualified: false;
  economicAuthority: false;
  liveProviderQualification: 'NOT_RUN';
}

/** Exact UTF-8 JSON text, preserved unchanged; no command, path or runtime pins. */
export interface AlphaInputV1 { workSpec: string }
