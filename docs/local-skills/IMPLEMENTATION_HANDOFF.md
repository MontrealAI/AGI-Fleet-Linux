# AGI Fleet Skills + Local Runtime
## Complete Senior Developer Team implementation handoff

Prepared: October 13, 2026
Implementation repository: https://github.com/MontrealAI/AGI-Fleet-Linux
Product decision: one repository; a new, first-class, additive deployment mode.

---

## 1. Your mandate

Act as an elite senior engineering team spanning architecture, Linux/macOS systems, agent runtimes, application security, computer use, protocol integration, product design, accessibility, quality assurance, and release engineering.

Implement **AGI Fleet Skills + Local Runtime** in the existing `MontrealAI/AGI-Fleet-Linux` repository. Deliver working software, operator documentation, tested release artifacts, reviewed pull requests, and an eligible published release—not merely an architecture proposal, mock dashboard, collection of prompts, or a wrapper that still requires one physical machine per role.

The product promise is:

> Install Fleet once. Add the roles you need. Keep their identities, permissions, credentials, memory, and workspaces separate. Run authorized work on available local resources.

The architectural principle is:

> Decouple role capabilities and actor identities from physical compute, without decoupling authority, accountability, or review independence from identities.

Keep **Dedicated Fleet** available and supported. Add **Local Skills** alongside it. Do not create another repository, rename this repository, replace existing products, or introduce a mandatory hosted service. Reuse the established runtime and protocol semantics wherever possible. A local runner is an execution resource; an AGI Node is a protocol/review role, not simply a computer called a node.

Proceed through implementation and verification. Make conservative, documented decisions for nonblocking ambiguities. Do not claim completion when required behavior is missing. Do not invent credentials, authorization, test results, physical-machine observations, independent reviewers, signing, notarization, or production qualification.

## 2. Establish the real baseline and coordinate concurrent work

Before editing, inspect the current default branch, repository instructions, release manifests, open PRs, workflows, role definitions, shared runtime, platform guides, and qualification records. Record exact source commits and distinguish released assets from source previews and unmerged work.

The planning inspection observed default-branch commit `22eba990dbaa0083c7c6f21a0638bf546d0d47ed`. It also observed open PR **#25**, “Add SUCCESSOR Ω + Fleet Builder and qualify Linux 1.1.0,” at head `837716c0e5690d67180ca106c763e5f3eadb6638`. These are historical inspection anchors, not instructions to build from stale commits or assertions that the PR is merged. Refresh their status before implementation. [R1–R3]

The PR's architecture describes a Builder integration through the existing Studio, Companion, and ComputeWorker, with separate execution, review, and local version selection. Inspect the actual final code and tests, not just the PR description. Integrate with the accepted bridge; do not create a competing capsule format, dispatch path, or parallel policy engine. If the PR remains open, coordinate through reviewed dependency/stacked PRs or wait to rebase the integration change; do not merge unrelated work just to simplify your branch. [R3]

Useful verified starting points include:

```text
fleet/shared/runtime/compute/role-registry.json
fleet/shared/runtime/compute/roles.mjs
fleet/shared/runtime/compute/policy.mjs
fleet/packages/AGI_Agent/compute/skills/
docs/DEVELOPMENT.md
docs/FRESH_INSTALL.md
macos/docs/FRESH_INSTALL.md
workstation/QUICKSTART.md
macos/preview/
.github/workflows/
```

The existing role registry and role-skill mapping are sources to reuse, not authorities to weaken. Shared runtime modifications must follow the repository's synchronization and inventory process. Current documentation describes separate platform qualification tracks and outstanding physical gates; do not inherit production claims from automated source acceptance. [R4–R8]

Produce a concise baseline report, a dependency/compatibility matrix, and architecture decision records covering isolation, transport authentication, authority binding, persistence, upgrades, and release numbering.

## 3. Non-negotiable preservation rules

This is an addition. Preserve existing Agent, Node, Moderator, Employer, Evidence, Recovery, Orchestrator, Monitor, Linux, macOS, Studio, native-workstation preview, SUCCESSOR Ω, wallet, signer, funding, review, settlement, recovery, backup, and STOP workflows that exist at the implementation baseline.

Preserve public URLs, guide anchors, diagrams/flowcharts, command contracts, data formats, release assets, and historical evidence unless a specific change is demonstrably necessary. Do not remove features, disable tests, weaken admission rules, or reclassify failures as success to make the new mode pass.

Minimal changes to existing files are allowed when required for integration or correctness. Record the reason, compatibility effect, tests, and rollback path for each meaningful change. Use a machine-readable preservation report, including additions, modifications, removals, and justified exceptions. Do not require byte-for-byte preservation of files that genuinely must change; do preserve immutable published assets and historical evidence.

Default to a fresh local-mode installation. For this new mode, “fresh” means fresh Fleet-managed application state and properly isolated work environments—not a mandatory operating-system reinstall or a dedicated physical computer. Coexist safely with the operator’s everyday host account without exposing that account to compute. Keep existing Dedicated Fleet installation requirements unchanged. Migration must not become a prerequisite. Do not reuse arbitrary existing OpenClaw state, historical wallet data, prior profile layouts, or installed browser sessions automatically. Never silently migrate a Dedicated Fleet profile.

Keep protocol contracts and economic rules unchanged. Do not deploy contracts, submit mainnet jobs, spend funds, transfer assets, publish private evidence, or change account permissions merely because this implementation prompt authorizes software development and release work.

## 4. Implement six separate architectural objects

Create explicit, versioned interfaces for the following objects. Keep their ownership and lifecycle distinct.

| Object | Responsibilities | Must not contain or imply |
|---|---|---|
| Role package | Portable role instructions, references, capability requirements, schemas, compatibility metadata, package identity | Wallet keys, OAuth sessions, host paths, live databases, execution permission |
| Actor profile | Stable local actor identity, selected role, operator relationship, approved configuration, references to private state | An assumption that a machine defines the actor, or a claim that an arbitrary label establishes protocol eligibility |
| Host binding | Current qualified runtime, platform/backend, OS/account boundary, endpoints, immutable runtime identities, approved local resources | Portable blanket authority or automatic inheritance of another host's qualification |
| Run grant | Exact actor/job/action scope, input commitments, tools, resources, budgets, expiry, operation identity | Unbounded delegation, role escalation, automatic approval of future jobs |
| Execution workspace | Isolated per-job inputs, writable scratch/output areas, browser/desktop session where required | Signer access, another actor's state, arbitrary host filesystem or management sockets |
| Evidence and outcome records | Exact input/output commitments, observed actions, versions, checks, limitations, review and disposition | Proof of truth, independence, payment, or acceptance merely because a hash or signature exists |

Derive effective authority from the intersection of the verified package policy, actor permissions, host capabilities/qualification, exact job authorization, and current revocation/STOP state. A model, skill, imported file, route parameter, or chat message cannot widen that intersection.

Separate the portable role-definition digest from host-specific execution-policy bindings. Keep existing sealed policy formats intact; introduce a reviewed versioned extension and compatibility adapter rather than deleting host-bound checks. Rebinding is explicit and auditable.

## 5. Deliver real, portable role skills

Provide independently installable skills for `agi-agent`, `agi-node`, `agi-moderator`, `agi-employer`, `agi-evidence`, and `agi-recovery`. Preserve existing Orchestrator and Monitor utilities; expose them through bounded local interfaces rather than disguising orchestration as unrestricted authority.

Use the Agent Skills format: `SKILL.md` with valid required metadata, concise activation guidance, progressive disclosure, and appropriate optional scripts/references/assets. Keep Fleet-specific enforceable manifests separately versioned. Validate against the current specification and the exact supported client implementation. Skill format interoperability is not proof of client security compatibility. `allowed-tools` must not be treated as a universal enforcement mechanism. [S1]

Each skill must specify its purpose, prerequisites, accepted inputs, structured outputs, normal workflow, approval boundaries, failure behavior, examples, and local-runtime dependency. It must support a clear missing-runtime explanation without secretly installing software or falling back to an unrestricted host shell.

| Skill | Required behavior | Required restriction |
|---|---|---|
| AGI Agent | Prepare/admit suitable work, execute, preserve Creator/Checker/Reviewer separation, produce evidence, prepare submission | No self-awarded independent approval or compute-held settlement keys |
| AGI Node | Inspect immutable delivered bytes, reproduce appropriate checks, prepare eligible review actions | No alteration of original evidence; reject known conflicts |
| AGI Moderator | Support appointed, eligible dispute processing through existing formal rules | Preserve the current model-veto restriction; no expanded adjudication powers |
| AGI Employer | Scope work, define acceptance criteria, prepare funding and buyer actions | Apply existing signer policy and confirmations to consequential operations |
| AGI Evidence | Inspect and serve evidence within explicit access and retention rules | No settlement signing key or mutation of authoritative source evidence |
| AGI Recovery | Determine eligible deadline-based operations and prepare permitted requests | No bypass of deadlines, beneficiary restrictions, or transaction authorization |

These role boundaries must remain consistent with the existing registry and protocol adapters. Internal model-role labels are not independent economic actors. [R4]

Compose reusable research, code/data, image, browser, desktop, document, and evidence capabilities instead of duplicating full runtimes into six skill folders. Adding a second role must not require downloading another entire installation. Support multiple instances of the same role.

Deliver OpenClaw integration against verified supported versions, plus a documented local CLI/API client contract. At least one skill-capable assistant must demonstrably invoke the real runtime. Other clients may be documented as unqualified until their adapters pass the same relevant gates; do not advertise universal support. An MCP adapter is optional, not a reason to delay a complete primary integration or introduce a second authority path.

## 6. Define and enforce the isolation model

Optimize the initial product for one operator using several roles on one physical machine, with job content treated as untrusted. State that operator control of the host remains a trust assumption. Do not market local profiles as protection against a malicious host administrator or as hostile multi-tenant hosting.

OpenClaw's documented Gateway trust boundary is not a hostile multi-tenant boundary; workspace names and separate agent IDs alone do not establish filesystem or credential isolation. Audit the exact pinned version's tools, session visibility, memory search, agent messaging, cron/hooks, and authentication behavior rather than assuming current defaults apply to older releases. [S2–S3]

Use a trusted local supervisor with policy-bound adapters to established role runtimes. Keep executor processes away from supervisor credentials and management interfaces. Use separate gateway/state/credential contexts where Fleet requires separation; enforce real process, filesystem, account/container/VM boundaries appropriate to each backend. Retain stronger existing boundaries until a replacement passes an explicit equivalence review.

Share only verified read-only installation resources and controlled public caches. Keep actor memory, transcripts, databases, provider sessions, browser profiles, credentials, journals, private caches, budgets, and writable workspaces separate. Deduplication must not expose private artifacts or become a cross-role communication channel.

The simplest default must not recreate six full manual installations. A one-time guided provisioner may establish the necessary accounts and services with separately approved administrative steps; normal work must not require root, administrator privileges, or repeated manual account switching. Do not disable OS security or request blanket full-disk access to simplify setup.

For native desktop execution, retain dedicated OS task-account/session boundaries. Do not put the signer, dashboard approval session, unrelated personal accounts, or other actors' secrets within an executor-controlled desktop. Native `whole-account` authority must be labeled honestly; an application inventory or instruction is not an application sandbox.

Unsupported isolation must result in a blocked run with an actionable explanation—not a warning followed by broader execution.

## 7. Secure the local control surface

Prefer permission-controlled local IPC for privileged role-service communication. Where an authenticated loopback HTTP interface is needed, bind narrowly and enforce exact Host/Origin rules, secure session handling, CSRF protection, strict schemas, request limits, and scoped permissions. Test IPv4/IPv6, WebSocket upgrade paths where present, hostile local pages, and DNS rebinding.

A localhost address is not authentication. A shared network namespace is not separation. No wildcard CORS, bearer tokens in URLs, unauthenticated control routes, automatic LAN exposure, arbitrary URL proxy, or broad host-command endpoint.

Keep GitHub Pages and public/offline Builder pages out of privileged credential custody. Preserve an explicit inspected-file handoff unless the existing reviewed local pairing path can be reused without increasing authority. Any pairing must be initiated locally, clearly show the requester and permissions, expire, and be revocable. A hosted page must not silently obtain or exercise local control.

Bind authenticated clients to actor/action scopes server-side. Reject role spoofing, stale grants, forged actor IDs, replay, cross-profile request substitution, and confused-deputy requests. Never interpolate model-generated strings into shell commands; use typed allowlisted operations and safe argument passing.

## 8. Implement local execution and Computer Use

Provide three clear workspace types: files/code, isolated browser, and isolated desktop. Route work through the existing qualified adapters when possible; preserve existing screenshot/frame guards, read-only input handling, browser restrictions, STOP controls, and cleanup verification. [R5, R7]

Execution must actually occur on the selected local host. Cloud inference may be permitted through approved provider routes, but do not silently execute tools on hosted compute or another machine. Display execution location, inference location, and permitted outbound data separately. A local execution claim is not a local-only data-processing claim.

Verify model availability and tool support through the actual configured account. Keep existing evaluated runtime pins unless a separately justified upgrade is tested. Never guess model IDs, assume subscriptions permit all API routes, reuse unrelated OAuth credentials, or fall back to a different provider/model without authorization. Preserve provider terms and supported authentication flows.

Treat pages, screenshots, documents, tool results, source code, and imported skills as untrusted inputs. They cannot grant authority. Implement runtime-enforced permissions and human control over consequential transmission, purchases, destructive changes, and hard-to-reverse actions, following verified provider guidance. [S4]

Apply declared network policy to all relevant tool paths, including redirects, DNS resolution, subprocesses, browser downloads, WebSockets, IPv6, loopback/private networks, and metadata endpoints. Separate approved model traffic from general tool-network access. Prohibit unsupported privacy modes rather than accepting a `local-only` label that the backend cannot honor.

Support one active controller per desktop session, with an exclusive lease and enforced revocation. Parallel graphical work requires separate verified sessions/environments. Do not let two actors share one live pointer/keyboard surface. Revalidate session/display identity after logout, reboot, sleep, permission changes, or disconnection.

Keep native Mac applications on qualified native Mac backends. Do not present a Linux container on a Mac as native macOS application coverage. Preserve platform-specific native-preview restrictions until separately implemented and qualified.

For the first qualified public-work mode, retain public/licensed/synthetic-input limits. Preserve existing authorized native/private-work previews as separately labeled tracks; do not silently promote them into public settlement or claim new confidential-work qualification. Broader work is an explicit, separately tested expansion—not a forbidden future use and not a launch-time marketing claim.

## 9. Build a durable scheduler and role lifecycle

Support on-demand roles, explicit persistent service mode, several instances of a role, mixed roles, and safe concurrency. Role switching creates a separate execution context; it must not simply change the system prompt in a conversation that contains another role's memory or credentials.

Use instance-specific service identifiers, profiles, endpoints, ports or sockets, and workspace namespaces. Do not reuse fixed per-role endpoints where multiple instances could collide. Existing dedicated-mode settings must continue working.

Measure cold start, idle memory, per-active-role overhead, concurrent throughput, and disk growth on declared targets. Set justified resource budgets before qualification and publish observed results; do not keep six heavyweight engines active when on-demand workers suffice. Avoid adding orchestration components without a demonstrated need.

Implement CPU, memory, process, disk, execution-time, tool/action, model-call, and spending admission limits. Apply platform-appropriate enforcement and display actual support. Queue work rather than silently exceeding limits; explain queue reasons and expected eligibility, without promising completion times that cannot be supported.

Enforce budgets at job, actor, and shared operator/host levels where applicable. Reserve atomically before concurrent work; reconcile observed usage; account for uncertain in-flight requests. Distinguish estimates/reserves from provider-enforced billing caps. A missing invoice is not zero cost. Restarting, cloning, or deleting a workspace must not reset authoritative budgets.

Persist accepted assignments, deadlines, leases, grants, and side-effect intent/results outside disposable execution state. Implement bounded retries and idempotency where supported. When an external action may have happened, require reconciliation rather than automatically repeating it. Do not promise universal exactly-once effects across arbitrary applications.

Provide separate controls for pausing intake, draining accepted work, immediate actor STOP, and host-wide STOP. Clearly show outstanding obligations. Emergency STOP revokes further work, attempts verified cleanup, records uncertain external outcomes, and survives restart. It does not undo completed transactions or external actions. Resume requires fresh readiness and valid authority; it must not auto-replay uncertain operations.

Record sanitized exit status, stderr, backend identity, cleanup attempts, and positive cleanup evidence. Never display “stopped cleanly” solely because a process disappeared.

## 10. Preserve signing, protocol eligibility, and economic safety

Keep wallets and transaction-signing keys outside compute and all role skill packages. A separate signer approves or executes only operations already permitted by the existing signer policy. Reuse transaction construction, chain/contract checks, eligibility, deadlines, beneficiary restrictions, review admission, and recovery semantics rather than creating a second simplified protocol implementation.

A local-only actor may be created without a wallet or protocol enrollment for supported non-economic work. Market participation is a separate explicit setup step requiring actual eligibility. Do not conflate an actor label, host registration, or skill installation with an ENS identity, bond, or protocol role.

Track the selected chain, manager contract, protocol version, actor identity, operation intent, and authorization. Do not copy unrelated repository token settings into AGIJobManager workflows. Verify and preserve the selected integration's actual assets and settlement rules.

Keep transaction nonce/idempotency and budget authority outside rollbackable workspaces. Test rejected, pending, confirmed, failed, and uncertain outcomes using the existing protocol's confirmation/reconciliation semantics. Never convert a local success indicator directly into a transaction or payment claim.

## 11. Separate internal checking from independent review

Implement two visibly distinct outcomes: **Internal check** and **Independent review**.

An operator may run a local checker against their own Agent's output, but it cannot be represented as independent market review. Multiple profiles, wallets, model instances, or machines do not establish separate control.

Record declared operator/control relationships, source actor, job provenance, relevant infrastructure, and conflict decisions. Enforce known conflicts outside model instructions. State the limitations of relationship declarations; do not claim that undeclared common ownership can be inferred reliably. Apply stricter placement rules where protocol/assurance requirements demand them.

For Node work, mount the exact delivered evidence snapshot read-only and provide a separate writable review scratch area. Hash verification proves byte identity, not correctness or independent authorship. Test that internal approval cannot satisfy an independent-review requirement and that unrelated Node work can coexist safely on the same host where permitted.

## 12. Integrate SUCCESSOR Ω without expanding its authority

Reuse the accepted SUCCESSOR Ω + Fleet implementation and AGIJobManager-compatible mission, request, capsule, and evidence contracts. Inspect concurrent changes before editing. Preserve the free browser-only experience and existing hosted/offline behavior. [R3]

Deliver this complete journey:

```text
Builder mission
→ inspect proposed work and required capabilities
→ choose an actor and compatible local workspace
→ explicitly authorize exact execution
→ local work and evidence capture
→ separately authorize eligible review
→ inspect checked candidate
→ explicitly choose whether to adopt that version
→ export, restore offline, and rerun where supported
```

Importing a capsule, installing a skill, checking a candidate, adopting a version, and authorizing a run are different operations. None implies the others. Restore must grant no renewed authority and inherit no destination qualification.

Keep incumbents until explicit selection succeeds. Preserve rejection, comparison, rollback, and exact-file validation paths. Imported/generated code is inert until an appropriate execution grant exists; never execute it during inspection, preview, or import. Do not make candidate improvements silently update role instructions, permissions, budgets, or runtime policies.

Offline restore and deterministic examples must work without network access. Do not promise byte-identical generative model outputs for live stochastic reruns. Preserve manifests and verify deterministic artifacts where reproducibility is actually defined.

## 13. Implement safe portability, backup, and activation

Provide separate exports for portable role configuration, permitted project/evidence data, and operator-managed secret recovery. The ordinary portable package must exclude wallets, seed phrases, OAuth/refresh tokens, cookies, session credentials, host-control tokens, and private signer material. Exported records default to no execution authority.

Validate schemas, source/package identity, file count/size limits, normalized paths, links, Unicode/platform path collisions, and archive expansion before extraction. Prevent traversal, symlink/hardlink escape, archive bombs, and executable import hooks. Do not follow arbitrary external references during import. Integrity hashes do not establish publisher authenticity by themselves.

Checkpoint/quiesce databases before consistent export. Handle SQLite and other runtime state through supported snapshot mechanisms; do not copy active databases plus WAL/SHM files casually or impose rigid assumptions that conflict with legitimate runtime schema evolution. Separate portable business state from disposable, host-bound engine state.

Destination activation must verify platform compatibility, re-establish credentials through supported flows, create fresh host bindings, rerun readiness, and require new authorization. A Mac-dependent task must not silently move to Linux. Backup exclusions must be explicit; provide a separate export route for large work products.

For managed authoritative operations, use fenced activation/lease generations checked by the authority/signer path, with rollback protection outside exported workspace state. A local lock alone does not prevent two restored machines acting concurrently. If exclusive activation cannot be established, restored actors remain non-authoritative for consequential actions until reconciliation. Offline inspection and permitted non-economic local work must remain useful. Document the trust limits: this is not protection against a malicious owner deliberately reusing raw keys outside Fleet.

## 14. Deliver an excellent local dashboard and onboarding

Present two prominent choices: **Local Skills** and **Dedicated Fleet**. Explain both in plain English and French. Preserve the existing visual identity and navigation; make the new mode attractive without turning the interface into an intimidating control panel.

The guided path is: choose a goal, check this computer, add a role, choose a workspace, connect an approved model route, review permissions/limits, run a safe example, inspect the real deliverable, and learn STOP/recovery.

Use a usable default and an advanced view. Ordinary users should not need to learn ports, container flags, service names, or cryptographic digest formats to finish the happy path. Explain one-time platform/account prerequisites separately from routine use. Exploration and the non-economic example must not require a funded wallet or protocol enrollment; paid inference remains explicit.

Every actor/task view must show identity, role, execution host, workspace scope, data egress, selected provider/model, budget status, current phase, outstanding obligations, evidence, and actionable errors. Include “Why is this blocked?”, “View output,” “Pause new work,” and clearly distinguished STOP controls.

Target WCAG 2.2 AA with automated and manual checks: keyboard operation, visible focus, semantic labels, screen-reader status, zoom/reflow, contrast, reduced motion, and no color-only status. Prefer at least 44-by-44 CSS-pixel primary controls as a product usability target; do not misstate that as the universal AA minimum. Verify English/French long-text layouts and accessible confirmation dialogs. [S5]

Do not store operational secrets in public-site browser storage, URLs, exported examples, screenshots, analytics, or support bundles. Support bundles must be reviewable and redacted. No automatic telemetry or public uploads.

## 15. Install, update, diagnose, and uninstall safely

Provide one documented local runtime installation per host, lightweight role additions, and a guided way to create additional actors. Runtime provisioning and role activation are separate actions. Installation must not enable paid work, start native desktop control, or enroll startup services without explicit consent.

Support the repository's declared Linux x86-64/ARM64 and Apple silicon macOS targets through platform-specific implementations and evidence. Report unsupported systems honestly; do not advertise Windows support through an untested script.

Preflight must check actual OS/account/backend capability, resources, service reachability, policy identity, provider-route support, and required desktop permissions. Report separately what was statically inspected, operationally observed, and physically qualified. A diagnostic must not perform paid inference or consequential actions without consent.

Use transactional installation/update: stage, verify, validate, switch, and recover safely. Preserve current role data, active obligations, and known-good versions. Updates require fresh bindings/authorization when security-relevant content changes. Do not roll back authoritative budgets, revocations, or action receipts when rolling back software.

Uninstall removes only owned installation resources after explaining active responsibilities and backup choices. It must not delete user deliverables, wallets, unrelated accounts, other OpenClaw installations, or shared dependencies still in use. No broad filesystem cleanup commands.

## 16. Keep the codebase coherent

Prefer the existing language, dependency strategy, packaging conventions, and shared-runtime organization. Add a modular local-mode facade with small platform adapters; do not build a new microservice ecosystem, duplicate the settlement stack, or refactor unrelated subsystems.

An illustrative organization is below. Adapt it to the actual tree and keep authoritative business/security logic shared.

```text
role-skills/<role>/SKILL.md
role-skills/<role>/references/
local-runtime/schemas/
local-runtime/supervisor/
local-runtime/platforms/
local-runtime/cli/
local-dashboard/
docs/local-skills/
```

Private profiles, credentials, workspaces, live databases, and logs belong in protected application-state locations outside the source checkout—not committed under these directories.

Publish stable, versioned schemas and a typed local-client contract. The CLI and dashboard must call the same validation/authorization path. Define status, inspect, prepare, authorize, run, cancel, stop, resume, export, import, activate, and doctor operations with clear permissions and errors. Their names are proposed interface requirements, not claims that commands already exist.

Keep skill installation non-executing by default; inspect code-bearing packages before activation. Bind package/runtime identities in evidence, preserve license notices, and maintain lockfiles and an SBOM. No unreviewed remote installer execution, global skill injection, or automatic third-party skill downloads during a job.

## 17. Mandatory acceptance matrix

Create an executable requirement-to-test matrix. Every mandatory row must have exact commands, fixtures, expected assertions, actual results, and evidence locations. Synthetic tests, real local integration, live provider trials, physical commissioning, and human usability are separate evidence classes.

| ID | Required acceptance case |
|---|---|
| A01 | Fresh local install completes without a prior Fleet/OpenClaw profile, wallet history, or migration fixture. |
| A02 | Existing Dedicated Fleet installs and workflows pass before and after local-mode installation; new-mode removal does not damage them. |
| A03 | All six skills validate; each role executes its real bounded workflow; two instances of one role do not collide. |
| A04 | A supported assistant invokes the real local runtime through its skill, returns actual artifacts, and cannot escalate its client scope. |
| A05 | One host runs an Agent task and unrelated Node review with isolated state, credentials, inputs, outputs, and authorization. |
| A06 | Cross-role filesystem, memory, transcript, credential, browser, IPC, and runtime-management access attempts are denied. |
| A07 | Role spoofing, forged/stale/expired/revoked grants, request substitution, replay, and prompt-injection escalation are refused. |
| A08 | Concurrent runs cannot overspend shared admission limits or exceed enforced resources; restart does not reset limits. |
| A09 | Local files/code, browser, and desktop examples produce reopened, verified deliverables on each advertised backend. |
| A10 | Competing actors cannot control the same desktop; changed/suspended/rebooted sessions require renewed validation. |
| A11 | STOP, cancellation, timeout, killed processes, disk-full states, provider failure, and incomplete cleanup fail safely and expose evidence. |
| A12 | Crash/restart around side effects, grant reservation, output commit, and signer requests does not blindly repeat uncertain actions. |
| A13 | Internal checking cannot satisfy independent-review requirements; known actor-control conflicts are rejected. |
| A14 | Review cannot mutate submitted original bytes; reports and scratch files remain writable only in permitted locations. |
| A15 | Export contains no forbidden secrets; hostile archives, source drift, snapshot races, and duplicate activation are handled safely. |
| A16 | Restoring on a second compatible host preserves approved portable data, creates fresh bindings, and does not restore authority. |
| A17 | SUCCESSOR Ω completes execution → separately authorized review → unselected checked candidate → explicit choice → offline restore/replay. |
| A18 | Existing protocol integration tests pass through local-mode adapters without changing contracts or using live funds. |
| A19 | Loopback/IPC authentication, browser-origin defenses, private-network restrictions, and private-data export controls resist negative tests. |
| A20 | EN/FR onboarding, keyboard/screen-reader paths, zoom/reflow, failure recovery, and both deployment modes pass functional/accessibility checks. |
| A21 | Exact downloadable artifacts install and run the exercised paths; manifests, licenses, hashes, inventories, and executable modes verify. |
| A22 | Fresh install, coexistence, sleep/reboot, recovery, local inference connectivity where applicable, and endurance are separately exercised on declared physical targets. |

Cover every role's allowed and forbidden actions, not just Agent/Node happy paths. Include property/fuzz testing for hostile schemas/imports and concurrency/fault injection for state transitions. Verify genuine OS effects for isolation tests; a mocked policy return value is not proof of enforcement.

Retain the full existing regression and platform matrices. Every failed, skipped, unavailable, or not-run gate must remain visible. No renamed tests, deleted negative cases, loosened assertions, or reduced scope to manufacture green CI. Fix root causes and add regression tests.

## 18. Deliver demonstrations users can actually use

Ship small public/synthetic examples with real editable inputs and useful outputs: a document/report job, a code/data job with tests, and a browser/desktop job with visual verification. Include independent review of unrelated work and the separate local internal-check example.

Provide a SUCCESSOR Ω example that produces a portable checked candidate and demonstrates explicit selection, retained incumbent, offline restoration, and rerun semantics. At least one candidate must be rejected so the safety/recovery path is visible.

Keep simulated-provider demonstrations clearly labeled. They must exercise the real orchestration path, not a disconnected animation. Live-provider runs require approved credentials and bounded spending; their absence is not permission to fabricate results. Measure successful results across attempts, intervention, latency, resource use, and observed/reserved cost. Do not claim coverage of most occupations or guaranteed earnings from a few examples.

## 19. Documentation and public presentation

Update the README, website, guided onboarding, installation help, troubleshooting, recovery, and release notes to feature both modes. Retain all existing diagrams and routes; add architecture/trust-boundary diagrams with accessible text equivalents.

Document skill installation versus runtime installation; actor versus role versus host; local execution versus inference; public versus native/private tracks; internal versus independent review; safe desktop use; credentials; backup/restore; active assignment obligations; STOP limitations; upgrade/uninstall; and diagnostic interpretation.

Provide an example-led developer guide, manifest/schema reference, client integration guide, compatibility matrix, threat model, release qualification matrix, and concise FAQ. Keep EN/FR operator guidance consistent. All example commands and links must be tested against the artifacts they describe.

Product language may communicate broad ambition. Any approximately US$40 trillion annual opportunity statement must remain an explicitly attributed strategic estimate, not a verified market measurement, demonstrated automation rate, revenue forecast, or qualification claim. Do not market this implementation as AGI/ASI proof or unlimited autonomous authority.

## 20. Delivery sequence and engineering ownership

Use small reviewable PRs or a clearly reviewed stack with these cumulative milestones:

**Foundation:** baseline/preservation reports, threat model, versioned contracts, lightweight six-role packages, and adapters to existing runtime behavior.

**Working local mode:** real provisioning, actor services, isolation, scheduling, authority, local-client integration, dashboard, and all six role paths.

**Portability and Builder:** safe export/restore/activation, SUCCESSOR Ω integration, usable examples, and recovery flows.

**Qualification and publication:** full compatibility/security/platform testing, exact-archive testing, documentation, evidence audit, and release.

These are implementation milestones, not permission to declare the entire product finished after the first. Keep unqualified capabilities visibly disabled. Assign explicit ownership for code, threat-model review, protocol review, platform commissioning, accessibility, and release evidence. Record genuine reviewer identity where available; do not describe several model personas as independent human reviewers.

## 21. Version and publish correctly

Keep one repository and use its release governance. Determine version numbers from actual compatibility, existing platform tracks, and concurrent work. A substantial additive feature does not automatically require a SemVer major bump: backward-compatible functionality ordinarily warrants a minor; a major requires an actual incompatible public contract. Document any product/version-train change separately. Do not reuse PR #25's planned tag or overwrite its release assets. [S6]

Keep skill-package versions, local-runtime versions, schema versions, and platform bundles explicit in a compatibility manifest. Do not freeze Linux and Mac historical release lines or imply that a new generic tag qualifies every platform.

Build release artifacts from reviewed exact source. Test the exact saved installer/package bytes that will be uploaded, including extracted executables, role installation, actual local-mode startup, representative workflows, restore, and website/offline exports. Retain source/workflow identity, platform details, dependency/SBOM data, logs, hashes, manifests, and test-class labels. Where deterministic rebuilds are required, verify them instead of asserting them.

Every supplied release asset and archive member must remain below **450,000,000 bytes**, preserving the repository's current packaging constraint. Use verified reusable components and documented offline assembly when needed; do not hide an oversized requirement or provide an unusable fragment as the installer. Keep dependencies and external image requirements explicit. [R8]

Complete every required check on the exact final PR head and integrated source used for publication. Resolve substantive review findings. Merge through the normal reviewed process; do not bypass failing or pending checks, even when branch protection is absent. A new commit invalidates prior final-head evidence for affected gates. Recheck the merge result and build/publication provenance.

Use one coordinated release workflow. Do not cancel existing qualification runs, launch duplicate publishers, edit historical results, force-push shared release history, reuse tags, replace differing assets, or publish a source archive as if it were a qualified installer.

Publish a clearly labeled **qualification prerelease** only when its declared automated/native gates genuinely pass. Stable/production claims require the actual additional commissioning, security, provider, independent-operation, signing/notarization, and endurance gates applicable to that platform and mode. Missing physical or credential-dependent tests remain `NOT_RUN`; funded work stays disabled where required. Package provenance, OS application signing, notarization, and task-execution qualification are distinct claims.

After upload, verify the remote tag target, release state, asset bytes/digests, download links, manifests, and website links. Confirm that users receive the tested artifacts. If permissions or required evidence prevent a merge or publication, deliver the reviewed implementation and exact blocker; do not claim the operation occurred.

## 22. Final completion report

Return a concise operator summary followed by an auditable evidence table covering the implemented behavior, PRs, final heads and merge SHAs, release tag and source/producer identities, artifact names/sizes/hashes, final CI/native/browser/integration evidence, physical results, preserved workflows, actual supported platforms/clients, and known limitations.

Include a beginner's “start here” path that works with the published artifacts, a compatibility and preservation report, a requirement-to-test matrix, release-manifest location, rollback/recovery instructions, and the status of each unmet gate with its practical effect.

Do not end with a vague “production-ready,” “all tests pass,” “fully independent,” “everything is local,” or “10/10” claim. State precisely what was implemented and observed.

The finished product must demonstrate this outcome:

> A user installs one local Fleet runtime, adds multiple portable role profiles, performs useful local work, keeps role state and authority separate, reviews outputs honestly, and restores permitted portable state on another compatible host—without breaking Dedicated Fleet or weakening signer, review, STOP, and release controls.

---

## Reference anchors and verification notes

These sources informed the handoff. Re-read current versions before implementation, and verify behavior against the actual pinned release rather than assuming documentation for a newer version applies. Proposed requirements above are engineering instructions, not claims that the feature already exists.

[R1] Default branch inspection anchor:
https://github.com/MontrealAI/AGI-Fleet-Linux/tree/22eba990dbaa0083c7c6f21a0638bf546d0d47ed

[R2] Concurrent SUCCESSOR Ω + Fleet PR, observed open during preparation:
https://github.com/MontrealAI/AGI-Fleet-Linux/pull/25

[R3] PR #25 architecture, inspected head:
https://github.com/MontrealAI/AGI-Fleet-Linux/blob/837716c0e5690d67180ca106c763e5f3eadb6638/successor/docs/ARCHITECTURE.md

[R4] Six-role registry and skill mapping:
https://github.com/MontrealAI/AGI-Fleet-Linux/blob/22eba990dbaa0083c7c6f21a0638bf546d0d47ed/fleet/shared/runtime/compute/role-registry.json
https://github.com/MontrealAI/AGI-Fleet-Linux/blob/22eba990dbaa0083c7c6f21a0638bf546d0d47ed/fleet/shared/runtime/compute/roles.mjs

[R5] Existing policy binding and desktop skill:
https://github.com/MontrealAI/AGI-Fleet-Linux/blob/22eba990dbaa0083c7c6f21a0638bf546d0d47ed/fleet/shared/runtime/compute/policy.mjs
https://github.com/MontrealAI/AGI-Fleet-Linux/blob/22eba990dbaa0083c7c6f21a0638bf546d0d47ed/fleet/packages/AGI_Agent/compute/skills/agi-desktop-work/SKILL.md

[R6] Shared-runtime development, packaging, and qualification:
https://github.com/MontrealAI/AGI-Fleet-Linux/blob/22eba990dbaa0083c7c6f21a0638bf546d0d47ed/docs/DEVELOPMENT.md

[R7] Native-workstation permissions and limitations:
https://github.com/MontrealAI/AGI-Fleet-Linux/blob/22eba990dbaa0083c7c6f21a0638bf546d0d47ed/workstation/QUICKSTART.md

[R8] Repository README and published qualification scope:
https://github.com/MontrealAI/AGI-Fleet-Linux/blob/22eba990dbaa0083c7c6f21a0638bf546d0d47ed/README.md

[S1] Agent Skills specification:
https://agentskills.io/specification

[S2] OpenClaw security/trust boundary:
https://docs.openclaw.ai/gateway/security

[S3] OpenClaw multi-agent routing and workspace semantics:
https://docs.openclaw.ai/concepts/multi-agent
https://docs.openclaw.ai/concepts/agent-workspace

[S4] OpenAI computer-use guidance:
https://developers.openai.com/api/docs/guides/tools-computer-use

[S5] WCAG 2.2:
https://www.w3.org/TR/WCAG22/

[S6] Semantic Versioning 2.0.0:
https://semver.org/
