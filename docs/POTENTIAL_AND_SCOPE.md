# Fleet + AGIJobManager: what can they make possible?

[Français](POTENTIEL_ET_PERIMETRE.md) · [Fleet website](https://montrealai.github.io/AGI-Fleet-Linux/) · [Installation](FRESH_INSTALL.md) · [Current qualification status](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/download/v1.0.10-qualification/Release-Manifest-v1.0.10.json)

**The mission is to build a capable, easy-to-use AI workforce that can perform a large fraction of the work people do with a keyboard, mouse and screen.** That includes work in installed applications and signed-in business tools, alongside files, code and public research. The public sandbox is an initial operating mode, not the intended boundary of the product.

AGI Fleet Linux supplies execution and review; AGIJobManager supplies funding, participation and settlement rules. Together, they could support a broad market for independently checked digital work. **The team's approximately US$40 trillion annual total addressable market is a strategic estimate supplied by the project team.** It is not an independently verified market measurement, expected revenue or an established percentage of jobs the system can automate. A defensible market model must specify geography, included work, year, pricing and achievable adoption without counting the same work twice.

The product ambition is broad; readiness is specific to a release, workspace and task. **Current releases have not demonstrated reliable completion of most screen-based jobs.** This guide separates the mission, available development paths and the results needed to establish that coverage.

## How the two systems work together

| Component | Its contribution | What still needs to be established |
| --- | --- | --- |
| **Fleet Agent** | Produces the declared deliverable using available code, files and desktop tools, within the job's permissions and budgets. | Can this exact runtime perform this task correctly and affordably? |
| **Fleet Node** | Examines the actual delivered files and source inputs in a separate review workspace; checks each acceptance criterion and approves, rejects or abstains. | Can review detect meaningful errors, including errors shared with the Agent? |
| **AGIJobManager** | Holds USDC escrow, applies participant and bond rules, records completion and votes, and enforces deadlines, dispute outcomes and settlement or deferred payment claims. | Is the chosen deployment verified and configured, and are the participants and operating services ready? |

Fleet executes and reviews outside the contract. The contract enforces rules; it cannot establish whether a conclusion is true. See [integration](JOB_INTEGRATION.md).

The [`computer-work/v2` specification](https://github.com/MontrealAI/AGIJobManager/blob/main/docs/OPERATIONS/GENERAL_COMPUTER_WORK.md) has **no profession or filename-extension allowlist**. It describes goals, inputs, outputs, testable criteria, environment, permissions, budget and deadline. New work need not require a new settlement contract; it requires suitable tools and demonstrated competence.

## Choose the workspace for the job

| | Public-work release | Authorized workspace preview |
| --- | --- | --- |
| **Use it for** | Public or synthetic inputs and checkable local deliverables. | Developing tasks across installed Linux applications and manually signed-in business tools. |
| **Environment** | Isolated, network-disabled compute plus a separately qualified public browser. | A dedicated Linux X11 OS account with actual screenshot, keyboard and mouse control through OpenClaw's experimental Linux provider. |
| **Account access** | No personal browser session; login-dependent tasks are outside this mode. | The applications and sessions deliberately made available in the dedicated account. The operator signs in. |
| **Authority** | Public-work policy and signer/compute separation. | Signed, expiring grants, declared resources, action/time/cost budgets, revocation and a durable action journal. Desktop authority is account-wide, not a per-site or per-action sandbox. |
| **Outputs** | The declared public deliverable and existing public-job integration. | Encrypted result handoffs and a separate reviewer workflow. No automatic private-job publication or settlement bridge. |
| **Status** | Linux 1.0.10 qualification release; native and integration results are recorded in its published manifest; physical qualification remains pending. | New source under `workstation/engine/`; a pilot-only development preview requiring its own end-to-end and physical qualification. Production execution is disabled; completing a local report cannot enable it. It does not inherit qualification from the packaged release. |
| **Start** | [Install the public-work release](FRESH_INSTALL.md). | [Follow the workspace quickstart](../workstation/QUICKSTART.md). |

For the authorized workspace, prepare a **task-only OS account or VM, separate from your normal desktop and the Fleet signing account**. A signed grant can authorize a run and bound its resources, but general mouse and keyboard control can reach every file, terminal, session and application available to that OS account. Application or domain labels do not enforce narrower isolation. Use account provisioning and service-side permissions to limit that reach. Run cost reserves are not a spending cap on purchases or services reached through a signed-in application; those need their own account-level controls.

Screenshots and task material may be sent to the explicitly approved model provider. Encrypted handoffs protect result transport; they do not mean model processing is local-only or provide automatic secure erasure. Local work files and journals may retain plaintext: the operator must manage access, retention and cleanup. Confirm the actual task's data permissions before making accounts or files available. Keep private inputs and results out of the public delivery path.

**A broader public-job format is also available as a source preview.** [Work Studio general-format imports](../workstation/STUDIO.md) support public `computer-work/v2` jobs with arbitrary declared extensions, up to 64 outputs and 64 MiB total output bytes, within each job’s limits. Agent and Node preserve the imported runtime identities, permissions, input hashes, budget and deadline. The quick editor remains v1. This separate import preview does not accept private or dedicated-account jobs and is not an update to the published installer.

## Work across many professions

**These are target task families, not a record of completed customer jobs.** A workspace must expose the necessary tools and permissions before a task can be attempted, and that task family needs representative acceptance evidence before it can be offered as reliable.

| Task family | Example outcome | What needs to be checked |
| --- | --- | --- |
| **Software and technical operations** | A tested fix, website, reproducible build or documented deployment. | Reproduce the issue, run checks and inspect the resulting service or artifact. External deployment requires the appropriate workspace and authority. |
| **Data, science and reporting** | Reconciled data, a workbook, charts or a numerical reproduction. | Independently recompute results; inspect units, formulas, assumptions and missing data. |
| **Documents and creative production** | Reports, slide decks, layouts, images or other files produced with installed tools. | Open the real files and inspect rendering, content, editable structure and the brief. Tools and licenses must be available. |
| **Research and knowledge work** | Source-backed findings, comparisons or a structured knowledge base. | Check claims and source quality, missing evidence and the agreed research scope. |
| **Customer and business operations** | A CRM update, support-case draft, catalog maintenance or administrative record. | Inspect the intended records and actual before/after effects, including unintended changes. Signed-in work belongs in the authorized preview path and needs separate qualification. |
| **Coordination across applications** | Prepare a proposal, update a tracker and assemble a review package. | Check every handoff, dependency and final state; keep sends, publishing and other external effects within the granted task authority. |

The public release includes Python, Node.js, data/document libraries, LibreOffice and a disposable desktop. Its deliverables can include PDF, DOCX, XLSX, PPTX, images, text, source and ZIPs within the declared limits. The authorized workspace creates a development path for a broader installed application set; it does not make Linux run every Windows or macOS application. Application compatibility, enterprise permissions and required adapters remain task-specific.

Read the current public [code and data](../fleet/packages/AGI_Agent/compute/skills/agi-code-and-data/SKILL.md), [document](../fleet/packages/AGI_Agent/compute/skills/agi-document-work/SKILL.md) and [desktop](../fleet/packages/AGI_Agent/compute/skills/agi-desktop-work/SKILL.md) instructions, or use the [workspace preview quickstart](../workstation/QUICKSTART.md).

## A concrete example

**Illustration only — this is not a report of completed customer work.** A buyer wants a public-data report comparing energy use across a supplied dataset.

1. **Define the job.** Supply a lawfully usable public, non-personal dataset; name the workbook and PDF to deliver; specify units, missing-value rules, required charts, budget and deadline.
2. **Check feasibility.** Agent and Node operators confirm the required tools, runtime, time allowance, review capacity and economic limits. Missing essential capabilities mean declining the affected work.
3. **Fund and perform.** Once operating gates and the selected contract are ready, the buyer funds the job. The assigned Agent calculates the results, creates the files, reopens them and records the checks actually performed.
4. **Review the deliverable.** Nodes independently recalculate from the original inputs and inspect the actual workbook and PDF. They report criterion-specific evidence and uncertainty.
5. **Settle under the job's rules.** Votes and any dispute process determine the contract outcome. A successful job distributes USDC; failed outgoing transfers become reserved claims that must be checked for receipt.

Success means an accepted, usable deliverable with evidence.

## Broader access, clear control and an easy first run

Keyboard and mouse access enables interaction; reliable outcomes also require judgment, organizational context, recovery and verification. The goal is substantial useful work across occupations. A whole occupation may include responsibilities that cannot be evaluated as a single desktop task.

The user experience should follow a simple sequence:

1. **Describe the result.** Name the deliverable or final application state and explain how to accept it.
2. **Choose the workspace.** Select public work or a dedicated authorized workspace with the required applications.
3. **Review the authority and budget.** Understand the account's reach, the intended external effects, time and spending limits, and who may receive the result.
4. **Run with visible progress and a stop path.** Keep evidence of completed, failed and uncertain actions. An interrupted send or submission must be inspected before any retry.
5. **Review the result.** Check actual files and application state against the acceptance criteria before reporting completion or settlement.

This is the product direction, not a claim that the development preview already provides a finished one-click operator experience. The quickstart describes the current setup and commands.

The existing public-work mode retains its restrictions: public or synthetic inputs, no personal browser session, no login-dependent browser work, no messaging/publishing/purchasing through that browser, and no network or dependency installation in its work sandbox. Those controls protect that workflow; new account-based work uses the separate authorized workspace. See the [public browser instructions](../fleet/packages/AGI_Agent/compute/skills/agi-browser-work/SKILL.md).

The preview retains signed authority, budget admission, encrypted handoffs and independent review primitives. Their effectiveness on the new Linux path needs its own observed qualification. A reviewer must inspect external effects as well as delivered files. Signed grants, separate wallets and file hashes alone do not prove correct work.

Larger projects also need dependency planning, handoffs, integration review and recovery. Specification references do not supply complete coordination. Separate child-job settlements do not guarantee atomic project settlement; each stage must preserve its authority, budget and accepted inputs. The private workspace currently has no automatic bridge to public AGIJobManager job settlement.

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

Check the [current manifest](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/download/v1.0.10-qualification/Release-Manifest-v1.0.10.json) and [physical qualification ledger](PHYSICAL_QUALIFICATION.md). A changed model, tool, image or policy needs relevant new qualification.

## A qualification roadmap toward broad coverage

**Deliver independently accepted work at a competitive total cost with little human supervision.** Track that goal by task family, application and runtime; do not extrapolate a single demo to an occupation or a market share.

| Stage | Demonstration required before promotion |
| --- | --- |
| **1. A working desktop** | Real screenshots and input on the intended Linux host; correct provider identity; installed-app and signed-in test-app interaction; STOP, grant expiry and revocation; reboot/reconnect behavior. Use synthetic accounts first. |
| **2. Useful application tasks** | Held-out tasks in documents, spreadsheets, browser apps, software tools and business records; independent checks of actual outputs and before/after application state. Record failures and human rescue. |
| **3. Multi-step work** | Work across applications, resume after interruptions, identify uncertain side effects and avoid duplicate sends/submissions. Verify handoffs, deadlines and resource limits. |
| **4. Independent review and economics** | Reviewers under independent control; planted-error detection; observed inference bills, review costs, human minutes, infrastructure, failures and realized payments where applicable. |
| **5. Broader operator rollout** | Fresh-install usability studies, tested task templates, clear mode/cost/status controls, support and recovery evidence, sustained operation and application-specific qualification. |

For every evaluation, freeze the workload, criteria and runtime; separate tuning from held-out evaluation and retain failed cases. The record should include:

| Measure | Include in the record |
| --- | --- |
| **Accepted useful work** | Independent evidence for actual files and application state, with the denominator of all attempted jobs. |
| **Review accuracy** | False acceptance, false rejection, abstention and correlated model or reviewer errors. |
| **Total cost and human effort** | Agent and Node inference, retries, failed/unpaid work, infrastructure, gas where applicable, human minutes and realized payment. |
| **Time and reliability** | Queueing, execution, review, interruptions, recovery and end-to-end completion time. |
| **External effects and authority** | Intended versus actual sends, edits, submissions and other changes; duplicate or unexpected effects; expiry, revocation and STOP behavior. |
| **Coverage** | Task families, difficulty, applications, account requirements and exclusions, with sample size and uncertainty. |

See the upstream [measurement and qualification workflow](https://github.com/MontrealAI/AGIJobManager/blob/main/docs/OPERATIONS/GENERAL_COMPUTER_WORK.md#measure-improvements-before-promotion). A changed model, desktop provider, application version or permission policy needs relevant reevaluation.

The opportunity is broad digital labor. The route to it is a capable workstation, a simple operator experience, dependable independent review and measured task success. The approximately US$40 trillion annual strategic estimate describes the team's ambition; evidence of useful work determines the portion the system can actually serve.
