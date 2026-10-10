#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {inspectPublicWebQualificationPayload, signPublicWebQualification} from '../compute/public-web-qualification.mjs';

const need = (ok, code) => { if (!ok) throw Error(code); };
function privateFile(filename, maximum) {
  const file = path.resolve(filename), fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { const stat = fs.fstatSync(fd); need(stat.isFile() && stat.uid === process.getuid?.() && !(stat.mode & 0o077) && stat.size > 0 && stat.size <= maximum, 'PUBLIC_WEB_REVIEW_FILE_UNSAFE'); return fs.readFileSync(fd, 'utf8'); }
  finally { fs.closeSync(fd); }
}
export async function reviewPublicWebQualificationCLI({argv = process.argv.slice(2), input = process.stdin, output = process.stdout, now = Date.now} = {}) {
  const values = {}, flags = ['--evidence', '--reviewer-key', '--trusted-reviewer-public-key', '--output'];
  need(argv.length === flags.length * 2, 'PUBLIC_WEB_REVIEW_ARGUMENTS');
  for (let i = 0; i < argv.length; i += 2) { need(flags.includes(argv[i]) && !Object.hasOwn(values, argv[i]) && typeof argv[i + 1] === 'string' && argv[i + 1].length > 0, 'PUBLIC_WEB_REVIEW_ARGUMENTS'); values[argv[i]] = argv[i + 1]; }
  const evidence = JSON.parse(privateFile(values['--evidence'], 2 * 1024 * 1024));
  need(evidence && Object.keys(evidence).sort().join('|') === 'payload|schema|verification' && evidence.schema === 'agi-public-web-qualification-export/v1', 'PUBLIC_WEB_REVIEW_EVIDENCE_INVALID');
  const reviewerPublicKey = privateFile(values['--trusted-reviewer-public-key'], 4096), privateKey = privateFile(values['--reviewer-key'], 8192);
  need(evidence.verification?.reviewerPublicKey === reviewerPublicKey, 'PUBLIC_WEB_QUALIFICATION_REVIEWER_CHANGED');
  const actualPublicKey = crypto.createPublicKey(privateKey).export({type: 'spki', format: 'pem'});
  need(actualPublicKey === reviewerPublicKey, 'PUBLIC_WEB_QUALIFICATION_REVIEWER_CHANGED');
  const options = {...evidence.verification, reviewerPublicKey, now: now()}, review = inspectPublicWebQualificationPayload(evidence.payload, options);
  const destination = path.resolve(values['--output']); need(!fs.existsSync(destination), 'PUBLIC_WEB_REVIEW_OUTPUT_EXISTS');
  const directory = fs.lstatSync(path.dirname(destination)); need(directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === process.getuid?.() && !(directory.mode & 0o022), 'PUBLIC_WEB_REVIEW_OUTPUT_UNSAFE');
  output.write(`Technical public-browser review\nScope: ${review.scope}\nEvidence SHA-256: ${review.payloadSha256}\nExecution fingerprint: ${evidence.payload.executionFingerprint}\nCandidate policy: ${evidence.payload.candidatePolicyHash}\nExpires: ${new Date(evidence.payload.expiresAt).toISOString()}\nCorrelated Gateway tool calls: ${review.completedToolCalls}\nUnmeasured: ${review.residuals.map(item => item.id).join(', ')}\nProduction and paid settlements remain unqualified.\nInspect the complete evidence file and verify the reviewer public key against its separately reviewed pin.\n`);
  const terminal = readline.createInterface({input, output}); let approval;
  try { approval = await terminal.question(`Type the complete evidence SHA-256 to sign this exact technical scope: `); }
  finally { terminal.close(); }
  need(approval === review.payloadSha256, 'PUBLIC_WEB_REVIEW_NOT_APPROVED');
  const receipt = signPublicWebQualification(evidence.payload, privateKey, {...options, now: now()});
  const fd = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(receipt, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  output.write(`Signed technical receipt saved: ${destination}\n`); return {output: destination, scope: review.scope, productionQualified: false, paidSettlementQualified: false};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) reviewPublicWebQualificationCLI().catch(error => { process.stderr.write((/^PUBLIC_WEB_[A-Z0-9_]+$/.test(error.message) ? error.message : 'PUBLIC_WEB_REVIEW_FAILED') + '\n'); process.exitCode = 1; });
