# Contract artifact provenance

Target: [MontrealAI/AGIJobManager v1.1.0](https://github.com/MontrealAI/AGIJobManager/releases/tag/v1.1.0), reviewed source commit `db876a8021da6afcf7aa974489d13374e6d188b5`. The manager and library Solidity is unchanged by this private node package. This software deploys no real contract and changes no owner settings.

`artifacts/` contains the complete ABI, creation bytecode, deployed runtime template, link references and immutable references for AGIJobManager, UriUtils, TransferUtils, BondMath, ReputationMath, ENSOwnership, NftEligibility, JobSettlement and JobValidation. MockERC20 and FailingERC20 are included solely for the isolated test fixture.

`compiler-inputs/` preserves the corresponding standard-JSON compiler inputs, including Solidity source and dependencies. Project source content was compared to the pinned commit with the LF line-ending normalization used by Hardhat. `artifact-provenance.json` maps each artifact to its build input/source name and SHA-256. The package includes the upstream MIT license; compiler inputs also preserve source-license headers for dependencies.

Build settings: Solidity **0.8.37**, via IR, optimizer enabled with **40** runs, EVM **Shanghai**, debug revert strings stripped, metadata bytecode hash **none**, and the exact source paths/remappings in the included inputs. Different build settings can produce a valid but incompatible runtime; enrollment intentionally requires this build.

To reproduce the bytecode after installing development dependencies:

```sh
npm ci --ignore-scripts
node scripts/verify-contract-artifacts.mjs
```

The verifier compiles the included inputs with pinned `solc@0.8.37` and compares every ABI, bytecode, library-link and immutable-reference field. It does not connect to a chain or deploy anything. Public deployment and fund handling are separate operator actions governed by the upstream deployment documentation.

Enrollment substitutes only known Solidity immutable values and library link positions into these templates, verifies the manager and full transitive eight-library graph, then records the exact deployed code hashes. The contract source commit is a compatibility/provenance reference, not an assertion that a future deployment already exists or that the node has an independent audit.
