import {it,expect} from 'vitest';
import {parseObj} from '../../apps/desktop/main/surface';
import {surfaceCornerNormals,surfaceMarkingBatches,surfaceRenderGroups,surfaceVertexStride,surfaceLight,surfaceViewNormal,surfaceLightGradient,shadedColor,type Vector3} from '../../packages/surface/rendering';

const center={cx:3,cy:4,cz:5};
it('smooths shared curved corners across fabrication regions without changing coordinates, cuts or topology',()=>{
 const surface=parseObj('v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 -10 10\ng first\nf 1 2 3\ng second\nf 2 1 4');surface.cutConstraints=[{a:surface.vertices[0].id,b:surface.vertices[1].id,locked:true}];const before=structuredClone(surface),normals=surfaceCornerNormals(surface),[a,b]=surface.faces;
 for(const id of [surface.vertices[0].id,surface.vertices[1].id]){const na=normals.get(a.id)![a.vertices.indexOf(id)],nb=normals.get(b.id)![b.vertices.indexOf(id)];expect(na).toEqual(nb);expect(na[1]).toBeGreaterThan(0);expect(na[2]).toBeGreaterThan(0);expect(Math.hypot(...na)).toBeCloseTo(1,12);}
 const groups=surfaceRenderGroups(surface,surface.faces.map(face=>({...face,color:'#b9bec6'})),center,normals),array=groups.get('')!;expect(array).toHaveLength(6*surfaceVertexStride);for(let face=0;face<2;face++)for(let corner=0;corner<3;corner++){const v=surface.vertices.find(v=>v.id===surface.faces[face].vertices[corner])!,offset=(face*3+corner)*surfaceVertexStride;expect(array.slice(offset,offset+3)).toEqual([v.xMm-center.cx,v.yMm-center.cy,v.zMm-center.cz]);}expect(surface).toEqual(before);
});
it('preserves a ninety-degree hard edge and does not smooth disconnected coincident vertices',()=>{
 const surface=parseObj('v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nv 0 0 0\nv 10 0 0\nv 0 -10 10\nf 1 2 3\nf 2 1 4\nf 6 5 7'),normals=surfaceCornerNormals(surface);
 expect(normals.get(surface.faces[0].id)![0]).toEqual([0,0,1]);expect(normals.get(surface.faces[1].id)![0]).toEqual([0,1,0]);const disconnected=normals.get(surface.faces[2].id)![0];expect(disconnected[0]).toBe(0);expect(disconnected[1]).toBeCloseTo(Math.SQRT1_2,12);expect(disconnected[2]).toBeCloseTo(Math.SQRT1_2,12);
});
it('barycentric marking parity masks retain concave shapes, holes and exact source-plane depth',()=>{
 const surface=parseObj('v 0 0 0\nv 10 0 10\nv 0 10 20\nf 1 2 3'),ring=(points:number[][])=>points.map(([x,y])=>[1-x/10-y/10,x/10,y/10] as Vector3),outer=ring([[1,1],[6,1],[6,2],[3,2],[3,6],[1,6]]),hole=ring([[1.5,3],[2.5,3],[2.5,4],[1.5,4]]),marking={surfaceId:surface.id,topologyVersion:surface.topologyVersion,color:'#224466',fragments:[{faceId:surface.faces[0].id,rings:[outer,hole]}]},before=structuredClone(surface),batch=surfaceMarkingBatches(surface,[marking],{cx:0,cy:0,cz:0})[0];
 expect(batch.fill).toHaveLength(3*surfaceVertexStride);for(let i=0;i<batch.mask.length;i+=surfaceVertexStride)expect(batch.mask[i+2]).toBeCloseTo(batch.mask[i]+2*batch.mask[i+1],12);
 function parity(x:number,y:number){let count=0;for(let i=0;i<batch.mask.length;i+=3*surfaceVertexStride){const points=[0,1,2].map(j=>batch.mask.slice(i+j*surfaceVertexStride,i+j*surfaceVertexStride+2)),cross=(a:number[],b:number[])=>((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])),signs=points.map((a,j)=>cross(a,points[(j+1)%3]));if(signs.every(s=>s>1e-9)||signs.every(s=>s< -1e-9))count++;}return count%2;}
 expect(parity(5,1.4)).toBe(1);expect(parity(1.4,5)).toBe(1);expect(parity(4,4)).toBe(0);expect(parity(1.9,3.3)).toBe(0);expect(surface).toEqual(before);
 expect(surfaceMarkingBatches(surface,[{...marking,topologyVersion:2}],center)).toEqual([]);
});
it('software fallback interpolates the same studio corner lights and leaves dark colors legible',()=>{
 const lights=[surfaceLight([0,0,1]),surfaceLight(surfaceViewNormal([0,0,1],.6,0)),surfaceLight([0,1,0])],points=[{x:0,y:0},{x:100,y:0},{x:0,y:100}],field=surfaceLightGradient(points,lights)!;
 for(const [i,p] of points.entries()){const dx=field.x1-field.x0,dy=field.y1-field.y0,t=((p.x-field.x0)*dx+(p.y-field.y0)*dy)/(dx*dx+dy*dy);expect(field.min+(field.max-field.min)*t).toBeCloseTo(lights[i],12);}
 for(const normal of [[0,0,1],[0,0,-1],[0,1,0],[1,0,0]] as Vector3[])expect(surfaceLight(normal)).toBeGreaterThanOrEqual(.62);expect(shadedColor('#000000',lights[0])).toBe('#000000');expect(surfaceLightGradient(points,[1,1,1])).toBeNull();
});
it('preserves distortion heatmap CSS colors in the unlit software fallback',()=>{
 expect(shadedColor('hsl(120 75% 50%)',1)).toBe('hsl(120 75% 50%)');
 expect(shadedColor('hsl(120 75% 50%)',.8)).toBe('hsl(120 75% 50%)');
 expect(shadedColor('#abcdef',1)).toBe('#abcdef');
 expect(shadedColor('#808080',.5)).toBe('#404040');
});
