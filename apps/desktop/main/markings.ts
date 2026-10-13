import {contextRegion,placementAnatomies,type PlacementContext} from '../../../packages/reference/placement-registration';
import {placementMatchesModel} from '../../../packages/reference/placement-review';
import {markingFingerprint} from './marking-fingerprint';
export {markingFingerprint} from './marking-fingerprint';
import {derivedName} from '../../../packages/schema/names';
import {partName,sideName} from '../../../packages/reference/body-parts';
import {surfaceSpline} from '../../../packages/surface/spline';
import {contourPiece} from '../../../packages/surface/shape-contour';
import {boxIndex,type Box} from '../../../packages/surface/spatial';
import {UNWRAP_FACES} from '../../../packages/surface/limits';
import {moveNode} from '../../../packages/pattern/edit';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {markingSchema,type Marking,type Project,type Issue,type Piece} from '../../../packages/schema/index';
import {hash,DomainError} from './repository';
import {pieceGeometryHash,bindingIssues} from './surface';
import {analyze,request} from './worker';
import {mappedMarking} from './fragment-mapping';
import {editTrimmedMarking} from './trim-marking';
import {anatomicalPlacement} from './anatomical-placement';
import {placedPoint} from '../../../packages/reference/placement-transform';
import {boundedMarkingRings,distinctMarkingStations} from './marking-path-budget';
export const markingSource=(project:Project,id?:string)=>project.pieces.find(p=>p.id===id)??project.patternLibrary?.find(r=>r.piece.id===id)?.piece;
export type XY=[number,number];type Job={subjects:XY[][];clips?:XY[][];subtract?:XY[][];union?:boolean;origin?:XY};
export const area=(r:XY[])=>r.reduce((s,p,i)=>{const q=r[(i+1)%r.length],o=r[0];return s+(p[0]-o[0])*(q[1]-o[1])-(q[0]-o[0])*(p[1]-o[1]);},0)/2;
export const positive=(r:XY[])=>area(r)<0?[...r].reverse():r;
const bounds=(r:XY[])=>[Math.min(...r.map(p=>p[0])),Math.min(...r.map(p=>p[1])),Math.max(...r.map(p=>p[0])),Math.max(...r.map(p=>p[1]))];
const overlap=(a:number[],b:number[])=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
export function weights(p:XY,r:XY[]):[number,number,number]{const [a,b,c]=r,d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);const u=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/d,v=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/d;return [u,v,1-u-v];}
/** Clip coordinates are quantized to 0.0001 mm. Bound correction in millimetres,
 * not barycentric units: near edge-on triangles amplify the same rounding error. */
export function clippedWeights(p:XY,triangle:XY[]):[number,number,number]{
 const w=weights(p,triangle);if(w.every(v=>Number.isFinite(v)&&v>=0))return w.map(v=>v===0?0:v) as [number,number,number];
 let best=Infinity,result:[number,number,number]=[0,0,0];
 for(let i=0;i<3;i++){const j=(i+1)%3,a=triangle[i],b=triangle[j],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0,d=Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);if(d<best){best=d;result=[0,0,0];result[i]=1-t;result[j]=t;}}
 if(!Number.isFinite(best)||best>0.0002)throw new DomainError('PROJECTION_NUMERICAL');return result;
}
function halfPlane(ring:XY[],value:(p:XY)=>number):XY[]{const output:XY[]=[];for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],va=value(a),vb=value(b);if(va>=0)output.push(a);if((va>=0)!==(vb>=0)){const t=va/(va-vb);output.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}}return output;}
/** Intersect/difference each round on the integer grid. Re-intersect their result
 * with the original floating-point face before constructing barycentric provenance. */
export function triangleClip(ring:XY[],triangle:XY[]):XY[]{let result=ring;const boundary=positive(triangle);for(let i=0;i<3&&result.length;i++){const a=boundary[i],b=boundary[(i+1)%3];result=halfPlane(result,p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));}return result.filter((p,i,r)=>Math.hypot(p[0]-r[(i+r.length-1)%r.length][0],p[1]-r[(i+r.length-1)%r.length][1])>1e-9);}
/** Original face overlap distinguishes true ambiguity from a 0.0001 mm clip-grid sliver at a shared edge. */
function trianglesOverlap(a:XY[],b:XY[]){let intersection=positive(a);const ring=positive(b);for(let i=0;i<3&&intersection.length;i++){const u=ring[i],v=ring[(i+1)%3];intersection=halfPlane(intersection,p=>(v[0]-u[0])*(p[1]-u[1])-(v[1]-u[1])*(p[0]-u[0]));}return intersection.length>=3&&Math.abs(area(intersection))>1e-6;}
export async function clip(worker:string,jobs:Job[],precisionDigits=4):Promise<XY[][][]>{
 const results:XY[][][]=[],schema=z.object({ok:z.literal(true),protocolVersion:z.literal(1),results:z.array(z.object({rings:z.array(z.array(z.tuple([z.number().finite(),z.number().finite()])))}))});let batch:Job[]=[],points=0;
 const flush=async()=>{if(!batch.length)return;const result=schema.parse(await request(worker,{protocolVersion:1,operation:'geometry.clip',jobs:batch.map(job=>({...job,precisionDigits}))}));if(result.results.length!==batch.length)throw new DomainError('WORKER_PROTOCOL');results.push(...result.results.map(r=>r.rings));batch=[];points=0;};
 for(const job of jobs){const n=[...job.subjects,...job.clips??[],...job.subtract??[]].reduce((s,r)=>s+r.length,0);if(batch.length>=500||points+n>50000)await flush();if(n>200000)throw new DomainError('PROJECTION_LIMIT');batch.push(job);points+=n;}await flush();return results;
}
export function staleMarkingIds(project:Project,checkPaths=true):Set<string>{
 const surfaceHash=project.surface?hash(JSON.stringify(project.surface)):null,markings=project.markings??[];
 const baseStale=(m:Marking)=>{const source=markingSource(project,m.sourcePieceId);const archived=m.source==='cut-library'&&project.cuttingLibrary?.some(e=>e.id===m.cutLibraryId&&e.markings.some(original=>original.id===m.id&&original.sourceHash===(m.cutLibrarySourceHash??m.sourceHash)));return (m.source==='cut-library'&&!archived)||(archived&&!!m.surfaceShape&&m.sourceHash!==hash(JSON.stringify(m.surfaceShape)))||(!archived&&!placementMatchesModel(project,m))||!project.surface||m.surfaceId!==project.surface.id||m.topologyVersion!==project.surface.topologyVersion||m.surfaceHash!==surfaceHash||(!archived&&!m.inference&&(m.surfaceShape?m.sourceHash!==hash(JSON.stringify(m.surfaceShape)):m.textureId?!project.surface.textures?.some(t=>t.id===m.textureId&&t.sha256===m.sourceHash):!source||m.sourceHash!==pieceGeometryHash(source)))||checkPaths&&m.paths.some(path=>{const piece=project.pieces.find(p=>p.id===path.pieceId);return !piece||path.geometryHash!==pieceGeometryHash(piece);});};
 return new Set(markings.filter(m=>{const dependency=m.inference?markings.find(source=>source.id===m.inference!.sourceMarkingId&&!source.inference):null;return baseStale(m)||(m.inference&&(!dependency||baseStale(dependency)||markingFingerprint(dependency)!==m.inference.sourceFingerprint));}).map(m=>m.id));
}
export function markingIssues(project:Project):Issue[]{
 const markings=project.markings??[],stale=staleMarkingIds(project);
 return markings.flatMap(m=>{const dependency=m.inference?markings.find(source=>source.id===m.inference!.sourceMarkingId&&!source.inference):null;return m.paths.flatMap<Issue>(path=>stale.has(m.id)?[{ruleId:m.id+':'+path.pieceId+':marking',entityId:path.pieceId,severity:'error',messageKey:'STALE_MARKING'}]:(m.placement&&!m.placement.reviewed||m.inference&&dependency?.placement&&!dependency.placement.reviewed)?[{ruleId:m.id+':'+path.pieceId+':placement',entityId:path.pieceId,severity:'error',messageKey:'AUTOMATIC_PLACEMENT_REVIEW'}]:m.inference&&!m.inference.reviewed?[{ruleId:m.id+':'+path.pieceId+':inference',entityId:path.pieceId,severity:'error',messageKey:'INFERRED_MARKING_REVIEW'}]:[]);});
}
/** Orthographic front/back projection with exact polygonal visibility subtraction, not nearest-face approximation. */
export async function projectMarking(worker:string,project:Project,sourceId:string,view:'front'|'back',offsetXmm:number,offsetYmm:number,replaceManual=false,automatic=false,context?:PlacementContext):Promise<Marking>{
 const candidate=project.patternLibrary?.find(r=>r.piece.id===sourceId);if(context&&(!candidate||!placementAnatomies(candidate).some(a=>a.part===context.part&&a.side===context.side)))throw new DomainError('ANATOMY_REQUIRED');const selected=candidate?contextRegion(candidate,context):undefined;const related=project.markings?.filter(m=>m.sourcePieceId===sourceId&&m.view===view)??[],unregistered=related.filter(m=>!m.placement);if((automatic||context)&&unregistered.some(m=>m.locked))throw new DomainError('MARKING_LOCKED');if((automatic||context)&&!replaceManual&&unregistered.some(m=>m.editMode==='uv-manual'||m.source==='manual'&&!m.editMode))throw new DomainError('MANUAL_MARKING_REVIEW');const old=related.find(m=>(!automatic&&!context&&!m.placement)||m.placement?.part===selected?.anatomy?.part&&m.placement?.side===selected?.anatomy?.side);if(old?.locked)throw new DomainError('MARKING_LOCKED');if(old&&(old.editMode==='uv-manual'||old.source==='manual'&&!old.editMode)&&!replaceManual)throw new DomainError('MANUAL_MARKING_REVIEW');
 const region=project.patternLibrary?.find(r=>r.piece.id===sourceId),placement=automatic||old?.placement?anatomicalPlacement(project,selected??region??(()=>{throw new DomainError('ANATOMY_REQUIRED');})()):undefined;
 const {mesh,source,bindings,fragments,paths}=await projectReferenceGeometry(worker,project,sourceId,view,offsetXmm,offsetYmm,placement);
 const marking=markingSchema.parse({id:old?.id??randomUUID(),name:candidate?.anatomy?.contexts&&placement?derivedName(source.name,' / '+partName(placement.part)+' '+sideName(placement.side)):source.name,color:source.color,...(placement?{placement}:{}),source:'reference',editMode:'projected',sourcePieceId:source.id,sourceHash:pieceGeometryHash(source),surfaceId:mesh.id,topologyVersion:mesh.topologyVersion,surfaceHash:hash(JSON.stringify(mesh)),view,offsetXmm,offsetYmm,fragments,paths});return bindings.some(b=>b.trim)?mappedMarking(worker,{...project,bindings},marking):marking;
}
/** Pure projection also supports recalculating an existing saved placement at
 * manufacturing precision, without re-registering its reviewed pose or size. */
export async function projectReferenceGeometry(worker:string,project:Project,sourceId:string,view:'front'|'back',offsetXmm:number,offsetYmm:number,placement?:Marking['placement']){
 const mesh=project.surface,source=markingSource(project,sourceId);if(!mesh||!source)throw new DomainError('SURFACE_MISSING');const invalidBindings=new Set(bindingIssues(project).filter(i=>i.severity==='error').map(i=>i.entityId));const bindings=(project.bindings??[]).filter(b=>!invalidBindings.has(b.pieceId));if(mesh.faces.length>UNWRAP_FACES)throw new DomainError('PROJECTION_LIMIT');
 const geometry=await analyze(worker,{...project,pieces:[source]});if(geometry[0].issues.some(i=>i.severity==='error'))throw new DomainError('INVALID_GEOMETRY');const rings=[geometry[0].seam??source.nodes,...(geometry[0].seamHoles??source.holes??[])].map(r=>r.map(p=>{const point=placement?placedPoint(p,placement,offsetXmm,offsetYmm):{xMm:p.xMm+offsetXmm,yMm:p.yMm+offsetYmm};return [point.xMm,point.yMm] as XY;})),sourceBounds=bounds(rings[0]),vertices=new Map(mesh.vertices.map(v=>[v.id,v])),sign=view==='front'?1:-1;
 const faceBindings=new Map<string,NonNullable<Project['bindings']>>();for(const b of bindings)for(const id of b.report.faceIds)faceBindings.set(id,[...(faceBindings.get(id)??[]),b]);
 const faces=mesh.faces.map(f=>{const v=f.vertices.map(id=>vertices.get(id)!),triangle=v.map(p=>[sign*p.xMm,p.yMm] as XY);return {f,triangle,depth:v.map(p=>sign*p.zMm),bounds:bounds(triangle),det:area(triangle),bindings:faceBindings.get(f.id)??[]};}).filter(f=>Math.abs(f.det)>1e-6);
 const index=boxIndex(faces.map(f=>f.bounds as Box));let comparisons=0;const nearby=(bounds:number[])=>index.query(bounds as Box).map(i=>faces[i]).filter(f=>{if(++comparisons>2000000)throw new DomainError('PROJECTION_LIMIT');return true;});
 const uvMaps=new Map(bindings.map(b=>[b.pieceId,new Map(b.report.uv.map(p=>[p.vertexId,p]))]));
 const targets=faces.filter(f=>f.det>0&&overlap(f.bounds,sourceBounds)&&(!placement||placement.regions.includes(f.f.region)));const jobs:Job[]=targets.map(face=>{
 const depth=(p:XY)=>weights(p,face.triangle).reduce((s,w,i)=>s+w*face.depth[i],0),subtract:XY[][]=[];
 for(const other of nearby(face.bounds)){if(other.f.id===face.f.id||!overlap(other.bounds,face.bounds)||Math.max(...other.depth)<Math.min(...face.depth)-1e-6)continue;
 const occluder=halfPlane(other.triangle,p=>weights(p,other.triangle).reduce((s,w,i)=>s+w*other.depth[i],0)-depth(p)-1e-6);if(occluder.length>=3&&Math.abs(area(occluder))>1e-6)subtract.push(positive(occluder));}
 return {subjects:rings,clips:[positive(face.triangle)],subtract};
 });
 const clipped=await clip(worker,jobs,12);
 const ambiguousJobs:Job[]=[];targets.forEach((face,i)=>{if(!clipped[i].length)return;for(const other of nearby(face.bounds)){if(other.f.id===face.f.id||!overlap(face.bounds,other.bounds))continue;const delta=(p:XY)=>weights(p,other.triangle).reduce((s,w,j)=>s+w*other.depth[j],0)-weights(p,face.triangle).reduce((s,w,j)=>s+w*face.depth[j],0);if(face.triangle.every(p=>Math.abs(delta(p))<1e-6)&&trianglesOverlap(face.triangle,other.triangle))ambiguousJobs.push({subjects:clipped[i],clips:[positive(other.triangle)]});}});
 if(ambiguousJobs.length){const ambiguous=await clip(worker,ambiguousJobs,12);if(ambiguous.some(r=>Math.abs(r.reduce((s,p)=>s+area(p),0))>1e-4))throw new DomainError('AMBIGUOUS_PROJECTION');}
 const fragments:Marking['fragments']=[],uvByPiece=new Map<string,XY[][]>();
 targets.forEach((face,i)=>{const rings=clipped[i].map(r=>triangleClip(r,face.triangle)).filter(r=>r.length>=3&&Math.abs(area(r))>1e-6);if(!rings.length)return;const bary=rings.map(r=>r.map(p=>{return clippedWeights(p,face.triangle);}));fragments.push({faceId:face.f.id,rings:bary});for(const binding of face.bindings){const uv=uvMaps.get(binding.pieceId)!,triangle=face.f.vertices.map(id=>uv.get(id)!);const mapped=bary.map(r=>r.map(w=>[w.reduce((s,v,j)=>s+v*triangle[j].xMm,0),w.reduce((s,v,j)=>s+v*triangle[j].yMm,0)] as XY));const existing=uvByPiece.get(binding.pieceId)??[];existing.push(...mapped);uvByPiece.set(binding.pieceId,existing);}});
 if(!fragments.length)throw new DomainError('NO_VISIBLE_PROJECTION');const entries=[...uvByPiece],merged=await clip(worker,entries.map(([,subjects])=>({subjects,union:true})),12);
 const paths:Marking['paths']=[];for(let i=0;i<entries.length;i++){const [pieceId]=entries[i],piece=project.pieces.find(p=>p.id===pieceId);if(!piece)throw new DomainError('STALE_BINDING');const rings=await boundedMarkingRings(merged[i],12,jobs=>clip(worker,jobs,12));paths.push({pieceId,geometryHash:pieceGeometryHash(piece),rings:rings.map(r=>r.map(([xMm,yMm])=>({xMm,yMm})))});}
 return {mesh,source,bindings,fragments,paths};
}
function seamStations(rings:XY[][],a:XY,b:XY){const result:number[]=[],dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;const inside=(p:XY)=>{let yes=false;for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const u=ring[i],v=ring[j];if((u[1]>p[1])!==(v[1]>p[1])&&p[0]<(v[0]-u[0])*(p[1]-u[1])/(v[1]-u[1])+u[0])yes=!yes;}return yes;};if(inside(a))result.push(0);if(inside(b))result.push(1);
 for(const ring of rings)for(let i=0;i<ring.length;i++){const p=ring[i],q=ring[(i+1)%ring.length],ex=q[0]-p[0],ey=q[1]-p[1],den=dx*ey-dy*ex;if(Math.abs(den)<1e-10){if(Math.abs((p[0]-a[0])*dy-(p[1]-a[1])*dx)<1e-7)for(const point of [p,q]){const t=((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length2;if(t>=0&&t<=1)result.push(t);}continue;}const t=((p[0]-a[0])*ey-(p[1]-a[1])*ex)/den,u=((p[0]-a[0])*dy-(p[1]-a[1])*dx)/den;if(t>=-1e-7&&t<=1+1e-7&&u>=-1e-7&&u<=1+1e-7)result.push(Math.max(0,Math.min(1,t)));}
 return result.sort((a,b)=>a-b).filter((v,i,r)=>i===0||Math.abs(v-r[i-1])>1e-6);
}
/** Inverse-map edited millimetre polygons through exact triangle clipping. Cross-seam changes require a coordinated surface edit. */
export async function editMarking(worker:string,project:Project,markingId:string,pieceId:string,raw:{xMm:number;yMm:number}[][]):Promise<Marking>{
 const old=project.markings?.find(m=>m.id===markingId);if(old?.locked)throw new DomainError('MARKING_LOCKED');const mesh=project.surface,binding=project.bindings?.find(b=>b.pieceId===pieceId),piece=project.pieces.find(p=>p.id===pieceId),path=old?.paths.find(p=>p.pieceId===pieceId);if(!old||!mesh||!binding||!piece||!path)throw new DomainError('ENTITY_MISSING');if(markingIssues(project).some(i=>i.ruleId.startsWith(markingId)&&i.messageKey==='STALE_MARKING')||bindingIssues(project).some(i=>i.severity==='error'))throw new DomainError('STALE_MARKING');
 if(binding.trim)return editTrimmedMarking(worker,project,old,piece,binding,raw);
 if(project.bindings?.some(b=>b.pieceId!==pieceId&&b.report.faceIds.some(id=>binding.report.faceIds.includes(id))))throw new DomainError('AMBIGUOUS_BINDING');
 const rings=raw.map(r=>distinctMarkingStations(r.map(p=>[p.xMm,p.yMm] as XY)));const g=await analyze(worker,{...project,pieces:rings.map(r=>({...piece,id:randomUUID(),allowanceMm:0,nodes:r.map(([xMm,yMm])=>({xMm,yMm,id:randomUUID()})),holes:[],curves:[],notches:[],labels:[]}))});if(g.some(v=>v.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');
 const uv=new Map(binding.report.uv.map(v=>[v.vertexId,[v.xMm,v.yMm] as XY])),bound=new Set(binding.report.faceIds),shared=new Set<string>();for(const other of project.bindings??[])if(other.pieceId!==pieceId)for(let i=0;i<other.report.boundary.length;i++)shared.add([other.report.boundary[i],other.report.boundary[(i+1)%other.report.boundary.length]].sort().join(':'));
 const oldRings=path.rings.map(r=>r.map(p=>[p.xMm,p.yMm] as XY));for(let i=0;i<binding.report.boundary.length;i++){const a=binding.report.boundary[i],b=binding.report.boundary[(i+1)%binding.report.boundary.length];if(!shared.has([a,b].sort().join(':')))continue;const before=seamStations(oldRings,uv.get(a)!,uv.get(b)!),after=seamStations(rings,uv.get(a)!,uv.get(b)!);if(before.length!==after.length||before.some((v,i)=>Math.abs(v-after[i])>1e-5))throw new DomainError('MARKING_SEAM_CHANGE');}
 const faces=mesh.faces.filter(f=>bound.has(f.id)),clipped=await clip(worker,faces.map(f=>({subjects:rings,clips:[positive(f.vertices.map(id=>uv.get(id)!))]}))),covered=clipped.flat().reduce((s,r)=>s+area(r),0),expected=Math.abs(rings.reduce((s,r)=>s+area(r),0));if(expected<1e-5||Math.abs(covered-expected)>Math.max(.01,expected*1e-5))throw new DomainError('MARKING_OUTSIDE_PATCH');
 const fragments:Marking['fragments']=[];faces.forEach((f,i)=>{if(!clipped[i].length)return;const triangle=f.vertices.map(id=>uv.get(id)!);fragments.push({faceId:f.id,rings:clipped[i].map(r=>triangleClip(r,triangle)).filter(r=>r.length>=3&&Math.abs(area(r))>1e-6).map(r=>r.map(p=>{return clippedWeights(p,triangle);}))});});
 const merged=await clip(worker,[{subjects:clipped.flat(),union:true}]),bounded=await boundedMarkingRings(merged[0],4,jobs=>clip(worker,jobs));return markingSchema.parse({...old,placement:old.placement?{...old.placement,reviewed:false}:undefined,inference:old.inference?{...old.inference,reviewed:false}:undefined,source:'manual',editMode:'uv-manual',fragments:[...old.fragments.filter(f=>!bound.has(f.faceId)),...fragments],paths:old.paths.map(p=>p.pieceId===pieceId?{...p,rings:bounded.map(r=>r.map(([xMm,yMm])=>({xMm,yMm})))}:p)});
}

/** Rebuild every projection from one edited source before committing any mutation. */
export async function editMarkingSource(worker:string,project:Project,pieceId:string,nodeId:string,xMm:number,yMm:number,replaceManual=false){const source=markingSource(project,pieceId),related=project.markings?.filter(m=>m.sourcePieceId===pieceId)??[];if(!source||!related.length)throw new DomainError('ENTITY_MISSING');if(related.some(m=>m.locked))throw new DomainError('MARKING_LOCKED');if(project.bindings?.some(b=>b.pieceId===pieceId))throw new DomainError('MARKING_SOURCE_BOUND');if(related.some(m=>m.editMode==='uv-manual'||m.source==='manual'&&!m.editMode)&&!replaceManual)throw new DomainError('MANUAL_MARKING_REVIEW');if(!source.nodes.some(n=>n.id===nodeId)&&!source.holes?.some(h=>h.some(n=>n.id===nodeId)))throw new DomainError('ENTITY_MISSING');const piece=source.nodes.some(n=>n.id===nodeId)?moveNode(source,nodeId,xMm,yMm):{...source,holes:source.holes?.map(h=>h.map(n=>n.id===nodeId?{...n,xMm,yMm}:n))},proposed={...project,pieces:project.pieces.map(p=>p.id===pieceId?piece:p),patternLibrary:project.patternLibrary?.map(r=>r.piece.id===pieceId?{...r,piece}:r)},markings=[];for(const m of related){const next=await projectMarking(worker,proposed,pieceId,m.view,m.offsetXmm,m.offsetYmm,replaceManual,false,m.placement);markings.push({...next,id:m.id,source:'manual' as const,editMode:'source-manual' as const});}return {piece,markings};}

/** An orthonormal view plane is a drawing frame, never an invented piece in the manufacturing project. */
export async function surfaceMarking(worker:string,project:Project,shape:NonNullable<Marking['surfaceShape']>,color:string,name:string){
 // Internal callers may bypass request parsing. Hash the normalized persisted
 // representation so object property order cannot make valid paint look stale.
 shape=markingSchema.shape.surfaceShape.unwrap().parse(shape);
 const mesh=project.surface;if(!mesh)throw new DomainError('SURFACE_MISSING');
 // Color-separated cut pieces become obsolete after painting, but their mesh/UV
 // geometry remains usable for further strokes. Keep the original colorHash in
 // the project so printing still requires a fresh cut calculation.
 const projectionProject={...project,bindings:project.bindings?.map(b=>({...b,colorHash:undefined}))};
 if(bindingIssues(projectionProject).some(i=>i.severity==='error'))throw new DomainError('STALE_BINDING');const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0),axes=shape.axes;
 const cross=[axes[0][1]*axes[1][2]-axes[0][2]*axes[1][1],axes[0][2]*axes[1][0]-axes[0][0]*axes[1][2],axes[0][0]*axes[1][1]-axes[0][1]*axes[1][0]];
 if(axes.some((a,i)=>Math.abs(dot(a,a)-1)>1e-8||axes.some((b,j)=>i!==j&&Math.abs(dot(a,b))>1e-8))||dot(cross,axes[2])<1-1e-8)throw new DomainError('INVALID_FRAME');
 let nodes=shape.nodes;if(shape.spline)try{nodes=surfaceSpline(shape.nodes,shape.spline.tension,shape.spline.toleranceMm);}catch(e){throw new DomainError((e as Error).message);}
 const rotated={...mesh,vertices:mesh.vertices.map(v=>{const delta=[v.xMm-shape.origin[0],v.yMm-shape.origin[1],v.zMm-shape.origin[2]],r=axes.map(a=>dot(a,delta));return {...v,xMm:r[0],yMm:r[1],zMm:r[2]};})},surfaceHash=hash(JSON.stringify(rotated)),source:Piece={id:randomUUID(),name,nodes:nodes.map(p=>({...p,id:randomUUID()})),holes:shape.holes?.map(r=>r.map(p=>({...p,id:randomUUID()}))),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Surface marking source',furRad:0,color};
 const vector=shape.curves?.length?contourPiece(shape,randomUUID):undefined;
 if(vector){source.nodes=vector.nodes;Object.assign(source,{curves:vector.curves});}
 const proposed={...projectionProject,surface:rotated,bindings:projectionProject.bindings?.map(b=>({...b,surfaceHash})),pieces:[...project.pieces,source]},marking=await projectMarking(worker,proposed,source.id,'front',0,0);
 const allowed=shape.regions?new Set(mesh.faces.filter(f=>shape.regions!.includes(f.region)).map(f=>f.id)):undefined;
 const fragments=allowed?marking.fragments.filter(f=>allowed.has(f.faceId)):marking.fragments;
 if(!fragments.length)throw new DomainError('NO_VISIBLE_PROJECTION');
 const result=markingSchema.parse({...marking,id:randomUUID(),source:'surface',sourcePieceId:undefined,surfaceShape:shape,sourceHash:hash(JSON.stringify(shape)),surfaceHash:hash(JSON.stringify(mesh)),fragments});
 return allowed?mappedMarking(worker,project,{...result,paths:[]}):result;
}
