import fs from 'node:fs';
const registry=JSON.parse(fs.readFileSync(new URL('./role-registry.json',import.meta.url)));
export const COMPUTE_ROLES=Object.freeze(Object.keys(registry.roles));
export const OPERATOR_ROLES=Object.freeze(COMPUTE_ROLES.filter(role=>!['agent','node'].includes(role)));
export function roleContract(role){const value=registry.roles[role];if(!value)throw Error('COMPUTE_ROLE_REQUIRED');return structuredClone(value);}
export function setupRole(kit){if(kit?.schema==='agi-agent-openclaw-setup/v1')return 'agent';if(kit?.schema==='agi-node-openclaw-setup/v1')return 'node';if(kit?.schema==='agi-fleet-role-openclaw-setup/v2'&&OPERATOR_ROLES.includes(kit.role))return kit.role;throw Error('OPENCLAW_SETUP_FILE');}

export const ALL_OAUTH_ROLES=Object.freeze([...new Set(COMPUTE_ROLES.flatMap(role=>registry.roles[role].oauth))]);
export function roleSkills(role,workstation=true){return OPERATOR_ROLES.includes(role)?[]:workstation?['agi-public-research','agi-code-and-data','agi-image-production','agi-browser-work','agi-desktop-work','agi-document-work','agi-evidence-review']:['agi-public-research','agi-code-and-data','agi-image-production'];}
