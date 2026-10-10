import fs from 'node:fs';
const registry=JSON.parse(fs.readFileSync(new URL('../config/role-registry.json',import.meta.url))).roles;
export function setupTarget(kit,{cleanInstall=false}={}){
 const role=kit?.schema==='agi-agent-openclaw-setup/v1'?'agent':kit?.schema==='agi-node-openclaw-setup/v1'?'node':kit?.schema==='agi-fleet-role-openclaw-setup/v2'?kit.role:null;
 if(role&&registry[role]&&registry[role].schema===kit.schema){if(cleanInstall&&kit.mode!=='workstation')throw Error('CLEAN_INSTALL_WORKSTATION_REQUIRED');return 'packages/'+registry[role].package+'/scripts/setup-openclaw.mjs';}
 if(kit?.schema==='agi-fleet-openclaw-setup/v1'&&!cleanInstall)return null;
 throw Error(cleanInstall?'CLEAN_INSTALL_WORKSTATION_REQUIRED':'SETUP_SCHEMA_UNSUPPORTED');
}
