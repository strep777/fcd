import type {SurfaceReport} from '../schema/index';

/** Rigidly align two already solved charts at their common seam. No scale or
 * physical length is changed. This is only an initial iterate: native overlap,
 * orientation, strain and seam checks still decide whether the union is usable. */
export function joinedChartSeed(a:SurfaceReport,b:SurfaceReport):SurfaceReport['uv']|undefined{
 const left=new Map(a.uv.map(p=>[p.vertexId,p])),right=new Map(b.uv.map(p=>[p.vertexId,p]));
 const shared=[...left.keys()].filter(id=>right.has(id));if(shared.length<2)return;
 const center=(points:typeof left)=>[shared.reduce((s,id)=>s+points.get(id)!.xMm,0)/shared.length,shared.reduce((s,id)=>s+points.get(id)!.yMm,0)/shared.length];
 const ca=center(left),cb=center(right);let dot=0,cross=0;
 for(const id of shared){const p=left.get(id)!,q=right.get(id)!,x=p.xMm-ca[0],y=p.yMm-ca[1],u=q.xMm-cb[0],v=q.yMm-cb[1];dot+=x*u+y*v;cross+=y*u-x*v;}
 const length=Math.hypot(dot,cross);if(!(length>1e-20))return;
 const c=dot/length,s=cross/length;
 const seed=[...a.uv.map(p=>({vertexId:p.vertexId,xMm:p.xMm-ca[0],yMm:p.yMm-ca[1]})),...b.uv.filter(p=>!left.has(p.vertexId)).map(p=>({vertexId:p.vertexId,xMm:c*(p.xMm-cb[0])-s*(p.yMm-cb[1]),yMm:s*(p.xMm-cb[0])+c*(p.yMm-cb[1])}))];
 return seed.every(p=>Number.isFinite(p.xMm)&&Number.isFinite(p.yMm))?seed:undefined;
}
