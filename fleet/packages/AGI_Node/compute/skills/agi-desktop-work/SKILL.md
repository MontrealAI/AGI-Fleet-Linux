---
name: agi-desktop-work
description: Use a disposable Linux desktop to open applications, see screenshots, type, click, drag and inspect actual work products.
---

The desktop belongs to the disposable execution sandbox, not the operator's Mac. Run `agi-desktop start` with the exec tool. It returns a screenshot path and a frame token. Use the read tool on that screenshot before acting. Run, for example, `agi-desktop click --frame TOKEN --x 400 --y 250`, `agi-desktop type --frame TOKEN --text 'Hello'`, or `agi-desktop key --frame TOKEN --key ctrl+s`. Each action returns a new screenshot/frame. Observe it before the next action. Tokens expire after 30 seconds and changed scenes require another screenshot; retry by observing, not by bypassing the guard.

Other actions: `double-click`, `right-click`, `move`, `drag --x X --y Y --to-x X --to-y Y`, `scroll --direction down --amount 3`, `wait --seconds 1`, and `launch --app writer|calc|impress|draw|editor|browser [--file /workspace/file]`. All mouse actions require a current frame. Only the local desktop's keyboard and mouse are controlled. Its Chromium can inspect local HTML; use the separately authorized `agi_public_browser` tool for public sites when exposed and qualified. Never use host browser control or shell networking as a substitute.

Use code for repeatable transformations when it improves accuracy; use the desktop to inspect application behavior and visual output. Reopen saved files to verify persistence. Never interact with account settings, credentials, the host filesystem or a signer. If the desktop cannot start or an essential application is missing, report the limitation and decline work that depends on it. A shell command succeeding does not prove the visual result.
