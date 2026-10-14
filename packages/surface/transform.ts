import {surfaceSchema,type Surface,type Command} from '../schema/index';
import {mapShapeContour} from './shape-contour';
import type {Shape} from './attached-edit';
type V=[number,number,number];
type XYZ={x:number;y:number;z:number};
export type ModelTransform=Extract<Command,{type:'surface.transform'}>;
const xyz=(p:XYZ):V=>[p.x,p.y,p.z];
const dot=(a:V,b:V)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(v:V):V=>{const n=Math.hypot(...v);if(n<1e-12)throw Error('MODEL_TRANSFORM_INVALID');return v.map(x=>x/n) as V;};
export function transformSurface(surface:Surface,input:ModelTransform){
 const selected=input.vertexIds?new Set(input.vertexIds):input.regions?new Set(surface.faces.filter(f=>input.regions!.includes(f.region)).flatMap(f=>f.vertices)):new Set(surface.vertices.map(v=>v.id));
 if(!selected.size||input.vertexIds?.some(id=>!surface.vertices.some(v=>v.id===id))||input.regions?.some(r=>!surface.faces.some(f=>f.region===r)))throw Error('MODEL_SELECTION_EMPTY');
 const chosen=surface.vertices.filter(v=>selected.has(v.id)),all=chosen.length===surface.vertices.length;
 const pivot:V=input.pivotMm?xyz(input.pivotMm):(['xMm','yMm','zMm'] as const).map(axis=>{let a=Infinity,b=-Infinity;for(const v of chosen){a=Math.min(a,v[axis]);b=Math.max(b,v[axis]);}return (a+b)/2;}) as V;
 const scale=xyz(input.scale),rotation=xyz(input.rotationDeg).map(v=>v*Math.PI/180),translation=xyz(input.translationMm);
 if([...scale,...rotation,...translation,...pivot].some(v=>!Number.isFinite(v))||scale.some(v=>v<=0||v>1000))throw Error('MODEL_TRANSFORM_INVALID');
 const vector=(p:V):V=>{let [x,y,z]=p.map((v,i)=>v*scale[i]);for(let i=0;i<3;i++){const c=Math.cos(rotation[i]),s=Math.sin(rotation[i]);if(i===0)[y,z]=[c*y-s*z,s*y+c*z];if(i===1)[x,z]=[c*x+s*z,-s*x+c*z];if(i===2)[x,y]=[c*x-s*y,s*x+c*y];}return [x,y,z];};
 const point=(p:V):V=>vector(p.map((v,i)=>v-pivot[i]) as V).map((v,i)=>v+pivot[i]+translation[i]) as V;
 const move=<T extends {xMm:number;yMm:number;zMm:number}>(v:T):T=>{const [xMm,yMm,zMm]=point([v.xMm,v.yMm,v.zMm]);return {...v,xMm,yMm,zMm};};
 const vertices=surface.vertices.map(v=>selected.has(v.id)?move(v):{...v}),before=new Map(surface.vertices.map(v=>[v.id,v])),after=new Map(vertices.map(v=>[v.id,v]));
 for(const f of surface.faces){
  const normal=(map:typeof before)=>{const [a,b,c]=f.vertices.map(id=>map.get(id)!);return cross([b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm]);};
  const next=normal(after);if(Math.hypot(...next)<1e-9)throw Error('TEMPLATE_INVERSION');
  // Only transition faces can fold; a fully selected face may rotate by 180°.
  if(f.vertices.some(id=>selected.has(id))&&f.vertices.some(id=>!selected.has(id))&&dot(normal(before),next)<=0)throw Error('TEMPLATE_INVERSION');
 }
 const {template,parameters,customTemplate,assembly,sculpt,...base}=surface;
 const cutLines=surface.cutLines?.map(line=>{
  // Transport a knot with its original triangle, including points between
  // vertices. Nearest-vertex displacement would tear a seam off a bent face.
  const controlPoints=line.controlPoints.map(p=>{
   if(all)return move(p);
   let best=Infinity,displacement:V=[0,0,0];
   for(const face of surface.faces){
    const old=face.vertices.map(id=>before.get(id)!),tri=old.map(v=>[v.xMm,v.yMm,v.zMm] as V),q:V=[p.xMm,p.yMm,p.zMm];
    const sub=(a:V,b:V)=>a.map((v,i)=>v-b[i]) as V,u=sub(tri[1],tri[0]),v=sub(tri[2],tri[0]),w=sub(q,tri[0]);
    const uu=dot(u,u),uv=dot(u,v),vv=dot(v,v),wu=dot(w,u),wv=dot(w,v),det=uu*vv-uv*uv;
    const candidates:V[]=[];
    if(det>1e-16){const y=(wu*vv-wv*uv)/det,z=(wv*uu-wu*uv)/det;if(y>=0&&z>=0&&y+z<=1)candidates.push([1-y-z,y,z]);}
    for(let i=0;i<3;i++){const j=(i+1)%3,edge=sub(tri[j],tri[i]),t=Math.max(0,Math.min(1,dot(sub(q,tri[i]),edge)/(dot(edge,edge)||1))),weights:V=[0,0,0];weights[i]=1-t;weights[j]=t;candidates.push(weights);}
    for(const weights of candidates){const closest=[0,1,2].map(axis=>weights.reduce((sum,n,i)=>sum+n*tri[i][axis],0)) as V,d=dot(sub(q,closest),sub(q,closest));if(d>=best)continue;best=d;
     displacement=[0,1,2].map(axis=>weights.reduce((sum,n,i)=>{const next=after.get(old[i].id)!;return sum+n*([next.xMm,next.yMm,next.zMm][axis]-tri[i][axis]);},0)) as V;
    }
   }
   return {...p,xMm:p.xMm+displacement[0],yMm:p.yMm+displacement[1],zMm:p.zMm+displacement[2]};
  });
  return {...line,controlPoints,projection:undefined,section:undefined};
 });
 const result=surfaceSchema.parse({...base,source:surface.source==='glb'?'glb':'obj',topologyVersion:surface.topologyVersion+1,vertices,cutLines,cutScope:undefined});
 const shape=(s:Shape):Shape=>{const u=vector(s.axes[0]),v=vector(s.axes[1]),right=unit(u),normal=unit(cross(u,v)),up=unit(cross(normal,right));return {...mapShapeContour(s,p=>{const q=u.map((x,i)=>x*p.xMm+v[i]*p.yMm) as V;return {xMm:dot(q,right),yMm:dot(q,up)};}),origin:point(s.origin),axes:[right,up,normal]};};
 return {surface:result,all,shape};
}
