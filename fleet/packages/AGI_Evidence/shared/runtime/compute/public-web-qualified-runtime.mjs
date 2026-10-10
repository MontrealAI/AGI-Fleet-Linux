import fs from 'node:fs';
import path from 'node:path';
import {canonical,sha256,ensure} from '../src/util.mjs';
import {publicWebQualificationIdentity} from './public-web-qualification-identity.mjs';
import {verifyPublicWebQualification} from './public-web-qualification.mjs';
export function readPublicWebQualification(c,{now=Date.now(),identity=publicWebQualificationIdentity}={}){
 const p=c.publicWebPolicy,file=path.join(c.profileDir,'public-web-qualification','receipt.json');
 ensure(p?.enabled===true&&p.mode==='qualified'&&p.qualificationReceiptFile===file&&/^[a-f0-9]{64}$/.test(p.qualificationReceiptSha256??'')&&p.qualificationEvidenceSha256===p.qualificationReceiptSha256,'PUBLIC_WEB_QUALIFICATION_RECEIPT_REQUIRED');
 let cursor=path.parse(file).root;for(const component of path.dirname(file).slice(cursor.length).split(path.sep)){cursor=path.join(cursor,component);const s=fs.lstatSync(cursor);ensure(s.isDirectory()&&!s.isSymbolicLink(),'PUBLIC_WEB_QUALIFICATION_PRIVATE_FILE');}
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let receipt;try{const st=fs.fstatSync(fd);ensure(st.isFile()&&st.nlink===1&&st.uid===process.getuid?.()&&!(st.mode&0o077)&&st.size<=2*1024*1024,'PUBLIC_WEB_QUALIFICATION_PRIVATE_FILE');receipt=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
 ensure(sha256(canonical(receipt))===p.qualificationReceiptSha256,'PUBLIC_WEB_QUALIFICATION_RECEIPT_CHANGED');
 const expected=identity(c),summary=verifyPublicWebQualification(receipt,{...expected,now});
 return {receipt,identity:expected,summary};
}
