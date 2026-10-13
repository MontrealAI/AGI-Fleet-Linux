# Mac workspace and larger Studio source preview

This separate development preview brings the current Linux source preview's useful interfaces to Apple silicon Macs:

- **Larger public tasks:** Agent and Node Studio imports for `computer-work/v2`, arbitrary declared file formats, up to 64 files and 64 MiB total, exact-byte review handoffs, revision feedback and explicit large-Studio exclusion from wallet backups.
- **Guided native tasks:** a Mac menu for account checks, provider connection, application registration, descriptors, job drafts, approved pilot execution, operating records and safe stop/resume.

**This is source code, outside the Mac 1.20.1 ZIP.** The ZIP contains the original Mac native-workforce pilot and public Studio. This preview adds the newer interfaces without changing that archive or inheriting its acceptance. Production native grants are disabled. Every physical Mac gate remains `NOT_RUN`.

The native engine remains the original Mac implementation, using the signed OpenClaw Mac app and its approved paired provider. No Linux X11 engine, systemd service or Linux package installer is substituted. The Studio and job composer reuse the current shared implementations.

The generated copy uses the reviewed **Linux 1.0.11 candidate source** plus the reviewed Mac runtime overlay and these preview additions. The reused Linux Studio/composer preview records a historical **1.0.9** basis; `reusedPreviewHistoricalBasis` preserves that provenance separately from `materializedSourceBasis`. Published Mac 1.20.1 and 1.20.2 distributions derive from Linux 1.0.10; their immutable source and acceptance remain unchanged. This generated source tree is a different, unqualified artifact with no bundled dependencies.

## Prepare a separate developer copy

Run these preparation commands only from this repository checkout, with Python 3 and Node 24.19+ within 24.x available. They are not commands for the generated copy:

```sh
python3 macos/preview/check.py
python3 macos/preview/materialize.py --output /absolute/path/to/new-mac-preview
```

Choose a new directory outside the repository and outside every operational installation. The command reads the inventoried sources, creates a disposable copy and writes `PREVIEW-NOT-A-RELEASE.json`. It refuses an existing destination. Keep all of the generated folders together.

In that copy, open `Launch-Native-Workforce.command` or run `node workforce/launch.mjs` to see the Mac menu. The command launcher can prepare the pinned private Node runtime without an administrator installation. It does not install the native OpenClaw app or approve its permissions. Follow [the Mac preview setup guide](QUICKSTART.md).

The source fixture does not bundle npm dependencies. For public Agent/Node Studio, follow [the separate Studio preview guide](STUDIO.md). Its launch commands require explicit new profile paths and unfunded test wallets. A source fixture is not a release installer or a physical-qualification result.

The quick editor remains the existing v1 format. General v2 imports preserve the supplied runtime identities, permissions, criteria, budgets and deadlines; they must describe the actual configured compute service. The public Studio accepts public, isolated-workspace authority. Private or signed-in work belongs to the separate native workflow, never a public Studio upload.

## Verification

Run these test commands from the repository checkout, targeting the generated copy:

```sh
AGI_MAC_PREVIEW_FIXTURE=/absolute/path/to/new-mac-preview node --test macos/preview/tests/*.test.mjs
AGI_WORKSTATION_FIXTURE=/absolute/path/to/new-mac-preview node --test workstation/tests/studio.test.mjs
python3 -m unittest discover -s macos/preview/tests -p 'test_*.py'
```

The Studio suite must use the exact Mac fixture, with its dependencies available. It checks actual controllers, encrypted backup/restore and browser import contracts. Automated tests use fabricated jobs and temporary keys. They do not establish live provider use, rendered browser usability, macOS permission reliability, useful job outcomes or physical M1/M2 qualification.

The source inventory binds this preview, the reused Studio/composer, its historical basis, the Mac runtime overlay, release metadata and preview workflow. After an intentional source change, reviewers regenerate it with `python3 macos/preview/check.py --write-inventory` from the repository checkout. Do not update inventories to conceal an unexplained change or replace operational evidence.
