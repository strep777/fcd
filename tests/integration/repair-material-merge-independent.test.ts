import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import type {Surface,SurfaceReport,Piece} from '../../packages/schema/index';
import {nativeSurfaceResponseSchema} from '../../packages/surface/native-report';
import {mergeDesignCharts} from '../../packages/surface/merge-design-charts';
import {analyze,request} from '../../apps/desktop/main/worker';
import {project} from '../fixtures';

const worker=resolve('target/release/fpcad-worker.exe'),key=(a:string,b:string)=>[a,b].sort().join(':');
function materialLookup(regions:Map<string,string>){return(region:string)=>regions.get(region)??region;}
async function native(mesh:Surface,faces:Surface['faces'],seed?:SurfaceReport['uv']){
 const used=new Set(faces.flatMap(f=>f.vertices)),initial=seed??mesh.vertices.filter(v=>used.has(v.id)).map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm}));
 const response=nativeSurfaceResponseSchema.parse(await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:mesh.vertices.filter(v=>used.has(v.id)),faces,method:'lscm',initial_uv:initial,repair_cuts:false}}));
 return response.patches.length===1?response.patches[0]:undefined;
}
async function charts(mesh:Surface,groups:string[][]){const rows:SurfaceReport[]=[];for(const ids of groups){const report=await native(mesh,mesh.faces.filter(f=>ids.includes(f.id)));expect(report).toBeDefined();rows.push(report!);}return rows;}
function sourceNeighbors(source:Surface){
 const edges=new Map<string,string[]>();for(const f of source.faces)for(let i=0;i<3;i++){const edge=key(f.vertices[i],f.vertices[(i+1)%3]),list=edges.get(edge)??[];list.push(f.id);edges.set(edge,list);}
 const locked=new Set(source.cutConstraints?.filter(e=>e.locked).map(e=>key(e.a,e.b))??[]),allowed=new Set([...edges].filter(([edge,rows])=>rows.length===2&&!locked.has(edge)).map(([,rows])=>key(rows[0],rows[1])));
 return(a:string,b:string)=>allowed.has(key(a,b));
}
function duplicate(mesh:Surface,faceIds:string[],onlyIds?:Set<string>){
 const selected=new Set(faceIds),originals=new Map(mesh.vertices.map(v=>[v.id,v])),copies=new Map<string,string>();
 for(const f of mesh.faces.filter(f=>selected.has(f.id)))for(const id of f.vertices)if((!onlyIds||onlyIds.has(id))&&!copies.has(id)){const copy={...originals.get(id)!,id:randomUUID()};mesh.vertices.push(copy);copies.set(id,copy.id);}
 mesh.faces=mesh.faces.map(f=>selected.has(f.id)?{...f,vertices:f.vertices.map(id=>copies.get(id)??id) as [string,string,string]}:f);
}
function square(imported=false){
 const vertices=[[0,0],[100,0],[100,100],[0,100],...(imported?[[0,0],[100,100]]:[])].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm,zMm:0})),[a,b,c,d,e,f]=vertices.map(v=>v.id);
 const source:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces:[{id:randomUUID(),region:'repair-0-3-0',vertices:[a,b,c]},{id:randomUUID(),region:'repair-1-7-2',vertices:imported?[e,f,d]:[a,c,d]}]};
 return{source,mesh:structuredClone(source),groups:source.faces.map(f=>[f.id]),materials:new Map(source.faces.map(f=>[f.region,'cloth:blue'])),shared:[a,c]};
}
function pieceFromReport(report:SurfaceReport):Piece{
 const uv=new Map(report.uv.map(p=>[p.vertexId,p])),node=(id:string)=>({id:randomUUID(),xMm:uv.get(id)!.xMm,yMm:uv.get(id)!.yMm});
 return{id:randomUUID(),name:'Native merged material',nodes:report.boundary.map(node),holes:(report.holes??[]).map(r=>r.map(node)),closed:true,allowanceMm:10,join:'round',cutQty:1,mirror:false,material:'Fabric',furRad:0,color:'#315579'};
}
async function manufacture(report:SurfaceReport){return(await analyze(worker,{...project(),pieces:[pieceFromReport(report)]}))[0];}
function conservation(mesh:Surface,reports:SurfaceReport[],expectedArea:number){
 const covered=reports.flatMap(r=>r.faceIds);expect(covered).toHaveLength(mesh.faces.length);expect(new Set(covered)).toEqual(new Set(mesh.faces.map(f=>f.id)));let total=0;
 const world=new Map(mesh.vertices.map(p=>[p.id,p]));
 for(const r of reports){expect(r.areaErrorMax).toBeLessThanOrEqual(.15);expect(r.edgeErrorMax).toBeLessThanOrEqual(.1);expect(r.distortionMax).toBeLessThanOrEqual(.15);const uv=new Map(r.uv.map(p=>[p.vertexId,p]));
  for(const f of mesh.faces.filter(f=>r.faceIds.includes(f.id))){const [a,b,c]=f.vertices.map(id=>uv.get(id)!),flat=((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2;expect(flat).toBeGreaterThan(0);total+=flat;
   for(let i=0;i<3;i++){const j=(i+1)%3,p=world.get(f.vertices[i])!,q=world.get(f.vertices[j])!,s=uv.get(f.vertices[i])!,t=uv.get(f.vertices[j])!;expect(Math.abs(Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm,p.zMm-q.zMm)-Math.hypot(s.xMm-t.xMm,s.yMm-t.yMm))).toBeLessThanOrEqual(1e-8);}
  }
 }
 expect(total).toBeCloseTo(expectedArea,6);
}

it.each([false,true])('same original material crosses repair labels only after native geometry and manufacturing acceptance (duplicated seam=%s)',async opened=>{
 const f=square();if(opened)duplicate(f.mesh,f.groups[1]);const before=structuredClone(f.mesh),input=await charts(f.mesh,f.groups),saved=structuredClone(input);let solves=0,accepted=0;
 const result=await mergeDesignCharts(f.mesh,input,async(faces,seed)=>{solves++;return native(f.mesh,faces,seed);},new Set(),()=>true,opened,sourceNeighbors(f.source),2000,{materialRegion:materialLookup(f.materials),accept:async report=>{accepted++;expect(f.mesh).toEqual(before);const g=await manufacture(report);return g.issues.every(i=>i.severity!=='error');}});
 expect(solves).toBe(1);expect(accepted).toBe(1);expect(result).toHaveLength(1);conservation(f.mesh,result,10000);expect(f.mesh.vertices).toEqual(before.vertices);expect(input).toEqual(saved);
 expect((await manufacture(result[0])).issues.filter(i=>i.severity==='error')).toEqual([]);
},30000);

it('different original materials remain separate despite flat coincident geometry and repair-policy opt-in',async()=>{
 const f=square();f.materials.set(f.source.faces[1].region,'cloth:yellow');const input=await charts(f.mesh,f.groups),before=structuredClone({mesh:f.mesh,input});let solves=0,accepted=0;
 const result=await mergeDesignCharts(f.mesh,input,async()=>{solves++;return undefined;},new Set(),()=>true,false,sourceNeighbors(f.source),2000,{materialRegion:materialLookup(f.materials),accept:async()=>{accepted++;return true;}});
 expect(solves).toBe(0);expect(accepted).toBe(0);expect(result).toEqual(input);expect({mesh:f.mesh,input}).toEqual(before);conservation(f.mesh,result,10000);
});

it('the optional repair strategy never changes legacy region isolation when it is absent',async()=>{
 const f=square(),input=await charts(f.mesh,f.groups),before=structuredClone({mesh:f.mesh,input});let solves=0;
 const result=await mergeDesignCharts(f.mesh,input,async()=>{solves++;return undefined;});expect(solves).toBe(0);expect(result).toEqual(input);expect({mesh:f.mesh,input}).toEqual(before);
});

it('a real collapsed allowance hole rejects an otherwise exact geometric union without committing its trial weld, labels or either chart',async()=>{
 const xs=[0,48,52,100],ys=[0,48,50,52,100],vertices:Surface['vertices']=[],faces:Surface['faces']=[],groups=[[] as string[],[] as string[]],grid:string[][]=[];
 for(let j=0;j<ys.length;j++){grid[j]=[];for(let i=0;i<xs.length;i++){const id=randomUUID();grid[j][i]=id;vertices.push({id,xMm:xs[i],yMm:ys[j],zMm:0});}}
 for(let j=0;j<ys.length-1;j++)for(let i=0;i<xs.length-1;i++){if(i===1&&(j===1||j===2))continue;const side=j<2?0:1,a=grid[j][i],b=grid[j][i+1],c=grid[j+1][i+1],d=grid[j+1][i];for(const triangle of [[a,b,c],[a,c,d]]){const face={id:randomUUID(),region:'repair-'+side,vertices:triangle as [string,string,string]};faces.push(face);groups[side].push(face.id);}}
 const source:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces},mesh=structuredClone(source);duplicate(mesh,groups[1],new Set(grid[2]));const input=await charts(mesh,groups),before=structuredClone({mesh,input});
 for(const report of input)expect((await manufacture(report)).issues.filter(i=>i.severity==='error')).toEqual([]);
 let solves=0,manufacturingRejects=0;
 const result=await mergeDesignCharts(mesh,input,async(faces,seed)=>{solves++;return native(mesh,faces,seed);},new Set(),()=>true,true,sourceNeighbors(source),2000,{materialRegion:()=> 'cloth:blue',accept:async report=>{expect(report.holes).toHaveLength(1);expect({mesh,input}).toEqual(before);const g=await manufacture(report);expect(g.issues.some(i=>i.severity==='error'&&i.messageKey==='holeCollapsed')).toBe(true);manufacturingRejects++;return !g.issues.some(i=>i.severity==='error');}});
 expect(solves).toBe(1);expect(manufacturingRejects).toBe(1);expect(result).toEqual(input);expect({mesh,input}).toEqual(before);conservation(mesh,result,10000-4*4);
},30000);

it('repair material identity cannot turn a coincident imported seam into original source adjacency',async()=>{
 const f=square(true),input=await charts(f.mesh,f.groups),before=structuredClone({mesh:f.mesh,input});let solves=0,accepted=0;
 const result=await mergeDesignCharts(f.mesh,input,async()=>{solves++;return undefined;},new Set(),()=>true,true,sourceNeighbors(f.source),2000,{materialRegion:materialLookup(f.materials),accept:async()=>{accepted++;return true;}});
 expect(solves).toBe(0);expect(accepted).toBe(0);expect(result).toEqual(input);expect({mesh:f.mesh,input}).toEqual(before);
});

it('same-material repair merging protects an indirect locked edge while accepting a separate legitimate trial union',async()=>{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],vertex=(xMm:number,yMm:number)=>{const id=randomUUID();vertices.push({id,xMm,yMm,zMm:0});return id;},face=(vertices:string[],region:string)=>{const f={id:randomUUID(),vertices:vertices as [string,string,string],region};faces.push(f);return f;};
 const inner=[[30,30],[70,30],[50,70]].map(([x,y])=>vertex(x,y)),outer=[[0,0],[100,0],[50,100]].map(([x,y])=>vertex(x,y)),center=face(inner,'repair-center'),ring:Surface['faces']=[];
 for(let i=0;i<3;i++){const j=(i+1)%3;ring.push(face([outer[i],outer[j],inner[j]],'repair-ring'),face([outer[i],inner[j],inner[i]],'repair-ring'));}
 const squareIds=[[200,0],[300,0],[300,100],[200,100]].map(([x,y])=>vertex(x,y)),trial=[face([squareIds[0],squareIds[1],squareIds[2]],'repair-trial-a'),face([squareIds[0],squareIds[2],squareIds[3]],'repair-trial-b')];
 const source:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces,cutConstraints:[{a:inner[0],b:inner[1],locked:true}]},mesh=structuredClone(source),sourceBefore=structuredClone(source);duplicate(mesh,ring.map(f=>f.id));duplicate(mesh,[trial[1].id]);
 const groups=[[center.id],ring.map(f=>f.id),...trial.map(f=>[f.id])],input=await charts(mesh,groups),before=structuredClone({mesh,input}),allowed=sourceNeighbors(source),calls:string[][]=[];let accepted=0;
 expect(allowed(center.id,ring[1].id)).toBe(false);expect(allowed(center.id,ring[3].id)).toBe(true);expect(allowed(center.id,ring[5].id)).toBe(true);
 const result=await mergeDesignCharts(mesh,input,async(faces,seed)=>{calls.push(faces.map(f=>f.id));return native(mesh,faces,seed);},new Set(),()=>true,true,allowed,2000,{materialRegion:()=> 'cloth:blue',accept:async report=>{accepted++;const g=await manufacture(report);return !g.issues.some(i=>i.severity==='error');}});
 expect(result).toHaveLength(3);expect(calls).toHaveLength(1);expect(new Set(calls[0])).toEqual(new Set(trial.map(f=>f.id)));expect(accepted).toBe(1);conservation(mesh,result,15000);
 const protectedIds=new Set([center.id,...ring.map(f=>f.id)]);expect(mesh.faces.filter(f=>protectedIds.has(f.id))).toEqual(before.mesh.faces.filter(f=>protectedIds.has(f.id)));expect(mesh.cutConstraints).toEqual(before.mesh.cutConstraints);expect(mesh.vertices).toEqual(before.mesh.vertices);expect(input).toEqual(before.input);expect(source).toEqual(sourceBefore);
},30000);
