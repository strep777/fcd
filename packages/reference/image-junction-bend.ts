import {inferTips,compareSourceTips} from './image-line-corners';
type P={xMm:number;yMm:number};
type Line={n:P;d:number};
type Ray={points:P[];colors:string[];line?:Line};
const dot=(a:P,b:P)=>a.xMm*b.xMm+a.yMm*b.yMm;
const distance=(a:P,b:P)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
/** A material corner can sit next to a three-color junction. Observe the
 * continuous material boundary across the junction before fitting the shared
 * branches. The other two colors are removed by an affine RGB measurement;
 * this commutes with antialiasing and blur, unlike per-pixel classification. */
export function measureJunctionBend(origin:P,rays:Ray[],width:number,height:number,rgba:Uint8Array){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4096*4096||rgba.length!==width*height*4)throw Error('IMAGE_LIMIT');
 const validPoint=(p:P)=>!!p&&Number.isFinite(p.xMm)&&Number.isFinite(p.yMm)&&p.xMm>=0&&p.yMm>=0&&p.xMm<=width&&p.yMm<=height;
 if(!validPoint(origin)||rays.length!==3||rays.some(r=>r.points.length<2||r.points.length>65536||r.points.some(p=>!validPoint(p))||r.colors.length!==2||r.colors.some(c=>!/^#[\da-f]{6}$/i.test(c))||r.line&&(!Number.isFinite(r.line.d)||!Number.isFinite(r.line.n.xMm)||!Number.isFinite(r.line.n.yMm)||Math.abs(Math.hypot(r.line.n.xMm,r.line.n.yMm)-1)>1e-6)))return;
 for(let third=0;third<3;third++){
  const a=(third+1)%3,b=(third+2)%3,background=rays[third].colors,foreground=rays[a].colors.filter(c=>rays[b].colors.includes(c)&&!background.includes(c));
  if(foreground.length!==1||background.length!==2||!rays[third].line||rays[a].points.length<35||rays[b].points.length<35)continue;
  const adjacent=[a,b].map(i=>rays[i].colors.filter(c=>c!==foreground[0]));
  if(adjacent.some(c=>c.length!==1||!background.includes(c[0]))||adjacent[0][0]===adjacent[1][0])continue;
  const color=(hex:string)=>[1,3,5].map(k=>parseInt(hex.slice(k,k+2),16)),bg=background.map(color),fg=color(foreground[0]);
  const v=bg[1].map((c,k)=>c-bg[0][k]),norm=v.reduce((s,c)=>s+c*c,0);if(norm<900)continue;
  const f=fg.map((c,k)=>c-bg[0][k]),projection=f.reduce((s,c,k)=>s+c*v[k],0)/norm,d=f.map((c,k)=>c-projection*v[k]),contrast=d.reduce((s,c)=>s+c*c,0);if(contrast<2500)continue;
  const first=rays[a].points.slice(0,65),second=rays[b].points.slice(0,65),chain=[...first].reverse().concat(second.slice(1));
  const left=Math.max(0,Math.floor(Math.min(...chain.map(p=>p.xMm)))-32),top=Math.max(0,Math.floor(Math.min(...chain.map(p=>p.yMm)))-32),right=Math.min(width,Math.ceil(Math.max(...chain.map(p=>p.xMm)))+32),bottom=Math.min(height,Math.ceil(Math.max(...chain.map(p=>p.yMm)))+32),w=right-left,h=bottom-top;
  if(w*h>65536)continue;
  const image=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=4*((y+top)*width+x+left),j=4*(y*w+x),value=64+128*d.reduce((s,c,k)=>s+c*(rgba[i+k]-bg[0][k]),0)/contrast;image[j]=image[j+1]=image[j+2]=Math.max(0,Math.min(255,Math.round(value)));image[j+3]=value>=0&&value<=255?rgba[i+3]:0;}
  const model=inferTips(chain.map(p=>({xMm:p.xMm-left,yMm:p.yMm-top})),false,w,h,image),candidates=model.candidates.map(c=>({...c,tip:{xMm:c.tip.xMm+left,yMm:c.tip.yMm+top}})).filter(c=>c.accepted&&distance(c.tip,origin)<24).sort(compareSourceTips);
  for(const c of candidates){
   const carrier=rays[third].line!,normals=[c.n1,c.n2],intersections=normals.map((n,index)=>{const det=n.xMm*carrier.n.yMm-n.yMm*carrier.n.xMm;if(Math.abs(det)<.2)return;const offset=dot(n,c.tip),tip={xMm:(offset*carrier.n.yMm-n.yMm*carrier.d)/det,yMm:(n.xMm*carrier.d-offset*carrier.n.xMm)/det};return{index,tip};}).filter((p):p is {index:number;tip:P}=>!!p&&distance(p.tip,origin)<8&&distance(p.tip,c.tip)>1&&distance(p.tip,c.tip)<24).sort((p,q)=>distance(p.tip,origin)-distance(q.tip,origin));
   const selected=intersections[0];if(!selected)continue;
   const tip=selected.tip,paths:{index:number;stop:number;points:P[]}[]=[];
   let valid=true;
   for(const [index,normal]of [[a,c.n1],[b,c.n2]] as const){
    const connected=normal===normals[selected.index],nearest=rays[index].points.slice(0,41).reduce((best,p,i,ps)=>distance(p,c.tip)<distance(ps[best],c.tip)?i:best,0),stop=Math.min(Math.max(20,connected?20:nearest+10),40,rays[index].points.length-2),p=rays[index].points[stop],offset=dot(normal,c.tip)-dot(normal,p),anchor={xMm:p.xMm+normal.xMm*offset,yMm:p.yMm+normal.yMm*offset};
    if(Math.abs(offset)>1.5){valid=false;break;}
    const points=connected?[tip,anchor]:[tip,c.tip,anchor];
    if(connected&&dot({xMm:tip.xMm-c.tip.xMm,yMm:tip.yMm-c.tip.yMm},{xMm:anchor.xMm-c.tip.xMm,yMm:anchor.yMm-c.tip.yMm})<=0){valid=false;break;}
    paths.push({index,stop,points});
   }
   if(!valid)continue;
   const stop=Math.min(12,rays[third].points.length-2),p=rays[third].points[stop],offset=carrier.d-dot(carrier.n,p),anchor={xMm:p.xMm+carrier.n.xMm*offset,yMm:p.yMm+carrier.n.yMm*offset};
   if(Math.abs(offset)>1.5)continue;paths.push({index:third,stop,points:[tip,anchor]});
   // Check opaque unambiguous source colors in the entire changed patch,
   // including the side of the third-color carrier. This forbids moving a
   // real material core across the jointly reconstructed boundaries.
   const palette=[...bg,fg],owner=(rgb:number[])=>{const errors=palette.map(color=>Math.hypot(...color.map((v,k)=>v-rgb[k]))),best=errors.indexOf(Math.min(...errors)),separation=Math.min(...palette.filter((_,i)=>i!==best).map(q=>Math.hypot(...q.map((v,k)=>v-palette[best][k]))));return errors[best]<separation*.18?best:-1;};
   const pixel=(x:number,y:number)=>{const ix=Math.floor(x),iy=Math.floor(y);if(ix<0||iy<0||ix>=width||iy>=height||rgba[4*(iy*width+ix)+3]!==255)return -1;return owner(Array.from(rgba.subarray(4*(iy*width+ix),4*(iy*width+ix)+3)));};
   const sidePoint=rays[third].points[Math.min(40,rays[third].points.length-2)],sideOffset=carrier.d-dot(carrier.n,sidePoint),sideAnchor={xMm:sidePoint.xMm+sideOffset*carrier.n.xMm,yMm:sidePoint.yMm+sideOffset*carrier.n.yMm};
   const sides=[-1,1].map(sign=>{const votes=[0,0,0];for(const fraction of[.85,1])for(const offset of[6,9,12]){const q={xMm:tip.xMm+(sideAnchor.xMm-tip.xMm)*fraction+sign*carrier.n.xMm*offset,yMm:tip.yMm+(sideAnchor.yMm-tip.yMm)*fraction+sign*carrier.n.yMm*offset},value=pixel(q.xMm,q.yMm);if(value>=0)votes[value]++;}const best=votes.indexOf(Math.max(...votes));return best<2&&votes[best]>=2&&votes.filter((_,i)=>i!==best).every(v=>v===0)?best:-1;});
   if(sides.some(v=>v<0||v===2)||sides[0]===sides[1])continue;
   const axis={xMm:c.n1.xMm+c.n2.xMm,yMm:c.n1.yMm+c.n2.yMm},length=Math.hypot(axis.xMm,axis.yMm),extent=Math.max(6,c.sigma*3),coverage=(sign:number)=>{const x=Math.floor(c.tip.xMm+sign*axis.xMm/length*extent)-left,y=Math.floor(c.tip.yMm+sign*axis.yMm/length*extent)-top,index=4*(y*w+x);return x>=0&&y>=0&&x<w&&y<h&&image[index+3]===255?image[index]:undefined;},insideValue=coverage(1),outsideValue=coverage(-1);
   // The foreground can have broad lighting/pigment variation; the affine
   // measurement still separates it from both background materials. Use
   // observed contrast to orient the wedge, not distance to a global swatch.
   if(insideValue===undefined||outsideValue===undefined||Math.abs(insideValue-outsideValue)<30)continue;
   const foregroundInside=insideValue>outsideValue,changed=paths.flatMap(p=>[...p.points,...rays[p.index].points.slice(0,p.stop+1)]),loX=Math.max(0,Math.floor(Math.min(...changed.map(p=>p.xMm)))-1),hiX=Math.min(width-1,Math.ceil(Math.max(...changed.map(p=>p.xMm)))+1),loY=Math.max(0,Math.floor(Math.min(...changed.map(p=>p.yMm)))-1),hiY=Math.min(height-1,Math.ceil(Math.max(...changed.map(p=>p.yMm)))+1);
   if((hiX-loX+1)*(hiY-loY+1)>4096)continue;
   for(let y=loY;y<=hiY&&valid;y++)for(let x=loX;x<=hiX;x++){
    const observed=pixel(x+.5,y+.5);if(observed<0)continue;const q={xMm:x+.5,yMm:y+.5},delta={xMm:q.xMm-c.tip.xMm,yMm:q.yMm-c.tip.yMm},inside=dot(c.n1,delta)>=0&&dot(c.n2,delta)>=0,predicted=inside===foregroundInside?2:sides[dot(carrier.n,q)>=carrier.d?1:0];if(observed!==predicted){valid=false;break;}
   }
   if(valid)return{tip,corner:c.tip,paths};
  }
 }
}
