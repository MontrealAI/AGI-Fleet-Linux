# Linux 1.1.1 — clearer setup and safer release publication

**Qualification prerelease; `productionQualified: false`.** This maintenance release keeps Dedicated Fleet and SUCCESSOR Ω + Fleet intact. It improves the instructions people receive and the checks that bind a published release to its reviewed source. It does **not** include the unfinished Local Skills runtime from PR #26.

## Start with your goal

[Choose your download and workflow — English](START_HERE.md) · [Choisir votre téléchargement et votre parcours — Français](COMMENCER_ICI.md).

For a first local result, use the free English or French SUCCESSOR Builder. Its two local mission families need no installation, wallet or provider key. For installed work, follow the [Linux 1.1.1 fresh-install guide](FRESH_INSTALL.md), preserve separate signer and compute accounts, and authorize Agent execution and Node review separately. Keep the project files, exported deliverables and capsule; keep wallet recovery material separately.

Use the named `AGI_Fleet_Linux_v1.1.1.zip` asset and `SHA256SUMS-v1.1.1.txt` from this release. GitHub's automatic source downloads and CI review-source archives are **not installers**. Before publication, this source document describes a candidate only: no release or acceptance evidence means no installation permission.

## What changed from 1.1.0

The new English/French starting guides distinguish the free Builder, a dedicated Linux or Mac installation, the Builder-to-Fleet connection and unfinished development previews. They explain checksum verification, STOP states, recovery, independent review and safe error reporting. The French offline starting guide now declares its language correctly and uses French navigation.

Public release-note links are resolved against the original Markdown, checked for safe existing destinations and pinned to the exact validated commit. Offline guide links remain portable. Publication regenerates the expected notes from reviewed source and the exact assets, refuses modified text, includes the canonical body in the same request that makes the draft public, and verifies the returned body. A concurrent edit cannot silently replace the checked instructions during that publication request.

Review-source receipts identify the exact tested Git tree, workflow, byte count and SHA-256. Per-commit qualification retains earlier runs instead of cancelling them. The original main-branch publisher lock and every native, browser, integration, provenance and asset gate remain in place.

All seven Linux edition identities, current installation commands and the blank physical ledger now agree on 1.1.1. The [maintenance scope record](../engineering/linux-1.1.1-maintenance-scope.json) identifies the source changes. Runtime logic, contract artifacts, dependency versions, role authority, policy, wallet recovery, settlement, STOP and cleanup behavior are preserved. The Builder and integration target remain pinned to AGIJobManager 1.16.1 at `09d89fb22d52a8df194e8dd0a00beff9f7771d82`.

## What the qualification means

Publication requires a fresh build and qualification of the **same saved 1.1.1 ZIP** on Linux x86-64 and ARM64: the full native suites, pinned Manager integration, saved-archive SUCCESSOR browser journey and independent evidence audit. The publisher rejects earlier-version or mixed-run evidence. The published manifest and checksums identify the exact archive and observations; no 1.1.0 test result is relabelled as 1.1.1 acceptance.

The browser journey exercises real browser effects and delivered bytes through the existing Controller, Companion and ComputeWorker using declared synthetic provider and sandbox transports. It does not establish live-provider competence, physical isolation or independently administered review.

Physical installation, provider/OAuth participation and costs, native application competence, independent operation, human usability and elapsed endurance remain `NOT_RUN` unless separately observed and recorded for the actual machine. Keep funded work disabled. No mainnet transaction, execution, signing or payment authority is granted by this release or by importing a capsule.

Mac 1.20.2 remains a separate, unchanged qualification download. Its source preview receives only refreshed input-integrity records where it references current Linux build inputs; it inherits no operating qualification. Local Skills browser/desktop and native Mac adapters, protocol/signer integration, independent-review placement and other unfinished acceptance work remain outside this release.

The prior 1.1.0 tag, assets, release notes and evidence remain unchanged. The website and published-download index may continue to show the prior verified installer until the new public assets have been checked; follow this release's own version-matched instructions rather than mixing commands.

[Builder guide](../successor/docs/GUIDE.md) · [Authority boundaries](../successor/docs/ARCHITECTURE.md) · [Acceptance map](../successor/docs/ACCEPTANCE.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Physical qualification ledger](PHYSICAL_QUALIFICATION.md).
