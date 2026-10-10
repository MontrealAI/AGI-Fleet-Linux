# Fleet + AGIJobManager: what can they make possible?

[Français](POTENTIEL_ET_PERIMETRE.md) · [Fleet website](https://montrealai.github.io/AGI-Fleet-Linux/) · [Installation](FRESH_INSTALL.md) · [Current qualification status](../engineering/current-release.json)

**Together, AGI Fleet Linux and AGIJobManager could become general-purpose infrastructure for paid digital work.** Fleet supplies execution and review; AGIJobManager supplies funding, participation and settlement rules. The framework can serve more deliverables as tools, permissions and measured competence improve.

**Completing most work a human can do with a keyboard, mouse and screen is a long-term ambition. The current Linux releases have not demonstrated that breadth.** This guide explains the opportunity, present boundaries and evidence needed to expand.

## How the two systems work together

| Component | Its contribution | What still needs to be established |
| --- | --- | --- |
| **Fleet Agent** | Produces the declared deliverable using available code, files and desktop tools, within the job's permissions and budgets. | Can this exact runtime perform this task correctly and affordably? |
| **Fleet Node** | Examines the actual delivered files and source inputs in a separate review workspace; checks each acceptance criterion and approves, rejects or abstains. | Can review detect meaningful errors, including errors shared with the Agent? |
| **AGIJobManager** | Holds USDC escrow, applies participant and bond rules, records completion and votes, and enforces deadlines, dispute outcomes and settlement or deferred payment claims. | Is the chosen deployment verified and configured, and are the participants and operating services ready? |

Fleet executes and reviews outside the contract. The contract enforces rules; it cannot establish whether a conclusion is true. See [integration](JOB_INTEGRATION.md).

The [`computer-work/v2` specification](https://github.com/MontrealAI/AGIJobManager/blob/main/docs/OPERATIONS/GENERAL_COMPUTER_WORK.md) has **no profession or filename-extension allowlist**. It describes goals, inputs, outputs, testable criteria, environment, permissions, budget and deadline. New work need not require a new settlement contract; it requires suitable tools and demonstrated competence.

## Where the opportunity is strongest

Start with valuable outputs that are inexpensive to check. **These are strategic candidate markets, not demonstrated customer-job results.**

| Candidate work | Example deliverable | Useful independent check |
| --- | --- | --- |
| **Bounded software changes, tests and tooling** | A source ZIP containing a focused fix and regression tests. | Reproduce the fault, exercise the fix and inspect regressions with available dependencies. |
| **Public-data analysis and reporting** | A workbook, charts and a concise report from supplied public data. | Recompute results, inspect formulas, units and missing-data treatment. |
| **Scientific and numerical reproduction** | An executable reproduction with declared assumptions and outputs. | Rerun the calculation and compare with independently established expected results. |
| **Websites, interactive demos and executable documentation** | A local web application or documented example project. | Exercise the delivered UI and instructions against explicit requirements. |
| **Documents, spreadsheets and presentations** | A DOCX, XLSX, PPTX or PDF matching a clear brief. | Open the actual files, recalculate where needed and inspect rendered pages or slides. |
| **Public-source research** | A report with attributable claims and source evidence. | Check claims against supplied sources or qualified public browsing, and identify unresolved questions. |

Installed tools include Python, Node.js, data/document libraries, LibreOffice and a disposable desktop. Outputs can include PDF, DOCX, XLSX, PPTX, images, text, source files and project ZIPs within declared limits. Available formats do not establish success rates. Read the [code and data](../fleet/packages/AGI_Agent/compute/skills/agi-code-and-data/SKILL.md), [document](../fleet/packages/AGI_Agent/compute/skills/agi-document-work/SKILL.md) and [desktop](../fleet/packages/AGI_Agent/compute/skills/agi-desktop-work/SKILL.md) operating instructions.

## A concrete example

**Illustration only — this is not a report of completed customer work.** A buyer wants a public-data report comparing energy use across a supplied dataset.

1. **Define the job.** Supply a lawfully usable public, non-personal dataset; name the workbook and PDF to deliver; specify units, missing-value rules, required charts, budget and deadline.
2. **Check feasibility.** Agent and Node operators confirm the required tools, runtime, time allowance, review capacity and economic limits. Missing essential capabilities mean declining the affected work.
3. **Fund and perform.** Once operating gates and the selected contract are ready, the buyer funds the job. The assigned Agent calculates the results, creates the files, reopens them and records the checks actually performed.
4. **Review the deliverable.** Nodes independently recalculate from the original inputs and inspect the actual workbook and PDF. They report criterion-specific evidence and uncertainty.
5. **Settle under the job's rules.** Votes and any dispute process determine the contract outcome. A successful job distributes USDC; failed outgoing transfers become reserved claims that must be checked for receipt.

Success means an accepted, usable deliverable with evidence.

## What “screen-based work” does and does not mean

Keyboard and mouse access does not establish occupational competence. Jobs can require ambiguous judgment, organizational knowledge, negotiation or long action sequences. Automating bounded tasks across occupations comes before reliably performing whole occupations.

The **current Linux public-work path** is deliberately bounded:

| Boundary | Practical meaning |
| --- | --- |
| **Public, non-personal or synthetic inputs** | Inputs must be authorized for the public workflow. A file being technically readable does not make it appropriate for public delivery. |
| **Protected public browser** | Only available when exposed, authorized and qualified. It has no personal session. Login, CAPTCHA and private-account dependencies require declining affected criteria. |
| **No browser actions that commit external changes** | Messaging, publishing, purchasing and creating accounts through that browser are excluded. Delivering a local website does not include deploying it through a signed-in account. |
| **Network-disabled work sandbox** | Compute uses installed tools. It cannot install dependencies during a job or substitute host execution or shell networking for a missing capability. |
| **Declared runtime and output limits** | Missing applications, unsupported requirements or oversized outputs require a different agreed specification or a decline. A valid file hash proves integrity, not correctness. |

See the [browser scope](../fleet/packages/AGI_Agent/compute/skills/agi-browser-work/SKILL.md) and [code scope](../fleet/packages/AGI_Agent/compute/skills/agi-code-and-data/SKILL.md). Signed-in email, CRM, banking and enterprise account operation falls outside this Linux path. Separate private/native workflows upstream do not establish Linux capability.

Larger projects need dependency planning, handoffs, integration review and recovery. Specification references do not supply complete coordination. Separate child-job settlements do not guarantee atomic project settlement; each stage must preserve its authority, budget and accepted inputs.

## Review quality and economics determine scalability

Different wallets or repeated model calls do not establish independence. Use independently controlled reviewers and examine shared model, prompt, source and testing errors. Independent recalculation, adversarial examples and diverse checking methods help assess that risk. A voting majority can still be wrong. See [evidence review](../fleet/packages/AGI_Agent/compute/skills/agi-evidence-review/SKILL.md).

More Agents need sufficient qualified review capacity and sustainable economics. For a **successful reviewed 1,000 USDC job at the documented default 8% validator rate**, the base allocation is:

| Recipient | Amount |
| --- | ---: |
| Assigned Agent | **520 USDC** |
| Correct-side validators, collectively | **80 USDC** |
| Settlement wallet receiving 30% | **300 USDC** |
| Settlement wallet receiving 10% | **100 USDC** |

The price includes these shares; 80 USDC is shared across eligible Nodes. This is no profit forecast or universal outcome. The rate is snapshotted per job; rounding, residual pools, separate bonds, slashing, disputes and unreviewed acceptance can change transfers. Inspect actual terms and [exact payout rules](https://github.com/MontrealAI/AGIJobManager/blob/main/docs/USDC_PAYOUT_SPLIT.md).

Count inference, review, failed/unpaid work, ETH gas, infrastructure, publishing, human intervention and capital at risk. Gross allocation is not profit; architecture establishes no revenue forecast.

## Evidence snapshot: 10 October 2026

Snapshot for **Linux 1.0.9**, not an evergreen readiness claim. The [manifest at the reviewed repository revision](https://github.com/MontrealAI/AGI-Fleet-Linux/blob/a52720d87864eac6b1e9827e2b29f2e1d7749ca8/engineering/current-release.json) records:

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Native acceptance passed on Ubuntu 24.04 x86-64 and ARM64. | The recorded regression behavior of the exact release under those test environments. | Physical-host operation or general job competence. |
| Agent/Node integration passed against AGIJobManager commit `191cf3590e5cdc08df1bb0af500ee28a91c8b010` (1.13.0). | Tested client and contract lifecycles using local-chain fixtures. | Real paid inference, native-USDC customer settlement or independently operated validators. |
| A separate mainnet observation matched the manager and eight library runtimes at block **26,162,266**. | Compatibility with the recorded deployment at that block. | Current intake or operator readiness; intake was paused in that historical snapshot. |
| Physical fresh install, rootless Docker, OAuth/inference, live documents, base/browser cleanup, reboot identity and 72-hour endurance were **NOT_RUN**. | These qualification gates remained open. | Production qualification: the manifest explicitly recorded `productionQualified: false`. |

Integration uses an in-process chain, mock tokens and generation/content/identity fixtures. Node clients and wallets share one controller. Simulated days are not real-time endurance. Read [integration evidence](JOB_INTEGRATION.md), [hash-bound acceptance addendum](../validation/LINUX_1_0_9_JOB_INTEGRATION_ADDENDUM.md) and [mainnet observation](MAINNET_DEPLOYMENT.md).

Check the [current manifest](../engineering/current-release.json) and [physical qualification ledger](PHYSICAL_QUALIFICATION.md). A changed model, tool, image or policy needs relevant new qualification.

## The milestone that would establish the opportunity

**Repeatably deliver independently accepted work at a competitive total cost with little human supervision.** Establish that for each task class before expanding its scope.

| Measure | Include in the record |
| --- | --- |
| Useful accepted output | Independent outcome evidence for actual delivered files. |
| Review accuracy | False acceptance of flawed work, false rejection of good work and unresolved uncertainty. |
| Reliability | Every planned engagement, including failures, timeouts, refusals and abstentions. |
| Economics | Total Agent and Node costs, unpaid work, gas, human minutes, retries and realized payments. |
| Completion time and capacity | Queueing, execution, review, disputes and recovery; both Agent and Node capacity. |
| Operational safety | Cleanup, STOP behavior, reboot recovery and adherence to declared permissions and limits. |

Freeze the workload, acceptance criteria and runtime; separate calibration from held-out evaluation; retain failed cases and actual bills. Use independently established outcomes and report uncertainty, particularly where errors may be correlated. See the upstream [measurement and qualification workflow](https://github.com/MontrealAI/AGIJobManager/blob/main/docs/OPERATIONS/GENERAL_COMPUTER_WORK.md#measure-improvements-before-promotion).

More qualified task classes could support an expanding market for machine-performed digital labor, using the same settlement framework. Measure delivery, review and economics, one proven class at a time.
