# Physical Mac qualification

**Begin every physical gate at `NOT_RUN`.** A build, checksum, native CI run or another machine's result does not prove this exact Mac installation works. Record M1 and M2 separately, and record each role's actual result.

Use [Fresh Mac setup](FRESH_INSTALL.md) with genuinely new Standard signer and compute accounts. Preserve old incident accounts and reports. Do not erase a machine or remove safety stops to manufacture a fresh result.

## Identify the exact candidate

Record the release and source hashes, ZIP filename, physical chip/model, RAM, macOS, native Node architecture/version, OpenClaw version, Docker Desktop/Engine versions, VM memory, free storage, account separation, power/sleep settings, role and approved policy/limits. Keep identifying account details private; publish reviewed, sanitized observations only.

Record any pre-existing system or Homebrew Node installation and any runtime warning during readiness checks. Hosted CI temporarily provisions and restores a pinned system Node for its isolated tests; that does not qualify an operator's existing Node configuration. Do not apply the CI provisioning procedure to an operator Mac or dismiss a readiness warning.

The release provides `qualification/macos-clean-install.mjs` for evidence completeness and file-integrity checking. Its result does not prove that observations are true, approve production, clear STOP or grant financial authority. Follow the shipped qualification template and keep evidence paths within its private evidence folder.

## Record the result of each gate

| Gate | Evidence required | Initial result |
| --- | --- | --- |
| Fresh installation | Exact current archive; native arm64 M1/M2; macOS 15+; new separated Standard accounts; `Install.command` only; no retry or developer intervention; authenticated readiness and complete transaction | NOT_RUN |
| Docker isolation | Correct per-user context and ownership; enforced CPU, memory and process limits; intended containers only | NOT_RUN |
| Real provider access | Actual role-specific sign-in and bounded inference; approved model and limits; cost/usage observations; no signer secrets in compute | NOT_RUN |
| Useful live documents | Original usable files; contents opened and inspected; Agent work and independent Node review recorded separately | NOT_RUN |
| Base and browser cleanup | Positive removal confirmation after live work for both sandbox kinds; no leftover containers; observer/workspace finalization; no unexplained STOP | NOT_RUN |
| Stop and recovery | New work stops; identity and evidence survive; only reviewed recovery can resume; failed attempts remain recorded | NOT_RUN |
| Reboot and identity | Physical reboot, FileVault/login behavior, Docker startup and unchanged approved identity; no duplicate service or silent reapproval | NOT_RUN |
| Screen Sharing and Safari | Actual attached/disconnected sessions and browser permissions observed; no inference from a command-line runner | NOT_RUN |
| 72-hour endurance | At least 259,200 uninterrupted active seconds observed, with timestamps, workload, failures, resource use and operator minutes | NOT_RUN |
| Job integration | Exact supported contract/configuration verified; full role interaction rehearsed; public inputs and intended deadlines/limits honored | NOT_RUN |
| Independent review | Reviewer under separate control examines actual evidence and original outputs; disagreement/abstention preserved | NOT_RUN |
| Distribution | Exact downloaded/extracted archive; signature/notarization status, normal macOS approval flow and usable offline instructions recorded | NOT_RUN |

Do not relabel a failed or retried attempt as a one-shot pass. A sleep gap, reboot or outage breaks an uninterrupted endurance period; start a new measured period while retaining the interruption evidence.

## Exercise all six roles

| Role | Its own acceptance evidence |
| --- | --- |
| Agent | Creates useful public documents/code using the intended tools; actual output inspected; checks and cleanup observed. |
| Node | Independently examines original inputs and delivered bytes; records useful review and abstains when evidence is insufficient. |
| Moderator | Only appointed, conflict-free dispute scope; formal checks remain authoritative; model may veto; uncertainty escalates safely. |
| Employer | Only its scoped jobs; acceptance/dispute/funding authority stays inside reviewed signer limits. |
| Evidence | Read-only evidence observations; no signing key, wallet funding or settlement authority. |
| Recovery | Only scoped expiry/finalization/refund/claim actions after protocol deadlines; no wallet-recovery or unrestricted fund movement. |

The auxiliary roles have no desktop tools. Their formal-role tests cannot stand in for Agent/Node workstation tests, and workstation results cannot stand in for their contract behavior.

## Local workstation repetition

After the current desktop setup has prepared its exact image, a technical helper can run the packaged local utility from the Fleet folder:

```sh
bash ./Qualify-Mac.command --role agent --scenario warm-docker --runs 50 --out "$HOME/AGI-Mac-agent-warm-01"
```

Use `node` for a separate Node run. The output folder must not already exist. The tool checks the dedicated Standard Apple silicon account, current package/image, bounded disposable desktop and 50 repetitions. Its report labels the scenario as **operator-supplied**, not automatically proven.

Repeat and record the relevant actual scenarios: `cold-docker`, `warm-docker`, `after-login`, `after-reboot`, `cached-image`, `fresh-image`, `cold-start`, `repeated-run`, `screen-sharing-attached` and `screen-sharing-disconnected`. Prepare each real situation before assigning its label. Never delete shared images or existing containers merely to simulate a fresh state.

These repetitions do not call a live provider, access a wallet or make a payment. They cannot qualify Safari, FileVault, independent reviewers, provider billing or live OpenClaw post-work cleanup. Record those observations separately.

## Later financial and native-workforce checks

Keep funded work disabled during engineering installation qualification. Later end-to-end settlement requires a separately reviewed exact deployment, deliberately authorized capped funds, independent participants, accepted evidence and reconciled journals. Do not infer authorization from a contract address, this checklist or a passing automated gate.

The included native macOS workforce is a separate controlled pilot. Its Screen Recording/Accessibility permissions, account scope, signed task grants, real provider pairing, encrypted delivery, independent review and production qualification must each be observed. Containerized document success does not prove native desktop control.

Keep `productionQualified: false` until the substantive operating decision is separately justified. Even a mechanically complete evidence record remains subject to review; no qualification utility changes this flag into runtime authority.
