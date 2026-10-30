import type {Surface} from '../schema/index';
import type {FaceCut} from './refine';
import {edgeKey} from './refine';
import {boxIndex,type Box} from './spatial';

type Point=[number,number,number];
type Segment=[Point,Point];
type Interval=[number,number];
const dot=(a:number[],b:number[])=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const sub=(a:Point,b:Point)=>a.map((n,i)=>n-b[i]) as Point;
const merge=(rows:Interval[])=>{
 const result:Interval[]=[];
 for(const [lo,hi]of rows.filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0])){
  const last=result.at(-1);if(last&&lo<=last[1]+1e-12)last[1]=Math.max(last[1],hi);else result.push([lo,hi]);
 }return result;
};
/** Exact intervals of a finite segment inside a finite 3D capsule. */
function capsule([a,b]:Segment,[c,d]:Segment,radius:number):Interval[]{
 const e=sub(b,a),axis=sub(d,c),length=Math.hypot(...axis),result:Interval[]=[];
 // Barycentric reconstruction can put an exact 2 mm station a few ulps
 // inside the corridor. Reject only distances demonstrably below the limit.
 const roundoff=32*Number.EPSILON*Math.max(1,...[a,b,c,d].flat().map(Math.abs)),radiusSquared=Math.max(0,radius-roundoff)**2;
 const ball=(offset:Point,direction:Point,lo=0,hi=1)=>{
  const squared=dot(direction,direction);
  if(squared<1e-30){if(dot(offset,offset)<radiusSquared&&hi>lo)result.push([lo,hi]);return;}
  const center=-dot(offset,direction)/squared,closest=offset.map((n,i)=>n+center*direction[i]),distance=dot(closest,closest);
  if(distance>=radiusSquared)return;
  const half=Math.sqrt(Math.max(0,radiusSquared-distance)/squared);
  lo=Math.max(lo,center-half);hi=Math.min(hi,center+half);if(hi>lo)result.push([lo,hi]);
 };
 ball(sub(a,c),e);ball(sub(a,d),e);
 if(length>0){
  const u=axis.map(n=>n/length) as Point,v=sub(a,c),origin=dot(v,u),slope=dot(e,u);let lo=0,hi=1;
  if(Math.abs(slope)<1e-30){if(origin<0||origin>length)return merge(result);}
  else{const first=-origin/slope,last=(length-origin)/slope;lo=Math.max(0,Math.min(first,last));hi=Math.min(1,Math.max(first,last));}
  if(hi>lo)ball(v.map((n,i)=>n-origin*u[i]) as Point,e.map((n,i)=>n-slope*u[i]) as Point,lo,hi);
 }return merge(result);
}

/** A proposed automatic opening must not skim an existing material boundary
 * and leave a long, unsewable appendage. Measure continuous physical length,
 * not a count of nearby mesh edges. Authored cuts and original narrow motifs
 * are unchanged: this only rejects an optional new section proposal.
 * The 2 mm corridor matches the existing cloth-neck manufacturability gate.
 * Wider corridors also reject long parallel appendages (length/width >20).
 * Otherwise merely moving a rejected 1 mm cut to 7 mm leaves the same useless
 * branch. This is an automatic-layout preference, not a restriction on an
 * authored stripe: source material boundaries are never altered. */
export function createSectionClearance(surface:Surface,vertices:ReadonlyMap<string,Surface['vertices'][number]>=new Map(surface.vertices.map(v=>[v.id,v]))){
 const faces=new Map(surface.faces.map(f=>[f.id,f])),edges=new Map<string,{a:string;b:string;count:number}>();
 const point=(id:string):Point=>{const v=vertices.get(id)!;return[v.xMm,v.yMm,v.zMm];};
 for(const f of surface.faces)for(let i=0;i<3;i++){const a=f.vertices[i],b=f.vertices[(i+1)%3],key=edgeKey(a,b),row=edges.get(key)??{a,b,count:0};row.count++;edges.set(key,row);}
 const boundary=[...edges].filter(([,e])=>e.count===1).map(([key,e])=>({...e,key,segment:[point(e.a),point(e.b)] as Segment}));
 return (cuts:FaceCut[])=>{
  const segments:Segment[]=cuts.filter(c=>{
   const f=faces.get(c.faceId)!;
   // A trace already supported by an original boundary adds no cut. In a
   // narrow authored stripe its opposite bank must not make that trace look
   // like a newly introduced parallel seam.
   return !f.vertices.some((_,i)=>Math.abs(c.a[i])<1e-12&&Math.abs(c.b[i])<1e-12&&edges.get(edgeKey(f.vertices[(i+1)%3],f.vertices[(i+2)%3]))?.count===1);
  }).map(c=>{const f=faces.get(c.faceId)!,p=f.vertices.map(point),at=(w:number[])=>[0,1,2].map(k=>w.reduce((sum,n,i)=>sum+n*p[i][k],0)) as Point;return[at(c.a),at(c.b)];});
  if(!segments.length)return true;
  const box=([a,b]:Segment):Box=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
  const index=boxIndex(segments.map(box));
  for(const radius of [2,4,8,16,32]){
  const parents=new Map<string,string>(),lengths=new Map<string,number>(),limit=radius===2?10:20*radius;
  const root=(id:string):string=>{if(!parents.has(id)){parents.set(id,id);lengths.set(id,0);return id;}let result=id;while(parents.get(result)!==result)result=parents.get(result)!;while(parents.get(id)!==id){const next=parents.get(id)!;parents.set(id,result);id=next;}return result;};
  for(const edge of boundary){
   const [a,b]=edge.segment,length=Math.hypot(...sub(b,a));if(length<1e-9)continue;
   const bounds=box(edge.segment),near=index.query([bounds[0]-radius,bounds[1]-radius,bounds[2]+radius,bounds[3]+radius]).filter(i=>Math.min(...segments[i].map(p=>p[2]))<=Math.max(a[2],b[2])+radius&&Math.max(...segments[i].map(p=>p[2]))>=Math.min(a[2],b[2])-radius);
   const close=merge(near.flatMap(i=>capsule(edge.segment,segments[i],radius))),coincident=merge(near.flatMap(i=>capsule(edge.segment,segments[i],1e-6)));
   let strips=close;
   for(const [lo,hi]of coincident)strips=strips.flatMap(([from,to])=>hi<=from||lo>=to?[[from,to] as Interval]:[[from,Math.min(to,lo)],[Math.max(from,hi),to]].filter(([a,b])=>b>a) as Interval[]);
   for(const [lo,hi]of strips){
    const ka=lo*length<1e-8?edge.a:edge.key+'@'+lo,kb=(1-hi)*length<1e-8?edge.b:edge.key+'@'+hi,span=(hi-lo)*length;
    const aRoot=root(ka),bRoot=root(kb),joinedLength=lengths.get(aRoot)!+(aRoot===bRoot?0:lengths.get(bRoot)!)+span;
    if(joinedLength>limit+1e-7)return false;
    if(aRoot!==bRoot)parents.set(bRoot,aRoot);lengths.set(aRoot,joinedLength);
   }
  }
  }return true;
 };
}
