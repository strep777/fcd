import {expect,it} from 'vitest';
import sharp from 'sharp';
import {measureMaterialJunction} from '../../packages/reference/image-junction-model';
import {sourceJunctions} from '../../packages/reference/image-tip-junctions';

const palette=['#e43d4b','#3da4d9','#eadc72'];
const colors=palette.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)));
const width=72,height=64,center={xMm:35.2,yMm:30.4};
const angles=[-Math.PI/2,0,Math.PI/2];
type P={xMm:number;yMm:number};
function assertObservedSides(result:NonNullable<ReturnType<typeof measureMaterialJunction>>,rotation=0){
 for(const ray of result.rays)for(const sign of[-1,1]){
  const x=result.tip.xMm+8*Math.cos(ray.angle)-sign*2*Math.sin(ray.angle)-center.xMm;
  const y=result.tip.yMm+8*Math.sin(ray.angle)+sign*2*Math.cos(ray.angle)-center.yMm;
  const dx=x*Math.cos(rotation)+y*Math.sin(rotation),dy=-x*Math.sin(rotation)+y*Math.cos(rotation);
  const actual=palette[dx<0?2:dy<0?0:1];
  expect(sign<0?ray.negativeColor:ray.positiveColor).toBe(actual);
 }
}
function rays(origin:P,rotation=0){return angles.map((angle,i)=>({colors:[palette[(i+2)%3],palette[i]],points:[origin,...Array.from({length:28},(_,j)=>({xMm:center.xMm+(j+1)*Math.cos(angle+rotation),yMm:center.yMm+(j+1)*Math.sin(angle+rotation)}))]}));}
async function image(sigma:number,second?:number,rotation=0){
 const aa=6,rgba=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const rgb=[0,0,0];
  for(let j=0;j<aa;j++)for(let i=0;i<aa;i++){
   const px=x+(i+.5)/aa-center.xMm,py=y+(j+.5)/aa-center.yMm;
   const dx=px*Math.cos(rotation)+py*Math.sin(rotation),dy=-px*Math.sin(rotation)+py*Math.cos(rotation);
   // Two independent half-plane predicates produce a T, without calling
   // the model's Gaussian integration or copying its sector equations.
   const owner=dx<0||(second!==undefined&&dx>second)?2:dy<0?0:1;
   for(let c=0;c<3;c++)rgb[c]+=colors[owner][c]/aa**2;
  }
  rgba.set([...rgb.map(Math.round),255],4*(y*width+x));
 }
 return new Uint8Array(await sharp(rgba,{raw:{width,height,channels:4}}).blur(sigma).raw().toBuffer());
}
for(const sigma of[1,2,3])it(`recovers an independently rasterized three-color T at blur ${sigma}`,async()=>{
 const origin={xMm:center.xMm+.6,yMm:center.yMm-.5},branches=rays(origin),before=structuredClone(branches),rgba=await image(sigma),saved=rgba.slice();
 const result=measureMaterialJunction(origin,branches,width,height,rgba);
 expect(result).toBeDefined();
 expect(Math.hypot(result!.tip.xMm-center.xMm,result!.tip.yMm-center.yMm)).toBeLessThan(.6);
 expect(Number.isFinite(result!.error)).toBe(true);expect(result!.error).toBeLessThanOrEqual(.02);
 assertObservedSides(result!);
 expect(branches).toEqual(before);expect(rgba).toEqual(saved);
});
it('recovers a rotated T with a straight half-plane sector using finite RGB evidence',async()=>{
 const rotation=-3.1177165494225108+1.5*Math.PI;
 const result=measureMaterialJunction(center,rays(center,rotation),width,height,await image(2,undefined,rotation));
 expect(result).toBeDefined();expect(Number.isFinite(result!.error)).toBe(true);
 expect(result!.rays.every(r=>Number.isFinite(r.angle))).toBe(true);
 expect(Math.hypot(result!.tip.xMm-center.xMm,result!.tip.yMm-center.yMm)).toBeLessThan(.6);
 assertObservedSides(result!,rotation);
});
it('rejects an otherwise valid pairwise palette assigned to the wrong three regions',async()=>{
 const branches=rays(center),renamed=new Map(palette.map((c,i)=>[c,palette[(i+1)%3]]));
 branches.forEach(r=>{r.colors=r.colors.map(c=>renamed.get(c)!);});
 expect(measureMaterialJunction(center,branches,width,height,await image(2))).toBeUndefined();
});
it('does not replace two nearby material junctions by a fictitious single junction',async()=>{
 expect(measureMaterialJunction(center,rays(center),width,height,await image(1.5,4))).toBeUndefined();
});
it('declines an incomplete or translucent local observation instead of extrapolating',async()=>{
 const rgba=await image(2);rgba[4*(Math.floor(center.yMm)*width+Math.floor(center.xMm))+3]=254;
 expect(measureMaterialJunction(center,rays(center),width,height,rgba)).toBeUndefined();
 expect(measureMaterialJunction({xMm:2,yMm:2},rays({xMm:2,yMm:2}),width,height,rgba)).toBeUndefined();
});
it('does not return a nonfinite estimate for nonfinite public inputs',async()=>{
 const rgba=await image(1),origin={xMm:NaN,yMm:center.yMm};
 expect(measureMaterialJunction(origin,rays(origin),width,height,rgba)).toBeUndefined();
 const invalidRay=rays(center);invalidRay[0].points[10].xMm=NaN;
 expect(measureMaterialJunction(center,invalidRay,width,height,rgba)).toBeUndefined();
});
for(const separation of[4,12])it(`keeps both ends and material owners of a ${separation}px short shared branch`,async()=>{
 const first={xMm:center.xMm+.6,yMm:center.yMm-.5},last={xMm:center.xMm+separation+.6,yMm:center.yMm-.5};
 const make=(a:P,b:P,owners:string[])=>{
  const count=Math.max(8,Math.ceil(Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm))+1);
  return{closed:false,colors:owners,raw:Array.from({length:count},(_,i)=>({id:`${a.xMm}:${a.yMm}:${i}`,xMm:a.xMm+(b.xMm-a.xMm)*i/(count-1),yMm:a.yMm+(b.yMm-a.yMm)*i/(count-1)}))};
 };
 const branches=[make(first,{xMm:center.xMm,yMm:10},[palette[2],palette[0]]),make(first,{xMm:center.xMm,yMm:54},[palette[1],palette[2]]),make(first,last,[palette[0],palette[1]]),make(last,{xMm:center.xMm+separation,yMm:10},[palette[0],palette[2]]),make(last,{xMm:center.xMm+separation,yMm:54},[palette[2],palette[1]])];
 const before=structuredClone(branches),rgba=await image(1.5,separation),saved=rgba.slice(),result=sourceJunctions(branches,width,height,rgba);
 expect(branches).toEqual(before);expect(rgba).toEqual(saved);
 if(separation===4){expect(result).toBeUndefined();return;}
 expect(result).toBeDefined();expect(result!.evidence).toHaveLength(2);
 const points=result!.output[2];
 for(const[p,x]of[[points[0],center.xMm],[points.at(-1)!,center.xMm+separation]] as const){expect(Math.hypot(p.xMm-x,p.yMm-center.yMm)).toBeLessThan(.6);}
 expect(points[0]).toMatchObject({xMm:result!.output[0][0].xMm,yMm:result!.output[0][0].yMm});
 expect(points.at(-1)).toMatchObject({xMm:result!.output[3][0].xMm,yMm:result!.output[3][0].yMm});
 // Correcting the short shared red/blue edge cannot travel into the yellow
 // regions outside the two vertical boundaries or invert its direction.
 expect(points.every(p=>p.xMm>=center.xMm-.6&&p.xMm<=center.xMm+separation+.6&&Math.abs(p.yMm-center.yMm)<.6)).toBe(true);
 expect(points.every((p,i)=>i===0||p.xMm>=points[i-1].xMm)).toBe(true);
});
