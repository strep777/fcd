import type {Surface} from '../schema/index';
import {MESH_FACES,MESH_VERTICES} from './limits';
export type Bary=[number,number,number];
export type FaceCut={faceId:string;a:Bary;b:Bary;owner:string};
export type Child={face:Surface['faces'][number];triangle:[number,number][]};
export const edgeKey=(a:string,b:string)=>[a,b].sort().join(':');
const cross=(a:number[],b:number[])=>a[0]*b[1]-a[1]*b[0];
/** Test an edge in the original barycentric plane. Dividing by a skinny
 * child triangle's area amplifies harmless roundoff into a false interior
 * weight; this distance test keeps genuinely interior points separate. */
const onEdge=(p:number[],a:number[],b:number[])=>{const d=[b[0]-a[0],b[1]-a[1]],length=Math.hypot(...d),t=length?((p[0]-a[0])*d[0]+(p[1]-a[1])*d[1])/(length*length):Infinity;return t>=-1e-10&&t<=1+1e-10&&Math.abs(cross(d,[p[0]-a[0],p[1]-a[1]]))<=length*1e-10;};
const weights=(p:number[],t:number[][]):Bary=>{const a=t[0],b=t[1],c=t[2],d=cross([b[0]-a[0],b[1]-a[1]],[c[0]-a[0],c[1]-a[1]]),v=cross([p[0]-a[0],p[1]-a[1]],[c[0]-a[0],c[1]-a[1]])/d,w=cross([b[0]-a[0],b[1]-a[1]],[p[0]-a[0],p[1]-a[1]])/d;return [1-v-w,v,w];};
/** Insert constrained straight segments into triangles in their original barycentric plane.
 * Shared-edge intersections get one identity, so adjacent triangles remain watertight. */
export function refineSurface(previous:Surface,cuts:FaceCut[],newId=()=>crypto.randomUUID()){
 if(cuts.length>100000)throw Error('RESOURCE_LIMIT');
 const byFace=new Map<string,FaceCut[]>();for(const c of cuts)byFace.set(c.faceId,[...(byFace.get(c.faceId)??[]),c]);
 const vertices=new Map(previous.vertices.map(v=>[v.id,v])),faces=new Map(previous.faces.map(f=>[f.id,f])),children=new Map<string,Child[]>(),created=new Map<string,string>(),edgePoints=new Map<string,{t:number;id:string}[]>(),splitEdges=new Map<string,Set<string>>(),owned=new Map<string,{a:string;b:string}[]>();
 const register=(face:Surface['faces'][number],raw:Bary)=>{
  const clamped=raw.map(n=>Math.abs(n)<1e-8?0:Math.abs(n-1)<1e-8?1:n),sum=clamped.reduce((a,b)=>a+b,0),w=clamped.map(n=>n/sum) as Bary;if(w.some(n=>!Number.isFinite(n)||n< -1e-7||n>1+1e-7))throw Error('INVALID_CUT');
  const corner=w.findIndex(n=>n>=1-1e-8);if(corner>=0)return face.vertices[corner];
  const zero=w.findIndex(n=>n<=1e-8);let key:string,edge:string|undefined,t=0;
  if(zero>=0){const pair=face.vertices.filter((_,i)=>i!==zero).sort(),index=face.vertices.indexOf(pair[1]);t=w[index];edge=edgeKey(pair[0],pair[1]);key=edge+':'+Math.round(t*1e9);}else key=face.id+':'+w.map(n=>Math.round(n*1e9)).join(',');
  const old=created.get(key);if(old)return old;const id=newId(),triangle=face.vertices.map(id=>vertices.get(id)!);vertices.set(id,{id,xMm:w.reduce((s,n,i)=>s+n*triangle[i].xMm,0),yMm:w.reduce((s,n,i)=>s+n*triangle[i].yMm,0),zMm:w.reduce((s,n,i)=>s+n*triangle[i].zMm,0)});created.set(key,id);if(edge)edgePoints.set(edge,[...(edgePoints.get(edge)??[]),{t,id}]);return id;
 };
 for(const [faceId,segments] of byFace){const face=faces.get(faceId);if(!face)throw Error('INVALID_SELECTION');const positions=new Map(face.vertices.map((id,i)=>[id,[[0,0],[1,0],[0,1]][i]])),triangles:[string,string,string][]=[face.vertices];
  const insert=(point:number[],id:string)=>{
   if(positions.has(id))return;positions.set(id,point);for(let i=triangles.length-1;i>=0;i--){const tri=triangles[i],local=tri.map(id=>positions.get(id)!),w=weights(point,local),edge=local.findIndex((_,j)=>onEdge(point,local[(j+1)%3],local[(j+2)%3]));if(w.some(n=>n< -1e-8)&&edge<0)continue;
    const zero=edge>=0?edge:w.findIndex(n=>Math.abs(n)<1e-8);if(w.filter(n=>Math.abs(n)<1e-8).length>=2)throw Error('INVALID_CUT');
    if(zero>=0){const key=edgeKey(tri[(zero+1)%3],tri[(zero+2)%3]),points=splitEdges.get(key)??new Set<string>();points.add(id);splitEdges.set(key,points);}
    const replacement:[string,string,string][]=zero>=0?[[tri[(zero+1)%3],id,tri[zero]],[id,tri[(zero+2)%3],tri[zero]]]:[[tri[0],tri[1],id],[tri[1],tri[2],id],[tri[2],tri[0],id]];triangles.splice(i,1,...replacement);
   }
  };
  for(const segment of segments){const a=[segment.a[1],segment.a[2]],b=[segment.b[1],segment.b[2]],d=[b[0]-a[0],b[1]-a[1]];if(Math.hypot(...d)<1e-10)continue;const stations=[0,1],edges=new Set<string>();
   for(const tri of triangles)for(let i=0;i<3;i++){const u=tri[i],v=tri[(i+1)%3],key=edgeKey(u,v);if(edges.has(key))continue;edges.add(key);const p=positions.get(u)!,q=positions.get(v)!,e=[q[0]-p[0],q[1]-p[1]],delta=[p[0]-a[0],p[1]-a[1]],den=cross(d,e);
    if(Math.abs(den)>1e-12){const t=cross(delta,e)/den,s=cross(delta,d)/den;if(t>1e-8&&t<1-1e-8&&s>=-1e-8&&s<=1+1e-8)stations.push(t);}else if(Math.abs(cross(delta,d))<1e-10){for(const r of [p,q]){const t=(Math.abs(d[0])>Math.abs(d[1])?r[0]-a[0]:r[1]-a[1])/(Math.abs(d[0])>Math.abs(d[1])?d[0]:d[1]);if(t>1e-8&&t<1-1e-8)stations.push(t);}}
   }
   stations.sort((a,b)=>a-b);const unique=stations.filter((n,i)=>!i||n-stations[i-1]>1e-8),path=unique.map(t=>{const p=[a[0]+t*d[0],a[1]+t*d[1]],existing=[...positions].find(([,v])=>Math.hypot(v[0]-p[0],v[1]-p[1])<1e-8)?.[0],id=existing??register(face,[1-p[0]-p[1],p[0],p[1]]);insert(p,id);return id;});
   for(let i=1;i<path.length;i++){if(!triangles.some(t=>t.includes(path[i-1])&&t.includes(path[i])))throw Error('INVALID_CUT');owned.set(segment.owner,[...(owned.get(segment.owner)??[]),{a:path[i-1],b:path[i]}]);}
   if(triangles.length>10000)throw Error('RESOURCE_LIMIT');
  }
  if(triangles.length>1)children.set(faceId,triangles.map(tri=>({face:{...face,id:newId(),vertices:tri},triangle:tri.map(id=>positions.get(id)!.map(n=>n*1000) as [number,number])})));
 }
 // Splitting an outer edge also refines the neighboring face even when no seam crosses it.
 for(const face of previous.faces){const records=children.get(face.id),base=records??[{face,triangle:[[0,0],[1000,0],[0,1000]] as [number,number][]}];let changed=false;
  for(let k=0;k<3;k++){const a=face.vertices[k],b=face.vertices[(k+1)%3],list=edgePoints.get(edgeKey(a,b));if(!list?.length)continue;const pair=[a,b].sort();for(const p of list){const fraction=a===pair[0]?p.t:1-p.t,xy=[[0,0],[1000,0],[0,1000]],point:[number,number]=[xy[k][0]+fraction*(xy[(k+1)%3][0]-xy[k][0]),xy[k][1]+fraction*(xy[(k+1)%3][1]-xy[k][1])];
    if(base.some(c=>c.face.vertices.includes(p.id)))continue;
    for(let i=base.length-1;i>=0;i--){const child=base[i],w=weights(point,child.triangle);if(w.some(n=>n< -1e-8))continue;const zero=w.findIndex(n=>Math.abs(n)<1e-8);if(zero<0)throw Error('INVALID_CUT');const u=(zero+1)%3,v=(zero+2)%3;const first:Child={face:{...child.face,id:newId(),vertices:[child.face.vertices[u],p.id,child.face.vertices[zero]]},triangle:[child.triangle[u],point,child.triangle[zero]]},second:Child={face:{...child.face,id:newId(),vertices:[p.id,child.face.vertices[v],child.face.vertices[zero]]},triangle:[point,child.triangle[v],child.triangle[zero]]};base.splice(i,1,first,second);changed=true;}
   }
  }if(changed)children.set(face.id,base);
 }
 // Repeated edits can leave intersections nanometres apart. Collapse only
 // sub-0.0001 mm edges of unusable slivers, with the mesh link condition intact.
 const aliases=new Map<string,string>(),canonical=(id:string):string=>{const next=aliases.get(id);return next?canonical(next):id;},flat=previous.faces.flatMap(f=>children.get(f.id)?.map(c=>c.face)??[f]);
 const size=(f:Surface['faces'][number])=>{const [a,b,c]=f.vertices.map(id=>vertices.get(canonical(id))!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm];return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);};
 for(let pass=0;;pass++){
  const active=flat.filter(f=>new Set(f.vertices.map(canonical)).size===3),bad=active.find(f=>size(f)<2e-8);if(!bad)break;if(pass>1000||pass*flat.length>20000000)throw Error('CUT_PROCESSING_LIMIT');
  const ids=bad.vertices.map(canonical),pairs=ids.map((a,i)=>{const b=ids[(i+1)%3],p=vertices.get(a)!,q=vertices.get(b)!;return {a,b,length:Math.hypot(p.xMm-q.xMm,p.yMm-q.yMm,p.zMm-q.zMm)};}).sort((a,b)=>a.length-b.length);let collapsed=false;
  for(const pair of pairs){if(pair.length>1e-4)break;const na=new Set<string>(),nb=new Set<string>(),opposite=new Set<string>();for(const f of active){const tri=f.vertices.map(canonical);if(tri.includes(pair.a))for(const id of tri)if(id!==pair.a)na.add(id);if(tri.includes(pair.b))for(const id of tri)if(id!==pair.b)nb.add(id);if(tri.includes(pair.a)&&tri.includes(pair.b))for(const id of tri)if(id!==pair.a&&id!==pair.b)opposite.add(id);}
   const common=[...na].filter(id=>nb.has(id));if(common.length!==opposite.size||common.some(id=>!opposite.has(id)))continue;const keep=previous.vertices.some(v=>v.id===pair.a)?pair.b:pair.a,drop=keep===pair.a?pair.b:pair.a;aliases.set(drop,keep);collapsed=true;break;
  }if(!collapsed)throw Error('DEGENERATE_MESH');
 }
 if(aliases.size)for(const original of previous.faces){const records=children.get(original.id)??[{face:original,triangle:[[0,0],[1000,0],[0,1000]] as [number,number][]}];if(!records.some(c=>c.face.vertices.some(id=>canonical(id)!==id)))continue;
  const [a,b,c]=original.vertices.map(id=>vertices.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm],normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],omit=normal.reduce((best,n,i)=>Math.abs(n)>Math.abs(normal[best])?i:best,0),axes=[0,1,2].filter(i=>i!==omit),base=[a,b,c].map(p=>axes.map(i=>[p.xMm,p.yMm,p.zMm][i]));
  children.set(original.id,records.flatMap(record=>{const ids=record.face.vertices.map(canonical) as [string,string,string];if(new Set(ids).size<3)return [];return [{face:{...record.face,...(record.face.id===original.id?{id:newId()}:{}),vertices:ids},triangle:ids.map(id=>{const p=vertices.get(id)!,w=weights(axes.map(i=>[p.xMm,p.yMm,p.zMm][i]),base);return [w[1]*1000,w[2]*1000] as [number,number];})}];}));
 }
 const remapRaw=(edges:{a:string;b:string}[]):{a:string;b:string}[]=>edges.flatMap(e=>{const ids=new Set([...(edgePoints.get(edgeKey(e.a,e.b))??[]).map(p=>p.id),...(splitEdges.get(edgeKey(e.a,e.b))??[])]);if(!ids.size)return [e];const a=vertices.get(e.a)!,b=vertices.get(e.b)!,d=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],path=[e.a,...[...ids].sort((u,v)=>{const p=vertices.get(u)!,q=vertices.get(v)!;return (p.xMm-q.xMm)*d[0]+(p.yMm-q.yMm)*d[1]+(p.zMm-q.zMm)*d[2];}),e.b];return remapRaw(path.slice(1).map((id,i)=>({a:path[i],b:id})));});
 const remap=(edges:{a:string;b:string}[])=>[...new Map(remapRaw(edges).map(e=>({a:canonical(e.a),b:canonical(e.b)})).filter(e=>e.a!==e.b).map(e=>[edgeKey(e.a,e.b),e])).values()];
 for(const [owner,edges] of owned)owned.set(owner,remap(edges));
 const cutLines=previous.cutLines?.map(line=>({...line,edges:remap(line.edges)})),constraints=(previous.cutConstraints??[]).flatMap(c=>remap([c]).map(e=>({...e,locked:c.locked})));
 const surface:Surface={...previous,vertices:[...vertices.values()].filter(v=>canonical(v.id)===v.id),faces:previous.faces.flatMap(f=>children.get(f.id)?.map(c=>c.face)??[f]),topologyVersion:previous.topologyVersion+(children.size?1:0),cutConstraints:constraints,...(previous.cutBaseConstraints?{cutBaseConstraints:previous.cutBaseConstraints.flatMap(c=>remap([c]).map(e=>({...e,locked:c.locked})))}:{}),...(cutLines?{cutLines}:{}),...(previous.textureFaces?{textureFaces:previous.textureFaces.flatMap(t=>children.get(t.faceId)?.map(c=>({faceId:c.face.id,textureId:t.textureId,uv:c.triangle.map(p=>{const w=[1-(p[0]+p[1])/1000,p[0]/1000,p[1]/1000];return [w.reduce((s,n,i)=>s+n*t.uv[i][0],0),w.reduce((s,n,i)=>s+n*t.uv[i][1],0)] as [number,number];}) as [[number,number],[number,number],[number,number]]}))??[t])}:{})};
 if(surface.faces.length>MESH_FACES||surface.vertices.length>MESH_VERTICES)throw Error('MESH_LIMIT');return {surface,children,owned};
}
