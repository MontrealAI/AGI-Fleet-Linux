import path from 'node:path';
import {consumerRoot} from './consumer.mjs';
if(process.argv[1]&&path.dirname(path.resolve(process.argv[1]))===path.join(consumerRoot,'ops'))process.argv[1]=path.join(consumerRoot,'shared/operator/ops',path.basename(process.argv[1]));
