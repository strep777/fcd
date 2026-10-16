import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type Module from 'manifold-3d';
import type {Binding,Marking,Piece,Project,SurfaceRun} from '../../../packages/schema/index';
import {trimMeshSchema} from '../../../packages/schema/index';
import {clip,positive,weights,triangleClip,type XY} from './markings';
import {pieceGeometryHash,cutColorHash} from './surface';
import {DomainError} from './repository';
import {insertTrimBoundary} from './trim-boundary';
import {safeColorOutline} from './color-outline';
import {simplifyColorBoundary} from './contour-simplification';
import {analyze} from './worker';
let modulePromise:Promise<Awaited<ReturnType<typeof Module>>>|undefined;
async function triangulator(directory:string){return modulePromise??=(async()=>{const load=(await import(pathToFileURL(resolve(directory,'manifold.mjs')).href)).default as typeof Module,wasm=await load({locateFile:()=>resolve(directory,'manifold.wasm')});wasm.setup();return wasm;})();}
// Translate before summing cross products to avoid cancellation in laid-out UVs.
const area=(ring:XY[])=>ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length],o=ring[0];return sum+(p[0]-o[0])*(q[1]-o[1])-(q[0]-o[0])*(p[1]-o[1]);},0)/2;
const pointKey=(p:XY)=>p.map(n=>Math.round(n*1e10)).join(':');
const inside=(p:XY,r:XY[])=>{let value=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])value=!value;}return value;};
/** Remove only zero-area retraces/collinear samples discarded by triangulation.
 * A long backtracking spur can have exactly zero area; keeping its tip as a
 * sewing node asks for a surface map outside the actual positive-area insert. */
// Clipping uses nine digits. Bound collinearity in millimetres, since a fixed
// cross-product tolerance grows stricter with edge length and leaves grid spurs.
export function colorBoundary(ring:XY[]):XY[]{const result=[...ring];let changed=true;while(changed&&result.length>3){changed=false;for(let i=0;i<result.length;i++){const a=result[(i+result.length-1)%result.length],b=result[i],c=result[(i+1)%result.length];if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<=2e-9*Math.max(Math.hypot(b[0]-a[0],b[1]-a[1]),Math.hypot(c[0]-a[0],c[1]-a[1]),Math.hypot(c[0]-b[0],c[1]-b[1]))){result.splice(i,1);changed=true;break;}}}return result;}
export {simplifyColorBoundary} from './contour-simplification';
function polygons(rings:XY[][],minimumArea=1e-6){const contours=rings.map(colorBoundary),result=contours.filter(r=>area(r)>minimumArea).map(outer=>({outer,holes:[] as XY[][]}));for(const hole of contours.filter(r=>area(r)<-minimumArea)){const owner=result.filter(p=>hole.some(point=>inside(point,p.outer))).sort((a,b)=>area(a.outer)-area(b.outer))[0];if(!owner)throw new DomainError('COLOR_CUT_BOUNDARY');owner.holes.push(hole);}return result;}
/** Split exceptionally detailed inserts into sewable chunks within the node
 * budget. The two halves partition the original domain; no colour is removed. */
/** Match the worker's physical contact predicate, then partition through the
 * contact instead of repeatedly halving unrelated regions of the insert. */
function contourContact(ring:XY[]):{point:XY;direction:XY}|undefined{
 const cross=(a:XY,b:XY,p:XY)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]),epsilon=1e-6;
 const nearest=(p:XY,a:XY,b:XY):XY=>{const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;return [a[0]+t*dx,a[1]+t*dy];};
 for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];for(let j=i+2;j<ring.length;j++){if(i===0&&j===ring.length-1)continue;const c=ring[j],d=ring[(j+1)%ring.length];if(Math.max(a[0],b[0])+epsilon<Math.min(c[0],d[0])||Math.max(c[0],d[0])+epsilon<Math.min(a[0],b[0])||Math.max(a[1],b[1])+epsilon<Math.min(c[1],d[1])||Math.max(c[1],d[1])+epsilon<Math.min(a[1],b[1]))continue;
  if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0){const dx=b[0]-a[0],dy=b[1]-a[1],ex=d[0]-c[0],ey=d[1]-c[1],t=((c[0]-a[0])*ey-(c[1]-a[1])*ex)/(dx*ey-dy*ex);return {point:[a[0]+t*dx,a[1]+t*dy],direction:[dx,dy]};}
  for(const [p,u,v]of [[a,c,d],[b,c,d],[c,a,b],[d,a,b]]){const q=nearest(p,u,v);if(Math.hypot(p[0]-q[0],p[1]-q[1])<=epsilon)return {point:[(p[0]+q[0])/2,(p[1]+q[1])/2],direction:[-(p[1]-q[1]),p[0]-q[0]]};}
 }}
 return undefined;
}
type ManufacturingCheck={errors:string[];hole?:number;contact?:{point:XY;direction:XY}};
type ColorCutReport={budgetSplits:number;allowanceSplits:number;topologySplits:number};
/** Snap only sub-nanometre pairs, then remove exact zero-area retraces. All
 * original samples move at most epsilon before retrace removal; the exact trim
 * domain is kept separately. Hole count, orientation and topology are protected. */
export function normalizeColorOutline(original:{outer:XY[];holes:XY[][]},epsilon=1e-6){
 const perimeter=(r:XY[])=>r.reduce((sum,p,i)=>sum+Math.hypot(p[0]-r[(i+1)%r.length][0],p[1]-r[(i+1)%r.length][1]),0);
 const snap=(ring:XY[])=>{const groups=ring.map((_,i)=>[i]);for(let i=0;i<groups.length;i++){if(!groups[i].length)continue;for(let j=i+1;j<groups.length;j++){if(!groups[j].length)continue;const a=ring[groups[i][0]],b=ring[groups[j][0]];if(Math.hypot(a[0]-b[0],a[1]-b[1])>epsilon*2)continue;const ids=[...groups[i],...groups[j]],p=ids.reduce((sum,k)=>[sum[0]+ring[k][0]/ids.length,sum[1]+ring[k][1]/ids.length] as XY,[0,0] as XY);if(ids.some(k=>Math.hypot(p[0]-ring[k][0],p[1]-ring[k][1])>epsilon))continue;groups[i]=ids;groups[j]=[];}}
  const snapped=ring.map(p=>[...p] as XY);for(const ids of groups.filter(g=>g.length>1)){const p=ids.reduce((sum,k)=>[sum[0]+ring[k][0]/ids.length,sum[1]+ring[k][1]/ids.length] as XY,[0,0] as XY);ids.forEach(k=>snapped[k]=p);}const result=colorBoundary(snapped);return result.length>=3&&Math.sign(area(result))===Math.sign(area(ring))&&Math.abs(area(result)-area(ring))<=perimeter(ring)*epsilon?result:ring;};
 const candidate={outer:snap(original.outer),holes:original.holes.map(snap)};return safeColorOutline(original,candidate);
}
export function manufacturingColorOutline(polygon:{outer:XY[];holes:XY[][]}){return normalizeColorOutline(safeColorOutline(polygon,{outer:simplifyColorBoundary(polygon.outer),holes:polygon.holes.map(r=>simplifyColorBoundary(r))}));}
/** A finite fallback for contacts that survive line partitions. Use the same
 * numerical triangle-area floor as regular boundary reconstruction, with a
 * strict aggregate area check; floating-point zero-area cells are not pieces.
 * Only native-valid unions merge, and every merge reduces the cluster count. */
export async function triangulatedManufacturingPartition(polygon:{outer:XY[];holes:XY[][]},triangulate:(rings:XY[][])=>number[][],manufacturing:(outlines:{outer:XY[];holes:XY[][]}[])=>Promise<ManufacturingCheck[]>){
 const subject=[polygon.outer,...polygon.holes],points=subject.flat(),triangles=triangulate(subject).map(ids=>positive(ids.map(i=>points[i]))).filter(t=>area(t)>1e-8),expected=subject.reduce((sum,r)=>sum+area(r),0),actual=triangles.reduce((sum,t)=>sum+area(t),0),tolerance=Math.max(1e-6,expected*1e-8);
 if(!triangles.length||Math.abs(actual-expected)>tolerance)throw new DomainError('COLOR_CUT_BOUNDARY');
 const contour=(ids:number[])=>{const rings=ids.map(i=>triangles[i]),contours=triangulatedColorBoundary(rings,()=>rings.map((_,i)=>[i*3,i*3+1,i*3+2]),0),rows=polygons(contours,0);return rows.length===1?rows[0]:undefined;},outline=(p:{outer:XY[];holes:XY[][]})=>manufacturingColorOutline(p),budget=(p:{outer:XY[];holes:XY[][]})=>p.outer.length<=2000&&p.holes.length<=32&&p.holes.every(r=>r.length<=2000);
 const edge=(a:XY,b:XY)=>[a.join(':'),b.join(':')].sort().join('|'),owners=new Map<string,number[]>();triangles.forEach((t,i)=>{for(let j=0;j<3;j++){const key=edge(t[j],t[(j+1)%3]),list=owners.get(key)??[];list.push(i);owners.set(key,list);}});
 let groups=triangles.map((_,i)=>[i]);
 while(groups.length>1){
  const membership=new Map<number,number>();groups.forEach((ids,i)=>ids.forEach(id=>membership.set(id,i)));const pairs=new Map<string,[number,number]>();for(const ids of owners.values())if(ids.length===2){const a=membership.get(ids[0])!,b=membership.get(ids[1])!;if(a!==b){const pair=[Math.min(a,b),Math.max(a,b)] as [number,number];pairs.set(pair.join(':'),pair);}}
  const candidates=[...pairs.values()].flatMap(([a,b])=>{const ids=[...groups[a],...groups[b]],region=contour(ids);if(!region)return [];const simplified=outline(region);return budget(simplified)?[{a,b,ids,outline:simplified}]:[];}).sort((a,b)=>b.ids.length-a.ids.length||a.a-b.a||a.b-b.b),checks=await manufacturing(candidates.map(c=>c.outline)),used=new Set<number>(),merged:number[][]=[];
  for(let i=0;i<candidates.length;i++){const c=candidates[i];if(checks[i].errors.length||used.has(c.a)||used.has(c.b))continue;used.add(c.a);used.add(c.b);merged.push(c.ids);}
  if(!used.size){
   // Several tiny adjacent cells can be invalid in every pair, while their
   // complete neighbourhood is a valid region. Check that union as a batch;
   // never retain an invalid intermediate cluster or discard its material.
   const regions=groups.map(contour),validRegions=regions.flatMap((region,i)=>region?[{region,i}]:[]),groupChecks=await manufacturing(validRegions.map(({region})=>outline(region))),invalid=new Set(validRegions.filter((_,i)=>groupChecks[i].errors.length).map(({i})=>i)),neighbours=new Map<number,Set<number>>();
   for(const [a,b]of pairs.values()){const aa=neighbours.get(a)??new Set<number>(),bb=neighbours.get(b)??new Set<number>();aa.add(b);bb.add(a);neighbours.set(a,aa);neighbours.set(b,bb);}
   const unions=[...invalid].flatMap(i=>{const members=[i,...(neighbours.get(i)??[])].sort((a,b)=>a-b);if(members.length<3)return [];const ids=members.flatMap(k=>groups[k]),region=contour(ids);if(!region)return [];const simplified=outline(region);return budget(simplified)?[{members,ids,outline:simplified}]:[];}).sort((a,b)=>b.ids.length-a.ids.length||a.members[0]-b.members[0]),unionChecks=await manufacturing(unions.map(c=>c.outline));
   for(let i=0;i<unions.length;i++){const c=unions[i];if(unionChecks[i].errors.length||c.members.some(k=>used.has(k)))continue;c.members.forEach(k=>used.add(k));merged.push(c.ids);}
  }
  if(!used.size)break;groups=[...groups.filter((_,i)=>!used.has(i)),...merged];
 }
 const result=groups.map(ids=>contour(ids));if(result.some(r=>!r)||result.length>500)throw new DomainError(result.length>500?'COLOR_CUT_LIMIT':'COLOR_CUT_BOUNDARY');const valid=result as {outer:XY[];holes:XY[][]}[],outlines=valid.map(outline);if(outlines.some(p=>!budget(p))||(await manufacturing(outlines)).some(c=>c.errors.length))throw new DomainError('COLOR_CUT_BOUNDARY');
 const total=valid.reduce((sum,p)=>sum+[p.outer,...p.holes].reduce((s,r)=>s+area(r),0),0);if(Math.abs(total-expected)>tolerance)throw new DomainError('COLOR_CUT_BOUNDARY');return valid;
}
export async function manufacturableColorPolygons(rings:XY[][],cut:(subjects:XY[][],clips:XY[][])=>Promise<XY[][]>,regular:(rings:XY[][])=>XY[][],manufacturing:(outlines:{outer:XY[];holes:XY[][]}[])=>Promise<ManufacturingCheck[]>,report:ColorCutReport,triangulate?:(rings:XY[][])=>number[][]){
 const pending=polygons(rings).map(p=>({...p,depth:0})),result:ReturnType<typeof polygons>=[];
 while(pending.length){
  const batch=pending.splice(0).map(polygon=>{const outline=manufacturingColorOutline(polygon);return {polygon,outline,withinBudget:outline.outer.length<=2000&&outline.holes.length<=32&&outline.holes.every(r=>r.length<=2000)};}),checked=batch.filter(p=>p.withinBudget),issues=await manufacturing(checked.map(p=>p.outline));
  let checkedIndex=0;
  for(const {polygon,outline,withinBudget}of batch){
   const check=withinBudget?issues[checkedIndex++]:{errors:[]},errors=check.errors;if(errors.includes('selfIntersection'))check.contact=contourContact(check.hole===undefined?outline.outer:outline.holes[check.hole]);if(withinBudget&&!errors.length){result.push(polygon);continue;}
   if(polygon.depth>=12||errors.includes('selfIntersection')&&triangulate){if(!triangulate)throw new DomainError('COLOR_CUT_BOUNDARY');const chunks=await triangulatedManufacturingPartition(polygon,triangulate,manufacturing);report.topologySplits+=Math.max(0,chunks.length-1);result.push(...chunks);continue;}
   if(!withinBudget)report.budgetSplits++;else if(errors.includes('holeCollapsed'))report.allowanceSplits++;else report.topologySplits++;
   const minX=Math.min(...polygon.outer.map(p=>p[0])),maxX=Math.max(...polygon.outer.map(p=>p[0])),minY=Math.min(...polygon.outer.map(p=>p[1])),maxY=Math.max(...polygon.outer.map(p=>p[1]));
   const contact=check.contact?.point,xInterior=contact&&contact[0]>minX+1e-9&&contact[0]<maxX-1e-9,yInterior=contact&&contact[1]>minY+1e-9&&contact[1]<maxY-1e-9,vertical=contact&&xInterior!==yInterior?!!xInterior:maxX-minX>=maxY-minY,hole=withinBudget?outline.holes[check.hole??0]:undefined,middle=contact?contact[vertical?0:1]:hole?vertical?(Math.min(...hole.map(p=>p[0]))+Math.max(...hole.map(p=>p[0])))/2:(Math.min(...hole.map(p=>p[1]))+Math.max(...hole.map(p=>p[1])))/2:vertical?(minX+maxX)/2:(minY+maxY)/2;
   let masks:XY[][];
   if(contact){
    // Bisect rays inside the touching region. An unrelated box-centre line
    // can leave both lobes on the same side and reproduce the rejected contour.
    const ring=check.hole===undefined?outline.outer:outline.holes[check.hole],near=ring.map((p,i)=>({p,i})).filter(({p})=>Math.hypot(p[0]-contact[0],p[1]-contact[1])<=2e-6);
    const incident=(i:number)=>{const v=ring[i],a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length],al=Math.hypot(a[0]-v[0],a[1]-v[1]),bl=Math.hypot(b[0]-v[0],b[1]-v[1]);return {a:[(a[0]-v[0])/al,(a[1]-v[1])/al] as XY,b:[(b[0]-v[0])/bl,(b[1]-v[1])/bl] as XY};};
    const selected=near.sort((x,y)=>{const a=incident(x.i),b=incident(y.i);return a.a[0]*a.b[0]+a.a[1]*a.b[1]-b.a[0]*b.b[0]-b.a[1]*b.b[1];})[0];let rays=incident(selected?.i??0);
    // A kissing hole is encoded as a negative loop between two visits to the
    // contact. Bisect that loop's rays, rather than outer/hole mixed neighbours.
    let negative:XY[]|undefined;
    for(let i=0;i<near.length;i++)for(let j=i+1;j<near.length;j++){const lo=Math.min(near[i].i,near[j].i),hi=Math.max(near[i].i,near[j].i);for(const arc of [ring.slice(lo,hi+1),[...ring.slice(hi),...ring.slice(0,lo+1)]])if(arc.length>=4&&area(arc)<-1e-8&&(!negative||Math.abs(area(arc))>Math.abs(area(negative))))negative=arc;}
    if(negative){const a=negative[1],b=negative[negative.length-2],al=Math.hypot(a[0]-contact[0],a[1]-contact[1]),bl=Math.hypot(b[0]-contact[0],b[1]-contact[1]);rays={a:[(a[0]-contact[0])/al,(a[1]-contact[1])/al],b:[(b[0]-contact[0])/bl,(b[1]-contact[1])/bl]};}
    let dx=rays.a[0]+rays.b[0],dy=rays.a[1]+rays.b[1],length=Math.hypot(dx,dy);if(length<1e-8){dx=-rays.a[1];dy=rays.a[0];length=1;}
    const radius=Math.hypot(maxX-minX,maxY-minY)*4+1,u=[dx/length,dy/length] as XY,n=[-u[1],u[0]] as XY,point=(s:number,t:number):XY=>[contact[0]+radius*(s*u[0]+t*n[0]),contact[1]+radius*(s*u[1]+t*n[1])];
    masks=[[point(-1,0),point(1,0),point(1,1),point(-1,1)],[point(-1,-1),point(1,-1),point(1,0),point(-1,0)]];
   }else{const boxes=vertical?[[minX-1,minY-1,middle,maxY+1],[middle,minY-1,maxX+1,maxY+1]]:[[minX-1,minY-1,maxX+1,middle],[minX-1,middle,maxX+1,maxY+1]];masks=boxes.map(([x0,y0,x1,y1])=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]);}
   const children:ReturnType<typeof polygons>=[];
   for(const mask of masks)children.push(...polygons(regular(await cut([polygon.outer,...polygon.holes],[mask]))));
   const before=[polygon.outer,...polygon.holes].reduce((sum,r)=>sum+area(r),0),after=children.reduce((sum,p)=>sum+[p.outer,...p.holes].reduce((s,r)=>s+area(r),0),0);if(Math.abs(after-before)>Math.max(1e-6,before*1e-8)){if(!triangulate)throw new DomainError('COLOR_CUT_BOUNDARY');const chunks=await triangulatedManufacturingPartition(polygon,triangulate,manufacturing);report.topologySplits+=Math.max(0,chunks.length-1);result.push(...chunks);continue;}
   pending.push(...children.map(p=>({...p,depth:polygon.depth+1})));
  }
 }
 return result;
}
export function triangulatedColorBoundary(rings:XY[][],triangulate:(rings:XY[][])=>number[][],minimumTriangleArea=1e-8):XY[][]{
 if(!rings.length)return [];
 const points=rings.flat(),edges=new Map<string,[number,number]>(),directed=new Map<string,{a:number;b:number;count:number}>(),known=new Map<string,number>(),canonical=points.map((p,i)=>{const key=p.join(':'),id=known.get(key)??i;known.set(key,id);return id;});let triangleArea=0;
 for(const indices of triangulate(rings)){const t=indices.map(i=>points[i]);if(Math.abs(area(t))<=minimumTriangleArea)continue;const ids=(area(t)>0?indices:[...indices].reverse()).map(i=>canonical[i]);triangleArea+=Math.abs(area(t));for(let i=0;i<3;i++){const a=ids[i],b=ids[(i+1)%3],key=[a,b].sort((a,b)=>a-b).join(':');const forward=a<b,entry=directed.get(key)??{a:Math.min(a,b),b:Math.max(a,b),count:0};entry.count+=forward?1:-1;directed.set(key,entry);}}
 for(const [key,e]of directed)for(let i=0;i<Math.abs(e.count);i++)edges.set(key+':'+i,e.count>0?[e.a,e.b]:[e.b,e.a]);
 const originalArea=Math.abs(rings.reduce((sum,r)=>sum+area(r),0));if(Math.abs(triangleArea-originalArea)>Math.max(1e-6,originalArea*1e-8))throw new DomainError('COLOR_CUT_BOUNDARY');
 const result:XY[][]=[];while(edges.size){const first=edges.entries().next().value!,start=first[1][0],ring:XY[]=[],visited=new Set<number>();let [a,b]=first[1];edges.delete(first[0]);ring.push(points[a]);while(b!==start){visited.add(b);ring.push(points[b]);const candidates=[...edges].filter(([,e])=>e[0]===b);if(!candidates.length)throw new DomainError('COLOR_CUT_BOUNDARY');const angle=(c:number)=>{const u=points[a],v=points[b],w=points[c],value=Math.atan2((v[0]-u[0])*(w[1]-v[1])-(v[1]-u[1])*(w[0]-v[0]),(v[0]-u[0])*(w[0]-v[0])+(v[1]-u[1])*(w[1]-v[1]));return value;};candidates.sort((x,y)=>angle(y[1][1])-angle(x[1][1]));const next=candidates[0];a=b;b=next[1][1];edges.delete(next[0]);}result.push(colorBoundary(ring));}
 if(Math.abs(result.reduce((sum,r)=>sum+area(r),0)-triangleArea)>Math.max(1e-6,originalArea*1e-8))throw new DomainError('COLOR_CUT_BOUNDARY');return result;
}

/** Disjoint sewing pieces follow visible color boundaries; background excludes colored inserts. */
export async function colorCuts(worker:string,project:Project,run:SurfaceRun,markings:Marking[],directory=resolve('dist/assets')){
 if(!markings.some(m=>m.paths.length))return run;
 const cutClip=(jobs:Parameters<typeof clip>[1])=>clip(worker,jobs,9);
 const colorCutReport:ColorCutReport={budgetSplits:0,allowanceSplits:0,topologySplits:0},colorHash=cutColorHash(project),wasm=await triangulator(directory),pieces:Piece[]=[],bindings:Binding[]=[],faces=new Map(project.surface!.faces.map(f=>[f.id,f]));
 for(const parent of run.pieces){
  const binding=run.bindings.find(b=>b.pieceId===parent.id)!,uv=new Map(binding.report.uv.map(v=>[v.vertexId,[v.xMm,v.yMm] as XY])),parentFaces=binding.report.faceIds.map(id=>faces.get(id)!),layers=markings.flatMap(m=>m.paths.filter(p=>p.pieceId===parent.id).map(p=>({name:m.name,color:m.color,rings:p.rings.map(r=>r.map(v=>[v.xMm,v.yMm] as XY))})));
  if(!layers.length){pieces.push({...parent,color:'#eceae5'});bindings.push({...binding,colorHash});continue;}
  // The manufacturing outline may simplify a curved boundary by 0.001 mm.
  // Color inserts need the exact UV face domain for their surface provenance.
  const base=(await cutClip([{subjects:parentFaces.map(f=>positive(f.vertices.map(id=>uv.get(id)!))),union:true}]))[0];
  const groups=new Map<string,{name:string;rings:XY[][]}>();
  for(let i=0;i<layers.length;i++){const layer=layers[i],rings=(await cutClip([{subjects:base,clips:layer.rings,subtract:layers.slice(i+1).flatMap(l=>l.rings)}]))[0];if(!rings.length)continue;const group=groups.get(layer.color)??{name:layer.name,rings:[]};group.rings.push(...rings);groups.set(layer.color,group);}
  const remaining=(await cutClip([{subjects:base,subtract:layers.flatMap(l=>l.rings)}]))[0];if(remaining.length){const group=groups.get('#eceae5')??{name:'底色 / Base',rings:[]};group.rings.push(...remaining);groups.set('#eceae5',group);}
  const regular=(rings:XY[][])=>triangulatedColorBoundary(rings,r=>wasm.triangulate(r,1e-8,false)),entries=[...groups],united=await cutClip(entries.map(([,group])=>({subjects:group.rings,union:true}))),prepared=entries.map(([color,group],i)=>({color,group,rings:regular(united[i])})),checked=new Map<string,ManufacturingCheck>();
  const manufacturing=async(outlines:{outer:XY[];holes:XY[][]}[])=>{
   const node=(p:XY)=>({id:randomUUID(),xMm:p[0],yMm:p[1]}),check=async(rows:{outer:XY[];holes:XY[][]}[])=>{
    const pending=[...new Map(rows.filter(row=>!checked.has(JSON.stringify(row))).map(row=>[JSON.stringify(row),row])).values()],candidates:Piece[]=pending.map(outline=>({...parent,id:randomUUID(),nodes:outline.outer.map(node),holes:outline.holes.map(r=>r.map(node)),curves:[],edgeAllowances:[],notches:[],labels:[]})),geometry=await analyze(worker,{...project,pieces:candidates});
    pending.forEach((outline,i)=>checked.set(JSON.stringify(outline),{errors:geometry[i].issues.filter(i=>i.severity==='error').map(i=>i.messageKey)}));
   };
   await check(outlines);
   const failures=outlines.filter(outline=>outline.holes.length&&checked.get(JSON.stringify(outline))!.errors.length);
   // Diagnose the actual failing hole before adding a seam. Cutting through an
   // unrelated valid hole wastes material partitions and can exhaust the cap.
   await check(failures.flatMap(outline=>[{outer:outline.outer,holes:[]},...outline.holes.map(hole=>({outer:outline.outer,holes:[hole]}))]));
   for(const outline of failures)if(!checked.get(JSON.stringify({outer:outline.outer,holes:[]}))!.errors.length){const hole=outline.holes.findIndex(h=>checked.get(JSON.stringify({outer:outline.outer,holes:[h]}))!.errors.length);if(hole>=0)checked.get(JSON.stringify(outline))!.hole=hole;}
   return outlines.map(outline=>checked.get(JSON.stringify(outline))!);
  };
  // Check the complete parent candidate in batches; only rejected contours need
  // another worker check after an exact, area-preserving partition.
  await manufacturing(prepared.flatMap(group=>polygons(group.rings).map(manufacturingColorOutline)).filter(p=>p.outer.length<=2000&&p.holes.length<=32&&p.holes.every(r=>r.length<=2000)));
  for(const {color,group,rings}of prepared){for(const polygon of await manufacturableColorPolygons(rings,async(subjects,clips)=>(await cutClip([{subjects,clips}]))[0],regular,manufacturing,colorCutReport,r=>wasm.triangulate(r,1e-8,false))){

   const subject=[polygon.outer,...polygon.holes];
   const vertices:NonNullable<Binding['trim']>['vertices']=[],triangles:NonNullable<Binding['trim']>['triangles']=[],indexed=new Map<string,string>();
   const add=(p:XY)=>{const key=pointKey(p),known=indexed.get(key);if(known)return known;const id=randomUUID();vertices.push({id,xMm:p[0],yMm:p[1]});indexed.set(key,id);return id;};
   let mappedArea=0;
   // Triangulate each face's actual color domain. Clipping a global fan against
   // every face creates thousands of unnecessary internal diagonals, inflating
   // archives and acceptance memory while adding no geometric information.
   const bounds=(ring:XY[])=>[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))],box=bounds(polygon.outer);
   const targets=parentFaces.map(face=>({face,triangle:face.vertices.map(id=>uv.get(id)!)})).filter(({triangle})=>{const b=bounds(triangle);return b[0]<=box[2]&&b[2]>=box[0]&&b[1]<=box[3]&&b[3]>=box[1];});
   const intersections=await clip(worker,targets.map(({triangle})=>({subjects:subject,clips:[positive(triangle)]})),12);
   for(let i=0;i<targets.length;i++){const {face,triangle}=targets[i],rings=intersections[i].map(r=>colorBoundary(triangleClip(r,triangle))).filter(r=>r.length>=3&&Math.abs(area(r))>1e-8),points=rings.flat();if(!rings.length)continue;for(const indices of wasm.triangulate(rings,1e-8,false)){
    const points3=indices.map(index=>points[index]);if(Math.abs(area(points3))<1e-8)continue;if(area(points3)<0)points3.reverse();mappedArea+=area(points3);
    const barycentric=points3.map(p=>{const w=weights(p,triangle).map(n=>Math.max(0,Math.min(1,n))),sum=w.reduce((s,n)=>s+n,0);return w.map(n=>n/sum) as [number,number,number];}) as [[number,number,number],[number,number,number],[number,number,number]];
    triangles.push({faceId:face.id,vertices:points3.map(add) as [string,string,string],barycentric});
   }}
   const expectedArea=subject.reduce((sum,r)=>sum+area(r),0),perimeter=subject.reduce((sum,r)=>sum+r.reduce((n,p,i)=>n+Math.hypot(p[0]-r[(i+1)%r.length][0],p[1]-r[(i+1)%r.length][1]),0),0),areaTolerance=Math.max(1e-6,expectedArea*1e-8,perimeter*(binding.report.boundaryToleranceMm??0));if(Math.abs(mappedArea-expectedArea)>areaTolerance)throw new DomainError('COLOR_CUT_BOUNDARY');
   if(!triangles.length)continue;
   const mesh={vertices,triangles,boundary:[] as string[],holes:[] as string[][]};
   const boundaryIds=(ring:XY[])=>ring.map(p=>insertTrimBoundary(mesh,p));
   const simplified=manufacturingColorOutline(polygon),outline=simplified.outer,holes=simplified.holes;
   mesh.boundary=boundaryIds(outline);mesh.holes=holes.map(boundaryIds);
   if(pieces.length>=500)throw new DomainError('COLOR_CUT_LIMIT');
   const node=(p:XY)=>({id:randomUUID(),xMm:p[0],yMm:p[1]}),piece:Piece={...parent,id:randomUUID(),name:`B-${String(pieces.length+1).padStart(2,'0')} ${group.name}`.slice(0,120),color,nodes:outline.map(node),holes:holes.map(r=>r.map(node)),curves:[],edgeAllowances:[],notches:[],labels:[]};
   const trim=trimMeshSchema.parse(mesh),faceIds=[...new Set(trim.triangles.map(t=>t.faceId))];
   // A color insert only needs UVs for its mapped faces. Keep the original
   // parent-boundary stations as well for seam-edit compatibility, without
   // duplicating every interior UV of a wide parent patch into each insert.
   const reportVertices=new Set([...binding.report.boundary,...faceIds.flatMap(id=>faces.get(id)!.vertices)]);
   pieces.push(piece);bindings.push({...binding,colorHash,pieceId:piece.id,geometryHash:pieceGeometryHash(piece),trim,report:{...binding.report,uv:binding.report.uv.filter(v=>reportVertices.has(v.vertexId)),boundaryToleranceMm:Math.max(.001,binding.report.boundaryToleranceMm??0),faceIds,faceDistortion:binding.report.faceDistortion?.filter(f=>faceIds.includes(f.faceId))}});
  }}
 }
 if(pieces.length>500)throw new DomainError('COLOR_CUT_LIMIT');
 return {...run,pieces,bindings,colorCutReport};
}
