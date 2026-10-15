# Linux 1.1.4: published qualification evidence

[Release and downloads](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.1.4-qualification)
· [Exact qualification workflow](https://github.com/MontrealAI/AGI-Fleet-Linux/actions/runs/38779593318)
· [Published manifest](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/download/v1.1.4-qualification/Release-Manifest-v1.1.4.json)

Published on 15 October 2026 from commit
`7b5dda3d7dbcb9700a1408cf19bd7cf18404e068`. The saved installer and its evidence
were downloaded and checked against all four published asset sizes and SHA-256
digests. Both ZIPs passed CRC, unique-member and traversal checks. All 6,153
inventoried installer source files and executable modes matched the exact Git
source blobs. The current website pointer is a byte-for-byte copy of the
published manifest; historical release notes and artifacts remain preserved.

| Saved-archive qualification | x64 | ARM64 |
| --- | --- | --- |
| Targeted native suite | 291 tests / 25 files PASS | 291 tests / 25 files PASS |
| Complete native suite | 3,931 tests / 344 files PASS | 3,931 tests / 344 files PASS |
| Historical default Manager integration | 8 scripts / 780 Manager tests PASS | 8 scripts / 780 Manager tests PASS |
| Explicit Manager 1.17.0 profile | 8 scripts / 792 Manager tests PASS | 8 scripts / 792 Manager tests PASS |

Saved-browser acceptance and the retained evidence audit passed. The historical
default binds Manager `b12cb2fd711934562af6d14b9edcd1614956434c`; the explicit
profile binds `b721819639668f0074c244d516bbbe0cf57329a7`. These are local integration
results with declared synthetic work and test identities, not native-USDC
mainnet settlements, live-provider billing or independent economic review.

| Published asset | Bytes | SHA-256 |
| --- | ---: | --- |
| AGI_Fleet_Linux_v1.1.4.zip | 431170046 | `5adefd1ddfac143246964fd1dca029adaa78bd7ac0d077b0e692976ce21a3de4` |
| Linux-Qualification-Evidence-v1.1.4.zip | 15240660 | `b89d59294d51123c94c8eaa0627aec8bf72988ed3c0295fb7695820d42ec8479` |
| Release-Manifest-v1.1.4.json | 112748 | `d690e25162e1146a0cfe638327ea285255cca36d4672607ecb95b6bfee76476a` |
| SHA256SUMS-v1.1.4.txt | 294 | `5c143b9df7863d08825a8988a35f54d9804e733976d75fadf18e8f3d647775e2` |

The release remains a qualification prerelease: `productionQualified: false`,
physical qualification **NOT_RUN**. The controlled fresh-install gate does not
authorize funded work. No published asset or tag was replaced. GitHub currently
reports release immutability as false; content digests verify the downloaded
bytes but do not establish server-enforced immutability.
