# Candidate image; the operator must supply and record an immutable approved
# AGI browser base reference (repository@sha256:digest). No floating default.
ARG AGI_BROWSER_BASE
FROM ${AGI_BROWSER_BASE}
USER root
RUN test -x /usr/bin/chromium && python3 -c 'from pathlib import Path; s=Path("/usr/local/bin/openclaw-sandbox-browser").read_text(); assert "\nchromium " in s and "/usr/bin/chromium " not in s, "PUBLIC_WEB_BROWSER_ENTRYPOINT_UNSUPPORTED"'
COPY --chmod=755 public-web-images/browser/chromium-proxy-wrapper.sh /usr/local/bin/chromium
COPY --chmod=755 public-web-images/browser/agi-cdp-stdio.py /usr/local/bin/agi-cdp-stdio.py
LABEL ai.montreal.agi.public-web.recipe="candidate-v1"
ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
USER sandbox
CMD ["openclaw-sandbox-browser"]
