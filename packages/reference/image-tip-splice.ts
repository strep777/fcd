type P={id:string;xMm:number;yMm:number};
type C={id:string;startNodeId:string;endNodeId:string;c1:P;c2:P};
type Segment={a:P;b:P;c?:C};
const distance=(a:P,b:P)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
function at(s:Segment,t:number):P{const u=1-t,c=s.c;return c?{id:'',xMm:u*u*u*s.a.xMm+3*u*u*t*c.c1.xMm+3*u*t*t*c.c2.xMm+t*t*t*s.b.xMm,yMm:u*u*u*s.a.yMm+3*u*u*t*c.c1.yMm+3*u*t*t*c.c2.yMm+t*t*t*s.b.yMm}:{id:'',xMm:s.a.xMm+(s.b.xMm-s.a.xMm)*t,yMm:s.a.yMm+(s.b.yMm-s.a.yMm)*t};}
function portion(s:Segment,start:number,end:number,id:()=>string):Segment{
 const a=start===0?s.a:{...at(s,start),id:id()},b=end===1?s.b:{...at(s,end),id:id()};if(!s.c)return{a,b};
 const derivative=(t:number)=>{const u=1-t;return{xMm:3*(u*u*(s.c!.c1.xMm-s.a.xMm)+2*u*t*(s.c!.c2.xMm-s.c!.c1.xMm)+t*t*(s.b.xMm-s.c!.c2.xMm)),yMm:3*(u*u*(s.c!.c1.yMm-s.a.yMm)+2*u*t*(s.c!.c2.yMm-s.c!.c1.yMm)+t*t*(s.b.yMm-s.c!.c2.yMm))};};
 const u=derivative(start),v=derivative(end),dt=(end-start)/3;return{a,b,c:{...s.c,id:id(),startNodeId:a.id,endNodeId:b.id,c1:{id:id(),xMm:a.xMm+u.xMm*dt,yMm:a.yMm+u.yMm*dt},c2:{id:id(),xMm:b.xMm-v.xMm*dt,yMm:b.yMm-v.yMm*dt}}};
}
/** Replace only a source-certified corner interval. Every curve outside the
 * interval is retained exactly (cubic subsegments use exact endpoint derivatives).
 * In particular, discovering a sharp corner never refits another round end. */
export function spliceSourceTips(base:{nodes:P[];curves:C[]},closed:boolean,windows:{from:P;to:P;tip:P;through?:P[]}[],id:()=>string,compactStations=false,sourcePoints:P[]=[],matchTangents=true){
 const finite=(p:P)=>!!p&&Number.isFinite(p.xMm)&&Number.isFinite(p.yMm);let tips=0;
 if(!Array.isArray(base.nodes)||!Array.isArray(base.curves)||!Array.isArray(windows)||base.nodes.length<(closed?3:2)||base.nodes.length>2048||base.curves.length>512||windows.length>64||base.nodes.some(p=>!finite(p))||base.curves.some(c=>!c||!finite(c.c1)||!finite(c.c2))||windows.some(w=>!w||!finite(w.from)||!finite(w.to)||!finite(w.tip)||w.through!==undefined&&!Array.isArray(w.through)||(tips+=1+(w.through?.length??0))>64||w.through?.some(p=>!finite(p))))return;
 const segments:Segment[]=base.nodes.slice(0,closed?undefined:-1).map((a,i)=>{const b=base.nodes[(i+1)%base.nodes.length];return{a,b,c:base.curves.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id)};}),count=segments.length;
 if(!count||!windows.length)return;
 const nearest=(p:P)=>{
  let best={distance:Infinity,position:0,p};
  segments.forEach((s,i)=>{let t=0;if(!s.c){const x=s.b.xMm-s.a.xMm,y=s.b.yMm-s.a.yMm;t=Math.max(0,Math.min(1,((p.xMm-s.a.xMm)*x+(p.yMm-s.a.yMm)*y)/(x*x+y*y||1)));}
   else{let value=Infinity;for(let j=0;j<=32;j++){const d=distance(at(s,j/32),p);if(d<value){value=d;t=j/32;}}let lo=Math.max(0,t-1/32),hi=Math.min(1,t+1/32);for(let k=0;k<30;k++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(distance(at(s,a),p)<distance(at(s,b),p))hi=b;else lo=a;}t=(lo+hi)/2;}
   // Numerical minimization must not leave an infinitesimal cubic at an
   // existing station: its derivative is ill-conditioned after serialization.
   if(distance(at(s,t),s.a)<1e-6)t=0;else if(distance(at(s,t),s.b)<1e-6)t=1;
   const q=at(s,t),d=distance(q,p);if(d<best.distance)best={distance:d,position:i+t,p:q};
  });return best;
 };
 const edits:({a:number;b:number;from:P;to:P;tip:P;through:P[]})[]=[];
 for(const w of windows){const a=nearest(w.from),b=nearest(w.to);if(a.distance>2||b.distance>2)continue;const end=b.position+(b.position<=a.position&&closed?count:0);if(end<=a.position||end-a.position>=count-1e-5)continue;
  if(edits.some(e=>[0,-count,count].some(offset=>a.position<e.b+offset&&end>e.a+offset)))continue;
  edits.push({a:a.position,b:end,from:{...a.p,id:id()},to:{...b.p,id:id()},tip:w.tip,through:w.through??[]});
 }
 if(!edits.length)return;
 const inside=(position:number,e:typeof edits[number])=>position>=e.a&&position<e.b||closed&&position+count>=e.a&&position+count<e.b;
 const cuts=[...new Set([0,count,...segments.map((_,i)=>i),...edits.flatMap(e=>[e.a,e.b>count?e.b-count:e.b])])].sort((a,b)=>a-b),output:Segment[]=[];
 for(let i=0;i+1<cuts.length;i++){
  const start=cuts[i],end=cuts[i+1],edit=edits.find(e=>Math.abs(e.a-start)<1e-10);
  if(edit){const path=[edit.from,edit.tip,...edit.through,edit.to];for(let j=0;j+1<path.length;j++)output.push({a:path[j],b:path[j+1]});}
  if(edits.some(e=>inside((start+end)/2,e)))continue;
  const index=Math.min(count-1,Math.floor(start)),s=portion(segments[index],start-index,end-index,id);output.push(s);
 }
 if(output.length<(closed?3:1))return;
 // Adjacent exact subsegments share one node identity, including the cycle seam.
 for(let i=1;i<output.length;i++){if(distance(output[i-1].b,output[i].a)>1e-6)return;output[i].a=output[i-1].b;}
 if(closed){if(distance(output.at(-1)!.b,output[0].a)>1e-6)return;output.at(-1)!.b=output[0].a;}
 // A splice station is an implementation detail, not an observed corner.
 // Remove a straight connector station only within half a native pixel;
 // preserve all source vertices, inferred tips and every cubic exactly.
 const protectedIds=new Set([...base.nodes,...windows.flatMap(w=>[w.tip,...w.through??[]])].map(p=>p.id));
 let reduced=compactStations;while(reduced&&output.length>(closed?3:1)){reduced=false;for(let i=closed?0:1;i<output.length;i++){
  const previous=(i+output.length-1)%output.length,a=output[previous],b=output[i];if(a.c||b.c||protectedIds.has(b.a.id))continue;
  const dx=b.b.xMm-a.a.xMm,dy=b.b.yMm-a.a.yMm,length=dx*dx+dy*dy,t=length?((b.a.xMm-a.a.xMm)*dx+(b.a.yMm-a.a.yMm)*dy)/length:-1;
  if(t<0||t>1||Math.hypot(b.a.xMm-a.a.xMm-t*dx,b.a.yMm-a.a.yMm-t*dy)>.5)continue;
  // Removing a connector must not push an already represented source pixel
  // outside its native-pixel corridor. Check both old legs independently;
  // a distant inferred tip cannot mask a local increase of source error.
  const segmentDistance=(p:P,u:P,v:P)=>{const x=v.xMm-u.xMm,y=v.yMm-u.yMm,length=x*x+y*y,t=length?Math.max(0,Math.min(1,((p.xMm-u.xMm)*x+(p.yMm-u.yMm)*y)/length)):0;return Math.hypot(p.xMm-u.xMm-t*x,p.yMm-u.yMm-t*y);};
  if(sourcePoints.some(p=>{const before=Math.min(segmentDistance(p,a.a,b.a),segmentDistance(p,b.a,b.b));return before<=1.05&&segmentDistance(p,a.a,b.b)>Math.max(1,before+.025);}))continue;
  a.b=b.b;output.splice(i,1);reduced=true;break;
 }}
 if(compactStations&&matchTangents){
  const tips=new Set(windows.flatMap(w=>[w.tip,...w.through??[]]).map(p=>p.id));
  // Only the joins introduced by a corner splice need new endpoint
  // derivatives. Match the incident straight support while retaining the
  // cubic's handle length; the caller validates the complete source corridor.
  for(let i=closed?0:1;i<output.length;i++){
   const a=output[(i+output.length-1)%output.length],b=output[i];
   if(tips.has(b.a.id)||!!a.c===!!b.c||!edits.some(e=>distance(b.a,e.from)<1e-6||distance(b.a,e.to)<1e-6))continue;
   const line=a.c?b:a,dx=line.b.xMm-line.a.xMm,dy=line.b.yMm-line.a.yMm,l=Math.hypot(dx,dy);
   if(l<1e-6)continue;
   if(a.c){const h=distance(a.c.c2,a.b);a.c={...a.c,c2:{...a.c.c2,xMm:a.b.xMm-dx/l*h,yMm:a.b.yMm-dy/l*h}};}
   else if(b.c){const h=distance(b.c.c1,b.a);b.c={...b.c,c1:{...b.c.c1,xMm:b.a.xMm+dx/l*h,yMm:b.a.yMm+dy/l*h}};}
  }
 }
 const nodes=output.map(s=>s.a);if(!closed)nodes.push(output.at(-1)!.b);
 return{nodes,curves:output.filter(s=>s.c).map(s=>({...s.c!,startNodeId:s.a.id,endNodeId:s.b.id}))};
}
