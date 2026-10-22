<!-- SPDX-License-Identifier: Apache-2.0 -->
# Qualified Discovery preview publication

This is the separate software prerelease `v0.1.0-discovery-preview.1`. It does not
replace a Dedicated Fleet or Local Skills release. The source profile remains a
record of prequalification inputs; only the external qualification manifest and
actual completed workflow establish this preview's bounded acceptance.

Prepare the exact accepted public Alpha main pin with `freeze-source`, bind its
successful final-main UI artifact through the immutable public Git packet in
`mission-input.json`, commit and review both complete profiles, and finish the
coordinated merge. An older or failed artifact cannot be reanchored. The final reviewed Fleet
commit must be current main and the merge commit of its recorded PR. All earlier
failures and source revisions remain evidence for their own bytes.

CONTRIBUTING permits a distinct technical review pass under the owner-authorized
shared account. Record the actual reviewer's role and identity, the existing
owner mandate, exact commit/tree, components reviewed and finding dispositions.
A technical COMMENT is neither GitHub APPROVE nor a separate organization or
economic approval. The publisher does not merge, override repository rules or
alter enforcement. Any GitHub-enforced distinct-account requirement still
applies to the normal merge. The authorization for historical PR #36 is not
reused for this source.

The owner-authorized reviewer retains a case-specific PR issue comment starting
with `<!-- agi-fleet/discovery-preview-review/v1 -->` and a single JSON object:

```json
{
  "schema": "agi-fleet/discovery-preview-review/v1",
  "repository": "MontrealAI/AGI-Fleet-Linux",
  "version": "0.1.0-discovery-preview.1",
  "reviewedCommit": "EXACT_CURRENT_MAIN_MERGE_COMMIT",
  "reviewedTree": "EXACT_REVIEWED_GIT_TREE",
  "pullRequest": 64,
  "reviewer": {
    "role": "independent-technical-review-agent",
    "identity": "ACTUAL_REVIEWER_IDENTITY",
    "accountArrangement": "owner-authorized-shared-account"
  },
  "ownerAuthorization": {
    "basis": "explicit-public-implementation-mandate",
    "reference": "ACTUAL_EXISTING_OWNER_MANDATE_REFERENCE"
  },
  "reviewedComponents": [
    "installed-package", "owned-source-boundary", "two-runtime-native-return",
    "same-history-docket", "artifact-custody", "publication", "inherited-gates"
  ],
  "unresolvedFindings": [],
  "findingDispositions": [],
  "organizationalIndependence": false,
  "economicApproval": false
}
```

Replace placeholders and the example PR number with the actual facts. Preserve
each finding as `{ "id": "...", "disposition": "resolved", "evidence": "..." }`
or a documented `not-a-finding` disposition. An empty disposition list is valid
only when the review found none. Do not relabel blocked or unrun probes as passes.

Run **Publish reviewed Discovery preview** on that exact main source with its
PR/comment IDs and confirmation `PUBLISH_0.1.0-discovery-preview.1`. This uses the
existing publication mandate and account. It does not request new credentials,
security settings or review identities. The workflow:

1. Authenticates the current-main lease, normally merged PR and technical review;
   retains a Git source archive and the exact authorization record.
2. Builds one saved Discovery candidate. Both pinned Linux x64 runtimes consume
   those same bytes and the same original pre-Fleet UI workspace and two request
   downloads, preserve its history prefix, append native receipts and verify its
   thirteen-file docket and reopening. Separate constructed native regressions
   remain mandatory and cannot substitute for missing original input.
3. Calls the unchanged full Fleet release workflow with `validation_only:true`:
   saved archive, both native architectures, Manager/profile integration,
   SUCCESSOR browser, audit and fail-closed required qualification aggregate.
4. Downloads original artifacts, verifies outer sizes/digests and bounded unique
   ZIP members/CRC, rechecks raw native evidence and the inherited audit, and
   compares the review archive with the exact Git blobs and modes. It independently
   rereads the public Alpha input packet and original successful run/attempt,
   source and artifact metadata before publication.
5. Creates only the new fixed prerelease/tag and five named assets. A different
   existing tag, asset, source or note text stops publication; nothing is replaced.
   Every asset is downloaded and hashed before and after publication.

Assets are the installed candidate ZIP, `Discovery-Source-VERSION.zip`,
`Discovery-Evidence-VERSION.zip`, `Discovery-Qualification-VERSION.json` and
`Discovery-SHA256SUMS-VERSION.txt`, where VERSION is `0.1.0-discovery-preview.1`.
The final workflow artifact retains downloaded-byte verification and failures.
If a run stops after a public mutation, inspect actual release/tag state before
continuing; the publisher never deletes or replaces assets to hide a failure.

The published scope remains finite local software review. Remote execution and
settlement are disconnected; physical and live-provider qualification remain
NOT_RUN. Publication grants no wallet, transaction, funding, activation or
governance authority and does not establish AGI, economic gains or organizational
independence.

La publication concerne uniquement cet aperçu logiciel de vérification locale.
Les versions Dedicated Fleet et Local Skills restent inchangées. Aucun service,
portefeuille, paiement, financement ou travail externe n'est activé.
