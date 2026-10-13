import type {Surface} from '../schema/index';
import type {Bary} from './refine';
import {edgeKey} from './refine';
import type {MaterialTile} from './material-tiles';

/** Remove only straight contour samples. Collinear backtracking has zero
 * filled area too; keeping its tip creates a spurious global edge station. */
function straightRing(ring:Bary[]){
 const result=[...ring];let changed=true;while(changed&&result.length>3){changed=false;for(let i=0;i<result.length;i++){const a=result[(i+result.length-1)%result.length],b=result[i],c=result[(i+1)%result.length],u=[b[1]-a[1],b[2]-a[2]],v=[c[1]-a[1],c[2]-a[2]],cross=u[0]*v[1]-u[1]*v[0],scale=Math.hypot(...u)*Math.hypot(...v),sameOriginalEdge=a.some((n,j)=>n===0&&b[j]===0&&c[j]===0);if(sameOriginalEdge||Math.abs(cross)<=scale*1e-15){result.splice(i,1);changed=true;break;}}}return result;
}

/** Canonicalize intersection roundoff in the temporary material mesh. Model
 * corners and shared edge stations take precedence over interior samples. */
export function canonicalMaterialStations(source:Surface,tiles:MaterialTile[],epsilonMm=1e-6,triangulate?: (rings:[number,number][][])=>number[][]){
 if(!Number.isFinite(epsilonMm)||epsilonMm<=0||epsilonMm>1e-6)throw Error('COLOR_CUT_BOUNDARY');
 const faces=new Map(source.faces.map(f=>[f.id,f])),vertices=new Map(source.vertices.map(v=>[v.id,v])),stations=new Map<string,{pair:string[];length:number;values:number[];intervals:{t:number;lo:number;hi:number}[]}>();
 const position=(face:Surface['faces'][number],w:Bary)=>{const v=face.vertices.map(id=>vertices.get(id)!);return [0,1,2].map(axis=>w.reduce((s,n,i)=>s+n*[v[i].xMm,v[i].yMm,v[i].zMm][axis],0));};
 const distance=(a:number[],b:number[])=>Math.hypot(...a.map((n,i)=>n-b[i]));
 // Project almost-on-edge inputs before collecting shared stations. Retain
 // original positions and rings for the combined movement and area budgets.
 const originalTiles=new Map<MaterialTile,MaterialTile>(),rawPositions=new Map<Bary,number[]>();
 tiles=tiles.map(raw=>{const face=faces.get(raw.faceId)!;const rings=raw.rings.map(r=>straightRing(r.map(input=>{const point=position(face,input);let w=[...input] as Bary;
  for(let i=0;i<3;i++){const corner=[0,1,2].map(j=>i===j?1:0) as Bary;if(distance(point,position(face,corner))<=epsilonMm){w=corner;rawPositions.set(w,point);return w;}}
  let best:{w:Bary;distance:number}|undefined;for(let zero=0;zero<3;zero++){const indices=[0,1,2].filter(i=>i!==zero),a=[0,0,0] as Bary,b=[0,0,0] as Bary;a[indices[0]]=1;b[indices[1]]=1;const pa=position(face,a),pb=position(face,b),line=pb.map((n,i)=>n-pa[i]),den=line.reduce((sum,n)=>sum+n*n,0);if(!den)continue;const t=point.reduce((sum,n,i)=>sum+(n-pa[i])*line[i],0)/den;if(t<0||t>1)continue;const edge=[0,0,0] as Bary;edge[indices[0]]=1-t;edge[indices[1]]=t;const d=distance(point,position(face,edge));if(d<=epsilonMm&&(!best||d<best.distance))best={w:edge,distance:d};}w=best?.w??w;rawPositions.set(w,point);return w;})));const tile={...raw,rings};originalTiles.set(tile,raw);return tile;});
 const boundary=(face:Surface['faces'][number],w:Bary)=>{const zero=w.findIndex(n=>n===0);if(zero<0||w.some(n=>n===1))return;const pair=face.vertices.filter((_,i)=>i!==zero).sort(),a=vertices.get(pair[0])!,b=vertices.get(pair[1])!,length=Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm);return {key:edgeKey(...pair as [string,string]),pair,zero,length,t:w[face.vertices.indexOf(pair[1])]};};
 for(const tile of tiles){const face=faces.get(tile.faceId)!;for(const ring of tile.rings)for(const w of ring){const edge=boundary(face,w);if(edge){const row=stations.get(edge.key)??{...edge,values:[],intervals:[]},offset=distance(rawPositions.get(w)??position(face,w),position(face,w)),radius=Math.sqrt(Math.max(0,epsilonMm**2-offset**2))/edge.length;row.values.push(edge.t);row.intervals.push({t:edge.t,lo:edge.t-radius,hi:edge.t+radius});stations.set(edge.key,row);}}}
 // Edge projection has already consumed part of an input's movement budget.
 // Choose a station inside every raw input's remaining sphere/edge interval;
 // a midpoint of projected points alone can exceed the combined budget.
 for(const row of stations.values()){const kept:number[]=[],sorted=row.intervals.filter(r=>Math.min(r.t,1-r.t)*row.length>epsilonMm).sort((a,b)=>a.t-b.t);for(let i=0;i<sorted.length;){let j=i+1,lo=sorted[i].lo,hi=sorted[i].hi;while(j<sorted.length&&(sorted[j].t-sorted[i].t)*row.length<=2*epsilonMm){const nextLo=Math.max(lo,sorted[j].lo),nextHi=Math.min(hi,sorted[j].hi);if(nextLo>nextHi)break;lo=nextLo;hi=nextHi;j++;}kept.push((lo+hi)/2);i=j;}row.values=kept;}
 const byFace=new Map<string,MaterialTile[]>();for(const tile of tiles){const rows=byFace.get(tile.faceId)??[];rows.push(tile);byFace.set(tile.faceId,rows);}
 let maxShiftMm=0,areaErrorMm2=0;const result:MaterialTile[]=[],colors=new Map<string,{beforeMm2:number;afterMm2:number}>();
 for(const [id,rows]of byFace){const face=faces.get(id)!,samples=new Map<string,{point:number[];w:Bary}[]>(),origins=new Map<Bary,number[][]>(),cell=(p:number[])=>p.map(n=>Math.floor(n/epsilonMm));
  const add=(raw:Bary)=>{const w=[...raw] as Bary,point=position(face,w),key=cell(point).join(','),list=samples.get(key)??[];list.push({point,w});samples.set(key,list);origins.set(w,[]);return w;};
  for(let i=0;i<3;i++)add([0,1,2].map(j=>i===j?1:0) as Bary);
  for(let zero=0;zero<3;zero++){const pair=face.vertices.filter((_,i)=>i!==zero).sort();for(const t of stations.get(edgeKey(...pair as [string,string]))?.values??[]){const w=[0,0,0] as Bary;w[face.vertices.indexOf(pair[1])]=t;w[face.vertices.indexOf(pair[0])]=1-t;add(w);}}
  const snap=(w:Bary):Bary=>{const point=rawPositions.get(w)??position(face,w),c=cell(point);for(let corner=0;corner<3;corner++){const weights=[0,1,2].map(i=>i===corner?1:0) as Bary;if(distance(point,position(face,weights))<=epsilonMm){const chosen=[...samples.values()].flat().find(s=>s.w.every((n,i)=>n===weights[i]))!.w;origins.get(chosen)!.push(point);return chosen;}}let best:{w:Bary;d:number}|undefined;for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const sample of samples.get([c[0]+x,c[1]+y,c[2]+z].join(','))??[]){const d=distance(point,sample.point);if(d<=epsilonMm&&(!best||d<best.d))best={w:sample.w,d};}const chosen=best?.w??add(w);origins.get(chosen)!.push(point);return chosen;};
  const prepared=rows.map(tile=>({tile,rings:tile.rings.map(r=>r.map(snap))}));
  // Project shared interior stations which are numerically collinear. Source
  // corners and shared original-edge stations remain fixed. Every input
  // occurrence, including already snapped ones, must stay within 1e-6 mm.
  for(let pass=0;pass<2;pass++)for(const entry of prepared)for(const ring of entry.rings)for(let i=0;i<ring.length;i++){
   const w=ring[i];if(w.some(n=>n===0))continue;const before=position(face,w),a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length],pa=position(face,a),pb=position(face,b),line=pb.map((n,j)=>n-pa[j]),den=line.reduce((s,n)=>s+n*n,0);if(den<=epsilonMm**2)continue;
   const t=before.reduce((s,n,j)=>s+(n-pa[j])*line[j],0)/den;if(t<0||t>1)continue;const target=a.map((n,j)=>n*(1-t)+b[j]*t) as Bary,point=position(face,target);if(distance(before,point)>epsilonMm||(origins.get(w)??[]).some(p=>distance(p,point)>epsilonMm))continue;w.splice(0,3,...target);
  }
  // A triangulation diagonal may expose a nearly collinear interior sample
  // which was not consecutive on a polygon ring (for example beside a hole).
  // Apply the same measured movement budget to that shared sample.
  if(triangulate)for(let pass=0;pass<2;pass++)for(const entry of prepared){const points=entry.rings.flat();for(const ids of triangulate(entry.rings.map(r=>r.map(w=>[w[1]*1000,w[2]*1000] as [number,number])))){const tri=ids.map(i=>points[i]);for(let i=0;i<3;i++){const w=tri[i];if(w.some(n=>n===0))continue;const a=tri[(i+1)%3],b=tri[(i+2)%3],before=position(face,w),pa=position(face,a),pb=position(face,b),line=pb.map((n,j)=>n-pa[j]),den=line.reduce((sum,n)=>sum+n*n,0);if(den<=epsilonMm**2)continue;const t=before.reduce((sum,n,j)=>sum+(n-pa[j])*line[j],0)/den;if(t<0||t>1)continue;const target=a.map((n,j)=>n*(1-t)+b[j]*t) as Bary,point=position(face,target);if(distance(before,point)>epsilonMm||(origins.get(w)??[]).some(p=>distance(p,point)>epsilonMm))continue;w.splice(0,3,...target);}}}
  // Conform the contour arrangement before tessellation. A shared station may
  // lie on the other color's long edge without occurring in that ring. Both
  // rings must describe the same segmented interface, rather than independent
  // triangles separated by a numerical slit. The unchanged-input area guards
  // below measure every resulting color-domain change.
  const shared=[...origins.keys()].map(w=>({w,point:position(face,w)}));
  for(const entry of prepared)entry.rings=entry.rings.map(ring=>{const conformed:Bary[]=[];for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],pa=position(face,a),pb=position(face,b),line=pb.map((n,j)=>n-pa[j]),length2=line.reduce((sum,n)=>sum+n*n,0);conformed.push(a);if(!length2)continue;const interior=shared.flatMap(sample=>{if(sample.w===a||sample.w===b)return [];const delta=sample.point.map((n,j)=>n-pa[j]),t=delta.reduce((sum,n,j)=>sum+n*line[j],0)/length2;if(t<=1e-10||t>=1-1e-10||Math.hypot(...delta.map((n,j)=>n-t*line[j]))>Math.min(epsilonMm,1e-8))return [];return [{w:sample.w,t}];}).sort((a,b)=>a.t-b.t);for(const row of interior)if(conformed.at(-1)!==row.w)conformed.push(row.w);}return conformed;});
  for(const [w,points]of origins)for(const original of points)maxShiftMm=Math.max(maxShiftMm,distance(original,position(face,w)));
  const signed=(rings:Bary[][])=>rings.reduce((sum,r)=>sum+r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[1]*b[2]-a[2]*b[1];},0),0),[a,b,c]=face.vertices.map(id=>vertices.get(id)!),u=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],v=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm],area=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
  // Projection can create new straight samples. Remove their zero-area
  // subdivision before the unchanged-input guards and reports below. The
  // triangulator restores stations retained by any other material or face.
  for(const {tile,rings:snapped}of prepared){const rings=snapped.map((ring,index)=>{const r=originalTiles.get(tile)!.rings[index],unique=ring.filter((w,i)=>!w.every((n,j)=>n===ring[(i+ring.length-1)%ring.length][j])),result=unique.length>=3?straightRing(unique):[],before=signed([r])*area,after=signed([result])*area,perimeter=r.reduce((s,w,i)=>s+distance(position(face,w),position(face,r[(i+1)%r.length])),0),budget=perimeter*epsilonMm+Math.max(1e-9,Math.abs(before)*1e-10);if(before*after<0){if(Math.abs(before)<=budget&&Math.abs(after)<=budget)return [];throw Error('COLOR_CUT_BOUNDARY');}if(Math.abs(after-before)>budget)throw Error('COLOR_CUT_BOUNDARY');return result;}).filter(r=>r.length),before=signed(originalTiles.get(tile)!.rings)*area,after=signed(rings)*area,perimeter=originalTiles.get(tile)!.rings.reduce((sum,r)=>sum+r.reduce((s,w,i)=>s+distance(position(face,w),position(face,r[(i+1)%r.length])),0),0),error=Math.abs(after-before);
   if(error>perimeter*epsilonMm+Math.max(1e-9,Math.abs(before)*1e-10))throw Error('COLOR_CUT_BOUNDARY');areaErrorMm2+=error;const color=colors.get(tile.color)??{beforeMm2:0,afterMm2:0};color.beforeMm2+=before;color.afterMm2+=after;colors.set(tile.color,color);result.push({...tile,rings});
  }
 }
 return {tiles:result,maxShiftMm,areaErrorMm2,perColor:[...colors].map(([color,areas])=>({color,...areas,errorMm2:areas.afterMm2-areas.beforeMm2}))};
}
