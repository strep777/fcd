import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import type {Surface,Binding} from '../../packages/schema/index';
import {project} from '../fixtures';
import {prepareDesignSurface,unwrapDesignSurface,restoreDesignBindings} from '../../apps/desktop/main/design-cuts';
import {analyze} from '../../apps/desktop/main/worker';
import {refineSurface,type FaceCut} from '../../packages/surface/refine';
import {refineMaterialProvenance} from '../../packages/surface/design-cuts';
import {mapFromSurface,mapToSurface} from '../../packages/surface/mapping';

const worker=resolve('target/release/fpcad-worker.exe');
function strip():Surface{
 const vertices:Surface['vertices']=[];for(const yMm of [0,100])for(const xMm of [0,100,200,300])vertices.push({id:randomUUID(),xMm,yMm,zMm:0});
 const faces:Surface['faces']=[];for(let i=0;i<3;i++)for(const t of [[i,i+1,i+5],[i,i+5,i+4]])faces.push({id:randomUUID(),vertices:t.map(j=>vertices[j].id) as [string,string,string],region:'cloth'});
 return{id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces,cutConstraints:[{a:vertices[1].id,b:vertices[5].id,locked:true}]};
}
// Prescribed midpoint splits on both physical sides of the locked x=100
// line. They also work after preparation has opened the two vertex fans.
function midpointCuts(mesh:Surface,x=100):FaceCut[]{
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v]));return mesh.faces.flatMap(f=>{
  for(let i=0;i<3;i++){const j=(i+1)%3,a=vertices.get(f.vertices[i])!,b=vertices.get(f.vertices[j])!;if(a.xMm!==x||b.xMm!==x||Math.abs(a.yMm-b.yMm)!==100)continue;
   const start:[number,number,number]=[0,0,0],end:[number,number,number]=[0,0,0];start[i]=start[j]=.5;end[(i+2)%3]=1;return[{faceId:f.id,a:start,b:end,owner:randomUUID()}];
  }return[];
 });
}
function boundaryLength(mesh:Surface,reports:Binding['report'][],x:number){
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v]));let length=0;
 for(const report of reports)for(const ring of [report.boundary,...report.holes??[]])for(let i=0;i<ring.length;i++){
  const a=vertices.get(ring[i])!,b=vertices.get(ring[(i+1)%ring.length])!;if(a.xMm===x&&b.xMm===x)length+=Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm);
 }return length;
}

it.each(['original','reversed storage','project refined lock','working refined lock'] as const)('prepared production unwrap retains an original user lock but rejoins an unrelated trial (%s)',async variant=>{
 await exercise(variant,false);
});
it.each(['original','reversed storage','project refined lock','working refined lock'] as const)('any working-source lock still conservatively blocks trial rejoining (%s)',async variant=>{
 await exercise(variant,true);
});
it('a working-source locked edge retains its protection after being refined into two locked children',async()=>{
 await exercise('working refined constraint',true);
});
it('production source ancestry rejects indirect closure of a locked edge while an unrelated trial rejoins',async()=>{
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;const vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 const vertex=(xMm:number,yMm:number)=>{const id=randomUUID();vertices.push({id,xMm,yMm,zMm:0});return id;},face=(vertices:string[])=>{const f={id:randomUUID(),vertices:vertices as [string,string,string],region:'cloth'};faces.push(f);return f;};
 const inner=[[30,30],[70,30],[50,70]].map(([x,y])=>vertex(x,y)),outer=[[0,0],[100,0],[50,100]].map(([x,y])=>vertex(x,y)),center=face(inner),annulus:Surface['faces']=[];
 for(let i=0;i<3;i++){const j=(i+1)%3;annulus.push(face([outer[i],outer[j],inner[j]]),face([outer[i],inner[j],inner[i]]));}
 const square=[[200,0],[300,0],[300,100],[200,100]].map(([x,y])=>vertex(x,y)),trial=[face([square[0],square[1],square[2]]),face([square[0],square[2],square[3]])];
 p.surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces,cutConstraints:[{a:inner[0],b:inner[1],locked:true}]};const before=structuredClone(p),working=await prepareDesignSurface(worker,p,true,true);
 for(const parents of [new Set(annulus.map(f=>f.id)),new Set([trial[1].id])]){
  const positions=new Map(working.surface.vertices.map(v=>[v.id,v])),copies=new Map<string,string>(),ids=new Set(working.surface.faces.filter(f=>parents.has(working.provenance.get(f.id)!.faceId)).map(f=>f.id));
  for(const f of working.surface.faces)if(ids.has(f.id))for(const id of f.vertices)if(!copies.has(id)){const copy={...positions.get(id)!,id:randomUUID()};working.surface.vertices.push(copy);copies.set(id,copy.id);}
  working.surface.faces=working.surface.faces.map(f=>ids.has(f.id)?{...f,vertices:f.vertices.map(id=>copies.get(id)!) as [string,string,string]}:f);
 }
 const workingBefore=structuredClone(working.surface),flattened=await unwrapDesignSurface(worker,p,working,{partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,method:'arap'});
 mkdirSync('test-results/2026-10-25-pattern-quality',{recursive:true});writeFileSync('test-results/2026-10-25-pattern-quality/project-locked-production-indirect-fixture.json',JSON.stringify({source:before.surface,workingBefore,workingAfter:working.surface,provenance:[...working.provenance],run:flattened.run,centerFaceId:center.id,annulusFaceIds:annulus.map(f=>f.id),trialFaceIds:trial.map(f=>f.id)},null,2));
 expect(flattened.run.pieces).toHaveLength(3);
 const witnesses=(mesh:Surface)=>{const points=new Map(mesh.vertices.map(v=>[v.id,v]));return mesh.faces.flatMap(f=>f.vertices.flatMap((a,i)=>{const b=f.vertices[(i+1)%3],p=points.get(a)!,q=points.get(b)!;return p.yMm===30&&q.yMm===30&&[p.xMm,q.xMm].sort((a,b)=>a-b).join(',')==='30,70'?[{faceId:f.id,ids:[a,b].sort()}]:[];}));};
 const lockedBefore=witnesses(workingBefore),lockedAfter=witnesses(working.surface);expect(lockedBefore).toHaveLength(2);expect(lockedAfter).toEqual(lockedBefore);expect(new Set(lockedAfter.map(e=>e.ids.join(':'))).size).toBe(2);
 // The solver may merge safe portions of the annulus with the centre. What
 // must remain is the complete two-sided user seam, with no incidental weld.
 for(const edge of lockedAfter){const report=flattened.run.bindings.find(b=>b.report.faceIds.includes(edge.faceId))!.report;expect([report.boundary,...report.holes??[]].some(r=>r.some((a,i)=>[a,r[(i+1)%r.length]].sort().join(':')===edge.ids.join(':')))).toBe(true);}
 const run=restoreDesignBindings(p,working,flattened.run),coverage=new Map<string,number>();expect(run.bindings.some(b=>trial.every(f=>b.report.faceIds.includes(f.id)))).toBe(true);
 for(const binding of run.bindings)for(const t of binding.trim!.triangles){const[a,b,c]=t.barycentric,ratio=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);expect(ratio).toBeGreaterThan(0);coverage.set(t.faceId,(coverage.get(t.faceId)??0)+ratio);const weights=[0,1,2].map(i=>(a[i]+b[i]+c[i])/3) as [number,number,number],flat=mapFromSurface(binding,t.faceId,weights,p.surface);expect(flat).not.toBeNull();const hit=mapToSurface(p.surface,binding,flat!);expect(hit?.faceId).toBe(t.faceId);hit!.barycentric.forEach((w,i)=>expect(w).toBeCloseTo(weights[i],10));}
 for(const f of p.surface.faces)expect(coverage.get(f.id)).toBeCloseTo(1,12);expect(run.cutEdges).toEqual([[inner[0],inner[1]]]);
 const geometry=await analyze(worker,{...p,pieces:run.pieces});expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);expect(geometry.reduce((sum,g)=>sum+g.areaMm2,0)).toBeCloseTo(15000,7);expect(p).toEqual(before);
});

async function exercise(variant:'original'|'reversed storage'|'project refined lock'|'working refined lock'|'working refined constraint',workingLocked:boolean){
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=strip();
 if(variant==='project refined lock'){p.surface=refineSurface(p.surface,midpointCuts(p.surface)).surface;expect(p.surface.cutConstraints).toHaveLength(2);expect(p.surface.cutConstraints!.every(e=>e.locked)).toBe(true);}
 if(variant==='reversed storage'){p.surface.faces.reverse();p.surface.vertices.reverse();}
 const original=structuredClone(p),working=await prepareDesignSurface(worker,p,true,true);expect(working.surface.cutConstraints?.some(e=>e.locked)??false).toBe(false);
 if(variant==='working refined lock'){
  const refined=refineSurface(working.surface,midpointCuts(working.surface)),provenance=refineMaterialProvenance(working.provenance,refined.children);expect(provenance).toBeDefined();expect(refined.children.size).toBeGreaterThan(0);working.surface=refined.surface;working.provenance=provenance!;
 }
 // Introduce only a temporary seam at x=200. Source triangle identities and
 // barycentric ancestry stay original, unlike an independently imported seam.
 const sourceVertices=new Map(p.surface.vertices.map(v=>[v.id,v])),rightSourceFaces=new Set(p.surface.faces.filter(f=>f.vertices.every(id=>sourceVertices.get(id)!.xMm>=200)).map(f=>f.id)),rightWorkingFaces=new Set(working.surface.faces.filter(f=>rightSourceFaces.has(working.provenance.get(f.id)!.faceId)).map(f=>f.id));
 const vertices=new Map(working.surface.vertices.map(v=>[v.id,v])),copies=new Map<string,string>();for(const f of working.surface.faces)if(rightWorkingFaces.has(f.id))for(const id of f.vertices)if(!copies.has(id)){const copy={...vertices.get(id)!,id:randomUUID()};working.surface.vertices.push(copy);copies.set(id,copy.id);}
 working.surface.faces=working.surface.faces.map(f=>rightWorkingFaces.has(f.id)?{...f,vertices:f.vertices.map(id=>copies.get(id)!) as [string,string,string]}:f);
 if(workingLocked){const byId=new Map(working.surface.vertices.map(v=>[v.id,v])),outer=working.surface.faces.flatMap(f=>f.vertices.map((a,i)=>({a,b:f.vertices[(i+1)%3]}))).find(e=>byId.get(e.a)!.xMm===0&&byId.get(e.b)!.xMm===0)!;working.surface.cutConstraints=[{...outer,locked:true}];}
 if(variant==='working refined constraint'){
  const refined=refineSurface(working.surface,midpointCuts(working.surface,0)),provenance=refineMaterialProvenance(working.provenance,refined.children);expect(provenance).toBeDefined();expect(refined.surface.cutConstraints).toHaveLength(2);expect(refined.surface.cutConstraints!.every(e=>e.locked)).toBe(true);working.surface=refined.surface;working.provenance=provenance!;
 }
 const workingConstraints=structuredClone(working.surface.cutConstraints),flattened=await unwrapDesignSurface(worker,p,working,{partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,method:'arap'});
 expect(flattened.run.pieces,'The source lock must remain while only the unrelated trial can disappear').toHaveLength(workingLocked?3:2);
 expect(boundaryLength(working.surface,flattened.run.bindings.map(b=>b.report),100)).toBeCloseTo(200,8);
 expect(boundaryLength(working.surface,flattened.run.bindings.map(b=>b.report),200)).toBeCloseTo(workingLocked?200:0,8);
 expect(working.surface.cutConstraints).toEqual(workingConstraints);
 const run=restoreDesignBindings(p,working,flattened.run),coverage=new Map<string,number>();expect(run.accepted).toBe(false);
 expect(run.cutEdges).toEqual(p.surface.cutConstraints!.filter(e=>e.locked).map(e=>[e.a,e.b]));
 for(const binding of run.bindings){
  for(const t of binding.trim!.triangles){const[a,b,c]=t.barycentric,ratio=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);expect(ratio).toBeGreaterThan(0);coverage.set(t.faceId,(coverage.get(t.faceId)??0)+ratio);}
  for(const faceId of binding.report.faceIds){const w:[number,number,number]=[.2,.3,.5],flat=mapFromSurface(binding,faceId,w,p.surface);expect(flat).not.toBeNull();const hit=mapToSurface(p.surface,binding,flat!);expect(hit?.faceId).toBe(faceId);hit!.barycentric.forEach((n,i)=>expect(n).toBeCloseTo(w[i],10));}
 }
 for(const f of p.surface.faces)expect(coverage.get(f.id)).toBeCloseTo(1,12);
 const geometry=await analyze(worker,{...p,pieces:run.pieces});expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);expect(geometry.reduce((sum,g)=>sum+g.areaMm2,0)).toBeCloseTo(30000,7);expect(p).toEqual(original);
}
