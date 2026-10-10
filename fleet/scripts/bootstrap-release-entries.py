"""One-time, exact-source migration of the defective Fleet 1.19.0 entries."""
import argparse
import hashlib
import json
from pathlib import Path

from script_entry_generation import insert_imports, validate_script_bytes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.root.resolve()
    destination = root / 'shared/runtime/script-entries'
    if destination.exists():
        raise SystemExit('Canonical templates already exist; this migration is one-time only.')
    definitions = [
        ('setup-agent.mjs.template', 'setup-openclaw.mjs', ['agent'], "import {setupRole} from '../compute/roles.mjs';", '9aaf357f0c7533ec88ab531f82f72fae235e58f7f5f073096177cfc5b9f6fe92'),
        ('setup-node.mjs.template', 'setup-openclaw.mjs', ['node'], "import {setupRole} from '../compute/roles.mjs';", 'c3aa1fa8ffaa37d6ec8bd233f4687a34daa82a4b0c24a2c787305f56e294739f'),
        ('qualify-mac.mjs.template', 'qualify-mac.mjs', ['agent', 'node', 'moderator', 'employer', 'evidence', 'recovery'], "import {COMPUTE_ROLES,roleContract} from '../compute/roles.mjs';", '66cc0ab9ca68cab030b69a2e132673397dd8fb3c2824f159b0fdaabf4aadaedd'),
    ]
    roles = json.loads((root / 'config/role-registry.json').read_text())['roles']
    entries, evidence, templates = [], [], {}
    for template, filename, selected_roles, statement, expected_sha in definitions:
        generated_import = statement.encode()
        prefix = generated_import + b'\n'
        canonical = None
        for role in selected_roles:
            source = root / 'packages' / roles[role]['package'] / 'scripts' / filename
            observed = source.read_bytes()
            observed_sha = hashlib.sha256(observed).hexdigest()
            if observed_sha != expected_sha or not observed.startswith(prefix + b'#!/usr/bin/env node\n'):
                raise ValueError(f'{source}: source is not the exact released 1.19.0 defect')
            body = validate_script_bytes(observed[len(prefix):], str(source))
            if canonical is not None and body != canonical:
                raise ValueError(f'{source}: shared role template differs')
            canonical = body
            corrected = insert_imports(body, [generated_import])
            evidence.append({'path': source.relative_to(root).as_posix(), 'beforeSHA256': observed_sha,
                             'afterSHA256': hashlib.sha256(corrected).hexdigest(), 'template': template,
                             'change': 'preserve original body; generate existing import immediately after byte-zero hashbang'})
        templates[template] = canonical
        entries.append({'template': template, 'output': 'scripts/' + filename,
                        'roles': selected_roles, 'imports': [statement]})
    destination.mkdir(parents=True)
    for name, data in templates.items():
        (destination / name).write_bytes(data)
    (destination / 'manifest.json').write_text(json.dumps({'schema': 'agi-script-entry-templates/v1', 'entries': entries}, indent=2) + '\n')
    report = {'schema': 'agi-script-entry-migration/v1', 'sourceFleetVersion': '1.19.0',
              'sourceFleetArchiveSHA256': '00f9b1ae3f27fcfe4fd03c86665dcb34897574209a40ff9722c56e4d010628ff',
              'originalInsertionTransformAvailable': False,
              'method': 'Exact-hash migration to canonical templates, then shared generation; no built-file edits',
              'entries': evidence}
    (root / 'evidence/script-entry-migration-1.19.1.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'templates': len(templates), 'entries': len(evidence), 'sourceChecksPassed': True}))


if __name__ == '__main__':
    main()
