# Review and release governance — activation required

The read-only 14 October observation found main unprotected, no rulesets (including parents), and Linux 1.1.1 reporting immutable:false. These observations do not demonstrate a compromise. The current GitHub connector supports source/PR work but exposes no administration-setting mutation. **Enforcement remains NOT_CONFIGURED**, with the repository administrator as owner. No reviewer identity has been invented.

The prepared [main-protection.json](../engineering/governance/main-protection.json) requires stale-review dismissal, an independent approval, last-push approval, admin enforcement, conversation resolution and refusal of force-push/deletion. A stable **Required release qualification** job fails when any saved-archive build/native/integration/browser/audit child fails, is missing, cancelled or skipped; the publisher keeps all earlier gates and adds this aggregate. Fixture success does not qualify physical hosts or live work.

Before applying the policy, the administrator must:

1. Add an actual eligible reviewer and CODEOWNERS for installers, signers, authorization, workflows, auditors and vendor boundaries. The patch author cannot satisfy independent approval.
2. Require `repository` and `Required release qualification`. Qualification now runs on every pull request, including documentation changes, so the required aggregate can resolve consistently. Confirm exact check names and application identities from a completed final-head run before applying the policy.
3. Apply/re-read branch protection through an Administration(write) connection, then verify a non-destructive draft test cannot merge without review/checks. Do not force-push main to test it. Preserve audited, narrowly scoped emergency access.
4. In repository Settings → Releases, enable release immutability for future releases. Keep historical releases; do not recreate them. The existing publisher validates a complete draft before publishing final assets.
5. Enable private vulnerability reporting and verify the advertised private route.

Official instructions: [branch protection API](https://docs.github.com/en/rest/branches/branch-protection), [future release immutability](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes). Build provenance and SBOM attestations remain separate from correctness/operational evidence; existing per-edition SBOMs and license inventories are preserved. Artifact attestations and consumer verification remain an administrator/release-owner commissioning item.

Required resources: an administration-capable GitHub connection, a named eligible independent reviewer, and completed final-head check identities. Until read-back enforcement evidence exists, no document or passing source test may report this requirement complete.
