# Candidate image; pass a recorded repository@sha256:digest Node 24 base.
ARG AGI_PROXY_NODE_BASE
FROM ${AGI_PROXY_NODE_BASE}
WORKDIR /opt/agi
RUN node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major!==24||minor<19) throw Error("PUBLIC_WEB_NODE_VERSION_UNQUALIFIED")'
COPY public-web-proxy.mjs public-web-policy.mjs /opt/agi/
LABEL ai.montreal.agi.public-web.recipe="candidate-v1"
USER node
CMD ["node", "/opt/agi/public-web-proxy.mjs"]
