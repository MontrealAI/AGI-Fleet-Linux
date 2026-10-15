"""Explicit reviewed contract profiles; the historical comparator stays unchanged."""
import hashlib
import json
from pathlib import Path
from release_tools import require, sha
from next_release_tools import load_module

baseline = load_module('run-job-integration.py')
ARTIFACTS = baseline.ARTIFACTS

CONTRACT_PROFILES = {
    'manager-legacy-db876a8': {
        'commit': 'db876a8021da6afcf7aa974489d13374e6d188b5',
        'manifestSHA256': '8553cd0dc05dbf037c30ad3326561cb899ff42c5664fcb86a9f8a9d1c347a0ac',
    },
    'manager-1.17.0-b7218196': {
        'commit': 'b721819639668f0074c244d516bbbe0cf57329a7',
        'managerTests': 792,
        'manifestSHA256': 'a16ca49d23b91387c727277f0cabbcfec9860734cdba47f0ccecc93e5c443df7',
    },
}


def contract_bundle(fleet, profile=None):
    legacy = fleet / 'packages/AGI_Agent/contract'
    if profile is None:
        return legacy, None
    require(isinstance(profile, str) and profile in CONTRACT_PROFILES, 'Unknown contract profile')
    definition = CONTRACT_PROFILES[profile]
    root = fleet / 'shared/runtime/contract-profiles'
    manifest_file = root / (profile + '.json')
    require(not manifest_file.is_symlink() and sha(manifest_file) == definition['manifestSHA256'],
            'Contract profile manifest integrity differs')
    manifest = json.loads(manifest_file.read_text())
    require(manifest['schema'] == 'agi-fleet-contract-profile/v1' and manifest['profile'] == profile
            and manifest['sourceCommit'] == definition['commit'], 'Contract profile provenance differs')
    bundled = legacy if profile == 'manager-legacy-db876a8' else root / profile
    for name, digest in manifest['files'].items():
        relative = Path(name)
        require(not relative.is_absolute() and '..' not in relative.parts, 'Invalid contract profile member')
        file = bundled / relative
        require(file.is_file() and not any(parent.is_symlink() for parent in [file, *file.parents])
                and sha(file) == digest, 'Contract profile member integrity differs: ' + name)
    return bundled, manifest


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def immutable_locations(references):
    # AST IDs change when unrelated test contracts are added to a compilation.
    # The complete sorted bytecode offsets and lengths must still match exactly.
    return sorted((item['start'], item['length']) for rows in references.values() for item in rows)


def compare_contracts(fleet, manager, profile=None):
    if profile is None:
        return baseline.compare_contracts(fleet, manager)
    bundled, manifest = contract_bundle(fleet, profile)
    provenance = json.loads((bundled / 'artifact-provenance.json').read_text())
    build_id = provenance['artifacts']['AGIJobManager']['buildInfoId']
    original = json.loads((bundled / 'compiler-inputs' / (build_id + '.json')).read_text())
    # Compare every production source, including utilities not individually deployed.
    paths = sorted(manifest['productionSources']) if manifest and 'productionSources' in manifest else sorted(
        name for name in original['sources'] if name.startswith('project/contracts/'))
    require(len(paths) == 11, 'Production Solidity source coverage differs')
    sources = []
    for name in paths:
        relative = name.removeprefix('project/')
        current = (manager / relative).read_bytes()
        expected = original['sources'][name]['content'].encode()
        if manifest and 'productionSources' in manifest:
            require(hashlib.sha256(expected).hexdigest() == manifest['productionSources'][name],
                    'Contract profile source integrity differs: ' + relative)
        require(current == expected, 'Manager production source changed: ' + relative)
        sources.append({'path': relative, 'sha256': hashlib.sha256(current).hexdigest()})
    artifact_results = []
    for name in ARTIFACTS:
        old = json.loads((bundled / 'artifacts' / (name + '.json')).read_text())
        new = json.loads((manager / 'build/contracts' / (name + '.json')).read_text())
        for field in ['abi', 'bytecode', 'deployedBytecode', 'linkReferences', 'deployedLinkReferences']:
            require(old[field] == new[field], f'Compiled {name}.{field} differs')
        require(immutable_locations(old['immutableReferences']) == immutable_locations(new['immutableReferences']),
                'Compiled immutable locations differ: ' + name)
        artifact_results.append({
            'name': name, 'abiSHA256': hashlib.sha256(canonical(new['abi'])).hexdigest(),
            'bytecodeSHA256': hashlib.sha256(new['bytecode'].encode()).hexdigest(),
            'deployedBytecodeSHA256': hashlib.sha256(new['deployedBytecode'].encode()).hexdigest(),
            'immutableOffsetsMatch': True,
        })
    return {'status': 'PASS', 'bundledSourceCommit': provenance['sourceCommit'],
            **({'contractProfile': profile, 'contractProfileSHA256': CONTRACT_PROFILES[profile]['manifestSHA256']} if profile else {}),
            'productionSources': sources, 'artifacts': artifact_results,
            'comparison': 'exact source bytes, ABI, creation/runtime bytecode, links and immutable byte offsets'}

