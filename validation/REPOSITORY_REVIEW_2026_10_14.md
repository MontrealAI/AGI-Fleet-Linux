# Repository and website maintenance review — 14 October 2026

Reviewed basis: `3ae48525c6db76c6bd9e84ad9c3e56f3838aac74` on `main`.

This record covers the maintenance changes accompanying it. It is not a production qualification, saved-installer acceptance, physical commissioning result or assessment of pending PR #33. Published release manifests and archives retain their existing identities and classifications.

## Verified defects and corrections

| Finding | Correction and regression protection |
| --- | --- |
| `macos/build.py` compared the Mac 1.20.2 baseline with the moving Linux published pointer. Both Mac specification tests failed after Linux advanced beyond 1.0.10. A second build precondition compared the current Linux source mirror with that old input. | Pin the complete original Linux 1.0.10 identity independently of the active download pointer. Verify the actual saved baseline archive, all manifests, source bytes and modes, plus the expected source inventory digest and count. Do not use the newer Linux mirror as that Mac input. Test altered pins, newer or absent pointers, wrong source identities and archive-verification failure. |
| EN/FR landing pages overflowed at 320 px and tablet widths; the French header reached 914 px in a 768 px viewport. Long headings could clip inside the hero, and enlarged text caused further overflow. | Wrap navigation, constrain grid children, wrap long headings and stack the tablet hero. Test document width, clipping and navigation overlap at 320, 390, 768, 1024 and 1440 px with root text sizes of 100%, 125% and 200%. |
| The Node diagram label overlapped central Fleet content at tablet widths. | Move the label below the central content on larger screens. Check diagram-label intersections and retain screenshots. The diagram and its accessible description remain present. |
| Landing-page step numbers and footer text failed automated contrast checks: approximately 4.46:1 and 4.32:1 respectively. | Darken both text colors. Run unsuppressed axe A/AA checks on both landing pages at desktop and mobile widths. |
| The website browser suite exercised guides and Builder journeys, but not the main landing-page controls. | Add eight EN/FR cases covering layout, contrast, six role commands and keyboard selection, copy success/fallback, accent-insensitive search, empty/reset results and preparation-check wording. |

The original Mac builder and its tests are retained byte-for-byte under `successor/history/`. Their hashes are still checked against the unchanged preservation baseline. Current tooling has new regression checks; no historical evidence is relabelled. Repository checks now run the Mac engineering suite on every PR and main push.

## Local validation

Host: Linux x64, Python 3.12.14, Node 24.19.0, Chromium headless shell 139.0.7258.5. The browser harness and axe dependencies came from the repository lockfile. Release workflows require their separately pinned Node/browser runtimes; these local results do not replace them.

| Check | Observed result |
| --- | --- |
| Repository metadata and 5,914-file Fleet source identity | PASS |
| Original paths, executable modes, anchors, diagrams and historical records | PASS |
| Engineering Python suite | 120 passed |
| Mac engineering Python suite | 92 passed |
| Mac runtime Python overlay suite | 9 passed |
| Mainnet observer/source Node regressions | 9 passed |
| Mac runtime/source-path Node regressions | 17 passed |
| Linux platform Node regressions | 14 passed |
| Complete website browser suite | 58 passed, including eight new landing-page cases |
| Built website content and local destinations | 21 files, 10 HTML pages, 414 links; PASS |
| Shell syntax | 97 Fleet shell scripts passed `bash -n` |
| Retained Manager 1.14.0 and 1.15.0 evidence audits | PASS; replay of historical evidence only |
| Patch whitespace | `git diff --check` passed |

The browser suite blocks non-local requests. Main landing pages were also visually inspected at narrow and tablet widths. The public website was opened separately to confirm its existing navigation and qualification labels; local screenshots describe the proposed maintenance changes, not an already deployed revision.

## Limits and remaining gates

The unchanged Local Runtime suite was explored as an additional check: 39 cases passed and four recovery/transport cases could not pass in this execution environment because Unix-domain sockets are prohibited (`EPERM`). These are **not recorded as passing**. Run the existing Local Skills qualification workflow on its supported disposable Linux hosts for socket and isolation evidence.

No fresh Linux or Mac installer archive was built or qualified locally. The exact-commit hosted workflows must validate their own saved archives and retain their logs before any new installer publication. A tooling repair does not authorize replacing existing release assets.

Physical M1/M2 and Linux installation, OS isolation, real OAuth/model competence, positive cleanup, reboot recovery, independent live review, billing observations and endurance remain governed by their separate open ledgers. No funded job, provider spending, wallet transaction or production-readiness claim was made during this review.
