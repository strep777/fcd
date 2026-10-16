import {expect,it} from 'vitest';
import sharp from 'sharp';
import {pigmentInstances} from '../../packages/reference/region-instances';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';

it('does not complete soft shading candidates into unsupported cuts through one pigment',()=>{
 const width=80,height=60,mask=new Uint8Array(width*height).fill(1),ink=new Uint8Array(mask.length),soft=new Uint8Array(mask.length),light=new Float32Array(mask.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x;light[i]=.7+.2*x/width;
  // Candidate soft barriers meet the exterior and create several seeded
  // interiors, but the independently painted source has no separating line.
  if(Math.abs(x-30)<3||x>30&&Math.abs(y-30)<3)soft[i]=1;
 }
 const regions=pigmentInstances(width,height,mask,ink,soft,light);
 expect(regions).toHaveLength(1);expect(regions[0]).toHaveLength(width*height);
 expect(new Set(regions[0]).size).toBe(width*height);
});

it('retains genuinely drawn separators even when an adjoining shading candidate is discarded',()=>{
 const width=80,height=60,mask=new Uint8Array(width*height).fill(1),ink=new Uint8Array(mask.length),soft=new Uint8Array(mask.length),light=new Float32Array(mask.length).fill(.9);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x;if(Math.abs(x-30)<3||x>30&&Math.abs(y-30)<3)soft[i]=1;
  if(Math.abs(x-30)<2){ink[i]=1;light[i]=.15;}
 }
 const regions=pigmentInstances(width,height,mask,ink,soft,light),owner=(x:number,y:number)=>regions.findIndex(r=>r.includes(y*width+x));
 expect(regions).toHaveLength(2);expect(owner(45,10)).toBe(owner(45,50));expect(owner(15,30)).not.toBe(owner(45,30));
 expect(regions.flat()).toHaveLength(width*height);expect(new Set(regions.flat()).size).toBe(width*height);
});

it('keeps the continuous original back-foot pad and its highlight in one source instance',async()=>{
 const width=609,height=750,pixels=new Uint8Array(await sharp('tests/fixtures/character-front-back.jpg').extract({left:0,top:0,width,height}).ensureAlpha().raw().toBuffer());
 const result=illustrationRegions(width,height,pixels),probes=[[310,685],[308,694],[301,698]],owners=probes.map(([x,y])=>result.regions.findIndex(r=>r.indices.includes(y*width+x)));
 for(const id of owners){expect(id).toBeGreaterThanOrEqual(0);expect(pigmentFamily(result.regions[id].color)).toBe(1);}
 expect(new Set(owners).size).toBe(1);
 const all=result.regions.flatMap(r=>r.indices);expect(new Set(all).size).toBe(all.length);expect(all.length).toBe(result.foregroundPixels-result.discardedPixels);
},10000);
