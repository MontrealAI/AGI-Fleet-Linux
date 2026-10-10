import {COMPUTE_ROLES} from './roles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {STAGES} from './setup-ledger.mjs';
import {safeSetupFailure} from './setup-auth.mjs';
import {safeReadinessDiagnostics} from './setup-readiness.mjs';
import {safeServiceStopDiagnostics} from './service-stop.mjs';
import {isCandidateStatePreparationReceipt} from './setup-state-preparation.mjs';
import {safeComponentEvidenceSummary} from './setup-component-evidence.mjs';
import {safeRuntimeIdentityDiagnostic} from './setup-runtime-identity.mjs';

const ensure = (ok, code) => { if (!ok) throw Error(code); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value : null;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
const code = value => typeof value === 'string' && value ? safeSetupFailure({message: value}) : null;
const states = new Set(['none','preparing','prepared','approved','publishing','published','sealed','complete','rolled-back','safe-stop-required']);
export function safeFailureFields(report = {}) {
  return {failureCode: code(report.failureCode), primaryFailureCode: code(report.primaryFailureCode), rollbackFailureCode: code(report.rollbackFailureCode), primaryRuntimeIdentityDiagnostic:safeRuntimeIdentityDiagnostic(report.primaryRuntimeIdentityDiagnostic), rollbackRuntimeIdentityDiagnostic:safeRuntimeIdentityDiagnostic(report.rollbackRuntimeIdentityDiagnostic), recovery: {
    profile: ['RESTORED','SAFE_STOP_REQUIRED','NOT_REQUIRED'].includes(report.recovery?.profile) ? report.recovery.profile : 'UNKNOWN',
    serviceFiles: ['RESTORED','RESTORE_REQUIRED','NOT_REQUIRED'].includes(report.recovery?.serviceFiles) ? report.recovery.serviceFiles : 'UNKNOWN',
  }};
}
export function safeSavedSetupReport(report) {
  if (!report || report.schema !== 'agi-setup-support/v2') return null;
  return {schema: report.schema, source: 'Saved setup attempt; historical evidence, not current service readiness', runID: uuid(report.runID), startedAt: timestamp(report.startedAt), finishedAt: timestamp(report.finishedAt), passed: report.passed === true,
    ...safeFailureFields(report), ...(typeof report.failureRecordingFailed==='boolean'?{failureRecordingFailed:report.failureRecordingFailed}:{}), ...(typeof report.diagnosticsSaved==='boolean'?{diagnosticsSaved:report.diagnosticsSaved}:{}), stages: Object.fromEntries(STAGES.map(stage => [stage, ['not-attempted','running','passed','failed'].includes(report.stages?.[stage]) ? report.stages[stage] : 'not-attempted'])),
    stageSeconds: Object.fromEntries(STAGES.filter(stage => Number.isFinite(report.stageSeconds?.[stage]) && report.stageSeconds[stage] >= 0 && report.stageSeconds[stage] <= 86400).map(stage => [stage, report.stageSeconds[stage]])),
    transaction: report.transaction ? {id: uuid(report.transaction.id), state: states.has(report.transaction.state) ? report.transaction.state : 'unknown'} : null,
    securityReviewDigest: /^[a-f0-9]{64}$/.test(report.securityReviewDigest ?? '') ? report.securityReviewDigest : null,
    serviceShutdown: Array.isArray(report.serviceShutdown)?report.serviceShutdown.slice(-8).map(safeServiceStopDiagnostics).filter(Boolean):[],
    ...(safeComponentEvidenceSummary(report.componentEvidence)?{componentEvidence:safeComponentEvidenceSummary(report.componentEvidence)}:{}),
    statePreparation: isCandidateStatePreparationReceipt(report.statePreparation) ? structuredClone(report.statePreparation) : null,
    serviceReadiness: report.serviceReadiness ? safeReadinessDiagnostics(report.serviceReadiness) : null,
    walletAccessed: report.walletAccessed === false ? false : null, paidProviderCall: report.paidProviderCall === false ? false : null};
}
export function readSavedSetupReport({home, role, uid = process.getuid?.(), maxBytes = 16 * 1024 * 1024}) {
  ensure(COMPUTE_ROLES.includes(role), 'SAVED_SETUP_REPORT_UNSAFE');
  const directory = path.join(path.resolve(home), '.agi-genesis-setup-' + role), file = path.join(directory, 'setup-diagnostics.json');
  try {
    for (const item of [path.resolve(home), directory]) {
      const stat = fs.lstatSync(item);
      ensure(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === uid && !(stat.mode & 0o022), 'SAVED_SETUP_REPORT_UNSAFE');
    }
    const before = fs.lstatSync(file);
    ensure(before.isFile() && !before.isSymbolicLink() && before.uid === uid && before.nlink === 1 && !(before.mode & 0o077) && before.size <= maxBytes, 'SAVED_SETUP_REPORT_UNSAFE');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      ensure(stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'SAVED_SETUP_REPORT_CHANGED');
      const bytes = Buffer.alloc(stat.size + 1), length = fs.readSync(fd, bytes, 0, bytes.length, 0), after = fs.fstatSync(fd);
      ensure(length === stat.size && after.size === stat.size && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs, 'SAVED_SETUP_REPORT_CHANGED');
      const report = safeSavedSetupReport(JSON.parse(bytes.subarray(0, length).toString('utf8')));
      ensure(report, 'SAVED_SETUP_REPORT_SCHEMA_UNSUPPORTED');
      return report;
    } finally { fs.closeSync(fd); }
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw Error(['SAVED_SETUP_REPORT_UNSAFE','SAVED_SETUP_REPORT_CHANGED','SAVED_SETUP_REPORT_SCHEMA_UNSUPPORTED'].includes(error.message) ? error.message : 'SAVED_SETUP_REPORT_UNREADABLE');
  }
}
