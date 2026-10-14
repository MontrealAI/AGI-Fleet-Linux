# Frozen Alpha candidate tooling

**Candidate only. Production Alpha execution stays UNPROVISIONED.** This separate
workflow can build and test reviewed bytes; it cannot populate Fleet's operational
trust lock, launch a Fleet task, issue a grant, publish a release or settle work.
The input lock is build configuration, not an installation authority. A candidate
manifest is an inventory, never self-approval.

## Verified build inputs

`inputs.lock.json` pins official CPython standalone 3.12.15 / 20261013 assets for
Linux x64 and ARM64. Both downloaded archive hashes were checked against the
[Astral release API](https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/20261013).
It pins ten architecture-compatible wheels selected from the existing Alpha hash
lock, with official PyPI version metadata URLs. No resolver, setup.py, wheel
installer hook, pip, third-party freezer, model SDK or package code runs at build
time. Downloads use exact HTTPS URLs, byte lengths and SHA-256; missing, replaced
or unavailable bytes stop the build rather than select a newer package.

The rootfs includes explicit Ubuntu noble / noble-security `libc6` 2.39-0ubuntu8.9,
`libgcc-s1`, `libstdc++6`, `zlib1g`, `libcrypt1` and the compiler runtime license dependency `gcc-14-base` 14.2.0-4ubuntu2~24.04.1. Their
actual downloaded SHA-256 values match official architecture package indices;
those URLs and index digests are recorded. This is HTTPS metadata corroboration,
not a claim that this tool verifies Ubuntu OpenPGP signatures. No maintainer
script is run. NumPy's selected wheels require glibc >=2.27. No operator `/lib`,
`/usr/lib`, loader cache, host Python or site-packages enter the candidate mount.

All source modules are exact Git blobs from Alpha 2355b3cb198a6fb2c948744d283f108ab6ce5ebc.
The deterministic work closure also retains `surrogate_fitness.yaml` and Alpha's
license. Optional agents/google_adk/faiss/sentence_transformers remain absent.
The official interpreter's bounded-work stdlib/native closure remains included, but optional Tcl/Tk (which contains build-host RPATHs),
bundled pip/site-packages and interpreter helper scripts are removed. Wheel
license metadata and distribution copyright files remain in the rootfs.

Static `readelf` checks every ELF file's architecture, class, endianness, loader,
DT_NEEDED, GNU symbol-version requirements and RPATH/RUNPATH resolution inside the packaged closure, without executing `ldd`.
Internal relative links are audited; special files, hard links, escaping paths,
duplicate entries, archive redirects and install hooks fail closed. Static ELF
resolution is necessary but not sufficient: dynamic imports and glibc behavior
must also pass real saved-archive execution on each target. The manifest retains
every file hash/mode, link, ELF edge, source/launcher/builder/input digest and asset
provenance. Timestamps/owner metadata are normalized in the reproducible archive. The build
host's Python/readelf/dpkg-deb executable hashes and Python/zlib versions are
recorded. These distribution build tools are not a separately frozen toolchain;
two builds prove repeatability on that exact host, not cross-toolchain bit identity.
Runtime bytes remain fully pinned independently of those recorded tools.

## Reproduce without executing downloaded code

From a clean Fleet checkout, use an absent output directory outside the source:

```sh
python3 -m unittest discover -s local-runtime/alpha/candidate -p 'test_*.py' -v
python3 local-runtime/alpha/candidate/build.py --target linux-x64 \
  --cache /ABSOLUTE/cache --fetch
python3 local-runtime/alpha/candidate/build.py --target linux-x64 \
  --cache /ABSOLUTE/cache --alpha-repository /ABSOLUTE/alpha-git \
  --output /ABSOLUTE/candidate-first
```

Repeat to a second absent directory and compare archive and manifest bytes.
Both architectures can be assembled by this static builder on either build host.
Building does not establish native capability or qualify Fleet's grant adapter.

## Native candidate qualification

On a disposable, supported, non-root Linux host with trusted root-owned bwrap and
prlimit, run `qualify.py --candidate /ABSOLUTE/candidate-first --evidence
/ABSOLUTE/native-candidate.json --cache /ABSOLUTE/cache --alpha-repository
/ABSOLUTE/alpha-git`. The GitHub workflow uses Ubuntu 24.04 x64 and
ARM64 runners, read-only repository permissions and the existing distribution
AppArmor preparation helper. No secrets or funded accounts are needed. It has no
release, branch write, deployment or activation step.

Qualification first independently reconstructs the artifact from verified official
assets and pinned source blobs; the manifest alone cannot authorize execution.
It then verifies and extracts the exact saved archive, rechecks the full
tree, mounts it read-only as `/`, and runs two fixed launchers with `-I -S -B`.
Those launchers explicitly set only packaged stdlib/source/wheel paths and reject
extra arguments. Validator and work receive the exact same UTF-8 fixture stdin;
all four result and validation outputs must equal the pinned canonical vectors.
Fleet's actual JavaScript contract checks the pre-admission output budget before
each invocation and validates the returned pair; stdout is capped at that exact
per-work bound. The checker uses Fleet's existing hash-pinned Node archive.
An oversized escaped-text research scenario must be refused before any native
invocation. Fourteen native refusal runs cover malformed JSON/UTF-8, duplicate keys, wrong
market/executor, code kind and nonfinite values across both fixed entrypoints.
The fixture data remains synthetic; the observed OS isolation is real candidate
isolation only. A separate fixed probe tests optional imports, absent host files,
read-only source, network isolation, wall timeout, cancellation, CPU and output
limits, and disappearance of observed private PID namespaces/process groups. Detached child
probes acknowledge successful setsid and stdio closure before parent readiness;
CPU success requires SIGKILL and approximately ten consumed child CPU seconds.
Incompatible hosts fail the job and retain failure evidence; tests never skip.

Limits are at most 15 seconds wall, 10 seconds CPU, 512,000 stdout bytes, 8,192
stderr bytes, 4 GiB address space, 1 MiB file size and 128 descriptors. The memory
limit is address space, not Python heap. Temporary files live only in the private
namespace. The harness is development-only and exposes no Fleet task command.

A later separately reviewed change still needs immutable provisioning, trusted
artifact hashes, live grant/source/package/host/boot/generation rechecks, STOP,
one-use reservation and bounded production dispatch. Candidate CI must not be
reported as qualifying those unimplemented production paths or as operator
release/physical/funded acceptance.

## Français

Ces outils produisent uniquement un candidat reproductible. Les cibles de
confiance opérationnelle restent nulles, et l'exécution Alpha dans Fleet reste
NON PROVISIONNÉE. Les téléchargements officiels sont épinglés par taille et
SHA-256. Le chargeur, la libc, Python, les dépendances et les sources sont inclus;
aucune bibliothèque de l'hôte n'est montée dans le travail isolé.

Les deux tâches CI x64/ARM64 utilisent des permissions de dépôt en lecture seule.
Elles conservent l'archive exacte et les résultats, sans publication, déploiement,
règlement ni activation. Les tests natifs doivent réellement réussir sur les
deux architectures; un hôte incompatible échoue sans simulation ni saut de test.
Les scénarios sont synthétiques et l'isolation observée ne qualifie pas encore
les autorisations, réservations à usage unique et STOP du futur adaptateur Fleet.
