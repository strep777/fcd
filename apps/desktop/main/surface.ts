import {nativeSurfaceResponseSchema} from '../../../packages/surface/native-report';
import {assertUserCutsValid} from '../../../packages/surface/cut-path-contract';
import {designManufacturingOutline} from './design-outline';
import {parentPort} from 'node:worker_threads';
import {numericalTriangleArea} from '../../../packages/surface/numerical';
import {projectedReport} from '../../../packages/surface/projected-report';
import {designComponents,splitDesignDomain,seamPathCount,designQualityFailure,measureBoundaryStrain} from '../../../packages/surface/design-partition';
import {sectionDesignDomain} from '../../../packages/surface/design-section';
import {narrowPanelSplit} from '../../../packages/surface/panel-neck';
import type {Child} from '../../../packages/surface/refine';
import {mergeDesignCharts} from '../../../packages/surface/merge-design-charts';
import {necessaryTopologyCuts,openDesignSeams} from '../../../packages/surface/design-cuts';
import {planarReports,simplifyReportBoundary} from '../../../packages/surface/planar';
import {scopeFaces} from '../../../packages/surface/cut-geometry';
import {pointBounds} from '../../../packages/pattern/edit';
import {inspectImage} from '../../../packages/reference/image-input';
import {MESH_VERTICES,MESH_FACES,MESH_FILE_BYTES,UNWRAP_FACES} from '../../../packages/surface/limits';
import {automaticCutMesh} from './automatic-cuts';
import {randomUUID} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {surfaceSchema,bodyParamsSchema,surfaceRunSchema,type UnwrapOptions,type BodyParams,type Surface,type SurfaceRun,type Project,type Geometry,type Issue,type Piece} from '../../../packages/schema/index';
import {DomainError,hash} from './repository';
import {createWorkerSession,analyze} from './worker';
export const pieceGeometryHash=(p:Piece)=>hash(JSON.stringify({nodes:p.nodes,holes:p.holes??[],curves:p.curves??[]}));
export const cutColorHash=(project:Project)=>hash(JSON.stringify((project.markings??[]).map(m=>({id:m.id,color:m.color,sourceHash:m.sourceHash,surfaceHash:m.surfaceHash,fragments:m.fragments}))));
export function bindingIssues(project:Project):Issue[]{if(!project.bindings?.length)return [];const surfaceHash=project.surface?hash(JSON.stringify(project.surface)):null;return (project.bindings??[]).flatMap<Issue>(b=>{
 const piece=project.pieces.find(p=>p.id===b.pieceId);if(!piece)return [];
 if(!project.surface||b.surfaceId!==project.surface.id||b.topologyVersion!==project.surface.topologyVersion||b.surfaceHash!==surfaceHash||b.geometryHash!==pieceGeometryHash(piece)||b.colorHash&&b.colorHash!==cutColorHash(project))return [{ruleId:`${b.pieceId}:binding`,entityId:b.pieceId,severity:'error' as const,messageKey:'STALE_BINDING'}];
 const issues:Issue[]=[];if(b.report.status==='needsReview')issues.push({ruleId:`${b.pieceId}:distortion`,entityId:b.pieceId,severity:'warning',messageKey:'SURFACE_DISTORTION'});if(project.surface.customTemplate)issues.push({ruleId:b.pieceId+':custom-template',entityId:b.pieceId,severity:'warning',messageKey:'CUSTOM_TEMPLATE_REVIEW'});if(project.surface.template&&!project.surface.assembly)issues.push({ruleId:`${b.pieceId}:modular-template`,entityId:b.pieceId,severity:'warning',messageKey:'MODULAR_TEMPLATE_REVIEW'});if(project.surface.assembly)issues.push({ruleId:`${b.pieceId}:assembled-template`,entityId:b.pieceId,severity:'warning',messageKey:'ASSEMBLED_DIMENSIONS_REQUIRE_REVIEW'});return issues;
});}
export function parseObj(text:string,scale=1):Surface{
 if(Buffer.byteLength(text)>MESH_FILE_BYTES)throw new DomainError('MESH_LIMIT');
 if(!Number.isFinite(scale)||scale<=0||scale>10000)throw new DomainError('VALIDATION_ERROR');
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[];let region='default';
 for(const line of text.split(/\r?\n/)){
  const tokens=line.trim().split(/\s+/);if(!tokens[0]||tokens[0].startsWith('#'))continue;
  if(tokens[0]==='v'){
   if(tokens.length!==4)throw new DomainError('OBJ_UNSUPPORTED');const [xMm,yMm,zMm]=tokens.slice(1).map(v=>Number(v)*scale);vertices.push({id:randomUUID(),xMm,yMm,zMm});if(vertices.length>MESH_VERTICES)throw new DomainError('MESH_LIMIT');
  }else if(tokens[0]==='g'||tokens[0]==='o'){region=tokens.slice(1).join(' ').slice(0,80)||'default';}
  else if(tokens[0]==='f'){
   if(tokens.length!==4)throw new DomainError('OBJ_TRIANGLES_REQUIRED');
   const indices=tokens.slice(1).map(t=>{const raw=t.split('/')[0];if(!/^-?\d+$/.test(raw))throw new DomainError('INVALID_MESH');const n=Number(raw),i=n>0?n-1:vertices.length+n;if(n===0||!vertices[i])throw new DomainError('INVALID_MESH');return vertices[i].id;});
   faces.push({id:randomUUID(),vertices:indices as [string,string,string],region});if(faces.length>MESH_FACES)throw new DomainError('MESH_LIMIT');
  }else if(!['vn','vt','s','usemtl','mtllib'].includes(tokens[0]))throw new DomainError('OBJ_UNSUPPORTED');
 }
 const mesh=surfaceSchema.parse({id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces});validateSurface(mesh);return mesh;
}
export async function readObj(path:string,scale:number){if((await stat(path)).size>MESH_FILE_BYTES)throw new DomainError('MESH_LIMIT');return parseObj(await readFile(path,'utf8'),scale);}
export function validateSurface(mesh:Surface){
 surfaceSchema.parse(mesh);
 const vertexIndices=new Map<string,number>(),faceIds=new Set(mesh.faces.map(f=>f.id)),vertexCount=mesh.vertices.length;
 mesh.vertices.forEach((vertex,index)=>vertexIndices.set(vertex.id,index));
 if(vertexIndices.size!==vertexCount||faceIds.size!==mesh.faces.length)throw new DomainError('INVALID_MESH');
 // At most 200,000 vertices: every unordered pair fits exactly in a safe
 // integer. Keep only its observed direction bits, instead of sorting UUID
 // pairs and retaining an array of objects for every triangle edge.
 const edgeKey=(a:number,b:number)=>a<b?a*vertexCount+b:b*vertexCount+a;
 const namedEdgeKey=(a:string,b:string)=>{const ai=vertexIndices.get(a),bi=vertexIndices.get(b);return ai===undefined||bi===undefined?-1:edgeKey(ai,bi);};
 const edges=new Map<number,number>();
 for(const f of mesh.faces){const ids=f.vertices.map(id=>vertexIndices.get(id));if(ids.some(id=>id===undefined))throw new DomainError('INVALID_MESH');const indices=ids as [number,number,number],p=indices.map(index=>mesh.vertices[index]);if(numericalTriangleArea(p.map(v=>[v.xMm,v.yMm,v.zMm]))===undefined)throw new DomainError('DEGENERATE_MESH');
  for(let i=0;i<3;i++){const a=indices[i],b=indices[(i+1)%3],key=edgeKey(a,b),direction=a<b?1:2,seen=edges.get(key)??0;if(seen===3)throw new DomainError('NONMANIFOLD_MESH');if(seen===direction)throw new DomainError('MESH_ORIENTATION');edges.set(key,seen|direction);}
 }
 if(mesh.assembly){if([...edges.values()].some(direction=>direction!==3))throw new DomainError('NONMANIFOLD_MESH');const neighbors=new Map(mesh.vertices.map(v=>[v.id,new Set<string>()]));for(const f of mesh.faces)for(const a of f.vertices)for(const b of f.vertices)neighbors.get(a)!.add(b);const seen=new Set<string>(),queue=[mesh.faces[0].vertices[0]];while(queue.length){const id=queue.pop()!;if(seen.has(id))continue;seen.add(id);for(const next of neighbors.get(id)!)if(!seen.has(next))queue.push(next);}if(mesh.faces.some(f=>f.vertices.some(id=>!seen.has(id))))throw new DomainError('DISCONNECTED_TEMPLATE');}
 const textureIds=new Set((mesh.textures??[]).map(t=>t.id)),textured=new Set<string>();if(textureIds.size!==(mesh.textures?.length??0))throw new DomainError('INVALID_MESH');for(const t of mesh.textures??[]){for(const asset of [t,t.proxy]){const bytes=Buffer.from(asset.png.split(',')[1],'base64');let input;try{input=inspectImage(bytes);}catch(e){throw new DomainError((e as Error).message);}if(input.mime!=='image/png'||input.orientation!==1||input.width!==asset.width||input.height!==asset.height||asset===t&&hash(bytes)!==t.sha256)throw new DomainError('IMAGE_RESOURCE_MISMATCH');}const factor=Math.min(1,512/Math.max(t.width,t.height));if(t.proxy.width!==Math.max(1,Math.round(t.width*factor))||t.proxy.height!==Math.max(1,Math.round(t.height*factor)))throw new DomainError('IMAGE_RESOURCE_MISMATCH');}for(const f of mesh.textureFaces??[]){if(!faceIds.has(f.faceId)||!textureIds.has(f.textureId)||textured.has(f.faceId))throw new DomainError('INVALID_MESH');textured.add(f.faceId);}
 const lineIds=new Set((mesh.cutLines??[]).map(l=>l.id));if(lineIds.size!==(mesh.cutLines?.length??0))throw new DomainError('INVALID_CUT');
 for(const line of mesh.cutLines??[]){if(!line.name.trim()||line.mirroredFrom&&!lineIds.has(line.mirroredFrom)||line.mirroredFrom===line.id)throw new DomainError('INVALID_CUT');const seen=new Set<number>();for(const e of line.edges){const key=namedEdgeKey(e.a,e.b);if(e.a===e.b||!edges.has(key)||seen.has(key))throw new DomainError('INVALID_CUT');seen.add(key);}}
 for(const c of mesh.cutBaseConstraints??[])if(!edges.has(namedEdgeKey(c.a,c.b)))throw new DomainError('INVALID_CUT');
 const constraints=new Set<number>();for(const c of mesh.cutConstraints??[]){const key=namedEdgeKey(c.a,c.b);if(c.a===c.b||!edges.has(key)||constraints.has(key))throw new DomainError('INVALID_MESH');constraints.add(key);}
}
/** Original procedural torso study with fixed topology; not an anatomical species template. */
export function generateTorso(raw:BodyParams,previous?:Surface):Surface{
 const p=bodyParamsSchema.parse(raw),n=48,sections=[{y:0,girth:p.hipGirthMm,pad:p.hipPaddingMm},{y:.3,girth:p.waistGirthMm,pad:p.waistPaddingMm},{y:.65,girth:p.chestGirthMm,pad:p.chestPaddingMm},{y:1,girth:p.neckGirthMm,pad:0}],vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 const stable=previous?.source==='torso-loft-1';
 for(const section of sections){const unit=Array.from({length:n},(_,i)=>({x:Math.cos(i*2*Math.PI/n),z:p.depthRatio*Math.sin(i*2*Math.PI/n)})),perimeter=unit.reduce((s,a,i)=>{const b=unit[(i+1)%n];return s+Math.hypot(a.x-b.x,a.z-b.z);},0),radius=section.girth/perimeter;
  for(const point of unit){const index=vertices.length,a=radius,b=radius*p.depthRatio;const nx=point.x/a,nz=point.z/b**2*radius,length=Math.hypot(nx,nz),padding=section.pad+p.layerMm;vertices.push({id:stable?previous.vertices[index].id:randomUUID(),xMm:point.x*radius+padding*nx/length,yMm:section.y*p.heightMm,zMm:point.z*radius+padding*nz/length});}
 }
 for(let ring=0;ring<sections.length-1;ring++)for(let j=0;j<n;j++){const a=ring*n+j,b=ring*n+(j+1)%n,c=(ring+1)*n+j,d=(ring+1)*n+(j+1)%n;for(const indices of [[a,c,b],[b,c,d]]){const index=faces.length;faces.push({id:stable?previous.faces[index].id:randomUUID(),vertices:indices.map(i=>vertices[i].id) as [string,string,string],region:`torso-${Math.floor(j/12)+1}`});}}
 return surfaceSchema.parse({id:stable?previous.id:randomUUID(),topologyVersion:stable?previous.topologyVersion+1:1,source:'torso-loft-1',vertices,faces,parameters:p,cutConstraints:stable?previous.cutConstraints:undefined});
}
export async function unwrapSurface(worker:string,surface:Surface,project:Project,options:UnwrapOptions={},signal?:AbortSignal,solvedSurface?:(mesh:Surface)=>void,refinedSurface?:(mesh:Surface,children:Map<string,Child[]>)=>void|boolean,generatedFrom?:Surface):Promise<SurfaceRun>{
 const session=createWorkerSession(worker,signal),solveStarted=performance.now();
 const nativeStats={calls:0,elapsedMs:0,cacheHits:0,groups:{} as Record<string,{calls:number;ms:number;faces:number}>,slow:[] as {phase:string;method:string;faces:number;ms:number}[]},nativeCache=new Map<string,{patches:SurfaceRun['bindings'][number]['report'][]}|{error:DomainError}>();let cachedVertices=0,solvePhase='initial';
 try{
 const sourceSurface=surface;validateSurface(sourceSurface);try{assertUserCutsValid(sourceSurface);}catch(error){throw new DomainError((error as Error).message);}const selected=scopeFaces(sourceSurface);if(!selected.length)throw new DomainError('EMPTY_CUT_SCOPE');
 if(selected.length!==surface.faces.length){const faces=new Set(selected.map(f=>f.id)),vertices=new Set(selected.flatMap(f=>f.vertices)),edges=new Set(selected.flatMap(f=>f.vertices.map((a,i)=>[a,f.vertices[(i+1)%3]].sort().join(':'))));surface={...surface,faces:selected,vertices:surface.vertices.filter(v=>vertices.has(v.id)),cutConstraints:surface.cutConstraints?.filter(c=>edges.has([c.a,c.b].sort().join(':'))),textureFaces:surface.textureFaces?.filter(f=>faces.has(f.faceId)),assembly:undefined,cutLines:undefined,cutBaseConstraints:undefined};}
 // Material boundaries subdivide input triangles; budget the source and each
 // native solve separately, while retaining the generated-mesh resource cap.
 if(generatedFrom&&(generatedFrom!==project.surface||options.partitionStrategy!=='design'))throw new DomainError('INVALID_MESH');
 if((generatedFrom?scopeFaces(generatedFrom).length:surface.faces.length)>UNWRAP_FACES)throw new DomainError('UNWRAP_LIMIT');
 if(surface.faces.length>MESH_FACES)throw new DomainError('RESOURCE_LIMIT');validateSurface(surface);if(!options.automaticCuts&&surface.cutConstraints?.some(c=>c.locked))throw new DomainError('LOCKED_CUTS_REQUIRE_AUTO');let cut=options.automaticCuts?automaticCutMesh(surface,options):{mesh:surface,cutEdges:[] as [string,string][]};
 // These arrays are immutable within a solve; refinements replace them. Keep
 // lookup/index tables per array so small trial panels do not scan the body.
 const vertexTables=new WeakMap<Surface['vertices'],{points:Map<string,Surface['vertices'][number]>;order:Map<string,number>}>();
 const vertexTable=(vertices:Surface['vertices'])=>{let table=vertexTables.get(vertices);if(!table){table={points:new Map(vertices.map(v=>[v.id,v])),order:new Map(vertices.map((v,i)=>[v.id,i]))};vertexTables.set(vertices,table);}return table;};
 let sewingStage=false;
 const workerSolve=async(mesh:Surface,method:'lscm'|'arap'|'arap-balanced'|'arap-seamed'=sewingStage?'arap-seamed':options.method??'lscm',iterations=options.iterations??30,seed?:SurfaceRun['bindings'][number]['report']['uv'])=>{
  if(mesh.faces.length>UNWRAP_FACES)throw new DomainError('UNWRAP_LIMIT');
  // A domain solve needs only its own vertices, in the same relative order.
  // Re-sending the entire model for every small panel wastes parsing and IPC.
  const used=new Set(mesh.faces.flatMap(f=>f.vertices)),table=vertexTable(mesh.vertices),vertices=[...used].sort((a,b)=>table.order.get(a)!-table.order.get(b)!).map(id=>table.points.get(id)!);
  const input={protocolVersion:1,operation:'surface.unwrap',mesh:{vertices,faces:mesh.faces,repair_cuts:options.automaticCuts===true&&options.partitionStrategy!=='design',method,iterations,...(seed?{initial_uv:seed}:{})}},key=hash(JSON.stringify(input)),cached=nativeCache.get(key);
  if(cached){nativeStats.cacheHits++;if('error' in cached)throw cached.error;return cached;}
  const started=performance.now();nativeStats.calls++;
  try{const result=nativeSurfaceResponseSchema.parse(await session.request(input));const size=result.patches.reduce((n,p)=>n+p.uv.length,0);if(cachedVertices+size<100000&&nativeCache.size<4000){nativeCache.set(key,result);cachedVertices+=size;}return result;}
  catch(error){if(error instanceof DomainError&&['UNWRAP_OVERLAP','UNWRAP_FLIPPED','UNWRAP_NOT_CONVERGED','PATCH_NOT_DISK','PATCH_NEEDS_CUTS','NUMERICAL_FAILURE','ARAP_NOT_CONVERGED'].includes(error.code)&&nativeCache.size<4000)nativeCache.set(key,{error});throw error;}
  finally{const ms=performance.now()-started;nativeStats.elapsedMs+=ms;if(process.env.FPCAD_PROFILE_UNWRAP==='1'){const key=solvePhase+':'+method,row=nativeStats.groups[key]??={calls:0,ms:0,faces:0};row.calls++;row.ms+=ms;row.faces+=mesh.faces.length;nativeStats.slow.push({phase:solvePhase,method,faces:mesh.faces.length,ms});nativeStats.slow.sort((a,b)=>b.ms-a.ms);nativeStats.slow.length=Math.min(20,nativeStats.slow.length);}}
 };
 const planarHoles=new Map<string,string[][]>(),reportHoles=(report:SurfaceRun['bindings'][number]['report'])=>planarHoles.get([...report.faceIds].sort().join(':'))??[];
 const seamReasons=new Map<string,{ends:[string,string];reason:'topology'|'distortion'|'manufacturing'}>();
 const physical=(mesh:Surface)=>{const vv=vertexTable(mesh.vertices).points;return (id:string)=>{const v=vv.get(id)!;return [v.xMm,v.yMm,v.zMm].join(',');};};
 const rememberEdges=(mesh:Surface,edges:{a:string;b:string}[],reason:'topology'|'distortion'|'manufacturing')=>{const point=physical(mesh);for(const e of edges){const ends=[point(e.a),point(e.b)].sort() as [string,string],key=ends.join('|');if(!seamReasons.has(key))seamReasons.set(key,{ends,reason});}};
 const rememberPartition=(mesh:Surface,parts:Surface['faces'][],reason:'topology'|'distortion'|'manufacturing')=>{const owners=new Map(parts.flatMap((faces,i)=>faces.map(f=>[f.id,i] as const))),edges=new Map<string,{a:string;b:string;owners:number[]}>();for(const faces of parts)for(const f of faces)f.vertices.forEach((a,j)=>{const b=f.vertices[(j+1)%3],key=[a,b].sort().join(':'),e=edges.get(key)??{a,b,owners:[]};e.owners.push(owners.get(f.id)!);edges.set(key,e);});rememberEdges(mesh,[...edges.values()].filter(e=>e.owners.length===2&&e.owners[0]!==e.owners[1]),reason);};
 const qualityFailure=(report:Parameters<typeof designQualityFailure>[0]&{boundary?:string[]})=>!!(report.boundary&&report.boundary.length>2000)||designQualityFailure(report);
 const designCache=new Map<string,SurfaceRun['bindings'][number]['report'][]>(),cacheKey=(faces:Surface['faces'])=>faces.map(f=>f.id+':'+f.vertices.join(',')).sort().join('|');
 let previousCharts:{key:string;report:SurfaceRun['bindings'][number]['report']}[]=[];
 // Reserve section work for the whole input. A fixed global allowance was
 // exhausted by the first head/hand charts, forcing the later legs and tail
 // onto mesh-edge stair steps solely because of traversal order. Keep a
 // bounded budget proportional to the initial mesh, not to later refinements.
 const sectionBudget=Math.max(32,Math.min(256,Math.ceil(cut.mesh.faces.length/64)));
 const rejectedUnions=new Set<string>();let sectionAttempts=0;
 const solveDesign=async(mesh:Surface)=>{
  sewingStage=false;
  const result:SurfaceRun['bindings'][number]['report'][]=[],components=designComponents(mesh.faces),faceMap=new Map(mesh.faces.map(f=>[f.id,f]));
  const queue:{faces:Surface['faces'];depth:number;seed?:SurfaceRun['bindings'][number]['report']['uv']}[]=components.flatMap(faces=>{
   const ids=new Set(faces.map(f=>f.id));
   for(const cached of previousCharts){if(cached.report.faceIds.every(id=>ids.has(id))&&cacheKey(cached.report.faceIds.map(id=>faceMap.get(id)!))===cached.key){result.push(cached.report);cached.report.faceIds.forEach(id=>ids.delete(id));}}
   return designComponents(faces.filter(f=>ids.has(f.id))).map(faces=>({faces,depth:0}));
  });
  const drain=async()=>{while(queue.length){solvePhase=sewingStage?'sewing':'initial';if(result.length+queue.length>Math.min(2000,Math.max(64,(options.maxPieces??500)*4)))throw new DomainError('PATCH_LIMIT');const task=queue.pop()!,cached=designCache.get(cacheKey(task.faces));if(cached){result.push(...cached);continue;}const part={...mesh,faces:task.faces},planar=planarReports(part,true,vertexTable(part.vertices).points);let reports:SurfaceRun['bindings'][number]['report'][]=[],failure='';
   for(const [key,holes]of planar.holes)planarHoles.set(key,holes);
   // An injective measured chart that already meets every physical distortion
   // limit needs no iterative solve. Curved/overlapping charts still use ARAP.
   if(sewingStage)planar.reports=planar.reports.map(r=>measureBoundaryStrain(part,r,vertexTable(part.vertices).points)); const projected=planar.reports.length?undefined:projectedReport(part,vertexTable(part.vertices).points),projection=projected&&sewingStage?measureBoundaryStrain(part,projected,vertexTable(part.vertices).points):projected;
   try{reports=planar.reports.length?planar.reports:projection&&!qualityFailure(projection)?[projection]:(await workerSolve(part,undefined,undefined,task.seed)).patches.map(simplifyReportBoundary);if(reports.some(qualityFailure))failure='UNWRAP_DISTORTION';}catch(e){if(!(e instanceof DomainError)||!['UNWRAP_LIMIT','UNWRAP_OVERLAP','UNWRAP_FLIPPED','UNWRAP_NOT_CONVERGED','PATCH_NOT_DISK','PATCH_NEEDS_CUTS','NUMERICAL_FAILURE','ARAP_NOT_CONVERGED'].includes(e.code))throw e;failure=e.code;}
   if(!sewingStage&&failure==='UNWRAP_DISTORTION'&&options.method==='arap')try{const balanced=(await workerSolve(part,'arap-balanced',100,reports.length===1?reports[0].uv:undefined)).patches.map(simplifyReportBoundary);if(balanced.every(r=>!qualityFailure(r))){reports=balanced;failure='';}}catch(e){if(!(e instanceof DomainError)||!['UNWRAP_OVERLAP','UNWRAP_FLIPPED','UNWRAP_NOT_CONVERGED','PATCH_NOT_DISK','PATCH_NEEDS_CUTS','NUMERICAL_FAILURE','ARAP_NOT_CONVERGED'].includes(e.code))throw e;}
   parentPort?.postMessage({kind:'progress',value:{stage:'unwrap',completed:result.reduce((n,r)=>n+r.faceIds.length,0),total:mesh.faces.length}});
   if(!failure){designCache.set(cacheKey(task.faces),reports);result.push(...reports);continue;}
   if(!options.automaticCuts)throw new DomainError(failure);
   // Try an opening dart before making independent panels. Keep it only when
   // the measured result passes the same quality limits.
    // Trial darts stay local. Failed slits must not survive into child charts:
   // pinched boundaries would force repeated subdivision into tiny panels.
   const dartVertices=new Set(part.faces.flatMap(f=>f.vertices)),dartTable=vertexTable(part.vertices);
   let dartPart={...part,vertices:[...dartVertices].sort((a,b)=>dartTable.order.get(a)!-dartTable.order.get(b)!).map(id=>dartTable.points.get(id)!)},dartReports=reports;
   const areaByFace=new Map(part.faces.map(f=>{const [a,b,c]=f.vertices.map(id=>vertexTable(part.vertices).points.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm];return[f.id,Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2];}));
   const dartQuality=(rows:typeof reports)=>{
    const faces=rows.flatMap(r=>r.faceDistortion??[]);
    if(faces.length!==part.faces.length||new Set(faces.map(f=>f.faceId)).size!==part.faces.length||faces.some(f=>!areaByFace.has(f.faceId)))return;
    let worst=0,excess=0,badArea=0;
    for(const f of faces){const ratio=Math.max(f.areaError/.15,f.edgeError/.1,f.distortion/.15),area=areaByFace.get(f.faceId)!;worst=Math.max(worst,ratio);excess+=Math.max(0,ratio-1)*area;if(ratio>1)badArea+=area;}
    return[worst,excess,badArea];
   };
   let bestDartQuality=dartQuality(reports),stalledDarts=0;
   const trialEdges:{mesh:Surface;edges:{a:string;b:string}[]}[]=[];
   let acceptedDart=false;
   // Tessellation density must not decide whether a panel gets a dart.
   // Use a bounded search on the complete chart before introducing a section.
   const dartStarted=performance.now();
   for(let trial=0;trial<4&&performance.now()-dartStarted<12000;trial++){solvePhase='dart';
    const failingFaces=dartReports.flatMap(r=>r.faceDistortion??[]).filter(d=>qualityFailure({areaErrorMax:d.areaError,edgeErrorMax:d.edgeError,distortionMax:d.distortion})).map(d=>d.faceId);
    const dart=necessaryTopologyCuts(dartPart,[failingFaces.length?failingFaces:dartPart.faces.map(f=>f.id)]);
    if(!dart.edges.length)break;
    const opened=openDesignSeams({...dartPart,cutConstraints:dart.edges.map(e=>({...e,locked:true}))},randomUUID);
    trialEdges.push({mesh:dartPart,edges:dart.edges});dartPart=opened;
    try{
     dartReports=(await workerSolve(opened)).patches.map(simplifyReportBoundary);
     const ordinaryQuality=dartQuality(dartReports);
     if(!sewingStage&&dartReports.some(qualityFailure)&&options.method==='arap')try{dartReports=(await workerSolve(opened,'arap-balanced',100,dartReports.length===1?dartReports[0].uv:undefined)).patches.map(simplifyReportBoundary);}catch(e){if(!(e instanceof DomainError)||!['UNWRAP_OVERLAP','UNWRAP_FLIPPED','UNWRAP_NOT_CONVERGED','PATCH_NOT_DISK','PATCH_NEEDS_CUTS','NUMERICAL_FAILURE','ARAP_NOT_CONVERGED'].includes(e.code))throw e;}
     if(dartReports.some(qualityFailure)){
      // Equal curvature peaks can keep the maximum unchanged while one
      // opening relieves a different part of the panel. Stop only when two
      // complete reports improve neither peak strain nor excess strain area
      // nor the physical area still outside the manufacturing limits.
      const balancedQuality=dartQuality(dartReports),score=ordinaryQuality&&balancedQuality?ordinaryQuality.map((n,i)=>Math.min(n,balancedQuality[i])):ordinaryQuality??balancedQuality;
      stalledDarts=score&&bestDartQuality&&!score.some((n,i)=>n<bestDartQuality![i]*(1-1e-3))?stalledDarts+1:0;
      bestDartQuality=score&&bestDartQuality?score.map((n,i)=>Math.min(n,bestDartQuality![i])):score;
      if(stalledDarts>=2)break;
      continue;
     }
     const replacements=new Map(opened.faces.map(f=>[f.id,f])),existingVertices=vertexTable(mesh.vertices).points;mesh.faces=mesh.faces.map(f=>replacements.get(f.id)??f);mesh.vertices=[...mesh.vertices,...opened.vertices.filter(v=>!existingVertices.has(v.id))];surface.faces=mesh.faces;surface.vertices=mesh.vertices;
     for(const trial of trialEdges)rememberEdges(trial.mesh,trial.edges,failure==='UNWRAP_DISTORTION'?'distortion':'topology');
     designCache.set(cacheKey(opened.faces),dartReports);result.push(...dartReports);acceptedDart=true;break;
    }catch(e){if(!(e instanceof DomainError)||!['UNWRAP_OVERLAP','UNWRAP_FLIPPED','UNWRAP_NOT_CONVERGED','PATCH_NOT_DISK','PATCH_NEEDS_CUTS','NUMERICAL_FAILURE','ARAP_NOT_CONVERGED'].includes(e.code))throw e;dartReports=[];}
   }
   if(acceptedDart)continue;
   if(task.depth>=32)throw new DomainError(failure);
   // Prefer a physical section through triangle interiors. It is a local
   // proposal until its triangulation quality and complete provenance pass.
   // Sewing calibration must use the same interior sections: reverting to
   // mesh-edge partitions here reintroduced stair-step seams after preview.
   let section=refinedSurface&&task.faces.length>=20&&task.depth<12&&sectionAttempts++<sectionBudget?sectionDesignDomain(mesh,task.faces,randomUUID):undefined;
   if(section&&refinedSurface!(section.surface,section.children)===false)section=undefined;
   let children:Surface['faces'][];
   if(section){
    const remap=(faces:Surface['faces'])=>faces.flatMap(f=>section.children.get(f.id)?.map(c=>c.face)??[f]);
    const oldFaces=new Map(mesh.faces.map(f=>[f.id,f]));
    for(const pending of queue){if(pending.faces.some(f=>section.children.has(f.id)))pending.seed=undefined;pending.faces=remap(pending.faces);}
    // A section touching an earlier chart refines its shared edge as well.
    // Re-solve that chart; never retain a report for deleted face identities.
    for(let i=result.length-1;i>=0;i--)if(result[i].faceIds.some(id=>section.children.has(id))){const report=result.splice(i,1)[0];queue.push({faces:remap(report.faceIds.map(id=>oldFaces.get(id)!)),depth:0});}

    mesh.faces=section.surface.faces;mesh.vertices=section.surface.vertices;mesh.cutConstraints=section.surface.cutConstraints;
    surface.faces=mesh.faces;surface.vertices=mesh.vertices;surface.cutConstraints=mesh.cutConstraints;
    children=section.parts;
   }else children=splitDesignDomain(mesh,task.faces);
   rememberPartition(mesh,children,failure==='UNWRAP_DISTORTION'?'distortion':'topology');
   if(children.length<2)throw new DomainError(failure);queue.push(...children.map(faces=>({faces,depth:task.depth+1})));
  }};
  await drain();
  solvePhase='merge';const mergeStarted=performance.now(),merged=await mergeDesignCharts(mesh,result,async faces=>{
   const part={...mesh,faces},flat=planarReports(part,true,vertexTable(part.vertices).points);
   for(const [key,holes]of flat.holes)planarHoles.set(key,holes);
   if(flat.reports.length===1)return flat.reports[0];
   const projection=projectedReport(part,vertexTable(part.vertices).points);if(projection&&!qualityFailure(projection))return projection;
   try{const reports=(await workerSolve(part)).patches.map(simplifyReportBoundary);return reports.length===1&&!qualityFailure(reports[0])?reports[0]:undefined;}
   catch(e){if(!(e instanceof DomainError)||!['UNWRAP_OVERLAP','UNWRAP_FLIPPED','UNWRAP_NOT_CONVERGED','PATCH_NOT_DISK','PATCH_NEEDS_CUTS','NUMERICAL_FAILURE','ARAP_NOT_CONVERGED'].includes(e.code))throw e;}
  // Coalescing gets its own bounded budget after partitioning, reserving time for
  // strict seam calibration, material remapping and acceptance validation.
  // Reaching this budget keeps already solved charts; no quality check skips.
  },rejectedUnions,()=>performance.now()-mergeStarted<30000);result.splice(0,result.length,...merged);
  sewingStage=true;designCache.clear();
  const sewingFaces=new Map(mesh.faces.map(f=>[f.id,f]));
  for(let i=result.length-1;i>=0;i--){const report=result[i];if(report.seamErrorMax!==undefined&&!qualityFailure(report))continue;result.splice(i,1);queue.push({faces:report.faceIds.map(id=>sewingFaces.get(id)!),depth:0,seed:report.uv});}
  await drain();
  // Sewing calibration can introduce new subdivisions. Coalesce those final
  // charts using the sewing solver too, so an earlier failed ARAP union cannot
  // permanently keep a now-redundant manufacturing seam.
  solvePhase='sewing-merge';const finalMergeStarted=performance.now();
  const solveSewnUnion=async(faces:Surface['faces'])=>{
   const part={...mesh,faces},projection=projectedReport(part,vertexTable(part.vertices).points);
   if(projection){const measured=measureBoundaryStrain(part,projection,vertexTable(part.vertices).points);if(!qualityFailure(measured))return measured;}
   try{const reports=(await workerSolve(part,'arap-seamed',100)).patches.map(simplifyReportBoundary);return reports.length===1&&!qualityFailure(reports[0])?reports[0]:undefined;}
   catch(e){if(!(e instanceof DomainError)||!['UNWRAP_OVERLAP','UNWRAP_FLIPPED','UNWRAP_NOT_CONVERGED','PATCH_NOT_DISK','PATCH_NEEDS_CUTS','NUMERICAL_FAILURE','ARAP_NOT_CONVERGED'].includes(e.code))throw e;return undefined;}
  };
  const sewingRejected=new Set<string>();
  const sewn=await mergeDesignCharts(mesh,result,solveSewnUnion,sewingRejected,()=>performance.now()-finalMergeStarted<30000);
  result.splice(0,result.length,...sewn);
  // A low-distortion disk may still have an almost severed cloth connection.
  // Split that short chord and recheck every child with the sewing solver.
  // Merging applies the same neck guard, so subsequent repair passes cannot
  // silently reconstruct the unsuitable hinge.
  let openedNeck=false;
  for(let i=0;i<result.length;i++){
   const report=result[i],parts=narrowPanelSplit(mesh,report);if(!parts)continue;
   const replacements:typeof result=[];
   for(const faces of parts){const part={...mesh,faces},used=new Set(faces.flatMap(f=>f.vertices));const reports=(await workerSolve(part,'arap-seamed',100,report.uv.filter(p=>used.has(p.vertexId)))).patches.map(simplifyReportBoundary);if(reports.some(qualityFailure))throw new DomainError('UNWRAP_DISTORTION');replacements.push(...reports);}
   rememberPartition(mesh,parts,'manufacturing');result.splice(i,1,...replacements);openedNeck=true;i--;
  }
  // A small lobe can join another neighbour across a wide seam after its
  // unsuitable hinge is opened. Reuse rejected unions and the same time
  // budget; the neck guard prevents recreating that hinge.
  if(openedNeck){const repaired=await mergeDesignCharts(mesh,result,solveSewnUnion,sewingRejected,()=>performance.now()-finalMergeStarted<30000);result.splice(0,result.length,...repaired);}
  const solvedFaces=new Map(mesh.faces.map(f=>[f.id,f]));previousCharts=result.map(report=>({key:cacheKey(report.faceIds.map(id=>solvedFaces.get(id)!)),report}));
  // Manufacturing repair changes only the failing panels. Keep the solved
  // decomposition of each untouched material component, including its darts,
  // instead of repeating the same failed parent charts on every repair pass.
  const finalFaces=new Map(mesh.faces.map(f=>[f.id,f]));for(const component of components){if(component.some(f=>!finalFaces.has(f.id)))continue;const ids=new Set(component.map(f=>f.id)),reports=result.filter(r=>r.faceIds.every(id=>ids.has(id)));if(reports.reduce((sum,r)=>sum+r.faceIds.length,0)===ids.size)designCache.set(cacheKey(component.map(f=>finalFaces.get(f.id)!)),reports);}
  return {ok:true as const,protocolVersion:1 as const,patches:result};
 };
 const solve=async(mesh:Surface)=>{if(options.partitionStrategy==='design')return solveDesign(mesh);try{const solved=await workerSolve(mesh);return {...solved,patches:solved.patches.map(simplifyReportBoundary)};}catch(error){if(!(error instanceof DomainError)||!['NUMERICAL_FAILURE','ARAP_NOT_CONVERGED'].includes(error.code))throw error;const planar=planarReports(mesh);if(!planar.reports.length)throw error;const rest=planar.remaining.length?(await workerSolve({...mesh,faces:planar.remaining})).patches:[];return {ok:true as const,protocolVersion:1 as const,patches:[...planar.reports,...rest]};}};

 let response=await solve(cut.mesh);const maxPieces=options.maxPieces??500;if(response.patches.length>maxPieces)throw new DomainError('PATCH_LIMIT');
 const vv=new Map(surface.vertices.map(v=>[v.id,v]));
 const cost=(r:typeof response)=>{const vertices=new Map(surface.vertices.map(v=>[v.id,v])),areas=new Map(surface.faces.map(f=>[f.id,numericalTriangleArea(f.vertices.map(id=>{const v=vertices.get(id)!;return [v.xMm,v.yMm,v.zMm];}))??0]));let total=0,error=0;for(const patch of r.patches){const a=patch.faceIds.reduce((s,id)=>s+areas.get(id)!,0);total+=a;error+=a*patch.distortionMean;}return .85*error/total+.15*r.patches.length/maxPieces;};
 const initialCost=cost(response);let trials=0,passes=0;
 if(options.automaticCuts&&options.optimizeCuts)for(let pass=0;pass<(options.searchPasses??3);pass++){
 const worst=response.patches.filter(p=>p.status==='needsReview'&&p.faceIds.length>2).sort((a,b)=>b.distortionMean-a.distortionMean)[0];if(!worst)break;
 const selected=new Set(worst.faceIds),centroids=surface.faces.filter(f=>selected.has(f.id)).map(f=>({id:f.id,c:[0,1,2].map(axis=>f.vertices.reduce((s,id)=>s+[vv.get(id)!.xMm,vv.get(id)!.yMm,vv.get(id)!.zMm][axis],0)/3)}));
 const ranges=[0,1,2].map(axis=>Math.max(...centroids.map(p=>p.c[axis]))-Math.min(...centroids.map(p=>p.c[axis]))),axis=ranges.indexOf(Math.max(...ranges));centroids.sort((a,b)=>a.c[axis]-b.c[axis]||a.id.localeCompare(b.id));const left=new Set(centroids.slice(0,Math.ceil(centroids.length/2)).map(c=>c.id));
 const proposed={...cut.mesh,faces:cut.mesh.faces.map(f=>selected.has(f.id)?{...f,region:f.region+(left.has(f.id)?'-a':'-b')}:f)};trials++;
 try{const candidate=automaticCutMesh(proposed,options),next=await solve(candidate.mesh);if(next.patches.length<=maxPieces&&cost(next)<=cost(response)-.001){cut=candidate;response=next;passes++;}else break;}catch(e){if(!(e instanceof DomainError)||!['UNWRAP_OVERLAP','UNWRAP_FLIPPED','UNWRAP_NOT_CONVERGED','PATCH_NOT_DISK','PATCH_NEEDS_CUTS','NUMERICAL_FAILURE','ARAP_NOT_CONVERGED'].includes(e.code))throw e;break;}
 }
 // A disk can still create an invalid seam allowance. Bounded repair cuts test the actual 10 mm manufacturing contour.
 const optimizedCost=cost(response);let repairPasses=0,manufacturingSeams=0;
 if(options.automaticCuts||options.partitionStrategy==='design'&&options.colorBoundaryCuts)for(let pass=0;pass<6;pass++){
 const probes:Piece[]=response.patches.map((report,i)=>{const uv=new Map(report.uv.map(v=>[v.vertexId,v])),node=(id:string)=>({id:randomUUID(),xMm:uv.get(id)!.xMm,yMm:uv.get(id)!.yMm});return {id:randomUUID(),name:'Probe '+i,nodes:report.boundary.map(node),holes:reportHoles(report).map(r=>r.map(node)),closed:true,allowanceMm:project.defaultAllowanceMm??10,allowanceSource:'project',join:'round',cutQty:1,mirror:false,material:'毛皮',furRad:0,color:'#73c9b6'};});
 if(options.partitionStrategy==='design'&&options.colorBoundaryCuts)for(const p of probes){const outline=designManufacturingOutline({outer:p.nodes.map(n=>[n.xMm,n.yMm]),holes:(p.holes??[]).map(r=>r.map(n=>[n.xMm,n.yMm]))}),node=([xMm,yMm]:[number,number])=>({id:randomUUID(),xMm,yMm});p.nodes=outline.outer.map(node);p.holes=outline.holes.map(r=>r.map(node));}
 const geometry=await analyze(worker,{...project,pieces:probes},signal,session),failed=new Set(geometry.filter(g=>g.issues.some(i=>i.severity==='error')).map(g=>g.id));if(!failed.size)break;
 const assigned=new Map<string,string>();for(let i=0;i<probes.length;i++){if(!failed.has(probes[i].id))continue;const report=response.patches[i];if(report.faceIds.length<2)throw new DomainError('INVALID_GEOMETRY');const selected=new Set(report.faceIds),selectedFaces=surface.faces.filter(f=>selected.has(f.id));let children:Surface['faces'][];if(options.partitionStrategy==='design')children=splitDesignDomain(surface,selectedFaces);else{const vertices=new Map(surface.vertices.map(v=>[v.id,v])),centres=selectedFaces.map(face=>({face,p:[0,1,2].map(axis=>face.vertices.reduce((sum,id)=>{const v=vertices.get(id)!;return sum+[v.xMm,v.yMm,v.zMm][axis];},0)/3)})),axis=[0,1,2].sort((a,b)=>(Math.max(...centres.map(c=>c.p[b]))-Math.min(...centres.map(c=>c.p[b])))-(Math.max(...centres.map(c=>c.p[a]))-Math.min(...centres.map(c=>c.p[a]))))[0],sorted=centres.sort((a,b)=>a.p[axis]-b.p[axis]),middle=Math.ceil(sorted.length/2);children=[sorted.slice(0,middle).map(c=>c.face),sorted.slice(middle).map(c=>c.face)];}if(children.length<2)throw new DomainError('INVALID_GEOMETRY');children.forEach((faces,j)=>faces.forEach(f=>assigned.set(f.id,'repair-'+pass+'-'+i+'-'+j)));}
 rememberPartition(surface,designComponents(surface.faces.map(f=>({...f,region:assigned.get(f.id)??f.region}))), 'manufacturing');manufacturingSeams+=failed.size;cut=automaticCutMesh({...cut.mesh,faces:cut.mesh.faces.map(f=>({...f,region:assigned.get(f.id)??f.region}))},options);response=await solve(cut.mesh);if(response.patches.length>maxPieces)throw new DomainError('PATCH_LIMIT');repairPasses++;
 }
 const owners=new Map(response.patches.flatMap((p,i)=>p.faceIds.map(id=>[id,i] as const))),edges=new Map<string,{ids:[string,string];owners:number[]}>();for(const f of surface.faces)f.vertices.forEach((a,i)=>{const b=f.vertices[(i+1)%3],ids=[a,b].sort() as [string,string],key=ids.join(':');const edge=edges.get(key)??{ids,owners:[]};edge.owners.push(owners.get(f.id)!);edges.set(key,edge);});cut.cutEdges=[...edges.values()].filter(e=>e.owners.length===2&&e.owners[0]!==e.owners[1]).map(e=>e.ids);
 const optimization={passes,trials,repairPasses,optimizedCost,initialCost,finalCost:cost(response),improved:passes>0};

 const pieces:Piece[]=[],bindings:SurfaceRun['bindings']=[];
 const originX=project.pieces.length?pointBounds(project.pieces.flatMap(p=>p.nodes)).maxX+50:0;
 const extents=response.patches.map(report=>{const uv=new Map(report.uv.map(v=>[v.vertexId,v])),nodes=report.boundary.map(id=>uv.get(id)!);const minX=Math.min(...nodes.map(n=>n.xMm)),maxX=Math.max(...nodes.map(n=>n.xMm)),minY=Math.min(...nodes.map(n=>n.yMm)),maxY=Math.max(...nodes.map(n=>n.yMm));return {minX,minY,w:maxX-minX,h:maxY-minY};});
 const rowWidth=Math.max(...extents.map(b=>b.w+50),Math.sqrt(extents.reduce((sum,b)=>sum+(b.w+50)*(b.h+50),0)));let cursorX=0,cursorY=0,rowHeight=0;
 const surfaceHash=hash(JSON.stringify(sourceSurface)),meshVertices=new Map(surface.vertices.map(v=>[v.id,v]));
 for(const [i,report] of response.patches.entries()){
  const box=extents[i];if(cursorX>0&&cursorX+box.w+50>rowWidth){cursorX=0;cursorY+=rowHeight+50;rowHeight=0;}
  const tx=Math.round(originX+cursorX-box.minX),ty=Math.round(cursorY-box.minY);report.uv=report.uv.map(v=>({...v,xMm:v.xMm+tx,yMm:v.yMm+ty}));
  const uv=new Map(report.uv.map(v=>[v.vertexId,v]));
  let furX=0,furY=0;
  const reportFaces=new Set(report.faceIds);for(const face of surface.faces.filter(f=>reportFaces.has(f.id))){
   const [a,b,c]=face.vertices.map(id=>meshVertices.get(id)!);const [ua,ub,uc]=face.vertices.map(id=>uv.get(id)!);const e1=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],e2=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm],dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0),aa=dot(e1,e1),ab=dot(e1,e2),bb=dot(e2,e2),den=aa*bb-ab*ab;
   const alpha=(bb*e1[1]-ab*e2[1])/den,beta=(aa*e2[1]-ab*e1[1])/den;const x=alpha*(ub.xMm-ua.xMm)+beta*(uc.xMm-ua.xMm),y=alpha*(ub.yMm-ua.yMm)+beta*(uc.yMm-ua.yMm),length=Math.hypot(x,y);if(length>1e-8){const area=Math.sqrt(den)/2;furX+=area*x/length;furY+=area*y/length;}
  }
  const piece:Piece={id:randomUUID(),name:surface.template?`${surface.faces.find(f=>f.id===report.faceIds[0])?.region??'Surface'} / ${i+1}`:`Surface ${i+1}`,nodes:report.boundary.map(id=>{const v=uv.get(id);if(!v)throw new DomainError('WORKER_PROTOCOL');return {id:randomUUID(),xMm:v.xMm,yMm:v.yMm};}),closed:true,allowanceMm:project.defaultAllowanceMm??10,allowanceSource:'project',join:'round',cutQty:1,mirror:false,material:'毛皮',furRad:Math.hypot(furX,furY)>1e-8?Math.atan2(furY,furX):Math.PI/2,color:['#73c9b6','#a9b7da','#d5b483','#ca9cbb'][i%4]};
  if(reportHoles(report).length)piece.holes=reportHoles(report).map(r=>r.map(id=>({id:randomUUID(),xMm:uv.get(id)!.xMm,yMm:uv.get(id)!.yMm})));
  if(options.partitionStrategy==='design'&&options.colorBoundaryCuts){const outline=designManufacturingOutline({outer:piece.nodes.map(n=>[n.xMm,n.yMm]),holes:(piece.holes??[]).map(r=>r.map(n=>[n.xMm,n.yMm]))}),node=([xMm,yMm]:[number,number])=>({id:randomUUID(),xMm,yMm});piece.nodes=outline.outer.map(node);piece.holes=outline.holes.map(r=>r.map(node));report.boundaryToleranceMm=Math.max(report.boundaryToleranceMm??0,1e-6);}
  cursorX+=box.w+50;rowHeight=Math.max(rowHeight,box.h);
  pieces.push(piece);bindings.push({pieceId:piece.id,surfaceId:surface.id,topologyVersion:surface.topologyVersion,geometryHash:pieceGeometryHash(piece),surfaceHash,report});
 }
 if(project.pieces.length+pieces.length>500)throw new DomainError('RESOURCE_LIMIT');const geometry=await analyze(worker,{...project,pieces},signal,session);if(geometry.some(g=>g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');
 const finalOwners=new Map(response.patches.flatMap((p,i)=>p.faceIds.map(id=>[id,i] as const))),point=physical(surface),physicalEdges=new Map<string,{owner:number;ids:string}[]>();for(const f of surface.faces)f.vertices.forEach((a,j)=>{const key=[point(a),point(f.vertices[(j+1)%3])].sort().join('|'),list=physicalEdges.get(key)??[];list.push({owner:finalOwners.get(f.id)!,ids:[a,f.vertices[(j+1)%3]].sort().join(':')});physicalEdges.set(key,list);});const finalSeams=[...seamReasons].filter(([key])=>{const owners=physicalEdges.get(key);return owners?.length===2&&(owners[0].owner!==owners[1].owner||owners[0].ids!==owners[1].ids);}).map(([,edge])=>edge);
 solvedSurface?.(surface);
 const counted=(reason:'topology'|'distortion'|'manufacturing')=>seamPathCount(finalSeams.filter(e=>e.reason===reason).map(e=>e.ends));
 return surfaceRunSchema.parse({...(options.partitionStrategy==='design'?{designCutReport:{materialDomains:0,userSeams:0,topologySeams:counted('topology'),distortionSeams:counted('distortion'),manufacturingSeams:counted('manufacturing')}}:{}),sourceHash:hash(JSON.stringify(sourceSurface)),scope:sourceSurface.cutScope,algorithm:options.partitionStrategy==='design'?'lscm-arap-seamed-1':options.method==='arap'?'lscm-arap-1':'lscm-cg-1',options,optimization,cutEdges:cut.cutEdges,pieces,bindings,accepted:false});
 }finally{await session.dispose();if(process.env.FPCAD_PROFILE_UNWRAP==='1')parentPort?.postMessage({kind:'profile',value:nativeStats});}
}
