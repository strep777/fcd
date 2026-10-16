import type {Binding,Piece,Project} from '../../../packages/schema/index';
import {pieceGeometryHash} from './surface';
import {unwrapMarkings} from './unwrap-markings';
import {DomainError} from './repository';
import {adjustTrimmedPattern} from './trim-adjustment';

/** Harmonic deformation keeps the original mesh correspondence while adjusting a manufacturing boundary. */
export async function adjustPattern(worker:string,project:Project,piece:Piece){
 const old=project.pieces.find(p=>p.id===piece.id),binding=project.bindings?.find(b=>b.pieceId===piece.id),mesh=project.surface;
 if(!old||!binding||!mesh||binding.geometryHash!==pieceGeometryHash(old))return null;
 if(binding.trim)return adjustTrimmedPattern(worker,project,piece,binding);
 if(!piece.closed||old.nodes.length!==piece.nodes.length||old.nodes.some((n,i)=>n.id!==piece.nodes[i].id)||JSON.stringify(old.holes??[])!==JSON.stringify(piece.holes??[])||JSON.stringify(old.curves??[])!==JSON.stringify(piece.curves??[])||binding.report.boundary.length!==piece.nodes.length)return null;
 const updated:Binding=structuredClone(binding),uv=new Map(updated.report.uv.map(v=>[v.vertexId,v])),previous=new Map(binding.report.uv.map(v=>[v.vertexId,v])),fixed=new Set(binding.report.boundary),bound=new Set(binding.report.faceIds),adjacent=new Map<string,Set<string>>();
 const faces=mesh.faces.filter(f=>bound.has(f.id)),vertices=new Map(mesh.vertices.map(v=>[v.id,v]));
 for(const face of faces)for(const id of face.vertices){const list=adjacent.get(id)??new Set<string>();for(const other of face.vertices)if(other!==id)list.add(other);adjacent.set(id,list);}
 for(const [i,id] of binding.report.boundary.entries()){const point=uv.get(id);if(!point)throw new DomainError('STALE_BINDING');point.xMm=piece.nodes[i].xMm;point.yMm=piece.nodes[i].yMm;}
 const free=[...uv.keys()].filter(id=>!fixed.has(id)),displacements=new Map([...uv].map(([id,p])=>[id,{x:p.xMm-previous.get(id)!.xMm,y:p.yMm-previous.get(id)!.yMm}]));
 let converged=!free.length;
 for(let iteration=0;iteration<2000&&!converged;iteration++){
  let change=0;for(const id of free){const neighbors=[...adjacent.get(id)??[]];if(!neighbors.length)throw new DomainError('STALE_BINDING');const d={x:neighbors.reduce((s,k)=>s+displacements.get(k)!.x,0)/neighbors.length,y:neighbors.reduce((s,k)=>s+displacements.get(k)!.y,0)/neighbors.length},old=displacements.get(id)!;change=Math.max(change,Math.hypot(d.x-old.x,d.y-old.y));displacements.set(id,d);}
  converged=change<1e-7;
 }
 if(!converged)throw new DomainError('PATTERN_ADJUSTMENT_LIMIT');
 for(const id of free){const p=uv.get(id)!,before=previous.get(id)!,d=displacements.get(id)!;p.xMm=before.xMm+d.x;p.yMm=before.yMm+d.y;}
 let edgeMax=0,areaMax=0,totalArea=0,weighted=0;
 const metrics=faces.map(face=>{
  const triangle=face.vertices.map(id=>uv.get(id)!),original=face.vertices.map(id=>previous.get(id)!),positions=face.vertices.map(id=>vertices.get(id)!);
  const signed=(r:{xMm:number;yMm:number}[])=>((r[1].xMm-r[0].xMm)*(r[2].yMm-r[0].yMm)-(r[1].yMm-r[0].yMm)*(r[2].xMm-r[0].xMm))/2;
  if(signed(triangle)*signed(original)<=1e-8)throw new DomainError('PATTERN_ADJUSTMENT_FLIP');
  const a=positions[0],b=positions[1],c=positions[2],ab=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],ac=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm],cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],area3=Math.hypot(...cross)/2;
  const lengths3=positions.map((p,i)=>{const q=positions[(i+1)%3];return Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm,p.zMm-q.zMm);}),lengths2=triangle.map((p,i)=>{const q=triangle[(i+1)%3];return Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm);});
  const angle=(a:number,b:number,c:number)=>Math.acos(Math.max(-1,Math.min(1,(a*a+b*b-c*c)/(2*a*b))));
  const areaError=Math.abs(Math.abs(signed(triangle))/area3-1),edgeError=Math.max(...lengths2.map((length,i)=>Math.abs(length/lengths3[i]-1))),angleError=Math.max(...lengths3.map((length,i)=>Math.abs(angle(length,lengths3[(i+1)%3],lengths3[(i+2)%3])-angle(lengths2[i],lengths2[(i+1)%3],lengths2[(i+2)%3]))/Math.PI)),distortion=.4*areaError+.4*edgeError+.2*angleError;
  areaMax=Math.max(areaMax,areaError);edgeMax=Math.max(edgeMax,edgeError);totalArea+=area3;weighted+=area3*distortion;
  return {faceId:face.id,areaError,edgeError,angleError,distortion};
 });
 const sorted=metrics.map(m=>m.distortion).sort((a,b)=>a-b);
 updated.geometryHash=pieceGeometryHash(piece);updated.adjusted=true;updated.report={...updated.report,areaErrorMax:areaMax,edgeErrorMax:edgeMax,distortionMean:weighted/totalArea,distortionP95:sorted[Math.ceil(sorted.length*.95)-1],distortionMax:sorted.at(-1)!,faceDistortion:metrics,status:'needsReview',arap:undefined};
 const pieces=project.pieces.map(p=>p.id===piece.id?piece:structuredClone(p)),bindings=(project.bindings??[]).map(b=>b.pieceId===piece.id?updated:b);
 const colors=new Map(pieces.map(p=>[p.id,p.color]));
 const markings=await unwrapMarkings(worker,{...project,pieces},{pieces,bindings,sourceHash:binding.surfaceHash,algorithm:'lscm-cg-1',accepted:true});
 for(const p of pieces)p.color=colors.get(p.id)!;
 // Explicit color edits and the original manufacturing cut colors remain authoritative.
 return {piece,bindings,markings};
}
