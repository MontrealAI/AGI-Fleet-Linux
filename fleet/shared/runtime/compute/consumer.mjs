import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
export const consumerRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const consumerCompute=path.join(consumerRoot,'compute');
export const consumerFile=relative=>path.join(consumerRoot,relative);
export const consumerURL=relative=>pathToFileURL(consumerFile(relative));
