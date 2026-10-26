import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {surfaceSchema,projectSchema,surfaceReportSchema,type Surface,type SurfaceReport} from '../../packages/schema/index';
import {manufacturingSection} from '../../packages/surface/manufacturing-section';
import {unwrapDesignSurface,restoreDesignBindings} from '../../apps/desktop/main/design-cuts';
import {analyze,request} from '../../apps/desktop/main/worker';
import {bindingIssues,validateSurface} from '../../apps/desktop/main/surface';
import {nativeSurfaceResponseSchema} from '../../packages/surface/native-report';
import type {MaterialFace} from '../../packages/surface/design-cuts';
import {project} from '../fixtures';

const worker=resolve('target/release/fpcad-worker.exe');
type XY={xMm:number;yMm:number};
const area=(ring:XY[])=>Math.abs(ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p.xMm*q.yMm-q.xMm*p.yMm;},0)/2);
const area3=(mesh:Surface,face:Surface['faces'][number])=>{const [a,b,c]=face.vertices.map(id=>mesh.vertices.find(v=>v.id===id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm];return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;};
function curvedTinyHole(withSurvivingHole=false){
 const xs=[0,10,14,30,65,100,150,200],ys=withSurvivingHole?[0,15,19,40,60,100,120,180]:[0,15,19,40,100],targetRows=withSurvivingHole?6:3,radius=180,developed=[0];
 for(let i=1;i<xs.length;i++)developed.push(developed[i-1]+2*radius*Math.sin((xs[i]-xs[i-1])/(2*radius)));
 const vertices:Surface['vertices']=[],uv:SurfaceReport['uv']=[],grid:string[][]=[],faces:Surface['faces']=[];
 for(let j=0;j<ys.length;j++){grid[j]=[];for(let i=0;i<xs.length;i++){const id=randomUUID(),angle=xs[i]/radius;grid[j][i]=id;vertices.push({id,xMm:radius*Math.sin(angle),yMm:ys[j],zMm:radius*Math.cos(angle)});uv.push({vertexId:id,xMm:developed[i],yMm:ys[j]});}}
 for(let j=0;j<ys.length-1;j++)for(let i=0;i<xs.length-1;i++){
  if(i===1&&j===1||withSurvivingHole&&i>=4&&i<6&&j===4)continue;
  const a=grid[j][i],b=grid[j][i+1],c=grid[j+1][i+1],d=grid[j+1][i];
  for(const vertices of [[a,b,c],[a,c,d]])faces.push({id:randomUUID(),vertices:vertices as [string,string,string],region:j<targetRows?'design:#315579':'design:#bb8822'});
 }
 const mesh=surfaceSchema.parse({id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces});
 const boundary=[...grid[0],...grid.slice(1,targetRows+1).map(r=>r.at(-1)!),...grid[targetRows].slice(0,-1).reverse(),...grid.slice(1,targetRows).reverse().map(r=>r[0])];
 const holes=[[grid[1][1],grid[2][1],grid[2][2],grid[1][2]]];
 if(withSurvivingHole)holes.unshift([grid[4][4],grid[5][4],grid[5][5],grid[5][6],grid[4][6],grid[4][5]]);
 const report=surfaceReportSchema.parse({faceIds:faces.filter(f=>f.region==='design:#315579').map(f=>f.id),uv,boundary,holes,areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'});
 return{mesh,report,grid,uv,developed,holeArea:(developed[2]-developed[1])*4,width:developed.at(-1)!};
}
function verifyRefinement(mesh:Surface,result:NonNullable<ReturnType<typeof manufacturingSection>>,uv:SurfaceReport['uv']){
 validateSurface(result.surface);const after=new Map(result.surface.vertices.map(v=>[v.id,v])),flat=new Map(uv.map(p=>[p.vertexId,p]));
 for(const p of mesh.vertices)expect(after.get(p.id)).toEqual(p);
 for(const original of mesh.faces){
  const children=result.children.get(original.id);
  if(!children){expect(result.surface.faces.find(f=>f.id===original.id)).toEqual(original);continue;}
  expect(children.reduce((s,c)=>{const [a,b,d]=c.triangle;return s+((b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]))/1e6;},0),original.id).toBeCloseTo(1,9);
  expect(children.reduce((s,c)=>s+area3(result.surface,c.face),0)).toBeCloseTo(area3(mesh,original),6);
  for(const child of children){expect(child.face.region).toBe(original.region);child.face.vertices.forEach((id,i)=>{const [u,v]=child.triangle[i],w=[1-(u+v)/1000,u/1000,v/1000],parents=original.vertices.map(id=>flat.get(id)!);flat.set(id,{vertexId:id,xMm:w.reduce((s,n,k)=>s+n*parents[k].xMm,0),yMm:w.reduce((s,n,k)=>s+n*parents[k].yMm,0)});});}
 }
 const owners=new Map(result.parts.flatMap((faces,i)=>faces.map(f=>[f.id,i] as const))),edges=new Map<string,{a:string;b:string;owners:number[]}>();
 for(const f of result.parts.flat())for(let i=0;i<3;i++){const a=f.vertices[i],b=f.vertices[(i+1)%3],key=[a,b].sort().join(':'),e=edges.get(key)??{a,b,owners:[]};e.owners.push(owners.get(f.id)!);edges.set(key,e);}
 expect(owners.size).toBe(result.parts.flat().length);
 return{flat,seams:[...edges.values()].filter(e=>e.owners.length===2&&e.owners[0]!==e.owners[1])};
}
async function manufactureParts(mesh:Surface,parts:Surface['faces'][],expectedHoles=0){
 const pieces=[];let holes=0;
 for(const faces of parts){const used=new Set(faces.flatMap(f=>f.vertices));const response=nativeSurfaceResponseSchema.parse(await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:mesh.vertices.filter(v=>used.has(v.id)),faces,method:'lscm',repair_cuts:false}}));
  expect(response.patches).toHaveLength(1);const r=response.patches[0],uv=new Map(r.uv.map(p=>[p.vertexId,p])),node=(id:string)=>({id:randomUUID(),xMm:uv.get(id)!.xMm,yMm:uv.get(id)!.yMm});holes+=(r.holes??[]).length;
  pieces.push({id:randomUUID(),name:'Repaired section',nodes:r.boundary.map(node),holes:(r.holes??[]).map(r=>r.map(node)),closed:true,allowanceMm:10,join:'round' as const,cutQty:1,mirror:false,material:'Fabric',furRad:0,color:'#315579'});
 }
 expect(holes).toBe(expectedHoles);const geometry=await analyze(worker,{...project(),pieces});expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);return geometry;
}

it('targets an off-centre collapsed curved hole itself while leaving an unrelated material intact and preserving each source triangle',async()=>{
 const f=curvedTinyHole(),before=structuredClone(f),uv=new Map(f.uv.map(p=>[p.vertexId,p])),node=(id:string)=>({id:randomUUID(),xMm:uv.get(id)!.xMm,yMm:uv.get(id)!.yMm});
 const piece={id:randomUUID(),name:'Small real hole',nodes:f.report.boundary.map(node),holes:f.report.holes!.map(r=>r.map(node)),closed:true,allowanceMm:10,join:'round' as const,cutQty:1,mirror:false,material:'Fabric',furRad:0,color:'#315579'};
 const [bad]=await analyze(worker,{...project(),pieces:[piece]});expect(bad.issues.some(i=>i.severity==='error'&&i.messageKey==='holeCollapsed')).toBe(true);
 const result=manufacturingSection(f.mesh,f.report,0,randomUUID);expect(result).toBeDefined();expect(f).toEqual(before);expect(result!.parts).toHaveLength(2);
 const {flat,seams}=verifyRefinement(f.mesh,result!,f.uv);expect(seams.length).toBeGreaterThan(0);
 // The hole is at y=15..19, far from the y=50 whole-model centre. Every
 // new shared edge follows y=17 and one chain reaches each side of the hole.
 for(const e of seams)for(const id of [e.a,e.b])expect(flat.get(id)!.yMm).toBeCloseTo(17,8);
 for(const x of [f.developed[1],f.developed[2]])expect(seams.some(e=>[e.a,e.b].some(id=>Math.abs(flat.get(id)!.xMm-x)<1e-7))).toBe(true);
 const far=f.mesh.faces.filter(face=>face.region==='design:#bb8822');expect(far.every(face=>!result!.children.has(face.id))).toBe(true);expect(result!.parts.flat().some(face=>face.region==='design:#bb8822')).toBe(false);
 const geometry=await manufactureParts(result!.surface,result!.parts);expect(geometry.reduce((s,g)=>s+g.areaMm2,0)).toBeCloseTo(f.width*40-f.holeArea,4);
},30000);

it('the full design pipeline repairs the small curved hole once, preserves both materials and accounts for every original face',async()=>{
 const f=curvedTinyHole(),p=projectSchema.parse({...project(),pieces:[],surface:f.mesh,defaultAllowanceMm:10}),before=structuredClone(p);
 const provenance=new Map<string,MaterialFace>(p.surface!.faces.map(face=>[face.id,{faceId:face.id,color:face.region.slice(7),barycentric:[[1,0,0],[0,1,0],[0,0,1]]}]));
 const working={surface:structuredClone(p.surface!),provenance,topologySeams:0,materialDomains:2};
 const {run}=await unwrapDesignSurface(worker,p,working,{partitionStrategy:'design',method:'arap',automaticCuts:true,colorBoundaryCuts:true});
 const restored=restoreDesignBindings(p,working,run);expect(p).toEqual(before);expect(restored.pieces).toHaveLength(3);expect(restored.optimization?.repairPasses).toBe(1);
 expect(restored.pieces.filter(piece=>piece.color==='#bb8822')).toHaveLength(1);expect(restored.pieces.filter(piece=>piece.color==='#315579')).toHaveLength(2);
 const coverage=new Map<string,number>(),areas=new Map<string,number>();
 for(const binding of restored.bindings){const color=restored.pieces.find(piece=>piece.id===binding.pieceId)!.color;for(const triangle of binding.trim!.triangles){const [a,b,c]=triangle.barycentric,ratio=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);expect(ratio).toBeGreaterThan(0);coverage.set(triangle.faceId,(coverage.get(triangle.faceId)??0)+ratio);const source=p.surface!.faces.find(f=>f.id===triangle.faceId)!;areas.set(color,(areas.get(color)??0)+ratio*area3(p.surface!,source));}}
 for(const face of p.surface!.faces)expect(coverage.get(face.id),face.id).toBeCloseTo(1,8);
 expect(areas.get('#bb8822')).toBeCloseTo(f.width*60,5);expect(areas.get('#315579')).toBeCloseTo(f.width*40-f.holeArea,5);
 const ready={...p,pieces:restored.pieces,bindings:restored.bindings};expect(bindingIssues(ready)).toEqual([]);
 const geometry=await analyze(worker,ready);expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);expect(geometry.reduce((s,g)=>s+g.areaMm2,0)).toBeCloseTo(f.width*100-f.holeArea,3);
},60000);

it('a transverse section passes through an off-centre backtracking dart tip, preserves all face area and yields valid manufacturing outlines',async()=>{
 const points=[[0,0],[10,0],[10,10],[0,10],[2,3],[0,0]],vertices=points.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm:0})),[a,b,c,d,tip,duplicate]=vertices.map(v=>v.id);
 const mesh=surfaceSchema.parse({id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces:[[a,b,tip],[b,c,tip],[c,d,tip],[d,duplicate,tip]].map(vertices=>({id:randomUUID(),vertices,region:'design:#315579'}))});
 const uv=vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm})),report=surfaceReportSchema.parse({faceIds:mesh.faces.map(f=>f.id),uv,boundary:[a,b,c,d,duplicate,tip],areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'}),before=structuredClone(mesh);
 const raw={id:randomUUID(),name:'Closed dart obstruction',nodes:report.boundary.map(id=>{const p=uv.find(v=>v.vertexId===id)!;return{id:randomUUID(),xMm:p.xMm,yMm:p.yMm};}),closed:true,allowanceMm:10,cutQty:1,mirror:false,material:'Fabric',furRad:0,color:'#315579'};
 const [obstructed]=await analyze(worker,{...project(),pieces:[raw]});expect(obstructed.issues.some(i=>i.severity==='error')).toBe(true);
 const result=manufacturingSection(mesh,report,undefined,randomUUID);expect(result).toBeDefined();expect(mesh).toEqual(before);
 const {flat,seams}=verifyRefinement(mesh,result!,uv);expect(seams.some(e=>e.a===tip||e.b===tip)).toBe(true);
 for(const e of seams)for(const id of [e.a,e.b]){const p=flat.get(id)!;expect(2*p.xMm+3*p.yMm).toBeCloseTo(13,8);}
 const geometry=await manufactureParts(result!.surface,result!.parts);expect(geometry.reduce((s,g)=>s+g.areaMm2,0)).toBeCloseTo(100,5);
},30000);

it('a missing requested manufacturing hole produces no partial refinement or source changes',()=>{
 const f=curvedTinyHole(),before=structuredClone(f);expect(manufacturingSection(f.mesh,f.report,5,randomUUID)).toBeUndefined();expect(f).toEqual(before);
});

it('selecting a later collapsed small hole targets that opening while an earlier healthy hole and the other material remain intact',async()=>{
 const f=curvedTinyHole(true),p=projectSchema.parse({...project(),pieces:[],surface:f.mesh,defaultAllowanceMm:10}),before=structuredClone(p);
 const uv=new Map(f.uv.map(v=>[v.vertexId,v])),node=(id:string)=>{const p=uv.get(id)!;return{id:randomUUID(),xMm:p.xMm,yMm:p.yMm};};
 const isolated=f.report.holes!.map((hole,i)=>({id:randomUUID(),name:'Independent hole '+i,nodes:f.report.boundary.map(node),holes:[hole.map(node)],closed:true,allowanceMm:10,cutQty:1,mirror:false,material:'Fabric',furRad:0,color:'#315579'}));
 const checked=await analyze(worker,{...project(),pieces:isolated});expect(checked[0].issues.filter(i=>i.severity==='error')).toEqual([]);expect(checked[1].issues.some(i=>i.messageKey==='holeCollapsed')).toBe(true);
 const result=manufacturingSection(f.mesh,f.report,1,randomUUID);expect(result).toBeDefined();expect(result!.parts).toHaveLength(2);expect(p).toEqual(before);
 const {flat,seams}=verifyRefinement(f.mesh,result!,f.uv);for(const e of seams)for(const id of [e.a,e.b])expect(flat.get(id)!.yMm).toBeCloseTo(17,8);
 expect(f.mesh.faces.filter(face=>face.region==='design:#bb8822').every(face=>!result!.children.has(face.id))).toBe(true);
 const geometry=await manufactureParts(result!.surface,result!.parts,1),retained=geometry.flatMap(g=>g.seamHoles??[]);expect(retained).toHaveLength(1);expect(area(retained[0])).toBeCloseTo((f.developed[6]-f.developed[4])*40,4);
 expect(geometry.reduce((s,g)=>s+g.areaMm2,0)).toBeCloseTo(f.width*120-f.holeArea-(f.developed[6]-f.developed[4])*40,3);
},60000);
