// Reuse the existing private, synchronous transactional Fleet ledger.
import {Store} from '../supervisor/store.mjs';
import {canonical, need} from '../primitives.mjs';
import {inspectTIProject, TI_PROJECT_SCHEMA} from './project.mjs';

export class TIProjectStore {
  constructor(directory,receivers,{create=false}={}) {
    this.store = new Store(directory,{create}); this.receivers = receivers;
  }
  async get(id) {
    const row = this.store.db.prepare('SELECT value FROM projects WHERE id=?').get(id);
    if (!row) return null;
    await inspectTIProject(row.value,this.receivers); return row.value;
  }
  async save(raw,expected=null) {
    const checked = await inspectTIProject(raw,this.receivers), id=checked.project.projectId;
    return this.store.transaction(()=>{
      const prior = this.store.db.prepare('SELECT value FROM projects WHERE id=?').get(id)?.value ?? null;
      if(prior===raw)return raw;
      need(prior===expected,'TI_PROJECT_REVISION_CONFLICT');
      if (prior!==null) {
        const old=JSON.parse(prior), next=checked.project;
        need(old.schema===TI_PROJECT_SCHEMA && next.history.length>old.history.length
          && canonical(next.history.slice(0,old.history.length))===canonical(old.history),'TI_PROJECT_HISTORY_REWRITTEN');
      }
      const rows=this.store.db.prepare('SELECT id,value FROM projects').all();
      need(rows.filter(row=>row.id!==id).length<12,'TI_PROJECT_STORAGE_LIMIT');
      const bytes=rows.filter(row=>row.id!==id).reduce((sum,row)=>sum+Buffer.byteLength(row.value),0)+Buffer.byteLength(raw);
      need(bytes<=32_000_000,'TI_PROJECT_STORAGE_CAPACITY');
      this.store.db.prepare('INSERT INTO projects(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id,raw);
      this.store.event('ti-project-retained-inert',{projectId:id,revision:checked.project.revision,authority:'none'});
      return raw;
    });
  }
  async import(raw) {
    const checked=await inspectTIProject(raw,this.receivers), prior=await this.get(checked.project.projectId);
    if(prior===raw)return raw;
    return this.save(raw,prior);
  }
  close(){this.store.close();}
}
