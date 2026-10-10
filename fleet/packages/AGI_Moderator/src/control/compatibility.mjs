import fs from 'node:fs';
const releases=JSON.parse(fs.readFileSync(new URL('../../config/companion-releases.json',import.meta.url)));
export function releaseCompatibility(){return {fleet:releases.fleet,agent:releases.agent,node:releases.node,public:releases.public,nodeRuntime:process.version,nodeRange:'>=24.19.0 <25',openclaw:'2026.9.5',contractProvenance:'Manager v1.1.0 and eight linked libraries; immutable artifact provenance preserved. Verify each deployed instance.'};}
