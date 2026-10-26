import {expect,it} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import type {Surface,SurfaceReport,Piece,Binding,SurfaceRun} from '../../packages/schema/index';
import {partialChartJoins} from '../../packages/surface/partial-chart-join';
import {mergeDesignCharts,type DartMerge} from '../../packages/surface/merge-design-charts';
import {nativeSurfaceResponseSchema} from '../../packages/surface/native-report';
import {request,analyze} from '../../apps/desktop/main/worker';
import {project} from '../fixtures';

const worker=resolve('target/release/fpcad-worker.exe'),key=(a:string,b:string)=>[a,b].sort().join(':'),runTag=process.env.FPCAD_DART_RUN??new Date().toISOString().replace(/\D/g,''),output=resolve('test-results/partial-chart-dart-independent',runTag);
const xyz=(v:Surface['vertices'][number])=>[v.xMm,v.yMm,v.zMm],distance=(a:number[],b:number[])=>Math.hypot(...a.map((n,i)=>n-b[i]));
function sourceNeighbors(source:Surface){
 const edges=new Map<string,string[]>();for(const f of source.faces)for(let i=0;i<3;i++){const k=key(f.vertices[i],f.vertices[(i+1)%3]),rows=edges.get(k)??[];rows.push(f.id);edges.set(k,rows);}
 const locked=new Set(source.cutConstraints?.filter(e=>e.locked).map(e=>key(e.a,e.b))??[]),allowed=new Set([...edges].filter(([k,rows])=>rows.length===2&&!locked.has(k)).map(([,rows])=>key(rows[0],rows[1])));return(a:string,b:string)=>allowed.has(key(a,b));
}
function boundary(faces:Surface['faces']){
 const edges=new Map<string,{a:string;b:string;count:number}>();for(const f of faces)for(let i=0;i<3;i++){const a=f.vertices[i],b=f.vertices[(i+1)%3],k=key(a,b),e=edges.get(k)??{a,b,count:0};e.count++;edges.set(k,e);}
 const exposed=[...edges.values()].filter(e=>e.count===1),next=new Map(exposed.map(e=>[e.a,e.b]));expect(next.size).toBe(exposed.length);const start=exposed[0].a,ring=[start];while(next.get(ring.at(-1)!)!==start){const p=next.get(ring.at(-1)!);expect(p).toBeDefined();expect(ring.includes(p!)).toBe(false);ring.push(p!);}expect(ring.length).toBe(exposed.length);return ring;
}
/** A 24-facet cone, R=75/H=100 mm, with four exact radial stations.
 * Each half develops isometrically; the complete cone has positive angle
 * deficit at its apex. It cannot be made planar by closing every seam.
 * Its analytic facet angle and lateral area are independent of the solver. */
function cone(opened=true){
 const n=24,r=75,h=100,slant=Math.hypot(r,h),angle=2*Math.asin(r/slant*Math.sin(Math.PI/n)),vertices:Surface['vertices']=[],faces:Surface['faces']=[],groups=[[] as string[],[] as string[]],meta=new Map<string,{radial:number;angular:number}>();
 const vertex=(radial:number,angular:number)=>{const theta=2*Math.PI*angular/n,id=randomUUID();vertices.push({id,xMm:radial*r*Math.cos(theta),yMm:h*(1-radial),zMm:radial*r*Math.sin(theta)});meta.set(id,{radial,angular});return id;},apex=vertex(0,0),rings=Array.from({length:4},(_,i)=>Array.from({length:n},(_,j)=>vertex((i+1)/4,j)));
 const face=(ids:string[],group:number)=>{const f={id:randomUUID(),region:group?'repair-right':'repair-left',vertices:ids as [string,string,string]};faces.push(f);groups[group].push(f.id);};
 for(let i=0;i<n;i++){const j=(i+1)%n,group=i<n/2?0:1;face([apex,rings[0][i],rings[0][j]],group);for(let k=1;k<4;k++){face([rings[k-1][i],rings[k][i],rings[k][j]],group);face([rings[k-1][i],rings[k][j],rings[k-1][j]],group);}}
 const source:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces},mesh=structuredClone(source),right=new Set(groups[1]);
 if(opened){const byId=new Map(mesh.vertices.map(v=>[v.id,v])),replacements=new Map<string,string>();for(const f of mesh.faces.filter(f=>right.has(f.id)))for(const id of f.vertices)if(!replacements.has(id)){const copy={...byId.get(id)!,id:randomUUID()};mesh.vertices.push(copy);meta.set(copy.id,meta.get(id)!);replacements.set(id,copy.id);}mesh.faces=mesh.faces.map(f=>right.has(f.id)?{...f,vertices:f.vertices.map(id=>replacements.get(id)!) as [string,string,string]}:f);}
 const input=groups.map((ids,side):SurfaceReport=>{const selected=mesh.faces.filter(f=>ids.includes(f.id)),used=new Set(selected.flatMap(f=>f.vertices)),uv=[...used].map(id=>{const m=meta.get(id)!,index=side&&m.angular===0?n:m.angular,phi=(index-side*n/2)*angle;return{vertexId:id,xMm:m.radial*slant*Math.cos(phi),yMm:m.radial*slant*Math.sin(phi)};});return{faceIds:ids,uv,boundary:boundary(selected),holes:[],areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'};});
 return{source,mesh,input,groups,slant,angle,analyticAreaMm2:n*.5*slant**2*Math.sin(angle),allowed:sourceNeighbors(source)};
}
function intactGeometry(before:Surface,faces:Surface['faces'],vertices:Surface['vertices']){
 expect(faces.map(f=>f.id).sort()).toEqual(before.faces.map(f=>f.id).sort());expect(new Set(faces.map(f=>f.id)).size).toBe(before.faces.length);
 const oldVertices=new Map(before.vertices.map(v=>[v.id,v])),now=new Map(vertices.map(v=>[v.id,v])),oldFaces=new Map(before.faces.map(f=>[f.id,f])),positions=new Set(before.vertices.map(v=>JSON.stringify(xyz(v))));
 for(const v of before.vertices)expect(now.get(v.id)).toEqual(v);for(const v of vertices)expect(positions.has(JSON.stringify(xyz(v)))).toBe(true);
 for(const face of faces){expect(new Set(face.vertices).size).toBe(3);face.vertices.forEach((id,i)=>expect(xyz(now.get(id)!)).toEqual(xyz(oldVertices.get(oldFaces.get(face.id)!.vertices[i])!)));}
}
function measured(mesh:Surface,report:SurfaceReport){
 const world=new Map(mesh.vertices.map(v=>[v.id,v])),uv=new Map(report.uv.map(v=>[v.vertexId,v])),edges=new Map<string,{a:string;b:string;count:number}>();let physicalArea=0,flatArea=0,maxArea=0,maxEdge=0,seamErrorMax=0,seamLengthErrorMm=0;
 expect(new Set(report.faceIds).size).toBe(report.faceIds.length);for(const f of mesh.faces.filter(f=>report.faceIds.includes(f.id))){const [a,b,c]=f.vertices.map(id=>world.get(id)!),p=f.vertices.map(id=>uv.get(id)!),u=xyz(b).map((v,i)=>v-xyz(a)[i]),v=xyz(c).map((v,i)=>v-xyz(a)[i]),area=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2,flat=((p[1].xMm-p[0].xMm)*(p[2].yMm-p[0].yMm)-(p[1].yMm-p[0].yMm)*(p[2].xMm-p[0].xMm))/2;physicalArea+=area;flatArea+=flat;maxArea=Math.max(maxArea,Math.abs(flat/area-1));for(let i=0;i<3;i++){const j=(i+1)%3,a=f.vertices[i],b=f.vertices[j],k=key(a,b),e=edges.get(k)??{a,b,count:0};e.count++;edges.set(k,e);const length=distance(xyz(world.get(a)!),xyz(world.get(b)!)),length2=Math.hypot(p[i].xMm-p[j].xMm,p[i].yMm-p[j].yMm);maxEdge=Math.max(maxEdge,Math.abs(length2/length-1));}}
 for(const e of edges.values())if(e.count===1){const a=world.get(e.a)!,b=world.get(e.b)!,p=uv.get(e.a)!,q=uv.get(e.b)!,length=distance(xyz(a),xyz(b)),error=Math.abs(Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm)-length);seamErrorMax=Math.max(seamErrorMax,error/length);seamLengthErrorMm+=error;}
 return{physicalArea,flatArea,maxArea,maxEdge,seamErrorMax,seamLengthErrorMm};
}
async function native(mesh:Surface,faces:Surface['faces'],vertices=mesh.vertices,seed?:SurfaceReport['uv'],errors?:string[]){
 const used=new Set(faces.flatMap(f=>f.vertices));let response;try{response=nativeSurfaceResponseSchema.parse(await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:vertices.filter(v=>used.has(v.id)),faces,method:'arap-seamed',iterations:100,repair_cuts:false,...(seed?{initial_uv:seed}:{})}}));}catch(error){errors?.push((error as Error).message);if(/^(UNWRAP_(OVERLAP|FLIPPED|NOT_CONVERGED)|PATCH_(NOT_DISK|NEEDS_CUTS)|NUMERICAL_FAILURE)$/.test((error as Error).message))return;throw error;}
 if(response.patches.length!==1)return;const patch=response.patches[0],strain=measured({...mesh,faces,vertices},patch);return{...patch,seamErrorMax:strain.seamErrorMax,seamLengthErrorMm:strain.seamLengthErrorMm};
}
const accepted=(r:SurfaceReport|undefined)=>!!r&&r.areaErrorMax<=.15&&r.edgeErrorMax<=.1&&r.distortionMax<=.15&&(r.seamErrorMax??0)<=.0005&&(r.seamLengthErrorMm??0)<=.25;
const material={materialRegion:()=> 'cloth:blue',accept:async()=>true};
function seamState(before:Surface,groups:string[][],after:Surface){
 const points=new Map(before.vertices.map(v=>[v.id,v])),right=new Set(groups[1]),edges=new Map<string,{faceId:string;right:boolean;ids:string[]}[]>();for(const f of before.faces)for(let i=0;i<3;i++){const ids=[f.vertices[i],f.vertices[(i+1)%3]],k=ids.map(id=>JSON.stringify(xyz(points.get(id)!))).sort().join('|'),rows=edges.get(k)??[];rows.push({faceId:f.id,right:right.has(f.id),ids});edges.set(k,rows);}
 const revised=new Map(after.faces.map(f=>[f.id,f]));let joined=0,retained=0;for(const rows of edges.values())if(rows.length===2&&rows[0].right!==rows[1].right){const ids=rows.map(row=>{const old=before.faces.find(f=>f.id===row.faceId)!,f=revised.get(row.faceId)!;return key(...row.ids.map(id=>f.vertices[old.vertices.indexOf(id)]) as [string,string]);});if(ids[0]===ids[1])joined++;else retained++;}return{joined,retained};
}
function piece(report:SurfaceReport):Piece{const uv=new Map(report.uv.map(v=>[v.vertexId,v])),node=(id:string)=>({id:randomUUID(),xMm:uv.get(id)!.xMm,yMm:uv.get(id)!.yMm});return{id:randomUUID(),name:'Native cone with retained dart',nodes:report.boundary.map(node),holes:(report.holes??[]).map(r=>r.map(node)),closed:true,allowanceMm:10,join:'round',cutQty:1,mirror:false,material:'Fabric',furRad:0,color:'#315579'};}
async function manufacture(report:SurfaceReport){return(await analyze(worker,{...project(),pieces:[piece(report)]}))[0];}
async function strictAudit(f:ReturnType<typeof cone>,report:SurfaceReport,tag:string){
 await mkdir(output,{recursive:true});const paper=piece(report),surfaceHash=createHash('sha256').update(JSON.stringify(f.source)).digest('hex'),binding:Binding={pieceId:paper.id,surfaceId:f.source.id,topologyVersion:1,geometryHash:'0'.repeat(64),surfaceHash,report,trim:{vertices:report.uv.map(v=>({id:v.vertexId,xMm:v.xMm,yMm:v.yMm})),boundary:report.boundary,holes:report.holes??[],triangles:f.mesh.faces.map(face=>({faceId:face.id,vertices:face.vertices,barycentric:[[1,0,0],[0,1,0],[0,0,1]]}))}},run:SurfaceRun={sourceHash:surfaceHash,algorithm:'lscm-arap-seamed-1',pieces:[paper],bindings:[binding],accepted:false},input=resolve(output,tag+'-input.json'),candidate=resolve(output,tag+'-run.json'),name='partial-dart-'+runTag+'-'+tag;
 await writeFile(input,JSON.stringify({...project(),pieces:[],surface:f.source}));await writeFile(candidate,JSON.stringify(run));await writeFile(resolve(output,tag+'-working-mesh.json'),JSON.stringify(f.mesh));const result=spawnSync(process.execPath,[resolve('tests/independent-cut-correspondence.mjs'),input,candidate,'--strict-seams','--seam-mm','.25','--seam-relative','.0005','--mapping-samples','15','--name',name],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:30000});await writeFile(resolve(output,tag+'-strict.log'),(result.stdout??'')+(result.stderr??''));expect(result.error).toBeUndefined();expect(result.status,result.stdout+'\n'+result.stderr).toBe(0);const audit=JSON.parse(await readFile(resolve('test-results/current-repair',name+'.json'),'utf8'));expect(audit.passed).toBe(true);expect(audit.seams.unmatchedSegments).toBe(0);expect(audit.uvInjectivity.overlapPairs).toBe(0);expect(audit.coverage.failedFaces).toBe(0);expect(audit.mapping.failures).toBe(0);
}

it.each([false,true])('partial proposals preserve every exact curved face and station, and join a proper portion of the seam (opened=%s)',opened=>{
 const f=cone(opened),before=structuredClone({mesh:f.mesh,input:f.input}),trials=partialChartJoins(f.mesh,f.input[0],f.input[1],f.allowed);expect(trials.length).toBeGreaterThan(0);expect(f.angle*24).toBeLessThan(2*Math.PI);
 for(const trial of trials){intactGeometry(f.mesh,trial.faces,trial.vertices);const state=seamState(f.mesh,f.groups,{...f.mesh,faces:trial.faces,vertices:trial.vertices});expect(state.joined).toBeGreaterThan(0);expect(state.retained).toBeGreaterThan(0);}expect({mesh:f.mesh,input:f.input}).toEqual(before);
});

it.each([false,true])('collinear seam subdivision preserves physical dart endpoints and joined lengths (opened=%s)',opened=>{
 function staircase(step:number){
  const vertices:Surface['vertices']=[],faces:Surface['faces']=[],ids=new Map<string,string>(),groups=[[] as string[],[] as string[]],count=300/step;
  for(let y=0;y<=count;y++)for(let x=0;x<=count;x++){const id=randomUUID();ids.set(x+','+y,id);vertices.push({id,xMm:x*step,yMm:y*step,zMm:0});}
  for(let y=0;y<count;y++)for(let x=0;x<count;x++){const left=(x+.5)*step<100||((x+.5)*step<200&&(y+.5)*step<100),side=left?0:1,a=ids.get(x+','+y)!,b=ids.get((x+1)+','+y)!,c=ids.get((x+1)+','+(y+1))!,d=ids.get(x+','+(y+1))!;
   for(const corners of [[a,b,c],[a,c,d]]){const f={id:randomUUID(),region:left?'left':'right',vertices:corners as [string,string,string]};faces.push(f);groups[side].push(f.id);}
  }
  const source:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces},mesh=structuredClone(source),right=new Set(groups[1]);
  if(opened){const copies=new Map<string,string>(),byId=new Map(mesh.vertices.map(v=>[v.id,v]));for(const f of mesh.faces.filter(f=>right.has(f.id)))for(const id of f.vertices)if(!copies.has(id)){const copy={...byId.get(id)!,id:randomUUID()};copies.set(id,copy.id);mesh.vertices.push(copy);}mesh.faces=mesh.faces.map(f=>right.has(f.id)?{...f,vertices:f.vertices.map(id=>copies.get(id)!) as [string,string,string]}:f);}
  const points=new Map(mesh.vertices.map(v=>[v.id,v])),input=groups.map((ids):SurfaceReport=>{const part=mesh.faces.filter(f=>ids.includes(f.id));return{faceIds:ids,uv:[...new Set(part.flatMap(f=>f.vertices))].map(vertexId=>({vertexId,xMm:points.get(vertexId)!.xMm,yMm:points.get(vertexId)!.yMm})),boundary:boundary(part),holes:[],areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'};});
  return{source,mesh,groups,input};
 }
 function joinedSpans(before:Surface,after:Surface,groups:string[][]){
  const points=new Map(before.vertices.map(v=>[v.id,v])),right=new Set(groups[1]),revised=new Map(after.faces.map(f=>[f.id,f])),edges=new Map<string,{face:Surface['faces'][number];ids:[string,string]}[]>(),spans=new Map<string,{lo:number;hi:number;length:number}>();
  for(const f of before.faces)f.vertices.forEach((a,i)=>{const b=f.vertices[(i+1)%3],k=[JSON.stringify(xyz(points.get(a)!)),JSON.stringify(xyz(points.get(b)!))].sort().join('|');edges.set(k,[...(edges.get(k)??[]),{face:f,ids:[a,b]}]);});
  for(const rows of edges.values())if(rows.length===2&&right.has(rows[0].face.id)!==right.has(rows[1].face.id)){
   const keys=rows.map(row=>key(...row.ids.map(id=>revised.get(row.face.id)!.vertices[row.face.vertices.indexOf(id)]) as [string,string]));if(keys[0]!==keys[1])continue;
   const [a,b]=rows[0].ids.map(id=>xyz(points.get(id)!)),axis=a.findIndex((n,i)=>n!==b[i]),line=a.filter((_,i)=>i!==axis),k=axis+':'+line.join(','),lo=Math.min(a[axis],b[axis]),hi=Math.max(a[axis],b[axis]),span=spans.get(k)??{lo,hi,length:0};span.lo=Math.min(span.lo,lo);span.hi=Math.max(span.hi,hi);span.length+=hi-lo;spans.set(k,span);
  }
  return [...spans].sort().map(([line,span])=>({line,...span}));
 }
 const signatures=[] as string[][];
 for(const step of [100,50,25]){const f=staircase(step),before=structuredClone({mesh:f.mesh,input:f.input}),trials=partialChartJoins(f.mesh,f.input[0],f.input[1],sourceNeighbors(f.source));expect(trials.length).toBeGreaterThan(0);const states=[] as string[];
  for(const trial of trials){intactGeometry(f.mesh,trial.faces,trial.vertices);const after={...f.mesh,faces:trial.faces,vertices:trial.vertices},spans=joinedSpans(f.mesh,after,f.groups),length=spans.reduce((s,r)=>s+r.length,0);expect(length).toBeGreaterThan(0);expect(length).toBeLessThan(400);for(const span of spans)expect(span.hi-span.lo).toBe(span.length);states.push(JSON.stringify(spans));}
  expect(new Set(states).size).toBe(states.length);signatures.push(states.sort());expect({mesh:f.mesh,input:f.input}).toEqual(before);
 }
 expect(signatures[1]).toEqual(signatures[0]);expect(signatures[2]).toEqual(signatures[0]);
});

it.each([false,true])('real native curved charts merge to one manufacturable sheet with a retained dart after the complete weld fails strain (opened=%s)',async opened=>{
 const f=cone(opened),before=structuredClone(f.mesh),sourceBefore=structuredClone(f.source),input=[] as SurfaceReport[];for(let i=0;i<2;i++){const r=await native(f.mesh,f.mesh.faces.filter(face=>f.groups[i].includes(face.id)),f.mesh.vertices,f.input[i].uv);expect(accepted(r)).toBe(true);input.push(r!);}const inputBefore=structuredClone(input);let fullCalls=0,dartCalls=0,manufacturingChecks=0;
 const tag=opened?'opened':'shared',trace:unknown[]=[],errors:string[]=[];await mkdir(output,{recursive:true});await writeFile(resolve(output,tag+'-original.json'),JSON.stringify({source:f.source,mesh:before,input}));const record=async(row:unknown)=>{trace.push(row);await writeFile(resolve(output,tag+'-native-trace.json'),JSON.stringify({errors,trace},null,2));};
 const result=await mergeDesignCharts(f.mesh,input,async(faces,seed)=>{fullCalls++;const report=await native(f.mesh,faces,f.mesh.vertices,seed,errors);await record({kind:'complete-weld',report});expect(accepted(report),'The complete positive-curvature cone must require a seam').toBe(false);return report;},new Set(),()=>true,true,f.allowed,2000,material,{solve:async(faces,vertices,seed)=>{dartCalls++;intactGeometry(before,faces,vertices);const report=await native(f.mesh,faces,vertices,seed,errors);await record({kind:'partial',report,faces,vertices});return report;},accept:async report=>{manufacturingChecks++;expect(f.mesh).toEqual(before);expect(input).toEqual(inputBefore);const geometry=await manufacture(report);await record({kind:'manufacturing',report,geometry});return !geometry.issues.some(i=>i.severity==='error');}});
 expect(fullCalls).toBe(1);expect(dartCalls).toBeGreaterThan(0);expect(manufacturingChecks).toBeGreaterThan(0);expect(result).toHaveLength(1);expect(result[0].faceIds.slice().sort()).toEqual(f.source.faces.map(f=>f.id).sort());intactGeometry(before,f.mesh.faces,f.mesh.vertices);const state=seamState(before,f.groups,f.mesh);expect(state.joined).toBeGreaterThan(0);expect(state.retained).toBeGreaterThan(0);const m=measured(f.mesh,result[0]);expect(m.physicalArea).toBeCloseTo(f.analyticAreaMm2,6);expect(m.maxArea).toBeLessThanOrEqual(.15);expect(m.maxEdge).toBeLessThanOrEqual(.1);expect(m.seamErrorMax).toBeLessThanOrEqual(.0005);expect(m.seamLengthErrorMm).toBeLessThanOrEqual(.25);expect((await manufacture(result[0])).issues.filter(i=>i.severity==='error')).toEqual([]);expect(input).toEqual(inputBefore);expect(f.source).toEqual(sourceBefore);await strictAudit(f,result[0],opened?'opened':'shared');
},120000);

it.each(['different material','original locked seam','coincident imported source seam','DartMerge absent'] as const)('partial merging preserves both charts when %s',async kind=>{
 const f=cone(),before=structuredClone({mesh:f.mesh,input:f.input});let fullCalls=0,dartCalls=0;
 if(kind==='original locked seam'){const sourceEdges=new Map<string,{a:string;b:string;faces:string[]}>();for(const face of f.source.faces)for(let i=0;i<3;i++){const a=face.vertices[i],b=face.vertices[(i+1)%3],k=key(a,b),e=sourceEdges.get(k)??{a,b,faces:[]};e.faces.push(face.id);sourceEdges.set(k,e);}f.source.cutConstraints=[...sourceEdges.values()].filter(e=>e.faces.length===2&&f.groups[0].includes(e.faces[0])!==f.groups[0].includes(e.faces[1])).map(e=>({a:e.a,b:e.b,locked:true}));f.mesh.cutConstraints=structuredClone(f.source.cutConstraints);before.mesh.cutConstraints=structuredClone(f.mesh.cutConstraints);}
 if(kind==='coincident imported source seam'){const right=new Set(f.groups[1]),originals=new Map(f.source.vertices.map(v=>[v.id,v])),copies=new Map<string,string>();for(const face of f.source.faces.filter(face=>right.has(face.id)))for(const id of face.vertices)if(!copies.has(id)){const copy={...originals.get(id)!,id:randomUUID()};copies.set(id,copy.id);f.source.vertices.push(copy);}f.source.faces=f.source.faces.map(face=>right.has(face.id)?{...face,vertices:face.vertices.map(id=>copies.get(id)!) as [string,string,string]}:face);}
 const dart:DartMerge={solve:async()=>{dartCalls++;return undefined;},accept:async()=>true},repair={...material,materialRegion:(region:string)=>kind==='different material'?region:'cloth:blue'};
 const result=await mergeDesignCharts(f.mesh,f.input,async()=>{fullCalls++;return undefined;},new Set(),()=>true,true,sourceNeighbors(f.source),2000,repair,kind==='DartMerge absent'?undefined:dart);expect(dartCalls).toBe(0);expect(fullCalls).toBe(kind==='DartMerge absent'?1:0);expect(result).toEqual(f.input);expect({mesh:f.mesh,input:f.input}).toEqual(before);
});

it.each(['solver refusal','manufacturing refusal','incomplete coverage','area strain refusal','solver exception','manufacturing exception'] as const)('partial %s never changes the original mesh or input charts',async kind=>{
 const f=cone(),before=structuredClone({mesh:f.mesh,input:f.input}),nativeRefusals:unknown[]=[];let dartCalls=0,acceptCalls=0;const task=mergeDesignCharts(f.mesh,f.input,async()=>undefined,new Set(),()=>true,true,f.allowed,2000,material,{solve:async(faces,vertices,seed)=>{dartCalls++;intactGeometry(before.mesh,faces,vertices);expect({mesh:f.mesh,input:f.input}).toEqual(before);if(kind==='solver exception')throw Error('independent partial solver failure');if(kind==='solver refusal')return;const r=await native(f.mesh,faces,vertices,seed);if(!r)return;if(kind==='incomplete coverage')return{...r,faceIds:r.faceIds.slice(1)};if(kind==='area strain refusal')return{...r,areaErrorMax:.150001};return r;},accept:async report=>{acceptCalls++;const g=await manufacture(report);if(kind==='manufacturing exception'){expect(g.issues.filter(i=>i.severity==='error')).toEqual([]);throw Error('independent partial manufacturing failure');}if(g.issues.some(i=>i.severity==='error')){nativeRefusals.push({report,geometry:g});await mkdir(output,{recursive:true});await writeFile(resolve(output,'manufacturing-refusal-native-rejections.json'),JSON.stringify(nativeRefusals));}return false;}});
 if(kind.endsWith('exception'))await expect(task).rejects.toThrow('independent partial');else expect(await task).toEqual(f.input);expect(dartCalls).toBeGreaterThan(0);if(kind.startsWith('manufacturing'))expect(acceptCalls).toBeGreaterThan(0);else expect(acceptCalls).toBe(0);expect({mesh:f.mesh,input:f.input}).toEqual(before);
},120000);

it('the preserved actual partial-cone self-contact remains rejected by native manufacturing',async()=>{
 const fixture=JSON.parse(await readFile('tests/fixtures/partial-cone-self-contact.json','utf8')) as {outer:[number,number][];holes:[number,number][][]};
 // The exact same physical point occurs nonadjacently, with different IDs.
 // Keep this genuine contact regression separate from the current proposal
 // search, which no longer has to generate a bad outline to prove refusal.
 expect(fixture.outer[33]).toEqual(fixture.outer[35]);
 const node=([xMm,yMm]:[number,number])=>({id:randomUUID(),xMm,yMm}),paper:Piece={id:randomUUID(),name:'Captured native partial-cone self-contact',nodes:fixture.outer.map(node),holes:fixture.holes.map(r=>r.map(node)),closed:true,allowanceMm:10,join:'round',cutQty:1,mirror:false,material:'Fabric',furRad:0,color:'#315579'},before=structuredClone(paper);
 const geometry=(await analyze(worker,{...project(),pieces:[paper]}))[0];expect(geometry.issues.filter(i=>i.severity==='error').map(i=>i.messageKey)).toContain('selfIntersection');expect(paper).toEqual(before);
});

it('a partial proposal allocator exception leaves shared-station geometry and both input reports unchanged',()=>{
 const f=cone(false),before=structuredClone({mesh:f.mesh,input:f.input});expect(()=>partialChartJoins(f.mesh,f.input[0],f.input[1],f.allowed,()=>{throw Error('independent allocation failure');})).toThrow('independent allocation failure');expect({mesh:f.mesh,input:f.input}).toEqual(before);
});

it('an indirect locked source edge cannot close through two permitted neighbors, even with partial merging enabled',async()=>{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],point=(xMm:number,yMm:number)=>{const id=randomUUID();vertices.push({id,xMm,yMm,zMm:0});return id;},inner=[[30,30],[70,30],[50,70]].map(([x,y])=>point(x,y)),outer=[[0,0],[100,0],[50,100]].map(([x,y])=>point(x,y)),center={id:randomUUID(),region:'repair-center',vertices:inner as [string,string,string]};faces.push(center);for(let i=0;i<3;i++){const j=(i+1)%3;faces.push({id:randomUUID(),region:'repair-ring',vertices:[outer[i],outer[j],inner[j]]},{id:randomUUID(),region:'repair-ring',vertices:[outer[i],inner[j],inner[i]]});}
 const source:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces,cutConstraints:[{a:inner[0],b:inner[1],locked:true}]},mesh=structuredClone(source),copies=new Map<string,string>(inner.map(id=>[id,randomUUID()]));mesh.vertices.push(...mesh.vertices.filter(v=>copies.has(v.id)).map(v=>({...v,id:copies.get(v.id)!})));mesh.faces=mesh.faces.map((f,i)=>i?{...f,vertices:f.vertices.map(id=>copies.get(id)??id) as [string,string,string]}:f);const groups=[[center.id],faces.slice(1).map(f=>f.id)],input=[] as SurfaceReport[];for(const ids of groups){const r=await native(mesh,mesh.faces.filter(f=>ids.includes(f.id)));expect(accepted(r)).toBe(true);input.push(r!);}const before=structuredClone({mesh,input}),allowed=sourceNeighbors(source);expect(allowed(center.id,faces[2].id)).toBe(false);expect(allowed(center.id,faces[4].id)).toBe(true);expect(allowed(center.id,faces[6].id)).toBe(true);let fullCalls=0,dartCalls=0;
 const result=await mergeDesignCharts(mesh,input,async()=>{fullCalls++;return undefined;},new Set(),()=>true,true,allowed,2000,material,{solve:async()=>{dartCalls++;return undefined;},accept:async()=>true});expect(fullCalls).toBe(0);expect(dartCalls).toBe(0);expect(result).toEqual(input);expect({mesh,input}).toEqual(before);
},30000);
