import fs from 'node:fs';
import {COMPUTE_ROLES,packagePolicy,need,VERSION} from './contracts.mjs';
for(const role of COMPUTE_ROLES){const value=packagePolicy(role),raw=fs.readFileSync(new URL(`../role-skills/agi-${role}/SKILL.md`,import.meta.url),'utf8');need(raw.startsWith(`---\nname: agi-${role}\ndescription: `),'SKILL_FRONTMATTER');need(raw.includes('references/client.md')&&raw.split('\n').length<500,'SKILL_STRUCTURE');need(value.policy.version===VERSION,'SKILL_VERSION');}
const report=JSON.parse(fs.readFileSync(new URL('./compatibility.json',import.meta.url)));need(report.productionQualified===false&&report.fundedWork==='DISABLED'&&report.backends['macos-arm64']==='BLOCKED_NOT_IMPLEMENTED','QUALIFICATION_CLAIM');
console.log(JSON.stringify({status:'PASS',skills:COMPUTE_ROLES.length,version:VERSION,formatOnly:true,clientQualified:false}));
