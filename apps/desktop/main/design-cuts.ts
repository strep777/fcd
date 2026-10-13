import {insertTrimBoundary} from './trim-boundary';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type Module from 'manifold-3d';
import {triangulateMaterialTiles,type MaterialTile} from '../../../packages/surface/material-tiles';
import {randomUUID} from 'node:crypto';
import type {Project,SurfaceRun,Binding,UnwrapOptions} from '../../../packages/schema/index';
import {materialCutMesh,openMaterialMesh,type MaterialFace} from '../../../packages/surface/design-cuts';
import {clip} from './markings';
import {hash,DomainError} from './repository';
import {pieceGeometryHash,cutColorHash,unwrapSurface} from './surface';
const faceGridOrigin:[number,number]=[0,0];
/** Resolve visible layer order on each original triangle before introducing
 * any sewing geometry. Hidden edges and same-colour overlaps are not seams. */
type DesignRow={marking:NonNullable<Project['markings']>[number];rings:[number,number][][]};
const triangle:[number,number][][]=[[[0,0],[1000,0],[0,1000]]];
const ringArea=(r:[number,number][])=>r.reduce((sum,a,i)=>{const b=r[(i+1)%r.length],o=r[0];return sum+(a[0]-o[0])*(b[1]-o[1])-(b[0]-o[0])*(a[1]-o[1]);},0)/2;
const area=(rings:[number,number][][])=>rings.reduce((sum,r)=>sum+ringArea(r),0);
const bary=(rings:[number,number][][])=>rings.map(r=>r.map(([u,v])=>{const raw=[1-(u+v)/1000,u/1000,v/1000];if(raw.some(w=>w< -1e-7||w>1+1e-7))throw new DomainError('COLOR_CUT_BOUNDARY');const clamped=raw.map(w=>Math.max(0,Math.min(1,w))),sum=clamped.reduce((s,w)=>s+w,0);return clamped.map(w=>w/sum) as [number,number,number];}));
/** The renderer's parity stencil treats each fragment as even-odd. Normalize
 * fragments independently before NonZero layer booleans; parity across multiple
 * fragments would incorrectly XOR overlapping painted layers. */
async function resolveDesignTiles(worker:string,project:Project,includeBase=true){
 const layers=new Map<string,DesignRow[]>();
 for(const marking of project.markings??[])for(const fragment of marking.fragments){const rows=layers.get(fragment.faceId)??[];rows.push({marking,rings:fragment.rings.map(r=>r.map(w=>[w[1]*1000,w[2]*1000]))});layers.set(fragment.faceId,rows);}
 const vertices=new Map(project.surface!.vertices.map(v=>[v.id,v])),tiles=new Map<string,MaterialTile[]>();let pending=project.surface!.faces;
 // Retry only inconsistent faces, keeping one shared lattice for every Boolean
 // on that face. Grid displacement stays below the physical 1e-6 mm budget.
 for(const digits of [9,12,8,7,6]){
  const eligible=pending.filter(f=>{const v=f.vertices.map(id=>vertices.get(id)!);let edge=0;for(let i=0;i<3;i++)edge=Math.max(edge,Math.hypot(v[i].xMm-v[(i+1)%3].xMm,v[i].yMm-v[(i+1)%3].yMm,v[i].zMm-v[(i+1)%3].zMm));return edge*Math.SQRT2*10**(-digits)/1000<=1e-6;}),rows=eligible.flatMap(f=>(layers.get(f.id)??[]).map(row=>({faceId:f.id,...row}))),canonical=await clip(worker,rows.map(row=>({origin:faceGridOrigin,subjects:row.rings,clips:triangle})),digits),normalized=new Map<string,DesignRow[]>();
  rows.forEach((row,i)=>{const list=normalized.get(row.faceId)??[];list.push({...row,rings:canonical[i]});normalized.set(row.faceId,list);});
  const jobs=eligible.flatMap(f=>(normalized.get(f.id)??[]).map((row,i,all)=>({faceId:f.id,...row,job:{origin:faceGridOrigin,subjects:row.rings,subtract:all.slice(i+1).flatMap(r=>r.rings)}}))),visible=await clip(worker,jobs.map(r=>r.job),digits),domains=new Map<string,{faceId:string;color:string;rings:[number,number][][]}>();
  jobs.forEach((row,i)=>{const key=row.faceId+':'+row.marking.color,entry=domains.get(key)??{faceId:row.faceId,color:row.marking.color,rings:[]};entry.rings.push(...visible[i]);domains.set(key,entry);});
  const entries=[...domains.values()],unions=await clip(worker,entries.map(d=>({origin:faceGridOrigin,subjects:d.rings,union:true})),digits),byFace=new Map<string,{color:string;rings:[number,number][][];expected:number}[]>();
  entries.forEach((d,i)=>{const list=byFace.get(d.faceId)??[];list.push({color:d.color,rings:unions[i],expected:area(d.rings)});byFace.set(d.faceId,list);});
  const occupied=await clip(worker,eligible.map(f=>({origin:faceGridOrigin,subjects:(byFace.get(f.id)??[]).flatMap(t=>t.rings),union:true})),digits),bases=await clip(worker,eligible.map((f,i)=>({origin:faceGridOrigin,subjects:triangle,subtract:occupied[i]})),digits),solved=new Set<string>();
  eligible.forEach((f,i)=>{const [a,b,c]=f.vertices.map(id=>vertices.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm],physicalArea=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2,tolerance=Math.max(1e-6,physicalArea*1e-8)*500000/physicalArea,list=byFace.get(f.id)??[],coloredArea=list.reduce((sum,t)=>sum+area(t.rings),0);
   // The independent sum of mutually exclusive colors detects a corrupt union;
   // union + its own complement alone is a tautological coverage check.
   if(list.some(t=>Math.abs(area(t.rings)-t.expected)>tolerance)||Math.abs(area(occupied[i])-coloredArea)>tolerance||Math.abs(coloredArea+area(bases[i])-500000)>tolerance)return;
   tiles.set(f.id,[...list.filter(t=>t.rings.length).map(t=>({faceId:f.id,color:t.color,rings:bary(t.rings)})),...(includeBase&&bases[i].length?[{faceId:f.id,color:'#eceae5',rings:bary(bases[i])}]:[])]);solved.add(f.id);
  });
  pending=pending.filter(f=>!solved.has(f.id));if(!pending.length)return [...tiles.values()].flat();
 }
 throw new DomainError('COLOR_CUT_BOUNDARY');
}
export async function visibleDesignMarkings(worker:string,project:Project){
 const tiles=await resolveDesignTiles(worker,project,false),result=new Map<string,NonNullable<Project['markings']>[number]>();for(const t of tiles){const source=project.markings!.find(m=>m.color===t.color)!,marking=result.get(t.color)??{...source,id:randomUUID(),fragments:[],paths:[]};marking.fragments.push({faceId:t.faceId,rings:t.rings});result.set(t.color,marking);}return [...result.values()];
}
let designTriangulator:Promise<Awaited<ReturnType<typeof Module>>>|undefined;
export async function prepareDesignSurface(worker:string,project:Project,colorBoundaries:boolean,allowTopologyCuts=true,directory=resolve('dist/assets')){
 if(!colorBoundaries||!project.markings?.length)return materialCutMesh(project.surface!,[],randomUUID,allowTopologyCuts);
 const tiles=await resolveDesignTiles(worker,project);
 const wasm=await (designTriangulator??=(async()=>{const load=(await import(pathToFileURL(resolve(directory,'manifold.mjs')).href)).default as typeof Module,wasm=await load({locateFile:()=>resolve(directory,'manifold.wasm')});wasm.setup();return wasm;})()),partition=triangulateMaterialTiles(project.surface!,tiles,rings=>wasm.triangulate(rings,1e-9,false),randomUUID);return {...openMaterialMesh(partition.surface,partition.provenance,randomUUID,allowTopologyCuts),canonicalization:partition.canonicalization};
}

export async function unwrapDesignSurface(worker:string,project:Project,working:Awaited<ReturnType<typeof prepareDesignSurface>>,options:UnwrapOptions){
 const originals=new Map(project.surface!.faces.map(f=>[f.id,f.region])),regions=new Map([...working.provenance].map(([id,m])=>[id,originals.get(m.faceId)!]));
 let run=await unwrapSurface(worker,working.surface,project,{...options,optimizeCuts:false},undefined,regions),distortionSeams=0,manufacturingSeams=run.designCutReport?.manufacturingSeams??0;
 run.designCutReport={materialDomains:working.materialDomains,userSeams:project.surface!.cutLines?.filter(l=>l.enabled).length??0,topologySeams:working.topologySeams+(run.designCutReport?.topologySeams??0),distortionSeams:distortionSeams+(run.designCutReport?.distortionSeams??0),manufacturingSeams};return {run,distortionSeams};
}
/** Refined solver faces are temporary. Store an exact barycentric material mesh
 * against the original model so editing/undo/reprojection keep valid bindings. */
export function restoreDesignBindings(project:Project,working:Awaited<ReturnType<typeof prepareDesignSurface>>,run:SurfaceRun){
 const source=project.surface!,faces=new Map(working.surface.faces.map(f=>[f.id,f])),originals=new Map(source.faces.map(f=>[f.id,f])),surfaceHash=hash(JSON.stringify(source)),vertices=new Map(source.vertices.map(v=>[v.id,v])),sourceAreas=new Map(source.faces.map(f=>{const [a,b,c]=f.vertices.map(id=>vertices.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm];return [f.id,Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2];}));
 for(const binding of run.bindings){const uv=new Map(binding.report.uv.map(v=>[v.vertexId,v])),used=new Set<string>(),triangles:NonNullable<Binding['trim']>['triangles']=[],originalFaces=new Set<string>(),metadata:MaterialFace[]=[];
  for(const id of binding.report.faceIds){const face=faces.get(id),material=working.provenance.get(id);if(!face||!material)throw new DomainError('STALE_BINDING');face.vertices.forEach(v=>used.add(v));originalFaces.add(material.faceId);metadata.push(material);triangles.push({faceId:material.faceId,vertices:face.vertices,barycentric:material.barycentric});}
  binding.trim={vertices:[...used].map(id=>{const p=uv.get(id)!;return {id,xMm:p.xMm,yMm:p.yMm};}),triangles,boundary:binding.report.boundary,holes:[]};
  const originalUv=new Map<string,{vertexId:string;xMm:number;yMm:number}>();
  // UV corners are diagnostic support; the exact inverse uses trim triangles.
  for(let i=0;i<metadata.length;i++){const m=metadata[i],t=triangles[i],p=t.vertices.map(id=>uv.get(id)!),a=m.barycentric.map(b=>[b[1],b[2]]),den=(a[1][0]-a[0][0])*(a[2][1]-a[0][1])-(a[2][0]-a[0][0])*(a[1][1]-a[0][1]);if(Math.abs(den)<1e-14)continue;
   originals.get(m.faceId)!.vertices.forEach((id,k)=>{if(originalUv.has(id))return;const q=[[0,0],[1,0],[0,1]][k],v=((q[0]-a[0][0])*(a[2][1]-a[0][1])-(q[1]-a[0][1])*(a[2][0]-a[0][0]))/den,w=((a[1][0]-a[0][0])*(q[1]-a[0][1])-(a[1][1]-a[0][1])*(q[0]-a[0][0]))/den;originalUv.set(id,{vertexId:id,xMm:p[0].xMm*(1-v-w)+p[1].xMm*v+p[2].xMm*w,yMm:p[0].yMm*(1-v-w)+p[1].yMm*v+p[2].yMm*w});});
  }
  const piece=run.pieces.find(p=>p.id===binding.pieceId)!,regions=new Map<string,number>();for(const m of metadata){const [a,b,c]=m.barycentric,area=Math.abs((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]))*sourceAreas.get(m.faceId)!,region=originals.get(m.faceId)!.region;regions.set(region,(regions.get(region)??0)+area);}const dominant=[...regions].sort((a,b)=>b[1]-a[1])[0]?.[0];piece.name=(dominant||'Combined panel')+' / '+(run.pieces.indexOf(piece)+1);binding.trim.boundary=piece.nodes.map(n=>insertTrimBoundary(binding.trim!,[n.xMm,n.yMm]));binding.trim.holes=(piece.holes??[]).map(r=>r.map(n=>insertTrimBoundary(binding.trim!,[n.xMm,n.yMm])));piece.color=metadata[0].color;if(metadata.some(m=>m.color!==piece.color))throw new DomainError('COLOR_CUT_BOUNDARY');binding.report={...binding.report,faceIds:[...originalFaces],uv:[...originalUv.values(),...binding.report.uv.filter(v=>binding.report.boundary.includes(v.vertexId)&&!originalUv.has(v.vertexId))],faceDistortion:binding.report.faceDistortion?.map(d=>({...d,faceId:working.provenance.get(d.faceId)!.faceId}))};binding.topologyVersion=source.topologyVersion;binding.surfaceHash=surfaceHash;binding.geometryHash=pieceGeometryHash(piece);if(project.markings?.length)binding.colorHash=cutColorHash(project);
 }
 return {...run,sourceHash:surfaceHash,cutEdges:(source.cutConstraints??[]).filter(e=>e.locked).map(e=>[e.a,e.b] as [string,string])};
}
