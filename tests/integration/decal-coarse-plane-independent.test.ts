import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {project} from '../fixtures';
import {surfaceMarking} from '../../apps/desktop/main/markings';
import {editSurfaceMarking} from '../../apps/desktop/main/surface-marking-edit';
import {surfaceDragShape,transformShape} from '../../packages/surface/attached-edit';
import {previewFragments} from '../../packages/surface/marking-preview';
import {decalChart} from '../../packages/surface/decal-chart';
import type {Marking,Surface} from '../../packages/schema/index';

const worker=resolve('target/release/fpcad-worker.exe');
function plane(divisions:number):Surface{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 for(let y=0;y<=divisions;y++)for(let x=0;x<=divisions;x++)vertices.push({id:randomUUID(),xMm:x*200/divisions,yMm:y*240/divisions,zMm:0});
 for(let y=0;y<divisions;y++)for(let x=0;x<divisions;x++){const a=y*(divisions+1)+x,b=a+1,c=a+divisions+1,d=c+1;for(const ids of[[a,b,d],[a,d,c]])faces.push({id:randomUUID(),vertices:ids.map(i=>vertices[i].id) as [string,string,string],region:'panel'});}
 return{id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces};
}
function anchorAt(mesh:Surface,x:number,y:number){const points=new Map(mesh.vertices.map(v=>[v.id,v]));return [...mesh.faces].sort((a,b)=>{const distance=(f:Surface['faces'][number])=>{const ps=f.vertices.map(id=>points.get(id)!);return Math.hypot(ps.reduce((s,p)=>s+p.xMm/3,0)-x,ps.reduce((s,p)=>s+p.yMm/3,0)-y);};return distance(a)-distance(b);})[0].id;}
const shape=(mesh:Surface):NonNullable<Marking['surfaceShape']>=>({wrap:true,origin:[100,120,0],axes:[[1,0,0],[0,1,0],[0,0,1]],anchorFaceId:anchorAt(mesh,100,120),nodes:[[-25,-30],[25,-30],[25,30],[-25,30]].map(([xMm,yMm])=>({xMm,yMm})),holes:[[[-7,-7],[-7,7],[7,7],[7,-7]].map(([xMm,yMm])=>({xMm,yMm}))]});
const area=(ring:number[][])=>ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2;
function measured(mesh:Surface,m:Marking){
 const vertices=new Map(mesh.vertices.map(p=>[p.id,p])),faces=new Map(mesh.faces.map(f=>[f.id,f])),rings=m.fragments.flatMap(f=>{const vs=faces.get(f.faceId)!.vertices.map(id=>vertices.get(id)!);return f.rings.map(r=>r.map(w=>[vs.reduce((s,p,i)=>s+p.xMm*w[i],0),vs.reduce((s,p,i)=>s+p.yMm*w[i],0)]));}),points=rings.flat();
 return{area:Math.abs(rings.reduce((sum,r)=>sum+area(r),0)),bounds:[Math.min(...points.map(p=>p[0])),Math.max(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[1]))]};
}
function covered(mesh:Surface,m:Marking,x:number,y:number){
 const vertices=new Map(mesh.vertices.map(p=>[p.id,p])),faces=new Map(mesh.faces.map(f=>[f.id,f]));
 return m.fragments.some(f=>{const vs=faces.get(f.faceId)!.vertices.map(id=>vertices.get(id)!);let inside=false;for(const ring of f.rings){const ps=ring.map(w=>[vs.reduce((s,p,i)=>s+p.xMm*w[i],0),vs.reduce((s,p,i)=>s+p.yMm*w[i],0)]);for(let i=0,j=ps.length-1;i<ps.length;j=i++)if((ps[i][1]>y)!==(ps[j][1]>y)&&x<(ps[j][0]-ps[i][0])*(y-ps[i][1])/(ps[j][1]-ps[i][1])+ps[i][0])inside=!inside;}return inside;});
}
it('two-triangle and dense planes preserve the complete measured decal and hole through saved resize and move',async()=>{
 const measurements:ReturnType<typeof measured>[][]=[];
 for(const divisions of[1,10]){
  const p=project();p.pieces=[];p.bindings=[];p.markings=[];p.surface=plane(divisions);const before=structuredClone(p),initial=shape(p.surface);
  let saved:Marking;try{saved=await surfaceMarking(worker,p,initial,'#cc3311','50 x 60 with 14 x 14 hole');}catch(error){writeFileSync(resolve('test-results/current-decal-coarse-repro.json'),JSON.stringify({divisions,project:p,shape:initial,chart:[...decalChart(p.surface,initial)??[]],preview:previewFragments(p.surface,initial),error:String(error)},null,2));throw new Error(`Finite planar decal rejected at divisions=${divisions}`,{cause:error});}expect(p).toEqual(before);expect(saved.surfaceShape!.holes).toHaveLength(1);p.markings=[saved];
  const resized=transformShape(saved.surfaceShape!,1.5,.75),resizedMarking=await editSurfaceMarking(worker,p,saved.id,resized);p.markings=[resizedMarking];
  const movedShape=surfaceDragShape(resizedMarking.surfaceShape!,{xMm:0,yMm:0},{xMm:120,yMm:105,zMm:0},[0,0,1],'panel',anchorAt(p.surface,120,105)),moved=await editSurfaceMarking(worker,p,saved.id,movedShape);
  const states=[saved,resizedMarking,moved],expected=[{area:2804,bounds:[75,125,90,150],cx:100,cy:120,hx:7,hy:7},{area:3154.5,bounds:[62.5,137.5,97.5,142.5],cx:100,cy:120,hx:10.5,hy:5.25},{area:3154.5,bounds:[82.5,157.5,82.5,127.5],cx:120,cy:105,hx:10.5,hy:5.25}];
  measurements.push(states.map(m=>measured(p.surface!,m)));
  for(let i=0;i<states.length;i++){const m=states[i],e=expected[i],actual=measured(p.surface,m);expect(actual.area).toBeCloseTo(e.area,3);actual.bounds.forEach((v,k)=>expect(v).toBeCloseTo(e.bounds[k],4));expect(m.surfaceShape!.holes).toHaveLength(1);
   for(const dx of[-.7,0,.7])for(const dy of[-.6,0,.6])expect(covered(p.surface,m,e.cx+dx*e.hx,e.cy+dy*e.hy),'hole interior must remain unpainted').toBe(false);
   for(const [dx,dy]of[[1.4,.23],[-1.4,.23],[.31,1.5],[.31,-1.5]])expect(covered(p.surface,m,e.cx+dx*e.hx,e.cy+dy*e.hy),'material around the hole must remain painted').toBe(true);
  }
 }
 for(let i=0;i<3;i++){expect(measurements[0][i].area).toBeCloseTo(measurements[1][i].area,3);measurements[0][i].bounds.forEach((v,k)=>expect(v).toBeCloseTo(measurements[1][i].bounds[k],4));}
},30000);
it.each([1,10])('a decal beyond the finite plane is rejected without changing state (divisions=%s)',async divisions=>{
 const p=project();p.pieces=[];p.bindings=[];p.markings=[];p.surface=plane(divisions);const before=structuredClone(p),oversized=transformShape(shape(p.surface),5,5);
 await expect(surfaceMarking(worker,p,oversized,'#cc3311','Too large')).rejects.toThrow('INCOMPLETE_SURFACE_WRAP');expect(p).toEqual(before);
},30000);
