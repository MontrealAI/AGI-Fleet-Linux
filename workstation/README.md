# Authorized Linux workspace

Work toward jobs across installed applications, signed-in services and private files, using a dedicated Linux desktop account.

**Start with the [guided setup](QUICKSTART.md).** From the repository root:

```sh
npm --prefix workstation start
```

The menu helps prepare the account, connect the actual desktop provider, draft a job, inspect readiness, run an approved packet and stop work. Job execution uses signed authority, bounded budgets, independent review and encrypted result handoffs. Whole-account control can reach everything available to that account; keep its access specific to the work.

This is **version 0.1.0-preview.1, a pilot-only development preview**. Production execution is disabled. The [qualification ledger](candidate.json) records physical tests separately, and the [source inventory](source-inventory.json) identifies these preview bytes. The published Fleet archive retains its existing source and qualification record.

Developers can also explore the [larger public-task Studio preview](STUDIO.md) and [engineering instructions](../docs/DEVELOPMENT.md). The native engine derives from `fleet/workforce/` at repository commit `672222897c3424f75815830b95d469e3bbe15fa1`; the Linux port and its tests are maintained here separately.
