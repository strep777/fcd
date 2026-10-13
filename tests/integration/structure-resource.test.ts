import {expect,it,vi} from 'vitest';
import * as raster from '../../packages/reference/raster';
import {pigmentInstances} from '../../packages/reference/region-instances';
import {structureInstances} from '../../packages/reference/structure-separation';

function islands(width:number,height:number,count:number,stroke=false){
 const mask=new Uint8Array(width*height),ink=new Uint8Array(mask.length),rgba=new Uint8Array(mask.length*4),columns=Math.ceil(Math.sqrt(count)),side=stroke?32:16;
 for(let id=0;id<count;id++){
  const left=8+id%columns*(side+12),top=8+Math.floor(id/columns)*(side+12);
  for(let y=top;y<top+side;y++)for(let x=left;x<left+side;x++){const i=y*width+x;mask[i]=1;rgba.set(stroke&&x>=left+15&&x<left+18?[130,115,35,255]:[242,221,52,255],i*4);}
 }
 return {mask,ink,rgba};
}

it('preserves hundreds of flat islands without a full-image marker scan for every island',()=>{
 const width=1024,height=1024,{mask,ink,rgba}=islands(width,height,256),before=pigmentInstances(width,height,mask,ink),scan=vi.spyOn(raster,'rasterComponents');
 try{
  const after=structureInstances(width,height,mask,ink,rgba);
  // No raster divider exists. IDs, pixel order and coverage stay unchanged.
  expect(after).toEqual(before);expect(after).toHaveLength(256);
  // The original O(K*N) implementation invokes three full-image scans for
  // each >=256px component. Count scan domains instead of machine timings.
  expect(scan.mock.calls.filter(([w,h])=>w===width&&h===height)).toHaveLength(2);
  expect(scan.mock.calls).toHaveLength(2);
 }finally{scan.mockRestore();}
});

it('limits stroke marker scans to padded local domains while returning original image indices',()=>{
 const width=1024,height=1024,{mask,ink,rgba}=islands(width,height,64,true),scan=vi.spyOn(raster,'rasterComponents');
 try{
  const after=structureInstances(width,height,mask,ink,rgba),pixels=after.flat(),owners=new Int32Array(mask.length).fill(-1);
  after.forEach((group,id)=>group.forEach(i=>owners[i]=id));
  expect(after).toHaveLength(128);expect(pixels).toHaveLength(64*32*32);expect(new Set(pixels).size).toBe(pixels.length);expect(pixels.every(i=>mask[i]===1)).toBe(true);
  for(let id=0;id<64;id++){const left=8+id%8*44,top=8+Math.floor(id/8)*44;expect(owners[(top+16)*width+left+6]).toBeGreaterThanOrEqual(0);expect(owners[(top+16)*width+left+6]).not.toBe(owners[(top+16)*width+left+25]);}
  const global=scan.mock.calls.filter(([w,h])=>w===width&&h===height),local=scan.mock.calls.filter(([w,h])=>w!==width||h!==height);
  expect(global).toHaveLength(2);expect(local.length).toBeGreaterThan(64);
  expect(local.every(([w,h])=>w<=42&&h<=42)).toBe(true);
 }finally{scan.mockRestore();}
});
