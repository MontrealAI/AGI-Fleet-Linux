# Work Studio: larger public tasks

This source preview makes **general computer-work/v2 imports usable in the Agent and Node Work Studios**. The published release and its qualification record are unchanged. These changes are an overlay over the frozen source, pending a rebuilt release and operator qualification.

## What you can do

1. In the Agent Studio, expand **Already have a job specification?** and import a public v2 JSON specification.
2. Choose **Create & check the work**. The compute service must match the specification's pinned runtime identities and authority. Missing capabilities, expired deadlines or a changed runtime remain blockers.
3. Download your files and **Review handoff**. A Node Studio can import that complete handoff and review the same bytes against the same criteria.
4. If review finds a concrete failure, export **Revision feedback**. The Agent can create a revised result while preserving the original files and criteria. Uncertain or unsafe feedback does not authorize automatic repair.

| Workflow | Declared output limits | Acceptance criteria |
| --- | --- | --- |
| Quick editor and legacy v1 import | 24 files, 4 MiB total | 16 |
| General v2 import | 64 files, 32 MiB per file, 64 MiB total | 64 |

A specification may set smaller limits. General v2 has no extension catalogue: it can declare other application formats, source trees and data files using safe relative paths and MIME types. Allowing a format does not establish that an installed application can open it or that a model can complete the task. Review must inspect the actual work and report missing evidence.

The quick editor retains its existing format. A valid v2 specification requires real runtime identities, permissions and budgets; the UI never invents these or replaces imported values. [The existing v2 example](../fleet/examples/computer-work-v2.json) documents the structure. Its identities and dates are illustrative and must be replaced with the actual agreed values before use.

## Public Studio and authorized workstation

This Studio accepts **public data and isolated-public authority for both roles**. Private or signed-in account work uses the separate authorized workstation workflow. A public Studio run does not grant account access, publish a deliverable, cast a blockchain vote or settle payment. Browser access still requires the existing admitted-work and qualification workflow; importing a JSON file cannot grant it.

The local shelf holds five runs. Large results and revision originals can use up to 192 MiB per run. Download the files and receipts you need, then explicitly remove older local copies. Reopening the app preserves completed results and never silently repeats interrupted inference.

**Large Studio work cannot block wallet recovery.** Full encrypted backups retain their existing recovery size limits. If a Studio run exceeds those limits, the app tells you to export it separately. Download its files, review handoff and receipt, then select **Exclude Studio work from this wallet backup** in the backup form. This explicit choice keeps your wallet, transaction history, admission evidence and pilot records in the bounded encrypted backup. The verification result records the exclusion; local Studio files stay intact. Restore recovers the included operational state, while the separate Studio exports remain your copy of the excluded work. Leave the checkbox off for a complete backup when Studio work fits.

## Engineering preview

`studio-overlay/` contains only changed files for the top-level `packages/AGI_Agent` and `packages/AGI_Node` source trees. The nested bundled distributions remain frozen until a release builder rebuilds and verifies them. Do not copy this overlay onto an operator installation or reuse the frozen release's qualification claims.

Materialize a separate developer source fixture:

```bash
python3 engineering/materialize-workstation-preview.py --output /absolute/path/to/new-preview
```

The source fixture is not an installable distribution and does not bundle dependencies. To run the focused tests, provide the frozen package's exact installed dependencies (including Ajv 8.20.0 and ethers 6.17.0):

```bash
AGI_STUDIO_NODE_MODULES=/absolute/path/to/node_modules \
  node --test workstation/tests/studio.test.mjs
```

The test creates and removes its own temporary Agent and Node source fixtures. It reads the supplied dependencies without modifying them. `AGI_WORKSTATION_FIXTURE` can instead select an already materialized fixture with its dependencies available.

Tests exercise general-format validation, exact-byte handoffs, failed-review revisions, large local persistence, unchanged legacy imports, and rejection of private authority. Real Controller tests create synthetic wallets and verify that explicit Studio exclusion produces a bounded encrypted backup that verifies and restores the wallet and operational evidence while preserving source Studio files. Browser import rules are evaluated from the real UI script in a JavaScript DOM-contract harness. These are synthetic contract tests: they do not establish live inference, rendered browser usability, installed application compatibility, or production qualification.
