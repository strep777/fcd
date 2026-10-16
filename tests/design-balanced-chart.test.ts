import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {surfaceSchema,surfaceReportSchema,type Surface} from '../packages/schema/index';
import {project} from './fixtures';
import {unwrapSurface} from '../apps/desktop/main/surface';
import {request,analyze} from '../apps/desktop/main/worker';
import {designQualityFailure} from '../packages/surface/design-partition';
it('tries a feasible material chart before adding any repair seams',async()=>{
 const input=JSON.parse(await readFile(resolve('tests/fixtures/arap-balanced-real-domain.json'),'utf8')) as Pick<Surface,'vertices'|'faces'>,ids=new Map(input.vertices.map(v=>[v.id,randomUUID()])),mesh=surfaceSchema.parse({id:randomUUID(),topologyVersion:1,source:'obj',vertices:input.vertices.map(v=>({...v,id:ids.get(v.id)!})),faces:input.faces.map(f=>({...f,id:randomUUID(),vertices:f.vertices.map(id=>ids.get(id)!)}))}),worker=resolve('target/release/fpcad-worker.exe'),p=project();p.pieces=[];p.surface=mesh;
 const response=await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{...mesh,method:'arap',iterations:30,repair_cuts:false}}) as {patches:unknown[]};expect(response.patches.map(r=>surfaceReportSchema.parse(r)).some(designQualityFailure)).toBe(true);
 const before=structuredClone(mesh),run=await unwrapSurface(worker,mesh,p,{method:'arap',automaticCuts:true,partitionStrategy:'design'});
 expect(mesh).toEqual(before);expect(run.pieces).toHaveLength(1);expect(run.bindings.some(b=>designQualityFailure(b.report))).toBe(false);expect(run.designCutReport?.distortionSeams).toBe(0);expect((await analyze(worker,{...p,pieces:run.pieces})).flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
});
