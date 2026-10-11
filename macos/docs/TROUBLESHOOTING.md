# Help and recovery

**If something stops, keep the message and leave the stopped installation intact.** A deliberate stop protects your work and approval boundaries. You can collect a useful report without deleting accounts, wallet files, databases or safety markers.

## I am not sure where to start

Use [Welcome](START_HERE.md) to choose a role. Most new worker operators start with Agent. Ask a trusted helper to follow [Fresh Mac setup](FRESH_INSTALL.md) with you. You do not have to understand the technical terms to choose what you want to make.

## Common situations

| What you see | What to do next |
| --- | --- |
| macOS blocks a downloaded launcher | Verify the exact ZIP checksum and source first. Use the normal file-specific macOS approval offered under **System Settings → Privacy & Security** only for that verified item. If approval is unavailable, stop and have a helper review it. Do not disable Gatekeeper, SIP or antivirus, and do not recursively strip quarantine. |
| Node is missing or the wrong version | The Mac signer launcher prepares hash-checked private Node 24.21.0 when a supported runtime is absent; keep internet available. A failed preparation is preserved for review, not overwritten. Supported Node is native arm64 24.19+ within 24.x. Do not replace it with a newer major version. The compute `Install.command` also prepares its own private runtime. |
| `MAC_APPLE_SILICON_REQUIRED`, `MAC_NATIVE_EXECUTION_REQUIRED` or `MACOS_15_REQUIRED` | Check **About This Mac**. This edition targets M1/M2, macOS 15+ and native arm64. Ask a helper to check that Terminal and Node are not running through Rosetta. Do not bypass the host check. |
| `OPENCLAW_SETUP_FILE` after dragging a file | Use one private setup JSON for the selected role. Drag only that file into the waiting prompt, without a command or extra filename. Mac 1.20.2 supports Finder-escaped spaces, apostrophes and punctuation. Keep the original unchanged; do not paste its contents or expose its secret in a support message. |
| Docker is unavailable | Log in to the Standard compute account, open Docker Desktop and wait for its engine. Confirm the pinned Apple silicon edition and User CLI installation. Running it in a different account is not sufficient. |
| Provider sign-in does not finish | Keep the waiting installer and original private setup file. Complete only the sign-in requested for the displayed role. If a callback/code is requested, enter it in that waiting prompt. Preserve the report if it still fails. |
| An approval, profile or runtime identity differs | Stop and compare the actual package, role and setup JSON. Do not edit the manifest, reuse a different role's JSON or grant broader authority to dismiss the mismatch. |
| `SETUP_FILE_OWNER_REQUIRED` or `SETUP_FILE_PRIVATE_MODE_REQUIRED` | Follow the private-transfer step in Fresh Mac setup. Copy only the setup JSON into the compute user's own private folder as that user, then apply `chmod 600` to that file. Do not give the installer access to someone else's home folder or relax the ownership check. |
| Setup says complete, but no useful work happens | Confirm the signer has approved the exact authenticated compute identity. Run the bounded live connection/document check. Check provider availability and limits; a listening service does not prove useful output. |
| A document was created, then cleanup failed or `COMPUTE_STOP` appeared | Keep the output, cleanup report and stopped state. Do not remove the marker, containers, profile, OAuth stores, SQLite files or journals manually. Collect the support report below. |
| Work does not resume after restart | FileVault may require physical unlock and the compute user must log in with Docker ready. Login services cannot unlock FileVault. Verify identity and readiness before resuming; preserve the stopped state on mismatch. |
| Memory pressure, swapping or container termination | Stop new work and record RAM, Docker allocation, workload and errors. 8 GB M1 operation is unqualified. Do not remove the sandbox limits to make a test pass. |

For current macOS instructions on opening a verified downloaded app, use [Apple's Gatekeeper guidance](https://support.apple.com/guide/mac-help/open-an-app-by-overriding-security-settings-mh40616/mac).

## Collect a report for your helper

In the existing **compute** account, open **`Repair-Compute.command`** from the matching role folder. It begins with a bounded read-only inventory. Choose **1 — Export current sanitized report**. Option **6 — Collect commissioning report** adds public DNS checks and the saved setup attempt.

Do not choose Apply, Resume, Roll back or Restart merely to gather information. Those are distinct actions requiring review. A command-line helper can collect the Agent report from the Fleet folder with:

```sh
bash ./Repair-Compute.command --role agent --export "$HOME/AGI-agent-support-review.json"
```

The destination must be a new file; the tool will not overwrite an existing report. Substitute `node`, `moderator`, `employer`, `evidence` or `recovery` only for the installed role. If no profile exists yet, preserve the installer's printed failure/report location instead.

Review the report before sharing it. Share the exact release filename/hash, Mac chip, memory, macOS version, role, failed stage and sanitized report. Keep original private logs locally. Never share wallet words, private keys, the setup JSON, provider credentials, raw authentication stores or private documents.

## May I try the installer again?

Only a bounded early failure eligible for the documented **Retry Standard Install** path may use `Retry-Standard-Install.command` after its cause is understood. Use the same original private JSON and retain the failed report. A retry is not a successful one-shot fresh-install result.

OAuth/readiness continuation, verified installation, migration and repair are separate advanced procedures. Use them only for the diagnosed state they describe. Do not switch between modes to get past a failure. A late failure, uncertain cleanup or runtime-identity mismatch needs review with the existing evidence preserved.

## Stop, close and return later

Use the app's stop/pause controls and confirm their reported state. **Pause signing now** prevents new signing and rebroadcast, but a transaction already broadcast can still be mined. **Stop service** stops the worker loop; **Lock & pause** also removes the unlocked vault from memory. Agent/Node controls must likewise be checked for their exact displayed scope.

Keep the extracted folder at its permanent location. Keep protected wallet recovery material and verified encrypted application backups separately. Reopen the same role and profile; do not create a new wallet to resolve an address mismatch. Reboot and recovery remain qualification checks, not assumptions.
