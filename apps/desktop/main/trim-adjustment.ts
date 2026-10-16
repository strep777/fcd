import type {Project,Piece,Binding} from '../../../packages/schema/index';
import {mapProjectMarkings} from './fragment-mapping';
import {pieceGeometryHash} from './surface';
import {DomainError} from './repository';

/** Harmonic deformation on the clipped color mesh fixes the actual manufacturing boundary. */
export async function adjustTrimmedPattern(worker:string,project:Project,piece:Piece,binding:Binding){
 const old=project.pieces.find(p=>p.id===piece.id)!,updated=structuredClone(binding),trim=updated.trim!;
 if(!piece.closed||old.nodes.length!==piece.nodes.length||old.nodes.some((n,i)=>n.id!==piece.nodes[i].id)||(old.holes??[]).length!==(piece.holes??[]).length||(old.holes??[]).some((ring,i)=>ring.length!==piece.holes![i].length||ring.some((n,j)=>n.id!==piece.holes![i][j].id))||JSON.stringify(old.curves??[])!==JSON.stringify(piece.curves??[])||trim.boundary.length!==piece.nodes.length||trim.holes.some((r,i)=>r.length!==piece.holes?.[i]?.length))return null;
 const points=new Map(trim.vertices.map(v=>[v.id,v])),previous=new Map(binding.trim!.vertices.map(v=>[v.id,v])),fixed=new Set([...trim.boundary,...trim.holes.flat()]),adjacent=new Map<string,Set<string>>();
 for(const t of trim.triangles)for(const id of t.vertices){const list=adjacent.get(id)??new Set<string>();for(const next of t.vertices)if(next!==id)list.add(next);adjacent.set(id,list);}
 for(const [index,id] of trim.boundary.entries()){const p=points.get(id)!;p.xMm+=piece.nodes[index].xMm-old.nodes[index].xMm;p.yMm+=piece.nodes[index].yMm-old.nodes[index].yMm;}
 for(const [i,ring] of trim.holes.entries())for(const [j,id] of ring.entries()){const p=points.get(id)!;p.xMm+=piece.holes![i][j].xMm-old.holes![i][j].xMm;p.yMm+=piece.holes![i][j].yMm-old.holes![i][j].yMm;}
 // Face intersections add boundary samples between the editable contour nodes.
 // Those samples must follow the same edge displacement, not the interior
 // harmonic solve, which can flip very narrow clipped triangles at an edge.
 const edgeCounts=new Map<string,{ids:string[];count:number}>();for(const triangle of trim.triangles)for(let i=0;i<3;i++){const ids=[triangle.vertices[i],triangle.vertices[(i+1)%3]].sort(),key=ids.join(':');const entry=edgeCounts.get(key)??{ids,count:0};entry.count++;edgeCounts.set(key,entry);}
 const contourVertices=new Set([...edgeCounts.values()].filter(e=>e.count===1).flatMap(e=>e.ids)),oldRings=[old.nodes,...old.holes??[]],newRings=[piece.nodes,...piece.holes??[]];
 for(const id of contourVertices){if(fixed.has(id))continue;const before=previous.get(id)!;let best:{distance:number;dx:number;dy:number}|undefined;
  for(const [j,ring]of oldRings.entries())for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((before.xMm-a.xMm)*dx+(before.yMm-a.yMm)*dy)/length)):0,distance=Math.hypot(before.xMm-a.xMm-t*dx,before.yMm-a.yMm-t*dy);if(distance>(binding.report.boundaryToleranceMm??.0002)+1e-8||best&&distance>=best.distance)continue;const aa=newRings[j][i],bb=newRings[j][(i+1)%ring.length];best={distance,dx:(aa.xMm-a.xMm)*(1-t)+(bb.xMm-b.xMm)*t,dy:(aa.yMm-a.yMm)*(1-t)+(bb.yMm-b.yMm)*t};}
  if(best){const p=points.get(id)!;p.xMm=before.xMm+best.dx;p.yMm=before.yMm+best.dy;fixed.add(id);}
 }
 const free=[...points.keys()].filter(id=>!fixed.has(id)),delta=new Map([...points].map(([id,p])=>[id,{x:p.xMm-previous.get(id)!.xMm,y:p.yMm-previous.get(id)!.yMm}]));let converged=!free.length;
 for(let iteration=0;iteration<5000&&!converged;iteration++){let change=0;for(const id of free){const neighbors=[...adjacent.get(id)??[]];if(!neighbors.length)throw new DomainError('STALE_BINDING');const next={x:neighbors.reduce((s,k)=>s+delta.get(k)!.x,0)/neighbors.length,y:neighbors.reduce((s,k)=>s+delta.get(k)!.y,0)/neighbors.length},d=delta.get(id)!;change=Math.max(change,Math.hypot(next.x-d.x,next.y-d.y));delta.set(id,next);}converged=change<1e-7;}
 if(!converged)throw new DomainError('PATTERN_ADJUSTMENT_LIMIT');for(const id of free){const p=points.get(id)!,before=previous.get(id)!,d=delta.get(id)!;p.xMm=before.xMm+d.x;p.yMm=before.yMm+d.y;}
 const mesh=project.surface!,faces=new Map(mesh.faces.map(f=>[f.id,f])),vertices=new Map(mesh.vertices.map(v=>[v.id,v]));let total=0,weighted=0;
 const signed=(p:{xMm:number;yMm:number}[])=>((p[1].xMm-p[0].xMm)*(p[2].yMm-p[0].yMm)-(p[1].yMm-p[0].yMm)*(p[2].xMm-p[0].xMm))/2;
 const metrics=trim.triangles.map(t=>{const triangle=t.vertices.map(id=>points.get(id)!),before=t.vertices.map(id=>previous.get(id)!);const beforeArea=signed(before),afterArea=signed(triangle);if(beforeArea*afterArea<=0||Math.abs(afterArea)<=Math.abs(beforeArea)*1e-8)throw new DomainError('PATTERN_ADJUSTMENT_FLIP');const face=faces.get(t.faceId)!,positions=face.vertices.map(id=>vertices.get(id)!),physical=t.barycentric.map(w=>({x:w.reduce((s,n,i)=>s+n*positions[i].xMm,0),y:w.reduce((s,n,i)=>s+n*positions[i].yMm,0),z:w.reduce((s,n,i)=>s+n*positions[i].zMm,0)})),[a,b,c]=physical,ab=[b.x-a.x,b.y-a.y,b.z-a.z],ac=[c.x-a.x,c.y-a.y,c.z-a.z],area3=Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])/2;
 const l3=physical.map((p,i)=>{const q=physical[(i+1)%3];return Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z);}),l2=triangle.map((p,i)=>{const q=triangle[(i+1)%3];return Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm);}),angle=(a:number,b:number,c:number)=>Math.acos(Math.max(-1,Math.min(1,(a*a+b*b-c*c)/(2*a*b)))),areaError=Math.abs(Math.abs(signed(triangle))/area3-1),edgeError=Math.max(...l2.map((l,i)=>Math.abs(l/l3[i]-1))),angleError=Math.max(...l3.map((l,i)=>Math.abs(angle(l,l3[(i+1)%3],l3[(i+2)%3])-angle(l2[i],l2[(i+1)%3],l2[(i+2)%3]))/Math.PI)),distortion=.4*areaError+.4*edgeError+.2*angleError;total+=area3;weighted+=area3*distortion;return {faceId:t.faceId,areaError,edgeError,angleError,distortion};});
 const byFace=new Map<string,typeof metrics[number]>();for(const m of metrics){const old=byFace.get(m.faceId);byFace.set(m.faceId,old?{faceId:m.faceId,areaError:Math.max(old.areaError,m.areaError),edgeError:Math.max(old.edgeError,m.edgeError),angleError:Math.max(old.angleError,m.angleError),distortion:Math.max(old.distortion,m.distortion)}:m);}const sorted=metrics.map(m=>m.distortion).sort((a,b)=>a-b);
 updated.geometryHash=pieceGeometryHash(piece);updated.adjusted=true;updated.report={...updated.report,areaErrorMax:Math.max(...metrics.map(m=>m.areaError)),edgeErrorMax:Math.max(...metrics.map(m=>m.edgeError)),distortionMean:weighted/total,distortionP95:sorted[Math.ceil(sorted.length*.95)-1],distortionMax:sorted.at(-1)!,faceDistortion:[...byFace.values()],status:'needsReview',arap:undefined};
 const proposed={...project,pieces:project.pieces.map(p=>p.id===piece.id?piece:p),bindings:project.bindings?.map(b=>b.pieceId===piece.id?updated:b)};
 return {piece,bindings:proposed.bindings!,markings:await mapProjectMarkings(worker,proposed,project.markings??[])};
}

