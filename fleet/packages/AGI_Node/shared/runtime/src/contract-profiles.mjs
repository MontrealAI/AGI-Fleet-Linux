// Reviewed, finite contract graphs. Config selects an ID, never a path or hash.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getAddress, ZeroAddress } from 'ethers';

export const LEGACY_CONTRACT_PROFILE = 'manager-legacy-db876a8';
export const MANAGER_117_CONTRACT_PROFILE = 'manager-1.17.0-b7218196';
export const RUNTIME_CONTRACTS = Object.freeze([
  'AGIJobManager', 'UriUtils', 'TransferUtils', 'BondMath', 'ReputationMath',
  'ENSOwnership', 'NftEligibility', 'JobSettlement', 'JobValidation',
]);
export const CONTRACT_ARTIFACTS = Object.freeze([...RUNTIME_CONTRACTS, 'MockERC20', 'FailingERC20']);
const definitions = Object.freeze({
  [LEGACY_CONTRACT_PROFILE]: Object.freeze({
    sourceTag: 'v1.1.0', sourceCommit: 'db876a8021da6afcf7aa974489d13374e6d188b5',
    manifestSHA256: '8553cd0dc05dbf037c30ad3326561cb899ff42c5664fcb86a9f8a9d1c347a0ac',
  }),
  [MANAGER_117_CONTRACT_PROFILE]: Object.freeze({
    sourceTag: 'v1.17.0', sourceCommit: 'b721819639668f0074c244d516bbbe0cf57329a7',
    manifestSHA256: 'a16ca49d23b91387c727277f0cabbcfec9860734cdba47f0ccecc93e5c443df7',
  }),
});
const root = fileURLToPath(new URL('../contract-profiles/', import.meta.url));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
export class ContractProfileError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function ensure(condition, code) {
  if (!condition) throw new ContractProfileError(code);
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const member of Object.values(value)) freeze(member);
    Object.freeze(value);
  }
  return value;
}
function verifiedFile(base, relative, expected) {
  ensure(typeof relative === 'string' && relative.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'), 'CONTRACT_PROFILE_PATH');
  let current = path.resolve(base);
  // Reject a symlink at any ancestor, including an intact bundle reached
  // through a replaced parent directory. Hash equality is not path authority.
  for (let parent = current; ; parent = path.dirname(parent)) {
    const info = fs.lstatSync(parent);
    ensure(info.isDirectory() && !info.isSymbolicLink(), 'CONTRACT_PROFILE_PATH');
    if (parent === path.dirname(parent)) break;
  }
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    ensure(!fs.lstatSync(current).isSymbolicLink(), 'CONTRACT_PROFILE_PATH');
  }
  ensure(fs.lstatSync(current).isFile(), 'CONTRACT_PROFILE_PATH');
  const bytes = fs.readFileSync(current);
  ensure(sha(bytes) === expected, 'CONTRACT_PROFILE_INTEGRITY');
  return bytes;
}
export function contractProfileID(config = {}) {
  if (!Object.hasOwn(config, 'contractProfile')) return LEGACY_CONTRACT_PROFILE;
  ensure(typeof config.contractProfile === 'string' && Object.hasOwn(definitions, config.contractProfile), 'CONFIG_CONTRACT_PROFILE');
  return config.contractProfile;
}
export function loadContractProfile(packageRoot, id = LEGACY_CONTRACT_PROFILE) {
  // Validate before joining any path. Neither environment variables nor config
  // can supply a location, digest, artifact, ABI, or per-library override.
  contractProfileID({ contractProfile: id });
  const definition = definitions[id];
  const manifest = JSON.parse(verifiedFile(root, id + '.json', definition.manifestSHA256));
  ensure(manifest.schema === 'agi-fleet-contract-profile/v1' && manifest.profile === id && manifest.sourceCommit === definition.sourceCommit && manifest.compiler === '0.8.37', 'CONTRACT_PROFILE_PROVENANCE');
  const base = id === LEGACY_CONTRACT_PROFILE ? path.join(packageRoot, 'contract') : path.join(root, id);
  const files = Object.fromEntries(Object.entries(manifest.files).map(([name, digest]) => [name, verifiedFile(base, name, digest)]));
  const provenance = JSON.parse(files['artifact-provenance.json']);
  ensure(provenance.sourceCommit === definition.sourceCommit && provenance.compiler === manifest.compiler && Object.keys(provenance.artifacts).sort().join() === [...CONTRACT_ARTIFACTS].sort().join(), 'CONTRACT_PROFILE_PROVENANCE');
  const artifacts = {};
  for (const name of CONTRACT_ARTIFACTS) {
    const row = provenance.artifacts[name], bytes = files['artifacts/' + name + '.json'];
    ensure(bytes && sha(bytes) === row.artifactSHA256 && files['compiler-inputs/' + row.buildInfoId + '.json'], 'CONTRACT_PROFILE_PROVENANCE');
    artifacts[name] = JSON.parse(bytes);
  }
  return freeze({ id, ...definition, base, manifest, provenance, artifacts });
}
export function profilePinFields(config, profile) {
  ensure(contractProfileID(config) === profile.id, 'CONTRACT_PROFILE_CHANGED');
  // Omission preserves historical pin bytes and authorization/preparation hashes.
  return Object.hasOwn(config, 'contractProfile') ? {
    contractProfile: profile.id, contractProfileSHA256: profile.manifestSHA256,
  } : {};
}
export function assertProfilePin(config, pin, profile) {
  const fields = profilePinFields(config, profile);
  ensure(pin && typeof pin === 'object', 'DEPLOYMENT_PIN_MISMATCH');
  ensure(Object.hasOwn(pin, 'contractProfile') === Object.hasOwn(fields, 'contractProfile') &&
    Object.hasOwn(pin, 'contractProfileSHA256') === Object.hasOwn(fields, 'contractProfileSHA256') &&
    pin.contractProfile === fields.contractProfile && pin.contractProfileSHA256 === fields.contractProfileSHA256 &&
    pin.sourceTag === profile.sourceTag && pin.sourceCommit === profile.sourceCommit,
  'DEPLOYMENT_CONTRACT_PROFILE_MISMATCH');
  ensure(pin.contracts && Object.keys(pin.contracts).sort().join() === [...RUNTIME_CONTRACTS].sort().join(), 'INCOMPLETE_LIBRARY_GRAPH');
}
export function matchProfileRuntime(profile, name, address, code, token, known = {}) {
  ensure(RUNTIME_CONTRACTS.includes(name), 'UNRECOGNIZED_LIBRARY');
  const a = profile.artifacts[name];
  ensure(typeof code === 'string' && /^0x[0-9a-fA-F]*$/.test(code) && code.length === a.deployedBytecode.length, 'RUNTIME_LENGTH_MISMATCH');
  let expected = a.deployedBytecode;
  const patch = (start, length, value) => {
    ensure(value.length === length * 2, 'RUNTIME_PATCH');
    expected = expected.slice(0, 2 + start * 2) + value + expected.slice(2 + (start + length) * 2);
  };
  for (const byName of Object.values(a.deployedLinkReferences))
    for (const [lib, refs] of Object.entries(byName)) {
      ensure(RUNTIME_CONTRACTS.includes(lib), 'UNRECOGNIZED_LIBRARY');
      for (const ref of refs) {
        const target = getAddress('0x' + code.slice(2 + ref.start * 2, 2 + (ref.start + ref.length) * 2));
        ensure(target !== ZeroAddress && (!known[lib] || known[lib] === target), 'LIBRARY_ADDRESS_MISMATCH');
        known[lib] = target;
        patch(ref.start, ref.length, target.slice(2).toLowerCase());
      }
    }
  for (const refs of Object.values(a.immutableReferences))
    for (const ref of refs)
      patch(ref.start, ref.length, (name === 'AGIJobManager' ? token : address).slice(2).toLowerCase().padStart(ref.length * 2, '0'));
  ensure(expected.toLowerCase() === code.toLowerCase(), 'RUNTIME_BYTECODE_MISMATCH');
  return known;
}
export function assertPinnedGraph(profile, pin, codes) {
  const known = {};
  for (const name of RUNTIME_CONTRACTS)
    matchProfileRuntime(profile, name, pin.contracts[name].address, codes[name], pin.token, known);
  ensure(pin.contracts.AGIJobManager.address === pin.manager, 'LIBRARY_ADDRESS_MISMATCH');
  ensure(Object.keys(known).length === RUNTIME_CONTRACTS.length - 1, 'INCOMPLETE_LIBRARY_GRAPH');
  for (const [name, address] of Object.entries(known))
    ensure(pin.contracts[name]?.address === address, 'LIBRARY_ADDRESS_MISMATCH');
}
