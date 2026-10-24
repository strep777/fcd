import {expect,it} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {assembleSpecies} from '../../apps/desktop/main/species-assembly';
import {brushSurfaceMarking} from '../../apps/desktop/main/surface-marking-edit';
import {prepareDesignSurface} from '../../apps/desktop/main/design-cuts';
import {designComponents} from '../../packages/surface/design-partition';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import {unwrapSurface} from '../../apps/desktop/main/surface';
import {request} from '../../apps/desktop/main/worker';
import {randomUUID} from 'node:crypto';
import {surfaceRunSchema,type Surface,type SurfaceRun} from '../../packages/schema/index';

const worker=resolve('target/release/fpcad-worker.exe'),assets=resolve('dist/assets'),output=resolve('test-results/current-cutting');
const yellow='#e5bb32';
const area=(r:number[][])=>Math.abs(r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2);
function physicalAreas(surface:Surface){const vv=new Map(surface.vertices.map(v=>[v.id,v]));return new Map(surface.faces.map(f=>{const [a,b,c]=f.vertices.map(id=>vv.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm];return [f.id,Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2];}));}
function inspect(surface:Surface,run:SurfaceRun){
 surfaceRunSchema.parse(run);
 const faceAreas=physicalAreas(surface),covered=new Map<string,number>(),byColor:Record<string,{pieces:number;areaMm2:number;triangles:number;nodes:number;tinyEdges:number;sharpTurns:number}>={};
 for(const binding of run.bindings){const piece=run.pieces.find(p=>p.id===binding.pieceId)!,row=byColor[piece.color]??={pieces:0,areaMm2:0,triangles:0,nodes:0,tinyEdges:0,sharpTurns:0};row.pieces++;row.nodes+=piece.nodes.length;
  for(const triangle of binding.trim!.triangles){const ratio=2*area(triangle.barycentric.map(w=>[w[1],w[2]]));covered.set(triangle.faceId,(covered.get(triangle.faceId)??0)+ratio);row.areaMm2+=ratio*faceAreas.get(triangle.faceId)!;row.triangles++;}
  for(const ring of[piece.nodes,...piece.holes??[]])for(let i=0;i<ring.length;i++){const a=ring[(i+ring.length-1)%ring.length],b=ring[i],c=ring[(i+1)%ring.length],u=[b.xMm-a.xMm,b.yMm-a.yMm],v=[c.xMm-b.xMm,c.yMm-b.yMm],lu=Math.hypot(...u),lv=Math.hypot(...v);if(lu<1)row.tinyEdges++;if(lu>1&&lv>1&&Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(lu*lv))))>Math.PI/3)row.sharpTurns++;}
 }
 return {byColor,missingFaces:surface.faces.filter(f=>!covered.has(f.id)).length,maxFaceCoverageError:Math.max(...surface.faces.map(f=>Math.abs((covered.get(f.id)??0)-1))),pieceCount:run.pieces.length,designCutReport:run.designCutReport,optimization:run.optimization};
}

it('imported OBJ region labels alone do not split the unpainted material domain',async()=>{
 const p=project();p.pieces=[];p.surface=await assembleSpecies(generateSpecies(speciesDefaults('canine')));
 p.surface.source='obj';delete p.surface.template;delete p.surface.assembly;
 expect(new Set(p.surface.faces.map(f=>f.region)).size).toBeGreaterThan(1);
 const working=await prepareDesignSurface(worker,p,true,true,assets);
 expect(working.materialDomains).toBe(1);expect(designComponents(working.surface.faces)).toHaveLength(1);
 expect(working.surface.faces.map(f=>f.id).sort()).toEqual(p.surface.faces.map(f=>f.id).sort());
});

it('a half-scope curved candidate retains refined solver faces for original-model binding restoration',async()=>{
 const n=8,latitudes=6,vertices:Surface['vertices']=[{id:randomUUID(),xMm:0,yMm:100,zMm:0}],faces:Surface['faces']=[],emit=(a:number,b:number,c:number)=>faces.push({id:randomUUID(),vertices:[vertices[a].id,vertices[b].id,vertices[c].id],region:'shell'});
 for(let i=1;i<latitudes;i++)for(let j=0;j<n;j++){const x=100*Math.sin(i*Math.PI/latitudes)*Math.cos(j*2*Math.PI/n);vertices.push({id:randomUUID(),xMm:Math.abs(x)<1e-10?0:x,yMm:100*Math.cos(i*Math.PI/latitudes),zMm:100*Math.sin(i*Math.PI/latitudes)*Math.sin(j*2*Math.PI/n)});}
 const bottom=vertices.length;vertices.push({id:randomUUID(),xMm:0,yMm:-100,zMm:0});for(let j=0;j<n;j++){const next=(j+1)%n;emit(0,1+next,1+j);for(let i=0;i<latitudes-2;i++){const a=1+i*n+j,b=1+i*n+next,c=a+n,d=b+n;emit(a,b,c);emit(b,d,c);}emit(bottom,1+(latitudes-2)*n+j,1+(latitudes-2)*n+next);}
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces,cutScope:{axis:'x',positionMm:0,side:'right',closeMidline:true}};const before=JSON.stringify(p);
 mkdirSync(output,{recursive:true});let candidate:Awaited<ReturnType<typeof cutPreview>>;try{candidate=await cutPreview(worker,p.surface,p,{method:'arap',partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,iterations:30,maxPieces:500},assets);}catch(error){writeFileSync(resolve(output,'independent-half-scope.json'),JSON.stringify({faces:faces.length,error:(error as Error).message},null,2));throw error;}
 writeFileSync(resolve(output,'independent-half-scope.json'),JSON.stringify({faces:faces.length,pieces:candidate.run.pieces.length,triangles:candidate.run.bindings.reduce((sum,b)=>sum+(b.trim?.triangles.length??0),0),report:candidate.run.designCutReport},null,2));
 expect(JSON.stringify(p)).toBe(before);const positions=new Map(vertices.map(v=>[v.id,v])),selected=faces.filter(f=>f.vertices.reduce((sum,id)=>sum+positions.get(id)!.xMm,0)>1e-7),selectedIds=new Set(selected.map(f=>f.id)),metrics=inspect({...p.surface,faces:selected},candidate.run);
 expect(candidate.run.bindings.every(b=>b.trim?.triangles.every(t=>selectedIds.has(t.faceId)))).toBe(true);expect(metrics.missingFaces).toBe(0);expect(metrics.maxFaceCoverageError).toBeLessThan(1e-6);expect(candidate.run.pieces.length).toBeGreaterThan(0);
},120000);

it('a shoulder material insert does not gain seams from unrelated anatomical metadata',async()=>{
 mkdirSync(output,{recursive:true});const p=project();p.pieces=[];p.defaultAllowanceMm=10;p.surface=await assembleSpecies(generateSpecies(speciesDefaults('canine')));
 p.markings=[await brushSurfaceMarking(worker,p,undefined,{mode:'add',radiusMm:30,brushShape:'round',points:[{xMm:150,yMm:1240},{xMm:180,yMm:1255}],paint:{frame:{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},color:yellow,name:'Shoulder yellow brush'}})];
 const working=await prepareDesignSurface(worker,p,true,true,assets),selected=working.surface.faces.filter(f=>working.provenance.get(f.id)!.color===yellow),ids=new Set(selected.flatMap(f=>f.vertices)),surface={...working.surface,faces:selected,vertices:working.surface.vertices.filter(v=>ids.has(v.id))};
 const incident=new Map<string,string[]>(),faceRows=new Map(surface.faces.map(f=>[f.id,f])),positions=new Map(surface.vertices.map(v=>[v.id,v]));for(const f of surface.faces)for(const id of f.vertices)incident.set(id,[...incident.get(id)??[],f.id]);
 const rawCharts:unknown[]=[];for(const method of ['lscm','arap','arap-balanced'])try{const result=await request(worker,{protocolVersion:1,operation:'surface.unwrap',mesh:{vertices:surface.vertices,faces:surface.faces,method,iterations:100,repair_cuts:false}}) as {patches:SurfaceRun['bindings'][number]['report'][]};rawCharts.push({method,reports:result.patches.map(r=>({areaErrorMax:r.areaErrorMax,edgeErrorMax:r.edgeErrorMax,distortionMax:r.distortionMax,worstFaces:r.faceDistortion?.filter(d=>d.areaError>.15||d.edgeError>.1||d.distortion>.15).map(d=>({...d,areaMm2:physicalAreas(surface).get(d.faceId),sourceFaceId:working.provenance.get(d.faceId)!.faceId,barycentric:working.provenance.get(d.faceId)!.barycentric,vertices:faceRows.get(d.faceId)!.vertices.map(id=>({...positions.get(id)!,incidentFaces:incident.get(id)!.length,incidentSourceFaces:[...new Set(incident.get(id)!.map(faceId=>working.provenance.get(faceId)!.faceId))]}))}))}))});}catch(e){rawCharts.push({method,error:(e as Error).message});}
 const options={method:'arap' as const,partitionStrategy:'design' as const,automaticCuts:true,colorBoundaryCuts:true,iterations:30,maxPieces:500},neutral=await unwrapSurface(worker,surface,p,options),originals=new Map(p.surface.faces.map(f=>[f.id,f.region])),regions=new Map(selected.map(f=>[f.id,originals.get(working.provenance.get(f.id)!.faceId)!]));
 writeFileSync(resolve(output,'independent-yellow-isolated.json'),JSON.stringify({faces:selected.length,regions:new Set(regions.values()).size,rawCharts,neutral:{pieces:neutral.pieces.length,report:neutral.designCutReport,optimization:neutral.optimization}},null,2));
 for(const run of [neutral]){expect(run.bindings.flatMap(b=>b.report.faceIds).sort()).toEqual(selected.map(f=>f.id).sort());for(const {report} of run.bindings){expect(report.areaErrorMax).toBeLessThanOrEqual(.15);expect(report.edgeErrorMax).toBeLessThanOrEqual(.1);expect(report.distortionMax).toBeLessThanOrEqual(.15);}}
 expect(neutral.pieces.length).toBe(1);
},120000);

it('a single shoulder brush on the real default canine retains its material as a coherent manufacturing insert',async()=>{
 mkdirSync(output,{recursive:true});const p=project();p.pieces=[];p.surface=await assembleSpecies(generateSpecies(speciesDefaults('canine')));p.defaultAllowanceMm=10;
 const marking=await brushSurfaceMarking(worker,p,undefined,{mode:'add',radiusMm:30,brushShape:'round',points:[{xMm:150,yMm:1240},{xMm:180,yMm:1255}],paint:{frame:{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},color:yellow,name:'Shoulder yellow brush'}});p.markings=[marking];
 const sourceAreas=physicalAreas(p.surface),expectedYellow=marking.fragments.reduce((sum,f)=>sum+f.rings.reduce((n,r)=>n+2*area(r.map(w=>[w[1],w[2]])),0)*sourceAreas.get(f.faceId)!,0),start=Date.now(),working=await prepareDesignSurface(worker,p,true,true,assets),domains=designComponents(working.surface.faces).map(faces=>({color:working.provenance.get(faces[0].id)!.color,faces:faces.length}));
 writeFileSync(resolve(output,'independent-shoulder-before.json'),JSON.stringify({modelFaces:p.surface.faces.length,markingFragments:marking.fragments.length,editablePaintNodes:marking.surfaceShape!.nodes.length,expectedYellow,materialDomains:working.materialDomains,domains},null,2));
 const candidate=await cutPreview(worker,p.surface,p,{method:'arap',partitionStrategy:'design',automaticCuts:true,colorBoundaryCuts:true,normalAngleDeg:60,maxFacesPerPatch:400,iterations:30,optimizeCuts:true,searchPasses:3,maxPieces:500},assets),metrics=inspect(p.surface,candidate.run);
 writeFileSync(resolve(output,'independent-shoulder-result.json'),JSON.stringify({...metrics,elapsedMs:Date.now()-start,expectedYellow},null,2));
 writeFileSync(resolve(output,'independent-shoulder-source.json'),JSON.stringify(p));writeFileSync(resolve(output,'independent-shoulder-candidate.json'),JSON.stringify(candidate));
 expect(metrics.missingFaces).toBe(0);expect(metrics.maxFaceCoverageError).toBeLessThan(1e-6);expect(metrics.byColor[yellow].areaMm2).toBeCloseTo(expectedYellow,2);
 for(const {report} of candidate.run.bindings){expect(report.areaErrorMax).toBeLessThanOrEqual(.15);expect(report.edgeErrorMax).toBeLessThanOrEqual(.1);expect(report.distortionMax).toBeLessThanOrEqual(.15);}
 expect(domains.filter(d=>d.color===yellow)).toHaveLength(1);expect(metrics.byColor[yellow].pieces).toBe(1);
},600000);
