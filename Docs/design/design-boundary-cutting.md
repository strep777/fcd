# Cutting from material boundaries and user seams

The desktop defaults to the `design` partition strategy. Material boundaries and saved user cut lines define the initial domains. Anatomical region names remain provenance; mesh face counts and normal-angle thresholds do not define panels in this strategy. The `mesh` strategy remains available for compatibility.

## Geometry pipeline

1. Normalize each marking fragment using the renderer's even-odd fill rule, then resolve visible layers on each original model triangle. Subtract occluded layers and union equal colors. Overlapping independent markings are not XORed. Union all occupied colors before taking the base-material complement, retaining genuine holes.
2. Use a common clipping-grid origin for related barycentric operations. Verify each color union against its mutually exclusive visible layers, the occupied union against the independent sum of colors, and the colored-plus-base area against the original triangle. A failed face can retry the complete Boolean pipeline on another grid only within a 1e-6 mm displacement budget. Ordinary UV operations retain their local origin so large translated patterns still have usable numerical precision.
3. Conform the material contours before triangulation, sharing stations on original model edges and internal material interfaces. Reinsert stations omitted by tessellation, and retain the original face and barycentric coordinates of every resulting triangle. Check material area and complete original-face coverage. Only floating-point-zero triangles may be omitted; a genuinely positive tiny material domain remains subject to the native geometry limits.
4. Open saved user seams and necessary topology cuts. Planar dangling slits are extended to the outer boundary along existing mesh edges; a hole is not treated as an outer boundary. Existing complete cuts are not extended again.
5. Unwrap each connected domain. Try measured curvature darts and balanced ARAP before introducing independent panels. Further partitions are justified by failed topology, distortion, or manufacturing checks. Cache complete solved component decompositions so a manufacturing repair does not solve unaffected components again.
6. Validate actual manufacturing outlines and allowances. Store the resulting cuts with exact original-model provenance, geometry hashes, and separate reasons for additional seams. Confirming the candidate creates the cutting-library archive.

## Acceptance constraints

Every accepted design report must satisfy maximum area error 15%, maximum edge error 10%, and maximum combined distortion 15%. A percentile warning can still require review even when all hard limits pass. The 500-piece ceiling remains in force.

Numerical canonicalization is restricted to sub-micrometre coordinates, with displacement, signed-area, per-color and original-face checks. Manufacturing outline normalization can remove a zero-area retrace; that is distinct from changing source artwork or smoothing a visible design. The exact mapped triangle data remains available for assembly and material accounting.

The source extractor also shares each material boundary between its two owners. Independent fits can create thin gaps which correctly become base-material domains during cutting; those defects must be repaired in the source network, rather than hidden by erasing small panels or recoloring the model.

Mesh and UV validity use propagated coordinate-subtraction and determinant error bounds, rather than an absolute physical triangle-area cutoff. This distinction matters when a normal model triangle is subdivided into small, well-shaped material faces. Direction must remain numerically resolvable, and final physical area/edge distortion is still measured for every face. The 2D manufacturing area check applies the same principle to a translated polygon fan, including signed cancellation and summation error; short-edge and self-intersection checks remain separate.

The numerical motivation is described in [Shewchuk's robust geometric predicates](https://www.cs.cmu.edu/~quake/robust.html): determinant signs near zero require roundoff-aware treatment. This implementation uses conservative error bounds and rejects unresolved geometry; it does not implement the paper's full adaptive exact-arithmetic algorithm.

The pipeline must fail without changing the project when geometry cannot meet its constraints. An empty result, an erased hole, duplicated coverage, or a failed material-area check is not a successful repair.

The design-cut task has a ten-minute deadline. Individual solver deadlines, memory limits, cancellation of worker threads and child processes, and atomic candidate publication remain in force. Explicit uncolored legacy mesh cuts and ordinary projection tasks retain their two-minute deadline.

## Assembly and editing

The separate assembly tab reconstructs the actual stored cut triangles. Missing or stale pieces leave real gaps. It validates model, marking and piece geometry before displaying the result; it does not substitute the original full model for missing cuts. It reconstructs saved geometry, not cloth tension or sewing deformation.

The manufacturing overview lays out all selected outlines for the screen independently of actual-size print pagination. Pan and drag coalesce pointer movement into frame updates; a completed edit creates one undoable transaction.

## Regression coverage

Focused fixtures cover a tessellation-independent four-panel diamond, explicit seams, a developable cylinder, curvature darts, planar holes and dangling slits, occluded color layers, touching colors, tiny material islands, numerical retraces, full original-face coverage, archive restoration, and stale or missing assembly pieces. Runtime results are written to test-results/.
