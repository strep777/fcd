import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {Surface} from '../../packages/schema/index';
import {mergeDesignCharts} from '../../packages/surface/merge-design-charts';
import {projectedReport} from '../../packages/surface/projected-report';
import {seamContinuityGuard,createSeamContinuityGuard} from '../../packages/surface/seam-continuity';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {analyze} from '../../apps/desktop/main/worker';
import {project} from '../fixtures';

type Variant={divisions?:number;flipped?:boolean;reverse?:boolean;scale?:number};
// Three cloth charts share a T: a short upper strip and two tall lower panels.
// The short strip makes the ordinary merge score prefer removing one arm of
// the T. Only joining the two lower panels retains a straight surviving seam.
function tee({divisions=1,flipped=false,reverse=false,scale=1}:Variant={}){
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],owners=new Map<string,number>(),grid:string[][]=[];
 const xs=[-120,0,120],ys=[-180,0,20],station=(v:number[],i:number)=>{const cell=Math.min(v.length-2,Math.floor(i/divisions));return (v[cell]+(v[cell+1]-v[cell])*(i-cell*divisions)/divisions)*scale;};
 for(let y=0;y<=2*divisions;y++){grid[y]=[];for(let x=0;x<=2*divisions;x++){const id=`vertex-${x}-${y}`;grid[y][x]=id;vertices.push({id,xMm:station(xs,x),yMm:station(ys,y),zMm:0});}}
 for(let y=0;y<2*divisions;y++)for(let x=0;x<2*divisions;x++){
  const a=grid[y][x],b=grid[y][x+1],c=grid[y+1][x+1],d=grid[y+1][x],owner=y>=divisions?0:x<divisions?1:2;
  for(const [i,triangle]of (flipped?[[a,b,d],[b,c,d]]:[[a,b,c],[a,c,d]]).entries()){
   const id=`face-${x}-${y}-${i}`;faces.push({id,region:'cloth',vertices:triangle as [string,string,string]});owners.set(id,owner);
  }
 }
 if(reverse){vertices.reverse();faces.reverse();}
 const mesh:Surface={id:'independent-tee',source:'obj',topologyVersion:1,vertices,faces};
 return{mesh,owners};
}
const material=(region:string)=>region;
const vertexKey=(p:number[])=>p.map(n=>Math.round(n*1e7)).join(',');
// This oracle deliberately rebuilds the physical ownership graph instead of
// importing the production guard's edge, station or angle implementation.
function survivingJunction(mesh:Surface,owners:ReadonlyMap<string,number>,joined:[number,number]){
 const points=new Map(mesh.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm]])),edges=new Map<string,{a:number[];b:number[];owners:number[]}>();
 for(const face of mesh.faces){const owner=joined.includes(owners.get(face.id)!)?100:owners.get(face.id)!;for(let i=0;i<3;i++){
  const a=points.get(face.vertices[i])!,b=points.get(face.vertices[(i+1)%3])!,key=[vertexKey(a),vertexKey(b)].sort().join('|'),edge=edges.get(key)??{a,b,owners:[]};edge.owners.push(owner);edges.set(key,edge);
 }}
 // Every tee variant retains the physical origin even when it has more stations.
 const at=[0,0,0],rays=[...edges.values()].filter(e=>e.owners.length===2&&e.owners[0]!==e.owners[1]).flatMap(e=>vertexKey(e.a)===vertexKey(at)?[e.b]:vertexKey(e.b)===vertexKey(at)?[e.a]:[]);
 const angle=rays.length===2?Math.acos(Math.max(-1,Math.min(1,rays[0].reduce((sum,n,i)=>sum+(n-at[i])*(rays[1][i]-at[i]),0)/Math.hypot(...rays[0].map((n,i)=>n-at[i]))/Math.hypot(...rays[1].map((n,i)=>n-at[i])))))*180/Math.PI:undefined;
 return {rays,angle};
}

it('independent ownership and angle measurements distinguish both accidental elbows from the straight T merge',()=>{
 const {mesh,owners}=tee(),before=structuredClone(mesh),guard=seamContinuityGuard(mesh,owners,material);
 expect(survivingJunction(mesh,owners,[0,1]).angle).toBeCloseTo(90,10);
 expect(survivingJunction(mesh,owners,[0,2]).angle).toBeCloseTo(90,10);
 expect(survivingJunction(mesh,owners,[1,2]).angle).toBeCloseTo(180,10);
 expect(guard(0,1)).toBe(false);expect(guard(1,0)).toBe(false);expect(guard(0,2)).toBe(false);expect(guard(1,2)).toBe(true);
 expect(mesh).toEqual(before);
});

it.each([{divisions:1},{divisions:2,flipped:true,reverse:true}])('reusing a physical index after a chart merge still rejects a new T-to-90-degree elbow (%j)',variant=>{
 const {mesh,owners}=tee(variant),points=new Map(mesh.vertices.map(v=>[v.id,v]));
 // Start with four quadrants: removing the upper-left/lower-left seam
 // leaves a three-way junction. The next ownership state joins the upper
 // quadrants into one strip, so that same proposal would leave a 90° elbow.
 const initial=new Map([...owners].map(([id,owner])=>{const face=mesh.faces.find(f=>f.id===id)!;return[id,owner===0&&face.vertices.reduce((sum,id)=>sum+points.get(id)!.xMm,0)>0?3:owner] as const;}));
 const signature=()=>mesh.faces.map(f=>[f.id,f.region,...f.vertices.map(id=>{const p=mesh.vertices.find(v=>v.id===id)!;return[p.xMm,p.yMm,p.zMm];})]);
 const before=signature(),indexed=createSeamContinuityGuard(mesh,material),first=indexed(initial);
 expect(survivingJunction(mesh,initial,[0,1]).rays).toHaveLength(3);expect(first(0,1)).toBe(true);expect(first(0,3)).toBe(true);
 const joined=new Map([...initial].map(([id,owner])=>[id,owner===3?0:owner] as const));
 // Trial coalescing can replace duplicate bank identities without moving
 // any face, changing its material or changing physical adjacency.
 for(const face of mesh.faces)face.vertices=face.vertices.map(id=>{const copy={...points.get(id)!,id:randomUUID()};mesh.vertices.push(copy);return copy.id;}) as [string,string,string];
 expect(signature()).toEqual(before);
 expect(survivingJunction(mesh,joined,[0,1]).angle).toBeCloseTo(90,10);
 expect(survivingJunction(mesh,joined,[1,2]).angle).toBeCloseTo(180,10);
 const after=indexed(joined);expect(after(0,1)).toBe(false);expect(after(1,0)).toBe(false);expect(after(0,2)).toBe(false);expect(after(1,2)).toBe(true);
 // A second ownership update uses different chart numbers and must keep
 // the same physical decisions rather than stale owner-pair entries.
 const relabelled=new Map([...joined].map(([id,owner])=>[id,[21,34,55][owner]] as const)),last=indexed(relabelled);
 expect(last(21,34)).toBe(false);expect(last(21,55)).toBe(false);expect(last(34,55)).toBe(true);expect(signature()).toEqual(before);
});

it.each([
 {divisions:1,flipped:false,reverse:false,scale:1},
 {divisions:1,flipped:true,reverse:false,scale:1},
 {divisions:2,flipped:false,reverse:true,scale:1},
 {divisions:3,flipped:true,reverse:true,scale:.001},
 {divisions:2,flipped:true,reverse:false,scale:1000},
])('the same physical T has the same decisions after remeshing, reordering and scaling (%j)',variant=>{
 const {mesh,owners}=tee(variant),before=structuredClone({mesh,owners}),guard=seamContinuityGuard(mesh,owners,material);
 expect(guard(0,1)).toBe(false);expect(guard(0,2)).toBe(false);expect(guard(1,2)).toBe(true);
 expect(survivingJunction(mesh,owners,[1,2]).angle).toBeCloseTo(180,8);
 expect({mesh,owners}).toEqual(before);
});

it('duplicated trial banks use their physical ownership rather than vertex identities',()=>{
 const {mesh,owners}=tee(),vertices=new Map(mesh.vertices.map(v=>[v.id,v]));
 for(const face of mesh.faces){const owner=owners.get(face.id)!;face.vertices=face.vertices.map(id=>{const copyId=id+'-bank-'+owner;if(!mesh.vertices.some(v=>v.id===copyId))mesh.vertices.push({...vertices.get(id)!,id:copyId});return copyId;}) as [string,string,string];}
 const guard=seamContinuityGuard(mesh,owners,material);
 expect(guard(0,1)).toBe(false);expect(guard(0,2)).toBe(false);expect(guard(1,2)).toBe(true);
});

it('a material corner permits an elbow without changing or erasing the material boundary',()=>{
 const {mesh,owners}=tee();for(const face of mesh.faces)if(owners.get(face.id)===2)face.region='yellow';
 const before=structuredClone(mesh),guard=seamContinuityGuard(mesh,owners,material);
 expect(survivingJunction(mesh,owners,[0,1]).angle).toBeCloseTo(90,10);
 expect(guard(0,1)).toBe(true);expect(mesh).toEqual(before);
});

it('repair labels resolve to their shared physical cloth before checking the seam corner',()=>{
 const {mesh,owners}=tee();for(const face of mesh.faces)face.region='repair-'+owners.get(face.id);
 expect(seamContinuityGuard(mesh,owners,()=> 'cloth')(0,1)).toBe(false);
});

it('an authored non-rejoinable surviving seam keeps its intentional corner',()=>{
 const {mesh,owners}=tee(),canJoin=(a:string,b:string)=>![owners.get(a),owners.get(b)].includes(2);
 // The protected seam belongs to the remaining third chart. It is not the
 // trial edge that the proposed merge removes.
 expect(seamContinuityGuard(mesh,owners,material,canJoin)(0,1)).toBe(true);
 expect(seamContinuityGuard(mesh,owners,material,()=>true)(0,1)).toBe(false);
});

it('a physical 60-degree cloth fold permits a necessary corner',()=>{
 const {mesh,owners}=tee();for(const v of mesh.vertices)if(v.yMm<0)v.zMm=-v.yMm*Math.sqrt(3);
 const guard=seamContinuityGuard(mesh,owners,material);
 expect(guard(0,1)).toBe(true);expect(guard(0,2)).toBe(true);
});

it('the measured 87.738-degree calf direction change is rejected in a minimal smooth routing fixture',()=>{
 const {mesh,owners}=tee(),at=[-100,422.29296792282867,-58.13216388006552],a=[-95.9959987141108,422.29296792282867,-57.67423329795822],b=[-100,415.125,-55.47719192504883],u=a.map((n,i)=>n-at[i]),v=b.map((n,i)=>n-at[i]),lu=Math.hypot(...u),lv=Math.hypot(...v);
 const measured=Math.acos(u.reduce((sum,n,i)=>sum+n*v[i],0)/lu/lv)*180/Math.PI;expect(measured).toBeCloseTo(87.73813834544168,8);
 // These directions come from the saved 37-piece candidate. This is a
 // minimal guard regression, not a claim that the whole calf was flattened.
 for(const p of mesh.vertices){const x=p.xMm,y=p.yMm;[p.xMm,p.yMm,p.zMm]=at.map((n,i)=>n+x*u[i]/lu-y*v[i]/lv) as [number,number,number];}
 expect(seamContinuityGuard(mesh,owners,material)(0,1)).toBe(false);
});

it.each([{divisions:1},{divisions:2,flipped:true,reverse:true}])('merge routing removes the T stem and preserves the straight seam (%j)',async variant=>{
 const {mesh,owners}=tee(variant),input=[0,1,2].map(owner=>projectedReport({...mesh,faces:mesh.faces.filter(f=>owners.get(f.id)===owner)})!),saved=structuredClone(input),sourceIds=new Set(mesh.faces.map(f=>f.id)),calls:number[][]=[];
 expect(input.every(Boolean)).toBe(true);
 // Complete-plane measurements exercise the actual merge route. Refusing
 // the full union leaves one seam for the ownership oracle to inspect.
 // No native worker or manufacturing acceptance is simulated by this test.
 const result=await mergeDesignCharts(mesh,input,async faces=>{
  const groups=[...new Set(faces.map(f=>owners.get(f.id)!))].sort();calls.push(groups);
  return groups.length===3?undefined:projectedReport({...mesh,faces});
 });
 expect(result).toHaveLength(2);expect(calls[0]).toEqual([1,2]);expect(calls).not.toContainEqual([0,1]);expect(calls).not.toContainEqual([0,2]);
 expect(result.some(r=>new Set(r.faceIds.map(id=>owners.get(id))).size===2&&r.faceIds.every(id=>owners.get(id)!==0))).toBe(true);
 const finalOwners=new Map(result.flatMap((r,i)=>r.faceIds.map(id=>[id,i] as const))),covered=result.flatMap(r=>r.faceIds);
 expect(covered.length).toBe(sourceIds.size);expect(new Set(covered)).toEqual(sourceIds);expect(input).toEqual(saved);
 const boundary=survivingJunction(mesh,finalOwners,[-1,-2]);expect(boundary.rays).toHaveLength(2);expect(boundary.angle).toBeCloseTo(180,8);
});

it('real native cut preview preserves physical automatic seams when unchanged planar limb facets flip diagonals and storage order',async()=>{
 type V=[number,number,number];type Segment={a:V;b:V};
 const ring=[[-40,-20],[-25,-40],[15,-42],[45,-18],[42,25],[12,45],[-20,41],[-45,10]],heights=[160,150,140,130,125,150,160,170],distance=(a:V,b:V)=>Math.hypot(...a.map((n,i)=>n-b[i]));
 function limb(flip:boolean):Surface{
  const vertices:Surface['vertices']=[],faces:Surface['faces']=[];
  for(const level of [0,.4,1])for(const [i,[xMm,zMm]]of ring.entries())vertices.push({id:randomUUID(),xMm,yMm:heights[i]*level,zMm});
  for(let level=0;level<2;level++)for(let i=0;i<ring.length;i++){
   const a=level*ring.length+i,b=level*ring.length+(i+1)%ring.length,c=a+ring.length,d=b+ring.length;
   for(const indices of flip?[[a,c,d],[a,d,b]]:[[a,c,b],[b,c,d]])faces.push({id:randomUUID(),region:'leg',vertices:indices.map(i=>vertices[i].id) as [string,string,string]});
  }
  if(flip){vertices.reverse();faces.reverse();}
  return{id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces};
 }
 function physicalArea(mesh:Surface){const vs=new Map(mesh.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm]]));return mesh.faces.reduce((sum,f)=>{const [a,b,c]=f.vertices.map(id=>vs.get(id)!),u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]);return sum+Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;},0);}
 function pointSegment(p:V,e:Segment){const u=e.b.map((n,i)=>n-e.a[i]),den=u.reduce((sum,n)=>sum+n*n,0),t=Math.max(0,Math.min(1,p.reduce((sum,n,i)=>sum+(n-e.a[i])*u[i],0)/den));return distance(p,e.a.map((n,i)=>n+t*u[i]) as V);}
 const worker=resolve('target/release/fpcad-worker.exe'),output=resolve('test-results/2026-10-27-placement-seams/native-flipped-limb');mkdirSync(output,{recursive:true});
 const meshes=[limb(false),limb(true)],metrics:{pieces:number;seams:Segment[];seamLengthMm:number;coveredFaces:number;manufacturingErrors:unknown[]}[]=[],report:{passed:boolean;scope:string;cases:unknown[];error?:string}={passed:false,scope:'Native full cutPreview on an imported polygonal limb; exactly unchanged planar quadrilaterals, alternate diagonals and reversed storage. This proves this fixture only.',cases:[]};
 const xyz=(m:Surface)=>m.vertices.map(v=>[v.xMm,v.yMm,v.zMm].join(',')).sort();expect(xyz(meshes[1])).toEqual(xyz(meshes[0]));expect(physicalArea(meshes[1])).toBeCloseTo(physicalArea(meshes[0]),8);
 try{
  for(const [index,mesh]of meshes.entries()){
   const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=mesh;const before=JSON.stringify(p);writeFileSync(resolve(output,`case-${index}-input.json`),before);
   const candidate=await cutPreview(worker,mesh,p,{method:'arap',partitionStrategy:'design',automaticCuts:true,iterations:30,maxPieces:20},resolve('dist/assets'));
   writeFileSync(resolve(output,`case-${index}-candidate.json`),JSON.stringify(candidate));expect(JSON.stringify(p)).toBe(before);expect(candidate.run.accepted).toBe(false);
   const vs=new Map(mesh.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm] as V])),faces=new Map(mesh.faces.map(f=>[f.id,f])),coverage=new Map<string,number>(),boundary=new Map<string,Segment[]>();
   for(const binding of candidate.run.bindings){
    expect(binding.report.areaErrorMax).toBeLessThanOrEqual(.15);expect(binding.report.edgeErrorMax).toBeLessThanOrEqual(.1);expect(binding.report.distortionMax).toBeLessThanOrEqual(.15);expect(binding.report.seamLengthErrorMm??0).toBeLessThanOrEqual(.25);
    const trim=binding.trim!;expect(trim).toBeDefined();const points=new Map<string,V>(),trimEdges=new Map<string,{a:string;b:string;count:number}>();
    for(const t of trim.triangles){const [a,b,c]=t.barycentric,ratio=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);expect(ratio).toBeGreaterThan(0);coverage.set(t.faceId,(coverage.get(t.faceId)??0)+ratio);const f=faces.get(t.faceId)!;
     for(let i=0;i<3;i++){
      points.set(t.vertices[i],[0,1,2].map(axis=>t.barycentric[i].reduce((sum,w,k)=>sum+w*vs.get(f.vertices[k])![axis],0)) as V);
      const a=t.vertices[i],b=t.vertices[(i+1)%3],key=[a,b].sort().join('|'),edge=trimEdges.get(key)??{a,b,count:0};edge.count++;trimEdges.set(key,edge);
     }
    }
    // Paper-collinear hem vertices may be simplified in trim.boundary while
    // their 3D positions follow several facets. Triangle boundary edges retain
    // the complete physical path; connecting simplified endpoints makes a
    // false chord through the limb interior.
    for(const e of trimEdges.values())if(e.count===1){const a=points.get(e.a)!,b=points.get(e.b)!;if(distance(a,b)<1e-7)continue;const key=[vertexKey(a),vertexKey(b)].sort().join('|'),rows=boundary.get(key)??[];rows.push({a,b});boundary.set(key,rows);}
   }
   for(const f of mesh.faces)expect(coverage.get(f.id),f.id+' exact source coverage').toBeCloseTo(1,8);
   const seams=[...boundary.values()].filter(rows=>rows.length===2).map(rows=>rows[0]),manufacturingErrors=(await analyze(worker,{...p,pieces:candidate.run.pieces})).flatMap(g=>g.issues.filter(i=>i.severity==='error'));
   expect(seams.length).toBeGreaterThan(0);expect(manufacturingErrors).toEqual([]);const metric={pieces:candidate.run.pieces.length,seams,seamLengthMm:seams.reduce((sum,e)=>sum+distance(e.a,e.b),0),coveredFaces:coverage.size,manufacturingErrors};metrics.push(metric);report.cases.push(metric);
  }
  const [a,b]=metrics;expect(b.pieces).toBe(a.pieces);expect(b.seamLengthMm).toBeCloseTo(a.seamLengthMm,5);
  for(const [left,right]of [[a,b],[b,a]])for(const e of left.seams)for(const p of [e.a,e.b,e.a.map((n,i)=>(n+e.b[i])/2) as V])expect(Math.min(...right.seams.map(r=>pointSegment(p,r))),'Physical sewing line must stay on the same unchanged surface locations').toBeLessThanOrEqual(1e-5);
  report.passed=true;
 }catch(error){report.error=String(error instanceof Error?error.stack:error);throw error;}finally{writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));}
},60000);
