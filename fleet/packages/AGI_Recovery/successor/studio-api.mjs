import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Use the installed edition's existing Studio validators in both the Fleet
// archive and individual role archives. Loading remains local and on demand.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function studio(role='agent'){
  const app=fs.existsSync(path.join(root,'src/studio.mjs'))?root:path.join(root,'packages',role==='agent'?'AGI_Agent':'AGI_Node');
  return {...await import(pathToFileURL(path.join(app,'src/studio.mjs'))),...await import(pathToFileURL(path.join(app,'src/artifacts.mjs')))};
}
