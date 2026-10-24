import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {project,rectangle} from '../fixtures';
import {gridMesh} from '../large-mesh-fixture';
import {projectMarking} from '../../apps/desktop/main/markings';
import {prepareDesignSurface,unwrapDesignSurface,restoreDesignBindings} from '../../apps/desktop/main/design-cuts';
import {unwrapSurface,bindingIssues} from '../../apps/desktop/main/surface';
const worker=resolve('target/release/fpcad-worker.exe');
it('cuts a supported source whose exact color boundaries generate more than 50000 triangles',async()=>{
 const p=project();p.pieces=[];p.surface=gridMesh(160,156);p.surface.faces.forEach(f=>f.region='body');
 const source=rectangle(801,1560);source.allowanceMm=0;source.nodes.forEach(n=>n.xMm+=399.5);
 p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'body'}];
 p.markings=[await projectMarking(worker,p,source.id,'front',0,0)];
 const before=JSON.stringify(p),working=await prepareDesignSurface(worker,p,true,true);
 expect(p.surface.faces.length).toBeLessThanOrEqual(50000);expect(working.surface.faces.length).toBeGreaterThan(50000);
 const {run}=await unwrapDesignSurface(worker,p,working,{partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true});
 const restored=restoreDesignBindings(p,working,run);
 expect(restored.pieces).toHaveLength(3);
 expect(bindingIssues({...p,pieces:restored.pieces,bindings:restored.bindings}).filter(i=>i.severity==='error')).toEqual([]);
 expect(restored.bindings.every(b=>b.report.distortionMax<1e-6)).toBe(true);
 expect(JSON.stringify(p)).toBe(before);
},180000);
it('still rejects an original model above the native input budget',async()=>{
 const p=project();p.surface=gridMesh(160,157);
 await expect(unwrapSurface(worker,p.surface,p,{partitionStrategy:'design'})).rejects.toMatchObject({code:'UNWRAP_LIMIT'});
},30000);
