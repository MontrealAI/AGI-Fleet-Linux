#!/usr/bin/env node
/** Deterministic source spelling normalization for the release's strict hashbang byte policy.
 * Run with Node 24 --expose-internals to use its bundled Acorn parser without a new dependency.
 * Only decoded-value-equivalent literals are changed; invalid syntax and unknown contexts fail closed.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
const marker = '#' + '!';
const escapedMarker = '\\x23!';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function parser() {
  if (!/^v24\./.test(process.version)) throw Error('Normalization requires Node 24');
  try { return require('internal/deps/acorn/acorn/dist/acorn'); }
  catch { throw Error('Run Node 24 with --expose-internals to use its bundled Acorn parser'); }
}

function parse(source) {
  const acorn = parser();
  try { return acorn.parse(source, {ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true}); }
  catch (moduleError) {
    try { return acorn.parse(source, {ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true}); }
    catch { throw moduleError; }
  }
}

function visit(node, ancestors, callback) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') callback(node, ancestors);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'value' && node.type === 'Literal') continue;
    if (Array.isArray(value)) for (const child of value) visit(child, [...ancestors, node], callback);
    else if (value && typeof value === 'object') visit(value, [...ancestors, node], callback);
  }
}

function canonicalRegex(pattern) {
  if (pattern.startsWith('^' + escapedMarker)) return '^' + marker + pattern.slice(1 + escapedMarker.length);
  return pattern;
}

function semanticAst(value, key = '') {
  if (Array.isArray(value)) return value.map(item => semanticAst(item));
  if (value instanceof RegExp) return {source: canonicalRegex(value.source), flags: value.flags};
  if (value && typeof value === 'object') {
    const out = {};
    for (const name of Object.keys(value).sort()) {
      if (['start', 'end', 'raw', 'loc', 'range'].includes(name)) continue;
      out[name] = key === 'regex' && name === 'pattern' ? canonicalRegex(value[name]) : semanticAst(value[name], name);
    }
    return out;
  }
  return value;
}

export function normalizeSource(source, name = '<input>') {
  const positions = [];
  for (let position = source.indexOf(marker, 1); position !== -1; position = source.indexOf(marker, position + 2)) positions.push(position);
  if (positions.length === 0) return {source, edits: [], semanticAstSHA256: null};
  const ast = parse(source);
  const contexts = [];
  visit(ast, [], (node, ancestors) => {
    if (node.type === 'Literal' && typeof node.value === 'string') contexts.push({node, kind: 'string', value: node.value});
    if (node.type === 'TemplateElement') {
      const template = ancestors.at(-1);
      const owner = ancestors.at(-2);
      if (template?.type === 'TemplateLiteral' && owner?.type !== 'TaggedTemplateExpression' && node.value.cooked !== null)
        contexts.push({node, kind: 'untagged-template', value: node.value.cooked});
    }
    if (node.type === 'Literal' && node.regex) {
      const member = ancestors.at(-1), call = ancestors.at(-2);
      const directTest = member?.type === 'MemberExpression' && member.object === node && !member.computed && member.property.name === 'test' &&
        call?.type === 'CallExpression' && call.callee === member;
      if (directTest && node.regex.pattern.startsWith('^' + marker) && node.regex.pattern.indexOf(marker, 2) < 0)
        contexts.push({node, kind: 'regex-direct-test', value: {pattern: canonicalRegex(node.regex.pattern), flags: node.regex.flags}});
    }
  });
  const edits = positions.map(position => {
    const context = contexts.find(({node}) => position >= node.start && position + 2 <= node.end);
    if (!context) throw Error(`${name}: unsupported hashbang byte occurrence at byte ${Buffer.byteLength(source.slice(0, position))}; comments, tagged templates and observable regex objects require explicit source repair`);
    const {node, kind, value} = context;
    if (kind === 'regex-direct-test' && position !== node.start + 2) throw Error(`${name}: unsupported regex occurrence`);
    let backslashes = 0;
    for (let i = position - 1; i >= node.start && source[i] === '\\'; i--) backslashes++;
    if (backslashes % 2 !== 0) throw Error(`${name}: escaped hash character requires explicit source repair`);
    return {position, byteOffset: Buffer.byteLength(source.slice(0, position)), kind,
      decodedValueSHA256: sha(JSON.stringify(value)), decodedValueUnchanged: true};
  });
  let changed = source;
  for (const edit of [...edits].reverse()) changed = changed.slice(0, edit.position) + escapedMarker + changed.slice(edit.position + 2);
  const before = JSON.stringify(semanticAst(ast));
  const after = JSON.stringify(semanticAst(parse(changed)));
  if (before !== after) throw Error(`${name}: decoded AST equivalence check failed; file was not changed`);
  if (changed.indexOf(marker, 1) !== -1) throw Error(`${name}: unexpected remaining hashbang bytes`);
  return {source: changed, edits, semanticAstSHA256: sha(before)};
}

function treeFiles(root) {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error('Release normalization forbids symbolic links: ' + file);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && /\.(mjs|cjs|js)$/i.test(entry.name)) files.push(file);
    }
  }
  walk(root);
  return files.sort();
}

export function normalizeTree(root, {write = false, check = false} = {}) {
  root = fs.realpathSync(root);
  const files = treeFiles(root), pending = [];
  if (!files.length) throw Error('No JS-family files found');
  for (const file of files) {
    const before = fs.readFileSync(file);
    if (before.indexOf(Buffer.from(marker), 1) < 0) continue;
    const source = before.toString('utf8');
    if (!Buffer.from(source).equals(before)) throw Error('Non-UTF-8 source cannot be safely normalized: ' + file);
    const result = normalizeSource(source, path.relative(root, file));
    pending.push({file, before, after: Buffer.from(result.source), result});
  }
  // Do not partially mutate a tree if any file fails parsing or semantic equivalence.
  for (const item of pending) if (!fs.readFileSync(item.file).equals(item.before)) throw Error('Input changed during normalization: ' + item.file);
  if (write) for (const item of pending) fs.writeFileSync(item.file, item.after);
  return {schema: 'agi-release-literal-normalization/v1', root, runtime: process.version,
    parser: 'Node 24 bundled Acorn ' + parser().version,
    mode: write ? 'write' : check ? 'check' : 'dry-run',
    status: check && pending.length ? 'FAIL' : 'PASS',
    policy: 'Only decoded-value-equivalent string and untagged-template escaping, plus direct regex .test calls with equivalent anchored hashbang character matching; comments and all other contexts fail closed.',
    dependencySourceBytesChanged: pending.some(item => item.file.split(path.sep).includes('node_modules')),
    decodedLiteralValuesUnchanged: true,
    regexSourceSpelling: 'Regex source spelling may change only for ephemeral regex literals consumed directly by .test; pattern matching is unchanged.',
    filesScanned: files.length, filesChanged: write ? pending.length : 0, filesRequiringChanges: pending.length,
    changes: pending.map(({file, before, after, result}) => ({path: path.relative(root, file).split(path.sep).join('/'),
      beforeSHA256: sha(before), afterSHA256: sha(after), semanticAstSHA256: result.semanticAstSHA256, edits: result.edits.map(({position, ...edit}) => edit)}))};
}

function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    if (['--root', '--output'].includes(args[i])) options[args[i].slice(2)] = args[++i];
    else if (['--write', '--check'].includes(args[i])) options[args[i].slice(2)] = true;
    else throw Error('Unknown argument: ' + args[i]);
  }
  if (!options.root || !options.output || options.write && options.check) throw Error('Usage: node --expose-internals scripts/normalize-js-literals.mjs --root ROOT --output REPORT.json [--write | --check]');
  let report;
  try { report = normalizeTree(options.root, options); }
  catch (error) { report = {schema: 'agi-release-literal-normalization/v1', status: 'FAIL', error: error.message}; }
  fs.mkdirSync(path.dirname(path.resolve(options.output)), {recursive: true});
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report).filter(([key]) => ['status', 'mode', 'filesScanned', 'filesChanged', 'filesRequiringChanges', 'error'].includes(key)))));
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
