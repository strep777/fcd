# Seam solver acceptance contract

These checks describe observable output, without guessing an internal worker
method name or request shape. The external candidate remains `SurfaceRun` with
original-face trim barycentrics. Run the existing independent audit on each
exported input/candidate pair after integrating the solver.

The unchanged limits are maximum triangle area error 15%, edge-length error 10%,
seam-chain mismatch 1 mm and 1%, and local shared-segment mismatch 1%. An absolute
difference below 1 mm does not waive the local relative limit. Whole-chain sums
must not hide positive and negative local stretch that cancel.

`seam-correspondence-regression.mjs --prepare-only` prepares eleven deterministic
analytic inputs and matching candidate fixtures in
`test-results/current-repair/seam-regressions/`. It invokes no native worker and
touches neither release/debug worker binaries nor the user library.
The expected candidates are geometry-oracle fixtures; their dependency hashes
are placeholders and they must not be imported as accepted production results.
Use their valid input surfaces to generate fresh native candidates for runtime
acceptance tests.

| Fixture | Observable result |
| --- | --- |
| Polygonal cylinder strip | Two adjacent panels preserve exact triangle lengths and their curved physical seam; flattening uses polygon chord lengths, not circular arc length. |
| Sphere-region neighboring strips | Independently unfold two narrow strips through triangle trilateration. The shared boundary can change its 2D angles while corresponding physical segment lengths remain equal. |
| Millimetre scaling 0.001 / 1 / 1000 | Coordinates and lengths scale together; relative mismatches and pass/fail remain stable. |
| 0.00002 mm / 0.000005 mm shared edges | A 5% local mismatch must fail even though its absolute size is far below 1 mm. The smaller case also audits whether topology welding silently drops a real edge. |
| Annular panel with inset | The actual inner hole boundary is paired with an inset; area coverage remains exact. |
| Reversed hole triangles | Reversing traversal must not change seam correspondence or measured lengths. |
| Cone dart | Two copies of a radial cut belong to the same panel. Compare both sides of the self-seam. |
| Cone dart mismatch | A 2% radial mismatch fails while all triangle area/edge errors still meet the original gates. |
| Cancelling local errors | Two consecutive physical segments stretch by +5% and -5%; total chain length is equal, but local acceptance must fail. |

The fixture generator independently recomputes every triangle's area and all
three edge errors from original 3D coordinates; it does not trust report fields.
Isometric positives additionally require errors below `1e-9`. The independent
correspondence audit checks coverage, UV injectivity, outlines, 2D/3D roundtrips,
shared chain lengths and local lengths. A quality-negative fixture is required to
pass all unrelated geometry checks, preventing a failure for the wrong reason.

After the native integration is ready, add the following checks at its existing
production entry points rather than creating a guessed test-only protocol:

1. Native constraints unable to meet the seam budget must return an error or
   explicitly unsuccessful candidate; an acknowledged distortion warning must
   not silently waive the seam constraints.
2. Failed/cancelled computation preserves the previous committed candidate,
   pieces, bindings, cut archive, revision, undo history and recovery points.
   Its request ID must not become a successful replay record.
3. A late native completion after cancellation cannot publish a candidate.
4. The actual acceptance guard rejects excessive relative/absolute seam error
   and missing metrics on a new seamed candidate without modifying any state.
   `integration/seam-failure-acceptance.test.ts` uses the real `Repository`
   command path and explicit report fields. It throws no simulated exception and
   substitutes no geometry worker. Run it only after that production guard lands.
5. Test an actual successful solve with the real worker, including 2D/3D mapping
   and exports at all three millimetre scales. Analytic fixture success alone is
   not native algorithm validation.

No native runs are embedded in this contract, and no piece-count target is used.
