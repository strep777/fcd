import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import {gridMesh} from '../large-mesh-fixture';
import {unwrapSurface,parseObj} from '../../apps/desktop/main/surface';
import {request} from '../../apps/desktop/main/worker';
import {nativeSurfaceResponseSchema} from '../../packages/surface/native-report';
import {surfaceReportSchema} from '../../packages/schema/index';
import {simplifyReportBoundary} from '../../packages/surface/planar';
it('simplifies redundant native boundary samples before enforcing the saved contour limit',async()=>{
 const p=project();p.pieces=[];p.surface=gridMesh(1050,1);p.surface.faces.forEach(f=>f.region='body');
 const response=nativeSurfaceResponseSchema.parse(await request(resolve('target/release/fpcad-worker.exe'),{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:p.surface.vertices,faces:p.surface.faces,method:'lscm'}}));
 expect(response.patches[0].boundary.length).toBeGreaterThan(2000);
 expect(surfaceReportSchema.safeParse(response.patches[0]).success).toBe(false);
 expect(surfaceReportSchema.safeParse(simplifyReportBoundary(response.patches[0])).success).toBe(true);
 const run=await unwrapSurface(resolve('target/release/fpcad-worker.exe'),p.surface,p,{partitionStrategy:'design',automaticCuts:true});
 expect(run.pieces).toHaveLength(1);expect(run.bindings[0].report.boundary.length).toBeLessThanOrEqual(2000);
 expect(run.bindings[0].report.faceIds).toHaveLength(2100);
 expect(run.bindings[0].report.distortionMax).toBeLessThan(1e-6);
},60000);
it('retains the requested final piece limit after solving temporary charts',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 10 0 0\nv 0 10 0\nv 20 0 0\nv 30 0 0\nv 20 10 0\nf 1 2 3\nf 4 5 6');const before=structuredClone(p);
 await expect(unwrapSurface(resolve('target/release/fpcad-worker.exe'),p.surface,p,{partitionStrategy:'design',automaticCuts:true,maxPieces:1})).rejects.toMatchObject({code:'PATCH_LIMIT'});
 expect(p).toEqual(before);
});
