import {randomUUID} from 'node:crypto';
import type {Project,Surface,Marking} from '../../../packages/schema/index';
import {surfaceSchema,markingSchema} from '../../../packages/schema/index';
import {clip,weights,positive,markingFingerprint,type XY} from './markings';
import {validateSurface} from './surface';
import {DomainError,hash} from './repository';

/** Split every incident triangle together, retaining its physical surface and attached colors. */
export async function insertCutPoint(worker:string,project:Project,a:string,b:string,t:number){
 const previous=project.surface;if(!previous)throw new DomainError('SURFACE_MISSING');
 const from=previous.vertices.find(v=>v.id===a),to=previous.vertices.find(v=>v.id===b);
 if(!from||!to||a===b||!Number.isFinite(t)||t<=0||t>=1)throw new DomainError('INVALID_SELECTION');
 const incident=previous.faces.filter(f=>f.vertices.includes(a)&&f.vertices.includes(b));if(!incident.length)throw new DomainError('INVALID_SELECTION');
 if(Math.min(t,1-t)*Math.hypot(to.xMm-from.xMm,to.yMm-from.yMm,to.zMm-from.zMm)<.01)throw new DomainError('shortEdge');
 const vertex={id:randomUUID(),xMm:from.xMm+t*(to.xMm-from.xMm),yMm:from.yMm+t*(to.yMm-from.yMm),zMm:from.zMm+t*(to.zMm-from.zMm)};
 type Child={face:Surface['faces'][number];triangle:XY[]};
 const children=new Map<string,Child[]>(),originalTriangle:XY[]=[[0,0],[1000,0],[0,1000]];
 for(const face of incident){
  let i=face.vertices.findIndex((id,index)=>[a,b].includes(id)&&[a,b].includes(face.vertices[(index+1)%3]));
  const j=(i+1)%3,k=(i+2)%3,u=face.vertices[i],v=face.vertices[j],c=face.vertices[k],fraction=u===a?t:1-t;
  const point:XY=[originalTriangle[i][0]+fraction*(originalTriangle[j][0]-originalTriangle[i][0]),originalTriangle[i][1]+fraction*(originalTriangle[j][1]-originalTriangle[i][1])];
  children.set(face.id,[{face:{...face,id:randomUUID(),vertices:[u,vertex.id,c]},triangle:[originalTriangle[i],point,originalTriangle[k]]},{face:{...face,id:randomUUID(),vertices:[vertex.id,v,c]},triangle:[point,originalTriangle[j],originalTriangle[k]]}]);
 }
 const key=(u:string,v:string)=>[u,v].sort().join(':'),oldKey=key(a,b),constraints=(previous.cutConstraints??[]).flatMap(edge=>key(edge.a,edge.b)===oldKey?[{...edge,b:vertex.id},{...edge,a:vertex.id}]:[edge]);
 const surface=surfaceSchema.parse({...previous,topologyVersion:previous.topologyVersion+1,vertices:[...previous.vertices,vertex],faces:previous.faces.flatMap(f=>children.get(f.id)?.map(c=>c.face)??[f]),cutConstraints:constraints,
  ...(previous.cutLines?{cutLines:previous.cutLines.map(line=>({...line,edges:line.edges.flatMap(edge=>key(edge.a,edge.b)===oldKey?[{a:edge.a,b:vertex.id},{a:vertex.id,b:edge.b}]:[edge])}))}:{}),
  ...(previous.cutBaseConstraints?{cutBaseConstraints:previous.cutBaseConstraints.flatMap(edge=>key(edge.a,edge.b)===oldKey?[{...edge,b:vertex.id},{...edge,a:vertex.id}]:[edge])}:{}),
  ...(previous.textureFaces?{textureFaces:previous.textureFaces.flatMap(texture=>children.get(texture.faceId)?.map(child=>({faceId:child.face.id,textureId:texture.textureId,uv:child.triangle.map(point=>{const w=weights(point,originalTriangle);return [w.reduce((sum,n,i)=>sum+n*texture.uv[i][0],0),w.reduce((sum,n,i)=>sum+n*texture.uv[i][1],0)];})}))??[texture])}:{}),
 });validateSurface(surface);
 const markings=await remapRefinedMarkings(worker,project,surface,children);
 return {surface,markings,vertexId:vertex.id};
}

export async function remapRefinedMarkings(worker:string,project:Project,surface:Surface,children:Map<string,{face:Surface['faces'][number];triangle:[number,number][]}[]>){
 const previous=project.surface!;
 const surfaceHash=hash(JSON.stringify(surface)),jobs:{subjects:XY[][];clips:XY[][]}[]=[],targets:{markingId:string;faceId:string;triangle:XY[]}[]=[],unchanged=new Map<string,Marking['fragments']>();
 for(const marking of project.markings??[]){
  if(marking.surfaceHash!==hash(JSON.stringify(previous))||marking.topologyVersion!==previous.topologyVersion)throw new DomainError('STALE_MARKING');
  unchanged.set(marking.id,[]);
  for(const fragment of marking.fragments){const split=children.get(fragment.faceId);if(!split){unchanged.get(marking.id)!.push(fragment);continue;}
   const subjects=fragment.rings.map(r=>r.map(w=>[w[1]*1000,w[2]*1000] as XY));
   for(const child of split){jobs.push({subjects,clips:[positive(child.triangle)]});targets.push({markingId:marking.id,faceId:child.face.id,triangle:child.triangle});}
  }
 }
 const clipped=await clip(worker,jobs);
 clipped.forEach((rings,index)=>{if(!rings.length)return;const target=targets[index];unchanged.get(target.markingId)!.push({faceId:target.faceId,rings:rings.map(ring=>ring.map(p=>{const w=weights(p,target.triangle).map(n=>Math.max(0,Math.min(1,n))),total=w.reduce((s,n)=>s+n,0);return w.map(n=>n/total) as [number,number,number];}))});});
 const markings=(project.markings??[]).map(m=>markingSchema.parse({...m,surfaceHash,topologyVersion:surface.topologyVersion,fragments:unchanged.get(m.id),paths:[]}));
 for(const m of markings)if(m.inference){const parent=markings.find(source=>source.id===m.inference!.sourceMarkingId);if(parent)m.inference.sourceFingerprint=markingFingerprint(parent);}
 return markings;
}
