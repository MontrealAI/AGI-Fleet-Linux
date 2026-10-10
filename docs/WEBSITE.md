# Maintain the AGI Fleet Linux website

The public operator guide lives at **<https://montrealai.github.io/AGI-Fleet-Linux/>**. Its editable source is [`website/`](../website/). The build reads `engineering/published-release.json` when present. This is an unchanged copy of a verified manifest downloaded from an actually published release. Until that pointer exists, the build uses the frozen [`engineering/current-release.json`](../engineering/current-release.json) acceptance baseline. The baseline remains unchanged when a new release is published.

## The guided welcome is the main entrance

Link newcomers to **[Start here](https://montrealai.github.io/AGI-Fleet-Linux/start.html)** or **[Commencer](https://montrealai.github.io/AGI-Fleet-Linux/start-fr.html)**. Keep these links prominent in the README, homepage navigation, hero and welcome section. The homepages retain the deeper technical guidance, release evidence, work modes and existing diagrams.

`website/start.html` and `website/start-fr.html` contain the English and French guided welcome. `website/onboarding.css` and `website/onboarding.js` provide its presentation and progressive enhancements. Keep the two languages equivalent. Stable starting points `#hire`, `#computer` and `#explore` let the homepages link to requesting work, preparing a worker and learning the basics.

The guided page helps people choose a path; it does not install software, create a wallet or qualify a computer. Its operator handoff must remain linked to the real [fresh-install guide](FRESH_INSTALL.md), verified release assets and [physical qualification ledger](PHYSICAL_QUALIFICATION.md). Explain administrator access, technical help and setup costs before that handoff. Direct people who want work done to AGIJobManager’s employer onboarding.

Keep ordinary reading and navigation usable without JavaScript. Use large text and controls, visible keyboard focus, clear Back actions, an “I’m not sure” choice, reduced-motion support and printable preparation guidance. Ask only for simple onboarding choices: never request passwords, wallet recovery words, setup JSON, OAuth data, private documents or other sensitive content. Do not add tracking or claim the guide is a live installer or readiness check.

## Preview a change

From the repository root, using Python 3.10+ and Node.js:

```bash
python3 engineering/build-website.py
python3 engineering/check-website.py
node --check website/app.js
node --check website/onboarding.js
python3 -m http.server 8000 --directory _site --bind 127.0.0.1
```

Open **http://127.0.0.1:8000/**. Stop the preview server with Ctrl+C.

Edit the homepage templates (`website/index.html`, `website/fr.html`), guided welcome templates (`website/start.html`, `website/start-fr.html`) or their local CSS/JavaScript assets, then rebuild and reload. Do not edit `_site/`: it is generated. Keep normal content and links usable without JavaScript; the script supplies progressive enhancements.

Before publishing, check both languages at desktop and narrow mobile sizes, keyboard navigation, readable zoom, links, disclosure controls, language selection and copy buttons. Exercise every guided route, browser Back, the no-JavaScript fallback and printed preparation guidance. Verify that the displayed release and qualification statements match the source evidence. Repository links belong on GitHub; only the public site files are uploaded to Pages.

## Publication

The [`Website / GitHub Pages` workflow](../.github/workflows/pages.yml) builds and validates pull requests without publishing them. Merging an applicable change to `main` builds a new artifact and deploys it to the `github-pages` environment. The workflow also supports **Actions → Website / GitHub Pages → Run workflow → main**.

The initial repository setting is **Settings → Pages → Build and deployment → Source → GitHub Actions**. This is a one-time administrator setting. The deployment token deliberately has only Pages write and OpenID Connect permissions; it cannot enable Pages through repository administration. A Pages configuration error requires correcting that setting before rerunning the failed deployment.

Official GitHub actions are pinned to full commit hashes. The build has read-only repository access. Only the deployment job receives `pages: write` and `id-token: write`, and it runs only on `main`. Pull requests cannot deploy. Upload is limited to `_site/`; the Fleet source, dependencies, profiles and runtime state are never part of the upload.

After a successful run, open the workflow's deployment URL and confirm the expected release, guided welcome, working navigation and downloads. The Pages workflow verifies the SHA-256 of every public asset against the built artifact, including the guided HTML, CSS and JavaScript. If GitHub Pages briefly shows an older page, reload after the deployment completes. Do not claim publication from a successful build alone: the deployment job must succeed and the public URL must serve the new page.

## Point the website at a newly published release

Only after the release publisher succeeds and the public release assets are verified:

1. Download the exact `Release-Manifest-vVERSION.json` asset and its published `SHA256SUMS-vVERSION.txt`. Verify the manifest's checksum and confirm the matching tag, archive identity, workflow commit/run and published (not draft) release in GitHub.
2. Save the manifest **unchanged** as `engineering/published-release.json`. Do not synthesize this file from a candidate, edit acceptance to PASS, or alter `engineering/current-release.json` or a historical audit.
3. Build and check the website, review both languages, and confirm the new archive/checksum and immutable release-asset evidence links. Merge the reviewed pointer update through the normal workflow, then confirm successful Pages deployment and the live page.

The pointer uses the publisher's `agi-linux-published-release/v1` schema. It includes `version`, `tag`, `name`, `bytes`, `sha256`, `sourceRevisionSHA256`, `sourceFiles`, `workflowCommit`, `workflowRun`, expected `native.targeted`/`native.complete` counts, `nativeAcceptance`, `jobIntegrationAcceptance`, `operatorGate`, `productionQualified`, `physicalQualification`, the inline `audit`, and the `evidence` archive identity. Additional publisher fields are preserved in the public `release.json`.

The current published-pointer contract requires audited native and integration PASS for both x64 and ARM64, matching workflow/source/archive identities, complete native counts with no failures/skips, `productionQualified: false` and physical qualification `NOT_RUN`. A future release with a different qualification scope needs an explicit renderer/validator review. Unknown or malformed pointer data stops the build; it never silently falls back to the older release.

The builder normalizes the inline audit for display without changing the manifest data. Native audit and release-manifest links point to the versioned manifest asset; integration evidence points to that release's versioned evidence ZIP. The offline build validates the recorded evidence relationships; it does not contact GitHub or prove that publication occurred. The verification in step 1 is therefore required. Never add a pointer merely because a candidate build or a local site preview passed.

## Validation and maintenance

`engineering/check-website.py` runs offline. It verifies the public-file allowlist, UTF-8 text, bounded file sizes, template substitution, basic document accessibility, unique section IDs, local assets and anchors, and links to files in this repository. It also requires the public release JSON to match the selected reviewed manifest and all four rendered HTML pages to match the current templates and release data. It rejects symlinks, unexpected files, obvious credentials, external assets and links that escape the project path. These checks complement review; they are not a comprehensive secret scanner or accessibility audit. They do not request third-party pages or certify the availability of external websites.

The “Potential and scope” sections in both languages summarize [`POTENTIAL_AND_SCOPE.md`](POTENTIAL_AND_SCOPE.md) and [`POTENTIEL_ET_PERIMETRE.md`](POTENTIEL_ET_PERIMETRE.md). Keep their task examples, current access boundaries, payout illustration and qualification language aligned. Examples are prospective unless linked to observed customer evidence.

Update release metadata only with reviewed evidence. Preserve the difference between native acceptance, contract integration and physical qualification. An observed mainnet state is a dated snapshot, not a live status feed. Keep release archives on GitHub Releases and never place operator profiles, wallets, setup JSON, OAuth data, provider responses or user documents in `website/`.

For rollback, revert the website change through the normal reviewed Git workflow, merge to `main`, and let Pages deploy the restored site. Website deployment does not modify Fleet runtime code, release archives or on-chain configuration.
