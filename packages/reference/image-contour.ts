import {safeContour} from './contour-topology';
import {sourceSpliceBase} from './image-tip-source-tube';
import {spliceSourceTips} from './image-tip-splice';
import {sourceJunctions} from './image-tip-junctions';
import {partialTips} from './image-tip-partial';
import {recoverContour,recoverBoundaryChain,recoverBoundaryLoop} from './recover-contour';
import type {Point,Piece} from '../schema/index';
import {compactSourceBoundary} from './image-compact-contour';
import {inferTips,sourceTipPolygon} from './image-line-corners';
import {materialTips} from './image-material-observation';
import {shortMaterialBranches} from './image-short-material-branch';
import {compactPolygon} from './compact-polygon';
type Curve=NonNullable<Piece['curves']>[number];
const geometryPiece=(shape:Pick<Piece,'nodes'>&Partial<Pick<Piece,'curves'|'holes'>>):Piece=>({id:'',name:'',closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'',furRad:0,color:'#ffffff',...shape});
type XY={xMm:number;yMm:number};
export type BoundaryBranch={raw:Point[];closed:boolean;colors:string[]};
export type BoundaryFit=((points:Point[],closed:boolean,colors:string[],createId:()=>string)=>{nodes:Point[];curves:Curve[];sourceAreaAllowance?:number;rasterAreaBound?:boolean;sourceBoundary?:Point[]}|undefined)&{prepare?:(branches:BoundaryBranch[],contours:Piece[])=>Point[][]|undefined};
const distance=(a:XY,b:XY)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
const segmentDistance=(p:XY,a:XY,b:XY)=>{const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);};

/** A cusp keeps its turn as the observation window shrinks. Curvature on a
 * smooth arc decreases with the window; treating its six-pixel turn as a
 * corner creates independent tangents and visible kinks on small ear arcs. */
function persistentTurn(points:Point[],index:number,closed=false){
 const n=points.length,at=(offset:number)=>points[closed?(index+offset+n)%n:Math.max(0,Math.min(n-1,index+offset))];
 const turn=(step:number)=>{const a=at(-step),b=at(0),c=at(step),x=b.xMm-a.xMm,y=b.yMm-a.yMm,u=c.xMm-b.xMm,v=c.yMm-b.yMm;
  return Math.atan2(x*v-y*u,x*u+y*v);};
 const wide=turn(6),rates=[3,4,5,6].map(step=>turn(step)/step);
 // Only suppress a corner when all four scales positively identify regular
 // curvature. Missing/irregular samples and raster staircases retain the
 // established corner decision instead of rounding source-supported tips.
 const regular=rates.every(r=>r*wide>0)&&Math.max(...rates.map(Math.abs))-Math.min(...rates.map(Math.abs))<Math.abs(wide/6)*.12;
 return regular?1:Math.cos(wide);
}

/** Join only short caps introduced by moving a raster support onto its fitted
 * curve. Keep true chain junctions and all nodes fixed, and certify the entire
 * replacement in the original source corridor before using it. */
function bridgeRasterCaps(fit:{nodes:Point[];curves:Curve[]},raw:Point[],createId:()=>string){
 if(fit.nodes.length<3)return fit;
 let curves=fit.curves;
 const unit=(x:number,y:number)=>{const length=Math.hypot(x,y);return length>1e-10?{xMm:x/length,yMm:y/length}:undefined;};
 for(const start of [true,false]){
  const a=fit.nodes[start?0:fit.nodes.length-2],b=fit.nodes[start?1:fit.nodes.length-1],inner=start?b:a,junction=start?a:b,original=raw.find(p=>p.id===inner.id),chord=distance(a,b);
  if(!original||distance(original,inner)<1e-6||chord>2||chord<1e-8||curves.some(c=>c.startNodeId===a.id&&c.endNodeId===b.id))continue;
  const adjacent=curves.find(c=>start?c.startNodeId===b.id:c.endNodeId===a.id),support=(start?raw:[...raw].reverse()).find(p=>distance(p,junction)>=6);
  if(!adjacent||!support)continue;
  const u=start?unit(support.xMm-a.xMm,support.yMm-a.yMm):unit(a.xMm-adjacent.c2.xMm,a.yMm-adjacent.c2.yMm),v=start?unit(adjacent.c1.xMm-b.xMm,adjacent.c1.yMm-b.yMm):unit(b.xMm-support.xMm,b.yMm-support.yMm);
  if(!u||!v||u.xMm*v.xMm+u.yMm*v.yMm<Math.cos(Math.PI/6)||[u,v].some(t=>t.xMm*(b.xMm-a.xMm)+t.yMm*(b.yMm-a.yMm)<=0))continue;
  const h=Math.min(.3,chord/3),curve:Curve={id:createId(),startNodeId:a.id,endNodeId:b.id,c1:{id:createId(),xMm:a.xMm+h*u.xMm,yMm:a.yMm+h*u.yMm},c2:{id:createId(),xMm:b.xMm-h*v.xMm,yMm:b.yMm-h*v.yMm}},candidate={nodes:fit.nodes,curves:[...curves,curve]};
  if(sourceSpliceBase(candidate,raw,false,createId))curves=candidate.curves;
 }
 return {nodes:fit.nodes,curves};
}

/** Locate the material transition in the source RGB samples, before fitting a
 * path. Coordinates are pixel centres; a half-contrast crossing avoids the two
 * derivative ridges of a blurred/inked edge. There is no path smoothing pass. */
export function imageBoundaryFit(width:number,height:number,rgba:Uint8Array,toPixel:(p:XY)=>XY,fromPixel:(p:XY)=>XY):BoundaryFit{
 if(rgba.length!==width*height*4)throw Error('IMAGE_LIMIT');
 let junctionCorners:XY[]=[];
 let materialPalette:string[]=[],materialBudget=0;
 const rgb=(p:XY)=>{const x=Math.max(0,Math.min(width-1,p.xMm-.5)),y=Math.max(0,Math.min(height-1,p.yMm-.5)),ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;return [0,1,2].map(c=>{const at=(dx:number,dy:number)=>rgba[(Math.min(height-1,iy+dy)*width+Math.min(width-1,ix+dx))*4+c]/255;return at(0,0)*(1-tx)*(1-ty)+at(1,0)*tx*(1-ty)+at(0,1)*(1-tx)*ty+at(1,1)*tx*ty;});};
 const fit:BoundaryFit=(raw,closed,colors,createId)=>{
  // A corner measured across a shared junction is an endpoint of each local
  // fit. Refitting it as an ordinary interior raster sample would round away
  // the source-supported bend that preparation just recovered.
  const corners=!closed?raw.flatMap((p,i)=>i>0&&i<raw.length-1&&junctionCorners.some(q=>distance(toPixel(p),q)<1e-6)?[i]:[]):[];
  if(corners.length){
   const cuts=[0,...corners,raw.length-1],nodes:Point[]=[],curves:Curve[]=[],boundary:Point[]=[];
   for(let i=0;i+1<cuts.length;i++){
    const span=raw.slice(cuts[i],cuts[i+1]+1);let result=fit(span,false,colors,createId);
    if(!result){const fallback=recoverBoundaryChain(span.map(p=>({...p,...toPixel(p)})),.8,createId),world=(p:Point)=>({...p,...fromPixel(p)});result={nodes:fallback.nodes.map(world),curves:(fallback.curves??[]).map(c=>({...c,c1:world(c.c1),c2:world(c.c2)}))};}
    const observed=result.sourceBoundary??span;
    nodes.push(...result.nodes.slice(0,i===cuts.length-2?undefined:-1));curves.push(...result.curves??[]);boundary.push(...observed.slice(0,i===cuts.length-2?undefined:-1));
   }
   return{nodes,curves,sourceBoundary:boundary};
  }
  // Equivalent millimetre calibrations must produce the same native samples.
  // Round only floating-point transform noise, far below pixel resolution.
  const vertices=raw.map(p=>{const q=toPixel(p);return {...p,xMm:Math.round(q.xMm*1e8)/1e8,yMm:Math.round(q.yMm*1e8)/1e8};}),source:Point[]=[];
  // A closed raster boundary has no intrinsic first vertex. Use a stable
  // image-space origin so graph traversal cannot put the same physical tip
  // across the fitter's start/end seam and change the recovered geometry.
  if(closed&&vertices.length){let first=0;for(let i=1;i<vertices.length;i++)if(vertices[i].xMm<vertices[first].xMm||vertices[i].xMm===vertices[first].xMm&&vertices[i].yMm<vertices[first].yMm)first=i;if(first)vertices.push(...vertices.splice(0,first));}
  const world=(p:Point)=>({...p,...fromPixel(p)});
  let tipModel:ReturnType<typeof inferTips>|undefined;const model=()=>{
   if(tipModel)return tipModel;tipModel=inferTips(vertices,closed,width,height,rgba);
   const unsupported=tipModel.candidates.filter(c=>!c.accepted&&(c.fitError??Infinity)<.09);
   if(!closed&&materialPalette.length>=3&&materialPalette.length<=4&&unsupported.length&&materialBudget<4){
    for(const foreground of colors){if(materialBudget++>=4)break;const measured=materialTips(vertices,closed,foreground,materialPalette.filter(c=>c!==foreground),width,height,rgba);if(measured&&measured.source.length===tipModel.source.length)tipModel.candidates.push(...measured.candidates.filter(c=>c.accepted&&unsupported.some(p=>distance(p.tip,c.tip)<6)));}
   }
   return tipModel;
  };
  const polygon=closed?sourceTipPolygon(vertices,width,height,rgba,createId,model()):undefined;
  if(polygon){const nodes=polygon.nodes.map(world);return{nodes,curves:[],sourceBoundary:nodes};}
  const compact=closed?compactSourceBoundary(vertices,width,height,rgba,createId):undefined;
  if(compact){
   const polygon=compactPolygon(compact.points,createId);
   if(polygon)return {nodes:polygon.map(world),curves:[],sourceBoundary:compact.points.map(world)};
   const fitted=fitMeasuredBoundary(compact.points,true,createId,.15,p=>compact.tangents.get(p.id));
   // Two cubic semicircles are geometrically valid, but an editable CAD ring
   // requires at least three nodes. Subdivide exactly, without moving its path.
   if(fitted.nodes.length===2&&fitted.curves.length===2){
    const c=fitted.curves[0],a=fitted.nodes.find(p=>p.id===c.startNodeId)!,b=fitted.nodes.find(p=>p.id===c.endNodeId)!;
    const mid=(a:Point,b:Point):Point=>({id:createId(),xMm:(a.xMm+b.xMm)/2,yMm:(a.yMm+b.yMm)/2}),u=mid(a,c.c1),v=mid(c.c1,c.c2),w=mid(c.c2,b),l=mid(u,v),r=mid(v,w),m=mid(l,r);
    fitted.nodes.splice(fitted.nodes.indexOf(a)+1,0,m);fitted.curves.splice(0,1,{...c,endNodeId:m.id,c1:u,c2:l},{...c,id:createId(),startNodeId:m.id,c1:r,c2:w});
   }
   const allowance=vertices.reduce((sum,p,i)=>sum+distance(p,vertices[(i+1)%vertices.length]),0)*.5;
   const o=fromPixel({xMm:0,yMm:0}),u=fromPixel({xMm:1,yMm:0}),v=fromPixel({xMm:0,yMm:1}),areaScale=Math.abs((u.xMm-o.xMm)*(v.yMm-o.yMm)-(u.yMm-o.yMm)*(v.xMm-o.xMm));
   return{nodes:fitted.nodes.map(world),curves:fitted.curves.map(c=>({...c,c1:world(c.c1),c2:world(c.c2)})),sourceAreaAllowance:allowance*areaScale};
  }
  // Sparse orthogonal outlines already carry explicit corners, including
  // narrow exterior notches. RGB gradients across the opposite notch wall
  // are not valid tangent observations and must not round those corners.
  if(closed&&vertices.length<=16&&vertices.every((p,i)=>{const q=vertices[(i+1)%vertices.length];return distance(p,q)>=1.5&&(Math.abs(p.xMm-q.xMm)<1e-8||Math.abs(p.yMm-q.yMm)<1e-8);})){return {nodes:vertices.map(world),curves:[]};}
  if(raw.length<8)return;
  // Raster tracers collapse collinear runs. Sample by spatial distance before
  // estimating normals, so three neighbours never span an entire long side.
  for(let i=0;i<vertices.length-(closed?0:1);i++){const a=vertices[i],b=vertices[(i+1)%vertices.length],count=Math.max(1,Math.ceil(distance(a,b)-1e-8));if(!Number.isFinite(count)||count>40000-source.length)return;for(let j=0;j<count;j++)source.push(j?{id:createId(),xMm:a.xMm+(b.xMm-a.xMm)*j/count,yMm:a.yMm+(b.yMm-a.yMm)*j/count}:a);}
  if(!closed)source.push(vertices.at(-1)!);
  if(source.length>40000)return;
  const palette=[colors[0],colors[1]??'#ffffff'].map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)/255));
  const chromatic=palette.every(p=>Math.max(...p)>.2),normalize=(p:number[])=>chromatic?p.map(v=>v/(p.reduce((s,v)=>s+v,0)||1)):p;
  const a=normalize(palette[0]),b=normalize(palette[1]),delta=a.map((v,i)=>v-b[i]),norm=Math.hypot(...delta);if(norm<.025)return;
  const direction=delta.map(v=>v/norm);let supported=0,reliable=0,soft=0;const confidence=new Set<number>();
  const observed=source.map((p,i)=>{
   if(!closed&&(i===0||i===source.length-1))return p;
   const at=(offset:number)=>source[closed?(i+offset+source.length)%source.length:Math.max(0,Math.min(source.length-1,i+offset))];
   if(distance(p,at(-1))<.05||distance(p,at(1))<.05)return p;
   const before=at(-3),after=at(3),length=distance(before,after);if(length<1)return p;
   const nx=-(after.yMm-before.yMm)/length,ny=(after.xMm-before.xMm)/length;
   if(Array.from({length:17},(_,k)=>k/2-4).some(t=>{const x=Math.floor(p.xMm+nx*t-.5),y=Math.floor(p.yMm+ny*t-.5);return x<0||y<0||x>=width-1||y>=height-1||[0,1].some(dy=>[0,1].some(dx=>rgba[4*((y+dy)*width+x+dx)+3]!==255));}))return p;
   const nativeValue=(t:number)=>normalize(rgb({xMm:p.xMm+nx*t,yMm:p.yMm+ny*t})).reduce((s,v,c)=>s+v*direction[c],0);
   // A low-contrast JPEG edge can have a two-pixel chroma transition and
   // block-to-block ringing. First establish that the RGB transition really
   // is broad. Sharp painted edges keep their original local observations.
   const wideContrast=nativeValue(5)-nativeValue(-5),peakSlope=Math.max(...[-1.5,-1,-.5,0,.5,1,1.5].map(t=>Math.abs(nativeValue(t+.5)-nativeValue(t-.5))));
   const broad=colors.length===2&&norm<.12&&Math.abs(wideContrast)>=.035&&peakSlope<Math.abs(wideContrast)*.55;
   // Average only parallel measurements of that broad source transition;
   // do not average the contour coordinates or move a certified corner.
   const profile=(t:number)=>{
    const sum=[0,0,0];let weight=0;
    for(const s of [-2,-1,0,1,2]){
     const q={xMm:p.xMm+nx*t-ny*s,yMm:p.yMm+ny*t+nx*s};
     // At a cropped image edge use only observed pixels, with normalized
     // weights. Clamping the missing samples creates artificial end caps.
     if(q.xMm<.5||q.yMm<.5||q.xMm>width-.5||q.yMm>height-.5)continue;
     const x=Math.floor(q.xMm-.5),y=Math.floor(q.yMm-.5);
     if([0,1].some(dy=>[0,1].some(dx=>rgba[4*(Math.min(height-1,y+dy)*width+Math.min(width-1,x+dx))+3]!==255)))return;
     const w=3-Math.abs(s),c=rgb(q);weight+=w;for(let k=0;k<3;k++)sum[k]+=c[k]*w;
    }
    return weight>=4?sum.map(v=>v/weight):undefined;
   };
   const value=broad?(t:number)=>{const c=profile(t);return c?normalize(c).reduce((a,v,k)=>a+v*direction[k],0):NaN;}:nativeValue;
   const inner=broad?5:3,outer=broad?6:4,left=(value(-inner)+value(-outer))/2,right=(value(inner)+value(outer))/2,contrast=right-left;
   if(!Number.isFinite(contrast)||Math.abs(contrast)<.035)return p;
   const plates=[-outer,-inner,inner,outer].map(t=>broad?profile(t):rgb({xMm:p.xMm+nx*t,yMm:p.yMm+ny*t}));if(plates.some(q=>!q))return p;
   const midRGB=[0,1,2].map(c=>plates.reduce((sum,q)=>sum+q![c],0)/4),level=normalize(midRGB).reduce((sum,v,c)=>sum+v*direction[c],0),crossings:number[]=[];
   const search=broad?2.5:1;
   for(let t=-search;t<search;t+=.125){const u=value(t),v=value(t+.125);if((u-level)*(v-level)<=0&&Math.sign(v-u)===Math.sign(contrast)&&Math.abs(v-u)>.0001)crossings.push(t+.125*(level-u)/(v-u));}
   if(crossings.length!==1||Math.abs(crossings[0])>(broad?2:.8))return p;
   // A half-contrast crossing is meaningful only between settled plateaus.
   // Near another edge (or a blurred cap), truncated profiles otherwise move
   // an already quantized station farther into the material.
   const settled=Math.max(Math.abs(value(-inner)-value(-outer)),Math.abs(value(inner)-value(outer)))<Math.abs(contrast)*.12;
   if(!settled)return p;
   const t=crossings[0];supported++;if(Math.abs(value(t+.5)-value(t-.5))<Math.abs(contrast)*.32)soft++;if(broad||Math.abs(contrast)>=.08)reliable++;confidence.add(i);return {...p,xMm:p.xMm+nx*t,yMm:p.yMm+ny*t};
  });
  const tangents=new Map<string,XY>();
  for(let i=0;i<observed.length;i++)if(confidence.has(i)){const p=observed[i],values=(x:number,y:number)=>normalize(rgb({xMm:x,yMm:y})).reduce((s,v,c)=>s+v*direction[c],0),gx=values(p.xMm+.4,p.yMm)-values(p.xMm-.4,p.yMm),gy=values(p.xMm,p.yMm+.4)-values(p.xMm,p.yMm-.4),length=Math.hypot(gx,gy);if(length<.008)continue;const before=observed[(i-1+observed.length)%observed.length],after=observed[(i+1)%observed.length],sign=Math.sign(-gy*(after.xMm-before.xMm)+gx*(after.yMm-before.yMm));tangents.set(p.id,{xMm:-gy/length*sign,yMm:gx/length*sign});}
  const area=(r:XY[])=>r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p.xMm*q.yMm-q.xMm*p.yMm;},0)/2;
  const reliableSource=reliable>=source.length*.65&&(!closed||Math.abs(area(observed)-area(vertices))<=Math.max(.64,Math.abs(area(vertices))*.03));
  const softSource=closed&&reliableSource&&soft>=supported*.98;
  // Uncertain raster stations are corridor constraints, not subpixel
  // measurements. They must not pull a measured curve toward pixel stairs.
  const supportedPoints=observed.filter((_,i)=>confidence.has(i)||!closed&&(i===0||i===observed.length-1));
  const missingRun=observed.some((_,i)=>!confidence.has(i)&&(closed||i+1<observed.length)&&!confidence.has((i+1)%observed.length));
  // A hard raster contains only the two opaque plateau colours. Its local
  // bilinear derivative follows pixel stairs and is not a measured tangent.
  const plateau=palette.map(p=>p.map(v=>v*255));
  const hardSource=source.every(p=>{
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const x=Math.floor(p.xMm)+dx,y=Math.floor(p.yMm)+dy;if(x<0||y<0||x>=width||y>=height)return false;
    const index=4*(y*width+x);if(rgba[index+3]!==255||!plateau.some(c=>c.every((v,k)=>Math.abs(v-rgba[index+k])<=1)))return false;
   }return true;
  });
  // Opaque two-colour pixels contain a quantized boundary, not measured
  // subpixel tangents. Fitting their interpolated RGB staircase creates false
  // curvature (especially on nearly horizontal sides). Recover the original
  // shared trace within its pixel corridor instead.
  if(hardSource){
   const raster=closed?recoverContour(geometryPiece({nodes:vertices,curves:[],holes:[]}),.8,createId):recoverBoundaryChain(vertices,.8,createId);
   return {nodes:raster.nodes.map(world),curves:(raster.curves??[]).map(c=>({...c,c1:world(c.c1),c2:world(c.c2)}))};
  }
  const lineProposal=reliableSource&&!softSource?fitMeasuredBoundary(supportedPoints,closed,createId):undefined;
  // Bridge only an isolated missing crossing between two measured stations.
  // Its raster position creates a sideways step on a soft cap. Consecutive
  // missing stations retain their original boundary: skipping a whole side
  // would join unrelated measurements across an unobserved region.
  const softPoints=softSource?observed.filter((_,i)=>confidence.has(i)||!confidence.has((i-1+source.length)%source.length)||!confidence.has((i+1)%source.length)):supportedPoints;
  // Reserve part of the native-pixel envelope for source localization. The
  // curve approximation must not spend that same uncertainty a second time.
  let fitted=supported<source.length*.65?(closed?recoverBoundaryLoop(source,.8,createId,new Set()):recoverBoundaryChain(source,.8,createId)):softSource?fitMeasuredBoundary(softPoints,closed,createId,.25,p=>tangents.get(p.id)):reliableSource?(hardSource||lineProposal?.straightSupported?lineProposal!:fitMeasuredBoundary(supportedPoints,closed,createId,.25,p=>tangents.get(p.id))):fitMeasuredBoundary(supportedPoints,closed,createId);
  // Reject bridging a missing run unless the COMPLETE original trace is
  // still covered in both directions. A failed bridge is refitted with its
  // unobserved stations retained, never silently cut across a notch.
  const needsRasterFallback=supported>=source.length*.65&&missingRun&&!sourceSpliceBase(fitted,observed,closed,createId);
  if(needsRasterFallback){
   // Rejected crossings are pixel-cell constraints, not accurate samples.
   // Interpolating every one to 0.1 px mixes shifted RGB stations with raw
   // stair corners, creating backwards tangents along a smooth painted side.
   // Recover within the unchanged raw corridor instead, and revoke the RGB
   // baseline for this fallback. Certified tip splices below still apply.
   // Source-certified tips must still see their original measured proposal.
   // Use the raster fallback only if no certified splice below succeeds.
   fitted=fitMeasuredBoundary(observed,closed,createId,.1,p=>tangents.get(p.id));
  }

  const partial=partialTips(vertices,source,observed,closed,width,height,rgba,createId,model());
  if(partial){
   // Certified tips are interpolation constraints, not independent patches
   // pasted onto a curve. Fit their surviving measured spans together so
   // window endpoints cannot introduce new corners. All tips in a merged
   // window are protected, including its intermediate `through` vertices.
   const measuredIds=new Set(source.filter((_,i)=>confidence.has(i)).map(p=>p.id));
   const stations=partial.points.filter((p,i)=>partial.tips.has(p.id)||measuredIds.has(p.id)||!closed&&(i===0||i===partial.points.length-1));
   if(stations.length>=3&&supported>=source.length*.65){
    const joint=fitMeasuredBoundary(stations,closed,createId,.25,p=>tangents.get(p.id),partial.tips);
    if((!closed||joint.nodes.length>=3)&&sourceSpliceBase(joint,partial.baseline,closed,createId)&&(!closed||safeContour(geometryPiece({...joint,holes:[]}),geometryPiece({nodes:partial.baseline,curves:[],holes:[]}),.8)))return{nodes:joint.nodes.map(world),curves:joint.curves.map(c=>({...c,c1:world(c.c1),c2:world(c.c2)})),sourceBoundary:partial.baseline.map(world)};
   }
   const raster=()=>{const result=closed?recoverContour(geometryPiece({nodes:vertices,holes:[],curves:[]}),.8,createId):recoverBoundaryChain(vertices,.8,createId);return{nodes:result.nodes,curves:result.curves??[]};};
   const bases:(()=>typeof fitted)[]=[];
   // A corner replacement can remove the very span which failed the raster
   // corridor. Validate the completed splice below, instead of rejecting its
   // otherwise measured sides before the replacement is applied.
   if(supported>=source.length*.65)bases.push(()=>fitted);
   if(lineProposal&&lineProposal!==fitted)bases.push(()=>lineProposal);
   bases.push(()=>fitMeasuredBoundary(source,closed,createId,.65));
   bases.push(raster);
   // A compact raster fit can itself exceed the source corridor at a nearby
   // junction. Keep the exact source outside certified windows as the final
   // fallback, instead of discarding independently measured corners.
   const proposals:(typeof fitted|undefined)[]=[];
   // Exhaust both curved splice variants before the exact stair-step trace.
   // Otherwise its trivially valid corridor hides a usable curved proposal.
   for(const pass of [0,1,2])for(let i=0;i<(pass===2?1:bases.length);i++){const base=pass===2?{nodes:vertices,curves:[]}:(proposals[i]??=bases[i]());const replacement=spliceSourceTips(base,closed,partial.windows,createId,true,vertices,pass!==1);
    // The original fitted can be valid while its splice anchors make the new
    // path invalid. Verify the completed proposal against the certified tip
    // boundary before choosing it; otherwise try the preserved raster fitted.
    if(replacement&&sourceSpliceBase(replacement,partial.baseline,closed,createId)&&(!closed||safeContour(geometryPiece({...replacement,holes:[]}),geometryPiece({nodes:partial.baseline,holes:[],curves:[]}),.8)))return{nodes:replacement.nodes.map(world),curves:replacement.curves.map(c=>({...c,c1:world(c.c1),c2:world(c.c2)})),sourceBoundary:partial.baseline.map(world)};
   }
  }
  if(supported<source.length*.65){
   // Insufficient RGB evidence does not justify relocating the outline. It
   // can still support a compact piecewise fit to the original pixel-cell
   // boundary, with the same bidirectional corridor and topology checks.
   const compact=fitMeasuredBoundary(source,closed,createId,.65);
   if(compact.nodes.length>=3&&compact.nodes.length<fitted.nodes.length&&sourceSpliceBase(compact,source,closed,createId)&&(!closed||safeContour(geometryPiece({...compact,holes:[]}),geometryPiece({nodes:source,curves:[],holes:[]}),.8)))return {nodes:compact.nodes.map(world),curves:compact.curves.map(c=>({...c,c1:world(c.c1),c2:world(c.c2)}))};
   return;
  }
  // Construct this optional fallback only after certified tips have failed.
  // Longer raw chains cannot pass sourceSpliceBase's existing work budget.
  let rasterFallback:typeof fitted|undefined;
  if(needsRasterFallback&&source.length<=2048){
   const raster=closed?recoverBoundaryLoop(source,.8,createId,new Set()):bridgeRasterCaps(recoverBoundaryChain(source,.8,createId),source,createId);
   if(sourceSpliceBase(raster,source,closed,createId))fitted=rasterFallback=raster;
  }
  if(closed&&fitted.nodes.length===2&&fitted.curves.length===2){const c=fitted.curves[0],a=fitted.nodes.find(p=>p.id===c.startNodeId)!,b=fitted.nodes.find(p=>p.id===c.endNodeId)!,mid=(a:Point,b:Point):Point=>({id:createId(),xMm:(a.xMm+b.xMm)/2,yMm:(a.yMm+b.yMm)/2}),u=mid(a,c.c1),v=mid(c.c1,c.c2),w=mid(c.c2,b),l=mid(u,v),r=mid(v,w),m=mid(l,r);fitted.nodes.splice(fitted.nodes.indexOf(a)+1,0,m);fitted.curves.splice(0,1,{...c,endNodeId:m.id,c1:u,c2:l},{...c,id:createId(),startNodeId:m.id,c1:r,c2:w});}
  return {nodes:fitted.nodes.map(world),curves:fitted.curves.map(c=>({...c,c1:world(c.c1),c2:world(c.c2)})),sourceBoundary:reliableSource&&!rasterFallback?observed.map(world):undefined,rasterAreaBound:reliableSource&&!rasterFallback};
 };
 fit.prepare=(branches)=>{materialPalette=[...new Set(branches.flatMap(b=>b.colors))].sort();materialBudget=0;const pixels=branches.map(b=>({...b,raw:b.raw.map(p=>{const q=toPixel(p);return {...p,xMm:Math.round(q.xMm*1e8)/1e8,yMm:Math.round(q.yMm*1e8)/1e8};})})),result=sourceJunctions(pixels,width,height,rgba);junctionCorners=result?.corners??[];const short=shortMaterialBranches(pixels.map((b,i)=>({...b,raw:result?.output[i]??b.raw})),width,height,rgba);junctionCorners.push(...short?.corners??[]);return(short?.output??result?.output)?.map(r=>r.map(p=>({...p,...fromPixel(p)})));};return fit;
}

/** Error-driven line/cubic reconstruction of measured subpixel samples.
 * Recursive approximation splits share one measured tangent; real source
 * corners do not. No sample is averaged or moved to make a join look smooth. */
export function fitMeasuredBoundary(points:Point[],closed:boolean,createId:()=>string,tolerance=.65,tangentAt?:(p:Point)=>XY|undefined,protectedCorners:ReadonlySet<string>=new Set()){
 const nodes:Point[]=[],curves:Curve[]=[],lines:{a:Point;b:Point;nx:number;ny:number;d:number;points:Point[]}[]=[];
 const unit=(x:number,y:number):XY|undefined=>{const d=Math.hypot(x,y);return d>1e-10?{xMm:x/d,yMm:y/d}:undefined;};
 const tangent=(p:Point[],i:number)=>{
  const step=Math.min(3,i,p.length-1-i),a=p[i-step],b=p[i+step];
  // The derivative of bilinear RGB changes at every pixel-cell boundary.
  // Use the measured boundary's two-sided direction at an approximation
  // split; sharing a noisy single-pixel gradient produces many tiny cubics.
  const before=p[i-1],at=p[i],after=p[i+1];
  const component=(axis:'xMm'|'yMm')=>(at[axis]-before[axis])*(after[axis]-at[axis])<=0?0:b[axis]-a[axis];
  // At a measured extremum or plateau the derivative cannot point beyond
  // the observed range. Both incident spans use this same direction.
  // A station which reverses both axes has no admissible shared tangent.
  // Falling back to the wider chord here makes a two-point cubic run back
  // past that station; keep independent incident spans at this raster cusp.
  return unit(component('xMm'),component('yMm'));
 };
 const fit=(p:Point[],depth=0,incoming?:XY,outgoing?:XY)=>{
  const a=p[0],b=p.at(-1)!;if(p.length<3||depth>20){
   nodes.push(...p.slice(0,-1));
   if(p.length===2&&(incoming||outgoing)&&distance(a,b)>1e-10){
    const chord=unit(b.xMm-a.xMm,b.yMm-a.yMm)!,ta=incoming??chord,tb=outgoing??chord,h=Math.min(distance(a,b)/3,tolerance/2);
    curves.push({id:createId(),startNodeId:a.id,endNodeId:b.id,c1:{id:createId(),xMm:a.xMm+h*ta.xMm,yMm:a.yMm+h*ta.yMm},c2:{id:createId(),xMm:b.xMm-h*tb.xMm,yMm:b.yMm-h*tb.yMm}});
   }return;
  }
  const fixed=p.findIndex((q,i)=>i>0&&i+1<p.length&&protectedCorners.has(q.id));
  if(fixed>=0){fit(p.slice(0,fixed+1),depth+1,incoming);fit(p.slice(fixed),depth+1,undefined,outgoing);return;}
  if(!incoming&&!outgoing&&distance(a,b)>12&&(!tangentAt||p.every(q=>!tangentAt(q)))){
   // Shared junctions stay fixed on the raster topology. Estimate the line
   // from the measured interior, so a quantized endpoint cannot bow a straight edge.
   const interior=p.filter(q=>distance(a,q)>=2&&distance(b,q)>=2);
   const samples=interior.length>=4?interior:p;
   const cx=samples.reduce((s,q)=>s+q.xMm,0)/samples.length,cy=samples.reduce((s,q)=>s+q.yMm,0)/samples.length;
   let xx=0,xy=0,yy=0;for(const q of samples){xx+=(q.xMm-cx)**2;xy+=(q.xMm-cx)*(q.yMm-cy);yy+=(q.yMm-cy)**2;}
   const angle=.5*Math.atan2(2*xy,xx-yy),nx=-Math.sin(angle),ny=Math.cos(angle),offsets=samples.map(q=>nx*(q.xMm-cx)+ny*(q.yMm-cy));
   // Bilinear RGB sampling of a hard diagonal alternates across the pixel
   // grid. A long straight support may span that one-pixel uncertainty; a
   // shorter arc must still pass the tighter strip before it becomes a line.
   if(Math.max(...offsets)-Math.min(...offsets)<=(distance(a,b)>28?1:.6)){
    const offset=(Math.max(...offsets)+Math.min(...offsets))/2;
    let first=1,last=p.length-2;while(first<last&&distance(a,p[first])<2)first++;while(last>first&&distance(b,p[last])<2)last--;
    const project=(q:Point)=>{const t=offset-nx*(q.xMm-cx)-ny*(q.yMm-cy);return {...q,id:createId(),xMm:q.xMm+nx*t,yMm:q.yMm+ny*t};};
    if(first<last){nodes.push(a,project(p[first]),project(p[last]));lines.push({a,b,nx,ny,d:offset+nx*cx+ny*cy,points:p});return;}
   }
  }
  const errors=p.map(v=>segmentDistance(v,a,b)),lineError=Math.max(...errors);
  const startTangent=incoming??tangentAt?.(a),endTangent=outgoing??tangentAt?.(b),chord=distance(a,b),aligned=(t:XY|undefined)=>!t||chord>0&&Math.abs(t.xMm*(b.yMm-a.yMm)-t.yMm*(b.xMm-a.xMm))/chord<1e-7&&(t.xMm*(b.xMm-a.xMm)+t.yMm*(b.yMm-a.yMm))>0,joinAllowsLine=aligned(incoming)&&aligned(outgoing),straightDerivative=!startTangent||!endTangent||chord===0||[startTangent,endTangent].every(t=>Math.abs(t.xMm*(b.yMm-a.yMm)-t.yMm*(b.xMm-a.xMm))/chord<.03);
  // Across several native pixels the observed positions can certify a
  // straight span even if endpoint RGB gradients tilt at a pixel-cell edge.
  // Short arcs still require tangent agreement to avoid polygonizing a dot.
  if(joinAllowsLine&&(lineError<=.01||lineError<=Math.min(.35,tolerance)&&(straightDerivative||chord>=4&&p.length>=6))){nodes.push(a);return;}
  // A hard pixel staircase can turn sharply over three samples even when its
  // supporting edge is straight. A real cusp persists over several native
  // pixels on both sides; test that larger scale before splitting the fit.
  let corner=-1,strength=.65;
  for(let i=6;i<p.length-6;i++){const u=p[i-6],v=p[i],w=p[i+6],l=distance(u,v),r=distance(v,w);if(l<4||r<4)continue;const cosine=persistentTurn(p,i);if(cosine<strength){strength=cosine;corner=i;}}
  if(corner>=0){fit(p.slice(0,corner+1),depth+1,incoming);fit(p.slice(corner),depth+1,undefined,outgoing);return;}
  const arc=[0];for(let i=1;i<p.length;i++)arc.push(arc.at(-1)!+distance(p[i-1],p[i]));const total=arc.at(-1)!;
  let parameters=arc.map(v=>v/total);
  for(let iteration=0;iteration<5;iteration++){
  let aa=0,ab=0,bb=0,ax=0,ay=0,bx=0,by=0;
  for(let i=1;i<p.length-1;i++){const t=parameters[i],s=1-t,u=3*s*s*t,v=3*s*t*t,x=p[i].xMm-s*s*s*a.xMm-t*t*t*b.xMm,y=p[i].yMm-s*s*s*a.yMm-t*t*t*b.yMm;aa+=u*u;ab+=u*v;bb+=v*v;ax+=u*x;ay+=u*y;bx+=v*x;by+=v*y;}
  const determinant=aa*bb-ab*ab;
  if(determinant>1e-12){
   let c1:Point={id:createId(),xMm:(ax*bb-bx*ab)/determinant,yMm:(ay*bb-by*ab)/determinant},c2:Point={id:createId(),xMm:(bx*aa-ax*ab)/determinant,yMm:(by*aa-ay*ab)/determinant};
   const ta=incoming??tangentAt?.(a),tb=outgoing??tangentAt?.(b);
   // A constrained endpoint may not silently fall back to an independent
   // control fit: that would reintroduce a kink at the recursive split.
   let constraintsValid=true;
   if(ta&&tb){
    const dot=ta.xMm*tb.xMm+ta.yMm*tb.yMm,crossTerm=-ab*dot,det=aa*bb-crossTerm*crossTerm;
    const rx=ax-aa*a.xMm-ab*b.xMm,ry=ay-aa*a.yMm-ab*b.yMm,sx=bx-ab*a.xMm-bb*b.xMm,sy=by-ab*a.yMm-bb*b.yMm,u=rx*ta.xMm+ry*ta.yMm,v=-sx*tb.xMm-sy*tb.yMm;
    const alpha=(u*bb-v*crossTerm)/det,beta=(v*aa-u*crossTerm)/det;
    if(det>1e-12&&alpha>0&&beta>0&&alpha<total&&beta<total){c1={id:c1.id,xMm:a.xMm+alpha*ta.xMm,yMm:a.yMm+alpha*ta.yMm};c2={id:c2.id,xMm:b.xMm-beta*tb.xMm,yMm:b.yMm-beta*tb.yMm};}else constraintsValid=false;
   }else if(ta||tb){
    // Solve a one-sided tangent plus the opposite free control jointly.
    // Eliminating the free control leaves a scalar normal equation.
    if(ta){const d=aa-ab*ab/bb,alpha=((ax-d*a.xMm-ab*bx/bb)*ta.xMm+(ay-d*a.yMm-ab*by/bb)*ta.yMm)/d;
     constraintsValid=d>1e-12&&alpha>0&&alpha<total;
     if(constraintsValid){c1={...c1,xMm:a.xMm+alpha*ta.xMm,yMm:a.yMm+alpha*ta.yMm};c2={...c2,xMm:(bx-ab*c1.xMm)/bb,yMm:(by-ab*c1.yMm)/bb};}
    }else if(tb){const d=bb-ab*ab/aa,beta=-((bx-d*b.xMm-ab*ax/aa)*tb.xMm+(by-d*b.yMm-ab*ay/aa)*tb.yMm)/d;
     constraintsValid=d>1e-12&&beta>0&&beta<total;
     if(constraintsValid){c2={...c2,xMm:b.xMm-beta*tb.xMm,yMm:b.yMm-beta*tb.yMm};c1={...c1,xMm:(ax-ab*c2.xMm)/aa,yMm:(ay-ab*c2.yMm)/aa};}
    }
   }
   const at=(t:number):XY=>{const s=1-t;return {xMm:s*s*s*a.xMm+3*s*s*t*c1.xMm+3*s*t*t*c2.xMm+t*t*t*b.xMm,yMm:s*s*s*a.yMm+3*s*s*t*c1.yMm+3*s*t*t*c2.yMm+t*t*t*b.yMm};};
   // Check extrema between observations too. A small least-squares residual
   // at the samples does not justify a new bulge beyond their measured range.
   // Solve the cubic derivative exactly; do not clamp or smooth the path.
   const bounded=(axis:'xMm'|'yMm')=>{
    const low=Math.min(...p.map(q=>q[axis]))-.01,high=Math.max(...p.map(q=>q[axis]))+.01;
    const A=-a[axis]+3*c1[axis]-3*c2[axis]+b[axis],B=2*(a[axis]-2*c1[axis]+c2[axis]),C=c1[axis]-a[axis],discriminant=B*B-4*A*C;
    const roots=Math.abs(A)<1e-12?(Math.abs(B)>1e-12?[-C/B]:[]):discriminant>=0?[(-B-Math.sqrt(discriminant))/(2*A),(-B+Math.sqrt(discriminant))/(2*A)]:[];
    return roots.every(t=>t<=0||t>=1||at(t)[axis]>=low&&at(t)[axis]<=high);
   };
   const error=Math.max(...p.map((q,i)=>distance(q,at(parameters[i]))));
   if(constraintsValid&&error<=tolerance&&(!tangentAt||bounded('xMm')&&bounded('yMm'))&&distance(a,c1)+distance(c1,c2)+distance(c2,b)<total*1.5){nodes.push(a);if(incoming||outgoing||!tangentAt||Math.max(segmentDistance(c1,a,b),segmentDistance(c2,a,b))>.03)curves.push({id:createId(),startNodeId:a.id,endNodeId:b.id,c1,c2});return;}
   if(!constraintsValid)break;
   // Reassign only curve parameters, never source coordinates. Chord length
   // is an initial guess, not the location of a measurement on a cubic.
   const next=[...parameters];let change=0;
   for(let i=1;i+1<p.length;i++){
    const t=parameters[i],s=1-t,q=at(t),rx=q.xMm-p[i].xMm,ry=q.yMm-p[i].yMm,
     dx=3*(s*s*(c1.xMm-a.xMm)+2*s*t*(c2.xMm-c1.xMm)+t*t*(b.xMm-c2.xMm)),dy=3*(s*s*(c1.yMm-a.yMm)+2*s*t*(c2.yMm-c1.yMm)+t*t*(b.yMm-c2.yMm)),
     ddx=6*(s*(c2.xMm-2*c1.xMm+a.xMm)+t*(b.xMm-2*c2.xMm+c1.xMm)),ddy=6*(s*(c2.yMm-2*c1.yMm+a.yMm)+t*(b.yMm-2*c2.yMm+c1.yMm)),den=dx*dx+dy*dy+rx*ddx+ry*ddy;
    if(den>1e-12){next[i]=Math.max((parameters[i-1]+t)/2,Math.min((t+parameters[i+1])/2,t-(rx*dx+ry*dy)/den));change=Math.max(change,Math.abs(next[i]-t));}
   }
   parameters=next;if(change<1e-7)break;
  }else break;
  }
  let split=errors.indexOf(lineError);if(split<1||split>=p.length-1)split=Math.floor(p.length/2);
  const shared=tangent(p,split);
  fit(p.slice(0,split+1),depth+1,incoming,shared);fit(p.slice(split),depth+1,shared,outgoing);
 };
 if(closed){
  // The traced ring's first sample is arbitrary. Starting a fit a few pixels
  // before a corner hides that corner at the open-span endpoint, where the
  // two-sided cusp test cannot see it and a short cubic can round it. Split
  // at measured, persistent cusps when present; smooth loops keep the old
  // farthest-point division.
  const n=points.length,cusps:{index:number;cosine:number}[]=[];
  if(n>=13)for(let i=0;i<n;i++){const u=points[(i-6+n)%n],v=points[i],w=points[(i+6)%n],l=distance(u,v),r=distance(v,w);if(l<4||r<4)continue;const cosine=persistentTurn(points,i,true);if(cosine<.65)cusps.push({index:i,cosine});}
  cusps.sort((a,b)=>a.cosine-b.cosine);
  const fixedStart=points.findIndex(p=>protectedCorners.has(p.id)),start=fixedStart>=0?fixedStart:cusps[0]?.index??0,ring=[...points.slice(start),...points.slice(0,start)];
  let opposite=1;for(let i=2;i<n;i++)if(distance(ring[0],ring[i])>distance(ring[0],ring[opposite]))opposite=i;
  const farthest=distance(ring[0],ring[opposite]);
  const other=cusps.map(c=>({index:(c.index-start+n)%n,length:distance(ring[0],points[c.index])})).filter(c=>c.index>0&&c.length>=farthest*.75).sort((a,b)=>b.length-a.length)[0];
  if(other)opposite=other.index;
  const cyclicTangent=(i:number)=>tangentAt?.(ring[i])??unit(ring[(i+Math.min(3,Math.floor(n/3)))%n].xMm-ring[(i-Math.min(3,Math.floor(n/3))+n)%n].xMm,ring[(i+Math.min(3,Math.floor(n/3)))%n].yMm-ring[(i-Math.min(3,Math.floor(n/3))+n)%n].yMm);
  const startDirection=protectedCorners.has(ring[0].id)||cusps.length||n<13?undefined:cyclicTangent(0),oppositeDirection=protectedCorners.has(ring[opposite].id)||other||n<13?undefined:cyclicTangent(opposite);
  fit(ring.slice(0,opposite+1),0,startDirection,oppositeDirection);fit([...ring.slice(opposite),ring[0]],0,oppositeDirection,startDirection);
 }else{fit(points);nodes.push(points.at(-1)!);}
 const allLines=lines.length>0&&curves.length===0&&nodes.length===lines.length*3+(closed?0:1);
 if(closed&&protectedCorners.size===0&&allLines&&lines.length>=3&&lines.every((l,i)=>l.b.id===lines[(i+1)%lines.length].a.id)){
  // Intersect independently measured incident lines. The quantized corner
  // anchor and its two short connector stubs carry no additional RGB evidence.
  const intersections=lines.map((l,i)=>{const previous=lines[(i+lines.length-1)%lines.length],det=previous.nx*l.ny-previous.ny*l.nx;
   if(Math.abs(det)<.1)return undefined;
   const p={id:l.a.id,xMm:(previous.d*l.ny-previous.ny*l.d)/det,yMm:(previous.nx*l.d-previous.d*l.nx)/det};
   return distance(p,l.a)<=2?p:undefined;
  });
  if(intersections.every((p):p is Point=>!!p)&&lines.every((l,i)=>{
   const a=intersections[i],b=intersections[(i+1)%lines.length];
   // Endpoint coverage plus the connected observed span bounds the reverse
   // direction too; a new line cannot extend into an unobserved terminal gap.
   return distance(a,l.a)<=1&&distance(b,l.b)<=1&&l.points.every(p=>segmentDistance(p,a,b)<=1);
  })&&safeContour(geometryPiece({nodes:intersections,curves:[],holes:[]}),geometryPiece({nodes:points,curves:[],holes:[]}),.8))return {nodes:intersections,curves,straightSupported:true};
 }
 return {nodes,curves,straightSupported:!closed&&allLines};
}
