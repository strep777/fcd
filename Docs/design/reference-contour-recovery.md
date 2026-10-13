# Reference contour recovery audit

The extractor recovers raster geometry from the classified original-resolution pixels. It does not beautify outlines or impose smoothness. Straight spans remain lines. A cubic is accepted only when the original span cannot be explained by a digital straight segment and a geometric least-squares fit remains within the original boundary envelope.

## Primary algorithm references

- Peter Selinger, [Potrace: a polygon-based tracing algorithm](https://potrace.sourceforge.net/potrace.pdf), 2003, sections 2.2.1–2.2.4: digital straight paths and polygon reconstruction. The aesthetic curve smoothing stage is intentionally excluded.
- DGtal, [Digital straight segment recognition](https://www.dgtal.org/doc/stable/moduleArithDSSReco.html), and [StabbingLineComputer](https://dgtal-team.github.io/doc-nightly/classDGtal_1_1StabbingLineComputer.html): recover lines from digital boundary evidence instead of treating alternating raster edges as physical corners.

This implementation uses bounded numerical strip recognition and data fitting; it does not claim to be a complete implementation of either reference or a universally optimal tracer.

## Contract

The 0.8-pixel caller argument remains compatible with the old API. The native pixel grid is inferred from traced raster edges, including rotated/calibrated inputs. The recognition strip is at most 1.8 native pixels wide. This is distinct from the final, conservative bidirectional boundary-error bound of 1.05 native pixels, including curve flattening and unsampled-distance margins.

Every reconstructed ring must retain winding, its corresponding hole, containment and nonintersection, with at most 3% measured area error. Small holes below 16 native pixel squares stay exact. Native contact bevels and very acute tips remain protected. Other corners are reconstructed from supporting lines inside the pixel uncertainty, without averaging anchors or enforcing C1 continuity.

A narrow, nearly parallel straight strip can be ill-conditioned after an image-edge truncation. When independent intercepts violate the area bound, the recovery can apply a minimal one-dimensional thickness adjustment to reach the existing 3% measurement constraint. It retains edge directions and native clipping coordinates, caps the total width adjustment at half a native pixel, and still requires the full topology and 1.05-pixel boundary checks. It does not round edges or optimize appearance.

The fitter first keeps the compact outline and restores original holes if a hole fit fails. It can retain supporting corner anchors locally before considering the exact raster boundary. An irreducible outer contour above 2000 editable nodes reports RESOURCE_LIMIT rather than silently saving an invalid source.

## Implementation and checks

The implementation lives in packages/reference/recover-contour.ts, contour-topology.ts and shared-contour.ts. Focused tests in tests/integration/ cover digital straight spans, curves, holes, touching materials and real source contours. Test outputs are generated under test-results/; they are not maintained in this document.
