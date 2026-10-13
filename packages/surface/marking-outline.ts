import type {Marking,Surface} from '../schema/index';
type Point={xMm:number;yMm:number;zMm:number};
export type SurfaceOutline={faceId:string;a:Point;b:Point};
/** Recover the paint boundary on the actual triangles, rather than its floating
 * projection plane. Parity of edge intervals removes internal triangulation,
 * including cases where adjacent fragments subdivide an edge differently. */
export function markingSurfaceOutline(surface:Surface,marking:Pick<Marking,'surfaceId'|'topologyVersion'|'fragments'>):SurfaceOutline[]{
 if(marking.surfaceId!==surface.id||marking.topologyVersion!==surface.topologyVersion)return [];
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),faces=new Map(surface.faces.map(f=>[f.id,f])),result:SurfaceOutline[]=[],edges=new Map<string,{ids:[string,string];intervals:{min:number;max:number;faceId:string}[]}>();
 const point=(triangle:Point[],weights:number[]):Point=>({xMm:weights.reduce((s,w,i)=>s+w*triangle[i].xMm,0),yMm:weights.reduce((s,w,i)=>s+w*triangle[i].yMm,0),zMm:weights.reduce((s,w,i)=>s+w*triangle[i].zMm,0)});
 for(const fragment of marking.fragments){const face=faces.get(fragment.faceId);if(!face)continue;const triangle=face.vertices.map(id=>vertices.get(id)!);if(triangle.some(v=>!v))continue;
  for(const ring of fragment.rings)for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],zero=a.findIndex((value,j)=>Math.abs(value)<1e-8&&Math.abs(b[j])<1e-8);
   if(zero<0){result.push({faceId:face.id,a:point(triangle,a),b:point(triangle,b)});continue;}
   const ids=face.vertices.filter((_,j)=>j!==zero).sort() as [string,string],index=face.vertices.indexOf(ids[1]),key=ids.join(':'),edge=edges.get(key)??{ids,intervals:[]},min=Math.min(a[index],b[index]),max=Math.max(a[index],b[index]);if(max-min>1e-10)edge.intervals.push({min,max,faceId:face.id});edges.set(key,edge);
  }
 }
 for(const edge of edges.values()){const cuts=[...new Set(edge.intervals.flatMap(i=>[i.min,i.max]))].sort((a,b)=>a-b),a=vertices.get(edge.ids[0])!,b=vertices.get(edge.ids[1])!,at=(t:number)=>({xMm:a.xMm+(b.xMm-a.xMm)*t,yMm:a.yMm+(b.yMm-a.yMm)*t,zMm:a.zMm+(b.zMm-a.zMm)*t});
  for(let i=1;i<cuts.length;i++){const min=cuts[i-1],max=cuts[i];if(max-min<1e-8)continue;const mid=(min+max)/2,cover=edge.intervals.filter(interval=>mid>interval.min-1e-10&&mid<interval.max+1e-10);if(cover.length%2)result.push({faceId:cover[0].faceId,a:at(min),b:at(max)});}
 }
 return result.filter(({a,b})=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm)>1e-8);
}
