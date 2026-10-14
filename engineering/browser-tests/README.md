# Onboarding browser checks

These tests exercise the built English and French public guides on a local HTTP server. They do not install Fleet, open third-party websites, submit jobs or use a wallet. All browser requests outside the local server are blocked.

From the repository root, with Python 3 and Node.js 22 or later:

```bash
python3 engineering/build-website.py
npm ci --prefix engineering/browser-tests
cd engineering/browser-tests
npx playwright install --with-deps --only-shell chromium
npm test
```

The Mac setup companion is also checked in English and French: all eight steps, role changes, explicit checklist marks, saved progress, printing every step, blocked storage, JavaScript-free reading, 320-pixel reflow and keyboard focus. Automated axe checks cover every companion step with larger text.

The suite checks actual navigation and browser history, unsupported computers, saved choices and storage failures, language changes, keyboard focus, printable plans, clipboard fallback, JavaScript-free reading, narrow-screen reflow and automated accessibility rules. It opens only the site files served from `_site/` on `127.0.0.1:4173`.

The main English and French landing pages are checked too: navigation and content reflow from 320 to 1440 pixels with text at 100%, 125% and 200%, desktop/mobile axe scans, all six role commands, keyboard activation, clipboard success and fallback, accent-insensitive guide search and preparation checks. Passing screenshots at 320, 768 and 1440 pixels are retained. These checks prevent a guide-only pass from overlooking landing-page clipping or contrast failures.

Screenshots, failure traces and attachments go to `test-results/`; the HTML report goes to `playwright-report/`. The Pages workflow publishes the test artifacts for review, and a failing test prevents site publication. Mobile and desktop screenshots are attached even on a passing run.

Automated axe checks cover the welcome and selected-plan screens in both languages using WCAG 2 A/AA, 2.1 A/AA and 2.2 AA tags. They complement human review: they cannot establish complete WCAG conformance, usability with every assistive technology, installation success or capacity for billions of visitors.

Keep failures actionable. Correct the public page when a supported journey or accessibility rule fails; do not suppress rules or exclude page regions to make the suite pass.

With `FLEET_TEST_ROOT` pointing to an extracted, verified candidate and `FLEET_TEST_METADATA` to its `release.json`, the same command runs the saved-archive bridge journey. It creates and exports a mission through the Builder UI, separately authenticates and authorizes Agent execution and Node review through the installed HTTP endpoints, checks the returned capsule, explicitly chooses the improved version, and downloads its HTML. Fresh browser contexts then restore and rerun it fully offline in English and French, comparing the actual artifact bytes. `journey.json`, its SHA-256 binding, screenshots and `evidence.json` are retained for the release audit.

The provider transport, immutable-input transport and sandbox CLI remain explicitly simulated fixtures around the actual Controller, Studio, Companion and ComputeWorker. Real Chromium effects and protocol authorization do not establish live-provider competence, Docker isolation, independent review ownership or paid settlement.
