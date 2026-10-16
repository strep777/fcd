import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {surfaceSchema,surfaceReportSchema} from '../packages/schema/index';
import {necessaryTopologyCuts,openDesignSeams} from '../packages/surface/design-cuts';
import {designQualityFailure} from '../packages/surface/design-partition';
import {request} from '../apps/desktop/main/worker';
it('places a repair dart at measured failing material instead of a remote curvature peak',async()=>{
 const mesh=surfaceSchema.parse(JSON.parse(await readFile(resolve('tests/fixtures/design-dart-target.json'),'utf8'))),worker=resolve('target/release/fpcad-worker.exe');
 const solve=async(input:typeof mesh)=>{const response=await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{...input,repair_cuts:false,method:'arap',iterations:30}}) as {patches:unknown[]};return response.patches.map(p=>surfaceReportSchema.parse(p));};
 const before=await solve(mesh);expect(before.some(designQualityFailure)).toBe(true);
 const remote=necessaryTopologyCuts(mesh,[mesh.faces.map(f=>f.id)]),unfocused=await solve(openDesignSeams({...mesh,cutConstraints:remote.edges.map(e=>({...e,locked:true}))},randomUUID));expect(unfocused.some(designQualityFailure)).toBe(true);
 const failed=before.flatMap(p=>p.faceDistortion??[]).filter(d=>designQualityFailure({areaErrorMax:d.areaError,edgeErrorMax:d.edgeError,distortionMax:d.distortion})).map(d=>d.faceId),cut=necessaryTopologyCuts(mesh,[failed]);
 expect(cut.seams).toBe(1);const opened=openDesignSeams({...mesh,cutConstraints:cut.edges.map(e=>({...e,locked:true}))},randomUUID),after=await solve(opened);
 expect(after).toHaveLength(1);expect(after.some(designQualityFailure)).toBe(false);expect(opened.faces.map(f=>f.id).sort()).toEqual(mesh.faces.map(f=>f.id).sort());
});
