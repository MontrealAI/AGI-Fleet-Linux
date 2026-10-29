# Retained-invention component evidence admission

This small **non-executing** adapter connects one reviewed Alpha evidence bundle
to Fleet's existing `evidence-inspect` custody format. It does not add an actor,
runtime action, network client, ledger, installation, grant or production claim.
Nothing here provisions Docker/bubblewrap or changes Fleet's pinned Alpha runtime.

## Run locally

```sh
node engineering/invention-evidence/inspect.mjs engineering/invention-evidence/fixtures/ca626861.json
node --test engineering/invention-evidence/inspect.test.mjs
# With the existing lockfile dependencies installed, exercise the unchanged worker:
node --test engineering/invention-evidence/custody.test.mjs
```

The CLI only reads a bounded regular UTF-8 input file and emits JSON to stdout.
Success means `COMPONENT_EVIDENCE_CHECKED`, **not** independent re-execution,
Fleet-native acceptance, source authentication, scientific confirmation, business
acceptance or settlement authority. Refusal exits nonzero. The emitted ordinary
`agi-fleet/local-task/v1` task still requires the existing operator-controlled
admission/grant path; constructing it does not dispatch or authorize it. The
unchanged evidence worker checks byte custody only, not this adapter's semantics.

## Exact evidence and privacy

Fleet source basis: `45759fb096faf8988f58ae5ea71248d0f35a97c7`.
Alpha source: `ca626861c3a7c263cbcb2ac46347cb7704e7f4b6`.

- [Source and installed CLI run 40900990932](https://github.com/MontrealAI/AGI-Alpha-Agent-v0/actions/runs/40900990932),
  artifact `12909162998`, ZIP SHA-256
  `3e43304450eb4ca03476f88536c36a83738d87223e036c7c7669ffbb8b23a869`.
- [Seven-control run 40900990915](https://github.com/MontrealAI/AGI-Alpha-Agent-v0/actions/runs/40900990915),
  artifact `12907839857`, ZIP SHA-256
  `cd8303bb612aba41cd9377692207fcaa367bdd34e635da736905009588f4c456`.

The fixture preserves the exact public source/installed receipt bytes and seven-
control summary. Installation metadata omits only the public runner's
`installed_root` and `python` paths and reserializes the JSON. Its original member
hash and explicit projection are recorded; it is not mislabeled the original.
All 16 installed source hashes remain. Complete original ZIPs stay preserved by
their owners; this subset neither overwrites them nor includes private databases,
model/task provenance, executables or generated attack programs.

`reviewed-ca626861.json` is a fixed, code-reviewed allowlist, not caller-supplied
trust. It binds all raw file sizes/hashes and source/run/artifact identities.
The adapter also checks retained proposal/execution identities, source-versus-
installed freeze distinction, separate acceptance, actual negative control,
16-file layout and all seven executed controls. These are consistency checks of
historical evidence, **not a generic verifier or cryptographic execution proof**.
An unfamiliar run fails closed; admitting another requires an explicit source
review/update. The adapter performs no live API refresh, so it does not attest
current PR, release or artifact availability. Public archive digests/metadata were
checked during preparation, not fetched by this CLI.

No existing runtime, role, installer, workflow, lock, authority, STOP/recovery or
release inventory is changed. Held Fleet #61/#65/#66 prerequisites remain held.
New code executes only trusted JSON inspection; no imported program is run.
Tests using modified receipts are adversarial fixtures, not additional execution
results. Alpha's seven-record/55-operation result and procedural separation do
not establish general security, physical suitability, profit or invention benefit.
