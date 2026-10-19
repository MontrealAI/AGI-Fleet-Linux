# Optional Alpha Computer Use rehearsal

This optional Linux x64/ARM64 route executes an owner-installed, fixed action fixture in Alpha's real Docker browser. It is disabled by default. It makes **zero model-provider requests** and is labelled a scripted rehearsal in its admission, native return and history. Device, Docker, human review and other execution costs remain UNKNOWN. This route does not commission paid work, verify commercial acceptance, establish independent review, sign transactions or connect settlement. Every live provider configuration is refused with `UNCOMMISSIONED_PROVIDER_COST` before invocation.

The existing deterministic CSV routes and immutable historical installations remain separate. Imported project or handoff data cannot choose an executable, Python environment, source checkout, image, model, endpoint or action sequence.

## Install an exact private profile

Use a disposable engineering installation for qualification. Keep the Fleet state and configuration outside either source checkout, in an owner-controlled directory with permissions 0700. Use an absolute, physical Alpha checkout at commit `dbaf5696d64ddcbf133f05d88d35496ebb85c3f0`, tree `30dc828703a6e9cd64103e0ebc965fc701e9bcf3`, with its hash-locked Python runtime dependencies installed. Source files and their import directories must be real, trusted-owner files, without group/world write permissions. Tracked importable bytes are checked independently of Git's index flags; untracked importable source and symlink import directories are rejected. The launcher executes Python source rather than preexisting cached bytecode. Use a physical interpreter binary or a virtual environment created with `python -m venv --copies`; symlink interpreter paths are refused. The installed Python executable and loaded runtime dependency files are fingerprinted. Isolated startup suppresses user site, executable `.pth` files and `sitecustomize`; dependencies must be installed directly in that interpreter’s or physical virtual environment’s `site-packages`. Each invocation uses a new empty bytecode-cache prefix before Python starts, and writes no bytecode.

Install the normal Fleet Linux bubblewrap/prlimit prerequisites and `/usr/bin/docker`. Build the reviewed Alpha Computer Use image using Alpha's `examples/successor-workbench/computer/Dockerfile`. Obtain and independently inspect its immutable `sha256:` image ID; mutable tags are rejected. The Docker binary and exact available image ID are checked during admission and dispatch. No general host-browser fallback is available. A managed Alpha browser container already present on the host blocks dispatch; use a dedicated engineering host without concurrent standalone Alpha sessions.

Prepare two private 0600 JSON files: the exact UTF-8 `successor-alpha-computer-handoff/v1` document containing public nonpersonal or synthetic inputs, and an owner-reviewed array of native Alpha primitive actions. For example, `[{"type":"wait"}]` is a bounded rehearsal action. The fixture must fit the imported task's bounds and Fleet's ceilings: 30 actions, 10 turns and 120 seconds. Scripted completion follows the fixed actions; it does not assert task acceptance. Keep the handoff bytes unchanged. The profile permits only their exact SHA256 and the exact installed actions.

From the Fleet checkout, create the installation profile with the following command, replacing the absolute paths and immutable image ID:

```sh
node local-runtime/computer/profile.mjs \
  --alpha-root /absolute/reviewed-alpha-checkout \
  --python /absolute/physical/python-executable \
  --image sha256:EXACT_IMAGE_ID \
  --handoff /absolute/private-config/handoff.json \
  --actions /absolute/private-config/actions.json \
  --output /absolute/private-config/computer-profile.json
```

Creation writes a new 0600 profile, validates the native handoff and fingerprints the installation; it does not start a session or grant authority. It refuses to overwrite an existing file. No provider credential is required or accepted. The profile and its containing directory must remain private and owner controlled. Configuration changes require service restart, fresh activation and new grants; old approvals never inherit the new profile.

## Prepare, authorize, run and export

Initialize a fresh Fleet state with the existing CLI, then start the service explicitly:

```sh
node local-runtime/cli/main.mjs serve \
  --computer-config /absolute/private-config/computer-profile.json
```

The CLI retains its existing `AGI_LOCAL_STATE` and private credential-file configuration. Inspect `doctor.alphaComputer` before activating an Agent. Its `supported` field describes installed capability; it does not establish hosted qualification or commercial readiness.

In the EN/FR local dashboard, select the active Agent and upload the exact public handoff under **Use your Alpha project in a browser**, labelled **Optional scripted rehearsal**. Confirm the initially unchecked public nonpersonal input assertion. Prepare only; then inspect the task, installation identity, image, native permit and limits, and separately authorize the exact grant using the existing operator controls. Run once. A scoped assistant can prepare and use its own approved grant; it cannot authorize itself or access another actor's output.

The service task schema is the existing `agi-fleet/local-task/v1`: action `alpha-computer-run`, workspace `files` (the inert handoff carrier), input `{ "handoffRaw": "exact UTF-8 document", "publicNonpersonal": true }`, review `none`, and null `sourceActor`/`sourceController`. The usual `/v1/prepare`, `/v1/authorize`, `/v1/run`, `/v1/stop`, and `/v1/cancel` authentication, origin and role controls apply. No imported document is rendered as active HTML in the dashboard.

Inspect the stored run output, native local signature, screenshot manifest and final visible text. The native signature attributes local observations; it is not independent economic review. Download `computer-return.json` with `/v1/computer-export` using `{actor,run}`, or a manifest artifact with `/v1/computer-artifact` using `{actor,run,name}`. The dashboard verifies download hashes. There are no caller-supplied filesystem paths or artifact URLs. Exact artifact names, MIME, ownership, size and SHA256 are checked; each artifact is at most 2 MB, each admitted run reserves 80 MB, and 320 MB of retained Computer Use reservations blocks further admission. No history is pruned automatically. Export the same native return for Alpha's inert history importer and the separately reviewed supplier integration; exporting grants no downstream execution or settlement authority.

STOP immediately prevents new actions and requests cancellation of the in-flight native session. Native cleanup must positively close its process group and Docker container. A failed, interrupted or uncertain attempt consumes its one-use grant and reservations, preserves its evidence, stops intake and cannot replay. Reconciliation can record confirmed closure without success; it does not restore authority or release the reservation. A service restart invalidates unused grants and quarantines interrupted work. Explicit recovery, activation and a new exact grant remain necessary; the retained Alpha replay guard also refuses a repeated native permit.

Completed and retained interrupted native returns/artifacts remain read-only exportable after STOP or removal of the optional configuration. They cannot be executed by export. Preserve them as historical evidence; do not alter old deployment records or previous installations.

## Qualification

Module boundary tests and the dashboard's explicitly synthetic transport test do not prove native execution. Release qualification requires the hosted service path: private profile → LocalRuntime service → exact operator grant → worker → actual immutable Alpha Docker image → native signed receipt, screenshots and visible text → native history export and independent supplier checks. No paid provider, production actor, on-chain activation or funded settlement is exercised by that fixture.
