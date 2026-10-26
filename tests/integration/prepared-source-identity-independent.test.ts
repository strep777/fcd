import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {parseObj} from '../../apps/desktop/main/surface';
import {prepareDesignSurface,unwrapDesignSurface,restoreDesignBindings} from '../../apps/desktop/main/design-cuts';
import {mapFromSurface,mapToSurface} from '../../packages/surface/mapping';
import {project} from '../fixtures';

it('prepared design candidates retain independent coincident source edges instead of welding an imported seam',async()=>{
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;
 // These are two separately indexed source panels sharing only coordinates.
 // Their seam predates all automatic/material preparation.
 p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 4 5 6');
 const before=structuredClone(p),worker=resolve('target/release/fpcad-worker.exe');
 const working=await prepareDesignSurface(worker,p,true,true);
 const flattened=await unwrapDesignSurface(worker,p,working,{partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,method:'arap'});
 const run=restoreDesignBindings(p,working,flattened.run);
 expect(p).toEqual(before);
 expect(run.pieces).toHaveLength(2);
 expect(run.bindings.map(b=>b.report.faceIds.length).sort()).toEqual([1,1]);
 expect(run.bindings.flatMap(b=>b.report.faceIds).sort()).toEqual(p.surface.faces.map(f=>f.id).sort());
 for(const binding of run.bindings){
  const faceId=binding.report.faceIds[0],weights:[number,number,number]=[.2,.3,.5];
  const flat=mapFromSurface(binding,faceId,weights,p.surface);expect(flat).not.toBeNull();
  const hit=mapToSurface(p.surface,binding,flat!);expect(hit).not.toBeNull();expect(hit!.faceId).toBe(faceId);
  hit!.barycentric.forEach((w,i)=>expect(w).toBeCloseTo(weights[i],12));
 }
});
