# AGI Fleet Linux 1.0.11

**Engineering and physical-qualification candidate — Evidence edition.**

Native acceptance for this exact release must be published before a controlled fresh installation. Production qualification is pending. Physical qualification remains pending. Earlier releases' results do not qualify this ZIP.

1. Read the [Linux fresh-install guide](docs/linux-current/docs/FRESH_INSTALL.md).
2. Check the [release status](docs/linux-current/README.md) and exact SHA-256 on the release page.
3. Follow the guide using new, separate signer and compute accounts. Keep the complete Fleet folder.
4. Record each physical gate in the [qualification ledger](docs/linux-current/docs/PHYSICAL_QUALIFICATION.md).

The supported target is Ubuntu Desktop 24.04 LTS, x86-64 or ARM64. Use the Linux `.sh` entry points named in the guide. Agent, Node, Moderator, Employer, Evidence and Recovery retain separate bounded authority.

On any failure, preserve accounts, state, reports and COMPUTE_STOP. Follow the guide's failure instructions. Never remove STOP manually or weaken ownership and cleanup checks.

[AGIJobManager integration](docs/linux-current/docs/JOB_INTEGRATION.md) · [Mainnet deployment observation](docs/linux-current/docs/MAINNET_DEPLOYMENT.md)

Historical Mac instructions and prior evidence remain available for engineering traceability. Begin with the current Linux guide above.
