# Client v1 and developer guide

The [typed contract](../../local-runtime/schemas/client-v1.d.ts) and executable strict validators in `contracts.mjs` define this preview. Unknown fields, duplicate JSON keys, unsafe numeric values, unsupported workspace types and role/action substitutions fail closed. API errors are stable uppercase codes; they contain no raw subprocess stderr or credentials.

## Operations and permissions

| Operation | Client | Behavior |
|---|---|---|
| `status`, `inspect`, `output` | Operator or scoped actor | Read only the client's allowed actor state and actual receipt. |
| `doctor` | Operator | Inspect local capability without provider calls, account changes or spending. |
| `create` | Operator | Add an inert role instance. |
| `activate` | Operator, `confirm: true` | Fresh host/package binding and generation; no run grant. |
| `client` | Operator | Issue a new actor-only client credential. Return once; keep in a 0600 file. |
| `prepare` | Operator or scoped actor | Validate exact task and return commitment, limits and expiry. |
| `authorize` | Operator, `confirm: true` | Approve the exact returned commitment for that principal. |
| `run` | Preparing principal | Atomically reserve limits and consume authorization before one run. |
| `cancel` | Operator or matching actor | Request active process termination; retain uncertainty and cleanup evidence. |
| `revoke`, `revoke-client` | Operator | Revoke an exact grant or client hash; cancel matching active work and never restore a consumed grant. |
| `pause` | Operator | Pause/resume new preparations without discarding accepted work. |
| `stop` | Operator | Stop one actor (`actor` UUID) or the host (`actor: null`). |
| `reconciliation` | Operator | Inspect an exact uncertain run and recorded cleanup evidence; return a commitment and eligibility reason. |
| `reconcile` | Operator, `confirm: true` | Close only the inspected offline attempt with positive closure evidence. Retain failure, reservation, consumed grant and STOP; never replay or mark successful. |
| `resume` | Operator, `confirm: true` | Only after all uncertain runs are reconciled; requires fresh activation and grants. |
| `export`, `import` | Operator | Allowlisted inert role configuration; no secrets or authority. |
| `project-assemble` | Operator | Bind separate internal review to exact Agent output; create an unselected candidate. |
| `project-select` | Operator, `confirm: true` | Original SUCCESSOR keep/replace/rollback semantics. No execution permission. |
| `project-export`, `project-import` | Operator | Original portable capsule; inspection and offline restoration grant no authority. |

## Example-led workflow

`node local-runtime/cli/main.mjs help` explains transport setup. `request ACTION FILE` reads strict JSON from a caller-owned 0600 file. The server must already be running. Never put a token in an argument; use `AGI_LOCAL_TOKEN_FILE`. No client-side flag can change server-side scope.

An operator sends `create` with `{"role":"agent","name":"Public reports"}`, then `activate` with the returned actor UUID and `confirm:true`. To involve a skill, create a scoped `client` for that actor and deliver the private credential file through the client's supported credential mechanism. The assistant prepares work; the operator separately authorizes its exact commitment. Do not authorize through a model-controlled operator token.

`examples.mjs` returns valid synthetic tasks for Agent, Evidence, Employer, Moderator and Recovery. Node input consists of the original mission, variant and **exact delivered files**, plus source actor/controller provenance and `review: "internal"`. Each specialist reuses the existing registry and formal policy. Supplied protocol snapshots are unverified data; inspection output never becomes a live action or signer request.

For SUCCESSOR, complete an Agent task, then a separately authorized Node task over its exact returned files. Send `project-assemble` with `project:null`, the execution run UUID and review run UUID. Candidate assembly returns `state.active:null`. Select explicitly using `project-select`; export and restore through `project-export`/`project-import`. A corrupt or differently reviewed delivery is rejected. This covers only the deterministic internal-check example; it does not qualify the full live Builder → ComputeWorker → independent review journey.

## Validation commands

```sh
node local-runtime/validate.mjs
node --test local-runtime/tests/*.test.mjs
node --test local-runtime/tests/native/*.test.mjs
node --test local-runtime/tests/browser/dashboard.test.mjs
```

The default suite includes the real Unix-socket transport test. It must not be deleted or skipped to make a constrained environment green. Native tests require trusted Node/bubblewrap ownership, usable namespaces, and actual OS effects. Browser tests use the repository's locked Playwright and axe dependencies. Missing sockets, native capability or a browser distribution remain failed/unavailable gates.

To check preservation, use `python3 engineering/check-repository.py --require-source` in a **clean checkout before npm installs**, then the existing engineering/native suites. That inventory intentionally rejects extra dependency files under `fleet/`; the new mode does not weaken it.

## Development source archive

```sh
python3 local-runtime/package.py --output /ABSOLUTE/ABSENT/preview-dist
python3 local-runtime/package.py --verify /ABSOLUTE/preview-dist/agi-fleet-local-0.1.0-alpha.1.zip
```

This archive includes source, the six skills, guides, original licenses and locked installed dependencies. Its manifest binds every member's bytes and mode, records the source commit and dirty-tree state, and explicitly says `operatorInstaller:false`. It is **not** a published or qualified installer. The new [installation and recovery tools](INSTALL_AND_RECOVER.md) operate on this development package and an exact hash-pinned Node archive. Native execution and full qualification remain separate gates. The script rejects archive/member sizes at 450,000,000 bytes and never overwrites existing output.

## Compatibility and rollback

The existing six-role registry, policy seals, runtime pins, Manager protocol and Dedicated Fleet distribution inventories are unchanged. The local state schema is `agi-fleet/local-ledger/v1`; portable role configuration is `agi-fleet/portable-role/v1`; no live database import is provided. Imported actors remain inactive and economically disabled. Software maintenance stages verified code and switches an atomic version pointer while keeping the authority ledger outside the installation. Rollback does not restore old ledgers or reset budgets. This development preview remains unsuitable for authoritative production operation.
