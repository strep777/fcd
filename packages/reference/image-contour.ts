import type {Point,Piece} from '../schema/index';
type Curve=NonNullable<Piece['curves']>[number];
type XY={xMm:number;yMm:number};
export type BoundaryFit=(points:Point[],closed:boolean,colors:string[],createId:()=>string)=>{nodes:Point[];curves:Curve[]}|undefined;
const distance=(a:XY,b:XY)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
const segmentDistance=(p:XY,a:XY,b:XY)=>{const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);};

/** Locate the material transition in the source RGB samples, before fitting a
 * path. Coordinates are pixel centres; a half-contrast crossing avoids the two
 * derivative ridges of a blurred/inked edge. There is no path smoothing pass. */
export function imageBoundaryFit(width:number,height:number,rgba:Uint8Array,toPixel:(p:XY)=>XY,fromPixel:(p:XY)=>XY):BoundaryFit{
 if(rgba.length!==width*height*4)throw Error('IMAGE_LIMIT');
 const rgb=(p:XY)=>{const x=Math.max(0,Math.min(width-1,p.xMm-.5)),y=Math.max(0,Math.min(height-1,p.yMm-.5)),ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;return [0,1,2].map(c=>{const at=(dx:number,dy:number)=>rgba[(Math.min(height-1,iy+dy)*width+Math.min(width-1,ix+dx))*4+c]/255;return at(0,0)*(1-tx)*(1-ty)+at(1,0)*tx*(1-ty)+at(0,1)*(1-tx)*ty+at(1,1)*tx*ty;});};
 return (raw,closed,colors,createId)=>{
  if(raw.length<8)return;
  const vertices=raw.map(p=>({...p,...toPixel(p)})),source:Point[]=[];
  // Raster tracers collapse collinear runs. Sample by spatial distance before
  // estimating normals, so three neighbours never span an entire long side.
  for(let i=0;i<vertices.length-(closed?0:1);i++){const a=vertices[i],b=vertices[(i+1)%vertices.length],count=Math.max(1,Math.ceil(distance(a,b)));if(!Number.isFinite(count)||count>40000-source.length)return;for(let j=0;j<count;j++)source.push(j?{id:createId(),xMm:a.xMm+(b.xMm-a.xMm)*j/count,yMm:a.yMm+(b.yMm-a.yMm)*j/count}:a);}
  if(!closed)source.push(vertices.at(-1)!);
  if(source.length>40000)return;
  const palette=[colors[0],colors[1]??'#ffffff'].map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)/255));
  const chromatic=palette.every(p=>Math.max(...p)>.2),normalize=(p:number[])=>chromatic?p.map(v=>v/(p.reduce((s,v)=>s+v,0)||1)):p;
  const a=normalize(palette[0]),b=normalize(palette[1]),delta=a.map((v,i)=>v-b[i]),norm=Math.hypot(...delta);if(norm<.025)return;
  const direction=delta.map(v=>v/norm);let supported=0;const confidence=new Set<number>();
  const observed=source.map((p,i)=>{
   if(!closed&&(i===0||i===source.length-1))return p;
   const at=(offset:number)=>source[closed?(i+offset+source.length)%source.length:Math.max(0,Math.min(source.length-1,i+offset))];
   if(distance(p,at(-1))<.05||distance(p,at(1))<.05)return p;
   const before=at(-3),after=at(3),length=distance(before,after);if(length<1)return p;
   const nx=-(after.yMm-before.yMm)/length,ny=(after.xMm-before.xMm)/length;
   const value=(t:number)=>normalize(rgb({xMm:p.xMm+nx*t,yMm:p.yMm+ny*t})).reduce((s,v,c)=>s+v*direction[c],0);
   const left=(value(-3)+value(-4))/2,right=(value(3)+value(4))/2,contrast=right-left;
   if(Math.abs(contrast)<.035)return p;
   const level=(left+right)/2,crossings:number[]=[];
   for(let t=-1;t<1;t+=.125){const u=value(t),v=value(t+.125);if((u-level)*(v-level)<=0&&Math.sign(v-u)===Math.sign(contrast)&&Math.abs(v-u)>.0001)crossings.push(t+.125*(level-u)/(v-u));}
   if(crossings.length!==1||Math.abs(crossings[0])>.8)return p;
   const t=crossings[0];supported++;confidence.add(i);return {...p,xMm:p.xMm+nx*t,yMm:p.yMm+ny*t};
  });
  if(supported<source.length*.65)return;
  const supportedPoints=observed.filter((_,i)=>confidence.has(i)||!closed&&(i===0||i===observed.length-1));
  const fit=fitMeasuredBoundary(supportedPoints,closed,createId);
  const world=(p:Point)=>({...p,...fromPixel(p)});
  return {nodes:fit.nodes.map(world),curves:fit.curves.map(c=>({...c,c1:world(c.c1),c2:world(c.c2)}))};
 };
}

/** Error-driven line/cubic approximation of measured subpixel samples. Lines
 * win whenever supported; control points are independent least-squares data
 * fits, with no tangent continuity or curvature regularisation constraint. */
export function fitMeasuredBoundary(points:Point[],closed:boolean,createId:()=>string){
 const nodes:Point[]=[],curves:Curve[]=[];
 const fit=(p:Point[],depth=0)=>{
  const a=p[0],b=p.at(-1)!;if(p.length<3||depth>20){nodes.push(...p.slice(0,-1));return;}
  if(distance(a,b)>12){
   // Shared junctions stay fixed on the raster topology. Estimate the line
   // from the measured interior, so a quantized endpoint cannot bow a straight edge.
   const interior=p.filter(q=>distance(a,q)>=2&&distance(b,q)>=2);
   const samples=interior.length>=4?interior:p;
   const cx=samples.reduce((s,q)=>s+q.xMm,0)/samples.length,cy=samples.reduce((s,q)=>s+q.yMm,0)/samples.length;
   let xx=0,xy=0,yy=0;for(const q of samples){xx+=(q.xMm-cx)**2;xy+=(q.xMm-cx)*(q.yMm-cy);yy+=(q.yMm-cy)**2;}
   const angle=.5*Math.atan2(2*xy,xx-yy),nx=-Math.sin(angle),ny=Math.cos(angle),offsets=samples.map(q=>nx*(q.xMm-cx)+ny*(q.yMm-cy));
   if(Math.max(...offsets)-Math.min(...offsets)<=.6){
    const offset=(Math.max(...offsets)+Math.min(...offsets))/2;
    let first=1,last=p.length-2;while(first<last&&distance(a,p[first])<2)first++;while(last>first&&distance(b,p[last])<2)last--;
    const project=(q:Point)=>{const t=offset-nx*(q.xMm-cx)-ny*(q.yMm-cy);return {...q,id:createId(),xMm:q.xMm+nx*t,yMm:q.yMm+ny*t};};
    if(first<last){nodes.push(a,project(p[first]),project(p[last]));return;}
   }
  }
  const errors=p.map(v=>segmentDistance(v,a,b)),lineError=Math.max(...errors);
  if(lineError<=.35){nodes.push(a);return;}
  // Genuine cusps are retained before considering any cubic across them.
  let corner=-1,strength=.65;
  for(let i=3;i<p.length-3;i++){const u=p[i-3],v=p[i],w=p[i+3],l=distance(u,v),r=distance(v,w);if(l<1.5||r<1.5)continue;const cosine=((v.xMm-u.xMm)*(w.xMm-v.xMm)+(v.yMm-u.yMm)*(w.yMm-v.yMm))/(l*r);if(cosine<strength){strength=cosine;corner=i;}}
  if(corner>=0){fit(p.slice(0,corner+1),depth+1);fit(p.slice(corner),depth+1);return;}
  const arc=[0];for(let i=1;i<p.length;i++)arc.push(arc.at(-1)!+distance(p[i-1],p[i]));const total=arc.at(-1)!;
  let aa=0,ab=0,bb=0,ax=0,ay=0,bx=0,by=0;
  for(let i=1;i<p.length-1;i++){const t=arc[i]/total,s=1-t,u=3*s*s*t,v=3*s*t*t,x=p[i].xMm-s*s*s*a.xMm-t*t*t*b.xMm,y=p[i].yMm-s*s*s*a.yMm-t*t*t*b.yMm;aa+=u*u;ab+=u*v;bb+=v*v;ax+=u*x;ay+=u*y;bx+=v*x;by+=v*y;}
  const determinant=aa*bb-ab*ab;
  if(determinant>1e-12){
   const c1:Point={id:createId(),xMm:(ax*bb-bx*ab)/determinant,yMm:(ay*bb-by*ab)/determinant},c2:Point={id:createId(),xMm:(bx*aa-ax*ab)/determinant,yMm:(by*aa-ay*ab)/determinant};
   const at=(t:number):XY=>{const s=1-t;return {xMm:s*s*s*a.xMm+3*s*s*t*c1.xMm+3*s*t*t*c2.xMm+t*t*t*b.xMm,yMm:s*s*s*a.yMm+3*s*s*t*c1.yMm+3*s*t*t*c2.yMm+t*t*t*b.yMm};};
   const error=Math.max(...p.map((q,i)=>distance(q,at(arc[i]/total))));
   if(error<=.35&&distance(a,c1)+distance(c1,c2)+distance(c2,b)<total*1.5){nodes.push(a);curves.push({id:createId(),startNodeId:a.id,endNodeId:b.id,c1,c2});return;}
  }
  let split=errors.indexOf(lineError);if(split<1||split>=p.length-1)split=Math.floor(p.length/2);
  fit(p.slice(0,split+1),depth+1);fit(p.slice(split),depth+1);
 };
 if(closed){let opposite=1;for(let i=2;i<points.length;i++)if(distance(points[0],points[i])>distance(points[0],points[opposite]))opposite=i;fit(points.slice(0,opposite+1));fit([...points.slice(opposite),points[0]]);}else{fit(points);nodes.push(points.at(-1)!);}
 return {nodes,curves};
}
