import {contourPolyline} from './recover-contour';
import type {Point,Piece} from '../schema/index';
type Curve=NonNullable<Piece['curves']>[number];
/** Prefer the already measured source path when the entire path fits the
 * existing raster validation tube. Otherwise splice into the raster fit. The
 * 0.08 pixel samples leave 0.04 pixel for the distance function's Lipschitz
 * bound; no source or shared-network tolerance is enlarged. */
export function sourceSpliceBase(measured:{nodes:Point[];curves:Curve[]},raw:Point[],closed:boolean,createId:()=>string){
 if(measured.nodes.length<2||raw.length<2||measured.nodes.length>2048||raw.length>2048||measured.curves.length>512)return false;
 const finite=(p:Point)=>Number.isFinite(p.xMm)&&Number.isFinite(p.yMm);
 if(!raw.every(finite)||!measured.nodes.every(finite)||measured.curves.some(c=>!finite(c.c1)||!finite(c.c2)))return false;
 // Bound flattened allocation across the entire path, before the distance
 // loops. Each cubic also retains the existing per-curve flattening limit.
 const path:Point[]=[];
 try{for(let i=0;i<measured.nodes.length-(closed?0:1);i++){
  const a=measured.nodes[i],b=measured.nodes[(i+1)%measured.nodes.length],curve=measured.curves.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id),part=contourPolyline([a,b],curve?[curve]:[],false,.01,createId).slice(0,-1);
  if(path.length+part.length>4096)return false;path.push(...part);
 }}catch{return false;}
 if(!closed)path.push(measured.nodes.at(-1)!);
 const segments=(points:Point[])=>points.slice(0,points.length-(closed?0:1)).map((p,i)=>[p,points[(i+1)%points.length]] as const);
 const a=segments(path),b=segments(raw);
 if(a.length*b.length>1000000)return false;
 const distance=(p:Point,a:Point,b:Point)=>{const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);};
 const within=(from:typeof a,to:typeof a)=>{
  let work=0;
  for(const [a,b]of from){const count=Math.max(1,Math.ceil(Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm)/.08));work+=(count+1)*to.length;if(!Number.isFinite(count)||work>10000000)return false;
   for(let j=0;j<=count;j++){const p={id:'',xMm:a.xMm+(b.xMm-a.xMm)*j/count,yMm:a.yMm+(b.yMm-a.yMm)*j/count};if(!to.some(([u,v])=>distance(p,u,v)<=1))return false;}
  }return true;
 };
 return within(a,b)&&within(b,a);
}
