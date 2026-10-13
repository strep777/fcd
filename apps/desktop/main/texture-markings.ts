import UPNG from '@pdf-lib/upng';
import {randomUUID} from 'node:crypto';
import {derivedName} from '../../../packages/schema/names';
import {markingSchema,type Project,type Marking} from '../../../packages/schema/index';
import {clip,weights,area,positive,type XY} from './markings';
import {segmentPixels} from './reference-segmentation';
import {bindingIssues,pieceGeometryHash} from './surface';
import {DomainError,hash} from './repository';
import {UNWRAP_FACES} from '../../../packages/surface/limits';
const codec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG;
/** UV coordinates belong to face corners, so welds and UV islands cannot lose texture seams. */
export async function textureMarking(worker:string,project:Project,textureId:string,seed:{x:number;y:number},tolerance:number):Promise<Marking>{
 const mesh=project.surface,texture=mesh?.textures?.find(t=>t.id===textureId);if(!mesh||!texture||!project.bindings?.length)throw new DomainError('SURFACE_MISSING');if(mesh.faces.length>UNWRAP_FACES)throw new DomainError('PROJECTION_LIMIT');if(bindingIssues(project).some(i=>i.severity==='error'))throw new DomainError('STALE_BINDING');
 const image=codec.decode(Uint8Array.from(Buffer.from(texture.proxy.png.split(',')[1],'base64')).buffer),rgba=new Uint8Array(codec.toRGBA8(image)[0]);
 if(image.width!==texture.proxy.width||image.height!==texture.proxy.height)throw new DomainError('IMAGE_RESOURCE_MISMATCH');
 const region=segmentPixels(image.width,image.height,rgba,{x:seed.x/texture.width,y:seed.y/texture.height},tolerance,{a:{x:0,y:0},b:{x:0,y:-1},distanceMm:1},1,1).piece,rings=[region.nodes,...region.holes??[]].map(r=>r.map(p=>[p.xMm,-p.yMm] as XY));
 const faces=new Map(mesh.faces.map(f=>[f.id,f])),bindings=new Map<string,NonNullable<Project['bindings']>>();for(const b of project.bindings)for(const id of b.report.faceIds)bindings.set(id,[...bindings.get(id)??[],b]);
 const targets=(mesh.textureFaces??[]).filter(f=>f.textureId===textureId&&(bindings.get(f.faceId)?.length??0)>0);if(targets.some(f=>Math.abs(area(f.uv))<1e-12))throw new DomainError('TEXTURE_UV_DEGENERATE');
 const scale=(r:XY[])=>r.map(([x,y])=>[x*10000,y*10000] as XY),rawClipped=await clip(worker,targets.map(f=>({subjects:rings.map(scale),clips:[positive(scale(f.uv))]}))),clipped=rawClipped.map(rs=>rs.map(r=>r.map(([x,y])=>[x/10000,y/10000] as XY))),fragments:Marking['fragments']=[],byPiece=new Map<string,XY[][]>(),uvMaps=new Map(project.bindings.map(b=>[b.pieceId,new Map(b.report.uv.map(p=>[p.vertexId,p]))]));
 targets.forEach((f,i)=>{const cut=clipped[i].filter(r=>r.length>=3&&Math.abs(area(r))>1e-12);if(!cut.length)return;const bary=cut.map(r=>r.map(p=>{const w=weights(p,f.uv);if(w.some(v=>v<-.001))throw new DomainError('PROJECTION_NUMERICAL');const sum=w.reduce((s,v)=>s+Math.max(0,v),0);return w.map(v=>Math.max(0,v)/sum) as [number,number,number];}));fragments.push({faceId:f.faceId,rings:bary});const face=faces.get(f.faceId)!;for(const b of bindings.get(f.faceId)??[]){const uv=uvMaps.get(b.pieceId)!,triangle=face.vertices.map(id=>uv.get(id)!);const mapped=bary.map(r=>r.map(w=>[w.reduce((s,v,j)=>s+v*triangle[j].xMm,0),w.reduce((s,v,j)=>s+v*triangle[j].yMm,0)] as XY));if(area(triangle.map(p=>[p.xMm,p.yMm]))*area(f.uv)<0)mapped.forEach(r=>r.reverse());byPiece.set(b.pieceId,[...byPiece.get(b.pieceId)??[],...mapped]);}});
 if(!fragments.length)throw new DomainError('NO_VISIBLE_PROJECTION');const entries=[...byPiece],merged=await clip(worker,entries.map(([,subjects])=>({subjects,union:true}))),paths=entries.map(([pieceId],i)=>({pieceId,geometryHash:pieceGeometryHash(project.pieces.find(p=>p.id===pieceId)!),rings:merged[i].map(r=>r.map(([xMm,yMm])=>({xMm,yMm})))}));
 return markingSchema.parse({id:randomUUID(),name:derivedName(texture.name,' region'),color:region.color,source:'texture',textureId,textureRegion:{seed,tolerance,algorithm:'texture-flood-1'},sourceHash:texture.sha256,surfaceId:mesh.id,topologyVersion:mesh.topologyVersion,surfaceHash:hash(JSON.stringify(mesh)),view:'front',offsetXmm:0,offsetYmm:0,fragments,paths});
}
