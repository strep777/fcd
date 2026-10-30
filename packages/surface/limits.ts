/** Import/display budgets are separate from exact manufacturing solvers. */
export const MESH_VERTICES=200_000;
export const MESH_FACES=200_000;
/** Persisted correspondence and preview-edge budgets, not source-face limits. */
export const TRIM_TRIANGLES=400_000;
export const CUT_PREVIEW_EDGES=50_000;
/** Shared by the manufacturing repair loop and persisted run contract. */
export const UNWRAP_REPAIR_PASSES=12;
export const MESH_FILE_BYTES=64*1024*1024;
export const SURFACE_WORKER_BYTES=64*1024*1024;
