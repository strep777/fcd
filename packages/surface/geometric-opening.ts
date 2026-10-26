import type {Surface} from '../schema/index';
import {orientedPlaneSegments} from './cut-geometry';
import type {FaceCut} from './refine';

type Vec=[number,number,number];
const sub=(a:Vec,b:Vec)=>a.map((n,i)=>n-b[i]) as Vec;
const dot=(a:Vec,b:Vec)=>a.reduce((s,n,i)=>s+n*b[i],0);
const cross=(a:Vec,b:Vec):Vec=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

/** A mesh walk identifies opening endpoints, never the manufactured seam.
 * Intersect a geometric plane with the actual surface and retain only a
 * continuous endpoint-to-endpoint branch. No safe branch means no proposal.
 * Its inserted stations are subsequently refined into BOTH banks of the cut.
 */
export function geometricOpeningCuts(surface:Surface,guideEdges:{a:string;b:string}[]):FaceCut[]{
 const vertices=new Map(surface.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm] as Vec]));
 const meshEdges=new Set(surface.faces.flatMap(f=>f.vertices.map((a,i)=>[a,f.vertices[(i+1)%3]].sort().join(':'))));
 const links=new Map<string,Set<string>>();
 for(const {a,b} of guideEdges){if(a===b||!vertices.has(a)||!vertices.has(b)||!meshEdges.has([a,b].sort().join(':')))return [];for(const [x,y] of [[a,b],[b,a]]){const row=links.get(x)??new Set<string>();row.add(y);links.set(x,row);}}
 if(!links.size||[...links.values()].some(r=>r.size>2))return [];
 const pending=new Set(links.keys()),result:FaceCut[]=[];
 while(pending.size){
  const seed=pending.values().next().value!,component=new Set<string>(),queue=[seed];
  while(queue.length){const at=queue.pop()!;if(component.has(at))continue;component.add(at);pending.delete(at);queue.push(...links.get(at)!);}
  const ends=[...component].filter(id=>links.get(id)!.size===1).sort((a,b)=>{const p=vertices.get(a)!,q=vertices.get(b)!;return p[0]-q[0]||p[1]-q[1]||p[2]-q[2];});
  if(ends.length!==2)return [];
  const start=vertices.get(ends[0])!,end=vertices.get(ends[1])!,direction=sub(end,start),length=Math.hypot(...direction);if(length<1e-6)return [];
  const path:Vec[]=[start];let at=ends[0],previous='';
  while(at!==ends[1]){const next=[...links.get(at)!].find(id=>id!==previous)!;previous=at;at=next;path.push(vertices.get(at)!);}
  // Surface normals give a transverse cutting plane even when the guide is
  // exactly straight. The guide's area vector provides a second proposal on
  // a strongly folded surface whose incident normals cancel.
  let normalSum:Vec=[0,0,0];
  for(const face of surface.faces)if(face.vertices.some(id=>component.has(id))){const [a,b,c]=face.vertices.map(id=>vertices.get(id)!);const n=cross(sub(b,a),sub(c,a));normalSum=normalSum.map((v,i)=>v+n[i]) as Vec;}
  const area=path.reduce((sum,p,i)=>{const n=i?cross(sub(path[i-1],start),sub(p,start)):[0,0,0];return sum.map((v,k)=>v+n[k]) as Vec;},[0,0,0] as Vec);
  const transverse=area.map((n,i)=>n-dot(area,direction)*direction[i]/length**2) as Vec;
  const candidates=[cross(direction,normalSum),transverse].filter(n=>Math.hypot(...n)>1e-10).map(n=>n.map(v=>v/Math.hypot(...n)) as Vec);
  let selected:FaceCut[]|undefined,bestLength=Infinity;
  for(const normal of candidates){
   let cuts:FaceCut[];try{cuts=orientedPlaneSegments(surface,normal,dot(normal,start),'geometric-opening');}catch{continue;}
   const cutFaces=new Set<string>(),coplanar=new Set<string>();for(const cut of cuts){if(cutFaces.has(cut.faceId))coplanar.add(cut.faceId);cutFaces.add(cut.faceId);}cuts=cuts.filter(cut=>!coplanar.has(cut.faceId));
   const faces=new Map(surface.faces.map(f=>[f.id,f]));
   const point=(cut:FaceCut,w:number[])=>w.reduce((sum,n,i)=>sum.map((v,k)=>v+n*vertices.get(faces.get(cut.faceId)!.vertices[i])![k]) as Vec,[0,0,0] as Vec);
   // Coincident positions on disconnected banks are not a shared station.
   // Identity includes the source vertex/edge, so a section cannot jump gaps.
   const key=(cut:FaceCut,w:number[],p:Vec)=>{const ids=faces.get(cut.faceId)!.vertices,support=ids.filter((_,i)=>Math.abs(w[i])>1e-9);if(support.length===1)return 'v:'+support[0];return support.sort().join(':')+'@'+p.map(n=>Math.round(n*1e7)).join(',');};
   const edges=new Map<string,{next:string;cut:FaceCut;length:number}[]>();
   for(const cut of cuts){const a=point(cut,cut.a),b=point(cut,cut.b),ka=key(cut,cut.a,a),kb=key(cut,cut.b,b),span=Math.hypot(...sub(b,a));if(ka===kb||span<1e-8)continue;for(const [x,y] of [[ka,kb],[kb,ka]]){const row=edges.get(x)??[];row.push({next:y,cut,length:span});edges.set(x,row);}}
   const from='v:'+ends[0],to='v:'+ends[1];if(!edges.has(from)||!edges.has(to))continue;
   const distances=new Map([[from,0]]),predecessors=new Map<string,{key:string;cut:FaceCut}>(),open=new Set([from]);
   while(open.size){let current='';for(const id of open)if(!current||distances.get(id)!<distances.get(current)!)current=id;open.delete(current);if(current===to)break;
    for(const edge of edges.get(current)??[]){const distance=distances.get(current)!+edge.length;if(distance>=(distances.get(edge.next)??Infinity))continue;distances.set(edge.next,distance);predecessors.set(edge.next,{key:current,cut:edge.cut});open.add(edge.next);}
   }
   const distance=distances.get(to);if(distance===undefined||distance>=bestLength)continue;
   const route:FaceCut[]=[];for(let id=to;id!==from;){const p=predecessors.get(id);if(!p){route.length=0;break;}route.push(p.cut);id=p.key;}
   if(route.length){selected=[...new Set(route)];bestLength=distance;}
  }
  if(!selected)return [];result.push(...selected);
 }
 return result;
}
