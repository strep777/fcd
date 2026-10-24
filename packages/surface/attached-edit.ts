import type {CutProjection,Marking,Surface,Project} from '../schema/index';
import {pointBounds} from '../pattern/edit';
import {placedPoint} from '../reference/placement-transform';
import {drawingIssue} from './drawing';
import {mapShapeContour,pieceContour,sampleShapeContour} from './shape-contour';
import {boxIndex,type Box} from './spatial';

export type Shape=NonNullable<Marking['surfaceShape']>;
export type Point={xMm:number;yMm:number};
export type World={xMm:number;yMm:number;zMm:number};
/** Cut acceptance replaces the live source tag with an archive link. Follow
 * that immutable chain before treating a legacy polygon as painted geometry;
 * reference contours and incomplete provenance must retain their exact nodes. */
export function isSurfacePaint(marking:Marking,project?:Project):boolean {
 if(!marking.surfaceShape)return false;
 const visited=new Set<string>();let source=marking;
 while(source.source==='cut-library'){
  const entryId=source.cutLibraryId;if(!entryId||visited.has(entryId))return false;
  visited.add(entryId);
  const original=project?.cuttingLibrary?.find(entry=>entry.id===entryId)?.markings.find(m=>m.id===source.id);
  if(!original||original.sourceHash!==(source.cutLibrarySourceHash??source.sourceHash))return false;
  source=original;
 }
 return source.source==='surface';
}
const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0);
export function shapeWorld(frame:CutProjection,p:Point):World{return {xMm:frame.origin[0]+frame.axes[0][0]*p.xMm+frame.axes[1][0]*p.yMm,yMm:frame.origin[1]+frame.axes[0][1]*p.xMm+frame.axes[1][1]*p.yMm,zMm:frame.origin[2]+frame.axes[0][2]*p.xMm+frame.axes[1][2]*p.yMm};}
export function shapePoint(frame:CutProjection,p:World):Point{const d=[p.xMm-frame.origin[0],p.yMm-frame.origin[1],p.zMm-frame.origin[2]];return {xMm:dot(d,frame.axes[0]),yMm:dot(d,frame.axes[1])};}
/** Intersect a camera ray with the persistent editing plane; refuse edge-on views. */
export function planePointer(frame:CutProjection,view:CutProjection,p:Point,perspective=false,distance=1800):Point|undefined{
 const eye=view.origin.map((v,i)=>v+view.axes[2][i]*distance),offset=view.origin.map((v,i)=>v+view.axes[0][i]*p.xMm+view.axes[1][i]*p.yMm),origin=perspective?eye:offset.map((v,i)=>v+view.axes[2][i]*distance),direction=perspective?offset.map((v,i)=>v-eye[i]):view.axes[2].map(v=>-v),denominator=dot(direction,frame.axes[2]);
 if(Math.abs(denominator)/Math.hypot(...direction)<.03)return;
 const t=dot(frame.origin.map((v,i)=>v-origin[i]),frame.axes[2])/denominator;if(perspective&&t<=0)return;
 const hit=origin.map((v,i)=>v+direction[i]*t);return shapePoint(frame,{xMm:hit[0],yMm:hit[1],zMm:hit[2]});
}
export function translateShape(shape:Shape,dx:number,dy:number):Shape{return mapShapeContour(shape,p=>({xMm:p.xMm+dx,yMm:p.yMm+dy}));}
/** Transform every contour in the persistent frame, preserving holes and the centre. */
export function transformShape(shape:Shape,scaleX=1,scaleY=scaleX,angle=0):Shape{
 if(![scaleX,scaleY,angle].every(Number.isFinite)||scaleX<=0||scaleY<=0)throw Error('INVALID_GEOMETRY');
 const box=pointBounds(sampleShapeContour(shape)),cx=(box.minX+box.maxX)/2,cy=(box.minY+box.maxY)/2,c=Math.cos(angle),s=Math.sin(angle),map=(p:Point)=>{const x=(p.xMm-cx)*scaleX,y=(p.yMm-cy)*scaleY;return {xMm:cx+c*x-s*y,yMm:cy+s*x+c*y};};
 return mapShapeContour(shape,map);
}
/** Parallel-transport the editing frame onto a new surface tangent. The grabbed
 * contour point stays exactly under the cursor, including after orbiting the model. */
export function surfaceDragShape(shape:Shape,grab:Point,position:World,normal:[number,number,number],targetRegion?:string,targetFaceId?:string):Shape{
 const length=Math.hypot(...normal);if(length<1e-12)throw Error('MARKING_EDIT_FRAME');
 const target=normal.map(v=>v/length),from=shape.axes[2],cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],axis=cross(from,target),cos=Math.max(-1,Math.min(1,dot(from,target)));
 // The antipodal case needs a stable 180-degree axis instead of dividing by zero.
 const rotate=(v:number[])=>{if(cos<-1+1e-8){const a=shape.axes[0],d=dot(a,v);return a.map((n,i)=>2*n*d-v[i]);}const a=cross(axis,v),b=cross(axis,a);return v.map((n,i)=>n+a[i]+b[i]/(1+cos));};
 const rotatedX=rotate(shape.axes[0]),parallel=dot(rotatedX,target),x=rotatedX.map((n,i)=>n-target[i]*parallel),xLength=Math.hypot(...x),unitX=x.map(v=>v/xLength),y=cross(target,unitX),axes=[unitX,y,target] as CutProjection['axes'],p=[position.xMm,position.yMm,position.zMm];
 return {...shape,...(targetFaceId?{anchorFaceId:targetFaceId}:{}),...(shape.regions&&targetRegion&&!shape.regions.includes(targetRegion)?{regions:[targetRegion]}:{}),axes,origin:p.map((n,i)=>n-axes[0][i]*grab.xMm-axes[1][i]*grab.yMm) as CutProjection['origin']};
}
export function insideRings(rings:Point[][],p:Point){let inside=false;for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.yMm>p.yMm)!==(b.yMm>p.yMm)&&p.xMm<(b.xMm-a.xMm)*(p.yMm-a.yMm)/(b.yMm-a.yMm)+a.xMm)inside=!inside;}return inside;}
export function markingContains(marking:Marking,faceId:string,w:[number,number,number]){return marking.fragments.some(f=>f.faceId===faceId&&insideRings(f.rings.map(r=>r.map(p=>({xMm:p[1],yMm:p[2]}))),{xMm:w[1],yMm:w[2]}));}
/** Recover exact shared fragment boundaries for old projected records. Never fill missing islands. */
export function editableShape(surface:Surface,marking:Marking,frame:CutProjection,project?:Project):Shape{
 if(marking.surfaceShape){const shape=JSON.parse(JSON.stringify(marking.surfaceShape)) as Shape;
  // Anchor legacy decals to their connected sheet, without inventing a part
  // restriction from the footprint. Free paint may cross a contiguous seam;
  // explicitly scoped source placements keep their existing region limits.
  if(!shape.anchorFaceId&&marking.fragments.length)shape.anchorFaceId=marking.fragments[0].faceId;
  return shape;
 }
 // Reference paint was projected in its front/back frame. Reconstructing its
 // triangles in the current camera loses the contour when viewed edge-on, and
 // clipped islands (nails, fur tips) need not describe the original source loop.
 const source=project?.patternLibrary?.find(r=>r.piece.id===marking.sourcePieceId)?.piece??project?.pieces.find(p=>p.id===marking.sourcePieceId);
 if(source&&['projected','source-manual'].includes(marking.editMode??'')){
  const sign=marking.view==='front'?1:-1,map=(p:Point)=>marking.placement?placedPoint(p,marking.placement,marking.offsetXmm,marking.offsetYmm):{xMm:p.xMm+marking.offsetXmm,yMm:p.yMm+marking.offsetYmm};
  const contour=mapShapeContour(pieceContour(source),map);
  return {...(marking.placement?{regions:[...marking.placement.regions]}:{}),origin:[0,0,0],axes:[[sign,0,0],[0,1,0],[0,0,sign]],...contour};
 }
 // Accepted reference decals no longer depend on a live library source. Their
 // saved fragments still use the original projection; the orbiting camera is
 // not a valid reconstruction plane (it may even be edge-on to the decal).
 if(marking.source==='cut-library'&&['projected','source-manual'].includes(marking.editMode??'')){
  const sign=marking.view==='front'?1:-1;
  frame={origin:[0,0,0],axes:[[sign,0,0],[0,1,0],[0,0,sign]]};
 }
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),faces=new Map(surface.faces.map(f=>[f.id,f])),segments:{a:Point;b:Point}[]=[];
 const area=(r:Point[])=>r.reduce((sum,p,i)=>sum+p.xMm*r[(i+1)%r.length].yMm-r[(i+1)%r.length].xMm*p.yMm,0)/2;
 for(const fragment of marking.fragments){const face=faces.get(fragment.faceId);if(!face)throw Error('MARKING_EDIT_FRAME');const triangle=face.vertices.map(id=>vertices.get(id)!);const projectedRings=fragment.rings.map(r=>r.map(w=>shapePoint(frame,{xMm:w.reduce((s,v,i)=>s+v*triangle[i].xMm,0),yMm:w.reduce((s,v,i)=>s+v*triangle[i].yMm,0),zMm:w.reduce((s,v,i)=>s+v*triangle[i].zMm,0)})));for(let ringIndex=0;ringIndex<projectedRings.length;ringIndex++){let ring=projectedRings[ringIndex];const nesting=projectedRings.filter((other,i)=>i!==ringIndex&&insideRings([other],ring[0])).length;if(Math.abs(area(ring))<1e-8)throw Error('MARKING_EDIT_FRAME');if((area(ring)>0)!==(nesting%2===0))ring=ring.reverse();for(let i=0;i<ring.length;i++)segments.push({a:ring[i],b:ring[(i+1)%ring.length]});}}
 if(!segments.length||segments.length>300000)throw Error('MARKING_EDIT_FRAME');
 const extent=segments.reduce((n,s)=>Math.max(n,Math.abs(s.a.xMm),Math.abs(s.a.yMm)),1),eps=extent*1e-7,key=(p:Point)=>Math.round(p.xMm/eps)+','+Math.round(p.yMm/eps),edges=new Map<string,{a:Point;b:Point}>(),endpoints=segments.flatMap(s=>[s.a,s.b]);
 // Query only endpoints near this segment, then apply the same exact tests.
 // Dense triangulation must not turn a four-corner decal into quadratic work.
 const endpointIndex=boxIndex(endpoints.map(p=>[p.xMm,p.yMm,p.xMm,p.yMm] as Box));
 for(const segment of segments){const dx=segment.b.xMm-segment.a.xMm,dy=segment.b.yMm-segment.a.yMm,length=dx*dx+dy*dy;if(length<eps*eps)continue;const splits=[0,1],near=endpointIndex.query([Math.min(segment.a.xMm,segment.b.xMm)-eps,Math.min(segment.a.yMm,segment.b.yMm)-eps,Math.max(segment.a.xMm,segment.b.xMm)+eps,Math.max(segment.a.yMm,segment.b.yMm)+eps]);for(const index of near){const p=endpoints[index],t=((p.xMm-segment.a.xMm)*dx+(p.yMm-segment.a.yMm)*dy)/length;if(t>1e-9&&t<1-1e-9&&Math.abs((p.xMm-segment.a.xMm)*dy-(p.yMm-segment.a.yMm)*dx)<eps*Math.sqrt(length))splits.push(t);}splits.sort((a,b)=>a-b);for(let i=1;i<splits.length;i++){const at=(t:number)=>({xMm:segment.a.xMm+dx*t,yMm:segment.a.yMm+dy*t}),a=at(splits[i-1]),b=at(splits[i]),ka=key(a),kb=key(b);if(ka===kb)continue;const edge=ka+'>'+kb,reverse=kb+'>'+ka;if(edges.has(reverse))edges.delete(reverse);else if(edges.has(edge))throw Error('MARKING_EDIT_FRAME');else edges.set(edge,{a,b});}}
 const outgoing=new Map<string,{a:Point;b:Point}>();for(const edge of edges.values()){if(outgoing.has(key(edge.a)))throw Error('MARKING_EDIT_FRAME');outgoing.set(key(edge.a),edge);}const rings:Point[][]=[];
 while(outgoing.size){const start=outgoing.values().next().value!,ring:Point[]=[];let edge=start;for(let n=0;n<=edges.size;n++){ring.push(edge.a);outgoing.delete(key(edge.a));if(key(edge.b)===key(start.a))break;const next=outgoing.get(key(edge.b));if(!next)throw Error('MARKING_EDIT_FRAME');edge=next;}
  // Remove only numerical collinearity left by source triangulation, never a
  // curved or measured corner. The editable-node budget applies to the outline,
  // not to all of its internal triangle edges.
  const outline=ring.filter((b,i)=>{const a=ring[(i+ring.length-1)%ring.length],c=ring[(i+1)%ring.length],x=c.xMm-a.xMm,y=c.yMm-a.yMm,l=x*x+y*y,t=l?((b.xMm-a.xMm)*x+(b.yMm-a.yMm)*y)/l:0;return l<=eps*eps||t<=0||t>=1||Math.abs((b.xMm-a.xMm)*y-(b.yMm-a.yMm)*x)>eps*Math.sqrt(l);});
  if(outline.length<3||outline.length>2000||drawingIssue(outline))throw Error('MARKING_EDIT_FRAME');rings.push(outline);}
 const outers=rings.filter(r=>area(r)>0),holes=rings.filter(r=>area(r)<0);if(outers.length!==1)throw Error('MARKING_DISCONNECTED');if(holes.length>32||holes.some(h=>!insideRings([outers[0]],h[0])))throw Error('MARKING_EDIT_FRAME');
 return {...(marking.placement?{regions:[...marking.placement.regions]}:{}),origin:[...frame.origin],axes:frame.axes.map(a=>[...a]) as CutProjection['axes'],nodes:outers[0],...(holes.length?{holes}:{})};
}
