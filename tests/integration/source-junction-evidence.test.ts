import {it,expect} from 'vitest';
import sharp from 'sharp';
import {sourceJunctions} from '../../packages/reference/image-tip-junctions';
const palette=['#f9e33c','#0f9be1','#ede7ea'];
const colors=palette.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)));
async function fixture(){
 const width=128,height=96,bytes=new Uint8Array(width*height*4),aa=6;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const rgb=[0,0,0];for(let j=0;j<aa;j++)for(let i=0;i<aa;i++){const px=x+(i+.5)/aa,py=y+(j+.5)/aa,owner=px>=60+3*(py-40)?0:py<40?1:2;for(let c=0;c<3;c++)rgb[c]+=colors[owner][c]/aa**2;}bytes.set([...rgb.map(Math.round),255],4*(y*width+x));}
 const rgba=await sharp(bytes,{raw:{width,height,channels:4}}).blur(1).raw().toBuffer();
 const start={id:'joint',xMm:59.5,yMm:39.5},branch=(end:{xMm:number;yMm:number},owners:string[])=>({closed:false,colors:owners,raw:[start,...Array.from({length:40},(_,i)=>({id:String(i),xMm:60+(end.xMm-60)*(i+1)/40,yMm:40+(end.yMm-40)*(i+1)/40}))]});
 return{width,height,rgba,branches:[branch({xMm:12,yMm:40},[palette[1],palette[2]]),branch({xMm:12,yMm:24},[palette[0],palette[1]]),branch({xMm:108,yMm:56},[palette[0],palette[2]])]};
}
it('recovers a shallow three-material intersection from independently rasterized RGB evidence',async()=>{
 const f=await fixture(),original=structuredClone(f.branches),result=sourceJunctions(f.branches,f.width,f.height,f.rgba);
 expect(f.branches).toEqual(original);expect(result).toBeDefined();
 const tip=result!.output[0][0];expect(Math.hypot(tip.xMm-60,tip.yMm-40)).toBeLessThan(.5);
 for(const branch of result!.output)expect(branch[0]).toMatchObject({xMm:tip.xMm,yMm:tip.yMm});
});
it('does not accept a strong edge belonging to a third color as the requested material interface',async()=>{
 const f=await fixture();f.branches[0].colors=[palette[0],palette[2]];
 const original=structuredClone(f.branches);expect(sourceJunctions(f.branches,f.width,f.height,f.rgba)).toBeUndefined();expect(f.branches).toEqual(original);
});
