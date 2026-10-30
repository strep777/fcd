import type {Surface} from '../schema/index';
import {namedPart} from '../reference/body-parts';

type Point=[number,number,number];
export type GarmentFrame={neck:Point;hipY:number;halfWidth:number;arms:Point[];legs:Point[];regions:Map<string,string>};
const cache=new WeakMap<Surface,GarmentFrame|undefined>();
/** Recognize an upright, open five-opening garment by its physical openings.
 * Object/group names are not anatomy. This optional placement frame does not
 * change the imported mesh, its IDs, or create a single sewing constraint.
 * Closed characters, accessories and ambiguous partial meshes remain manual. */
export function garmentAnatomy(surface:Surface):GarmentFrame|undefined{
 if(cache.has(surface))return cache.get(surface);
 const result=recognize(surface);cache.set(surface,result);return result;
}
function recognize(surface:Surface):GarmentFrame|undefined{
 if(surface.template||surface.partAssignments?.length||!['obj','glb','sculpt-1'].includes(surface.source))return;
 const names=new Set(surface.faces.map(f=>f.region));
 if(names.size!==1||![...names].every(n=>['unknown','body'].includes(namedPart(n).part)))return;
 const vertices=new Map(surface.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm] as Point])),edges=new Map<string,{a:string;b:string;count:number;face:number}>();
 const parents=surface.faces.map((_,i)=>i),root=(i:number):number=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 for(const [index,f] of surface.faces.entries())for(let i=0;i<3;i++){const a=f.vertices[i],b=f.vertices[(i+1)%3],key=a<b?a+':'+b:b+':'+a,e=edges.get(key)??{a,b,count:0,face:index};if(e.count)parents[root(index)]=root(e.face);e.count++;edges.set(key,e);}
 // Five holes alone do not establish a garment: a closed accessory can share
 // its object name without contributing another opening. Never apply garment
 // registration through disconnected shells or a non-manifold junction.
 if(new Set(parents.map((_,i)=>root(i))).size!==1||[...edges.values()].some(e=>e.count>2))return;
 const links=new Map<string,string[]>();for(const e of edges.values())if(e.count===1)for(const [a,b]of [[e.a,e.b],[e.b,e.a]])links.set(a,[...links.get(a)??[],b]);
 if(!links.size||[...links.values()].some(row=>row.length!==2))return;
 const seen=new Set<string>(),loops:Point[]=[];
 for(const start of links.keys()){
  if(seen.has(start))continue;const queue=[start],sum:Point=[0,0,0];let perimeter=0;seen.add(start);
  while(queue.length){const id=queue.pop()!,a=vertices.get(id)!;for(const next of links.get(id)!){const b=vertices.get(next)!,length=Math.hypot(...a.map((n,i)=>n-b[i]));perimeter+=length;for(let k=0;k<3;k++)sum[k]+=(a[k]+b[k])*.5*length;if(!seen.has(next)){seen.add(next);queue.push(next);}}}
  if(!perimeter)return;loops.push(sum.map(n=>n/perimeter) as Point);
 }
 if(loops.length!==5)return;
 loops.sort((a,b)=>b[1]-a[1]);const neck=loops[0],legs=loops.slice(3).sort((a,b)=>a[0]-b[0]),arms=loops.slice(1,3).sort((a,b)=>a[0]-b[0]),height=neck[1]-(legs[0][1]+legs[1][1])/2;
 if(height<=0||arms[0][0]>=neck[0]||arms[1][0]<=neck[0]||legs[0][0]>=neck[0]||legs[1][0]<=neck[0])return;
 if(arms.some(p=>p[1]<neck[1]-height*.6||Math.abs(p[0]-neck[0])<height*.25)||Math.abs(legs[0][1]-legs[1][1])>height*.15)return;
 // The lowest physical point near the centre line identifies the crotch,
 // not a triangle row count or an assumed percentage of overall height.
 let crotch=Infinity;for(const p of vertices.values())if(Math.abs(p[0]-neck[0])<height*.012)crotch=Math.min(crotch,p[1]);
 if(crotch>neck[1]-height*.2||crotch<neck[1]-height*.8)return;
 const hipY=crotch+height*.045,middle=(hipY+neck[1])/2,intersections:number[]=[];
 for(const e of edges.values()){const a=vertices.get(e.a)!,b=vertices.get(e.b)!;if((a[1]>middle)===(b[1]>middle))continue;const x=a[0]+(b[0]-a[0])*(middle-a[1])/(b[1]-a[1]);if(Math.abs(x-neck[0])<Math.min(...arms.map(p=>Math.abs(p[0]-neck[0])))*.55)intersections.push(Math.abs(x-neck[0]));}
 const halfWidth=Math.max(0,...intersections);if(halfWidth<height*.055||halfWidth>height*.25)return;
 const regions=new Map<string,string>();
 for(const f of surface.faces){const p=f.vertices.map(id=>vertices.get(id)!),x=p.reduce((s,p)=>s+p[0],0)/3,y=p.reduce((s,p)=>s+p[1],0)/3;
  const side=x<neck[0]?'right':'left';let region='body';
  if(y<hipY)region='leg-'+side;
  else if(Math.abs(x-neck[0])>halfWidth*1.04)region='arm-'+side;
  regions.set(f.id,'garment:'+region);
 }
 if(new Set(regions.values()).size!==5)return;
 return{neck,hipY,halfWidth,arms,legs,regions};
}

/** Pointer targets use the hit position, not the triangle's centroid: a coarse
 * triangle may cross a physical part boundary without changing that boundary. */
export function placementRegion(surface:Surface,face:Surface['faces'][number],point?:{xMm:number;yMm:number}){
 const frame=garmentAnatomy(surface);if(!frame)return face.region;if(!point)return frame.regions.get(face.id)??face.region;
 const side=point.xMm<frame.neck[0]?'right':'left';
 return 'garment:'+(point.yMm<frame.hipY?'leg-'+side:Math.abs(point.xMm-frame.neck[0])>frame.halfWidth*1.04?'arm-'+side:'body');
}

type Bary=[number,number,number];
type HalfSpace={axis:0|1|2;sign:1|-1;offset:number};
function regionPlanes(frame:GarmentFrame,region:string):HalfSpace[]|undefined{
 const x=frame.neck[0],shoulder=frame.halfWidth*1.04;
 switch(region){
  case 'garment:body':return [{axis:1,sign:1,offset:frame.hipY},{axis:0,sign:1,offset:x-shoulder},{axis:0,sign:-1,offset:x+shoulder}];
  case 'garment:arm-right':return [{axis:1,sign:1,offset:frame.hipY},{axis:0,sign:-1,offset:x-shoulder}];
  case 'garment:arm-left':return [{axis:1,sign:1,offset:frame.hipY},{axis:0,sign:1,offset:x+shoulder}];
  case 'garment:leg-right':return [{axis:1,sign:-1,offset:frame.hipY},{axis:0,sign:-1,offset:x}];
  case 'garment:leg-left':return [{axis:1,sign:-1,offset:frame.hipY},{axis:0,sign:1,offset:x}];
 }
}

/** Placement scope is a continuous physical region. A triangle crossing a
 * shoulder/hip station contributes only its clipped portion, regardless of
 * its centroid label, diagonal direction or subdivision density. */
export function createPlacementClips(surface:Surface,regions:string[],view?:'front'|'back'){
 const frame=regions.every(r=>r.startsWith('garment:'))?garmentAnatomy(surface):undefined;
 // Historical registrations name the original object/group. Keep that scope
 // when an imported garment later gains virtual anatomical regions.
 const domains=frame&&regions.every(region=>!!regionPlanes(frame,region))?regions.flatMap(region=>{const planes=regionPlanes(frame,region);if(planes&&view)planes.push({axis:2,sign:view==='front'?1:-1,offset:frame.neck[2]});return planes?[planes]:[];}):undefined;
 if(!domains)return (face:Surface['faces'][number]):Bary[][]=>regions.includes(face.region)?[[[1,0,0],[0,1,0],[0,0,1]]]:[];
 const vertices=new Map(surface.vertices.map(p=>[p.id,[p.xMm,p.yMm,p.zMm] as Point]));
 return (face:Surface['faces'][number]):Bary[][]=>{
  const points=face.vertices.map(id=>vertices.get(id)!);
  return domains.flatMap(planes=>{
   let ring:Bary[]=[[1,0,0],[0,1,0],[0,0,1]];
   for(const plane of planes){
    const distance=(w:Bary)=>plane.sign*(w.reduce((sum,n,i)=>sum+n*points[i][plane.axis],0)-plane.offset),output:Bary[]=[];
    for(let i=0;i<ring.length;i++){
     const a=ring[i],b=ring[(i+1)%ring.length],da=distance(a),db=distance(b);
     if(da>=0)output.push(a);
     if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db);output.push(a.map((n,k)=>n+(b[k]-n)*t) as Bary);}
    }
    ring=output;
   }
   return ring.length>=3?[ring]:[];
  });
 };
}

export function createPlacementMembership(surface:Surface,regions:string[],view?:'front'|'back'){
 const frame=garmentAnatomy(surface),vertices=new Map(surface.vertices.map(p=>[p.id,p]));
 const domains=frame&&regions.every(region=>!!regionPlanes(frame,region))?regions.flatMap(region=>{const planes=regionPlanes(frame,region);if(planes&&view)planes.push({axis:2,sign:view==='front'?1:-1,offset:frame.neck[2]});return planes?[planes]:[];}):undefined;
 return (face:Surface['faces'][number],rings:Bary[][])=>{
 if(!domains)return regions.includes(face.region);
 const points=face.vertices.map(id=>vertices.get(id)!);
 return rings.every(ring=>domains.some(planes=>planes.every(plane=>ring.every(w=>{
  const value=w.reduce((sum,n,i)=>sum+n*[points[i].xMm,points[i].yMm,points[i].zMm][plane.axis],0);
  return plane.sign*(value-plane.offset)>=-1e-6;
 }))));
 };
}
