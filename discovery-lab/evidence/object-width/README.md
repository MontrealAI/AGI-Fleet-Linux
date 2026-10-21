# Direct-object width regression evidence

The configured P2 finding is [Fleet review 4342007670](https://github.com/MontrealAI/AGI-Fleet-Linux/pull/64#discussion_r4342007670). `before-contract.mjs` is the actual in-development Alpha snapshot used for the initial regression run. Its canonical implementation is byte-identical to public Fleet `c3105c5`'s implementation; it additionally contains the then-pending declared inspection constant. `observations.json` records both full-module hashes and their equal canonical-prefix hash. This snapshot is a negative test fixture, not an active receiver import.

`before.tap` retains four failing new regressions (8/12 passed). `node22.tap` and `node24.log` retain all 12 passing contract tests after repair. The latter is Node's default spec output, despite the original scratch filename recorded in the observations. Width/node and minimum-output checks now precede descriptor access, including non-enumerable array extras. The valid 99,999-child boundary, Unicode byte limits, and accessor rejection remain.

`original-equivalence.mjs.txt` and `original-equivalence.json` preserve the first actual 1,055-case comparison and its original scratch-relative paths. The portable `equivalence.mjs` repeats that comparison with the current 45-case native report and the three bundled original browser inputs. Run it after the native harness produces a fresh full report:

```sh
node discovery-lab/evidence/object-width/equivalence.mjs /absolute/new-fleet-evidence/semantic-seam.json
```

`current-equivalence.json` is the actual result on the pinned Node 24.21.0 binary. Both comparisons preserve every admitted canonical byte. They are local authored regressions and advisory review evidence; they grant no execution, security-review or eligible-owner authority.
