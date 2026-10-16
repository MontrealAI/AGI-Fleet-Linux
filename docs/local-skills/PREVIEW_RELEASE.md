# Local Skills preview release boundary

PR #26 integrates the bounded Linux development preview described by its title. The full product described in [IMPLEMENTATION_HANDOFF.md](IMPLEMENTATION_HANDOFF.md) remains unfinished. Its 22 acceptance rows, `fullHandoffComplete: false` and `releaseEligible: false` are preserved; `releaseEligible` refers to that full product. None is a claim about completion of this narrower preview.

The separate [preview specification](../../local-runtime/preview-release.json) names `0.1.0-alpha.5`, tag `v0.1.0-local-skills-preview.5`, and its mandatory observations. It permits only a clearly labeled prerelease with `operatorInstaller: false`, `productionQualified: false`, no physical/live-provider qualification and funded work disabled. It does not authorize Dedicated Fleet publication or new runtime capabilities.

The alpha.5 identity is a new source candidate for the project journey and requires its own exact saved-package qualification. Published alpha.4 remains unchanged; its original specification is preserved in `successor/history/local-skills-alpha4-preview-release.json`. [Alpha.5 changes](RELEASE_NOTES_ALPHA_5.md).

## Required before publication

The final main commit must pass a coordinated Local Skills workflow. Both Linux x64 and ARM64 must pass 150 module tests on source and extracted bytes, 29 installer fixtures, four native cases on source and extracted bytes, actual saved installation/service/recovery/removal and all six actual Gateway/skill/sandbox paths. Gateway model transport is an explicitly synthetic local fixture. Two EN/FR browser journeys retain actual download/accessibility/reflow observations and four screenshots; browser worker execution is separately declared synthetic.

The auditor rejects missing, failing, skipped or ambiguous summaries, mismatched source/run identities, divergent architecture archives, missing lifecycle/role evidence and broader qualification claims. The shared strict installer verifier checks the saved package's paths, inventory, file hashes and modes. New changes always require new qualification; historical green runs cannot qualify changed bytes.

The same main workflow calls every existing Fleet build/native/Manager-integration/Builder/audit job through the reusable `next-release.yml` with `validation_only: true`. That switch disables only its Dedicated Fleet publisher; every regression gate remains mandatory. The caller declares the permission ceiling required by the reusable workflow's existing publisher declaration. Actual build/test/audit jobs retain read-only contents permission. [GitHub reusable-workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations) cannot be elevated by the callee.

Local publication requires all native, browser, local-audit and Fleet jobs. The publisher reaudits their exact saved files, requires the same source commit and workflow run, and validates the inherited Fleet manifest/evidence digest. The final preview evidence includes that Fleet regression manifest and evidence without republishing its installer or replacing the immutable Linux 1.1.1 assets.

## Published files and immutability

- `agi-fleet-local-0.1.0-alpha.5.zip`: exact tested development package with locked JavaScript dependencies.
- `Local-Skills-Evidence-0.1.0-alpha.5.zip`: native/browser/package observations, local audit and inherited Fleet regression evidence.
- `Local-Skills-Manifest-0.1.0-alpha.5.json`: source/run/package/evidence identities, explicit scope and separately downloaded Node pins.
- `SHA256SUMS-local-0.1.0-alpha.5.txt`: checksums for those three files.

A matching tag/release can be resumed only with identical target, canonical notes and assets. Differing tags, assets or published files are never replaced. The final publication repeats canonical notes, verifies remote asset digests, preserves prerelease classification and never makes this preview the default latest release. Each asset stays below 450 MB. Future changes require a fresh version/tag and qualification; documentation-only main changes do not silently rebuild this release.

The package's source manifest records `nativeAcceptance: NOT_RUN` at build time, before its native tests. The separate published manifest records the subsequent scoped observations; package bytes are never rewritten after testing. There is no production, physical-host, live-provider, human-accessibility, endurance or independent economic review claim.

## Français

Cette publication distincte rend disponible l’aperçu Linux limité de la PR #26. Elle ne termine pas le produit complet : les 22 exigences et leurs états restent inchangés. Les parcours x64/ARM64, les fichiers installés, les six chemins Gateway avec transport de modèle synthétique, le navigateur EN/FR et toutes les régressions Fleet doivent réussir pour la même révision et le même workflow.

La publication vérifie à nouveau les fichiers et leurs empreintes. Elle ne remplace ni une étiquette ni un fichier publié et reste une préversion. Node est un prérequis séparé vérifié par empreinte. Le travail rémunéré, le bureau/navigateur général, le mode local Mac et l’examen indépendant restent désactivés; les essais physiques, les fournisseurs réels et l’accessibilité humaine restent à réaliser. Consultez [le guide de téléchargement](DOWNLOAD_ALPHA_5.md#français).

The alpha.4 identity covers bounded outcome reservations, execution-host binding, Alpha work contracts and inactive native IPC. The alpha.2 publication queued from PR #36 and alpha.3 identity reserved by the earlier integration candidate remain separate checkpoints. The [alpha.4 publication](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v0.1.0-local-skills-preview.4) completed on 15 October 2026 after its exact-source and saved-package gates passed. [Current evidence and limits](CURRENT_STATUS.md#verified-checkpoint-kept-separate-from-new-changes). Earlier artifacts and observations remain unchanged.

La [publication alpha.4](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v0.1.0-local-skills-preview.4) a terminé ses vérifications de source et d’archive le 15 octobre 2026. Elle reste un aperçu de développement avec les limites décrites dans [l’état actuel](CURRENT_STATUS.md#français).
