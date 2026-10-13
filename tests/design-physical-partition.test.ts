import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {surfaceSchema,surfaceReportSchema} from '../packages/schema/index';
import {splitDesignDomain,designQualityFailure} from '../packages/surface/design-partition';
import {request} from '../apps/desktop/main/worker';
it('uses two feasible physical panels instead of four panels biased by triangle sample density',async()=>{
 const mesh=surfaceSchema.parse(JSON.parse(await readFile(resolve('tests/fixtures/design-split-density.json'),'utf8'))),before=structuredClone(mesh),parts=splitDesignDomain(mesh,mesh.faces),worker=resolve('target/release/fpcad-worker.exe');
 expect(parts).toHaveLength(2);expect(parts.flat().map(f=>f.id).sort()).toEqual(mesh.faces.map(f=>f.id).sort());expect(mesh).toEqual(before);
 for(const faces of parts){const used=new Set(faces.flatMap(f=>f.vertices)),response=await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:mesh.vertices.filter(v=>used.has(v.id)),faces,method:'arap',iterations:30,repair_cuts:false}}) as {patches:unknown[]};expect(response.patches.map(r=>surfaceReportSchema.parse(r)).some(designQualityFailure)).toBe(false);}
});
