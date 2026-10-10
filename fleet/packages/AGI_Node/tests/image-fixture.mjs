import { deflateSync } from 'node:zlib';
import { crc32, MAX_IMAGE_BYTES } from '../src/images.mjs';
export const imageSpec={schema:'agi-node-job/v1',profile:'image-png/v1',title:'Blue square',prompt:'Create an original blue square on a white background.',criteria:[{id:'blue',requirement:'One blue square is visible.'},{id:'white',requirement:'The background is white.'}],width:1024,height:1024,maxBytes:MAX_IMAGE_BYTES,dataPolicy:'public'};
export function chunk(type,data) {
  const kind=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([kind,data])));return Buffer.concat([len,kind,data,crc]);
}
export function png(width=1024,height=1024) {
  const h=Buffer.alloc(13);h.writeUInt32BE(width,0);h.writeUInt32BE(height,4);h[8]=8;h[9]=2;
  const pixels=Buffer.alloc((width*3+1)*height,255);
  for(let y=0;y<height;y++) {pixels[y*(width*3+1)]=0;for(let x=Math.floor(width/4);x<width*3/4;x++)if(y>height/4 && y<height*3/4){const p=y*(width*3+1)+1+x*3;pixels[p]=0;pixels[p+1]=0;}}
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
