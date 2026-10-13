import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function testedArtifacts(executable,appDirectory){
 const applicationDirectory=executable?resolve(dirname(resolve(executable)),'resources/app'):resolve(appDirectory??'.');
 const paths={main:resolve(applicationDirectory,'dist/main/main.cjs'),surfaceWorker:resolve(applicationDirectory,'dist/main/surface-worker.cjs'),nativeWorker:resolve(applicationDirectory,'dist/bin',process.platform==='win32'?'fpcad-worker.exe':'fpcad-worker')};
 const artifacts={applicationDirectory};for(const [name,path]of Object.entries(paths)){const bytes=await readFile(path);artifacts[name]={path,sha256:sha256(bytes),bytes:bytes.length};}return artifacts;
}
export async function auditRuntime(directory){
 const runtime=resolve(directory,'real-input-audit.mjs');
 await build({stdin:{contents:"export {placementMatchesModel} from './packages/reference/placement-review';export {speciesDefaults} from './packages/body/defaults';export {illustrationRegions} from './packages/reference/illustration';export {traceMask} from './apps/desktop/main/reference-segmentation';export {contourBoundaryError,safeContour} from './packages/reference/contour-topology';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:runtime});
 return import(pathToFileURL(runtime));
}
export async function auditMappedProject(project,{worker,helpers,imagePath,crops,diamond}){
 assert(project.surface?.faces.length>0&&project.surface.vertices.length>0,'A real model must exist');
 assert.equal(project.references.length,2);assert.equal(new Set(project.references.map(r=>r.view)).size,2);
 const pieces=project.patternLibrary.map(r=>r.piece),sourceIds=new Set(pieces.map(p=>p.id)),faceIds=new Set(project.surface.faces.map(f=>f.id));
 assert.equal(sourceIds.size,pieces.length);
 const geometry=[];
 for(let i=0;i<pieces.length;i+=30){
  const process=spawnSync(worker,[],{windowsHide:true,input:JSON.stringify({protocolVersion:1,pieces:pieces.slice(i,i+30)}),maxBuffer:32*1024*1024});
  assert.equal(process.status,0,process.stderr?.toString());const response=JSON.parse(process.stdout.toString());assert(response.ok,JSON.stringify(response));geometry.push(...response.geometry);
 }
 assert.equal(geometry.length,pieces.length);assert.deepEqual(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error')),[],'Every saved source must remain native-valid');
 const references=[],detail=[];let rawPixels=0,maxAreaRelativeError=0,diamondCheck;
 for(const ref of project.references){
  const png=Buffer.from(ref.png.split(',')[1],'base64');assert.equal(sha256(png),ref.resources.source.sha256);
  assert.equal(ref.resources.source.data,ref.png);
  const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const source=await sharp(imagePath).extract(crops[ref.view]).ensureAlpha().raw().toBuffer();assert(data.equals(source),'Stored cropped pixels must match the original input exactly');
  assert.equal(info.width,ref.width);assert.equal(info.height,ref.height);
  const detected=helpers.illustrationRegions(ref.width,ref.height,new Uint8Array(data)),library=project.patternLibrary.filter(s=>s.referenceId===ref.id);
  assert.equal(detected.regions.length,library.length,'Saved sources must retain every detected original connected component');
  const c=ref.calibration,pixelMm=c.distanceMm/Math.hypot(c.b.x-c.a.x,c.b.y-c.a.y);
  for(const [i,r]of detected.regions.entries()){
   const saved=library[i];assert.equal(saved.view,ref.view);assert.equal(saved.piece.color,r.color);const native=geometry.find(g=>g.id===saved.piece.id);
   const expected=r.indices.length*pixelMm**2,error=Math.abs(native.areaMm2-expected),relative=error/expected;assert(error<=Math.max(pixelMm**2*1.5,expected*.031),'Actual material area must follow original pixels: '+saved.piece.name);maxAreaRelativeError=Math.max(maxAreaRelativeError,relative);rawPixels+=r.indices.length;
   let minX=ref.width,minY=ref.height,maxX=0,maxY=0;for(const j of r.indices){minX=Math.min(minX,j%ref.width);maxX=Math.max(maxX,j%ref.width);minY=Math.min(minY,Math.floor(j/ref.width));maxY=Math.max(maxY,Math.floor(j/ref.width));}
   const w=maxX-minX+1,h=maxY-minY+1,mask=new Uint8Array(w*h);for(const j of r.indices)mask[(Math.floor(j/ref.width)-minY)*w+j%ref.width-minX]=1;
   const local={...c,a:{x:c.a.x-minX,y:c.a.y-minY},b:{x:c.b.x-minX,y:c.b.y-minY}},raw=helpers.traceMask(w,h,mask,local,w,h,r.color,true).piece;
   assert.equal(saved.piece.holes?.length??0,raw.holes?.length??0,'Real source holes must remain complete: '+saved.piece.name);
   const points=[...saved.piece.nodes,...(saved.piece.holes??[]).flat()];assert(points.length<=2000);assert(points.every(p=>Number.isFinite(p.xMm)&&Number.isFinite(p.yMm)));assert.equal(new Set(points.map(p=>p.id)).size,points.length);
   if(diamond&&ref.view===diamond.view&&r.indices.includes(diamond.y*ref.width+diamond.x)){
    assert.equal(r.indices.length,1813,'This is the actual blue diamond, not a substitute polygon');assert(saved.piece.nodes.length<=12);assert.equal(saved.piece.curves?.length??0,0,'Real straight diamond edges must not become bowed Beziers');
    const errorPx=helpers.contourBoundaryError(saved.piece,raw,pixelMm*.05,pixelMm*1.05)/pixelMm;assert(errorPx<=1.05);assert(helpers.safeContour(saved.piece,raw,pixelMm*.8));diamondCheck={sourcePieceId:saved.piece.id,pixels:r.indices.length,nodes:saved.piece.nodes.length,curves:0,bidirectionalBoundaryErrorPx:errorPx};
   }
   detail.push({sourcePieceId:saved.piece.id,view:saved.view,name:saved.piece.name,color:r.color,pixels:r.indices.length,nodes:saved.piece.nodes.length,holes:saved.piece.holes?.length??0,curves:saved.piece.curves?.length??0,areaMm2:native.areaMm2,areaRelativeError:relative});
  }
  references.push({view:ref.view,width:ref.width,height:ref.height,sha256:sha256(png),regions:library.length,foregroundPixels:ref.illustration.foregroundPixels,calibration:ref.calibration});
 }
 if(diamond)assert(diamondCheck,'Actual blue diamond must exist as one saved source');
 for(const m of project.markings){
  assert(sourceIds.has(m.sourcePieceId));const source=pieces.find(p=>p.id===m.sourcePieceId);assert.equal(m.sourceHash,sha256(JSON.stringify({nodes:source.nodes,holes:source.holes??[],curves:source.curves??[]})));
  assert.equal(m.surfaceHash,sha256(JSON.stringify(project.surface)));assert.equal(m.surfaceId,project.surface.id);assert.equal(m.topologyVersion,project.surface.topologyVersion);assert(helpers.placementMatchesModel(project,m),'Saved registration fingerprint and target part must match: '+m.name);
  assert(m.fragments.length>0);for(const f of m.fragments){assert(faceIds.has(f.faceId));assert(f.rings.length>0);for(const ring of f.rings){assert(ring.length>=3);for(const b of ring){assert(b.every(Number.isFinite));assert(Math.abs(b.reduce((s,v)=>s+v,0)-1)<1e-6);assert(b.every(v=>v>=-1e-7&&v<=1+1e-7));}}}
 }
 const views=['front','back'].map(view=>{const m=project.markings.filter(m=>m.view===view);assert(m.length>0,'Both actual image views must attach real material');assert(m.some(m=>m.placement?.part==='body'),'Both views must include a real torso attachment');return {view,markings:m.length,fragmentFaces:m.reduce((n,m)=>n+m.fragments.length,0),sourceCount:new Set(m.map(m=>m.sourcePieceId)).size};});
 return {name:project.name,sources:pieces.length,markings:project.markings.length,sourceHoles:pieces.reduce((n,p)=>n+(p.holes?.length??0),0),rawPixels,maxAreaRelativeError,references,views,diamond:diamondCheck,sourcesDetail:detail,sourceGeometrySha256:sha256(JSON.stringify(project.patternLibrary.map(r=>({id:r.piece.id,referenceId:r.referenceId,view:r.view,nodes:r.piece.nodes,holes:r.piece.holes??[],curves:r.piece.curves??[],anatomy:r.anatomy}))))};
}
export async function recordLatestInput(name,entry){
 await mkdir('test-results',{recursive:true});let manifest={recordedAt:new Date().toISOString(),inputs:{}};try{manifest=JSON.parse(await readFile('test-results/latest-real-inputs.json','utf8'));}catch{}
 manifest.recordedAt=new Date().toISOString();manifest.inputs[name]=entry;await writeFile('test-results/latest-real-inputs.json',JSON.stringify(manifest,null,2)+'\n');
}
