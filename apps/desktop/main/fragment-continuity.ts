import type {Marking,Surface} from '../../../packages/schema/index';
type Bary=[number,number,number];
/** Give neighboring face fragments the same samples on their shared edges.
 * Legacy projection used a 0.0001 mm grid. A point within two grid units of a
 * projected edge is on that edge; splitting both sides at every station avoids
 * independent rounding turning continuous paint into separate sewing islands.
 * The saved surface paint is never changed by this UV preparation step. */
export function continuousFragments(surface:Surface,marking:Marking,gridTolerance=.0002):Marking['fragments']{
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),faces=new Map(surface.faces.map(f=>[f.id,f]));
 const project=(id:string)=>{const v=vertices.get(id)!;if(marking.surfaceShape){const s=marking.surfaceShape,d=[v.xMm-s.origin[0],v.yMm-s.origin[1],v.zMm-s.origin[2]];return s.axes.slice(0,2).map(a=>a.reduce((sum,n,i)=>sum+n*d[i],0));}return [v.xMm,v.yMm];};
 const tolerance=marking.editMode==='uv-manual'?1e-9:gridTolerance,stations=new Map<string,number[]>();
 const key=(a:string,b:string)=>[a,b].sort().join(':');
 const result=marking.fragments.map(fragment=>{
  const face=faces.get(fragment.faceId)!;if(!face)return structuredClone(fragment);
  const xy=face.vertices.map(project),area2=Math.abs((xy[1][0]-xy[0][0])*(xy[2][1]-xy[0][1])-(xy[1][1]-xy[0][1])*(xy[2][0]-xy[0][0]));
  const heights=xy.map((_,i)=>area2/Math.hypot(xy[(i+1)%3][0]-xy[(i+2)%3][0],xy[(i+1)%3][1]-xy[(i+2)%3][1]));
  const ringArea=(ring:Bary[])=>ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a[1]*b[2]-b[1]*a[2];},0);
  const rings=fragment.rings.map(ring=>{
   const snapped=ring.map(original=>{const w=original.map((n,i)=>heights[i]>1e-9&&n*heights[i]<=tolerance?0:n),sum=w.reduce((a,b)=>a+b,0),candidate=(sum&&w.some((n,i)=>n!==original[i])?w.map(n=>n/sum):[...original]) as Bary;
    const displacement=Math.hypot(...[0,1].map(axis=>candidate.reduce((s,n,i)=>s+(n-original[i])*xy[i][axis],0)));
    return displacement<=tolerance*2?candidate:[...original] as Bary;
   });
   // A real narrow island or hole can be smaller than the grid tolerance.
   // Retain it exactly instead of collapsing or changing its signed area.
   const before=ringArea(ring),after=ringArea(snapped);
   return Math.sign(before)===Math.sign(after)&&Math.abs(after-before)<=Math.abs(before)*.1?snapped:ring.map(w=>[...w] as Bary);
  });
  for(const ring of rings)for(const w of ring)for(let i=0;i<3;i++)if(w[i]===0){const a=(i+1)%3,b=(i+2)%3,k=key(face.vertices[a],face.vertices[b]),high=face.vertices[a]>face.vertices[b]?a:b,list=stations.get(k)??[0,1];list.push(w[high]);stations.set(k,list);}
  return {...fragment,rings};
 });
 for(const [k,values]of stations)stations.set(k,values.sort((a,b)=>a-b).filter((v,i,a)=>i===0||v-a[i-1]>1e-12));
 return result.map(fragment=>{const face=faces.get(fragment.faceId);if(!face)return fragment;return {...fragment,rings:fragment.rings.map(ring=>ring.flatMap((a,index)=>{
  const b=ring[(index+1)%ring.length],edge=a.findIndex((n,i)=>n===0&&b[i]===0);if(edge<0)return [a];
  const j=(edge+1)%3,k=(edge+2)%3,high=face.vertices[j]>face.vertices[k]?j:k,low=high===j?k:j,t0=a[high],t1=b[high],values=(stations.get(key(face.vertices[j],face.vertices[k]))??[]).filter(t=>t>Math.min(t0,t1)+1e-12&&t<Math.max(t0,t1)-1e-12);if(t0>t1)values.reverse();
  return [a,...values.map(t=>{const w:Bary=[0,0,0];w[high]=t;w[low]=1-t;return w;})];
 }))};});
}

