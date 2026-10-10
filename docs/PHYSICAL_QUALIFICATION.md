# Physical Linux acceptance ledger

Native acceptance is complete for Linux 1.0.9 on both supported architectures. This ledger records what still needs observation on a dedicated Ubuntu Desktop 24.04 machine. Follow [FRESH_INSTALL](FRESH_INSTALL.md) in order, using new separate signer and compute accounts. A previous role or host's PASS cannot qualify another role or host.

Copy [the blank JSON ledger](physical-qualification-template.json) to a private directory outside the application tree. Record only sanitized observations. All gates begin NOT_RUN; set a gate to PASS only after retaining its actual evidence. Do not include a setup kit, wallet, mnemonic, bearer token, OAuth store, raw provider response, or user document in a public report.

| Gate | Required observation | Initial status |
| --- | --- | --- |
| Release integrity | Exact ZIP hash; Verify-Linux passes all seven inventories | NOT_RUN |
| Fresh setup | Distinct new nonadministrator accounts; setup transaction completes | NOT_RUN |
| Rootless runtime | Private compute socket; enforced memory, CPU, PID and cgroup v2 limits | NOT_RUN |
| Authentication | Creator, Checker and Reviewer OAuth; successful real inference | NOT_RUN |
| Local document | Qualify-Linux creates and rereads a DOCX in a real restricted container | NOT_RUN |
| Live work | Actual synthetic document deliverables open correctly | NOT_RUN |
| Cleanup | Positive base and browser postconditions after each live job; no unexplained containers or STOP | NOT_RUN |
| Reboot | Same authenticated runtime identity and persisted signer approval; another live cycle passes | NOT_RUN |
| Local repetition | 50 local cycles pass; no retained qualification containers | NOT_RUN |
| Endurance | 72 elapsed hours; observations at start, reboot, every 12 hours and end; live cycles and cleanup pass | NOT_RUN |
| Interruption | Suspend/restore and network interruption fail closed, with a reviewed recovery record | NOT_RUN |

Record the OS, architecture, role, versions, policy digest, start/end timestamps, and sanitized evidence paths for each gate. Record any failure immediately with its stage and error code. Retain the local support report and STOP; do not delete them to obtain a green ledger. A failure requires diagnosis before advancing.

The ledger documents one host and role. It does not automatically authorize production, transactions, paid jobs, public browsing, or other roles. The native suite cannot supply these physical observations.
