import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {sectionDesignDomain} from '../../packages/surface/design-section';
import {validateSurface} from '../../apps/desktop/main/surface';
import type {Surface} from '../../packages/schema/index';
function cylinder():Surface{const vertices:Surface['vertices']=[],faces:Surface['faces']=[];for(let y=0;y<=5;y++)for(let i=0;i<16;i++)vertices.push({id:randomUUID(),xMm:40*Math.cos(i*Math.PI/8+Math.PI/16),yMm:y*20,zMm:40*Math.sin(i*Math.PI/8+Math.PI/16)});for(let y=0;y<5;y++)for(let i=0;i<16;i++){const a=y*16+i,b=y*16+(i+1)%16,c=(y+1)*16+i,d=(y+1)*16+(i+1)%16;for(const tri of[[a,c,b],[b,c,d]])faces.push({id:randomUUID(),vertices:tri.map(i=>vertices[i].id) as [string,string,string],region:'cloth'});}return{id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces};}
it('cuts a cylinder through original triangle interiors with a straight physical section and exact coverage',()=>{
 const mesh=cylinder(),before=structuredClone(mesh),result=sectionDesignDomain(mesh,mesh.faces,randomUUID);expect(result).toBeDefined();expect(mesh).toEqual(before);validateSurface(result!.surface);expect(result!.parts).toHaveLength(2);
 const ids=new Set(result!.parts.flat().map(f=>f.id));expect(ids.size).toBe(result!.surface.faces.length);
 const original=new Set(mesh.vertices.map(v=>v.id)),created=result!.surface.vertices.filter(v=>!original.has(v.id));expect(created.length).toBeGreaterThan(0);for(const v of created)expect(Math.abs(result!.plane.normal.reduce((sum,n,i)=>sum+n*[v.xMm,v.yMm,v.zMm][i],0)-result!.plane.position)).toBeLessThan(1e-7);
 for(const children of result!.children.values()){const sum=children.reduce((sum,c)=>{const[a,b,d]=c.triangle;return sum+((b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]))/1e6;},0);expect(sum).toBeCloseTo(1,10);}
});
it('has no side effects when a component is too small for a physical section',()=>{const mesh=cylinder();mesh.faces=mesh.faces.slice(0,2);const before=structuredClone(mesh);expect(sectionDesignDomain(mesh,mesh.faces,randomUUID)).toBeUndefined();expect(mesh).toEqual(before);});
it('a posed tubular limb gets a longitudinal section in its own frame',()=>{
 const mesh=cylinder(),angle=.71,c=Math.cos(angle),s=Math.sin(angle);
 mesh.vertices=mesh.vertices.map(v=>({...v,xMm:c*v.xMm+s*v.yMm,yMm:-s*v.xMm+c*v.yMm,zMm:v.zMm}));
 const result=sectionDesignDomain(mesh,mesh.faces,randomUUID)!;expect(result).toBeDefined();expect(result.parts).toHaveLength(2);validateSurface(result.surface);
 const normal=result.plane.normal;expect(Math.abs(normal[0]*s+normal[1]*c)).toBeLessThan(.1);
 const original=new Set(mesh.vertices.map(v=>v.id));for(const v of result.surface.vertices.filter(v=>!original.has(v.id)))expect(Math.abs(normal[0]*v.xMm+normal[1]*v.yMm+normal[2]*v.zMm-result.plane.position)).toBeLessThan(1e-7);
});
