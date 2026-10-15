#!/usr/bin/env python3
"""Propagate reviewed role contract adapters; never change legacy artifacts."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
root = args.root.resolve()
roles = json.loads((root / 'config/role-registry.json').read_text())['roles']
count = 0
for role, row in roles.items():
    app = root / 'packages' / row['package']
    packages = [(app, 'AGI_Agent' if role == 'agent' else 'AGI_Node', '../shared/runtime')]
    if role not in ('agent', 'node'):
        packages += [(app / 'packages' / name, name, '../../../shared/runtime') for name in ('AGI_Agent', 'AGI_Node')]
    for package, basis, runtime in packages:
        for filename in ('chain.mjs', 'config.mjs'):
            source = root / 'packages' / basis / 'src' / filename
            target = package / 'src' / filename
            if not args.check and target != source:
                target.write_bytes(source.read_bytes())
            assert target.read_bytes() == source.read_bytes(), (target, 'contract-role-divergence')
        adapter = package / 'src/contract-profiles.mjs'
        expected = f"""import * as shared from '{runtime}/src/contract-profiles.mjs';
import {{ NodeError }} from './util.mjs';
export {{ LEGACY_CONTRACT_PROFILE, MANAGER_117_CONTRACT_PROFILE, RUNTIME_CONTRACTS, CONTRACT_ARTIFACTS }} from '{runtime}/src/contract-profiles.mjs';
const checked = fn => (...args) => {{
  try {{ return fn(...args); }}
  catch (error) {{
    if (error instanceof shared.ContractProfileError) throw new NodeError(error.code);
    throw error;
  }}
}};
export const contractProfileID = checked(shared.contractProfileID);
export const loadContractProfile = checked(shared.loadContractProfile);
export const profilePinFields = checked(shared.profilePinFields);
export const assertProfilePin = checked(shared.assertProfilePin);
export const matchProfileRuntime = checked(shared.matchProfileRuntime);
export const assertPinnedGraph = checked(shared.assertPinnedGraph);
"""
        if not args.check:
            adapter.write_text(expected)
        assert adapter.read_text() == expected, (adapter, 'contract-profile-adapter-divergence')
        count += 1
print(json.dumps({'status': 'PASS', 'contractRoleAdapters': count}))
