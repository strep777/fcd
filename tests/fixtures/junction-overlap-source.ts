import{calibratedPoint}from'../../apps/desktop/main/reference-segmentation';
export type XY={x:number;y:number};
export type Spec={name:string;angle:number;tx:number;ty:number;scale:number;worldRotation:number;spur:boolean};
export const cases:Spec[]=[
 {name:'straight double junction native phase',angle:0,tx:0,ty:0,scale:1,worldRotation:0,spur:false},
 {name:'straight double junction translated rotated small',angle:.37,tx:.41,ty:-.27,scale:.05,worldRotation:.37,spur:false},
 {name:'straight double junction translated rotated large',angle:1.07,tx:-.23,ty:.31,scale:10,worldRotation:1.07,spur:false},
 {name:'real short material protrusion cannot be replaced by a chord',angle:0,tx:0,ty:0,scale:1,worldRotation:0,spur:true},
 {name:'rotated real short material protrusion retains its cores',angle:.37,tx:.41,ty:-.27,scale:.05,worldRotation:.37,spur:true}
];
export function source(spec:Spec){
 const width=96,height=96,aa=8,center={x:48,y:48},co=Math.cos(spec.angle),si=Math.sin(spec.angle),colors=[[240,220,40],[35,70,220],[220,40,60],[40,210,90]],upper=38.27,lower=50.67,middle=(upper+lower)/2;
 const local=(p:XY)=>{const x=p.x-center.x-spec.tx,y=p.y-center.y-spec.ty;return{x:center.x+x*co+y*si,y:center.y-x*si+y*co};};
 const native=(p:XY)=>({x:center.x+spec.tx+(p.x-center.x)*co-(p.y-center.y)*si,y:center.y+spec.ty+(p.x-center.x)*si+(p.y-center.y)*co});
 const boundaryX=(y:number)=>48.23+(spec.spur?2.5*Math.max(0,1-Math.abs(y-middle)/2):0);
 const owner=(p:XY)=>p.y<upper?2:p.y>=lower?3:p.x<boundaryX(p.y)?0:1;
 const rgba=new Uint8Array(width*height*4),cores:{p:XY;owner:number;rgba:number[]}[]=[];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const sums=[0,0,0],members=new Set<number>();
  for(let sy=0;sy<aa;sy++)for(let sx=0;sx<aa;sx++){const id=owner(local({x:x+(sx+.5)/aa,y:y+(sy+.5)/aa}));members.add(id);for(let k=0;k<3;k++)sums[k]+=colors[id][k];}
  const rgb=sums.map(v=>Math.round(v/(aa*aa)));rgba.set([...rgb,255],4*(y*width+x));
  const p={x:x+.5,y:y+.5},q=local(p),id=owner(q);
  // These are source-renderer material cores: every8x8 sub-sample is the
  // same prescribed material. No classified mask or proposal defines them.
  if(members.size===1&&id<2&&q.y>upper+2&&q.y<lower-2&&Math.abs(q.x-48.23)<3)cores.push({p,owner:id,rgba:[...colors[id],255]});
 }
 const calibration={a:{x:13,y:height-9},b:{x:13+height*Math.sin(spec.worldRotation),y:height-9-height*Math.cos(spec.worldRotation)},distanceMm:height*spec.scale};
 const fromPixel=(p:{xMm:number;yMm:number})=>calibratedPoint(p.xMm,p.yMm,calibration),toPixel=(p:{xMm:number;yMm:number})=>{const dx=calibration.b.x-calibration.a.x,dy=calibration.b.y-calibration.a.y;return{x:calibration.a.x+(-dy*p.xMm+dx*p.yMm)/calibration.distanceMm,y:calibration.a.y+(dx*p.xMm+dy*p.yMm)/calibration.distanceMm};};
 const tips=[native({x:48.23,y:upper}),native({x:48.23,y:lower})],seeds=[native({x:25,y:middle}),native({x:70,y:middle}),native({x:55,y:20}),native({x:55,y:75})];
 const boundaryDistance=(p:XY)=>{const q=local(p);let best=Math.min(Math.abs(q.y-upper),Math.abs(q.y-lower),p.x,width-p.x,p.y,height-p.y);for(let i=0;i<496;i++){const a={x:boundaryX(upper+(lower-upper)*i/496),y:upper+(lower-upper)*i/496},b={x:boundaryX(upper+(lower-upper)*(i+1)/496),y:upper+(lower-upper)*(i+1)/496},dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/(dx*dx+dy*dy)));best=Math.min(best,Math.hypot(q.x-a.x-t*dx,q.y-a.y-t*dy));}return best;};
 return{spec,width,height,aa,rgba,cores,colors,local,native,owner,tips,seeds,boundaryDistance,calibration,toPixel,fromPixel};
}
