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

## Straight-versus-curve selection

Counting only output anchors incorrectly favors two broad cubics over a small straight-sided marking. The additional polygon candidate uses independent fitted parameters, excluding schema-only de Casteljau subdivisions. It requires strict digital straight-strip evidence from every source span, with at least three long sides covering 75% of the measured perimeter. Short caps must themselves fit the strict strip; they cannot collectively justify polygonizing a small ellipse. Long cores exclude only the existing two-pixel terminal uncertainty at either end. Source edges are clipped by measured arc length so coalesced collinear edges retain their evidence.

Equivalent traversal phases and the existing local-corner line candidate are considered before a compact marking falls back to its raster staircase. Partial support can permit a phase search, but never accepts a result: the full straight evidence, topology, area and bidirectional distance gates still apply. No image coordinates, fixture identifiers or preferred polygon shape enter this selection.

## Regression evidence

The integration regressions cover the actual blue diamond; straight slopes 0.13, 0.3, 0.6, 1, 1.5 and 2.7 at pixel scales 0.05, 1 and 10 after rotation and large translation; small pointed markings; true notches; near-contact bevels; curved rings and holes; the original ear, body and yellow thigh; complete claws; and native validation of both real images.

`original-edge-matrix.test.ts` generates antialiased RGB images from independent analytic geometry, then runs classification, native tracing and shared recovery. Its oracle measures both directions against the analytic source, separately checks straightness and unsupported turns, and samples the complete saved partition for gaps and overlaps. Distance alone is insufficient: a visibly angular polygon can remain inside the positional envelope.

`original-edge-real-audit.test.ts` exercises the public two-view import on the original JPEG. Independent half-contrast measurements cover the outer yellow thigh and three fixed pink-paw source corridors. Paw profiles reject unresolved quantization, noisy plateaus and multiple or reversed crossings; accepted points must lie within 1.05 pixels of the saved boundary. These sampled positions do not certify tangent continuity or unmeasured image intervals. Source/mask/saved overlays expose ambiguous ink, shadows and glints. Evidence in `test-results/latest-edge/` records source hashes at both test loading and evidence saving, so changed-source runs cannot silently become final evidence.

The saved-project manufacturing regression independently uses `tests/fixtures/legacy-curved-character-piece.json`, captured from the immutable old algorithm: 318 cubics and six holes. It retains coverage of more than 2000 derived samples at three scales after the new extractor stops adding gratuitous curves.

## Shared material boundaries

Original-image ownership correction requires directional color evidence before moving a pixel across a measured half-contrast crossing. A near-threshold pixel retains its original owner if its separation is within the 8-bit quantization and observed source-side variation budget. The normalized-chroma quantization bound includes the changing RGB-sum denominator. A blurred transition tail can be distinguished from source-side fluctuation by a bounded, same-owner outward search for a quiet sample pair; a third owner, reverse transition, image boundary or missing quiet pair retains the original conservative budget. This search does not change the measured half-level or crossing. The observed variation is a local source model, not a guarantee covering every JPEG artifact.

A rejected broad color profile may try progressively shorter support windows. Each short window requires two same-owner original pixels on each side whose variation fits their combined quantization budget, no third material anywhere in its corridor, and a unique directed crossing with at most half a pixel of measured position uncertainty. The widest valid profile decides; an accepted profile with an uncertain pixel does not retry narrower windows to force a change. Ink and silhouette profiles retain their original support width. Independent analytic tests cover both image axes and mirrors, including third-material barriers, noisy plateaus and unresolved midpoint ownership.

Dual-view extraction now recovers the whole per-view material network together. It splits collinear traced edges at every material junction, builds maximal chains with fixed junction coordinates, fits each chain once, and reuses its nodes and reversed controls for both owners. A closed loop touching another material also retains that junction. Shared holes and their enclosing-material edges use the same polygon samples because saved holes cannot contain cubics. Invalid fits restore the complete shared chain for every owner; sources are never expanded to conceal a gap.

Polygon-only shared holes retain the original fitted curve while validating their samples. If the initial 0.06-native-pixel flattening fails the assembled network contract, the same curve is sampled at 0.02 and then 0.005 pixels before changing its geometry. This also applies to subdivided recovery attempts. Both owners always receive identical samples; the 2000-node limit, topology checks, area constraint and 1.05-pixel boundary limit still apply. This prevents an otherwise valid arc from falling back to visibly angular lines solely because of additional hole-sampling error.

Assembly and validation reuse an unchanged owner's geometry until an incident chain's node or control array is replaced. Changed owners undergo the full checks again; no geometric threshold changes. An isolated comparison on the 55-region original JPEG network produced identical coordinates for every node, hole and control point, while reducing recovery from 15.7 to 6.6 seconds on the test machine. This is a measured case, not a general performance guarantee.

The joint-chain regression requires zero native boolean gap and overlap on open curves, closed ellipse/diamond interfaces and three-material junctions. Shared long straight strips at slopes 0.13, 1.5 and 2.7 require at most 20 central-material nodes, no cubics, unchanged area/topology limits and the same 1.05-pixel fidelity bound. Large translated and rotated junction tests account only for floating-point coordinate roundoff.

The real-image network tests sample saved native geometry rather than matching chain signatures. The disclosed <=0.01 mm diagonal contact bevel remains; true background holes are never filled. Region counts depend on source classification and are not a fidelity score.

The network design is consistent with the topology-aware primal/dual boundary graph discussed by [He, Kang and Morel (2024)](https://arxiv.org/abs/2409.15940). This implementation uses shared chains and bounded data fitting only; it does not adopt their smoothing or region merging.

## Limits

Anatomical metadata is separate from recovered geometry. A missing hand without visible pink pads can be identified from a compact neutral arm-terminal component and at least two independently supported distal dark tips on the same side. Existing paw evidence takes precedence; ambiguous, head, tail, single-tip and opposite-side clusters do not qualify. Only those exact components change classification, without expanding a box over the adjoining cuff or changing their pixels or curves. The regression retains pre-change geometry hashes for both real images and complete metadata/frame hashes for the unaffected blue-white image.

Geometry fidelity is relative to the classified source pixel mask. Antialiasing, painted shadows, gaps in source color classification and low resolution can retain small source-supported turns. The geometric constraints intentionally take precedence over an idealized shape. Extremely detailed or invalid inputs can remain above the editable-node budget and require explicit correction. Successful regression fixtures do not establish that every arbitrary illustration is semantically or geometrically recoverable.
