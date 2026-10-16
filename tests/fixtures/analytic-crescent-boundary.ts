// Independent analytic test oracle. No production fitting/topology functions.
import type {Piece} from '../../packages/schema/index';

type XY={x:number;y:number};
type MM={xMm:number;yMm:number};
type Segment={a:XY;b:XY;c1?:XY;c2?:XY};
type Edge={a:XY;b:XY};
type Source={cx:number;cy:number;R:number;r:number;d:number};
const distance=(a:XY,b:XY)=>Math.hypot(a.x-b.x,a.y-b.y);
const midpoint=(a:XY,b:XY):XY=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const projection=(p:XY,a:XY,b:XY)=>{
 const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;
 return distance(p,{x:a.x+dx*t,y:a.y+dy*t});
};
const cross=(a:XY,b:XY,c:XY)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function touches(a:XY,b:XY,c:XY,d:XY){
 const on=(p:XY,u:XY,v:XY)=>Math.abs(cross(u,v,p))<=1e-9&&p.x>=Math.min(u.x,v.x)-1e-9&&p.x<=Math.max(u.x,v.x)+1e-9&&p.y>=Math.min(u.y,v.y)-1e-9&&p.y<=Math.max(u.y,v.y)+1e-9;
 return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,c,d)||on(b,c,d)||on(c,a,b)||on(d,a,b);
}
function flatten(segments:Segment[],tolerance:number){
 const edges:Edge[]=[];
 function append(a:XY,c1:XY|undefined,c2:XY|undefined,b:XY,depth=0){
  if(depth>24||edges.length>100000)throw Error('ANALYTIC_ORACLE_RESOURCE_LIMIT');
  if(!c1||!c2||Math.max(projection(c1,a,b),projection(c2,a,b))<=tolerance){edges.push({a,b});return;}
  const p=midpoint(a,c1),q=midpoint(c1,c2),r=midpoint(c2,b),s=midpoint(p,q),t=midpoint(q,r),m=midpoint(s,t);
  append(a,p,s,m,depth+1);append(m,t,r,b,depth+1);
 }
 for(const s of segments)append(s.a,s.c1,s.c2,s.b);return edges;
}
function boundedSamples(segments:Segment[],step:number){
 const points:XY[]=[];let maxArcGap=0;
 function append(a:XY,c1:XY|undefined,c2:XY|undefined,b:XY,depth=0){
  if(depth>24||points.length>100000)throw Error('ANALYTIC_ORACLE_RESOURCE_LIMIT');
  const length=c1&&c2?distance(a,c1)+distance(c1,c2)+distance(c2,b):distance(a,b);
  if(length<=step){points.push(a);maxArcGap=Math.max(maxArcGap,length);return;}
  if(!c1||!c2){const n=Math.ceil(length/step);for(let j=0;j<n;j++)points.push({x:a.x+(b.x-a.x)*j/n,y:a.y+(b.y-a.y)*j/n});maxArcGap=Math.max(maxArcGap,length/n);return;}
  const p=midpoint(a,c1),q=midpoint(c1,c2),r=midpoint(c2,b),s=midpoint(p,q),t=midpoint(q,r),m=midpoint(s,t);
  append(a,p,s,m,depth+1);append(m,t,r,b,depth+1);
 }
 for(const s of segments)append(s.a,s.c1,s.c2,s.b);return{points,maxArcGap};
}
function exactArea(segments:Segment[]){
 let sum=0;
 for(const s of segments){
  const coefficients=(a:number,c1:number|undefined,c2:number|undefined,b:number)=>c1===undefined||c2===undefined?[a,b-a]:[a,3*(c1-a),3*(a-2*c1+c2),-a+3*c1-3*c2+b];
  const x=coefficients(s.a.x,s.c1?.x,s.c2?.x,s.b.x),y=coefficients(s.a.y,s.c1?.y,s.c2?.y,s.b.y);
  for(let i=0;i<x.length;i++)for(let j=1;j<y.length;j++)sum+=(x[i]*j*y[j]-y[i]*j*x[j])/(i+j);
 }
 return sum/2;
}
function nearestEdges(edges:Edge[]){
 const boxes=edges.map(e=>({e,minX:Math.min(e.a.x,e.b.x),minY:Math.min(e.a.y,e.b.y),maxX:Math.max(e.a.x,e.b.x),maxY:Math.max(e.a.y,e.b.y)}));
 return(p:XY)=>{let best=Infinity;for(const b of boxes){const dx=Math.max(b.minX-p.x,0,p.x-b.maxX),dy=Math.max(b.minY-p.y,0,p.y-b.maxY);if(dx*dx+dy*dy>best*best)continue;best=Math.min(best,projection(p,b.e.a,b.e.b));}return best;};
}
export function analyticCrescentEvidence(piece:Piece,toPixel:(p:MM)=>MM,source:Source){
 const {cx,cy,R,r,d}=source;
 if(![cx,cy,R,r,d].every(Number.isFinite)||R<=0||r<=0||d<=0||d>=R+r||d<=Math.abs(R-r))throw Error('INVALID_ANALYTIC_CIRCLES');
 const map=(p:MM):XY=>{const q=toPixel(p);return{x:q.xMm,y:q.yMm};},curves=new Map((piece.curves??[]).map(c=>[c.startNodeId,c]));
 const finite=[piece.nodes,...piece.holes??[]].flat().every(n=>Number.isFinite(n.xMm)&&Number.isFinite(n.yMm))&&(piece.curves??[]).every(c=>[c.c1,c.c2].every(n=>Number.isFinite(n.xMm)&&Number.isFinite(n.yMm)));
 const ids=new Set(piece.nodes.map(n=>n.id)),validStructure=piece.nodes.length>=3&&ids.size===piece.nodes.length&&curves.size===(piece.curves?.length??0)&&(piece.curves??[]).every(c=>piece.nodes.some((n,i)=>n.id===c.startNodeId&&piece.nodes[(i+1)%piece.nodes.length].id===c.endNodeId));
 if(!finite||!validStructure)throw Error('INVALID_CANDIDATE_STRUCTURE');
 const segments:Segment[]=piece.nodes.map((n,i)=>{const c=curves.get(n.id);return{a:map(n),b:map(piece.nodes[(i+1)%piece.nodes.length]),c1:c?map(c.c1):undefined,c2:c?map(c.c2):undefined};});
 const k=(R*R-r*r+d*d)/(2*d),h=Math.sqrt(R*R-k*k),a=Math.acos(k/R),b=Math.acos((k-d)/r),tau=2*Math.PI;
 const tips=[{x:cx+k,y:cy-h},{x:cx+k,y:cy+h}],arcs=[{center:{x:cx,y:cy},radius:R,start:a,end:tau-a},{center:{x:cx+d,y:cy},radius:r,start:b,end:tau-b}];
 const nearestSource=(p:XY)=>{
  let best=Math.min(...tips.map(q=>distance(p,q)));
  for(const arc of arcs){let t=Math.atan2(p.y-arc.center.y,p.x-arc.center.x);if(t<0)t+=tau;t=Math.max(arc.start,Math.min(arc.end,t));best=Math.min(best,distance(p,{x:arc.center.x+arc.radius*Math.cos(t),y:arc.center.y+arc.radius*Math.sin(t)}));}
  return best;
 };
 const sampled=boundedSamples(segments,.05),forwardMax=Math.max(...sampled.points.map(nearestSource)),edges=flatten(segments,.001),nearestCandidate=nearestEdges(edges);
 let reverseMax=0,maxReferenceArcGap=0;
 for(const arc of arcs){const length=(arc.end-arc.start)*arc.radius,n=Math.ceil(length/.05);maxReferenceArcGap=Math.max(maxReferenceArcGap,length/n);for(let j=0;j<=n;j++){const t=arc.start+(arc.end-arc.start)*j/n;reverseMax=Math.max(reverseMax,nearestCandidate({x:arc.center.x+arc.radius*Math.cos(t),y:arc.center.y+arc.radius*Math.sin(t)}));}}
 for(const tip of tips)reverseMax=Math.max(reverseMax,nearestCandidate(tip));
 const lens=R*R*Math.acos((d*d+R*R-r*r)/(2*d*R))+r*r*Math.acos((d*d+r*r-R*R)/(2*d*r))-.5*Math.sqrt((-d+R+r)*(d+R-r)*(d-R+r)*(d+R+r)),expectedArea=Math.PI*R*R-lens,signedArea=exactArea(segments),crossings:{a:number;b:number}[]=[];
 for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){if(j===i+1||i===0&&j===edges.length-1)continue;const a=edges[i],b=edges[j];if(Math.max(a.a.x,a.b.x)<Math.min(b.a.x,b.b.x)-1e-9||Math.max(b.a.x,b.b.x)<Math.min(a.a.x,a.b.x)-1e-9||Math.max(a.a.y,a.b.y)<Math.min(b.a.y,b.b.y)-1e-9||Math.max(b.a.y,b.b.y)<Math.min(a.a.y,a.b.y)-1e-9)continue;if(touches(a.a,a.b,b.a,b.b))crossings.push({a:i,b:j});}
 return{reference:{...source,tips,arcs,area:expectedArea},forward:{sampledMax:forwardMax,maxArcGap:sampled.maxArcGap,certifiedUpper:forwardMax+sampled.maxArcGap/2},reverse:{sampledMax:reverseMax,maxArcGap:maxReferenceArcGap,targetFlatteningMargin:.001,certifiedUpper:reverseMax+maxReferenceArcGap/2+.001},area:{actual:Math.abs(signedArea),expected:expectedArea,error:Math.abs(Math.abs(signedArea)-expectedArea),budget:Math.max(.8*.8,expectedArea*.03)},topology:{finite,validStructure,holes:piece.holes?.length??0,zeroEdges:edges.filter(e=>distance(e.a,e.b)<1e-9).length,crossings,windingMatchesAnalyticOuter:signedArea>0},units:'Native source pixels after the provided calibration inverse; original crescent uses 1 mm/native pixel. Area floor .8² retains the old safeContour argument, and the original3% dominates for this fixture.'};
}
