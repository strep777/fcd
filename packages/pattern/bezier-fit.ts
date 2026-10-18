import type {Piece} from '../schema/index';
import {boxIndex,type Box} from '../surface/spatial';
type P=[number,number];type Cubic=[P,P,P,P];
const norm=(p:P):P=>{const n=Math.hypot(...p);return n?[p[0]/n,p[1]/n]:[1,0];},sub=(a:P,b:P):P=>[a[0]-b[0],a[1]-b[1]],distance=(a:P,b:P)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const at=(c:Cubic,t:number):P=>[0,1].map(i=>(1-t)**3*c[0][i]+3*t*(1-t)**2*c[1][i]+3*t*t*(1-t)*c[2][i]+t**3*c[3][i]) as P;
function pointDistance(p:P,a:P,b:P){const d=sub(b,a),den=d[0]**2+d[1]**2,t=den?Math.max(0,Math.min(1,((p[0]-a[0])*d[0]+(p[1]-a[1])*d[1])/den)):0;return Math.hypot(p[0]-a[0]-t*d[0],p[1]-a[1]-t*d[1]);}
function flatten(c:Cubic,epsilon:number,output:P[],depth=0){
 if(depth>=24)throw Error('FIT_BUDGET');
 if(Math.max(pointDistance(c[1],c[0],c[3]),pointDistance(c[2],c[0],c[3]))<=epsilon){output.push(c[3]);return;}
 const mid=(a:P,b:P):P=>[(a[0]+b[0])/2,(a[1]+b[1])/2],a=mid(c[0],c[1]),b=mid(c[1],c[2]),d=mid(c[2],c[3]),e=mid(a,b),f=mid(b,d),g=mid(e,f);flatten([c[0],a,e,g],epsilon,output,depth+1);flatten([g,f,d,c[3]],epsilon,output,depth+1);
}
/** Upper bound for both polyline Hausdorff directions: distance is 1-Lipschitz.
 * Cubic flattening adds a convex-hull distance bound, not just vertex residuals. */
function bound(a:P[],b:P[],tolerance:number,epsilon:number){
 let samples=0,checks=0,result=0;const verify=(source:P[],target:P[])=>{const segments=target.slice(0,-1).map((p,i)=>[p,target[i+1]] as [P,P]),index=boxIndex(segments.map(([a,b])=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])] as Box));
 for(let i=0;i<source.length-1;i++){const a=source[i],b=source[i+1],length=distance(a,b),steps=Math.max(1,Math.ceil(length/(tolerance/4))),slack=length/steps/2;for(let j=0;j<=steps;j++){if(++samples>750000)throw Error('FIT_BUDGET');const p:P=[a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps],ids=index.query([p[0]-tolerance,p[1]-tolerance,p[0]+tolerance,p[1]+tolerance]);let d=Infinity;for(const id of ids){if(++checks>10000000)throw Error('FIT_BUDGET');d=Math.min(d,pointDistance(p,...segments[id]));}const upper=d+slack+epsilon;if(upper>tolerance)return false;result=Math.max(result,upper);}}return true;};
 return verify(a,b)&&verify(b,a)?result:Infinity;
}
export type CurveFitReport={algorithm:'bezier-ls-bounded-1';toleranceMm:number;maxDeviationMm:number;inputNodes:number;outputNodes:number;fallbackCount:number};
/** Closed outer-ring fit. Holes retain their exact polygonal contours. No accepted piece is overwritten. */
export function fitCandidate(piece:Piece,toleranceMm:number,createId:()=>string,mergePaintSpans=false):{piece:Piece;report:CurveFitReport}{
 if(!Number.isFinite(toleranceMm)||toleranceMm<.01||toleranceMm>.5||!piece.closed||piece.curves?.length)throw Error('INVALID_FIT');
 const points=piece.nodes.map(p=>[p.xMm,p.yMm] as P),segments:{start:number;end:number;curve:Cubic}[]=[],n=points.length;let fittingTolerance=toleranceMm/2;
 const fit=(start:number,end:number,left:P,right:P,depth=0)=>{if(depth>30)throw Error('FIT_BUDGET');const p0=points[start%n],p3=points[end%n];if(end-start<6){left=norm(sub(points[(start+1)%n],p0));right=norm(sub(points[(end-1)%n],p3));}const values=[0];for(let i=start+1;i<=end;i++)values.push(values.at(-1)!+distance(points[(i-1)%n],points[i%n]));const length=values.at(-1)!;if(length<1e-10)throw Error('INVALID_FIT');const ts=values.map(v=>v/length);let aa=0,ab=0,bb=0,ax=0,bx=0;
 for(let k=0;k<ts.length;k++){const t=ts[k],u=1-t,b0=u**3,b1=3*t*u*u,b2=3*t*t*u,b3=t**3,A:P=[left[0]*b1,left[1]*b1],B:P=[right[0]*b2,right[1]*b2],p=points[(start+k)%n],res:P=[p[0]-p0[0]*(b0+b1)-p3[0]*(b2+b3),p[1]-p0[1]*(b0+b1)-p3[1]*(b2+b3)];aa+=A[0]**2+A[1]**2;ab+=A[0]*B[0]+A[1]*B[1];bb+=B[0]**2+B[1]**2;ax+=A[0]*res[0]+A[1]*res[1];bx+=B[0]*res[0]+B[1]*res[1];}
 const den=aa*bb-ab*ab,chord=distance(p0,p3);let alpha=den>1e-12?(ax*bb-bx*ab)/den:chord/3,beta=den>1e-12?(bx*aa-ax*ab)/den:chord/3;if(alpha<chord*1e-6||beta<chord*1e-6||alpha>length*2||beta>length*2)alpha=beta=chord/3;
 if(end-start===1){left=norm(sub(p3,p0));right=norm(sub(p0,p3));alpha=beta=chord/3;}
 const curve:Cubic=[p0,[p0[0]+alpha*left[0],p0[1]+alpha*left[1]],[p3[0]+beta*right[0],p3[1]+beta*right[1]],p3];let worst=0,split=start+Math.floor((end-start)/2);for(let k=1;k<ts.length-1;k++){const error=distance(points[(start+k)%n],at(curve,ts[k]));if(error>worst){worst=error;split=start+k;}}
 if(end-start===1||worst<=fittingTolerance){segments.push({start,end,curve});return;}
 const middle=norm(sub(points[(split-1+n)%n],points[(split+1)%n]));fit(start,split,left,middle,depth+1);fit(split,end,[-middle[0],-middle[1]],right,depth+1);
 };
 const report:CurveFitReport={algorithm:'bezier-ls-bounded-1',toleranceMm,maxDeviationMm:0,inputNodes:n,outputNodes:n,fallbackCount:0};
 try{
 for(let attempt=0;attempt<5;attempt++,fittingTolerance/=2){segments.length=0;
 const cuts=[0,Math.floor(n/4),Math.floor(n/2),Math.floor(n*3/4),n].filter((v,i,a)=>!i||v!==a[i-1]);for(let i=0;i<cuts.length-1;i++){const a=cuts[i],b=cuts[i+1],tangent=(i:number)=>norm(sub(points[(i+1)%n],points[(i-1+n)%n]));const left=tangent(a),right=tangent(b%n);fit(a,b,left,[-right[0],-right[1]]);}
 const flat:P[]=[points[0]],epsilon=toleranceMm/50;for(const segment of segments)flatten(segment.curve,epsilon,flat);let deviation=bound([...points,points[0]],flat,toleranceMm,epsilon);if(!Number.isFinite(deviation)||segments.length<3||segments.length>=n){
  if(!mergePaintSpans||attempt<4)continue;
  // When a raster-cap tangent makes the first fit fail, start merging from
  // the exact polygon instead. Failure of one fit must not freeze raw knots.
  segments.length=0;for(let i=0;i<n;i++){const a=points[i],b=points[(i+1)%n];segments.push({start:i,end:i+1,curve:[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b]});}deviation=0;
 }
 // Brush cap intersections are sampling details, not intentional corners.
 // Merge adjacent fits against the ORIGINAL painted boundary. Independent
 // least-squares handles avoid inheriting tiny polygon-edge tangents; every
 // merge must still pass the two-sided physical deviation certificate.
 let certifiedDeviation=deviation;
 if(mergePaintSpans){
  const proposal=(start:number,end:number)=>{
   const source=Array.from({length:end-start+1},(_,i)=>points[(start+i)%n]),a=source[0],b=source.at(-1)!,arc=[0];
   for(let i=1;i<source.length;i++)arc.push(arc.at(-1)!+distance(source[i-1],source[i]));
   const length=arc.at(-1)!;if(length<1e-8)return;
   const ts=arc.map(s=>s/length);let curve:Cubic|undefined;
   for(let iteration=0;iteration<6;iteration++){
    let aa=0,ab=0,bb=0,ax=0,ay=0,bx=0,by=0;
    for(let i=1;i<source.length-1;i++){const t=ts[i],s=1-t,u=3*s*s*t,v=3*s*t*t,x=source[i][0]-s*s*s*a[0]-t*t*t*b[0],y=source[i][1]-s*s*s*a[1]-t*t*t*b[1];aa+=u*u;ab+=u*v;bb+=v*v;ax+=u*x;ay+=u*y;bx+=v*x;by+=v*y;}
    const den=aa*bb-ab*ab;if(den<=1e-16){
     if(source.length!==3)return;const t=ts[1],s=1-t;if(s*t<1e-10)return;const q=source[1].map((v,k)=>(v-s*s*a[k]-t*t*b[k])/(2*s*t));curve=[a,[a[0]+2*(q[0]-a[0])/3,a[1]+2*(q[1]-a[1])/3],[b[0]+2*(q[0]-b[0])/3,b[1]+2*(q[1]-b[1])/3],b];break;
    }
    curve=[a,[(ax*bb-bx*ab)/den,(ay*bb-by*ab)/den],[(bx*aa-ax*ab)/den,(by*aa-ay*ab)/den],b];
    if(distance(a,curve[1])+distance(curve[1],curve[2])+distance(curve[2],b)>length*2)return;
    for(let i=1;i<source.length-1;i++){const t=ts[i],s=1-t,p=at(curve,t),d=[0,1].map(k=>3*s*s*(curve![1][k]-a[k])+6*s*t*(curve![2][k]-curve![1][k])+3*t*t*(b[k]-curve![2][k])),dd=[0,1].map(k=>6*s*(curve![2][k]-2*curve![1][k]+a[k])+6*t*(b[k]-2*curve![2][k]+curve![1][k])),r=sub(p,source[i]),den=d[0]*d[0]+d[1]*d[1]+r[0]*dd[0]+r[1]*dd[1];if(den>1e-12)ts[i]=Math.max(ts[i-1]+1e-9,Math.min(ts[i+1]-1e-9,t-(r[0]*d[0]+r[1]*d[1])/den));}
   }
   if(!curve)return;const poly:P[]=[a];flatten(curve,epsilon,poly);const error=bound(source,poly,toleranceMm,epsilon);if(Number.isFinite(error))return {start,end,curve,error};
  };
  // A proposal depends only on its original sample interval. Remember rejected
  // intervals so every successful neighbour merge does not retry all the same
  // sharp turns and consume the entire fitting budget before reaching the rest.
  let attempts=0;const rejected=new Set<string>();
  while(segments.length>3&&attempts<1000){
   const order=segments.map((s,i)=>({i,length:distance(points[s.start%n],points[s.end%n])})).sort((a,b)=>a.length-b.length);let changed=false;
   for(const {i} of order){const a=segments[i],j=(i+1)%segments.length,b=segments[j];let end=b.end;while(end<=a.start)end+=n;const key=a.start%n+':'+(end-a.start);if(rejected.has(key))continue;if(++attempts>1000)break;const merged=proposal(a.start,end);if(!merged){rejected.add(key);continue;}
    certifiedDeviation=Math.max(certifiedDeviation,merged.error);const normalized={start:merged.start%n,end:merged.start%n+merged.end-merged.start,curve:merged.curve};
    if(j===0){segments.pop();segments.shift();segments.unshift(normalized);}else segments.splice(i,2,normalized);changed=true;break;
   }
   if(!changed)break;
  }
 }
 const nodes=segments.map(s=>piece.nodes[s.start%n]),curves=segments.map(s=>({id:createId(),startNodeId:piece.nodes[s.start%n].id,endNodeId:piece.nodes[s.end%n].id,c1:{id:createId(),xMm:s.curve[1][0],yMm:s.curve[1][1]},c2:{id:createId(),xMm:s.curve[2][0],yMm:s.curve[2][1]}}));report.maxDeviationMm=certifiedDeviation;report.outputNodes=nodes.length;return {piece:{...piece,nodes,curves},report};
 }report.fallbackCount=1;return {piece,report};
 }catch(e){if(!(e instanceof Error)||!['FIT_BUDGET','INVALID_FIT'].includes(e.message))throw e;report.fallbackCount=1;return {piece,report};}
}
