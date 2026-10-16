import {it,expect} from 'vitest';
import {parseObj} from '../../apps/desktop/main/surface';
import {surfaceMarkingBatches,surfaceVertexStride,type Vector3} from '../../packages/surface/rendering';

const center={cx:0,cy:0,cz:0},surface=parseObj('v 0 0 0\nv 10 0 0\nv 0 10 0\nv 10 10 0\nf 1 2 3\nf 2 4 3');
const ring=(points:number[][])=>points.map(([x,y])=>[1-x/10-y/10,x/10,y/10] as Vector3);
const square=(x0:number,y0:number,x1:number,y1:number)=>ring([[x0,y0],[x1,y0],[x1,y1],[x0,y1]]);
const marking=(fragments:{faceId:string;rings:Vector3[][]}[],color='#224466')=>({surfaceId:surface.id,topologyVersion:surface.topologyVersion,color,fragments});
// Replay the real GPU buffer semantics: INVERT fan triangles, fill the batch,
// clear stencil, then overlay the next batch. Samples avoid fan/shared edges.
function painted(batches:ReturnType<typeof surfaceMarkingBatches>,x:number,y:number){let color:number[]|undefined;for(const batch of batches){let odd=false;for(let i=0;i<batch.mask.length;i+=3*surfaceVertexStride){const points=[0,1,2].map(j=>batch.mask.slice(i+j*surfaceVertexStride,i+j*surfaceVertexStride+2)),cross=(a:number[],b:number[])=>((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])),signs=points.map((p,j)=>cross(p,points[(j+1)%3]));if(signs.every(s=>s>1e-9)||signs.every(s=>s< -1e-9))odd=!odd;}if(odd)color=batch.fill.slice(5,8);}return color;}

it('unions overlapping same-face fragments while preserving a fragment hole in actual GPU masks',()=>{
 const source=marking([{faceId:surface.faces[0].id,rings:[square(1,1,5,5),square(1.5,1.5,2.5,2.5)]},{faceId:surface.faces[0].id,rings:[square(3,1,7,3)]}]),before=structuredClone(source),batches=surfaceMarkingBatches(surface,[source],center);
 expect(painted(batches,4.2,2.3)).toEqual([0x22/255,0x44/255,0x66/255]);
 expect(painted(batches,2.1,1.8)).toBeUndefined();expect(painted(batches,6.3,1.7)).toBeDefined();expect(painted(batches,.3,.4)).toBeUndefined();expect(batches).toHaveLength(2);expect(source).toEqual(before);
});
it('keeps ordinary distinct-face fragments in one batch and overlays later marking colors',()=>{
 const fragments=surface.faces.map(f=>({faceId:f.id,rings:[[[1,0,0],[0,1,0],[0,0,1]] as Vector3[]]})),normal=surfaceMarkingBatches(surface,[marking(fragments)],center);expect(normal).toHaveLength(1);expect(normal[0].fill).toHaveLength(6*surfaceVertexStride);
 const lower=marking([{faceId:surface.faces[0].id,rings:[square(1,1,5,5)]}]),upper=marking([{faceId:surface.faces[0].id,rings:[square(3,1,7,3)]}],'#cc3344'),layers=surfaceMarkingBatches(surface,[lower,upper],center);expect(layers).toHaveLength(2);expect(painted(layers,4.2,2.3)).toEqual([0xcc/255,0x33/255,0x44/255]);expect(painted(layers,1.3,2.2)).toEqual([0x22/255,0x44/255,0x66/255]);
});
