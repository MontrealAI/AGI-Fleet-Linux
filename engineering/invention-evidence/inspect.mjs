// SPDX-License-Identifier: MIT
// Inert evidence admission only. No candidate execution, network, grants or ledger.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parseStrict, canonical, keys} from '../../fleet/successor/vendor/manager/site/assets/successor/safe.mjs';

const MAX_BYTES = 200_000;
const sha = raw => createHash('sha256').update(raw).digest('hex');
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), {code}); };
const equal = (a, b) => canonical(a) === canonical(b);
const reviewed = parseStrict(fs.readFileSync(new URL('./reviewed-ca626861.json', import.meta.url), 'utf8'));
const CONTROL_NAMES = ['native-valid', 'native-invalid', 'permissions-network-exec', 'resource-exhaustion',
  'verifier-tampering', 'excessive-output', 'timeout'];
const RESTRICTIONS = ['freeze_verified', 'source_freeze_verified', 'candidate_write_denied_by_os', 'new_socket_denied_by_os'];

function inspectDynamic(receipt, freeze) {
  need(receipt.schema === 'agialpha/invention-dynamic-qualification/v1'
    && receipt.status === 'DYNAMIC_COMPONENT_PASS' && receipt.confirmation === false
    && receipt.retained_proposal_bound === true, 'DYNAMIC_COMPONENT_NOT_ESTABLISHED');
  for (const [key, value] of Object.entries(reviewed.identities))
    need(receipt[key] === value, 'DYNAMIC_IDENTITY_MISMATCH');
  need(receipt.freeze_file_sha256 === freeze.file && receipt.freeze_sha256 === freeze.semantic,
    'DYNAMIC_FREEZE_MISMATCH');
  const run = receipt.candidate_execution, acceptance = receipt.separate_acceptance;
  need(run?.status === 'EXECUTED_UNVERIFIED' && run.executed === true
    && run.image === receipt.image && run.program_hash === receipt.program_sha256
    && run.records_hash === receipt.cohort_sha256, 'CANDIDATE_EXECUTION_MISMATCH');
  need(equal(run.artifact?.outputs, receipt.expected_outputs)
    && run.artifact.operations === 55 && run.artifact.trace.length === 55
    && receipt.expected_outputs.length === 7, 'CANDIDATE_OUTPUT_MISMATCH');
  need(acceptance?.schema === 'agialpha/critic-acceptance-verification/v1'
    && acceptance.acceptance === 'ACCEPTED' && acceptance.candidate_executed === true
    && acceptance.business_accepted === false && acceptance.confirmation === false
    && acceptance.program_hash === receipt.program_sha256 && acceptance.request_hash === receipt.request_sha256
    && acceptance.execution_hash === sha(canonical(run))
    && RESTRICTIONS.every(key => acceptance[key] === true), 'SEPARATE_ACCEPTANCE_MISMATCH');
  need(RESTRICTIONS.every(key => receipt.frozen_admission?.[key] === true), 'FROZEN_ADMISSION_MISMATCH');
  const negative = receipt.negative_control_execution;
  need(receipt.negative_control_rejected === true && negative?.executed === true
    && negative.status === 'EXECUTED_UNVERIFIED' && negative.image === receipt.image
    && negative.program_hash === receipt.negative_control_program_sha256
    && negative.records_hash === receipt.cohort_sha256
    && !equal(negative.artifact?.outputs, receipt.expected_outputs), 'NEGATIVE_CONTROL_NOT_ESTABLISHED');
}

/** Input is bounded inert UTF-8 JSON. Expected source/run identities are shipped, never input-selected. */
export function inspectEvidence(raw) {
  const bundle = parseStrict(raw, MAX_BYTES);
  keys(bundle, ['schema', 'binding', 'files'], 'BUNDLE_FIELDS');
  need(bundle.schema === 'agi-fleet/invention-evidence-bundle/v1', 'BUNDLE_SCHEMA');
  need(equal(bundle.binding, reviewed.binding), 'SOURCE_RUN_ARTIFACT_MISMATCH');
  keys(bundle.files, Object.keys(reviewed.files), 'EVIDENCE_FILE_SET');
  const parsed = {}, custody = [];
  for (const [name, pin] of Object.entries(reviewed.files)) {
    const content = bundle.files[name];
    need(typeof content === 'string' && Buffer.byteLength(content) === pin.bytes
      && sha(content) === pin.sha256, 'EVIDENCE_BYTES_MISMATCH');
    parsed[name] = parseStrict(content, 300_000);
    custody.push({name, content, sha256:pin.sha256});
  }
  inspectDynamic(parsed['source.json'], reviewed.sourceFreeze);
  inspectDynamic(parsed['installed.json'], reviewed.installedFreeze);
  const layout = parsed['layout.json'];
  need(layout.schema === 'agialpha/installed-invention-layout/v1'
    && layout.generated_program_executed === false
    && layout.source_freeze_sha256 === reviewed.sourceFreeze.file
    && layout.installed_freeze_sha256 === reviewed.installedFreeze.file
    && equal(layout.matched_installed_files, reviewed.installedFiles)
    && Object.keys(layout.matched_installed_files).length === 16, 'INSTALLED_LAYOUT_MISMATCH');
  const controls = parsed['controls.json'];
  need(controls.status === 'PASS' && controls.controls_executed === 7
    && controls.run_url === `https://github.com/${reviewed.binding.repository}/actions/runs/${reviewed.binding.controlsRun}`
    && controls.protocol?.confirmation === false && controls.attempts?.length === 7
    && equal(controls.attempts.map(row => row.name), CONTROL_NAMES)
    && controls.attempts.every(row => row.status === 'PASS' && row.executed === true), 'CONTROL_EXECUTION_INCOMPLETE');
  const report = {
    schema:'agi-fleet/invention-component-evidence/v1', status:'COMPONENT_EVIDENCE_CHECKED',
    binding:bundle.binding, bundleSha256:sha(raw), reviewedManifestSha256:sha(canonical(reviewed)),
    records:7, operations:55, installedFiles:16, controls:CONTROL_NAMES,
    executionPerformed:false, fleetNativeExecutionQualified:false, productionQualified:false,
    confirmation:false, businessAccepted:false, authority:[], settlement:'NOT_RUN',
    scope:'Exact historical Alpha source/installed component evidence checked; not an independent execution, source certification or Fleet runtime qualification.'
  };
  const reportContent = canonical(report);
  custody.push({name:'component-admission.json', content:reportContent, sha256:sha(reportContent)});
  // This is the existing Local Skills task format; creating it does not grant or dispatch work.
  const custodyTask = {schema:'agi-fleet/local-task/v1', action:'evidence-inspect', workspace:'files',
    input:{files:custody}, review:'none', sourceActor:null, sourceController:null};
  return {report, custodyTask};
}

export function main(args = process.argv.slice(2)) {
  need(args.length === 1, 'USAGE_EXPECTED_ONE_BUNDLE');
  const file = path.resolve(args[0]);
  let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    need(!fs.lstatSync(current).isSymbolicLink(), 'INPUT_SYMLINK');
  }
  const stat = fs.statSync(file);
  need(stat.isFile() && stat.size <= MAX_BYTES, 'INPUT_FILE_LIMIT');
  const bytes = fs.readFileSync(file);
  const raw = bytes.toString('utf8');
  need(bytes.length <= MAX_BYTES && Buffer.from(raw).equals(bytes), 'INPUT_UTF8_OR_SIZE');
  process.stdout.write(JSON.stringify(inspectEvidence(raw), null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    process.stderr.write(JSON.stringify({status:'REFUSED', code:error.code || 'INVALID_EVIDENCE',
      executionPerformed:false, authority:[], settlement:'NOT_RUN'}) + '\n');
    process.exitCode = 1;
  }
}
