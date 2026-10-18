import type {Point} from '../schema/index';
import {materialObservation,materialTips} from './image-material-observation';
import {compareSourceTips} from './image-line-corners';
type P={xMm:number;yMm:number};
type Branch={raw:Point[];closed:boolean;colors:string[]};
const distance=(a:P,b:P)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm),dot=(a:P,b:P)=>a.xMm*b.xMm+a.yMm*b.yMm;
const key=(p:P)=>Math.round(p.xMm*1e8)+':'+Math.round(p.yMm*1e8);
const inside=(p:P,ring:P[])=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.yMm>p.yMm)!==(b.yMm>p.yMm)&&p.xMm<(b.xMm-a.xMm)*(p.yMm-a.yMm)/(b.yMm-a.yMm)+a.xMm)hit=!hit;}return hit;};
/** A short color-specific branch may contain a real material corner but not
 * enough flank pixels on its own. Follow that same material through both
 * junctions to observe the corner. Move every incident endpoint together;
 * preserve the other material cores and retain unsupported source geometry. */
export function shortMaterialBranches(branches:Branch[],width:number,height:number,rgba:Uint8Array){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4096*4096||rgba.length!==width*height*4)throw Error('IMAGE_LIMIT');
 if(branches.length>2048||branches.reduce((n,b)=>n+b.raw.length,0)>65536||branches.some(b=>b.raw.length<(b.closed?3:2)||b.raw.some(p=>!Number.isFinite(p.xMm)||!Number.isFinite(p.yMm)||p.xMm<0||p.yMm<0||p.xMm>width||p.yMm>height)))return;
 const joints=new Map<string,{index:number;end:number}[]>();branches.forEach((b,index)=>{if(!b.closed)for(const end of[0,1]){const k=key(end?b.raw.at(-1)!:b.raw[0]);joints.set(k,[...joints.get(k)??[],{index,end}]);}});
 const rays=(index:number,end:number)=>{const raw=end?[...branches[index].raw].reverse():branches[index].raw,points:Point[]=[raw[0]];let travelled=0,next=1;for(let i=0;i<raw.length-1&&points.length<=80;i++){const a=raw[i],b=raw[i+1],length=distance(a,b);while(next<travelled+length-1e-8&&points.length<=80){const t=(next-travelled)/length;points.push({...a,xMm:a.xMm+t*(b.xMm-a.xMm),yMm:a.yMm+t*(b.yMm-a.yMm)});next++;}travelled+=length;}return points;};
 const output=branches.map(b=>b.raw),corners:P[]=[],used=new Set<number>();let budget=0;
 for(let index=0;index<branches.length&&budget<4;index++){
  const branch=branches[index];if(branch.closed||branch.colors.length!==2||used.has(index))continue;
  const length=branch.raw.slice(1).reduce((s,p,i)=>s+distance(p,branch.raw[i]),0);if(length<8||length>48)continue;
  const endpoints=[branch.raw[0],branch.raw.at(-1)!],incident=endpoints.map(p=>joints.get(key(p))!);if(incident.some(v=>v.length!==3))continue;
  for(const foreground of branch.colors){
   const neighboring=incident.map(entries=>entries.filter(e=>e.index!==index)),along=neighboring.map(entries=>entries.filter(e=>branches[e.index].colors.includes(foreground))),across=neighboring.map(entries=>entries.filter(e=>!branches[e.index].colors.includes(foreground)));
   if(along.some(a=>a.length!==1)||across.some(a=>a.length!==1))continue;
   const adj=along.map(a=>a[0]),bg=across.map(a=>a[0]),backgrounds=branches[bg[0].index].colors;
   if(backgrounds.length!==2||backgrounds.includes(foreground)||branches[bg[1].index].colors.length!==2||branches[bg[1].index].colors.some(c=>!backgrounds.includes(c))||[...adj,...bg].some(e=>used.has(e.index))||new Set([...adj,...bg].map(e=>e.index)).size<3)continue;
   if(adj.some(e=>branches[e.index].colors.length!==2||branches[e.index].colors.some(c=>c!==foreground&&!backgrounds.includes(c))))continue;
   const extended=adj.map(e=>rays(e.index,e.end).slice(0,41));if(extended.some(ps=>ps.length<30))continue;
   const context=[...extended[0]].reverse().concat(branch.raw.slice(1),extended[1].slice(1));if(budget++>=4)break;
   const observation=materialObservation(context,foreground,backgrounds,width,height,rgba),model=materialTips(context,false,foreground,backgrounds,width,height,rgba,true);if(!observation||!model)continue;
   const accepted=model.candidates.filter(c=>c.accepted&&(c.fitError??Infinity)<.015&&Math.min(...branch.raw.map(p=>distance(p,c.tip)))<8&&endpoints.every(p=>distance(p,c.tip)<32)).sort(compareSourceTips);
   for(const c of accepted){
    const normals=[c.n1,c.n2],project=(p:P,n:P)=>{const d=dot(n,c.tip)-dot(n,p);return{xMm:p.xMm+n.xMm*d,yMm:p.yMm+n.yMm*d};},tips=endpoints.map((p,i)=>project(p,normals[i]));
    if(tips.some((p,i)=>distance(p,endpoints[i])>8||distance(p,c.tip)<1))continue;
    const proposals=new Map<number,Point[]>(),prefixes=new Map<number,{end:number;cut:number;points:Point[]}[]>(),patches:{old:Point[];next:Point[];background?:number}[]=[];let valid=true;
    const prefix=(entry:{index:number;end:number},cut:number,points:Point[])=>prefixes.set(entry.index,[...prefixes.get(entry.index)??[],{end:entry.end,cut,points}]);
    const short=[{...branch.raw[0],...tips[0]},{...c.tip,id:branch.raw[Math.floor(branch.raw.length/2)].id},{...branch.raw.at(-1)!,...tips[1]}];proposals.set(index,short);patches.push({old:branch.raw,next:short});
    for(let side=0;side<2;side++){
     const entry=adj[side],points=rays(entry.index,entry.end),stop=Math.min(18,points.length-2),anchor=project(points[stop],normals[side]);
     if(distance(anchor,points[stop])>1.5||dot({xMm:tips[side].xMm-c.tip.xMm,yMm:tips[side].yMm-c.tip.yMm},{xMm:anchor.xMm-c.tip.xMm,yMm:anchor.yMm-c.tip.yMm})<=0){valid=false;break;}
     const tail=entry.end?[...branches[entry.index].raw].reverse():branches[entry.index].raw;let arc=0,cut=0;while(cut+1<tail.length&&arc<stop){arc+=distance(tail[cut],tail[cut+1]);cut++;}const after=[{...tail[0],...tips[side]},{...points[stop],...anchor},...tail.slice(cut)];prefix(entry,cut,after.slice(0,2));patches.push({old:tail.slice(0,cut+1),next:after.slice(0,3)});
     const third=bg[side],raw=third.end?[...branches[third.index].raw].reverse():branches[third.index].raw;let end=1,travel=distance(raw[0],raw[1]);while(end+1<raw.length&&travel<6){travel+=distance(raw[end],raw[end+1]);end++;}const changed=[{...raw[0],...tips[side]},...raw.slice(end)];prefix(third,end,changed.slice(0,1));patches.push({old:raw.slice(0,end+1),next:changed.slice(0,2),background:side});
    }
    if(!valid)continue;
    // Both flanks can be opposite ends of the same longer boundary (for
    // example a material island crossing a background seam). Merge the two
    // disjoint prefix edits atomically instead of overwriting either end.
    for(const [index,edits]of prefixes){
     if(edits.length>2||new Set(edits.map(e=>e.end)).size!==edits.length){valid=false;break;}
     const raw=branches[index].raw,start=edits.find(e=>!e.end),end=edits.find(e=>e.end),lo=start?.cut??0,hi=raw.length-1-(end?.cut??0);
     if(lo>hi){valid=false;break;}
     proposals.set(index,[...start?.points??[],...raw.slice(lo,hi+1),...[...end?.points??[]].reverse()]);
    }
    if(!valid)continue;
    const axis={xMm:c.n1.xMm+c.n2.xMm,yMm:c.n1.yMm+c.n2.yMm},axisLength=Math.hypot(axis.xMm,axis.yMm),gray=(sign:number)=>{const x=Math.floor(c.tip.xMm+axis.xMm/axisLength*sign*Math.max(6,c.sigma*3))-observation.left,y=Math.floor(c.tip.yMm+axis.yMm/axisLength*sign*Math.max(6,c.sigma*3))-observation.top,i=4*(y*observation.width+x);return x>=0&&y>=0&&x<observation.width&&y<observation.height&&observation.image[i+3]===255?observation.image[i]:undefined;},one=gray(1),other=gray(-1);
    if(one===undefined||other===undefined||Math.abs(one-other)<30)continue;const fgInside=one>other,isForeground=(p:P)=>(dot(c.n1,{xMm:p.xMm-c.tip.xMm,yMm:p.yMm-c.tip.yMm})>=0&&dot(c.n2,{xMm:p.xMm-c.tip.xMm,yMm:p.yMm-c.tip.yMm})>=0)===fgInside;
    const palette=[foreground,...backgrounds].map(color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16))),owner=(p:P)=>{const x=Math.floor(p.xMm),y=Math.floor(p.yMm);if(x<0||y<0||x>=width||y>=height)return-2;const i=4*(y*width+x);if(rgba[i+3]!==255)return-2;const errors=palette.map(color=>Math.hypot(...color.map((v,k)=>v-rgba[i+k]))),best=errors.indexOf(Math.min(...errors)),contrast=Math.min(...palette.filter((_,i)=>i!==best).map(color=>Math.hypot(...color.map((v,k)=>v-palette[best][k]))));return errors[best]<contrast*.15?best:-1;};
    for(const patch of patches){
     const ring=[...patch.old,...[...patch.next].reverse()],loX=Math.max(0,Math.floor(Math.min(...ring.map(p=>p.xMm)))),hiX=Math.min(width-1,Math.ceil(Math.max(...ring.map(p=>p.xMm)))),loY=Math.max(0,Math.floor(Math.min(...ring.map(p=>p.yMm)))),hiY=Math.min(height-1,Math.ceil(Math.max(...ring.map(p=>p.yMm))));if((hiX-loX+1)*(hiY-loY+1)>4096){valid=false;break;}
     if(patch.background!==undefined){const [a,b]=patch.next;for(let t=.05;t<1;t+=.05)if(isForeground({xMm:a.xMm+(b.xMm-a.xMm)*t,yMm:a.yMm+(b.yMm-a.yMm)*t})){valid=false;break;}}
     for(let y=loY;y<=hiY&&valid;y++)for(let x=loX;x<=hiX;x++){const p={xMm:x+.5,yMm:y+.5};if(!inside(p,ring))continue;const seen=owner(p),delta={xMm:p.xMm-c.tip.xMm,yMm:p.yMm-c.tip.yMm},mixed=Math.min(Math.abs(dot(c.n1,delta)),Math.abs(dot(c.n2,delta)))<=3*c.sigma;
      // At a blurred acute tip even an interior pixel can be mostly the
      // surrounding color. Such a pixel is not a physical material core;
      // its evidence is the fitted coverage model. Keep opaque core checks
      // outside that model's three-sigma transition and all alpha checks.
      if(seen===-2||!mixed&&(seen>=0&&isForeground(p)!==(seen===0)||patch.background!==undefined&&seen>0)){valid=false;break;}}
     if(!valid)break;
    }
    if(!valid)continue;for(const [i,path]of proposals){output[i]=path;used.add(i);}corners.push(c.tip);break;
   }
   if(used.has(index))break;
  }
 }
 for(const incident of joints.values()){const ends=incident.map(e=>e.end?output[e.index].at(-1)!:output[e.index][0]);if(ends.some(p=>distance(p,ends[0])>1e-7))return;}
 return corners.length?{output,corners}:undefined;
}
