import {safeContour} from './contour-topology';
import {sourceSpliceBase} from './image-tip-source-tube';
import {spliceSourceTips} from './image-tip-splice';
import {sourceJunctions} from './image-tip-junctions';
import {partialTips} from './image-tip-partial';
import {recoverContour,recoverBoundaryChain,recoverBoundaryLoop} from './recover-contour';
import type {Point,Piece} from '../schema/index';
import {compactSourceBoundary} from './image-compact-contour';
import {inferTips,sourceTipPolygon} from './image-line-corners';
type Curve=NonNullable<Piece['curves']>[number];
const geometryPiece=(shape:Pick<Piece,'nodes'>&Partial<Pick<Piece,'curves'|'holes'>>):Piece=>({id:'',name:'',closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'',furRad:0,color:'#ffffff',...shape});
type XY={xMm:number;yMm:number};
export type BoundaryBranch={raw:Point[];closed:boolean;colors:string[]};
export type BoundaryFit=((points:Point[],closed:boolean,colors:string[],createId:()=>string)=>{nodes:Point[];curves:Curve[];sourceAreaAllowance?:number;sourceBoundary?:Point[]}|undefined)&{prepare?:(branches:BoundaryBranch[],contours:Piece[])=>Point[][]|undefined};
const distance=(a:XY,b:XY)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
const segmentDistance=(p:XY,a:XY,b:XY)=>{const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);};

/** Locate the material transition in the source RGB samples, before fitting a
 * path. Coordinates are pixel centres; a half-contrast crossing avoids the two
 * derivative ridges of a blurred/inked edge. There is no path smoothing pass. */
export function imageBoundaryFit(width:number,height:number,rgba:Uint8Array,toPixel:(p:XY)=>XY,fromPixel:(p:XY)=>XY):BoundaryFit{
 if(rgba.length!==width*height*4)throw Error('IMAGE_LIMIT');
 const rgb=(p:XY)=>{const x=Math.max(0,Math.min(width-1,p.xMm-.5)),y=Math.max(0,Math.min(height-1,p.yMm-.5)),ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;return [0,1,2].map(c=>{const at=(dx:number,dy:number)=>rgba[(Math.min(height-1,iy+dy)*width+Math.min(width-1,ix+dx))*4+c]/255;return at(0,0)*(1-tx)*(1-ty)+at(1,0)*tx*(1-ty)+at(0,1)*(1-tx)*ty+at(1,1)*tx*ty;});};
 const fit:BoundaryFit=(raw,closed,colors,createId)=>{
  // Equivalent millimetre calibrations must produce the same native samples.
  // Round only floating-point transform noise, far below pixel resolution.
  const vertices=raw.map(p=>{const q=toPixel(p);return {...p,xMm:Math.round(q.xMm*1e8)/1e8,yMm:Math.round(q.yMm*1e8)/1e8};}),source:Point[]=[];
  const world=(p:Point)=>({...p,...fromPixel(p)});
  let tipModel:ReturnType<typeof inferTips>|undefined;const model=()=>tipModel??=inferTips(vertices,closed,width,height,rgba);
  const polygon=closed?sourceTipPolygon(vertices,width,height,rgba,createId,model()):undefined;
  if(polygon){const nodes=polygon.nodes.map(world);return{nodes,curves:[],sourceBoundary:nodes};}
  const compact=closed?compactSourceBoundary(vertices,width,height,rgba,createId):undefined;
  if(compact){
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
   const value=(t:number)=>normalize(rgb({xMm:p.xMm+nx*t,yMm:p.yMm+ny*t})).reduce((s,v,c)=>s+v*direction[c],0);
   const left=(value(-3)+value(-4))/2,right=(value(3)+value(4))/2,contrast=right-left;
   if(Math.abs(contrast)<.035)return p;
   const plates=[-4,-3,3,4].map(t=>rgb({xMm:p.xMm+nx*t,yMm:p.yMm+ny*t})),midRGB=[0,1,2].map(c=>plates.reduce((sum,q)=>sum+q[c],0)/4),level=normalize(midRGB).reduce((sum,v,c)=>sum+v*direction[c],0),crossings:number[]=[];
   for(let t=-1;t<1;t+=.125){const u=value(t),v=value(t+.125);if((u-level)*(v-level)<=0&&Math.sign(v-u)===Math.sign(contrast)&&Math.abs(v-u)>.0001)crossings.push(t+.125*(level-u)/(v-u));}
   if(crossings.length!==1||Math.abs(crossings[0])>.8)return p;
   const t=crossings[0];supported++;if(Math.abs(value(t+.5)-value(t-.5))<Math.abs(contrast)*.32)soft++;if(Math.abs(contrast)>=.08&&Math.max(Math.abs(value(-3)-value(-4)),Math.abs(value(3)-value(4)))<Math.abs(contrast)*.12)reliable++;confidence.add(i);return {...p,xMm:p.xMm+nx*t,yMm:p.yMm+ny*t};
  });
  const tangents=new Map<string,XY>();
  for(let i=0;i<observed.length;i++)if(confidence.has(i)){const p=observed[i],values=(x:number,y:number)=>normalize(rgb({xMm:x,yMm:y})).reduce((s,v,c)=>s+v*direction[c],0),gx=values(p.xMm+.4,p.yMm)-values(p.xMm-.4,p.yMm),gy=values(p.xMm,p.yMm+.4)-values(p.xMm,p.yMm-.4),length=Math.hypot(gx,gy);if(length<.008)continue;const before=observed[(i-1+observed.length)%observed.length],after=observed[(i+1)%observed.length],sign=Math.sign(-gy*(after.xMm-before.xMm)+gx*(after.yMm-before.yMm));tangents.set(p.id,{xMm:-gy/length*sign,yMm:gx/length*sign});}
  const area=(r:XY[])=>r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p.xMm*q.yMm-q.xMm*p.yMm;},0)/2;
  const reliableSource=reliable>=source.length*.65&&(!closed||Math.abs(area(observed)-area(vertices))<=Math.max(.64,Math.abs(area(vertices))*.03));
  const softSource=closed&&reliableSource&&soft>=supported*.98;
  const supportedPoints=observed.filter((_,i)=>confidence.has(i)||!closed&&(i===0||i===observed.length-1));
  // A hard raster contains only the two opaque plateau colours. Its local
  // bilinear derivative follows pixel stairs and is not a measured tangent.
  const plateau=palette.map(p=>p.map(v=>v*255));
  const hardSource=reliableSource&&source.every(p=>{
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const x=Math.floor(p.xMm)+dx,y=Math.floor(p.yMm)+dy;if(x<0||y<0||x>=width||y>=height)return false;
    const index=4*(y*width+x);if(rgba[index+3]!==255||!plateau.some(c=>c.every((v,k)=>Math.abs(v-rgba[index+k])<=1)))return false;
   }return true;
  });
  const lineProposal=reliableSource&&!softSource?fitMeasuredBoundary(supportedPoints,closed,createId):undefined;
  const fit=supported<source.length*.65?(closed?recoverBoundaryLoop(source,.8,createId,new Set()):recoverBoundaryChain(source,.8,createId)):softSource?fitMeasuredBoundary(observed,closed,createId,.25,p=>tangents.get(p.id)):reliableSource?(hardSource||lineProposal?.straightSupported?lineProposal!:fitMeasuredBoundary(supportedPoints,closed,createId,.35,p=>tangents.get(p.id))):fitMeasuredBoundary(supportedPoints,closed,createId);

  const partial=partialTips(vertices,source,source,closed,width,height,rgba,createId,model());
  if(partial){
   const raster=()=>{const result=closed?recoverContour(geometryPiece({nodes:vertices,holes:[],curves:[]}),.8,createId):recoverBoundaryChain(vertices,.8,createId);return{nodes:result.nodes,curves:result.curves??[]};};
   const bases:(()=>typeof fit)[]=[];
   if(supported>=source.length*.65&&sourceSpliceBase(fit,vertices,closed,createId))bases.push(()=>fit);
   bases.push(raster);
   for(const base of bases){const replacement=spliceSourceTips(base(),closed,partial.windows,createId);
    // The original fit can be valid while its splice anchors make the new
    // path invalid. Verify the completed proposal against the certified tip
    // boundary before choosing it; otherwise try the preserved raster fit.
    if(replacement&&sourceSpliceBase(replacement,partial.baseline,closed,createId)&&(!closed||safeContour(geometryPiece({...replacement,holes:[]}),geometryPiece({nodes:partial.baseline,holes:[],curves:[]}),.8)))return{nodes:replacement.nodes.map(world),curves:replacement.curves.map(c=>({...c,c1:world(c.c1),c2:world(c.c2)})),sourceBoundary:partial.baseline.map(world)};
   }
  }
  if(supported<source.length*.65)return;
  if(closed&&fit.nodes.length===2&&fit.curves.length===2){const c=fit.curves[0],a=fit.nodes.find(p=>p.id===c.startNodeId)!,b=fit.nodes.find(p=>p.id===c.endNodeId)!,mid=(a:Point,b:Point):Point=>({id:createId(),xMm:(a.xMm+b.xMm)/2,yMm:(a.yMm+b.yMm)/2}),u=mid(a,c.c1),v=mid(c.c1,c.c2),w=mid(c.c2,b),l=mid(u,v),r=mid(v,w),m=mid(l,r);fit.nodes.splice(fit.nodes.indexOf(a)+1,0,m);fit.curves.splice(0,1,{...c,endNodeId:m.id,c1:u,c2:l},{...c,id:createId(),startNodeId:m.id,c1:r,c2:w});}
  return {nodes:fit.nodes.map(world),curves:fit.curves.map(c=>({...c,c1:world(c.c1),c2:world(c.c2)})),sourceBoundary:reliableSource?observed.map(world):undefined};
 };
 fit.prepare=(branches)=>{const result=sourceJunctions(branches.map(b=>({...b,raw:b.raw.map(p=>{const q=toPixel(p);return {...p,xMm:Math.round(q.xMm*1e8)/1e8,yMm:Math.round(q.yMm*1e8)/1e8};})})),width,height,rgba);return result?.output.map(r=>r.map(p=>({...p,...fromPixel(p)})));};return fit;
}

/** Error-driven line/cubic approximation of measured subpixel samples. Lines
 * win whenever supported; control points are independent least-squares data
 * fits, with no tangent continuity or curvature regularisation constraint. */
export function fitMeasuredBoundary(points:Point[],closed:boolean,createId:()=>string,tolerance=.65,tangentAt?:(p:Point)=>XY|undefined){
 const nodes:Point[]=[],curves:Curve[]=[],lines:{a:Point;b:Point;nx:number;ny:number;d:number;points:Point[]}[]=[];
 const fit=(p:Point[],depth=0)=>{
  const a=p[0],b=p.at(-1)!;if(p.length<3||depth>20){nodes.push(...p.slice(0,-1));return;}
  if(distance(a,b)>12&&(!tangentAt||p.every(q=>!tangentAt(q)))){
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
  const startTangent=tangentAt?.(a),endTangent=tangentAt?.(b),chord=distance(a,b),straightDerivative=!startTangent||!endTangent||chord===0||[startTangent,endTangent].every(t=>Math.abs(t.xMm*(b.yMm-a.yMm)-t.yMm*(b.xMm-a.xMm))/chord<.03);
  if(lineError<=.01||lineError<=Math.min(.35,tolerance)&&straightDerivative){nodes.push(a);return;}
  // A hard pixel staircase can turn sharply over three samples even when its
  // supporting edge is straight. A real cusp persists over several native
  // pixels on both sides; test that larger scale before splitting the fit.
  let corner=-1,strength=.65;
  for(let i=6;i<p.length-6;i++){const u=p[i-6],v=p[i],w=p[i+6],l=distance(u,v),r=distance(v,w);if(l<4||r<4)continue;const cosine=((v.xMm-u.xMm)*(w.xMm-v.xMm)+(v.yMm-u.yMm)*(w.yMm-v.yMm))/(l*r);if(cosine<strength){strength=cosine;corner=i;}}
  if(corner>=0){fit(p.slice(0,corner+1),depth+1);fit(p.slice(corner),depth+1);return;}
  const arc=[0];for(let i=1;i<p.length;i++)arc.push(arc.at(-1)!+distance(p[i-1],p[i]));const total=arc.at(-1)!;
  let aa=0,ab=0,bb=0,ax=0,ay=0,bx=0,by=0;
  for(let i=1;i<p.length-1;i++){const t=arc[i]/total,s=1-t,u=3*s*s*t,v=3*s*t*t,x=p[i].xMm-s*s*s*a.xMm-t*t*t*b.xMm,y=p[i].yMm-s*s*s*a.yMm-t*t*t*b.yMm;aa+=u*u;ab+=u*v;bb+=v*v;ax+=u*x;ay+=u*y;bx+=v*x;by+=v*y;}
  const determinant=aa*bb-ab*ab;
  if(determinant>1e-12){
   let c1:Point={id:createId(),xMm:(ax*bb-bx*ab)/determinant,yMm:(ay*bb-by*ab)/determinant},c2:Point={id:createId(),xMm:(bx*aa-ax*ab)/determinant,yMm:(by*aa-ay*ab)/determinant};
   const ta=tangentAt?.(a),tb=tangentAt?.(b);
   if(ta&&tb){
    const dot=ta.xMm*tb.xMm+ta.yMm*tb.yMm,crossTerm=-ab*dot,det=aa*bb-crossTerm*crossTerm;
    const rx=ax-aa*a.xMm-ab*b.xMm,ry=ay-aa*a.yMm-ab*b.yMm,sx=bx-ab*a.xMm-bb*b.xMm,sy=by-ab*a.yMm-bb*b.yMm,u=rx*ta.xMm+ry*ta.yMm,v=-sx*tb.xMm-sy*tb.yMm;
    const alpha=(u*bb-v*crossTerm)/det,beta=(v*aa-u*crossTerm)/det;
    if(det>1e-12&&alpha>0&&beta>0&&alpha<total&&beta<total){c1={id:c1.id,xMm:a.xMm+alpha*ta.xMm,yMm:a.yMm+alpha*ta.yMm};c2={id:c2.id,xMm:b.xMm-beta*tb.xMm,yMm:b.yMm-beta*tb.yMm};}
   }
   const at=(t:number):XY=>{const s=1-t;return {xMm:s*s*s*a.xMm+3*s*s*t*c1.xMm+3*s*t*t*c2.xMm+t*t*t*b.xMm,yMm:s*s*s*a.yMm+3*s*s*t*c1.yMm+3*s*t*t*c2.yMm+t*t*t*b.yMm};};
   const error=Math.max(...p.map((q,i)=>distance(q,at(arc[i]/total))));
   if(error<=tolerance&&distance(a,c1)+distance(c1,c2)+distance(c2,b)<total*1.5){nodes.push(a);if(!tangentAt||Math.max(segmentDistance(c1,a,b),segmentDistance(c2,a,b))>.03)curves.push({id:createId(),startNodeId:a.id,endNodeId:b.id,c1,c2});return;}
  }
  let split=errors.indexOf(lineError);if(split<1||split>=p.length-1)split=Math.floor(p.length/2);
  fit(p.slice(0,split+1),depth+1);fit(p.slice(split),depth+1);
 };
 if(closed){
  // The traced ring's first sample is arbitrary. Starting a fit a few pixels
  // before a corner hides that corner at the open-span endpoint, where the
  // two-sided cusp test cannot see it and a short cubic can round it. Split
  // at measured, persistent cusps when present; smooth loops keep the old
  // farthest-point division.
  const n=points.length,cusps:{index:number;cosine:number}[]=[];
  if(n>=13)for(let i=0;i<n;i++){const u=points[(i-6+n)%n],v=points[i],w=points[(i+6)%n],l=distance(u,v),r=distance(v,w);if(l<4||r<4)continue;const cosine=((v.xMm-u.xMm)*(w.xMm-v.xMm)+(v.yMm-u.yMm)*(w.yMm-v.yMm))/(l*r);if(cosine<.65)cusps.push({index:i,cosine});}
  cusps.sort((a,b)=>a.cosine-b.cosine);
  const start=cusps[0]?.index??0,ring=[...points.slice(start),...points.slice(0,start)];
  let opposite=1;for(let i=2;i<n;i++)if(distance(ring[0],ring[i])>distance(ring[0],ring[opposite]))opposite=i;
  const farthest=distance(ring[0],ring[opposite]);
  const other=cusps.map(c=>({index:(c.index-start+n)%n,length:distance(ring[0],points[c.index])})).filter(c=>c.index>0&&c.length>=farthest*.75).sort((a,b)=>b.length-a.length)[0];
  if(other)opposite=other.index;
  fit(ring.slice(0,opposite+1));fit([...ring.slice(opposite),ring[0]]);
 }else{fit(points);nodes.push(points.at(-1)!);}
 const allLines=lines.length>0&&curves.length===0&&nodes.length===lines.length*3+(closed?0:1);
 if(closed&&allLines&&lines.length>=3&&lines.every((l,i)=>l.b.id===lines[(i+1)%lines.length].a.id)){
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
