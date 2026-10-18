import type {Surface,SurfaceRun} from '../schema/index';
import type {SurfaceOutline} from './marking-outline';

/** Show the actual UV island boundaries on the source model before acceptance.
 * Trim provenance avoids replacing fractional material edges with mesh edges. */
export function candidateSeamPreview(surface:Surface,run:SurfaceRun):SurfaceOutline[]{
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),faces=new Map(surface.faces.map(f=>[f.id,f])),result:SurfaceOutline[]=[];
 for(const binding of run.bindings){
  if(binding.surfaceId!==surface.id||binding.topologyVersion!==surface.topologyVersion)continue;
  if(binding.trim){
   const edges=new Map<string,{count:number;line:SurfaceOutline}>();
   for(const triangle of binding.trim.triangles){const face=faces.get(triangle.faceId);if(!face)continue;const source=face.vertices.map(id=>vertices.get(id));if(source.some(v=>!v))continue;
    const points=triangle.barycentric.map(w=>({xMm:w.reduce((s,n,i)=>s+n*source[i]!.xMm,0),yMm:w.reduce((s,n,i)=>s+n*source[i]!.yMm,0),zMm:w.reduce((s,n,i)=>s+n*source[i]!.zMm,0)}));
    for(let i=0;i<3;i++){const j=(i+1)%3,key=[triangle.vertices[i],triangle.vertices[j]].sort().join(':'),edge=edges.get(key);if(edge)edge.count++;else edges.set(key,{count:1,line:{faceId:face.id,a:points[i],b:points[j]}});}
   }
   // Cancel the UV triangulation's own internal edges, including diagonals
   // inside one source face. Only island boundary edges are proposed seams.
   for(const edge of edges.values())if(edge.count===1)result.push(edge.line);
   continue;
  }
  const edges=new Map<string,{count:number;faceId:string;a:string;b:string}>();
  for(const id of binding.report.faceIds){const face=faces.get(id);if(!face)continue;for(let i=0;i<3;i++){const a=face.vertices[i],b=face.vertices[(i+1)%3],key=[a,b].sort().join(':'),edge=edges.get(key);if(edge)edge.count++;else edges.set(key,{count:1,faceId:id,a,b});}}
  for(const edge of edges.values())if(edge.count===1){const a=vertices.get(edge.a),b=vertices.get(edge.b);if(a&&b)result.push({faceId:edge.faceId,a,b});}
 }
 // Neighboring islands can subdivide the same seam differently. Union its
 // collinear intervals, not just equal endpoint pairs, to keep alpha at 50%.
 const groups=new Map<string,{axis:number[];base:number[];spans:{min:number;max:number;faceId:string}[]}>();
 for(const line of result){const a=[line.a.xMm,line.a.yMm,line.a.zMm],b=[line.b.xMm,line.b.yMm,line.b.zMm],delta=b.map((v,i)=>v-a[i]),length=Math.hypot(...delta);if(length<1e-8)continue;
  const sign=(delta.find(v=>Math.abs(v)>1e-8)??1)<0?-1:1,axis=delta.map(v=>v/length*sign),dot=(p:number[])=>p.reduce((s,v,i)=>s+v*axis[i],0),u=dot(a),v=dot(b),base=a.map((n,i)=>n-u*axis[i]),key=[...axis,...base].map(n=>Math.abs(n)<.00000005?'0.0000000':n.toFixed(7)).join(',');
  const group=groups.get(key)??{axis,base,spans:[]};group.spans.push({min:Math.min(u,v),max:Math.max(u,v),faceId:line.faceId});groups.set(key,group);
 }
 const unique:SurfaceOutline[]=[];
 for(const {axis,base,spans} of groups.values()){
  const cuts=[...new Set(spans.flatMap(s=>[s.min,s.max]).map(n=>Math.round(n*1e7)/1e7))].sort((a,b)=>a-b),at=(t:number)=>({xMm:base[0]+t*axis[0],yMm:base[1]+t*axis[1],zMm:base[2]+t*axis[2]});
  for(let i=1;i<cuts.length;i++){const min=cuts[i-1],max=cuts[i];if(max-min<1e-8)continue;const mid=(min+max)/2,span=spans.find(s=>mid>s.min-1e-8&&mid<s.max+1e-8);if(span)unique.push({faceId:span.faceId,a:at(min),b:at(max)});}
 }
 return unique;
}
