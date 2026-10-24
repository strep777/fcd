# Cutting from material boundaries and user seams

The desktop defaults to the `design` partition strategy. Material boundaries and saved user cut lines define the initial domains. Anatomical region names remain provenance; mesh face counts and normal-angle thresholds do not define panels in this strategy. The `mesh` strategy remains available for compatibility.

## Geometry pipeline

1. Normalize each marking fragment using the renderer's even-odd fill rule, then resolve visible layers on each original model triangle. Subtract occluded layers and union equal colors. Overlapping independent markings are not XORed. Union all occupied colors before taking the base-material complement, retaining genuine holes.
2. Use a common clipping-grid origin for related barycentric operations. Verify each color union against its mutually exclusive visible layers, the occupied union against the independent sum of colors, and the colored-plus-base area against the original triangle. A failed face can retry the complete Boolean pipeline on another grid only within a 1e-6 mm displacement budget. Ordinary UV operations retain their local origin so large translated patterns still have usable numerical precision.
3. Conform the material contours before triangulation, sharing stations on original model edges and internal material interfaces. Reinsert stations omitted by tessellation, and retain the original face and barycentric coordinates of every resulting triangle. Check material area and complete original-face coverage. Only floating-point-zero triangles may be omitted; a genuinely positive tiny material domain remains subject to the native geometry limits.
4. Open saved user seams and necessary topology cuts. Planar dangling slits are extended to the outer boundary along existing mesh edges; a hole is not treated as an outer boundary. Existing complete cuts are not extended again.
5. Unwrap each connected domain. Try measured curvature darts and balanced ARAP before introducing independent panels. Dart trials use the complete domain regardless of tessellation density, with at most four proposals and a 12-second budget checked between trials. A native solve already in progress still follows its worker deadline. Further partitions are justified by failed topology, distortion, or manufacturing checks. Continuous sections can cross triangle interiors. Nonplanar domains also test area-weighted principal directions, allowing longitudinal sections on posed limbs rather than only world-axis slices; their shared attempt budget scales with the initial input size, bounded between 32 and 256. Manufacturing repair retains unchanged solved charts. Rejected chart unions can be reused across repair passes only while their face, vertex-coordinate and material-region identity remains unchanged.
6. Use the preliminary UV coordinates as a validated seed for a seam-constrained solve. Every boundary edge, including holes, is constrained to its original three-dimensional length. Remaining failures split along existing mesh edges; this final phase does not refine already solved neighbours. Preliminary merging and a second seam-constrained merge each receive their own 30-second search budget. The latter re-tests unions after seam calibration; initial ARAP failures do not permanently retain redundant sewing divisions. Already solved panels remain valid when this optional search stops; all mandatory quality checks still run.
7. Validate actual manufacturing outlines and allowances. Store the resulting cuts with exact original-model provenance, geometry hashes, and separate reasons for additional seams. Confirming the candidate creates the cutting-library archive.

## Acceptance constraints

Every accepted design report must satisfy maximum area error 15%, maximum edge error 10%, and maximum combined distortion 15%. A percentile warning can still require review even when all hard limits pass. The 500-piece ceiling remains in force.

New `lscm-arap-seamed-1` candidates also require each boundary segment's length error to be at most 0.05%, and the sum of absolute boundary length errors of each panel to be at most 0.25 mm. Opposite signs cannot cancel. Acceptance independently recomputes these limits from original-face barycentric coordinates, rejects duplicate or reversed triangles, checks every face's physical distortion, and verifies that exported outlines cover exactly the finite trim boundary within the declared numerical tolerance. A modified report alone cannot authorize a stretched outline. Older saved algorithm versions remain readable; their existing acceptance behaviour is retained.

Numerical canonicalization is restricted to sub-micrometre coordinates, with displacement, signed-area, per-color and original-face checks. Manufacturing outline normalization can remove a zero-area retrace; that is distinct from changing source artwork or smoothing a visible design. The exact mapped triangle data remains available for assembly and material accounting.

The source extractor also shares each material boundary between its two owners. Independent fits can create thin gaps which correctly become base-material domains during cutting; those defects must be repaired in the source network, rather than hidden by erasing small panels or recoloring the model.

Mesh and UV validity use propagated coordinate-subtraction and determinant error bounds, rather than an absolute physical triangle-area cutoff. This distinction matters when a normal model triangle is subdivided into small, well-shaped material faces. Direction must remain numerically resolvable, and final physical area/edge distortion is still measured for every face. The 2D manufacturing area check applies the same principle to a translated polygon fan, including signed cancellation and summation error; short-edge and self-intersection checks remain separate.

The numerical motivation is described in [Shewchuk's robust geometric predicates](https://www.cs.cmu.edu/~quake/robust.html): determinant signs near zero require roundoff-aware treatment. This implementation uses conservative error bounds and rejects unresolved geometry; it does not implement the paper's full adaptive exact-arithmetic algorithm.

The pipeline must fail without changing the project when geometry cannot meet its constraints. An empty result, an erased hole, duplicated coverage, or a failed material-area check is not a successful repair.

Every cut-preview task has a 60-second deadline, including uncolored legacy mesh cuts. Individual solver deadlines, memory limits, cancellation of worker threads and child processes, and atomic candidate publication remain in force. A deadline ends the task as a failure; it does not publish a partial candidate or certify performance. Ordinary projection tasks retain their two-minute deadline.

The native stream reuses only the conformal initialization of the last identical mesh across ARAP retries. Vertex coordinates, IDs, face ordering and material regions must match exactly. The cache is limited to 200,000 UV coordinates and is discarded with the task. Requested ARAP iterations and all final geometry checks still run. Manufacturing checks reuse the same serial native stream instead of repeatedly starting native processes.

## Assembly and editing

New surface-anchored pen and brush paths store world-space control points. Consecutive points follow a connected surface section through the anchors and their local normals; triangle intersections become barycentric cuts. Camera changes do not reproject these paths. Legacy lines without `surfaceAnchored` retain their original planar projection. A disconnected or ambiguous section fails instead of jumping to an unrelated sheet.

Completed brush strokes fit their outer boundary to bounded cubic controls; holes remain exact and fitting is rejected near narrow hole bridges or invalid topology. Raw pointer samples are transient. Surface paint fitting reserves a 0.25 mm per-edit budget for contour approximation; freehand cut-line reduction uses a 0.5 mm world-space tolerance, independent of viewport zoom. The cutting workspace exposes area paint separately from freehand sewing lines.

Opening a saved surface-painted polygon in the node editor prepares the same bounded compact contour as a draft. After cut acceptance or restoration, the editor follows the archive marking ID and source fingerprint to identify the original paint, including repeated archives. Missing, cyclic or mismatched provenance keeps the original contour. Cancellation preserves the saved polygon and its dependencies; confirmation uses the existing marking edit transaction. Existing cubic and spline contours are not fitted again, and reference-sourced markings retain their source editing path.

Attached markings support `Ctrl+T` resize and rotation handles with synchronized numeric fields. `Enter` commits the edit and `Esc` discards the draft. A symmetric brush stroke saves and undoes both sides in one transaction; correspondence failures still require review.

Node and transform gestures capture the displayed surface handle, camera and screen scale at pointer-down. Displacements use a parallel plane through that handle, preserving the grab offset under perspective. Near a silhouette, only the observable motion is retained; this avoids unbounded movement when the stored contour frame faces sideways. Visible handles take priority over navigation, and losing pointer capture rolls back the unfinished gesture. Removing a marking, changing projects or changing model topology clears its draft before another source can be attached in the same tab.

When editing an attached contour, node handles are displayed only where the current camera can see their surface positions. Occluded nodes retain their geometry and original indices; rotating the camera can reveal them. Hiding a handle never removes a node or changes the saved contour. New drawing-plane drafts retain their existing controls.

Before accepting an unwrap candidate, the workspace displays actual UV-island boundaries on the original model at 50% opacity. Fractional material boundaries use trim barycentric provenance. Saved seams, section previews and candidate seams are clipped against the opaque model, including partial occlusion and perspective depth crossings, so back seams do not show through front surfaces. This preview does not commit the candidate or bypass its existing input-hash and review checks.

Trimmed piece colors use the same exact barycentric fragments in GPU and Canvas previews. A partial binding never paints its whole original triangle. Mapping drafts show the current marking fragments without old trimmed material underneath; stale or inactive bindings also cannot supply selected-piece overlays. The model view supports zoom up to 3200% for small contour edits without changing physical dimensions.

The cutting workspace's 2D preview focuses on a selected piece and retains all pieces in the picker. Selecting all pieces restores the overview and its combined dimensions. Screen outline width remains readable when zoomed out; these display changes do not alter geometry, millimetre dimensions or export scale.

The separate assembly tab reconstructs the actual stored cut triangles. Missing or stale pieces leave real gaps. It validates model, marking and piece geometry before displaying the result; it does not substitute the original full model for missing cuts. It reconstructs saved geometry, not cloth tension or sewing deformation.

The manufacturing overview lays out all selected outlines for the screen independently of actual-size print pagination. Pan and drag coalesce pointer movement into frame updates; a completed edit creates one undoable transaction.

## Regression coverage

Focused fixtures cover a tessellation-independent four-panel diamond, explicit seams, a developable cylinder, curvature darts, planar holes and dangling slits, occluded color layers, touching colors, tiny material islands, numerical retraces, full original-face coverage, archive restoration, and stale or missing assembly pieces. Runtime results are written to test-results/.

As of 2026-10-18, focused component tests and a rebuilt hidden-desktop check pass for 2D selection focus, readable outlines and zoom-independent dimensions. The desktop check also measures every displayed outline against the SVG and its clipping ancestors in compact, expanded and refitted views.

An earlier 2026-10-18 validation used a saved project with 98 source entries, one attached marking and three saved user seams. Its 8,802-face candidate contained 168 pieces and took about 327 seconds. This is historical evidence, not the current performance result; it predates the seam-length constraints and 60-second task deadline. Current measurements and independent sewing checks are recorded under `test-results/current-repair/`.

The larger continuous-section budget substantially reduces leg zigzags, and depth clipping removes back seams from front views. Local angular seams remain near the crotch, inner thighs and ankles; hands and feet still have dense boundaries. Passing area, distortion and coverage checks does not establish natural seam placement, success on every model, a minimum panel count or suitability for physical sewing. Candidates still require inspection and can be recomputed after adding deliberate sewing lines.

For a short visual check after rebuilding, reuse an already accepted project in an isolated `.local/tests/` directory:

```powershell
$env:FPCAD_INSPECT_DATA_DIR = '<absolute path to the existing isolated test project>'
node scripts/test-desktop.mjs --jobs 1 current-cutting-visual-inspect
```

This hidden-window check reads saved cut geometry without recomputing the model. It checks the overview, a colored piece, outline visibility and unchanged millimetre dimensions while zooming, then writes screenshots and a report under `test-results/current-cutting/`. It requires an isolated test directory and does not use the user workspace as test storage.

### Remaining garment-layout limitation

Principal-axis sections, darts and final chart merging reduce fragmentation, but do not yet constitute a garment seam-layout optimizer. The reported 8,534-face model produced 109 panels with the default UI options; coverage and current strain checks passed, while a roughly 11.5 mm² finger panel and stair-stepped boundaries remained. Passing geometric validation must not be reported as matching the reference garment layouts. Further work must optimize shared seam paths and retain material boundaries, full surface correspondence and sewing-length checks together.
