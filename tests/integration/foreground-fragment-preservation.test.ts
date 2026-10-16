import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import sharp from 'sharp';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';

function ownership(width:number,height:number,result:ReturnType<typeof illustrationRegions>){
 const labels=new Int32Array(width*height).fill(-1);let count=0;
 for(const [id,r]of result.regions.entries())for(const i of r.indices){expect(labels[i],`duplicate owner at ${i}`).toBe(-1);labels[i]=id;count++;}
 expect(count).toBe(result.foregroundPixels-result.discardedPixels);return{labels,count};
}
it('retains the original JPEG ear foreground fragments without inventing paper-background ownership',async()=>{
 const file='tests/fixtures/character-front-back.jpg',left=609,width=666,height=750,rgba=new Uint8Array(await sharp(file).extract({left,top:0,width,height}).ensureAlpha().raw().toBuffer()),before=rgba.slice();
 // These exact pixels were inspected in the original source independently of
 // ownership. They are opaque warm pigment, not transparent or white paper.
 const anchors=[{x:914,y:49,rgba:[255,255,214,255]},{x:914,y:50,rgba:[238,222,188,255]}];
 for(const p of anchors){const i=p.y*width+p.x-left;expect(Array.from(rgba.subarray(4*i,4*i+4))).toEqual(p.rgba);expect(Math.max(...p.rgba.slice(0,3))-Math.min(...p.rgba.slice(0,3))).toBeGreaterThan(35);}
 const result=illustrationRegions(width,height,rgba),{labels,count}=ownership(width,height,result);expect(rgba).toEqual(before);
 const observed=anchors.map(p=>{const id=labels[p.y*width+p.x-left];expect(id,`original foreground ${p.x},${p.y}`).toBeGreaterThanOrEqual(0);return{...p,owner:id,color:result.regions[id]?.color};});
 for(const [x,y]of [[0,0],[width-1,0],[0,height-1],[width-1,height-1]]){
  const i=y*width+x,color=Array.from(rgba.subarray(4*i,4*i+3));expect(Math.min(...color)).toBeGreaterThanOrEqual(245);expect(Math.max(...color)-Math.min(...color)).toBeLessThanOrEqual(10);expect(labels[i]).toBe(-1);
 }
 // Existing independently observed white-fur tongue pixels remain white;
 // tiny discarded fragment size is not used to decide whether a hole is real.
 for(const [x,y]of [[916,107],[918,107],[919,107],[920,107]]){
  const i=y*width+x-left,color=Array.from(rgba.subarray(4*i,4*i+3));expect(Math.max(...color)-Math.min(...color)).toBeLessThan(20);expect(Math.max(...color)).toBeGreaterThan(240);
  expect(labels[i]).toBeGreaterThanOrEqual(0);expect(pigmentFamily(result.regions[labels[i]].color)).toBe(0);
 }
 const directory='test-results/contour-repair/test-review';mkdirSync(directory,{recursive:true});writeFileSync(directory+'/foreground-fragment-entry.json',JSON.stringify({scope:'Public illustrationRegions classification only. Exact original RGB anchors, no duplicate owners, reported foreground accounting, independently known paper and white-fur anchors. Not native geometry or desktop acceptance.',source:file,sourceHash:createHash('sha256').update(readFileSync(file)).digest('hex'),anchors:observed,foregroundPixels:result.foregroundPixels,discardedPixels:result.discardedPixels,ownedPixels:count},null,2));
},30000);

it.each([{name:'blue',color:[0,140,220]},{name:'yellow',color:[249,227,60]},{name:'dark',color:[30,30,30]}])('preserves known transparent holes, a background slit and a four-by-four painted white patch in $name material',({color})=>{
 const width=72,height=64,rgba=new Uint8Array(width*height*4),white:number[]=[];
 for(let y=8;y<56;y++)for(let x=8;x<64;x++){
  const i=y*width+x;if(x>=30&&x<33&&y>=32&&y<35||x===40&&y<=30)continue;
  const painted=x>=18&&x<22&&y>=18&&y<22;rgba.set([...(painted?[237,231,234]:color),255],4*i);if(painted)white.push(i);
 }
 const before=rgba.slice(),result=illustrationRegions(width,height,rgba,true,'head'),{labels,count}=ownership(width,height,result);expect(rgba).toEqual(before);
 const sourceForeground=Array.from({length:width*height},(_,i)=>i).filter(i=>rgba[4*i+3]===255);expect(count).toBe(sourceForeground.length);
 for(let i=0;i<labels.length;i++)expect(labels[i]>=0,`source alpha ownership at ${i}`).toBe(rgba[4*i+3]===255);
 expect(white).toHaveLength(16);for(const i of white)expect(pigmentFamily(result.regions[labels[i]].color)).toBe(0);
});
