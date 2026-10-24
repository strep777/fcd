# Coordinated repair verification

## Current checkpoint — 2026-10-24

The final6 allocation fixes have completed unit verification and both builds.
The full run covered 316 files / 2,329 cases: 2,316 passed, while 13 new component
cases failed in their SSR test host before business assertions. After a test-host
correction, both complete files passed all 21 cases. Replacing those file results
gives 2,329 passing identities with no skipped or missing cases. The original
failure remains saved; this is not a single clean full invocation.
See `test-results/responsiveness/final6-unit-summary.json`.

The final6 release smoke passed real 100 mm geometry, exact fractional coordinates,
save/restart and normal close with hidden windows. All 13 affected desktop/browser
entries passed (10 hidden Tauri and three real browsers); this reruns 12 final5
entries and adds one, while retaining the other 63 final5 entry records. Source and
build hashes remained unchanged and test processes exited. See
`test-results/responsiveness/final6/summary.json`.

The independent final6 benchmark completed all 23 reopen cycles, with 20 measured
opens after three warmups. Cold open was 13.1166 s; reopen p50/p95/max were
10.9888/11.6889/12.0623 s. Drag p95 was 33.5 ms and orbit median was 58.8059 FPS.
The aggregate observed peak was 4,122,836,992 bytes; released-state last/first
working set was 1.05168 and not monotonic. Drag, FPS and memory gates passed.
Opening failed both the 5 s target and 10 s degraded target; no runtime errors
were reported, and the command correctly exited 1. See
`test-results/responsiveness/full-performance-final6.json`. These are debug-build
measurements; the release has separate functional smoke evidence.

The initial new browser fixture omitted the Boolean texture-preview prop; its
first failure remains preserved and the unchanged color/pixel assertions passed
after the fixture explicitly enabled textures. Interior samples were selected
before either execution, not moved after the failure. Actual screenshots still
show an existing one-pixel light seam at Canvas triangle boundaries; interior
pixel and decoder tests do not certify seam-free rendering.

## Earlier final5 checkpoint — 2026-10-24

The final5 evidence below is frozen; it does not validate the subsequent
surface-edge indexing, redundant LOD, texture lifecycle and resource-write changes.

The final5 complete-file merged Vitest evidence covers 313 files and 2,302
cases. Every case has a passing record; this combines the full run and affected
file reruns, rather than claiming a single clean full invocation. The original
timeout and failed attempts remain available. The latest response, archive,
dialog and repository batch passed 113 cases in 13 files, and type checking
passed. See `test-results/responsiveness/vitest-complete-file-wire-summary.json`.

The final5 debug and release builds passed. The release smoke test passed real
100 mm geometry, exact fractional coordinate persistence, save/reopen and normal
shutdown in a hidden window. Rust geometry tests passed 35 cases; Tauri wire and
float roundtrip tests passed four. The maintained change record is
[the 2026-10-24 report](../update/2026-10-24-loading-responsiveness.md).

The final5 75-entry functional run passed, covering native desktop,
production-source components and real browsers. This counts entry points, not
individual assertions or native windows. Three older tests needed path-selection
or stream-observer adaptations; their original failures remain saved. Its summary
and source fingerprints are in `test-results/responsiveness/final75/`.
The final5 performance run completed 23 reopen cycles independently after those
tests exited. Drag p95 was 33.6 ms and orbit median was 58.85 FPS, both passing.
First open was 15.11 s; measured reopen p50/p95/max were 11.29/12.45/12.63 s.
Opening failed both the 5 s target and 10 s degraded target. Observed aggregate
peak was 4,246,777,856 bytes, below 4 GiB; released-state last/first working set
was 1.326, above 1.1, and not monotonic. The overall memory gate therefore failed.
There were no reported runtime errors, but the benchmark correctly exited 1.
See `test-results/responsiveness/full-performance-final5.json`. This is debug-build
performance evidence; the release build has separate functional smoke evidence.
The earlier final4 benchmark and incomplete baseline remain saved, and are not
represented as passing acceptance. Large-project opening and released-memory
stability remain optimization work; the functional pass does not close them.

## Historical checkpoint — 2026-10-23

The current file-level merged report covers all 297 discovered Vitest files and
2,189 cases, with no failed, skipped or missing cases. Complete-file reruns
replace earlier results; this is not a claim that one full invocation passed.
See `test-results/current-unit-merged-evidence.json` and its source snapshot.
The final affected geometry run passed 300 cases in 64 files. Rust passed 35
geometry tests; the actual Tauri manifest passed one separate float-roundtrip
test. Eighteen separate component cases passed. Type checking, the debug desktop
build and the release build passed.
The final release passed hidden-window startup, real geometry execution,
save/reopen, exact fractional coordinates and normal shutdown checks in
`current-ear-final-release-smoke.json`, with executable and backend hashes recorded.
The final affected reference/contour run
passed 737 cases in 59 files, including the exact coarse-face subdivision and
shared RGB area-budget regressions. The real JPEG ear stripe and its source-certified tips also pass; the final lazy fallback change passed 77 cases in five files.

The current padded model produces 51 pieces from 6,176 source faces in one
31.50-second run. Independent coverage, correspondence, seam and narrow-neck
checks are in `garment-section-recheck/structure-v8-post-neck-merge/`. This one
measurement does not establish the older repeated-run performance target below.

Current-build desktop acceptance remains in progress. Do not use the historical
desktop results below as passing evidence for this build. The maintained change
record is `update/2026-10-23-pattern-model-progress.md`.

## Historical checkpoints and original acceptance plan

The following checkpoints retain their original observations and build scope.
Their test totals and pending defects are superseded by the current checkpoint
where a complete replacement report exists; their failed attempts remain saved.

Status: **in progress; final image, desktop and repeated performance acceptance remain pending**.
The initial frozen desktop run has completed. Its complete report and artifacts
are preserved under `test-results/current-repair/desktop/frozen-initial/`.
Do not treat that older build as verification of the final source changes.

The latest full Vitest run collected 264 files and 2,001 cases: 1,999 passed,
two failed, and none were skipped. Both failures were unsupported sharp turns
on blurred round ends in `contour-line-tip-inference.test.ts`. The corrected
soft-edge fit bridges isolated rejected samples between supported RGB crossings
while retaining consecutive missing samples as boundary constraints. All 29
cases in the inference and adversarial suites now pass, including horizontal
motion blur. The earlier supported-samples-only attempt failed that motion case;
its incomplete 110-file run is preserved as aborted and excluded from acceptance.
The second 110-file run, `image-regression-isolated-final`, was also stopped
after blur 1.5 and blur 2 exceeded their unchanged 60-second test limits
(79.716 and 81.926 seconds). Its saved geometry and metrics match the preceding
run; that does not establish that internal fitting work or execution cost was
unchanged. Both abort records and logs remain in `test-results/current-repair/`.
Neither run completes the 110-file regression. The 29-case passing report is
`tip-isolated-stations-run.json`; the earlier zero-case EPERM attempt is not
test evidence. No complete image rerun is currently counted as passing.

The focused geometry regression completed 36 files and 176 cases. Its first
report, `refiner-performance-regression.json`, retains one confirmed texture UV
failure after a child-diagonal change. After the production fix, all 15 cases
in three complete files passed in `refiner-texture-fixed.json`. Replacing those
three files produces **176/176** passing cases in `refiner-regression-merged.json`,
not 176 plus 15 cases. The nine refiner cases cover repeated-trial isolation,
shared edges, parent coordinates, saved seams, constraints and texture; three
real-native dart cases cover unrelated-chart vertex retention and failed-trial
cleanup. Source, test and production-native fingerprints were unchanged within
each run. The original texture failure remains preserved.

Final lifecycle and acceptance checks separately passed 85 integration cases
and seven component suites containing 71 checks, plus TypeScript checking.
These include files added after the full run was collected; final totals must
merge by file and case identity, never by adding overlapping pass counts.
Evidence is in `test-results/current-repair/loading-final/summary.json`.

The 35 passing Rust tests, formatting and Clippy results remain unchanged.
The final production TypeScript check and application build passed; their logs
are `frozen-typecheck.log` and `frozen-app-build.log`. These build results do not
complete the outstanding image or desktop verification.

The latest recorded full-model cut-preview run took **57.8586 seconds** and
passed its recorded timing/quality checks. It follows preserved timing failures
at 88.95, 62.50 and 61.83 seconds. Three serial passing runs and current-build
click-to-visible verification are still required. The older independently
audited 317-piece candidate and its 50.554-second development-worker timing
remain historical evidence, not a measurement of the final production path.
A hard timeout does not count as successful computation.

The isolated final `mapping-transform-e2e` run has been authorized. Authorization
is not a passing result; its fresh report must be recorded before closing that
desktop requirement. No overall passing result may combine aborted image runs
or older source/build evidence. The complete-file merge preview remains marked
incomplete in `validation-before-final-image-preview.json`.

## Recorded evidence and remaining work

Focused UI/transaction revalidation has now executed. Its machine-readable
summary is `test-results/current-repair/ui-repair-verification-summary.json`:

- `ui-seam-typecheck-final.log`: `npm run typecheck` exited 0 after dictionary
  cleanup and the new acceptance regressions. The dictionary static audit found
  1,356 unique keys and no duplicates (`ui-japanese-duplicates.json`).
- `ui-async-vitest.json`: all 14 cases passed across `ui-async-lifecycle`,
  `localization` and `mask-task-state`.
- `seam-acceptance-structure.json`: all 17 real acceptance transaction cases
  passed, including the four new empty-pieces/missing-binding/duplicate-binding/
  non-unit-barycentric cases and both legitimate historical solver formats.
- `ui-components/final-summary.json`: nine source component suites passed, plus
  the headless Chromium cutting workspace check passed at 1000×680, 1280×800 and
  1920×1080. The ten suites are task activity, startup loading, surface panel,
  GPU refresh inputs, mapping selection state, accepted seam lifecycle, unwrap
  lifecycle, cut selection, model viewport and cutting workspace rendering.
  The renderer check initially failed before page launch because no browser was
  found, then its explicit installed Chromium launch was denied by the sandbox.
  Both attempts remain logged. The successful retry used the existing browser
  outside the sandbox, stayed headless, and did not launch Tauri.

These results cover current UI sources and acceptance state integrity. They do
not certify the final native solver, real Tauri/GPU drawing, animation
smoothness, complete desktop workflows or the full-model one-minute budget.

The following are preserved earlier observations, not the current acceptance
result. They predate the full and focused runs described above; each applies
only to its original source/artifact.

| Evidence | Recorded outcome | Current acceptance status |
| --- | --- | --- |
| `test-results/current-repair/vitest-merged-summary.json` | 1,962 original cases; 1,959 passed, 3 failed after recorded retests | Incomplete. Remaining contour cases are `sharp-horizontal-motion` and analytic plateau/block blur 2 and 3; current contour edits and new UI lifecycle tests need verification. |
| `test-results/current-repair/components/final-summary.json` | 20 of 20 component suites passed in the recorded run | Historical component evidence. Menu bounds, localization and async lifecycle sources changed afterward; affected suites must run again. |
| `test-results/current-repair/desktop/frozen-initial/` | Original frozen run completed: 63 of 68 suites passed; failures were `offline`, `picking`, `ui-workflow`, `real-dual-view`, `page-layout` | Fixes and updated observable-behavior checks are prepared. Repeat on the final build; do not combine different builds into one passing desktop report. |
| `test-results/desktop/picking-e2e.log` and `test-results/picking-failure.png` | Heatmap uncheck was blocked by the 2D preview dock heading | Source fix prepared: an open Display menu rises above the dock and scrolls within stage bounds. New normal/small viewport assertions have not run. |
| `test-results/current-functional/mapping-context-reset.json` | Older report records four passing model/selection reset checks | Does not cover the newly added fifth real SurfacePanel same-tab reattach case. Current source test must run. |
| `test-results/desktop/mapping-transform-e2e.log` | Historical failure: symmetric brush contours had 153 nodes each against the less-than-80 expectation | Isolated final run authorized; its current-build result is still pending. Do not infer success from other mapping component results. |
| `test-results/desktop/current-revision-seams-e2e.log` | Historical run recorded three checks and 56,491 ms computation | Does not certify the current solver, geometric quality, renderer cadence or three-run timing budget. |

Do not overwrite these observations with a passing label until the corresponding
fresh report exists. The live desktop report may grow after this audit snapshot.

| User interaction requirement | Production path / prepared regression | Remaining verification |
| --- | --- | --- |
| Immediate animated loading on project open/read, save, compute and accept | `App.vue`, `TaskActivity.vue`, `store.ts`; startup/task component suites and real UI performance checks | Recheck current sources and capture actual frame cadence without screenshot/serialization measurement interference. |
| Local loading for mask selection, segmentation, printing and assistant settings | `MaskEditor.vue`, `ReferencesPanel.vue`, `InlineActivity.vue`, `CutSelection.vue`, `AssistantPage.vue`, `AssistantConnection.vue` | `mask-task-state`, `ui-async-lifecycle`, localization and actual page checks. Read-only preview dismissal ignores late replies; it is not a native task abort API. |
| Cancel keeps busy until worker exit and prevents late project writes | Main controllers, `surface-task-queue.ts`, signal chain in marking projection/mapping, `surface-runtime.ts`; queue/runtime/budget/source-cancel tests and `late-cancel-e2e` | Run controller/termination regressions and the real mapping-stage native cancellation check. Ensure project/history/recovery stay unchanged. |
| Hard one-minute cut limit, actionable failure, and successful output below the budget | 60,000 ms `runCutPreview` deadline and `UnwrapTools.vue` timeout notice; runtime budget and unwrap lifecycle cases | Verify the real fixture succeeds below 60 seconds in three serial runs and meets geometry/seam checks. A timeout is a failure, never a completed candidate. |
| Page exit removes timers/listeners and suppresses stale navigation/popups | Unwrap progress/timer cleanup, SurfacePanel menu observer and seam validation generation, preview generation, assistant status/settings guards | Re-run `unwrap-lifecycle-component`, `model-viewport-component`, `ui-async-lifecycle`; unmount during awaited accept/save/read, then resolve or reject it. |
| Clear markings and reattach in the same Mapping tab | SurfacePanel context reset, current marking selection and free-transform draft ownership; mapping-selection and mapping-context-reset tests | Actual same-tab library drag must select only the new ID, show fill and eight resize handles, and retain library contents. |
| Attached outer/hole nodes and free transforms stay editable | SurfacePanel plane/gesture state; attached-editing, mapping-transform, drawing-plane and mapping-selection cases | Oblique/occluded views, resizing/rotation, Enter/Escape/Shift, one-step undo/redo and successful reopen. |
| Candidate and saved cut lines remain visible in Mapping | Candidate seam preview, saved-run fallback and async integrity validation; accepted-seam lifecycle, current-revision-seams and independent geometry audits | Fresh saved cut + colored material candidate + accept + display toggles + reload. Inspect real raster lines, not only DOM/data counts. |
| Display menus and model popovers stay usable above the 2D dock | SurfacePanel open-menu stacking/bounds, CuttingPage local stacking context; model viewport and picking cases | Heatmap on/off at normal and small viewports with the dock visible; no forced clicks or hidden-dock workarounds. |
| Chinese, English and Japanese loading/retry/cancel controls | `localization.ts`, `japanese.ts`, localized unwrap stages/allowance notices | New localization regression plus Japanese real page coverage for both in-progress and timeout states. |
| Desktop tests stay hidden and do not steal focus | `desktop-launch.mjs` background flag, `desktop-window.mjs` hidden-window assertion, main background launch/second-instance guards | Preserve background-window evidence in the fresh run; inspect any test-owned DesktopWindow flags before launch. |
| Archive/reopen/export preserve units and state | Existing isolated archive/output/workflow tests and failure-state contracts | Re-run full suite and desktop output checks against the final build; preserve the 100 mm ruler. |

## Evidence and isolation

- Record the source revision, changed-file list, Node/Rust versions and actual
  commands. Preserve failed attempts separately; do not replace them with only a
  later passing summary.
- Keep run logs and new audit reports in `test-results/current-repair/`.
- Every desktop test must use an isolated `.local/tests/` project. Do not open,
  modify, clean or hash `.local/workspace/` for this run.
- Use the real release Rust worker. Never substitute a fake geometry process.
- Run geometry performance and actual GPU desktop checks serially. Full Vitest
  has its own configured worker limit; do not start another suite alongside it.
- A missing fixture is a blocked or skipped check, not a pass. Component hosts do
  not establish actual Tauri/GPU display or animation smoothness.

## Complete build and core verification

Run these once after the source freeze, in order. Stop and repair failures before
continuing to a check that depends on the failed artifact.

```powershell
node scripts/generate-contracts.mjs
npm run build:rust
npm run typecheck
npm test -- --reporter=json --outputFile=test-results/current-repair/vitest.json
npm run test:rust
node scripts/cargo.mjs fmt --check
node scripts/cargo.mjs clippy --all-targets --offline -- -D warnings
npm run build
npm run docs:check
```

Contract generation has completed for the current seam-report schema. The
existing generator bundles its helper into `.tools/generate-contracts.mjs`,
updates seven JSON contracts in `packages/schema/generated/` (`custom-template`,
`mask`, `point`, `piece`, `project`, `request`, `workflow`), and overwrites
`crates/geometry-core/src/schema_generated.rs`. It does not build `dist` or the
native executable. Coordinate the Rust generated-file write with its owner,
inspect those diffs, then run the checks above. Do not run the generator while
the coordinator is still editing schema/Rust inputs.

The full Vitest run covers all `tests/**/*.test.ts` selected by
`vitest.config.ts`; do not replace it with only a list of targeted cases. In
particular inspect the outcomes of worker sessions, progress cancellation,
reference candidates, task queues, UI async lifecycle, localization, draft
history, topology provenance, archive roundtrips, material history, final core
state and design-cut regressions.

## Component and rendering checks

Run the following component suites individually and preserve each exit status.
They exercise the production Vue sources, but some replace DOM/IPC/renderers.

```powershell
node tests/task-activity-component.mjs
node tests/startup-loading-component.mjs
node tests/surface-panel-component.mjs
node tests/surface-gpu-refresh-component.mjs
node tests/mapping-selection-state-component.mjs
node tests/drawing-plane-delta-component.mjs
node tests/workflow-editing-component.mjs
node tests/legacy-paint-edit-component.mjs
node tests/line-visibility-component.mjs
node tests/trim-material-preview-component.mjs
node tests/accepted-seam-lifecycle-component.mjs
node tests/unwrap-lifecycle-component.mjs
node tests/current-brush-component.mjs
node tests/surface-scope-component.mjs
node tests/cut-selection-component.mjs
node tests/assembly-preview-component.mjs
node tests/model-viewport-component.mjs
node tests/model-manufacturing-controls-component.mjs
node tests/surface-inspector-render.mjs
node tests/cut-workspace-render.mjs
```

Conditional suites require explicitly prepared isolated evidence:

- `source-region-locality-component.mjs` requires the fixed real project export
  and locality evidence identified in `tests/README.md`; it must not substitute a
  currently open user project.
- `legacy-handle-visibility-component.mjs <isolated-workflow.json>` requires the
  exact project hash recorded in `tests/fixtures/legacy-handle-occlusion.json`.
- `current-legacy-paint-confirm-e2e` requires an isolated accepted baseline with
  168 pieces, as documented in `tests/README.md`. That count is a fixture identity,
  not the expected count for newly computed candidates.

## Full desktop workflow

```powershell
$env:FPCAD_TEST_GPU='1'
npm run test:desktop -- --jobs 1
node scripts/test-desktop.mjs --jobs 1 mapping-transform-e2e
```

The default desktop suite does not include `mapping-transform-e2e`. Preserve the
default report before the second command because the runner rewrites
`test-results/desktop-verification.json` for a new explicit selection. Preserve
per-suite logs under `test-results/current-repair/` as well.

The final desktop acceptance must directly exercise:

1. Select an attached marking, drag outer and hole nodes, cancel, then confirm;
   verify draft-only edits do not increment revision and confirmation commits
   once. Repeat with an oblique camera and an occluding unrelated surface.
2. Clear all current-model markings while selection or node-edit state exists;
   remain on Mapping and immediately drag a source onto the model. Confirm that
   selection, fill, node editing and resize handles work without a tab change.
3. Drag square resize handles and the rotation handle. Check draft numerical
   synchronization, Enter commit, Escape cancellation, Shift behavior, locked
   controls and one-step undo/redo.
4. Draw a saved surface cut, compute with two distinguishable material regions,
   inspect candidate seams in Mapping, accept, inspect saved seams, toggle their
   display and reload. Check final raster output as well as DOM presence.
5. Click Compute/Accept/Save/Open and observe immediate feedback and continuing
   animation. Record real animation-frame cadence and long tasks independently
   of test-driven full-project serialization or screenshots.
6. Cancel native computation in at least two phases. Confirm the task remains
   busy until the worker exits; no late candidate or progress can be committed.
7. Save `.fpcad`, reopen it in an isolated library, undo/redo, restore a cut
   snapshot, export SVG/DXF/PDF/PNG and verify millimetre scale plus the 100 mm
   ruler. Invalid/stale/unreviewed inputs must fail without changing project,
   history, recovery points or replay state.

Do not run the existing `current-accepted-final/timing/profile` scripts unchanged:
they hash the user library and rely on historical temporary baseline paths. Use
an explicitly supplied isolated baseline instead.

## Independent candidate geometry and seam audit

Use the immutable full-model input:

`test-results/current-cutting/consolidated/performance-repeat-3/input.json`

Historical input SHA-256:
`961723e4fe08a0f7801d6d53624334d109ae2f993e0d5075ac107bad11c7b846`.
Record the actual bytes/hash in each new result; do not assume a piece count.

```powershell
node tests/independent-cut-correspondence.mjs test-results/current-cutting/consolidated/performance-repeat-3/input.json test-results/current-repair/candidate.json --name candidate-current
node tests/independent-cut-correspondence.mjs test-results/current-cutting/consolidated/performance-repeat-3/input.json test-results/current-repair/candidate.json --name candidate-strict --strict-seams --seam-mm 1 --seam-relative .01
```

The first command reports seam policy failures without making them the geometry
exit gate. The second gates both geometry and seam policy. The 1 mm / 1% limits
are explicit audit policy and may be changed by the coordinator for an intended
material; report the chosen values. Local segment mismatches and connected-chain
length mismatches are both retained so cancellation in total lengths cannot hide
local stretching.

The oracle reconstructs shared physical lines from original-face trim
barycentrics, unifies unequal subdivisions, cancels internal UV-continuous edges,
checks original-face coverage and overlaps, checks actual piece outlines in both
directions, and exercises production 2D/3D maps against independent affine
coordinates. It imports no production seam/coverage/deduplication algorithm.
Legacy bindings without trim and curved candidate outlines fail explicitly until
an appropriate independent oracle is supplied.

Before trusting the new oracle, run it against independently specified analytic
positive/negative inputs: exact planar halves, unequal collinear subdivision,
oppositely oriented edge traversal, a scaled UV seam, a missing region, an
overlapping region, UV foldover, and disconnected coincident source faces. These
oracle checks must not be generated from production solver outputs.

```powershell
node tests/independent-cut-correspondence-oracle.mjs
node tests/independent-outline-distance-oracle.mjs
```

Seam-constraint additions are prepared separately; they must be verified after
the new internal solver is integrated, without overlapping frozen desktop runs:

```powershell
node tests/seam-correspondence-regression.mjs --prepare-only
node tests/seam-correspondence-regression.mjs
npm test -- tests/integration/seam-failure-acceptance.test.ts
```

See `seam-solver-acceptance-contract.md` for the native-integration failure and
cancellation checks. The analytic fixtures do not invoke or validate a native
seam solver. The micro-edge negatives deliberately check for loss of a real
shared segment during topological welding.

## Full-model timing

Run the real input through the production cut-preview path after all other
verification has stopped. Save the new candidate to
`test-results/current-repair/candidate.json` and run the independent audit above.
Perform at least three serial measurements, recording cold/warm worker state,
options, process priority and environment. Preserve all measured runs.

Measure both solver-to-candidate and click-to-visible-candidate time; the user
budget is below 60 seconds. Record preparation, partition, unwrap, remap,
validation, transport and display separately. Do not interpret cumulative native
solver time as wall-clock latency. Preserve quality thresholds and compare color
areas, source coverage, seam correspondence and mapping alongside speed.

The historical three serial results were 58.255, 57.572 and 56.851 seconds on the
same 8,620-face input, leaving little margin. Historical acceptance reports also
showed one-second renderer stalls; their `passed` field does not certify smooth
interaction.

Current timing history remains separate from those older repeats:

| Recorded run | Wall time | Current status |
| --- | --- | --- |
| `current-repair/final-performance-1/report.json` | 88.95 s | Failed the unchanged 60-second gate; preserve candidate and report. |
| Coordinator-recorded intermediate trial | 62.50 s | Failed the same gate; not a passing repeat. |
| `current-repair/optimized-performance-1/report.json` | 61.83 s | Failed the same gate; preserve candidate and report. |
| `current-repair/optimized-budget-performance-1/report.json` | 57.8586 s | One passing recorded run. Three serial passes and real current-build click-to-visible timing remain pending. |

Paths in this table are relative to `test-results/`. Piece counts are recorded
outputs, not acceptance targets. The independent geometry/seam audit and actual
desktop display checks remain separate requirements for the final candidate.
