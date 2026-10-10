import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {runtimeEnvironment} from '../compute/runtime-env.mjs';
const c=JSON.parse(fs.readFileSync(0,'utf8')),root=process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT;process.argv=[c.node,c.openclaw];
const {t:plan}=await import(pathToFileURL(path.join(root,'dist/daemon-install-helpers-BQ0CTd58.mjs')));const {l:write}=await import(pathToFileURL(path.join(root,'dist/launchd-service-files-Chcm4HTZ.mjs')));
const env={...runtimeEnvironment(c),OPENCLAW_WRAPPER:c.gatewayWrapper,NODE_OPTIONS:'--max-old-space-size='+(c.gatewayHeapMiB??4096)},config=JSON.parse(fs.readFileSync(c.gatewayConfig));
const p=await plan({env,config,authStore:{version:1,profiles:{}},runtime:'node',platform:'darwin',devMode:false,port:c.gatewayPort});await write({env,...p});
