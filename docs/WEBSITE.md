# Maintain the AGI Fleet Linux website

The public operator guide lives at **<https://montrealai.github.io/AGI-Fleet-Linux/>**. Its editable source is [`website/`](../website/). The build reads the reviewed [`engineering/current-release.json`](../engineering/current-release.json) so release numbers, archive size and checksums are generated from the same record used by the repository.

## Preview a change

From the repository root, using Python 3.10+ and Node.js:

```bash
python3 engineering/build-website.py
python3 engineering/check-website.py
node --check website/app.js
python3 -m http.server 8000 --directory _site --bind 127.0.0.1
```

Open **http://127.0.0.1:8000/**. Stop the preview server with Ctrl+C.

Edit `website/index.html`, `website/fr.html`, `website/styles.css`, `website/app.js` or `website/favicon.svg`, then rebuild and reload. Do not edit `_site/`: it is generated. Keep normal content and links usable without JavaScript; the script supplies progressive enhancements.

Before publishing, check the desktop and narrow mobile layouts, keyboard navigation, links, disclosure controls, language selection and copy buttons. Verify that the displayed release and qualification statements match the source evidence. Repository links belong on GitHub; only the public site files are uploaded to Pages.

## Publication

The [`Website / GitHub Pages` workflow](../.github/workflows/pages.yml) builds and validates pull requests without publishing them. Merging an applicable change to `main` builds a new artifact and deploys it to the `github-pages` environment. The workflow also supports **Actions → Website / GitHub Pages → Run workflow → main**.

The initial repository setting is **Settings → Pages → Build and deployment → Source → GitHub Actions**. This is a one-time administrator setting. The deployment token deliberately has only Pages write and OpenID Connect permissions; it cannot enable Pages through repository administration. A Pages configuration error requires correcting that setting before rerunning the failed deployment.

Official GitHub actions are pinned to full commit hashes. The build has read-only repository access. Only the deployment job receives `pages: write` and `id-token: write`, and it runs only on `main`. Pull requests cannot deploy. Upload is limited to `_site/`; the Fleet source, dependencies, profiles and runtime state are never part of the upload.

After a successful run, open the workflow's deployment URL and confirm the expected release, working navigation and downloads. If GitHub Pages briefly shows an older page, reload after the deployment completes. Do not claim publication from a successful build alone: the deployment job must succeed and the public URL must serve the new page.

## Validation and maintenance

`engineering/check-website.py` runs offline. It verifies the public-file allowlist, UTF-8 text, bounded file sizes, template substitution, basic document accessibility, unique section IDs, local assets and anchors, and links to files in this repository. It rejects symlinks, unexpected files, obvious credentials, external assets and links that escape the project path. These checks complement review; they are not a comprehensive secret scanner or accessibility audit. They do not request third-party pages or certify the availability of external websites.

The “Potential and scope” sections in both languages summarize [`POTENTIAL_AND_SCOPE.md`](POTENTIAL_AND_SCOPE.md) and [`POTENTIEL_ET_PERIMETRE.md`](POTENTIEL_ET_PERIMETRE.md). Keep their task examples, current access boundaries, payout illustration and qualification language aligned. Examples are prospective unless linked to observed customer evidence.

Update release metadata only with reviewed evidence. Preserve the difference between native acceptance, contract integration and physical qualification. An observed mainnet state is a dated snapshot, not a live status feed. Keep release archives on GitHub Releases and never place operator profiles, wallets, setup JSON, OAuth data, provider responses or user documents in `website/`.

For rollback, revert the website change through the normal reviewed Git workflow, merge to `main`, and let Pages deploy the restored site. Website deployment does not modify Fleet runtime code, release archives or on-chain configuration.
