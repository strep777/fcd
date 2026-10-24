import {z} from 'zod';
import {surfaceReportSchema} from '../schema/index';
import {MESH_VERTICES} from './limits';

// A native boundary follows mesh edges, including redundant tessellation points.
// The saved report still uses surfaceReportSchema after precision-preserving
// simplification or further partitioning; do not loosen the persisted contract.
export const nativeSurfaceResponseSchema=z.object({ok:z.literal(true),protocolVersion:z.literal(1),patches:z.array(surfaceReportSchema.extend({boundary:z.array(z.string().uuid()).min(3).max(MESH_VERTICES)})).max(500)});
