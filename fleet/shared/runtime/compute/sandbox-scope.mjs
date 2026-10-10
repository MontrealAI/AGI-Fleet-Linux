import path from 'node:path';
import crypto from 'node:crypto';

// OpenClaw 2026.9.5, commit ec9c1a13db8938e5a3eaa51fca2e981cde2395a9:
// src/agents/sandbox/shared.ts qualifies session scopes with the configured
// agent workspace. CLI recreate and Docker labels use this key, not the raw
// chat session key. Keep this adapter pinned and test against that source.
const session=/^agent:(agi-creator|agi-reviewer):agi-work-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const need=ok=>{if(!ok)throw Error('COMPUTE_CLEANUP_SCOPE_REQUIRED');};
export function sandboxScopeKey(c,sessionKey){
 need(session.test(sessionKey));
 need(typeof c.workspace==='string'&&path.isAbsolute(c.workspace)&&path.resolve(c.workspace)===c.workspace&&c.workspace.trim()===c.workspace&&!/[\x00-\x1f\x7f]/.test(c.workspace));
 return `${sessionKey}:workspace:${hash(c.workspace).slice(0,32)}`;
}
export function sandboxWorkspaceRoot(c,sessionKey){
 need(typeof c.jobRoot==='string'&&path.isAbsolute(c.jobRoot)&&path.resolve(c.jobRoot)===c.jobRoot&&c.jobRoot.trim()===c.jobRoot);
 return path.join(c.jobRoot,`workspace-${hash(sandboxScopeKey(c,sessionKey)).slice(0,32)}`);
}
export function isSandboxScopeKey(value,sessionKey){
 return session.test(sessionKey)&&typeof value==='string'&&value.startsWith(sessionKey+':workspace:')&&/^[a-f0-9]{32}$/.test(value.slice(sessionKey.length+11));
}
