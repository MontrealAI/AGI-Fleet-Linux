Fleet 1.19.4 qualification evidence

This directory contains reusable acceptance specifications and an offline evidence gate.
It does not contain executed case studies, live payment receipts or physical-Mac qualification.

Run from the release root:
  node qualification/release-gate.mjs qualification/release-qualification-template.json

The delivered template intentionally returns exit 2, RELEASE_CANDIDATE_ONLY.
Exit 0 means the requested evidence fields are complete and referenced file bytes verified.
It does not establish that an observation is true or independently reviewed.
The gate adds no release approval policy and grants no execution or financial authority.

Keep an operational copy of the template outside the distributed application. Record the
exact catalog SHA-256, final archive and source-inventory SHA-256 plus evidence IDs.
Each evidence entry is {id, path, sha256, bytes}; paths are relative to that manifest,
contain no traversal, and must refer to regular non-symlink files below 450,000,000 bytes.
Populate outcomes only from actual observations; retain failures, unknowns and costs.
Never bundle wallet material, OAuth tokens, provider text or private user content.

acceptance-catalog.json: 24 job specifications and independent acceptance criteria.
release-qualification-template.json: all requested release gates and 24 NOT_RUN outcomes.
current-gate-result.json: the expected blocked evaluation of the delivered template.
contract-source-pin.json: bundled source commit, ABI hash and actual ABI method names; no deployment selected.
source-assessment.json: implemented safeguards versus unclosed production requirements.
outcome-metrics-template.json: cohort, usage, payment and economics definitions with null observations.

Existing-account target: preserve agiagentv1 and agiagentcomputev3; retain v1/v2 failure evidence.
No new compute account, automatic STOP deletion, cleanup evidence pruning or wallet operation
is performed by this directory. Physical execution follows the tested in-place updater
and the current release instructions.
