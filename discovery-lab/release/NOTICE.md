<!-- SPDX-License-Identifier: Apache-2.0 -->
# Discovery installed profile — source and licenses

The original Fleet repository license remains in the package root `LICENSE`.
Existing Fleet source and notices retain their original licenses unchanged.

The Discovery modules that declare `SPDX-License-Identifier: Apache-2.0` use the
enclosed exact Apache License 2.0 text in `LICENSE-APACHE-2.0.txt`. This includes
the common Discovery contract, new installed-review/module-closure code and the
Alpha source files that retain that declaration. The Alpha files originate in
`MontrealAI/AGI-Alpha-Agent-v0`; the installed profile records their exact commit,
tree, Git blob, mode and SHA-256. The original Alpha `LICENSE` is also included
unchanged as `alpha/LICENSE`. The builder requires it to match the enclosed
Apache text. Headers on files with another license remain authoritative.

The common contract's historical source origin is Alpha commit
`0385df4c9728db19c396e039cd04678eebfddb9e`; its SHA-256 is
`98c8de8ce2774b7650bf4ee11eeedfb0a69b75fa6d1b080ef823637d77d0ab47`.
The profile freezes the actual reviewed Alpha revision used by each candidate;
historical provenance does not qualify a newer source or release.

No upstream NOTICE file is removed or replaced by this profile. This notice
records source provenance and licensing; it does not claim upstream endorsement.
