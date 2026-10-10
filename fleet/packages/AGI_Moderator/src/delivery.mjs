import { rawCID } from './content.mjs';
import { decodeImage, isImageSpec } from './images.mjs';
import { sha256 } from './util.mjs';
export const deliveryBytes = (content, spec) => isImageSpec(spec?.acceptance ?? spec) ? decodeImage(content) : Buffer.from(content);
const vi = n => { const out=[]; do {const v=n%128;n=Math.floor(n/128);out.push(v | (n?128:0));}while(n);return Buffer.from(out);};
const field = (n,data) => Buffer.concat([vi(n*8+2),vi(data.length),data]);
const integer = (n,value) => Buffer.concat([vi(n*8),vi(value)]);
// Deterministic single-level UnixFS file with 256 KiB raw leaves; exact hashes
// can be checked before Kubo is contacted and again after public retrieval.
export function deliveryPlan(bytes) {
  if(bytes.length <= 262144) return {uri:'ipfs://'+rawCID(bytes), blocks:[{cid:rawCID(bytes),codec:'raw',bytes}]};
  const blocks=[];
  for(let i=0;i<bytes.length;i+=262144) {const b=bytes.subarray(i,i+262144);blocks.push({cid:rawCID(b),codec:'raw',bytes:b});}
  const links=blocks.map(b=>field(2,Buffer.concat([field(1,Buffer.concat([Buffer.from([1,0x55,0x12,32]),Buffer.from(sha256(b.bytes),'hex')])),field(2,Buffer.alloc(0)),integer(3,b.bytes.length)])));
  const unix=Buffer.concat([integer(1,2),integer(3,bytes.length),...blocks.map(b=>integer(4,b.bytes.length))]);
  const root=Buffer.concat([...links,field(1,unix)]), cid=rawCID(root,0x70);
  blocks.push({cid,codec:'dag-pb',bytes:root});
  return {uri:'ipfs://'+cid,blocks};
}
