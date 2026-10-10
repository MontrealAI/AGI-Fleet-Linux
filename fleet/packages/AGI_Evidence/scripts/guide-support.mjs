import {createHash} from 'node:crypto';
export const digest=text=>createHash('sha256').update(text).digest('hex');
export function headingIds(html){
 const used=new Map();return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g,(_,level,body)=>{
 const slug=body.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&(?:quot|#39|lt|gt);/g,'').toLowerCase().replace(/[^\p{L}\p{N}\p{M}_ -]/gu,'').replace(/ /g,'-');
 const count=used.get(slug)||0;used.set(slug,count+1);return '<h'+level+' id="'+slug+(count?'-'+count:'')+'">'+body+'</h'+level+'>';
 });
}
