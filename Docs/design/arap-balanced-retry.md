# Optional balanced ARAP retry

The ordinary `arap` solve is unchanged. The internal worker method
`arap-balanced` first runs the same ordinary solve, then retries only if
at least one face exceeds an existing hard maximum. It does not repair an
invalid initial chart or supply new topology cuts.

For each ordinary face, let `r` be the maximum of area error / 0.15,
edge error / 0.10, and combined distortion / 0.15. Up to six retry passes
increase weights for failing faces by `max(1.5, r^4)`, promoting tiny faces
to at least the median rest-area influence and capping weights at 1,000,000.
Weights are fixed within each pass. Rest area times this weight is used
consistently in the FEM normal equations, local/global objective,
right-hand side and line search. The best measured maximum distortion is
retained between passes. These bounded proposals do not guarantee that a
curved panel can be flattened without seams.

The single translation pin and positive-orientation line search remain.
The retry replaces the ordinary geometry only if it converged, every face
passes all three hard maxima, and the complete chart has no triangle overlap.
A failed solve, rejected candidate or overlap-check error retains the ordinary
geometry and report. A passing ordinary solve skips the retry entirely.
Existing p95 soft review warnings remain. Retry energy values describe the
fixed weighted objective and must not be compared to unweighted energy as
proof of manufacturing quality.

Within one native stream, retries on an exactly matching mesh reuse the
unmodified LSCM initialization. An explicit `initial_uv` seed may separately
reuse a previous validated chart. The seed must contain finite coordinates
for every required vertex, with no duplicated IDs, inverted triangles or
overlap. A malformed seed fails rather than silently falling back.
Coordinate, face, region or ordering changes invalidate the bounded cache;
an independent EOF request always starts with an empty cache. Cached and
uncached requests must return identical geometry and reports.

Implementation: crates/geometry-core/src/arap.rs and surface.rs. Regression fixtures and native tests cover passing ordinary solves, balanced retry, rejected candidates and unchanged serialized results.

## Seam-constrained refinement

The internal `arap-seamed` method adds scalar boundary-length residuals to the
ARAP objective. Its Gauss–Newton step uses each edge's current unit direction,
and a positive-orientation backtracking line search rejects increasing energy.
One translation anchor remains; a second fixed anchor would incorrectly
preserve the seed's scale. Coordinates and rest lengths are conditioned
together before solving and restored to millimetres afterward.

Boundary stiffness is proportional to total weighted rest area and inversely
proportional to edge count and squared rest length. Thus small seam segments
retain a relative-length constraint. At most two balancing passes are used
for this method. Solver convergence is not manufacturing approval: the caller
checks physical boundary lengths, all triangle distortion limits and overlap,
and splits a chart if those checks fail.
