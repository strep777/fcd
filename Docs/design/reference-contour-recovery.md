# Reference contour recovery audit

The extractor recovers raster geometry from the classified original-resolution pixels. It does not beautify outlines or impose smoothness. Straight spans remain lines. A cubic is accepted only when the original span cannot be explained by a digital straight segment and a geometric least-squares fit remains within the original boundary envelope.

## Primary algorithm references

- Peter Selinger, [Potrace: a polygon-based tracing algorithm](https://www.mathstat.dal.ca/~selinger/potrace/potrace.pdf), 2003, sections 2.2.1–2.2.4: digital straight paths and polygon reconstruction. The aesthetic curve smoothing stage is intentionally excluded.
- DGtal, [Digital straight segment recognition](https://www.dgtal.org/doc/1.4/moduleArithDSSReco.html), and [StabbingLineComputer](https://dgtal-team.github.io/doc-nightly/classDGtal_1_1StabbingLineComputer.html): recover lines from digital boundary evidence instead of treating alternating raster edges as physical corners.

This implementation uses bounded numerical strip recognition and data fitting; it does not claim to be a complete implementation of either reference or a universally optimal tracer.

## Contract

The 0.8-pixel caller argument remains compatible with the old API. The native pixel grid is inferred from traced raster edges, including rotated/calibrated inputs. The recognition strip is at most 1.8 native pixels wide. This is distinct from the final, conservative bidirectional boundary-error bound of 1.05 native pixels, including curve flattening and unsampled-distance margins.

Every reconstructed ring must retain winding, its corresponding hole, containment and nonintersection, with at most 3% measured area error. Small holes below 16 native pixel squares stay exact. Native contact bevels and very acute tips remain protected. Other corners are reconstructed from supporting lines inside the pixel uncertainty, without averaging anchors or enforcing C1 continuity.

A narrow, nearly parallel straight strip can be ill-conditioned after an image-edge truncation. When independent intercepts violate the area bound, the recovery can apply a minimal one-dimensional thickness adjustment to reach the existing 3% measurement constraint. It retains edge directions and native clipping coordinates, caps the total width adjustment at half a native pixel, and still requires the full topology and 1.05-pixel boundary checks. It does not round edges or optimize appearance.

The fitter first keeps the compact outline and restores original holes if a hole fit fails. It can retain supporting corner anchors locally before considering the exact raster boundary. An irreducible outer contour above 2000 editable nodes reports RESOURCE_LIMIT rather than silently saving an invalid source.

On a straight-only candidate, a clipped raster corner or acute tip can lie off the supporting line. Instead of repeatedly subdividing the entire straight span into stairs, the fitter retains its endpoints and projects interior source samples onto that measured line, with short connecting segments at the ends. This candidate still passes the same bidirectional boundary, area and topology checks. It does not impose tangent continuity or replace measured arcs with straight segments.

## Implementation and checks

The implementation lives in packages/reference/recover-contour.ts, image-contour.ts, contour-topology.ts and shared-contour.ts. Focused tests in tests/integration/ cover digital straight spans, curves, holes, touching materials and real source contours. Test outputs are generated under test-results/; they are not maintained in this document.

The complete shared boundary network is recovered in source-pixel coordinates, then transformed back to millimetres. Contact and sampling budgets therefore do not change when the same image is calibrated at a different physical size. Each shared chain is fitted once and traversed in reverse by its other material owner.

Fine intersection checks include nonadjacent segments within the same chain as well as different chains. When a fit crosses at a narrow gap, only the original measured edges near the collision are protected. The remaining intervals are refitted between fixed contact endpoints. Reverting an entire long chain would reintroduce stairs far away from the collision. Winding, hole containment, area and boundary-error checks still apply after every repair.

`tests/integration/contour-default-real-edge.test.ts` exercises the default dual-image extraction route on the user's fixed source fixture, checks three straight crown spans and the complete network across calibration sizes and rotations. `reference-native-validity.test.ts` also sends resized real-image results through the native validator; its 1.2-scale case covers a small self-crossing within one shared chain. `tests/contour-image-boundary-audit.mjs` compares saved output with source colour transitions as a diagnostic. JPEG blur and painted shadows mean that a colour-gradient peak is not a ground-truth boundary; this diagnostic does not replace the explicit geometry contracts.

Advanced colour selection uses the same source-constrained recovery through apps/desktop/main/reference-contour-fit.ts. Its custom millimetre tolerance is an additional bound, not permission to smooth straight edges. The candidate must satisfy both that tolerance and the native-pixel bound. Original hole polygons remain exact and are checked against the recovered exterior. If the tolerance cannot be met or conservative sampling exceeds its resource budget, the original geometry is returned with an explicit fallback report. The generic polygon Bézier fitter remains available separately for non-raster callers.

The final editable-node contract is checked after recovery, so a high-resolution raster with more than 2000 boundary samples can produce a valid compact selection. A fallback that still exceeds the editable-node contract is rejected; the sampling budget never overrides the saved-project limits.

The custom fit derives its pixel size from the candidate raster dimensions and the reference calibration. Legacy proxy-based clustering therefore uses the proxy's pixel size; it does not gain original-resolution edge evidence merely by fitting a contour.

Run `node tests/contour-edge-evidence.mjs` to generate an algorithm comparison against the current Git HEAD in test-results/edge-fidelity. It includes the baseline commit and measured boundary-error bounds; its image is generated geometry evidence, not an application screenshot.

## Original-image transition evidence

Default native-resolution illustration extraction also measures the original RGB transition. It first resamples collapsed raster runs at one-pixel spatial intervals, estimates a local normal, and locates a unique half-contrast crossing between the local material plateaux. Chromatic normalization reduces brightness/shadow bias; low-contrast or ambiguous samples do not invent an edge. Supported samples are fitted with measured lines or independent cubics, without a smoothing, tangent-continuity or curvature penalty.

Shared junction coordinates remain fixed. Straight support is estimated from the measured interior, excluding the quantized endcaps; short endpoint connectors preserve the network rather than bowing the whole line. Candidate geometry still has to satisfy the same original raster-distance, area, hole and nonintersection contracts. If image evidence fails those checks, the shared chain restores its constrained raster reconstruction before considering any exact pixel fallback. The diagnostic `imageSupportedChains` counts image fits retained after validation.

Independent tests sample analytic RGB shapes and compare final geometry with their known boundaries. They also inspect proposals before network validation, so a downstream fallback cannot hide an unreliable image proposal. These tests cover lines, curved bands, circles, acute tips, thin rings, shared holes, calibration scale and rotation. The method is informed by [subpixel Canny/Devernay edge localization](https://www.ipol.im/pub/art/2017/216/) and [LSD line support](https://www.ipol.im/pub/art/2012/gjmr-lsd/); this is an original implementation, not either reference algorithm. Ambiguous source pixels do not determine a unique physical edge, and the implementation does not claim universal optimality.
