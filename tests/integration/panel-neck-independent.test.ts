import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import type {Surface} from '../../packages/schema/index';
import {unwrapSurface} from '../../apps/desktop/main/surface';
import {mergeDesignCharts} from '../../packages/surface/merge-design-charts';
import {planarReports} from '../../packages/surface/planar';
import {narrowPanelSplit} from '../../packages/surface/panel-neck';
import {project} from '../fixtures';

// Two independently prescribed planar cloth lobes joined along a vertical
// chord. All areas and coordinates are analytic; no production neck detector
// or partition helper is used to decide the expected output.
function cloth(bridgeMm:number,leftWidth=40):{mesh:Surface;lobes:Surface['faces'][]}{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],table=new Map<string,string>(),lobes:Surface['faces'][]=[];
 const point=(xMm:number,yMm:number)=>{const key=xMm+','+yMm;let id=table.get(key);if(!id){id=randomUUID();table.set(key,id);vertices.push({id,xMm,yMm,zMm:0});}return id;};
 const half=bridgeMm/2,leftHeight=leftWidth/2;
 const rings=[[[0,-half],[0,half],[-leftWidth/4,leftHeight],[-leftWidth,leftHeight],[-leftWidth,-leftHeight],[-leftWidth/4,-leftHeight]],[[0,-half],[10,-20],[40,-20],[40,20],[10,20],[0,half]]];
 for(const [index,ring] of rings.entries()){
  const center=point(index===0?-leftWidth/2:20,0),ids=ring.map(([x,y])=>point(x,y)),part:Surface['faces']=[];
  for(let i=0;i<ids.length;i++){const face={id:randomUUID(),vertices:[center,ids[i],ids[(i+1)%ids.length]] as [string,string,string],region:'cloth'};part.push(face);faces.push(face);}
  lobes.push(part);
 }
 return {mesh:{id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces},lobes};
}
const ringArea=(ring:{xMm:number;yMm:number}[])=>Math.abs(ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p.xMm*q.yMm-q.xMm*p.yMm;},0)/2);
const meshArea=(mesh:Surface)=>{const vs=new Map(mesh.vertices.map(p=>[p.id,p]));return mesh.faces.reduce((sum,f)=>sum+ringArea(f.vertices.map(id=>vs.get(id)!)),0);};
function exactFaces(mesh:Surface,reports:{faceIds:string[]}[]){const actual=reports.flatMap(r=>r.faceIds);expect(actual).toHaveLength(mesh.faces.length);expect(new Set(actual)).toEqual(new Set(mesh.faces.map(f=>f.id)));}

// Refine only the shared chord, prescribing the same physical cloth and
// winding independently of the production subdivision/neck implementations.
function subdivideChord(mesh:Surface,lobes:Surface['faces'][],segments:number){
 const next=structuredClone(mesh),a=next.vertices.find(p=>p.xMm===0&&p.yMm<0)!,b=next.vertices.find(p=>p.xMm===0&&p.yMm>0)!;
 const chain=[a.id,...Array.from({length:segments-1},(_,i)=>{const id=randomUUID();next.vertices.push({id,xMm:0,yMm:a.yMm+(b.yMm-a.yMm)*(i+1)/segments,zMm:0});return id;}),b.id];
 const parts=lobes.map(part=>part.flatMap(face=>{
  if(!face.vertices.includes(a.id)||!face.vertices.includes(b.id))return [structuredClone(face)];
  const center=face.vertices.find(id=>id!==a.id&&id!==b.id)!,forward=face.vertices[(face.vertices.indexOf(a.id)+1)%3]===b.id,stations=forward?chain:[...chain].reverse();
  return stations.slice(1).map((id,i)=>({...face,id:randomUUID(),vertices:[center,stations[i],id] as [string,string,string]}));
 }));
 next.faces=parts.flat();return {mesh:next,lobes:parts};
}

it.each([2,4,8])('an exact %s-edge neck refinement preserves the split and every source face',async segments=>{
 const original=cloth(1),{mesh,lobes}=subdivideChord(original.mesh,original.lobes,segments),before=structuredClone(mesh),report=planarReports(mesh).reports[0];
 expect(meshArea(mesh)).toBeCloseTo(meshArea(original.mesh),10);expect(report).toBeDefined();
 const split=narrowPanelSplit(mesh,report)!;expect(split).toHaveLength(2);exactFaces(mesh,split.map(faces=>({faceIds:faces.map(f=>f.id)})));
 expect(split.map(faces=>faces.map(f=>f.id).sort()).sort()).toEqual(lobes.map(faces=>faces.map(f=>f.id).sort()).sort());
 const reports=lobes.map(faces=>planarReports({...mesh,faces}).reports[0]);
 const merged=await mergeDesignCharts(mesh,reports,async faces=>planarReports({...mesh,faces}).reports[0]);
 expect(merged).toHaveLength(2);exactFaces(mesh,merged);expect(mesh).toEqual(before);
});

it.each([2,4,8])('a 3 mm bridge stays attached despite each of its %s edges being shorter than 2 mm',segments=>{
 const original=cloth(3),{mesh}=subdivideChord(original.mesh,original.lobes,segments),before=structuredClone(mesh),report=planarReports(mesh).reports[0];
 expect(meshArea(mesh)).toBeCloseTo(meshArea(original.mesh),10);expect(report).toBeDefined();expect(narrowPanelSplit(mesh,report)).toBeUndefined();expect(mesh).toEqual(before);
});

it('a narrow world-space chord stretched beyond 2 mm in UV remains attached after refinement',()=>{
 const original=cloth(1),{mesh}=subdivideChord(original.mesh,original.lobes,4),report=planarReports(mesh).reports[0],before=structuredClone(mesh),points=new Map(mesh.vertices.map(p=>[p.id,p]));
 const stretched={...report,uv:report.uv.map(p=>({...p,xMm:points.get(p.vertexId)!.xMm,yMm:points.get(p.vertexId)!.yMm*3}))};
 expect(narrowPanelSplit(mesh,stretched)).toBeUndefined();expect(mesh).toEqual(before);
});

it.each([{width:1,pieces:2,segments:1},{width:3,pieces:1,segments:1},{width:1,pieces:2,segments:4},{width:3,pieces:1,segments:4}])('real final flattening keeps cloth coverage and returns $pieces pieces for a $width mm connection in $segments segments',async({width,pieces,segments})=>{
 const original=cloth(width),{mesh}=segments===1?original:subdivideChord(original.mesh,original.lobes,segments),before=structuredClone(mesh),p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=structuredClone(mesh);
 const result=await unwrapSurface(resolve('target/release/fpcad-worker.exe'),mesh,p,{method:'arap',partitionStrategy:'design',automaticCuts:true,iterations:30,maxPieces:10});
 expect(result.pieces).toHaveLength(pieces);exactFaces(before,result.bindings.map(b=>b.report));
 expect(result.pieces.reduce((sum,p)=>sum+ringArea(p.nodes),0)).toBeCloseTo(meshArea(before),7);
 for(const b of result.bindings){expect(b.report.areaErrorMax).toBeLessThanOrEqual(.15);expect(b.report.edgeErrorMax).toBeLessThanOrEqual(.1);expect(b.report.seamErrorMax).toBeLessThanOrEqual(.0005);expect(b.report.seamLengthErrorMm).toBeLessThanOrEqual(.25);}
 expect(mesh.vertices).toEqual(before.vertices);expect(mesh.faces).toEqual(before.faces);
 if(width===1){const xs=result.bindings.map(b=>{const ids=new Set(b.report.faceIds),points=before.faces.filter(f=>ids.has(f.id)).flatMap(f=>f.vertices).map(id=>before.vertices.find(v=>v.id===id)!);return [Math.min(...points.map(v=>v.xMm)),Math.max(...points.map(v=>v.xMm))];});expect(xs.sort((a,b)=>a[0]-b[0])).toEqual([[-40,0],[0,40]]);}
},30000);

it.each([{width:1,pieces:2},{width:3,pieces:1}])('coalescing preserves $pieces usable panels for a $width mm connection',async({width,pieces})=>{
 const {mesh,lobes}=cloth(width),before=structuredClone(mesh),reports=lobes.map(faces=>planarReports({...mesh,faces}).reports[0]);expect(reports.every(Boolean)).toBe(true);
 const result=await mergeDesignCharts(mesh,reports,async faces=>planarReports({...mesh,faces}).reports[0]);
 expect(result).toHaveLength(pieces);exactFaces(before,result);expect(mesh).toEqual(before);
 if(width===1)expect(result.map(r=>[...r.faceIds].sort()).sort()).toEqual(reports.map(r=>[...r.faceIds].sort()).sort());
});

it('keeps a small boundary ear attached instead of manufacturing a tiny extra piece',async()=>{
 const {mesh}=cloth(1,4),before=structuredClone(mesh),p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=structuredClone(mesh);
 const run=await unwrapSurface(resolve('target/release/fpcad-worker.exe'),mesh,p,{method:'arap',partitionStrategy:'design',automaticCuts:true,iterations:30,maxPieces:10});
 expect(run.pieces).toHaveLength(1);exactFaces(before,run.bindings.map(b=>b.report));expect(ringArea(run.pieces[0].nodes)).toBeCloseTo(meshArea(before),7);expect(mesh.vertices).toEqual(before.vertices);
},30000);
