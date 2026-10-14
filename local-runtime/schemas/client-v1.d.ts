export type Role = 'agent' | 'node' | 'moderator' | 'employer' | 'evidence' | 'recovery';
export type Workspace = 'files';
export interface TaskV1 {
  schema: 'agi-fleet/local-task/v1';
  action: 'successor-run' | 'successor-check' | 'protocol-inspect' | 'evidence-inspect';
  workspace: Workspace;
  input: Record<string, unknown>;
  review: 'none' | 'internal' | 'independent';
  sourceActor: string | null;
  sourceController: string | null;
}
export interface PrepareRequest { actor: string; task: TaskV1 }
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
export type OperatorOperation = 'create'|'activate'|'authorize'|'grant-inspect'|'client'|'revoke'|'revoke-client'|'pause'|'stop'|'resume'|'reconciliation'|'reconcile'|'import'|'export'|'doctor'|'diagnostics'|'project-assemble'|'project-select'|'project-export'|'project-import';
export type ScopedOperation = 'status'|'client-info'|'inspect'|'prepare'|'run'|'cancel'|'output';
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
