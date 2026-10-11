# Welcome to AGI Fleet for Mac

**Turn a dedicated Mac into a place where AI can make and check useful work.** Start with a small public document, a simple spreadsheet or a software task you can inspect yourself.

This is the **Mac 1.20.2 qualification candidate**, for Apple silicon M1 and M2 Macs running macOS 15 or later. One Fleet download includes all six role folders; choose the role you need after extracting it. Begin controlled installation and evaluation only after native acceptance is published for this exact ZIP; physical Mac qualification and funded operation are separate gates. Reading this guide does not require an account, wallet or payment.

## Choose what you want to do

| I want to… | Start here |
| --- | --- |
| Have AI make useful work on my dedicated Mac | **Agent** — creates and checks documents, files and code in an isolated workspace. |
| Independently check another worker's delivery | **Node** — examines the original work and records its review. |
| Ask someone to complete a job | Start with the [simple employer guide](https://montrealai.github.io/AGIJobManager/). You can prepare a request before setting up a Mac worker. |
| Operate specialist services | **Employer**, **Moderator**, **Evidence** and **Recovery** are included; see the [role comparison](PARITY.md). |
| Understand the system first | Read the [Mac and Linux comparison](PARITY.md). No installation is needed. |

**Most new Mac operators should begin with Agent.** A Node should have independent control when it is meant to provide an independent review.

## Your next step

Open the [fresh Mac setup guide](FRESH_INSTALL.md). It takes you through these stages, one at a time:

1. Check your Mac and download the verified Mac edition.
2. Have a trusted helper prepare two separate Standard accounts.
3. Open the approval app in the first account.
4. Install the worker in the second account.
5. Make one small example and check its actual files.

The **approval account**, called the signer, holds any wallet and approves tightly limited work. The **compute account** does the AI work. Keeping them separate is part of the product; wallet recovery words never go into the compute account.

Initial setup involves account administration, Docker Desktop and provider sign-in. If these are unfamiliar, give the setup guide to someone you trust. You can make the choices together without sharing wallet words or passwords.

## Before you begin

- In the Apple menu, choose **About This Mac**. Look for **Apple M1** or **Apple M2** and macOS **15 or later**. Other Apple silicon generations need their own recorded qualification; Intel Macs are outside this edition's target.
- Prefer **16 GB of memory or more**. The 8 GB M1 configuration has not been qualified. Plan for at least **40 GB of free storage**, with more for your work and Docker images; this is a planning allowance, not a tested capacity promise.
- Use a dedicated Mac with reliable power and internet. Model subscriptions, provider limits and any applicable Docker terms are separate from the Fleet download.
- Leave old failed installations and their accounts intact. Use genuinely new accounts for this clean installation.

## Help is close by

If anything is unclear or stops, open [Help and recovery](TROUBLESHOOTING.md). Keep the message shown on screen. You do not need to guess, erase an account or remove a safety stop.

You can increase the text size in your browser with **Command + plus**, or use **File → Print** to keep a paper copy. Each release contains these guides as offline HTML pages.

For the current evidence and remaining checks, see [Physical qualification](PHYSICAL_QUALIFICATION.md) and [Release notes](RELEASE_NOTES.md).
