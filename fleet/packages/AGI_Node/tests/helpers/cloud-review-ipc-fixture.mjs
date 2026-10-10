// Uses the actual worker IPC handlers without a start message: no RPC, wallet,
// provider, browser, or transaction work is initialized by this fixture.
import fs from 'node:fs';
import {cloudReviewer} from '../../src/worker.mjs';
import {reviewJob,DECLARATION} from '../../src/review.mjs';
import {buildBundle} from '../../src/artifacts.mjs';
import {sha256} from '../../src/util.mjs';
const specification=JSON.parse(fs.readFileSync(new URL('../../examples/computer-work-v2.json',import.meta.url)));
const source=Buffer.from(JSON.stringify(specification)),delivery=Buffer.from(buildBundle(specification,new Map([['result.json',Buffer.from('{"result":true}')]])));
const reader={read:async()=>({bytes:source,sha256:sha256(source)}),readBundle:async()=>({bytes:delivery,sha256:sha256(delivery)})};
const result=await reviewJob({details:DECLARATION},{specURI:'ipfs://fixture-spec',completionURI:'ipfs://fixture-delivery'},reader,{enabled:false,reviewComputerWork:true,cloudVeto:true,cloudPublicOnly:true},cloudReviewer);
process.send({type:'fixture-review-result',result},()=>process.disconnect());
