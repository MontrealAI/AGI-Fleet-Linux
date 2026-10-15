# Alpha deterministic-work adapter: contract-only development stage

**Native Alpha execution is BLOCKED / UNPROVISIONED.** Declaring `alpha-run`
does not provision Python, grant execution authority, qualify a host, or change
any existing release. This additive source work is outside PR #38, the Fleet
release lanes and their source inventories. It has no operator-release claim.

## English: supported contract, unavailable execution

Only the Agent role declares `alpha-run`. Its input has exactly one field:
`workSpec`, containing the exact UTF-8 JSON text of an Alpha bounded work spec.
Whitespace, Unicode and numeric spelling remain unchanged inside that string.
The spec must select `fleet-linux-v1` and the
`agijobsv0-jobregistry-v2` namespace. Only allocation, schedule, forecast and
supplied-source research are accepted. No shell, command, interpreter path,
runtime manifest, source pin, credentials, code task, model or network route is
accepted from the task. Public-input screening still applies.

The existing supervisor owns actor/controller scope, explicit operator approval,
exact input and source/package/host/boot/generation binding, five-minute grant
expiry, durable single-use reservation, replay prevention and STOP. A failure or
uncertain outcome consumes its reservation and keeps STOP. Alpha cannot clear
STOP, authorize itself, or acquire signing authority.

`local-runtime/alpha/package-lock.json` has explicit null x64 and ARM64 targets.
`doctor` reports `ALPHA_PACKAGE_UNPROVISIONED`; Alpha admission refuses before a
grant or reservation is created. Direct native dispatch and the JavaScript
worker also refuse. Changing an environment variable, supplying a task manifest
or adding an artifact beside the lock cannot enable execution. Populating the
lock alone is insufficient: native launch remains unimplemented in this stage.

The receipt validator checks the exact work spec, normalized mission and returned
result identity, result schema and the exact no-authority marker. `alphaValidation`
is an internal backend response from a separately invoked fixed, pinned spec
validator; it is never accepted in task input. This stage has no trusted validator
package, so native admission remains blocked before creating a grant. Hashes use
the exact upstream canonical strings; JavaScript never rewrites float hash bytes. Alpha's own
verification is a self-check, never independent review, business acceptance,
proof of source authenticity, or settlement authorization. Research still needs
semantic review. Manager USDC and Jobs v0 AGIALPHA remain separate markets;
Alpha results cannot enter the existing Manager SUCCESSOR candidate assembler.

## Français : contrat préparé, exécution indisponible

**L'exécution native Alpha reste BLOQUÉE / NON PROVISIONNÉE.** Seul le rôle
Agent déclare `alpha-run`. Le champ unique `workSpec` conserve le texte JSON
UTF-8 exact. Les seuls travaux admis sont l'allocation, la planification, la
prévision et la recherche dans les sources fournies. Aucun code, modèle, accès
réseau, commande, chemin d'interpréteur ou manifeste fourni par la tâche ne peut
élargir les permissions.

Fleet conserve l'approbation explicite, les identités et engagements exacts,
la réservation à usage unique et STOP. Une erreur conserve la réservation et
STOP. Les cibles x64 et ARM64 n'ont aucun paquet approuvé : l'admission refuse
avant de créer une autorisation ou une réservation. Aucun repli vers Python ou
un shell de l'hôte n'est permis. L'autovérification Alpha ne vaut ni examen
indépendant ni autorisation de règlement. Les marchés Manager USDC et Jobs v0
AGIALPHA restent distincts. Aucun résultat synthétique ne qualifie l'isolation
native, une distribution opérateur ou un usage financé.

## Fleet supports a stricter output-size subset

Alpha's separate signed-artifact allowance is not a Fleet execution allowance.
Fleet does not promise to run every Alpha-valid mission. Before creating any
Fleet grant, `validateAlphaInput` derives an intentionally conservative byte
upper bound from the pinned output structures:

- Every normalized mission number is budgeted at 32 JSON bytes; strings use their
  exact UTF-8 JSON-quoted size. Arrays and objects include delimiters and keys.
- Research budgets eight findings with both claim and quote, the longest possible
  1,200-code-point quote, and all supplied source IDs/titles/URLs/hash metadata.
- Allocation budgets every individual in the allowed Pareto population selecting
  every input item, plus all three numeric objectives per individual.
- Schedule budgets every operation, its copied job/machine IDs and three numeric
  values, plus the complete order list. Forecast budgets both holdout arrays and
  the requested future horizon, with all fixed fields accounted for separately.
- With M the mission bound, R the result bound, and I the exact input byte count,
  the work envelope is bounded by 4,096 + 2M + 3R + 4 ceil(I/3). This includes
  JSON-escaped canonical mission/result strings, the result object, exact base64
  input, the self-check and fixed envelope fields. The validator is bounded by
  4,096 + 2M. Quoting can at most double the existing UTF-8 JSON bytes; these are
  upper bounds rather than measured average expansion factors.
- The durable Fleet receipt budgets both raw JSON files escaped again plus 8,192
  bytes of metadata allowance. Admission requires a work-envelope bound no larger
  than 480,000 bytes and a receipt bound no larger than 1,900,000 bytes, below the
  existing Alpha 512,000-byte work-result and Fleet 2 MB output ceilings.

A predicted excess returns `ALPHA_OUTPUT_BUDGET_EXCEEDED` before a grant or run
reservation exists, with guidance to reduce the scenario. Actual validator and
executor output must also fit the granted bounds. Large escaped-text research,
large schedules and long forecast holdouts can therefore be refused even when
Alpha itself accepts the input. These bounds must be reviewed whenever the
pinned Alpha result structure changes. Wall and CPU limits remain unchanged.

## Import and dependency closure

The candidate's `fleet_work` imports `work`, `work_spec`, `models` and `store`.
`work` imports `simulation.mats`; the simulation/evaluator/self-edit package
initializers add further modules. `import-closure.json` records the 24 source
modules observed while running the four deterministic contract fixtures. This
is development evidence, not a complete artifact manifest or trust anchor.

The required locked dependency subset is copied, with upstream wheel/sdist
hashes, to `requirements-fleet.lock`:

- Pydantic, pydantic-core, annotated-types, typing-extensions, typing-inspection
- numpy and PyYAML
- cryptography, cffi and pycparser (including conservative native backend closure)

The original `requirements-agent.lock` SHA-256 is retained. HTTP clients, FastAPI,
chain signing packages and model SDKs are not needed for these four work kinds.
Optional `agents`, `google_adk`, `faiss` and `sentence_transformers` imports must
remain absent from the isolated package. The host Python environment cannot be
used: it may contain optional code and has different dependency versions.

## Required next phase: reviewed, reproducible runtime and real native evidence

1. Build one immutable, architecture-specific **frozen directory artifact** on
   disposable Ubuntu 24.04 x64/ARM64 workers. A pinned CPython standalone directory is the preferred next experiment because
   it preserves the two fixed `-m` entry points; a pinned PyInstaller onedir build
   is an alternative, not yet selected or qualified. Pin CPython,
   build tools, every selected dependency wheel and the exact Alpha commit.
   Install only the hash-locked subset with no dependency discovery. Retain
   compiler/toolchain, native-library/loader closure, licenses and SBOM. Prefer
   onedir over self-extracting onefile, which adds executable temporary state.
2. Reproduce the build and inspect the full packaged import graph. Include the
   interpreter, standard library, extension modules, dependent ELF libraries,
   loader and required resources. Prove optional SDKs and ambient site-packages
   cannot load. A self-describing manifest is not authority. Fleet's separately
   reviewed per-architecture trust lock must name the exact artifact digest,
   source/lock provenance and qualified entry points. Missing or changed bytes
   must fail closed. Do not invent pins from a local development environment.
3. Materialize through a separate reviewed provisioning path and verify all
   paths, modes and bytes against those trusted pins. Mount only the immutable
   runtime closure and fixed entry points. Do not reuse the ordinary Node
   sandbox's broad host library mounts for Python. No host home, credentials,
   arbitrary source path, writable host directory or network is exposed.
4. Run the pinned, read-only spec validator on the exact spec bytes; preserve
   its canonical normalized-mission bytes. Launch only the pinned Fleet-work
   entry point with those same exact bytes on stdin. Compare validator and
   result bindings, including canonical mission/result bytes. No generic shell
   or command option is introduced. Recheck source, package, host, boot and grant
   generation immediately before durable dispatch and again before launch.
5. Keep the existing maximum 15-second wall and 10-second CPU bounds or stricter,
   bounded stdout/stderr and process-group cancellation. Use no-network private
   namespaces, drop capabilities, `--die-with-parent`, a new session and bounded
   temporary storage. Record cleanup positively before success. A Python memory
   policy needs its own enforced/observed bound; Node's V8 heap setting cannot
   be advertised as a Python heap limit.
6. Qualify the **exact artifact and Fleet source** using real bubblewrap on both
   architectures, including all four work kinds, defaults/Unicode/numeric edge
   cases, no network/host secrets/writes, cancellation/STOP, process cleanup,
   expiry/replay, package mutation and grant/host/boot drift. Retain raw logs and
   artifact hashes. Native results must not skip on incompatible hosts, and
   synthetic backends never count. Review the saved package independently before
   any native enabling change. Release lanes and inventories require a separate
   explicit integration review.

## Current checks and limits

`node --test local-runtime/tests/alpha.test.mjs` exercises contracts and existing
supervisor boundaries with explicitly labeled synthetic backends. The four
golden outputs come from the exact pinned upstream fixture. Its SHA-256 and source
commit are retained, and the fixture can be reproduced with the development-only
`local-runtime/alpha/build-contract-fixtures.py` tool. Dependency qualification is
not established by that upstream fixture. These are serialization vectors only. Native Alpha execution, frozen
artifact builds, per-architecture package qualification, physical commissioning,
live providers and settlement are **NOT_RUN / UNPROVISIONED**.

## Practical candidate-build CI resources

Use two disposable Ubuntu 24.04 jobs, x64 and ARM64, matching the existing
qualification matrix. Build-only network access fetches the exact reviewed
CPython archive and hash-locked wheels; execution gets no network. A separate
read-only candidate-build workflow can retain the archive, unpacked-tree digest,
source/lock provenance, ELF dependency audit, licenses/SBOM, two-build comparison
and all four-kind contract vectors without populating the runtime trust targets.

The official [Python Standalone Builds distribution contract](https://docs.astral.sh/python-build-standalone/distributions/)
describes self-contained install-only archives and their libc compatibility
requirements. The builder must obtain and review actual architecture-specific
release digests before adding them to its build-input lock. A version label or a
runner's ambient Python is insufficient. Include the measured loader/libc/native
library closure rather than inheriting `/lib` or `/usr/lib` from the operator.

If PyInstaller is chosen instead, its [Linux packaging documentation](https://www.pyinstaller.org/en/stable/usage.html)
explicitly leaves libc outside the ordinary bundle, so a frozen executable alone
is not the complete pinned closure. Its [operating-mode documentation](https://pyinstaller.org/en/stable/operating-mode.html)
also explains why onefile extraction conflicts with a no-execution temporary
filesystem. Preserve any internal library symlinks only through a reviewed,
non-escaping topology; never trust arbitrary archive links.

Actual qualification additionally needs a non-privileged runtime account,
trusted root-owned bubblewrap/prlimit, working private namespaces and supported
IPC. This executor does not satisfy those host prerequisites. Candidate output
can be built and measured in CI before an operator-enable change, but such an
experiment cannot self-approve its manifest or clear the unprovisioned gate.
No model keys, chain credentials, live spending or deployment are required.
