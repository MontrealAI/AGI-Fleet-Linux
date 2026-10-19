// SPDX-License-Identifier: MIT
// Called afresh at verification from trusted runner variables, never from retained evidence.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {sha256} from './bridge.mjs';
const [architecture,archive]=process.argv.slice(2);
const value={repository:process.env.GITHUB_REPOSITORY,commit:process.env.GITHUB_SHA,workflowRun:process.env.GITHUB_RUN_ID,workflowAttempt:process.env.GITHUB_RUN_ATTEMPT};
assert.equal(value.repository,'MontrealAI/AGI-Fleet-Linux');assert.match(value.commit??'',/^[a-f0-9]{40}$/);assert.match(value.workflowRun??'',/^[1-9][0-9]*$/);assert.match(value.workflowAttempt??'',/^[1-9][0-9]*$/);
if(architecture){assert(['x64','arm64'].includes(architecture));assert(archive);value.architecture=architecture;value.archiveSHA256=sha256(fs.readFileSync(archive));}
console.log(JSON.stringify(value));
