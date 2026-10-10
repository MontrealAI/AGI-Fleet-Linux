export const explanations = {
  COMPUTE_DAILY_LIMIT: ["Compute daily allowance exhausted", "The separate compute service refused another run. Its reset time is not reported by this protocol. Inspect the existing compute status and wait for capacity; the signer limit cannot raise compute authority."],
  COMPUTE_IMAGE_DAILY_LIMIT: ["Compute image allowance exhausted", "The separate compute service refused another image request. Its reset time is not reported by this protocol. No provider or billable usage is inferred from this local refusal."],
  COMPUTE_BUSY: ["Compute already has a request in progress", "Wait for that request's recorded outcome or inspect its cleanup state before retrying."],
  COMPUTE_CLI_TIMEOUT: ["The compute command timed out", "Inspect the bounded command evidence and cleanup state. A timeout does not establish provider usage or successful work."],
  COMPANION_COMPUTE_APPROVAL_EXPIRED: ["This identity review expired", "Inspect the authenticated identity again, compare the changes and approve the new proposal."],
  COMPANION_STATE_CONFLICT: ["A newer application state was saved", "No stale approval was accepted. Close duplicate instances, reopen this application and review its persisted status."],
  COMPANION_APPROVAL_HISTORY_FULL: ["Approval history needs reviewed archival", "Preserve the existing audit history and export support evidence. Approval remains blocked until archival is verified."],
  COMPANION_APPROVAL_RECONCILIATION_REQUIRED: ["Approval persistence needs reconciliation", "A state write was interrupted or its durability could not be confirmed. Preserve application state and export evidence. Do not delete the pending marker or edit the binding; this release does not automate reconciliation."],
  PUBLIC_WEB_COMMISSIONING_FIXTURE: ["Use the fixed browser commissioning task", "This test accepts only the built-in public fixture. Keep arbitrary tasks in their supported job workflow."],
  PUBLIC_WEB_COMMISSIONING_DELIVERY: ["The browser test did not produce the required evidence", "Inspect the test report and compute diagnostics. A model reply without the expected artifact and recorded browser use cannot pass commissioning."],
  PUBLIC_WEB_CLEANUP_FAILED: ["The protected browser needs cleanup", "Stop new work. In the compute account, inspect the recorded session and recover its scoped cleanup before resuming. Keep the STOP marker, wallet and journals."],
  PUBLIC_WEB_AUTHORITY_INVALID: ["Browser approval key needs attention", "Keep this profile and its encrypted backup. Restore a known-good backup or inspect the damaged authority; do not reset the wallet or replace a pinned key to bypass this check."],
  PUBLIC_WEB_ADMISSION_INVALID: ["Browser access needs a verified task", "Use the supported job workflow with the exact accepted specification and its current admission record. A prompt alone cannot authorize browser access."],
  PUBLIC_WEB_ACCEPTED_SPEC_CHANGED: ["The task no longer matches its accepted specification", "Retrieve and verify the exact accepted specification. Keep the current job pending; changing its website permissions requires a new agreement."],
  PUBLIC_WEB_SETTLEMENT_CHANGED: ["The job terms no longer match the admission record", "Stop this attempt and reconcile the current job and settlement record before issuing another browser approval."],
  PUBLIC_WEB_JOB_INVALID: ["The browser request has no valid job binding", "Check the job identity and its admission record. Use the separate commissioning workflow for a synthetic test."],
  PUBLIC_WEB_PURPOSE_INVALID: ["This browser approval is for a different workflow", "Commissioning approval cannot authorize paid work. Start the correct workflow with a fresh, scoped approval."],
  PUBLIC_WEB_ISSUANCE_INVALID: ["Browser approval could not be verified", "Preserve the failure report. Check the signer authority, approved runtime and job binding before a new attempt."],
  PUBLIC_WEB_BINDING_INVALID: ["The browser session does not match its approval", "Stop the affected session and confirm cleanup. A fresh session needs a new approval for its exact runtime and containers."],
  PUBLIC_WEB_PREPARATION_INVALID: ["The protected browser could not be prepared", "Inspect the compute report and complete any required cleanup before trying a new session. Keep the existing wallet and profile."],
  PUBLIC_WEB_PREPARATION_CHANGED: ["The prepared browser changed during approval", "Stop the affected session and confirm cleanup. Review the compute identity before preparing a new browser."],
  PUBLIC_WEB_POLICY_INVALID: ["The browser policy needs a reviewed repair", "Run Inspect.sh in compute and preserve the failure for engineering reconciliation. Do not edit the policy hash or remove STOP."],
  PUBLIC_WEB_COMMISSIONING_APPROVAL_REQUIRED: ["A browser commissioning test needs explicit approval", "Use the dedicated commissioning workflow and review its provider allowance and local-runtime use. This test does not authorize paid work."],
  PUBLIC_WEB_SCOPE_REQUIRED: ["This task needs exact website permissions", "Use a supported specification listing the required public hostnames and ports for each role. An already accepted specification must not be silently changed."],
  COMPANION_COMPUTE_APPROVAL_INVALID: ["Review the current compute identity", "Open After a compute update, inspect the proposed identity and explicitly approve that exact identity."],
  COMPANION_COMPUTE_APPROVAL_CHANGED: ["The compute identity changed during review", "No new identity was approved. Inspect the stopped compute installation and review its current identity again."],
  COMPANION_ACTIVE_WORK_IDENTITY_LOCKED: ["Finish existing work before changing compute", "Preserve the current runtime and journal. Complete or reconcile accepted jobs, prepared work, open admissions and pending transactions, then review the update."],
  COMPUTE_POLICY_MIGRATION_REQUIRED: ["The compute policy needs a reviewed migration", "Preserve this profile and OAuth stores. This Linux edition requires a fresh deployment after engineering review; do not migrate or edit the state."],
  COMPUTE_SETUP_PENDING: ["Compute setup is incomplete", "Preserve the interrupted attempt and its sanitized support report for engineering review. No work can run against a partial setup."],
  COMPUTE_SETTINGS_CHANGED: ["Compute settings changed after approval", "Stop and inspect the separate compute installation. Review an authorized repair instead of resetting its policy hash."],
  COMPUTE_PUBLIC_WEB_NOT_QUALIFIED: ["Public browser access is not qualified", "This task needs an enforced public-web boundary and successful DNS/browser checks. Keep it pending or use an explicitly offline task; a hostname exception is not sufficient."],
  COMPUTE_LEGACY_SCOPE_REQUIRED: ["This task needs an explicit capability scope", "Use a current computer-work/v2 brief with the required capabilities, public inputs and runtime identity. Existing signed job specifications cannot be silently rewritten."],
  VERIFY_DOWNLOADED_BACKUP_FIRST: ["Verify the downloaded file first", "Select the actual encrypted backup, enter its password and complete verification before acknowledging off-machine storage."],
  BACKUP_PROFILE_MISMATCH: ["This backup belongs to a different profile", "Open the original profile or select its current backup. This verification did not change any application files."],
  BACKUP_INTEGRITY: ["The backup failed integrity checks", "Keep the original file. Download a fresh backup from the intact profile or use a known-good protected copy."],
  RESTORE_WALLET_PROFILE_MISMATCH: ["This backup belongs to a different wallet", "Your current wallet and files were kept. Select a backup for this wallet, or use a separate empty profile to recover the other wallet."],
  BACKUP_WALLET_MISMATCH: ["The backup wallet does not match", "Check the full public address and choose the correct role/profile backup. No restore was performed."],
  BACKUP_ROLE: ["This backup belongs to another role", "Use the correct Agent, Node or Fleet-role application."],
  UPGRADE_WALLET_MISMATCH: ["The wallet differs from this profile\u2019s recorded identity", "Stop and preserve the whole profile. Reopen the original profile and compare its independently recorded public address."],

  RECOVERY_PHRASE_INVALID: ["Check the recovery words", "Use a valid 12- or 24-word English BIP-39 phrase in the correct order. No wallet was imported."],
  RECOVERY_WORD_COUNT: ["Choose 12 or 24 words", "The default is a 24-word English BIP-39 recovery phrase."],
  RECOVERY_EXPECTED_ADDRESS_REQUIRED: ["Enter the original public address", "Use the expected Ethereum address so recovery can verify the correct phrase, passphrase and derivation path."],
  RECOVERY_ADDRESS_MISMATCH: ["The recovered address does not match", "Check the original words, optional BIP-39 passphrase and derivation path. No wallet was imported."],
  RECOVERY_PATH_INVALID: ["Check the Ethereum derivation path", "Use m/44'/60'/0'/0/0 unless your original wallet used a different account or address index."],
  RECOVERY_PASSPHRASE_INVALID: ["Check the optional BIP-39 passphrase", "It must be text of at most 1024 characters. It is different from the vault password."],
  RECOVERY_PHRASE_UNAVAILABLE: ["This wallet has no saved recovery phrase", "Keep its encrypted Agent backup and password. To create a new seed wallet, use Launch.sh in the extracted folder."],
  RECOVERY_CONFIRMATION_REQUIRED: ["Verify your recovery copy first", "Open Secure setup, show the phrase with your vault password, write it down offline and complete the word check."],
  RECOVERY_CHALLENGE_EXPIRED: ["The recovery check expired", "Reveal the recovery phrase again with your vault password to start a fresh check."],
  RECOVERY_WORDS_INCORRECT: ["The recovery words did not match", "Check the numbered words on your offline copy. Reveal the phrase again to restart."],
  RECOVERY_PASSPHRASE_INCORRECT: ["The extra recovery passphrase did not match", "Use the original BIP-39 passphrase, including spaces and capitalization. Reveal the phrase again to restart."],
  RECOVERY_HISTORY_ACKNOWLEDGEMENT: ["Confirm the recovery boundary", "The phrase recovers wallet access. An Agent that has already signed needs its complete encrypted backup and journal before live operation."],
  RECOVERY_RECORD_INVALID: ["Wallet recovery data needs attention", "Stop here and preserve the data folder. Restore a known-good encrypted backup in a separate stopped environment."],
  RECOVERY_RECORD_MISMATCH: ["Wallet and recovery data disagree", "Stop here and preserve the data folder. Do not fund or activate this profile. Restore a known-good encrypted backup."],

  WALLET_ALREADY_RUNNING: ["This wallet already has a running service", "Stop the other Agent, Node or fleet service using this wallet under this OS account. Keep one authoritative transaction journal and use distinct wallets on different computers."],
  LEASE_UNAVAILABLE: ["The wallet lock could not be acquired", "Check local storage and permissions. Do not remove a lease database while a service may be running."],
  SERVICE_STOPPING: ["The service is stopping", "No new transaction will be broadcast by this stopped worker. A transaction already sent can still execute; use observation to reconcile its receipt."],
  COMPANION_COMPUTE_UPGRADE_REQUIRED: ["Update the separate work computer", "This compute service does not advertise revision support. Stop it, install this edition's compute service under the separate account, restart it and test the connection. Your original files are retained."],
  COMPUTER_REVISION_NOT_ACTIONABLE: ["This review needs investigation", "Revision requires a safe review with concrete failures. An uncertain, unsafe or already positive review cannot trigger this repair workflow."],
  STUDIO_REVISION_INVALID: ["Use current, complete revision feedback", "Export Revision feedback from a current failed computer-work review. Keep the original task, actual files and complete criterion evidence together."],
  STUDIO_BUSY: ["A Studio task is in progress", "Wait for it to finish, or use Stop task. Lock & stop remains available. Settings and the job worker cannot change during a Studio run."],
  STUDIO_HISTORY_FULL: ["Your Studio shelf is full", "Download any files and receipts you want to keep, then remove a saved Studio run. Studio files are separate from wallet backups and transaction history."],
  STUDIO_HISTORY_DAMAGED: ["The Studio history needs recovery", "Preserve the work-studio folder and use a complete saved copy. Do not reset the wallet or transaction journal."],
  STUDIO_BRIEF_INVALID: ["Check your work brief", "Choose a task type, a short title, a public task description and the required files. Advanced mode accepts a supported public specification."],
  STUDIO_CRITERIA_REQUIRED: ["Tell the reviewer what success means", "Enter 1–16 concrete acceptance criteria, one per line, up to 500 characters each."],
  STUDIO_OUTPUTS_REQUIRED: ["Choose the files you need", "Enter 1–24 supported relative file names, one per line. Total raw output is limited to 4 MiB."],
  STUDIO_PROFILE_REQUIRED: ["Choose a supported task format", "The Studio supports general computer-work/v2, legacy computer-work/v1 and image-png/v1 public tasks. It cannot silently reinterpret another contract or job format."],
  STUDIO_HANDOFF_INVALID: ["Use an Agent review handoff", "Download the review handoff JSON from the Agent Studio, then choose that complete file in the Node Studio."],
  STUDIO_HANDOFF_HASH: ["The handoff does not match its recorded files", "Retrieve the complete handoff again. Changed content is not reviewed as if it were the original delivery."],
  STUDIO_SCOPE_CHANGED: ["The work configuration changed", "Saved files are retained. Review the connection configuration and start a new run; this result cannot count for the changed setup."],
  STUDIO_FILES_UNAVAILABLE: ["This run has no completed files", "Open its status and error details. Declined or interrupted work may not have produced a deliverable."],
  STUDIO_DELIVERY_TOO_LARGE: ["This task exceeds the file budget", "Split the task into smaller independent deliverables. The shared contract job format limits raw output to 4 MiB."],

  COMPUTER_WORK_NOT_ENABLED: ["Computer work needs its own setup", "Connect the separate work desktop, run Create test documents, then enable computer-work jobs with the worker stopped and no active assignments. Save a new backup and reauthorize."],
  COMPUTER_REVIEW_NOT_ENABLED: ["Computer review is not enabled", "Set up the separate review desktop, test document review, and explicitly enable public cloud review and computer-work bundles. Keep your own Agent excluded."],
  LOCAL_COMPUTER_REVIEW_UNSUPPORTED: ["The local text reviewer cannot inspect these files", "This job is abstained. The computer-work profile requires the isolated tool-enabled review workflow; a local text-only reviewer cannot substitute for it."],
  COMPANION_WORKSTATION_REQUIRED: ["Choose the computer-work connection", "Download a new Computer work / Computer review setup kit and run it in the separate compute account. Test the connection before enabling the new job scope."],
  COMPUTER_TEST_FAILED: ["The document test did not pass", "Inspect the separate compute service and installed tools. No job or transaction was created. The desktop and your actual model must pass commissioning before work is enabled."],
  IMAGE_WORK_NOT_ENABLED: ["Image work needs the capable worker", "Connect and test the separate compute account first. With no pending transactions or active Agent assignments, enable shared PNG jobs in Jobs & limits, then save a backup and authorize the new scope."],
  IMAGE_REVIEW_NOT_ENABLED: ["PNG review is not enabled", "Use Node 2.6 with public-data consent, cloud review and the PNG review option. Your own Node must exclude your own Agent."],
  LOCAL_IMAGE_REVIEW_UNSUPPORTED: ["The local text reviewer cannot judge this image", "This job is abstained. Resolve the unsupported local-review requirement explicitly before image commissioning; it is not bypassed automatically."],
  COMPANION_SEPARATE_COMPUTE_USER_REQUIRED: ["Use a separate compute account", "The capable OpenClaw worker must run under a different standard Linux user from the wallet. Follow the Capable work studio guide; do not grant it wallet-file or keyring access."],
  COMPANION_COMPUTE_POLICY_CHANGED: ["Work studio settings changed", "Stop the worker and open After a compute update · review its identity. Compare the proposed identity with the reviewed repair report, then explicitly approve that exact identity. A normal connection test cannot approve a change."],
  COMPANION_COMPUTE_CLEANUP_REQUIRED: ["Work sandbox cleanup needs attention", "Work is stopped because workstation finalization could not be confirmed. Preserve the account, journals and STOP marker. Export a read-only Repair-Compute inventory for the retained cleanup evidence; do not restart or remove STOP to bypass this condition."],
  IMAGE_TEST_FAILED: ["The image test did not pass", "Check the work studio connection and your account's image access. No job or transaction was created."],
  PENDING_TRANSACTION_MUST_BE_RECONCILED_FIRST: [
    "Resolve the pending transaction first",
    "Keep the signed journal and current settings. Check its receipt and investigate any nonce or provider conflict using the recovery guide. Retry settings only when no pending transaction remains. Do not send manual transactions from this dedicated wallet.",
  ],
  SETTLEMENT_BUDGET_SCOPE: [
    "Review the settlement recovery fields",
    "This action only accepts the finalization gas units, per-transaction ETH cap and daily ETH cap, with your acknowledgement. Job rules, bonds, identities and deployment cannot change here.",
  ],
  SETTLEMENT_BUDGET_NO_HISTORY: [
    "Use normal setup limits first",
    "There is no Agent transaction database yet. Set limits in Jobs & limits before accepting work.",
  ],
  SETTLEMENT_BUDGET_NO_CHANGE: [
    "No budget changed",
    "Review a fresh estimate and enter the intended bounded change. Nothing was saved.",
  ],
  SETTLEMENT_BUDGET_HISTORY_LIMIT: [
    "Budget recovery history needs review",
    "The retained recovery log is full. Keep your complete backup and arrange maintenance; do not delete financial history.",
  ],
  FINALIZATION_GAS_UNITS_LIMIT: [
    "Settlement exceeds your finalization gas limit",
    "No transaction was signed. Finalization costs grow with the number of reviewers. Stop the worker and reconcile any pending transaction. Review a fresh estimate including its 20% margin, then use Jobs & limits → Recover an active job’s settlement budget if appropriate. Save a new backup and reauthorize. ETH and daily spending caps still apply; limits never rise automatically.",
  ],
  GAS_UNITS_LIMIT: [
    "This transaction exceeds your gas-unit limit",
    "No transaction was signed. Review the operation and estimate before changing ordinary transaction gas units. The separate finalization limit cannot increase approval, application, submission, claim or vote authority.",
  ],
  TRANSACTION_COST_LIMIT: [
    "This transaction exceeds your ETH cost limit",
    "No transaction was signed. The gas estimate with a 20% margin, multiplied by the maximum fee, exceeds your per-transaction ETH cap. Wait for lower fees or explicitly review the cap. A higher finalization gas-unit limit does not override this budget.",
  ],
  AGENT_IDENTITY_UNVERIFIED: [
    "Agent identity is unverified",
    "Check both RPCs and enroll the exact deployment. No new preparation, publication or job bond approval proceeds without a current verified role authorization.",
  ],
  AGENT_NOT_AUTHORIZED: [
    "Wallet is not authorized as an Agent",
    "Verify the signing wallet, configured label and deployed Agent ENS roots, wrapped-name permissions, resolver, explicit allowlist or valid Agent Merkle proof. Fix or renew the credential; never change the journal.",
  ],

  PILOT_ALREADY_STARTED: [
    "A measurement period is already open",
    "Finish and export it before starting another.",
  ],
  PILOT_START_FIRST: [
    "Start a measurement period first",
    "Open Operations & commissioning, enroll the deployment, and start your Sepolia measurement period.",
  ],
  PILOT_ENROLL_FIRST: [
    "Enroll the deployment first",
    "Add the real manager address and creation block, then verify enrollment. The notebook does not invent deployment data.",
  ],
  PILOT_SCOPE_CHANGED: [
    "Settings changed during this period",
    "Finish and export the old period. Start a new period for this software and configuration. No commissioning check is automatically passed.",
  ],
  PILOT_HISTORY_LIMIT: [
    "The pilot notebook is full",
    "Export the report and follow PILOT_MEASUREMENT.html to archive the notebook. Signing and its journal are separate; never delete the transaction journal.",
  ],
  PILOT_HISTORY_DAMAGED: [
    "The pilot notebook cannot be read",
    "Preserve pilot.json and recover a saved copy. Do not change the wallet or transaction journal to fix a report.",
  ],
  PILOT_CLOCK_CHANGED: [
    "The clock moved backwards",
    "Correct system time before recording or finishing this period.",
  ],
  PILOT_LABEL_REQUIRED: [
    "Give this rehearsal a name",
    "Use 3 to 80 characters. Do not enter secrets.",
  ],
  PILOT_JOB_INVALID: [
    "Check the job number",
    "Enter the positive numeric job ID shown by the contract.",
  ],
  PILOT_OUTCOME_INVALID: [
    "Choose an outcome",
    "Select unresolved, failed, independently reviewed and paid, or another paid route.",
  ],
  PILOT_EVIDENCE_REQUIRED: [
    "Add evidence for your record",
    "For a job, add at least 20 characters and confirm you checked it. For costs, describe the source or allocation method in at least 10 characters.",
  ],
  PILOT_RECEIPT_REQUIRED: [
    "Add the final payment receipt",
    "Enter a valid nonzero transaction hash for a paid outcome. Keep the job unresolved while its payment or deferred claim is outstanding.",
  ],
  PILOT_SETTLEMENT_TIME_INVALID: [
    "Check the payment time",
    "Use UTC, within this measurement period and no later than now. Older settlements belong in their original period.",
  ],
  PILOT_AMOUNT_INVALID: [
    "Check the amount",
    "Use a nonnegative decimal without commas: up to 6 places for USDC, 18 for ETH, 2 for USD. Unknown costs may be blank.",
  ],
  PILOT_INTERVENTION_INVALID: [
    "Describe your intervention",
    "Enter 1 to 1440 whole minutes and a description of at least 10 characters.",
  ],
  VERIFICATION_RPC_REQUIRED: [
    "Add an independent verification RPC",
    "Open Operations & commissioning and save two providers. Preview can use one; live signing requires both.",
  ],
  RPC_PROVIDERS_MUST_DIFFER: [
    "Use independent providers",
    "Choose a different provider company and hostname for verification. Two API keys from one provider do not provide independence.",
  ],
  RPC_DISAGREEMENT: [
    "Signing stopped: RPC providers disagree",
    "Keep signing paused. Investigate both services and pending transactions. Stop the worker, correct the connection if needed, check readiness, then explicitly resume. Never remove verification to bypass the disagreement.",
  ],
  RPC_VERIFICATION_UNAVAILABLE: [
    "Waiting for both RPC providers",
    "No signing occurs while verification is unavailable. Check both services; the worker retries automatically.",
  ],
  INDEPENDENCE_REVIEW_REQUIRED: [
    "Review related parties",
    "Open Operations & commissioning, import related identities and record your independence review.",
  ],
  COMMISSIONING_REQUIRED: [
    "Complete commissioning before mainnet",
    "Record the actual Linux host, Sepolia, fault, recovery, monitoring and soak results in Operations & commissioning. This is an operator attestation, not independent certification.",
  ],
  COMMISSIONING_EVIDENCE_REQUIRED: [
    "Add the actual test evidence",
    "Record at least 20 characters: date, tested machine, outcome and local evidence filename.",
  ],
  PEER_WALLET_MUST_DIFFER: [
    "This is the same wallet",
    "Every running machine needs its own signer and journal. Import the other machine’s distinct public identity.",
  ],
  EXTERNAL_NONCE_CHANGED: [
    "Wallet history does not match",
    "Stop signing. This wallet has confirmed activity absent from its journal. Restore the latest complete backup and reconcile; never reset the nonce.",
  ],
  JOURNAL_SIGNATURE_MISMATCH: [
    "Signed journal does not match",
    "Keep signing stopped. Restore and reconcile an intact complete backup before resuming.",
  ],
  SPENDING_CLOCK_CHANGED: [
    "System clock moved backwards",
    "Restore accurate system time and inspect transaction accounting before resuming.",
  ],
  PUBLIC_DATA_REQUIRED: [
    "Authorize only public jobs",
    "Confirm the public-data and publishing choices under OpenClaw & delivery. Never include private or confidential information.",
  ],
  PUBLISHER_UNAVAILABLE: [
    "Open IPFS Desktop",
    "Start IPFS Desktop on this computer, then check the connection again. No new job is accepted without a verified public deliverable.",
  ],
  ACTIVE_JOBS_MUST_FINISH: [
    "Finish accepted jobs before changing policy",
    "Ordinary policy changes remain blocked while jobs are active. For a finalization gas or ETH budget problem, stop the worker and use Jobs & limits → Recover an active job’s settlement budget, then save a new backup and reauthorize.",
  ],
  LOCAL_HISTORY_CAPACITY: [
    "Your local history needs archiving",
    "New jobs are paused near the backup size limit. Finish active jobs, save a verified backup and arrange a fresh dedicated wallet/workspace. Existing submissions and claims remain prioritized.",
  ],
  SUBMISSION_CAPACITY_RESERVED: [
    "Saving transaction capacity for delivery",
    "The agent waits for its rolling budget to recover before accepting another bond and deadline.",
  ],
  SUBMISSION_GAS_RESERVED: [
    "Saving gas budget for delivery",
    "The agent reserves conservative capacity for approval, application and submission before accepting another job.",
  ],
  SUBMISSION_ETH_RESERVE: [
    "Insufficient ETH reserve for a new job",
    "The wallet needs enough ETH for three transactions at your per-transaction ceiling. Fund only within your intended risk budget.",
  ],
  BUYER_NOT_IN_SCOPE: [
    "Buyer is outside your chosen scope",
    "This job is skipped. Only deliberately approved buyers are eligible.",
  ],
  OTHER_FLEET_SHARD: [
    "Assigned to another Mac’s job partition",
    "This computer leaves the opportunity for the configured fleet slot.",
  ],
  WORK_ATTEMPTS_EXHAUSTED: [
    "The job could not pass preparation",
    "The bounded number of generation attempts is exhausted. No bond was committed.",
  ],
  ASSIGNED_WORK_REQUIRES_RECOVERY: [
    "Accepted work needs recovery",
    "Keep the wallet and journal intact. Restore the latest complete backup or ask a technical operator to recover the exact prepared deliverable. The deadline continues.",
  ],
  SUBMISSION_DEADLINE_AT_RISK: [
    "The submission deadline is at risk",
    "Inspect this accepted job immediately. The agent will not knowingly send a late submission.",
  ],
  REWARD_TOO_SMALL: [
    "Expected agent share is below your minimum",
    "The contract’s agent share, before operating costs, does not meet your chosen threshold.",
  ],
  JOB_DURATION_TOO_SHORT: [
    "The deadline is too short for this policy",
    "The agent requires at least one hour for assignment confirmations and submission.",
  ],
  CONTRACT_SIMULATION_REJECTED: [
    "The contract rejected this action in simulation",
    "The job is retried later. Check eligibility, NFT requirements, assignment and active-job limits.",
  ],

  COMPANION_ACKNOWLEDGEMENT: [
    "Review the connection choices",
    "Confirm the dedicated profile, subscription route and sharing of operating metrics before continuing.",
  ],
  COMPANION_DISABLED: [
    "Your companion is off",
    "Enable the OpenClaw connection in OpenClaw & OpenAI when you are ready.",
  ],
  COMPANION_STATE_INVALID: [
    "AI usage history needs recovery",
    "The AI connection is disabled. Restore a valid backup or ask your technical operator to reconcile assistant-state.json; preview mode remains available.",
  ],
  COMPANION_TOKEN_REQUIRED: [
    "Connect your dedicated OpenClaw profile",
    "Download the private setup file or enter a valid dedicated gateway token.",
  ],
  COMPANION_BUSY: [
    "One AI request is already running",
    "Wait for that request. Your node keeps its signing rules.",
  ],
  COMPANION_COOLDOWN: [
    "Your companion is waiting before another request",
    "Check the next-attempt time. Requests are spaced to conserve your allowance.",
  ],
  COMPANION_DAILY_LIMIT: [
    "Your chosen AI request limit has been reached",
    "Calls resume as older requests leave the rolling 24-hour window. No paid API fallback is added.",
  ],
  COMPANION_RATE_LIMITED: [
    "OpenClaw or the model has reached a usage limit",
    "The node respects the retry time. Check your subscription usage in OpenClaw; new work waits.",
  ],
  COMPANION_AUTH_FAILED: [
    "OpenClaw did not accept the gateway token",
    "Check the dedicated gateway setup and token. Never paste your OpenAI password here.",
  ],
  COMPANION_ENDPOINT_DISABLED: [
    "Enable the dedicated OpenClaw endpoint",
    "Run the included setup launcher or follow docs/OPENCLAW.html, then test again.",
  ],
  COMPANION_UNAVAILABLE: [
    "Your AI companion is unavailable",
    "Check that the dedicated gateway is running and subscription sign-in is current. Requests retry with increasing delays.",
  ],
  COMPANION_RESPONSE_INVALID: [
    "The model returned an unusable response",
    "No AI-dependent job was accepted. Check the configured model and test again after the waiting period.",
  ],
  COMPANION_OUTPUT_LIMIT: [
    "The AI response exceeded its limit",
    "The response was discarded. No AI-dependent job was accepted.",
  ],
  COMPANION_INPUT_LIMIT: [
    "The evidence exceeds the cloud review limit",
    "This job is abstained from without sending a truncated review.",
  ],
  COMPANION_CANCELLED: [
    "The AI request was cancelled",
    "No response from the cancelled request will authorize an approval.",
  ],
  COMPANION_CLOCK_CHANGED: [
    "The computer clock changed unexpectedly",
    "Correct the clock before using the AI connection. Its recorded request allowance remains intact.",
  ],
  COMPANION_TEST_REQUIRED: [
    "Test your OpenClaw connection first",
    "Enable the dedicated connection and choose Test my connection before starting live work.",
  ],
  CLOUD_PUBLIC_DATA_REQUIRED: [
    "Cloud review requires public, permitted evidence",
    "Keep cloud review off for private or personal data. Confirm every job in the authorized scope is suitable before enabling.",
  ],
  CLOUD_AI_VETO: [
    "The cloud reviewer raised a concern",
    "The node abstained. The AI cannot convert a concern into an on-chain rejection or override formal acceptance checks.",
  ],
  CLOUD_AI_UNAVAILABLE: [
    "Required cloud review is unavailable",
    "The node abstains and retries within its limits; it never silently bypasses this review requirement.",
  ],

  NODE_24_REQUIRED: [
    "Install Node.js 24.19 or newer 24.x",
    "This application requires Node 24.19+ within 24.x. Node 24.11, 25 and 26 are outside its runtime range. Use START_HERE.html, then reopen the app.",
  ],
  ANOTHER_WORKER_IS_RUNNING: [
    "Another worker owns this workspace",
    "Stop its original process before changing or restoring this state. Never run two signers with one wallet.",
  ],
  DOWNLOAD_BACKUP_FIRST: [
    "Download a current backup first",
    "Use Wallet & backups to download your encrypted state, then confirm that you saved the file.",
  ],
  NEW_DEPLOYMENT_REQUIRES_SEPARATE_WORKSPACE: [
    "Keep this deployment’s history",
    "Use a separate workspace for a different deployment. The current journal cannot be discarded safely.",
  ],
  RESTART_LIMIT_REACHED: [
    "Repeated restarts have stopped",
    "Review the connection, code and recorded notices. Restart only after addressing the cause.",
  ],
  WORKER_RESTARTING: [
    "Review worker is restarting",
    "The supervisor preserves its journal and waits before retrying. No authority or budget is increased.",
  ],
  WORKER_START_FAILED: [
    "Review worker could not start",
    "Keep the full application folder together and check that Node.js 24 LTS is installed.",
  ],
  RESTORE_INTERRUPTED_RECOVERY_REQUIRED: [
    "An interrupted restore needs recovery",
    "Automatic startup is blocked to protect your history. Preserve the entire profile and follow docs/BACKUP_RECOVERY.html with a technical operator. Do not delete the restore marker.",
  ],
  BACKUP_STATE_UNSAFE_FILE: [
    "A backup file needs attention",
    "An application record is a link or an unsupported file. Keep the original folder intact and consult the backup recovery guide.",
  ],
  BACKUP_STATE_CHANGED: [
    "A record changed during backup",
    "Stop any other tools editing this profile, then download a new backup.",
  ],
  BACKUP_STATE_FORMAT: [
    "The operational backup is not valid",
    "Keep the original file and try another known-good backup. No replacement was installed.",
  ],
  BACKUP_STATE_PATH: [
    "The backup contains an unsupported path",
    "Keep the original file and use a known-good application backup.",
  ],
  BACKUP_STATE_DUPLICATE: [
    "The backup contains conflicting filenames",
    "Use a known-good backup. The active wallet and history were not replaced.",
  ],
  BACKUP_STATE_INTEGRITY: [
    "A backup record did not match its checksum",
    "Use another protected backup or the original stopped profile. Preserve the damaged file for investigation.",
  ],
  BACKUP_TOO_LARGE: [
    "This history needs a full-folder backup",
    "Stop and lock the node. Ask your technical operator to make an encrypted backup of the entire private state folder.",
  ],
  LOCAL_AI_UNAVAILABLE: [
    "The local model service is unavailable",
    "Open Ollama on this computer, install your model, then find and test it in Local AI review.",
  ],
  SECURITY_RECONCILIATION_REQUIRED: [
    "This pause protects inconsistent history",
    "Keep signing stopped and independently reconcile the recorded chain or transaction change before resuming.",
  ],

  STOP_BEFORE_CHANGING_SETTINGS: [
    "Stop the node before editing",
    "Use Stop safely, then change settings and reauthorize the new limits.",
  ],
  USED_WALLET_REQUIRES_HISTORY: [
    "This wallet has previous outgoing transactions",
    "Use a fresh dedicated wallet, or migrate and reconcile its existing node journal before live operation.",
  ],
  WALLET_REQUIRED: [
    "Create or import your dedicated wallet",
    "Use the Wallet step in Setup before saving your encrypted backup.",
  ],
  BACKUP_ALREADY_REQUESTED: [
    "Your backup is ready",
    "Save the downloaded file privately, then confirm that you saved it.",
  ],
  CONFIG_TRUSTEDBUYERS: [
    "Check the buyer addresses",
    "Enter complete Ethereum wallet addresses, separated by commas or new lines.",
  ],
  CONFIG_MANAGER: [
    "Check the contract address",
    "Enter the full deployed AGIJobManager address.",
  ],
  INVALID_ARGUMENT: [
    "Check the value you entered",
    "An address, amount or encrypted wallet field is invalid.",
  ],
  NODE_LOCKED: [
    "Unlock your agent",
    "Enter your vault password in Secure your agent and connect, then return to your task.",
  ],
  PASSWORD_OR_FILE_INCORRECT: [
    "Password did not unlock this file",
    "Check your password and use an unmodified encrypted backup or vault.",
  ],
  PASSWORD_LENGTH: [
    "Choose a stronger password",
    "Use 12–1,024 characters. Keep it separately from your encrypted backup.",
  ],
  OPERATION_IN_PROGRESS: [
    "Another action is finishing",
    "Wait a moment and try again. No second action was started.",
  ],
  SETUP_INCOMPLETE: [
    "Finish setup",
    "Connect the deployment, choose a wallet and authorize at least one buyer.",
  ],
  VALIDATOR_NOT_AUTHORIZED: [
    "Wallet is not eligible yet",
    "Have this wallet authorized by the contract’s actual club, allowlist or Merkle eligibility route.",
  ],
  VALIDATOR_NOT_ELIGIBLE: [
    "Wallet is not eligible yet",
    "Check the membership label, proof and blacklist status with the deployment operator.",
  ],
  INSUFFICIENT_USDC_FOR_BOND: [
    "More USDC is needed",
    "The available wallet balance cannot cover this job’s required bond.",
  ],
  INSUFFICIENT_ETH: [
    "More ETH is needed for gas",
    "Fund only the dedicated agent wallet within your chosen risk budget.",
  ],
  RPC_NOT_CONFIGURED: [
    "Connect your Ethereum service",
    "Add a trusted RPC connection in Setup. Its credentials are encrypted locally.",
  ],
  DEPENDENCY_OR_NETWORK_ERROR: [
    "A connection or contract check did not complete",
    "The node will retry ordinary network errors. Check Connection and the recorded transaction before changing anything.",
  ],
  FINALIZED_BLOCK_UNAVAILABLE: [
    "This connection lacks finalized blocks",
    "Choose an Ethereum RPC that supports historical state, logs and finalized blocks.",
  ],
  DEPLOYMENT_BLOCK_REQUIRED: [
    "Deployment is not ready to enroll",
    "Use its creation transaction or exact creation block, and wait for public-network finality.",
  ],
  WRONG_CHAIN: [
    "Wrong network",
    "The RPC network must match the network selected in Setup.",
  ],
  STALE_CHAIN_OR_CLOCK: [
    "Network or clock needs attention",
    "Check your internet connection, provider and computer clock.",
  ],
  RUNTIME_BYTECODE_MISMATCH: [
    "Contract does not match this edition",
    "Use the verified AGIJobManager v1.1.0 deployment. Do not bypass the fingerprint check.",
  ],
  DEPLOYMENT_CODE_CHANGED: [
    "Contract fingerprint changed",
    "Signing remains stopped. Independently verify the deployment before proceeding.",
  ],
  LIVE_NOT_ACTIVATED: [
    "Live validation is not authorized",
    "Review your limits and use Authorize live validation.",
  ],
  ACTIVATION_SCOPE_CHANGED: [
    "Your settings changed",
    "Review the new scope and authorize it before starting live validation.",
  ],
  NODE_PAUSED: [
    "New signing is paused",
    "Monitoring continues. An already broadcast transaction can still execute.",
  ],
  PENDING_TRANSACTION_NEEDS_REVIEW: [
    "A transaction is taking unusually long",
    "Keep monitoring its recorded hash. The node will not create a competing transaction.",
  ],
  PENDING_CONTEXT_CHANGED: [
    "Conditions changed after signing",
    "Keep monitoring the recorded transaction. Automatic rebroadcast is withheld.",
  ],
  NONCE_CONSUMED_WITHOUT_KNOWN_RECEIPT: [
    "Wallet history needs reconciliation",
    "Another transaction consumed the recorded nonce. Keep live signing stopped and reconcile the known hash through an independent RPC.",
  ],
  CHAIN_REORG_REINDEX_REQUIRED: [
    "The event index needs rebuilding",
    "Stop the node, verify its transaction journal, then use Rebuild event index.",
  ],
  CONFIRMED_TRANSACTION_REORG: [
    "A recorded transaction changed chains",
    "Keep signing stopped. Rebuilding the event index alone cannot repair this transaction record.",
  ],
  CONTRACT_SIMULATION_REJECTED: [
    "Contract declined this job",
    "The node deferred this job before signing and can review other opportunities.",
  ],
  OPEN_BOND_LIMIT: [
    "Your exposure limit is reached",
    "Existing bonds must settle before more risk is accepted.",
  ],
  BOND_24H_LIMIT: [
    "Your daily bond allowance is used",
    "New bonds wait for the rolling 24-hour budget to become available.",
  ],
  GAS_24H_LIMIT: [
    "Your daily gas allowance is used",
    "New transactions wait for the rolling 24-hour budget to become available.",
  ],
  GAS_PRICE_LIMIT: [
    "Network fees are above your limit",
    "The node waits without increasing your spending authority.",
  ],
  UNSUPPORTED_ACCEPTANCE_DECLARATION: [
    "This job needs a different review method",
    "Its buyer did not declare supported complete formal acceptance criteria. No job is accepted.",
  ],
  UNSUPPORTED_SPECIFICATION: [
    "This specification is unsupported",
    "No job is accepted when acceptance conditions cannot be evaluated by an installed, tested profile.",
  ],
  EVIDENCE_UNAVAILABLE: [
    "Evidence is not available yet",
    "The node will retry. Missing evidence is never treated as proof of success or failure.",
  ],
  AI_VETO: [
    "Additional AI review raised a concern",
    "The deterministic checks passed, but the optional model vetoed approval. No job is accepted.",
  ],
  OS_CREDENTIAL_UNAVAILABLE: [
    "Automatic unlock is unavailable",
    "Unlock with your password. Your operating system did not release the saved credential.",
  ],
  BACKUP_REQUIRED: [
    "Save your encrypted backup first",
    "Download a backup, verify that exact encrypted file, then confirm your off-machine copy before authorizing or restarting live operation.",
  ],
  RESTORE_RECONCILIATION_REQUIRED: [
    "Restored history needs verification",
    "Observation is available. Verify that no later wallet transactions are missing before authorizing live operation.",
  ],
  SERVICE_UNAVAILABLE: [
    "Background service is unavailable here",
    "The application can still run while open. Use the operating guide for this platform.",
  ],
};
export function explain(code) {
  const found = explanations[code];
  return {
    code,
    title:
      found?.[0] ??
      String(code ?? "CHECK_REQUIRED")
        .toLowerCase()
        .replaceAll("_", " "),
    action:
      found?.[1] ??
      "Review the status details and operating guide. Spending limits are not changed automatically.",
  };
}
export function publicError(e) {
  const raw = String(e?.code ?? e?.message ?? "").toUpperCase();
  const code = /^[A-Z][A-Z0-9_]{2,100}$/.test(raw)
    ? raw
    : "DEPENDENCY_OR_NETWORK_ERROR";
  return explain(code);
}
