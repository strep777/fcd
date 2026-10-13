import {it,expect} from 'vitest';
import {parseObj,unwrapSurface} from '../../apps/desktop/main/surface';
import {mapToSurface,mapFromSurface} from '../../packages/surface/mapping';
import {project} from '../fixtures';
import {resolve} from 'node:path';
it('accepted UV ↔ triangle barycentric mapping roundtrips and refuses out-of-domain or stale maps',async()=>{
 const surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 200 0\nv 0 200 0\nf 1 2 3\nf 1 3 4'),run=await unwrapSurface(resolve('target/release/fpcad-worker.exe'),surface,{...project(),pieces:[]}),binding=run.bindings[0],face=surface.faces[0],uv=mapFromSurface(binding,face.id,[.2,.3,.5],surface)!;
 const hit=mapToSurface(surface,binding,uv)!;expect(hit.position.xMm).toBeCloseTo(80,7);expect(hit.position.yMm).toBeCloseTo(100,7);expect(hit.position.zMm).toBe(0);expect(mapFromSurface(binding,hit.faceId,hit.barycentric,surface)?.xMm).toBeCloseTo(uv.xMm,7);expect(mapToSurface(surface,binding,{xMm:-10000,yMm:-10000})).toBeNull();expect(mapToSurface({...surface,topologyVersion:2},binding,uv)).toBeNull();expect(mapFromSurface(binding,face.id,[-.1,.2,.9],surface)).toBeNull();
});
