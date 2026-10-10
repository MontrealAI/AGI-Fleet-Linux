#!/usr/bin/env node
import {setupRole} from '../compute/roles.mjs';
import {readSetupArguments,validateHandoffFile} from '../compute/setup-ledger.mjs';
import {openCompletionPanel} from '../compute/setup-completion.mjs';
import {safeSetupFailure} from '../compute/setup-auth.mjs';
import {safeFailureFields} from '../compute/setup-failure-report.mjs';
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {selectOpenClawRuntime,runSelectedOpenClaw} from '../compute/openclaw-runtime-selection.mjs';
import { createInterface } from "node:readline/promises";
import {
  profileConfig,
  OPENCLAW_VERSION,
} from "../src/control/openclaw-profile.mjs";
import { privateDir, atomicWrite, ensure } from "../src/util.mjs";

// Runs only on the owner's computer. Never reads the AGI Agent vault or journal.
process.umask(0o077);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const profile = "agi-agent";
let selectedRuntime;
function run(args,capture=false){return runSelectedOpenClaw(selectedRuntime,args,{capture});}
let setupOptions;
async function main() {
  setupOptions=readSetupArguments(process.argv.slice(2));
  console.log(setupOptions.standardReadinessResume?'Continue Standard Readiness. Preserve the approved same-release attempt and reuse unchanged authority; no OAuth login or assurance-mode change.':setupOptions.standardOAuthResume?'Continue Standard Install. Preserve the same-release pre-approval OAuth attempt, revalidate existing sign-ins, and require a fresh approval.':setupOptions.cleanReadinessResume?'Continue the approved fresh installation after safe stop. The prior runtime and evidence are retained; a new review is required before activation.':setupOptions.cleanOAuthResume?'Resume paused fresh OAuth setup. Only verified pre-service pauses in the supported release sequence are admitted; original evidence and valid sign-ins are preserved.':setupOptions.experimentalLegacy?'Advanced — Legacy Migration / Recovery · EXPERIMENTAL. Existing installations only; unsupported as a production prerequisite.':''+(setupOptions.assuranceMode==='preserve'?'Retry Install — preserve recorded assurance mode':setupOptions.assuranceMode==='standard'?'Standard Install · RECOMMENDED':'Advanced — High-Assurance / Verified Install')+'. Set up on a new Mac or clean Standard compute account.');
  console.log(
    "\nAGI Agent · Connect OpenClaw with your ChatGPT Pro subscription\n",
  );
  let file =
    setupOptions.file ??
    (await rl.question(
      "Drag AGI-Agent-OpenClaw-Setup.json here, then press Return: ",
    ));
  file = file.trim();
  if (
    (file.startsWith("'") && file.endsWith("'")) ||
    (file.startsWith('"') && file.endsWith('"'))
  )
    file = file.slice(1, -1);
  // Finder escapes spaces when a file is dragged into Terminal. Do not evaluate shell input.
  file = file.replace(/\\([ ()])/g, "$1");
  const kit = validateHandoffFile(file,{repairPermissions:!setupOptions.cleanInstall});
  ensure(setupRole(kit)==='agent','OPENCLAW_SETUP_FILE');
  ensure(!setupOptions.cleanInstall||kit.mode==='workstation','CLEAN_INSTALL_WORKSTATION_REQUIRED');
  ensure(!setupOptions.selftestOnly||kit.mode==='workstation','SELFTEST_REQUIRES_WORKSTATION');
  if (["tools","workstation"].includes(kit.mode)) { const {setupCapable}=await import("../compute/setup.mjs"); const result=await setupCapable(kit,rl,{filePath:path.resolve(file),...setupOptions});return result?.schema==='agi-setup-support/v2'?{supportReport:result,supportDirectory:path.join(os.homedir(),'.agi-genesis-setup-'+(kit.schema.includes('node')?'node':'agent')),retryDesktop:()=>setupCapable(kit,rl,{filePath:path.resolve(file),selftestOnly:true,nonInteractive:true,acknowledgeSeparation:true})}:result; }
  selectedRuntime=selectOpenClawRuntime();
  const dir = path.join(os.homedir(), ".openclaw-agi-agent");
  const configFile = path.join(dir, "openclaw.json"),
    marker = path.join(dir, "agi-agent-profile.json");
  const workspace = path.join(dir, "workspace");
  const config = profileConfig(kit, workspace);
  ensure(
    !fs.existsSync(dir) || fs.existsSync(marker),
    "OPENCLAW_EXISTING_PROFILE",
  );
  console.log(
    "This creates a separate agi-agent profile with no agent tools and no paid API fallback.\nYour ordinary OpenClaw profile is not edited. Pro usage limits still apply.\nFor host isolation, run this setup under a separate OS account from the wallet.",
  );
  if (fs.existsSync(configFile)) {
    const answer = await rl.question(
      "Refresh the existing AGI Agent companion profile? Type REFRESH: ",
    );
    ensure(answer.trim() === "REFRESH", "SETUP_CANCELLED");
  }
  privateDir(dir);
  privateDir(workspace);
  if (fs.existsSync(configFile))
    fs.copyFileSync(configFile, path.join(dir, "openclaw.previous.json"));
  atomicWrite(configFile, JSON.stringify(config, null, 2));
  atomicWrite(marker, JSON.stringify({ schema: 1, version: OPENCLAW_VERSION }));
  ensure(
    run(["--profile", profile, "config", "validate"]).status === 0,
    "OPENCLAW_CONFIG_REJECTED",
  );
  console.log(
    "\nSign in with your ChatGPT subscription in the browser. Do not choose API-key authentication.",
  );
  ensure(
    run([
      "--profile",
      profile,
      "models",
      "auth",
      "login",
      "--provider",
      "openai",
      "--method",
      "oauth",
      "--agent",
      kit.agent,
      "--profile-id",
      "openai:agi-agent-pro",
    ]).status === 0,
    "OPENCLAW_SIGN_IN_INCOMPLETE",
  );
  ensure(
    run([
      "--profile",
      profile,
      "models",
      "auth",
      "order",
      "set",
      "--provider",
      "openai",
      "--agent",
      kit.agent,
      "openai:agi-agent-pro",
    ]).status === 0,
    "OPENCLAW_AUTH_ORDER_FAILED",
  );
  console.log("\nChecking the available models and configured authentication.");
  ensure(
    run(["--profile", profile, "models", "list", "--provider", "openai"])
      .status === 0,
    "OPENCLAW_MODEL_CHECK_FAILED",
  );
  const automatic = await rl.question(
    "\nStart this dedicated gateway automatically after login? [Y/n]: ",
  );
  if (!/^n(o)?$/i.test(automatic.trim())) {
    ensure(
      run([
        "--profile",
        profile,
        "gateway",
        "install",
        "--port",
        String(kit.port),
      ]).status === 0,
      "OPENCLAW_SERVICE_INSTALL_FAILED",
    );
    ensure(
      run(["--profile", profile, "gateway", "start"]).status === 0,
      "OPENCLAW_SERVICE_START_FAILED",
    );
    console.log(
      "\nSetup complete. Return to AGI Agent and choose Test my connection.\nOpenClaw and AGI Agent each need their own startup-after-login setting.\nVerify /codex status uses subscription authentication. Pro limits still apply.",
    );
    return;
  }
  console.log(
    "\nBefore live operation, verify /codex status uses subscription authentication.\nReturn to AGI Agent and choose Test my connection.\nThis window keeps the dedicated gateway running; leave it open for now.\nThe included OpenClaw guide explains startup after login.",
  );
  ensure(
    run(["--profile", profile, "gateway", "run", "--port", String(kit.port)])
      .status === 0,
    "OPENCLAW_GATEWAY_STOPPED",
  );
}
try {
  const result=await main();
  if(result?.supportReport&&process.stdin.isTTY&&!setupOptions?.nonInteractive){rl.close();const panel=await openCompletionPanel(result.supportReport,{directory:result.supportDirectory,retry:result.retryDesktop});await panel.completed;}
} catch (error) {
  const messages = {
    STANDARD_INSTALL_ALREADY_COMPLETE: 'This Standard installation transaction is already complete. This continuation does not restart active work. Return to the signer connection panel and continue commissioning.',
    STANDARD_INSTALL_READINESS_RESUME_UNAVAILABLE: 'The retained approved runtime does not match the narrowly supported Standard finalization case. Preserve its report and evidence; no repair, reauthentication or new account is required to collect diagnostics. See STANDARD_FINALIZATION_HOTFIX.md.',
    EXPERIMENTAL_LEGACY_OPT_IN_REQUIRED: 'Legacy migration/recovery is Experimental / Advanced. Use Experimental-Migration.command only for a separately reviewed existing installation; it is not a production prerequisite.',
    CLEAN_INSTALL_RETRY_UNAVAILABLE: 'Early clean retry requires an intact intent from this exact release and no transaction, installed profile, service or unknown evidence. Preserve this attempt and return its report for review.',
    CLEAN_INSTALL_PROFILE_EXISTS: 'This account already contains an OpenClaw profile. Leave it untouched and use the new Standard compute account.',
    CLEAN_INSTALL_EVIDENCE_EXISTS: 'This account already contains setup or transaction evidence. Clean install does not repair or delete it. Preserve this account and use a genuinely fresh compute account.',
    CLEAN_INSTALL_SERVICE_EXISTS: 'This account already has managed compute service files. Clean install leaves them untouched.',
    CLEAN_INSTALL_LEGACY_ACCOUNT_FROZEN: 'agiagentcomputev0 is frozen for forensic preservation. Switch to the fresh Standard account agiagentcomputev1.',
    CLEAN_INSTALL_WORKSTATION_REQUIRED: 'Export a workstation setup file. The clean production track retains desktop, documents, code and protected-browser capability.',
    CLEAN_INSTALL_HOME_REQUIRED: 'Use this new Standard account’s own ordinary home directory; linked or redirected state is not admitted.',
    CLEAN_INSTALL_OAUTH_RESUME_UNAVAILABLE: 'This attempt does not meet the guarded fresh OAuth continuation checks. Keep the original kit, diagnostics and transaction evidence for review. Do not delete state or use legacy repair. See docs/FRESH_OAUTH_CONTINUATION.html.',
    CLEAN_INSTALL_ARGUMENT_CONFLICT: 'Clean install cannot be combined with repair, recovery, refresh or desktop-only flags.',
    SETUP_FILE_REQUIRED: 'Noninteractive setup needs the path to the private role setup JSON.',
    NONINTERACTIVE_SEPARATION_REQUIRED: 'After verifying the compute account cannot access signing material, add --acknowledge-separation for desktop-only automation.',
    SELFTEST_REQUIRES_WORKSTATION: 'Export a workstation setup file from the Agent or Node panel. Desktop-only mode cannot configure a bounded reviewer.',
    SETUP_ARGUMENT_UNSUPPORTED: 'Use one setup JSON followed by the documented options. See the M1 maintenance guide.',
    SETUP_ALREADY_RUNNING_OR_INTERRUPTED: 'Another installer is active or an interrupted attempt needs review. Keep its evidence. The fresh installer does not enter legacy lock recovery; do not delete a lock or switch to Experimental Migration to force a pass.',
    SETUP_ALREADY_RUNNING: 'The other installer is still running. Wait for it or close it normally.',
    COMPUTE_DOCKER_START_TIMEOUT: 'Docker engine did not become ready in 90 seconds. Open Docker Desktop in this compute account and retry.',
    COMPUTE_STANDARD_ACCOUNT_REQUIRED: 'Use the dedicated Standard compute account. An unknown or administrator account cannot pass this gate.',
    SETUP_FILE_OWNER_REQUIRED: 'Copy the temporary setup file into this compute account using the secure staging guide. It must be a regular file owned by this account.',
    SETUP_FILE_PRIVATE_MODE_REQUIRED: 'Protect the temporary setup JSON with owner-only permissions (chmod 600) and retry.',
    NONINTERACTIVE_DESKTOP_ONLY_REQUIRED: 'Noninteractive mode supports --selftest-only with --acknowledge-separation. OAuth and service installation require the interactive setup.',

    COMPUTE_SEPARATE_OS_USER_REQUIRED:
      "Use a separate standard macOS account for the capable worker. Switch accounts, open this package there and rerun setup with the private setup file. Do not copy wallet files or backups into that account.",
    COMPUTE_DOCKER_REQUIRED:
      "Install and start Docker Desktop in the compute account, then reopen this installer. See docs/CAPABLE_WORKER.html.",
    OPENCLAW_NOT_INSTALLED:
      "Open Prepare-Compute-Runtime.command in this release first, then reopen this launcher. The private pinned runtime preserves your existing installation.",
    OPENCLAW_ARTIFACT_MISMATCH: "The selected OpenClaw package does not match this release. Preserve the existing installation; use Prepare-Compute-Runtime.command and its retained diagnostics.",
    OPENCLAW_VERSION_MISMATCH: `This edition was checked with OpenClaw ${OPENCLAW_VERSION}. Use that version or have a technical operator qualify the installed version before connecting. See docs/OPENCLAW.html.`,
    OPENCLAW_EXISTING_PROFILE:
      "An existing agi-agent OpenClaw profile was not created by this installer. Nothing was overwritten. Ask your operator to choose a separate profile.",
    SETUP_CANCELLED: "Setup cancelled. Your profile was not replaced.",
  };
  const failures=safeFailureFields(error.supportReport??error);
  const rawCode=error.code??error.message;
  const primary=failures.primaryFailureCode??failures.failureCode??(Object.hasOwn(messages,rawCode)?rawCode:safeSetupFailure({message:rawCode}));
  console.error('Primary commissioning failure: '+primary);
  const readiness=error.supportReport?.freshReadinessDiagnostic??error.freshReadinessDiagnostic;if(readiness?.schema==='agi-fresh-readiness-diagnostic/v1'&&/^[a-z-]{1,100}$/.test(readiness.predicate??''))console.error('Fresh readiness admission predicate: '+readiness.predicate);
  const standardReadiness=error.standardReadinessDiagnostic;if(standardReadiness?.schema==='agi-standard-readiness-diagnostic/v1')console.error('Standard readiness admission predicate: '+standardReadiness.predicate);
  const continuation=error.supportReport?.freshOAuthDiagnostic??error.freshOAuthDiagnostic;
  if(continuation)console.error('Continuation diagnostic: '+JSON.stringify(continuation));
  const cleanup=error.supportReport?.cleanupFailureCode??error.cleanupFailureCode;if(cleanup)console.error('Cleanup failure (separate): '+cleanup);
  if(failures.rollbackFailureCode)console.error('Rollback failure (retained): '+failures.rollbackFailureCode);
  if(error.supportReport?.recovery)console.error('Recovery: profile '+failures.recovery.profile+'; service files '+failures.recovery.serviceFiles);
  if(error.supportReport?.diagnosticsSaved===false)console.error('The diagnostic file could not be saved. Export the in-memory report from the result panel.');
  else if(typeof error.supportDirectory==='string')console.error('Saved support report: '+path.join(error.supportDirectory,'setup-diagnostics.json'));
  if(error.supportReport?.failureRecordingFailed===true)console.error('Transaction failure recording was incomplete; retain the support report.');
  console.error(
    "\n" +
      (error.supportReport?.diagnosticsSaved===false ? 'Export the in-memory result report for technical review. Preserve the profile and transaction evidence; no manual restart, rollback or OAuth work is required.' : error.supportReport?.stages?.services==='failed' ? 'Export the saved support report for technical review. It includes the primary service failure, separate rollback evidence and recovery status. Keep the existing profile and transaction archives intact; no manual restart, rollback, profile edit or OAuth sign-in is required to collect it.' : messages[primary] ??
        "Setup did not complete. Check the preceding OpenClaw message and docs/OPENCLAW.html. No AGI Agent wallet was accessed."),
  );
  process.exitCode = 1;
  if (error.supportReport && process.stdin.isTTY && !setupOptions?.nonInteractive) {
    rl.close();
    try { const panel=await openCompletionPanel(error.supportReport,{directory:error.supportDirectory,retry:error.retryDesktop}); await panel.completed; }
    catch { console.error('The result panel could not open. The primary commissioning failure and recovery status printed above remain the result; preserve the existing transaction evidence for technical review.'); }
  }
} finally {
  rl.close();
}
