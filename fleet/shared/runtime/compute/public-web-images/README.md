# Protected public browser: commissioning and limited technical qualification

Public browsing is disabled in the delivered configuration. This release implements the normal Compute → pinned OpenClaw 2026.9.6 → protected browser route. It does not include a real-Mac qualification receipt, live provider results, or proof of commercial readiness.

The custom `agi_public_browser` tool receives its agent and session identity from the OpenClaw tool factory. Its private Unix socket is outside every sandbox. The coordinator maps that identity to one accepted specification, role, approved grant and actual browser container. CDP uses authenticated Docker stdio, with no published browser port. The native `browser`, `web_fetch` and `web_search` tools remain denied; ordinary shell execution keeps Docker `network:none`. No per-job gateway configuration change or policy reseal is needed.

## Prepare the immutable images

Use the dedicated Standard compute account. Keep both wallet authority and the independent reviewer's private key outside compute and outside containers.

From the companion's `compute` directory, build against reviewed immutable bases:

```sh
docker buildx build --load --file public-web-images/browser/Dockerfile \
  --build-arg AGI_BROWSER_BASE='APPROVED_REPOSITORY@sha256:APPROVED_DIGEST' \
  --tag agi-public-web-browser:candidate-v1 .
docker buildx build --load --file public-web-images/proxy/Dockerfile \
  --build-arg AGI_PROXY_NODE_BASE='APPROVED_NODE_REPOSITORY@sha256:APPROVED_DIGEST' \
  --tag agi-public-web-proxy:candidate-v1 .
```

Uppercase values are placeholders. `publicWebImageBuildPlan()` in `public-web-isolation.mjs` also supports approved local OCI-layout contexts. Record the base digests, recipe hashes, platform, versions, complete build output and the resulting `sha256:` image IDs. Mutable tags are not accepted as execution authority.

The Node base must provide Node 24.19 or later within 24.x. The browser base must implement the bundled OpenClaw 2026.9.5 entrypoint, Python 3 and `/usr/bin/chromium`, and launch Chromium through `PATH`. Build-time pattern checks cannot establish that a real browser launches correctly on a particular Docker Desktop installation; commissioning checks that separately.

## Enable the fixed commissioning exercise

1. Export and install the capable-compute kit from the signer account. New kits carry only the public task-approval key; its private key stays in the encrypted signer vault. Older kits without this key remain offline.
2. Obtain the independent reviewer's public Ed25519 SPKI PEM through a trusted channel. It must be distinct from the task-approval key. Pin it before collecting any qualification evidence.
3. Create an owner-private proposal JSON with `schema: "agi-public-browser-policy-proposal/v1"`, `mode: "commissioning"`, the exact `browserImageID` and `proxyImageID`, and `reviewerPublicKey` containing that public PEM. Do not put a private key in this file.
4. Run `./Configure-Public-Browser.command --proposal /absolute/path/proposal.json` from the companion directory. It prepares the normal transactional repair, stops the managed services before publication and requires the exact security-diff approval. OAuth, work history and tighter role restrictions are preserved. All installed plugin and compute source bytes are covered by the policy seal.
5. Return to the signer UI, connect to compute and approve its changed runtime identity and reviewer fingerprint. Use the protected public-browser commissioning control. Its explicit checkbox authorizes the fixed exercise's provider calls and local Docker work. It does not authorize publication, wallet operations, paid settlement or an arbitrary task.

The fixed exercise visits `https://example.com/`, writes an actual structured observation and requests an independent browser review. The normal allowance, request journal, runtime checks, cancellation and scoped cleanup paths remain in force. Gateway tool-call events and host CDP actions are correlated. Model prose by itself is not browser evidence.

To disable the candidate, use another reviewed proposal with the same schema and `mode: "disabled"`. Handwritten `mode: "qualified"` proposals are rejected.

## What the protected tool permits

The accepted specification has separate `publicWeb.agent` and `publicWeb.reviewer` scopes. Each declares exact hostnames, ports, limits and optional `interactions`. The default is `inspect` and `navigate`. `form` must be explicitly included in that role's accepted scope and signer-approved grant.

The tool supports navigation, text/title/heading snapshots, numbered links, screenshots and scrolling. With `form` authority it also supports bounded text entry and permitted form controls. Password, file and hidden inputs are excluded. Form references are tied to a fresh inspected document; changes invalidate them. Text is set on the exact validated element in one fixed isolated-world operation, so hostile focus redirection cannot send it to a password field. Callers cannot supply script, CDP methods, selectors, browser profiles or alternate session IDs.

Public content remains untrusted. Form authority permits external interactions for the exact task; it cannot automatically classify every semantic side effect. This is not a general read-only guarantee, an encrypted URL-path/content firewall, or permission to log in, transfer money or contact people outside the accepted scope.

## Review the measured evidence

`public-web-qualification-collector.mjs` runs only after explicit local-runtime authorization in an active commissioning session on the Mac. It records bounded command results, not invented PASS rows:

- Positive proxy-container DNS, TCP and UDP controls are paired with direct-egress attempts from the actual browser container.
- The actual browser's unauthorized proxy requests must be rejected, and its permitted protected navigation must produce a real page observation.
- Deterministic mixed-DNS, rebinding, redirect-reauthorization and private-address fixtures execute against the installed proxy module inside the exact proxy image. Those DNS/redirect fixtures are explicitly synthetic, even when run on the Mac.
- Cleanup and the normal Gateway/browser evidence must complete before independent review.

Download the qualification evidence from the signer UI. An independent reviewer uses the strict receipt verifier and their separately held key to sign only an exact-runtime-bound record. A signature authenticates that review; it cannot establish honesty against a dishonest reviewer key holder.

Import a genuine reviewed receipt in the Standard compute account with `./Import-Public-Browser-Qualification.command --receipt /absolute/path/reviewed-receipt.json`. The importer verifies the current source, images, binaries, policy, observed controls, Gateway evidence, cleanup, reviewer and expiry; stops both services; shows the exact transition; and requires explicit import. It leaves services stopped. Restart them deliberately and approve the new runtime identity in the signer UI. Runtime use rechecks the receipt and its expiry. A repair or source change requires fresh review and qualification.

The receipt's scope is **bounded public-web transport**, not full production or paid-settlement qualification. Three residual measurements remain explicitly **NOT_TESTED**: controlled host/private reachability, external authoritative DNS rebinding, and real cross-host redirects. Separate production acceptance still needs those adversarial fixtures, independent security review, recovery/soak evidence and real commercial settlement proof. No such receipt or result is supplied with this release.

## Boundary and local tests

The browser has one internal network with an isolated gateway, no host mounts, no added capabilities, IPv6 disabled and a read-only root. Only the proxy has an egress network. Chromium is forced through it without proxy fallback; HTTP/2, QUIC, ECH and non-proxied WebRTC are disabled. The proxy checks every DNS answer, pins the connected IP, checks the remote tuple and reauthorizes new destinations. TLS verification is not disabled. `maxRequests` counts proxy HTTP requests and CONNECT admissions; it cannot count every encrypted request inside a TLS tunnel. Request, connection, byte and expiry limits are enforced independently of model behavior.

Run the focused tests from a companion directory:

```sh
node --test tests/public-web-proxy.test.mjs tests/public-web-isolation.test.mjs \
  tests/public-browser-integration.test.mjs tests/public-web-collector.test.mjs
```

These local tests include synthetic Docker/provider fixtures and real loopback HTTP/WebSocket transport. Unix-socket tests explicitly skip where the host forbids socket binding. Passing them does not imply an actual Mac, Docker Desktop, Chromium or live-provider run succeeded.
