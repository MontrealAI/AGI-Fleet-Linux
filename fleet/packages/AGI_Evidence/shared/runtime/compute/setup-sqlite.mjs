import fs from 'node:fs';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const need=(ok,code)=>{if(!ok)throw Error(code);};
const digest=image=>crypto.createHash('sha256').update(image).digest('hex');
const header=Buffer.from('SQLite format 3\0');
function ownedFile(file){
  const s=fs.lstatSync(file);need(!s.isSymbolicLink()&&(!process.getuid||s.uid===process.getuid()),'SETUP_STATE_OWNER_REQUIRED');
  need(s.isFile(),'SETUP_STATE_FILE_UNSUPPORTED');return s;
}
export function isSQLiteFile(file){
  ownedFile(file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const bytes=Buffer.alloc(16);return fs.readSync(fd,bytes,0,16,0)===16&&bytes.equals(header);}finally{fs.closeSync(fd);}
}
function safeSidecars(file){
  for(const suffix of ['-wal','-shm','-journal'])if(fs.lstatSync(file+suffix,{throwIfNoEntry:false}))ownedFile(file+suffix);
}
function safeSQLite(operation){
  try{return operation();}catch(error){if(/^SETUP_/.test(error?.message))throw error;throw Error('SETUP_SQLITE_SNAPSHOT_FAILED');}
}
// sqlite3_serialize reads the database through SQLite's pager, including committed
// WAL pages. The exact same coherent image is hashed and written to the candidate.
// No schema SQL, custom function, virtual-table module, or extension is executed.
export class SQLiteSnapshots{
  constructor(){this.entries=new Map();}
  entry(file){
    const s=ownedFile(file);safeSidecars(file);let entry=this.entries.get(file);
    if(entry){need(entry.dev===s.dev&&entry.ino===s.ino,'SETUP_PROFILE_CHANGED');return entry;}
    let db;
    try{
      db=safeSQLite(()=>new DatabaseSync(file,{readOnly:true}));
      need(typeof db.serialize==='function','SETUP_SQLITE_SNAPSHOT_UNSUPPORTED');
      safeSQLite(()=>db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;'));
      const version=safeSQLite(()=>db.prepare('PRAGMA data_version').get().data_version);
      entry={db,dev:s.dev,ino:s.ino,version,imageHash:null};this.entries.set(file,entry);return entry;
    }catch(error){try{db?.close();}catch{}throw error;}
  }
  capture(file){
    const entry=this.entry(file),db=entry.db;
    const image=safeSQLite(()=>{
      db.exec('BEGIN');
      try{db.prepare('PRAGMA schema_version').get();const bytes=db.serialize();return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
      finally{db.exec('ROLLBACK');}
    });
    need(Buffer.isBuffer(image)&&image.length>=100&&image.subarray(0,16).equals(header),'SETUP_SQLITE_SNAPSHOT_FAILED');
    this.entry(file);if(entry.imageHash===null)entry.imageHash=digest(image);return image;
  }
  initial(file){const entry=this.entry(file),image=this.capture(file);need(digest(image)===entry.imageHash,'SETUP_PROFILE_CHANGED');return image;}
  assertStable(){
    for(const [file,entry] of this.entries){
      this.entry(file);
      // Same-connection data_version also rejects commit-and-revert races. An
      // external checkpoint may conservatively require a stopped retry; our own
      // readonly snapshots do not commit or checkpoint the live database.
      need(safeSQLite(()=>entry.db.prepare('PRAGMA data_version').get().data_version)===entry.version,'SETUP_PROFILE_CHANGED');
    }
  }
  close(){for(const {db} of this.entries.values())try{db.close();}catch{}this.entries.clear();}
}
