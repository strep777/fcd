import {expect,it} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
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

it.each([{lobeArea:99,pieces:1},{lobeArea:101,pieces:2}])('real final flattening keeps $lobeArea mm2 lobes in $pieces panels across the 100 mm2 neck limit',async({lobeArea,pieces})=>{
 const original=cloth(1),originalLobeArea=meshArea({...original.mesh,faces:original.lobes[0]});
 const scale=Math.sqrt(lobeArea/originalLobeArea),mesh=structuredClone(original.mesh);
 mesh.vertices=mesh.vertices.map(v=>({...v,xMm:v.xMm*scale,yMm:v.yMm*scale,zMm:v.zMm*scale}));
 const before=structuredClone(mesh),report=planarReports(mesh).reports[0];
 expect(meshArea({...mesh,faces:original.lobes[0]})).toBeCloseTo(lobeArea,12);
 expect(meshArea({...mesh,faces:original.lobes[1]})).toBeCloseTo(lobeArea,12);
 // Both examples have the same shape, a sub-2 mm physical/UV bridge, and
 // equal-sized lobes. Only the independent absolute cloth area crosses 100.
 expect(scale).toBeLessThan(2);
 const split=narrowPanelSplit(mesh,report);if(pieces===1)expect(split).toBeUndefined();else expect(split).toHaveLength(2);
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=structuredClone(mesh);
 const run=await unwrapSurface(resolve('target/release/fpcad-worker.exe'),mesh,p,{method:'arap',partitionStrategy:'design',automaticCuts:true,iterations:30,maxPieces:10});
 expect(run.pieces).toHaveLength(pieces);exactFaces(before,run.bindings.map(b=>b.report));
 expect(run.pieces.reduce((sum,p)=>sum+ringArea(p.nodes),0)).toBeCloseTo(lobeArea*2,8);
 for(const b of run.bindings){expect(b.report.areaErrorMax).toBeLessThanOrEqual(.15);expect(b.report.edgeErrorMax).toBeLessThanOrEqual(.1);expect(b.report.distortionMax).toBeLessThanOrEqual(.15);expect(b.report.seamLengthErrorMm).toBeLessThanOrEqual(.25);}
 expect(mesh).toEqual(before);
},30000);

it('preserves the captured 40.72 mm2 three-panel material detail as one native-unfolded piece with every original source face',async()=>{
 const bytes=readFileSync(new URL('../fixtures/real-small-leg-material-union.json',import.meta.url));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe('b44f3d608745037915fec48642884cf305b48133ea56867d397d35f67badbbd8');
 const fixture=JSON.parse(bytes.toString('utf8')) as {mesh:Surface;provenance:{physicalAreaMm2:number}};
 const mesh=fixture.mesh,before=structuredClone(mesh),p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface=structuredClone(mesh);
 expect(mesh.faces).toHaveLength(10);expect(mesh.vertices).toHaveLength(12);
 const world=new Map(mesh.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm]]));
 const sub=(a:number[],b:number[])=>a.map((n,i)=>n-b[i]),cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const sourceArea=mesh.faces.reduce((sum,f)=>{const [a,b,c]=f.vertices.map(id=>world.get(id)!);return sum+Math.hypot(...cross(sub(b,a),sub(c,a)))/2;},0);
 expect(sourceArea).toBeCloseTo(40.72150656269028,10);expect(sourceArea).toBeCloseTo(fixture.provenance.physicalAreaMm2,10);
 const run=await unwrapSurface(resolve('target/release/fpcad-worker.exe'),mesh,p,{method:'arap',partitionStrategy:'design',automaticCuts:true,iterations:30,maxPieces:10});
 expect(run.pieces).toHaveLength(1);expect(run.bindings).toHaveLength(1);exactFaces(before,run.bindings.map(b=>b.report));
 // Full production flattening may use its measured planar approximation;
 // physical source coverage is exact, while UV area retains a 1e-6 relative
 // measurement gate, much stricter than the normal 15% distortion ceiling.
 expect(Math.abs(ringArea(run.pieces[0].nodes)/sourceArea-1)).toBeLessThanOrEqual(1e-6);
 const binding=run.bindings[0],flat=new Map(binding.report.uv.map(v=>[v.vertexId,[v.xMm,v.yMm]]));
 const sourceFaces=new Map(before.faces.map(f=>[f.id,f]));
 let coveredArea=0;
 if(binding.trim)for(const t of binding.trim.triangles){
   const source=sourceFaces.get(t.faceId)!.vertices.map(id=>world.get(id)!);
   const points=t.barycentric.map(w=>[0,1,2].map(axis=>w.reduce((sum,n,i)=>sum+n*source[i][axis],0)));
   coveredArea+=Math.hypot(...cross(sub(points[1],points[0]),sub(points[2],points[0])))/2;
  }
 else for(const id of binding.report.faceIds){const [a,b,c]=sourceFaces.get(id)!.vertices.map(id=>world.get(id)!);coveredArea+=Math.hypot(...cross(sub(b,a),sub(c,a)))/2;}
 expect(Math.abs(coveredArea/sourceArea-1)).toBeLessThanOrEqual(1e-8);
 for(const face of before.faces){
  const q=face.vertices.map(id=>flat.get(id)!),w=face.vertices.map(id=>world.get(id)!);
  const area=((q[1][0]-q[0][0])*(q[2][1]-q[0][1])-(q[1][1]-q[0][1])*(q[2][0]-q[0][0]))/2;
  const physical=Math.hypot(...cross(sub(w[1],w[0]),sub(w[2],w[0])))/2;
  expect(area).toBeGreaterThan(0);expect(Math.abs(area/physical-1)).toBeLessThanOrEqual(1e-6);
  for(let i=0;i<3;i++)expect(Math.abs(Math.hypot(...sub(q[i],q[(i+1)%3]))/Math.hypot(...sub(w[i],w[(i+1)%3]))-1)).toBeLessThanOrEqual(1e-6);
 }
 expect(binding.report.areaErrorMax).toBeLessThanOrEqual(.15);expect(binding.report.edgeErrorMax).toBeLessThanOrEqual(.1);expect(binding.report.distortionMax).toBeLessThanOrEqual(.15);expect(binding.report.seamLengthErrorMm).toBeLessThanOrEqual(.25);
 expect(mesh).toEqual(before);
},30000);
