import fs from 'node:fs';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {roleContract, COMPUTE_ROLES} from '../fleet/shared/runtime/compute/roles.mjs';
import {parseStrict, canonical} from '../fleet/successor/vendor/manager/site/assets/successor/safe.mjs';
import {need,keys,uuid,MAX_BYTES} from './primitives.mjs';
export {need,keys,uuid,MAX_BYTES} from './primitives.mjs';

export {parseStrict, canonical, COMPUTE_ROLES, roleContract};
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const VERSION = '0.1.0-alpha.6';
export const digest = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export const id = () => crypto.randomUUID();
export function label(value) { need(typeof value === 'string' && value.length > 0 && value.length <= 80 && !/[\u0000-\u001f\u007f]/u.test(value), 'LABEL_INVALID'); return value; }
export function integer(value, min, max) { need(Number.isSafeInteger(value) && value >= min && value <= max, 'LIMIT_INVALID'); return value; }
export const ACTIONS = Object.freeze({agent:['successor-run','alpha-run','alpha-computer-run'], node:['successor-check'], moderator:['protocol-inspect'], employer:['protocol-inspect'], evidence:['evidence-inspect'], recovery:['protocol-inspect']});
export function packagePolicy(role) {
  need(COMPUTE_ROLES.includes(role), 'ROLE_INVALID');
  const base = new URL(`../role-skills/agi-${role}/`, import.meta.url);
  const files = ['SKILL.md', 'fleet-role.json', 'references/client.md'];
  const policy = parseStrict(fs.readFileSync(new URL('fleet-role.json', base), 'utf8'));
  keys(policy, ['schema','role','version','runtime','actions','capabilities','settlementAuthority']);
  need(policy.schema === 'agi-fleet/role-package/v1' && policy.role === role && policy.version === VERSION && policy.runtime === VERSION && policy.settlementAuthority === false, 'PACKAGE_POLICY_INVALID');
  need(canonical(policy.actions) === canonical(ACTIONS[role]), 'PACKAGE_ACTIONS_CHANGED');
  need(canonical(policy.capabilities) === canonical(role==='agent'?['bounded-offline','optional-scripted-browser-rehearsal']:['bounded-offline']), 'PACKAGE_CAPABILITIES_CHANGED');
  return {policy, sha256:digest(files.map(file => [file,digest(fs.readFileSync(new URL(file, base)))])), registry:digest(roleContract(role))};
}
export function validateTask(task, role) {
  keys(task, ['schema','action','workspace','input','review','sourceActor','sourceController']);
  need(task.schema === 'agi-fleet/local-task/v1', 'TASK_VERSION');
  need(ACTIONS[role]?.includes(task.action), 'ROLE_ACTION_DENIED');
  need(task.workspace === 'files', 'WORKSPACE_NOT_QUALIFIED');
  need(['none','internal','independent'].includes(task.review), 'REVIEW_KIND');
  if (role === 'node') {
    need(task.review !== 'none', 'REVIEW_KIND'); uuid(task.sourceActor); uuid(task.sourceController);
  } else need(task.review === 'none' && task.sourceActor === null && task.sourceController === null, 'REVIEW_SCOPE');
  need(Buffer.byteLength(canonical(task)) <= MAX_BYTES, 'INPUT_LIMIT');
  return task;
}
