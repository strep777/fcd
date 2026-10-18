import type {Point} from '../schema/index';
import {measureMaterialJunction} from './image-junction-model';
import {measureJunctionBend} from './image-junction-bend';
type P={xMm:number;yMm:number};
type Branch={raw:Point[];closed:boolean;colors:string[]};
const distance=(a:P,b:P)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
const dot=(a:P,b:P)=>a.xMm*b.xMm+a.yMm*b.yMm;
function line(points:P[]){const c={xMm:points.reduce((s,p)=>s+p.xMm,0)/points.length,yMm:points.reduce((s,p)=>s+p.yMm,0)/points.length};let xx=0,xy=0,yy=0;for(const p of points){const x=p.xMm-c.xMm,y=p.yMm-c.yMm;xx+=x*x;xy+=x*y;yy+=y*y;}const t=.5*Math.atan2(2*xy,xx-yy),n={xMm:-Math.sin(t),yMm:Math.cos(t)},d=dot(n,c),errors=points.map(p=>dot(n,p)-d);return{n,d,error:Math.sqrt(errors.reduce((s,v)=>s+v*v,0)/points.length),range:Math.max(...errors)-Math.min(...errors)};}
export function sourceJunctions(branches:Branch[],width:number,height:number,rgba:Uint8Array){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4096*4096||rgba.length!==width*height*4)throw Error('IMAGE_LIMIT');
 if(branches.length>2048)return;
 let vertices=0,samplesBudget=0;
 for(const branch of branches){
  vertices+=branch.raw.length;if(vertices>65536||branch.raw.length<(branch.closed?3:2))return;
  if(branch.raw.some(p=>!Number.isFinite(p.xMm)||!Number.isFinite(p.yMm)||p.xMm<0||p.yMm<0||p.xMm>width||p.yMm>height))return;
  if(branch.closed)continue;
  samplesBudget++;
  for(let i=0;i+1<branch.raw.length;i++){samplesBudget+=Math.max(1,Math.ceil(distance(branch.raw[i],branch.raw[i+1])-1e-8));if(!Number.isFinite(samplesBudget)||samplesBudget>65536)return;}
 }

 const rgb=(p:P)=>{const x=p.xMm-.5,y=p.yMm-.5,ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;if(ix<0||iy<0||ix>=width-1||iy>=height-1)return;const at=(dx:number,dy:number,c:number)=>rgba[4*((iy+dy)*width+ix+dx)+c];if([0,1].some(dy=>[0,1].some(dx=>at(dx,dy,3)!==255)))return;return[0,1,2].map(c=>at(0,0,c)*(1-tx)*(1-ty)+at(1,0,c)*tx*(1-ty)+at(0,1,c)*(1-tx)*ty+at(1,1,c)*tx*ty);};
 // Prefix windows are physical pixels, independent of the tracer's vertex
 // spacing. Carry the arc-length remainder across segments.
 const samples=branches.map(b=>{if(b.closed)return[];const out:Point[]=[b.raw[0]];let travelled=0,next=1;for(let i=0;i<b.raw.length-1;i++){const a=b.raw[i],p=b.raw[i+1],length=distance(a,p);if(!length)continue;while(next<travelled+length-1e-8){const t=(next-travelled)/length;out.push({...a,xMm:a.xMm+(p.xMm-a.xMm)*t,yMm:a.yMm+(p.yMm-a.yMm)*t});next++;}travelled+=length;}if(distance(out.at(-1)!,b.raw.at(-1)!)>1e-8)out.push(b.raw.at(-1)!);return out;});
 const key=(p:P)=>Math.round(p.xMm*1e8)+':'+Math.round(p.yMm*1e8),junctions=new Map<string,{branch:number;end:number}[]>();
 branches.forEach((b,i)=>{if(b.closed)return;for(const end of[0,1]){const k=key(end?b.raw.at(-1)!:b.raw[0]);junctions.set(k,[...junctions.get(k)??[],{branch:i,end}]);}});
 // Check the actual proposed prefix against unambiguous RGB cores. A core
 // swept by a moved boundary is allowed only if it ends on its observed side.
 const changesCoreOwner=(ps:Point[],stop:number,fit:ReturnType<typeof line>,colors:string[],tip:P,finalAnchor?:P,observedSides?:number[])=>{
  const project=(p:P)=>{const t=fit.d-dot(fit.n,p);return{xMm:p.xMm+t*fit.n.xMm,yMm:p.yMm+t*fit.n.yMm};};
  const anchor=finalAnchor??project(ps[stop]),polygon=[...ps.slice(0,stop+1),anchor,tip];
  const loX=Math.max(0,Math.floor(Math.min(...polygon.map(p=>p.xMm)))),hiX=Math.min(width-1,Math.ceil(Math.max(...polygon.map(p=>p.xMm)))),loY=Math.max(0,Math.floor(Math.min(...polygon.map(p=>p.yMm)))),hiY=Math.min(height-1,Math.ceil(Math.max(...polygon.map(p=>p.yMm))));
  if((hiX-loX+1)*(hiY-loY+1)>4096)return true;
  const palette=colors.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)/255)),chromatic=palette.every(c=>Math.max(...c)>.2),normalize=(c:number[])=>chromatic?c.map(v=>v/(c.reduce((s,v)=>s+v,0)||1)):c;
  const cores=palette.map(normalize),contrast=Math.hypot(...cores[0].map((v,k)=>v-cores[1][k]));if(contrast<.025)return true;
  const owner=(color:number[])=>{const value=normalize(color),d=cores.map(c=>Math.hypot(...c.map((v,k)=>v-value[k]))),best=d[0]<=d[1]?0:1;return d[best]<=contrast*.12?best:-1;};
  const inside=(x:number,y:number)=>{let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.yMm>y)!==(b.yMm>y)&&x<(b.xMm-a.xMm)*(y-a.yMm)/(b.yMm-a.yMm)+a.xMm)hit=!hit;}return hit;};
  let sides:number[]|undefined=observedSides;
  for(let y=loY;y<=hiY;y++)for(let x=loX;x<=hiX;x++)if(inside(x+.5,y+.5)){
   const index=4*(y*width+x);if(rgba[index+3]!==255)return true;
   const expected=owner([rgba[index]/255,rgba[index+1]/255,rgba[index+2]/255]);if(expected<0)continue;
   if(!sides){
    sides=[];
    for(const sign of[-1,1]){const votes=[0,0];for(const p of ps.slice(Math.min(5,stop-5),stop+1)){const q=project(p),color=rgb({xMm:q.xMm+sign*fit.n.xMm*6,yMm:q.yMm+sign*fit.n.yMm*6});if(color){const id=owner(color.map(v=>v/255));if(id>=0)votes[id]++;}}
     const best=votes[0]>=votes[1]?0:1;if(votes[best]<3||votes[1-best]>0)return true;sides.push(best);
    }if(sides[0]===sides[1])return true;
   }
   // Use the final segment, not its infinite carrier: the jointly estimated
   // junction can have a small residual to any one incident source line.
   const nx=-(anchor.yMm-tip.yMm),ny=anchor.xMm-tip.xMm,orientation=Math.sign(nx*fit.n.xMm+ny*fit.n.yMm),side=orientation*(nx*(x+.5-tip.xMm)+ny*(y+.5-tip.yMm));
   if(!orientation||Math.abs(side)<1e-9||sides[side>=0?1:0]!==expected)return true;
  }return false;
 };
 const carrier=(branch:number,end:number)=>{
  const b=branches[branch],ps=end?[...samples[branch]].reverse():samples[branch];if(ps.length<7)return;
  const border=(p:P)=>p.xMm===0?'left':p.xMm===width?'right':p.yMm===0?'top':p.yMm===height?'bottom':undefined,side=border(ps[0]);
  let edge=0;if(side)while(edge<Math.min(12,ps.length)&&border(ps[edge])===side)edge++;if(edge>=4)return{...line(ps.slice(0,edge)),stop:edge-1,border:true};
  if(b.colors.length!==2)return;
  const palette=b.colors.map(color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16))),chromatic=palette.every(c=>Math.max(...c)>51);
  const normalize=(color:number[])=>chromatic?color.map(v=>v/(color.reduce((sum,v)=>sum+v,0)||1)):color.map(v=>v/255),cores=palette.map(normalize),contrast=Math.hypot(...cores[0].map((v,i)=>v-cores[1][i]));
  if(!Number.isFinite(contrast)||contrast<.025)return;
  const owner=(color:number[])=>{const observed=normalize(color),errors=cores.map(core=>Math.hypot(...core.map((v,i)=>v-observed[i]))),best=errors[0]<=errors[1]?0:1;return errors[best]<=contrast*.12?best:-1;};
  for(const[begin,end]of[[5,20],[4,14],[3,10],[2,7],[8,24],[12,28],[20,36]]){const stop=Math.min(end,ps.length-3),base=ps.slice(begin,stop+1);if(base.length<6)continue;const l=line(base);if(l.range>1.2)continue;const measured:P[]=[];
   for(const p of base){const profile=Array.from({length:49},(_,i)=>rgb({xMm:p.xMm+l.n.xMm*(i/4-6),yMm:p.yMm+l.n.yMm*(i/4-6)}));if(profile.some(v=>!v))continue;const a=[0,1,2].map(c=>(profile[0]![c]+profile[1]![c])/2),b=[0,1,2].map(c=>(profile[47]![c]+profile[48]![c])/2),d=b.map((v,c)=>v-a[c]),norm=d.reduce((s,v)=>s+v*v,0);if(norm<30**2)continue;
    // A third material can produce a convincing half-contrast crossing near
    // a junction. Both plateaus must belong to this branch's actual owners.
    const leftOwner=owner(a),rightOwner=owner(b);if(leftOwner<0||rightOwner<0||leftOwner===rightOwner)continue;
    const values=profile.map(v=>v!.reduce((s,v,c)=>s+(v-a[c])*d[c],0)/norm),cross:number[]=[];for(let j=12;j<36;j++)if(values[j]<=.5&&values[j+1]>.5)cross.push(j/4-6+.25*(.5-values[j])/(values[j+1]-values[j]));if(cross.length!==1||Math.abs(cross[0])>2.5)continue;measured.push({xMm:p.xMm+l.n.xMm*cross[0],yMm:p.yMm+l.n.yMm*cross[0]});}
   if(measured.length<Math.max(5,base.length*.7))continue;const fit=line(measured);if(fit.error>.18||fit.range>.6||Math.abs(dot(fit.n,l.n))<.98)continue;
   return{...fit,stop,border:false};
  }
 };
 const replacements=new Map<number,{end:number;stop:number;line:ReturnType<typeof line>;tip:P;through?:P[]}[]>(),evidence:unknown[]=[];
 let jointBudget=0;
 for(const[k,incident]of junctions){if(incident.length<3||incident.length>4)continue;let lines:((NonNullable<ReturnType<typeof carrier>>&{coreSides?:number[]})|undefined)[]=incident.map(e=>carrier(e.branch,e.end));
  if(lines.some(l=>!l)){
   if(incident.length!==3||jointBudget++>=32)continue;
   const rays=incident.map(e=>({points:e.end?[...samples[e.branch]].reverse():samples[e.branch],colors:branches[e.branch].colors}));
   // A short branch ends at a second junction; its pixels do not belong to
   // this three-sector model. Keep the observation patch on this side of
   // the midpoint, or retain the raster when too little support remains.
   const origin=rays[0].points[0],radius=Math.min(7,...rays.map(r=>Math.floor(distance(origin,r.points.at(-1)!)/2)-1));
   const joint=measureMaterialJunction(origin,rays,width,height,rgba,radius);if(!joint)continue;
   lines=joint.rays.sort((a,b)=>a.index-b.index).map((r,i)=>{const n={xMm:-Math.sin(r.angle),yMm:Math.cos(r.angle)};return{n,d:dot(n,joint.tip),error:joint.error,range:joint.error,stop:Math.min(radius,Math.floor(rays[i].points.length/3)),border:false,coreSides:[rays[i].colors.indexOf(r.negativeColor),rays[i].colors.indexOf(r.positiveColor)]};});
  }
  let xx=0,xy=0,yy=0,bx=0,by=0;for(const l of lines){xx+=l!.n.xMm**2;xy+=l!.n.xMm*l!.n.yMm;yy+=l!.n.yMm**2;bx+=l!.n.xMm*l!.d;by+=l!.n.yMm*l!.d;}const det=xx*yy-xy*xy;
  // The determinant alone is angle-dependent, not a positional error. A
  // shallow but precisely observed intersection remains useful; propagate
  // the measured line uncertainty through its normal equations instead.
  const uncertainty=Math.max(.025,...lines.map(l=>l!.error))*Math.sqrt((xx+yy)/det);
  if(det<=1e-10||!Number.isFinite(uncertainty)||uncertainty>.5)continue;let tip={xMm:(bx*yy-by*xy)/det,yMm:(by*xx-bx*xy)/det};const first=incident[0],raw=first.end?branches[first.branch].raw.at(-1)!:branches[first.branch].raw[0];
  const fixed=lines.find(l=>l!.border);if(fixed){const t=fixed.d-dot(fixed.n,tip);tip={xMm:tip.xMm+t*fixed.n.xMm,yMm:tip.yMm+t*fixed.n.yMm};}
  const movement=distance(tip,raw),residual=Math.max(...lines.map(l=>Math.abs(dot(l!.n,tip)-l!.d)));if(movement<.15||movement>4||residual>.55||tip.xMm<0||tip.yMm<0||tip.xMm>width||tip.yMm>height)continue;
  if(incident.some((e,i)=>!lines[i]!.border&&changesCoreOwner(e.end?[...samples[e.branch]].reverse():samples[e.branch],lines[i]!.stop,lines[i]!,branches[e.branch].colors,tip,undefined,lines[i]!.coreSides)))continue;
  incident.forEach((e,i)=>replacements.set(e.branch,[...replacements.get(e.branch)??[],{...e,stop:lines[i]!.stop,line:lines[i]!,tip}]));evidence.push({raw,tip,residual,movement});
 }
 let bendBudget=0;
 for(const incident of junctions.values()){
  if(incident.length!==3)continue;
  const rays=incident.map(e=>({points:e.end?[...samples[e.branch]].reverse():samples[e.branch],colors:branches[e.branch].colors,line:carrier(e.branch,e.end)??replacements.get(e.branch)?.find(r=>r.end===e.end)?.line}));
  if(rays.filter(r=>r.points.length>=35).length<2||!rays.some(r=>r.line)||bendBudget++>=8)continue;
  const bend=measureJunctionBend(rays[0].points[0],rays,width,height,rgba);if(!bend)continue;
  if(bend.paths.some(p=>p.stop+(replacements.get(incident[p.index].branch)?.filter(e=>e.end!==incident[p.index].end).reduce((s,e)=>s+e.stop,0)??0)>=rays[p.index].points.length-2))continue;
  for(const p of bend.paths){const e=incident[p.index],points=p.points;replacements.set(e.branch,[...(replacements.get(e.branch)??[]).filter(r=>r.end!==e.end),{end:e.end,stop:p.stop,line:line(points.slice(-2)),tip:bend.tip,through:points.slice(1,-1)}]);}
  evidence.push({bend});
 }
 if(!evidence.length)return;
 const output=branches.map((b,i)=>{const edits=replacements.get(i);if(!edits)return b.raw;const ps=samples[i].map(p=>({...p}));if(edits.reduce((s,e)=>s+e.stop,0)>=ps.length-2){if(edits.length!==2||Math.abs(dot(edits[0].line.n,edits[1].line.n))<.995)return b.raw;const a=edits.find(e=>!e.end)!,z=edits.find(e=>!!e.end)!;// Overlapping endpoint prefixes become one segment. Validate that final
 // segment's complete swept region, not only the two earlier partial edits.
 if(b.colors.length===2&&changesCoreOwner(ps,ps.length-1,line([a.tip,z.tip]),b.colors,a.tip,z.tip))return b.raw;
 return[{...ps[0],...a.tip},{...ps.at(-1)!,...z.tip}];}const omit=new Set<number>(),before=new Map<number,Point[]>(),after=new Map<number,Point[]>();for(const e of edits){for(let t=0;t<=e.stop;t++){const j=e.end?ps.length-1-t:t,p=ps[j];if(!t){ps[j]={...p,...e.tip};if(e.through?.length)(e.end?before:after).set(j,e.through.map((q,k)=>({...q,id:ps[e.end?j-1-k:j+1+k].id})));continue;}if(t<e.stop){omit.add(j);continue;}const d=e.line.d-dot(e.line.n,p);ps[j]={...p,xMm:p.xMm+d*e.line.n.xMm,yMm:p.yMm+d*e.line.n.yMm};}}return ps.flatMap((p,j)=>omit.has(j)?[]:[...(before.get(j)??[]).reverse(),p,...after.get(j)??[]]);});
 // A junction is all-or-nothing; every incident endpoint must be identical.
 for(const incident of junctions.values()){const ps=incident.map(e=>e.end?output[e.branch].at(-1)!:output[e.branch][0]);if(ps.some(p=>distance(p,ps[0])>1e-7))return;}
 return{output,evidence,corners:[...replacements.values()].flatMap(edits=>edits.flatMap(edit=>edit.through??[]))};
}
