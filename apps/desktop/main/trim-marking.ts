import {randomUUID} from 'node:crypto';
import type {Project,Marking,Piece,Binding} from '../../../packages/schema/index';
import {bindingTriangles,composeWeights,triangleWeights,type Bary,type XY} from '../../../packages/surface/triangles';
import {clip,area,positive} from './markings';
import {mappedMarking} from './fragment-mapping';
import {analyze} from './worker';
import {DomainError} from './repository';
import {distinctMarkingStations} from './marking-path-budget';
export async function editTrimmedMarking(worker:string,project:Project,old:Marking,piece:Piece,binding:Binding,raw:{xMm:number;yMm:number}[][]){
 const rings=raw.map(r=>distinctMarkingStations(r.map(p=>[p.xMm,p.yMm] as XY))),geometry=await analyze(worker,{...project,pieces:rings.map(r=>({...piece,id:randomUUID(),allowanceMm:0,nodes:r.map(([xMm,yMm])=>({xMm,yMm,id:randomUUID()})),holes:[],curves:[],notches:[],labels:[]}))});if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');
 const triangles=bindingTriangles(binding,project.surface!),clipped=await clip(worker,triangles.map(t=>({subjects:rings,clips:[positive(t.uv)]}))),expected=Math.abs(rings.reduce((s,r)=>s+area(r),0)),covered=clipped.flat().reduce((s,r)=>s+area(r),0);if(expected<1e-5||Math.abs(covered-expected)>Math.max(.01,expected*1e-5))throw new DomainError('MARKING_OUTSIDE_PATCH');
 const byFace=new Map<string,XY[][]>(),footprints=new Map<string,XY[][]>();
 triangles.forEach((t,i)=>{const prior=byFace.get(t.faceId)??[];prior.push(...clipped[i].map(r=>r.map(p=>{const w=composeWeights(triangleWeights(p,t.uv),t.barycentric);return [w[1]*1000,w[2]*1000] as XY;})));byFace.set(t.faceId,prior);footprints.set(t.faceId,[...footprints.get(t.faceId)??[],positive(t.barycentric.map(w=>[w[1]*1000,w[2]*1000]))]);});
 const faceIds=[...footprints.keys()],remaining=await clip(worker,faceIds.map(id=>({subjects:old.fragments.find(f=>f.faceId===id)?.rings.map(r=>r.map(w=>[w[1]*1000,w[2]*1000] as XY))??[],subtract:footprints.get(id)!}))),merged=await clip(worker,faceIds.map((id,i)=>({subjects:[...remaining[i],...byFace.get(id)??[]],union:true})));
 const fragments=[...old.fragments.filter(f=>!footprints.has(f.faceId)),...faceIds.flatMap((faceId,i)=>merged[i].length?[{faceId,rings:merged[i].map(r=>r.map(([x,y])=>{const w=[1-(x+y)/1000,x/1000,y/1000].map(n=>Math.max(0,Math.min(1,n))),sum=w.reduce((s,n)=>s+n,0);return w.map(n=>n/sum) as Bary;}))}]:[])];
 return mappedMarking(worker,project,{...old,fragments,source:'manual',editMode:'uv-manual',placement:old.placement?{...old.placement,reviewed:false}:undefined,inference:old.inference?{...old.inference,reviewed:false}:undefined});
}
