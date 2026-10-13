import {makeRevision, validateStudioRevision, STUDIO_LIMITS} from '../studio.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {ensure, strictKeys, privateDir, atomicWrite, canonical, sha256} from '../util.mjs';
import {STUDIO_TEMPLATES, composeStudio, studioSpec, deliveryInfo, makeHandoff, validateHandoff, studioDownload} from '../studio.mjs';
import {isComputerSpec, computerVerdict} from '../artifacts.mjs';
import {visionVerdict} from '../images.mjs';
import {normalizeWork} from '../work.mjs';
import {DECLARATION} from '../review.mjs';
import {publicError} from './messages.mjs';

const MAX_RECORDS = 5, MAX_RECORD_BYTES = STUDIO_LIMITS.recordBytes;
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const activeStates = ['running','cancelling'];

// Work Studio never imports a chain, signer, journal, publisher or wallet API.
// Only the controller supplies access to its bounded companion connection.
export class Studio {
  constructor(controller, role, version) {
    this.c = controller; this.role = role; this.version = version;
    this.dir = path.join(controller.home,'work-studio');
    this.records = []; this.active = null; this.task = null; this.abort = null;
    this.historyError = null;
    try {
    ensure(!fs.existsSync(this.dir) || !fs.lstatSync(this.dir).isSymbolicLink(), 'STUDIO_HISTORY_DAMAGED');
    privateDir(this.dir);
    for (const name of fs.readdirSync(this.dir).filter(n => n.endsWith('.json'))) {
      ensure(this.records.length < MAX_RECORDS && idPattern.test(name.slice(0,-5)), 'STUDIO_HISTORY_DAMAGED');
      const file = path.join(this.dir,name), fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let record;
      try {
        const stat = fs.fstatSync(fd);
        ensure(stat.isFile() && stat.nlink === 1 && stat.size <= MAX_RECORD_BYTES, 'STUDIO_HISTORY_DAMAGED');
        record = JSON.parse(fs.readFileSync(fd,'utf8'));
      } finally {fs.closeSync(fd);}
      ensure(record?.schema === 'agi-studio-run/v1' && record.id + '.json' === name && record.role === role, 'STUDIO_HISTORY_DAMAGED');
      studioSpec(record.specification);
      if(record.revision) {const rev=validateStudioRevision(record.revision);ensure(sha256(canonical(rev.handoff.specification))===sha256(canonical(record.specification)),'STUDIO_HISTORY_DAMAGED');}
      if (record.delivery !== null) {
        const info = deliveryInfo(record.specification,record.delivery);
        ensure(info.deliveryHash === record.deliveryHash && record.specHash === sha256(canonical(record.specification)), 'STUDIO_HISTORY_DAMAGED');
      }
      if (activeStates.includes(record.status)) {
        record.status = 'interrupted'; record.phase = 'interrupted'; record.finishedAt = new Date().toISOString();
        record.error = {code:'STUDIO_INTERRUPTED',title:'The application stopped before this task finished.',action:'Inspect the saved files and compute-service status. Starting another task spends a new allowance; interrupted work is never replayed automatically.'};
        this.save(record);
      }
      this.records.push(record);
    }
    this.records.sort((a,b) => Date.parse(a.startedAt)-Date.parse(b.startedAt));
    } catch {
      // An optional work notebook must not prevent wallet recovery or settlement.
      // Preserve the original files and stop only new Studio actions.
      this.records = []; this.historyError = publicError({code:'STUDIO_HISTORY_DAMAGED'});
    }
  }
  get busy() {return this.active !== null;}
  scope() {
    return {role:this.role, version:this.version, runtime:process.version, platform:process.platform, arch:process.arch,
      companion:structuredClone(this.c.companion.config), computePolicy:this.c.companion.state.computePolicy ?? null};
  }
  scopeHash() {return sha256(canonical(this.scope()));}
  save(record) {
    const bytes = JSON.stringify(record);
    ensure(Buffer.byteLength(bytes) <= MAX_RECORD_BYTES, 'STUDIO_DELIVERY_TOO_LARGE');
    atomicWrite(path.join(this.dir,record.id+'.json'),bytes+'\n');
  }
  summary(record) {
    const {delivery, specification, revision, ...summary} = record;
    return {...summary, isRevision:Boolean(revision), revisionSource:revision ? {specHash:revision.handoff.specHash,deliveryHash:revision.handoff.deliveryHash,review:revision.review} : null, title:specification.title, profile:specification.profile, criteria:specification.criteria,
      hasFiles:delivery !== null, currentScope:record.scopeHash === this.scopeHash()};
  }
  status() {
    const c = this.c, connection = c.companion.status();
    const blockers = [];
    if (this.historyError) blockers.push('The Studio history needs recovery. Wallet recovery and the transaction journal remain available.');
    if (!c.vault.unlocked) blockers.push('Unlock the application.');
    if (c.worker || c.desired) blockers.push('Stop the job worker before using the Studio.');
    if (c.status().pending) blockers.push('Reconcile the pending signed transaction first.');
    if (!c.companion.config.enabled || c.companion.config.mode !== 'workstation') blockers.push('Set up and enable the separate computer-work connection.');
    if (!connection.connected || !/^[a-f0-9]{64}$/.test(c.companion.state.computePolicy ?? '')) blockers.push('Test the OpenClaw connection after reviewing its configuration.');
    if (this.records.length >= MAX_RECORDS) blockers.push('Download and remove a saved Studio run to make room.');
    return {role:this.role, version:this.version, active:this.active, busy:this.busy, ready:blockers.length === 0 && !this.busy, blockers, historyError:this.historyError,
      maxRecords:MAX_RECORDS, templates:STUDIO_TEMPLATES,
      runs:c.vault.unlocked ? this.records.map(r => this.summary(r)).reverse() : [],
      connection:{mode:c.companion.config.mode, calls24h:connection.calls24h, remaining24h:Math.max(0,c.companion.config.maxCalls24h - connection.calls24h)},
      limits:{files:STUDIO_LIMITS.legacyFiles, outputBytes:STUDIO_LIMITS.legacyOutputBytes, workflowSeconds:600, imports:{profile:'computer-work/v2',files:STUDIO_LIMITS.generalFiles,fileBytes:STUDIO_LIMITS.generalFileBytes,outputBytes:STUDIO_LIMITS.generalOutputBytes,criteria:64}, recordBytes:MAX_RECORD_BYTES},
      note:'A completed Studio run is a local capability exercise, not a blockchain job, independent validation or production qualification.'};
  }
  record(id) {
    ensure(!this.historyError,'STUDIO_HISTORY_DAMAGED');
    ensure(this.c.vault.unlocked, 'NODE_LOCKED');
    ensure(typeof id === 'string' && idPattern.test(id), 'STUDIO_RUN_UNKNOWN');
    const r = this.records.find(r => r.id === id); ensure(r,'STUDIO_RUN_UNKNOWN'); return r;
  }
  start(input) {
    ensure(!this.historyError,'STUDIO_HISTORY_DAMAGED');
    this.c.requireStopped(); ensure(!this.busy, 'STUDIO_BUSY'); ensure(this.c.vault.unlocked,'NODE_LOCKED');
    ensure(!this.c.status().pending,'PENDING_TRANSACTION_MUST_BE_RECONCILED_FIRST');
    const companion = this.c.companion;
    ensure(companion.config.enabled && companion.config.mode === 'workstation','COMPANION_WORKSTATION_REQUIRED');
    ensure(companion.status().connected && /^[a-f0-9]{64}$/.test(companion.state.computePolicy ?? ''),'COMPANION_TEST_REQUIRED');
    ensure(!companion.pending,'COMPANION_BUSY'); ensure(this.records.length < MAX_RECORDS,'STUDIO_HISTORY_FULL');
    const now = companion.now(), calls = companion.state.calls.filter(t => t > now - 86400000).length;
    ensure(companion.config.maxCalls24h - calls >= (this.role === 'agent' ? 2 : 1),'COMPANION_DAILY_LIMIT');
    let specification, delivery = null, revision = null;
    if (this.role === 'agent') {
      strictKeys(input,['brief','specification','revision'],'STUDIO_BRIEF_INVALID');
      ensure([input.brief,input.specification,input.revision].filter(Boolean).length === 1,'STUDIO_BRIEF_INVALID');
      if(input.revision) {revision=validateStudioRevision(input.revision);specification=revision.handoff.specification;}
      else specification = input.brief ? composeStudio(input.brief) : studioSpec(input.specification);
    } else {
      strictKeys(input,['handoff'],'STUDIO_HANDOFF_INVALID');
      const h = validateHandoff(input.handoff); specification = h.specification; delivery = h.delivery;
    }
    const r = {schema:'agi-studio-run/v1',id:crypto.randomUUID(),role:this.role,version:this.version,status:'running',phase:'starting',
      startedAt:new Date().toISOString(),finishedAt:null,scope:this.scope(),scopeHash:this.scopeHash(),
      revision,specification,specHash:sha256(canonical(specification)),delivery,deliveryHash:delivery === null ? null : deliveryInfo(specification,delivery).deliveryHash,
      files:delivery === null ? [] : deliveryInfo(specification,delivery).files,review:null,error:null,requests:0,
      evidenceType:'local-controller-record',independent:false};
    this.save(r); this.records.push(r); this.active = r.id; this.abort = new AbortController();
    this.task = this.run(r,this.abort.signal).finally(() => {this.active = null; this.abort = null; this.task = null;});
    // Prevent an unhandled rejection if durable storage fails during error handling.
    this.task.catch(() => {});
    return this.summary(r);
  }
  async request(r, signal, phase, kind, input) {
    ensure(!signal.aborted,'STUDIO_CANCELLED');
    ensure(r.scopeHash === this.scopeHash(),'STUDIO_SCOPE_CHANGED');
    const wait = this.c.companion.state.nextAt - this.c.companion.now();
    if (wait > 0) {
      ensure(wait <= 60000,'COMPANION_COOLDOWN');
      r.phase = 'waiting'; this.save(r);
      await delay(wait,undefined,{signal});
    }
    ensure(!signal.aborted,'STUDIO_CANCELLED');
    ensure(r.scopeHash === this.scopeHash(),'STUDIO_SCOPE_CHANGED');
    r.phase = phase; r.requests++; this.save(r);
    return this.c.companion.request(kind,input,{cacheMs:0});
  }
  async run(r,signal) {
    try {
      const spec = r.specification;
      if (this.role === 'agent') {
        const work = normalizeWork(spec,DECLARATION);
        const result = await this.request(r,signal,'creating','generate',{specification:work,attempt:revisionAttempt(r),...(r.revision?{revision:{delivery:r.revision.handoff.delivery,review:r.revision.review}}:{})});
        ensure(!signal.aborted,'STUDIO_CANCELLED');
        if (result.status !== 'complete') {r.status = 'declined'; r.phase = 'declined'; return;}
        const info = deliveryInfo(spec,result.content);
        r.delivery = result.content; Object.assign(r,info); r.phase = 'checking-files'; this.save(r);
      }
      let review;
      if (isComputerSpec(spec)) {
        const {at,cached,...answer} = await this.request(r,signal,'reviewing','computer-review',{specification:spec,delivery:r.delivery});
        review = {...computerVerdict(spec,answer),safeToReview:answer.safeToReview};
      } else if (this.role === 'node') {
        const {at,cached,...answer} = await this.request(r,signal,'reviewing','vision',{specification:spec,image:r.delivery});
        review = visionVerdict(spec,answer);
      } else {
        const answer = await this.request(r,signal,'reviewing','quality',{specification:normalizeWork(spec,DECLARATION),delivery:r.delivery});
        review = {verdict:answer.verdict === 'pass' ? 'consistent' : 'uncertain',checks:[],note:'Image self-check returned '+answer.verdict+'. This is not an independent review.'};
      }
      ensure(!signal.aborted,'STUDIO_CANCELLED'); ensure(r.scopeHash === this.scopeHash(),'STUDIO_SCOPE_CHANGED');
      r.review = review; r.status = review.verdict === 'consistent' ? 'checked' : 'needs-review'; r.phase = r.status;
    } catch(e) {
      r.status = signal.aborted ? 'cancelled' : 'failed'; r.phase = r.status;
      r.error = signal.aborted ? {code:'STUDIO_CANCELLED',title:'Task stopped.',action:'Any completed files remain available. Reserved model usage is retained; cancellation is not a refund or proof that a provider stopped immediately.'} : publicError(e);
    } finally {
      r.finishedAt = new Date().toISOString(); this.save(r);
    }
  }
  async cancel() {
    if (!this.busy) return {stopped:true};
    this.abort.abort();
    await this.c.companion.cancel();
    await this.task;
    return {stopped:true};
  }
  export(id,kind) {
    const r = this.record(id);
    if (kind === 'receipt') {
      return {...this.summary(r),specification:r.specification,
        interpretation:'Local controller observations and model-reported checks. This editable record is not an attestation of model identity, independent ownership, tool execution, payment, or production qualification.'};
    }
    if (kind === 'specification') return r.specification;
    if (kind === 'original-files') {ensure(r.revision,'STUDIO_FILES_UNAVAILABLE');return studioDownload(r.revision.handoff);}
    ensure(r.delivery !== null,'STUDIO_FILES_UNAVAILABLE');
    const handoff = makeHandoff(r.specification,r.delivery);
    ensure(handoff.deliveryHash === r.deliveryHash,'STUDIO_HANDOFF_HASH');
    if (kind === 'handoff') return handoff;
    if (kind === 'revision') {ensure(r.review && r.scopeHash === this.scopeHash(),'STUDIO_REVISION_INVALID');return makeRevision(handoff,{safeToReview:r.review.safeToReview,checks:r.review.checks});}
    ensure(kind === 'files','STUDIO_EXPORT_INVALID'); return studioDownload(handoff);
  }
  remove(id) {
    ensure(!this.busy,'STUDIO_BUSY');
    const r = this.record(id);
    fs.unlinkSync(path.join(this.dir,r.id+'.json'));
    this.records = this.records.filter(v => v.id !== id);
    return {removed:true};
  }
}

function revisionAttempt(record) {return record.revision ? 2 : 1;}
