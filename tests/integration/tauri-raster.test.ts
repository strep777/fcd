import {expect,it} from 'vitest';
import {createCanvas,ImageData} from '@napi-rs/canvas';
import UPNG from '@pdf-lib/upng';
import {rasterImage} from '../../apps/desktop/main/raster-image';
const codec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG;
function pixels(bytes:Buffer){const decoded=codec.decode(Uint8Array.from(bytes).buffer);return new Uint8Array(codec.toRGBA8(decoded)[0]);}
it('keeps opaque source pixels through synchronous PNG crop and resize',()=>{
 const canvas=createCanvas(4,2),rgba=new Uint8ClampedArray(4*2*4);for(let i=0;i<rgba.length;i+=4)rgba.set(i%16<8?[230,20,30,255]:[10,30,230,255],i);
 canvas.getContext('2d').putImageData(new ImageData(rgba,4,2),0,0);
 const source=rasterImage.createFromBuffer(canvas.toBuffer('image/png'));
 expect(source.getSize()).toEqual({width:4,height:2});
 expect([...pixels(source.crop({x:2,y:0,width:2,height:2}).resize({width:8,height:8}).toPNG()).slice(0,4)]).toEqual([10,30,230,255]);
});
it.each(['image/jpeg','image/webp'] as const)('waits for %s decoding before creating PNG pixels',async mime=>{
 const canvas=createCanvas(12,8),context=canvas.getContext('2d');context.fillStyle='#f01020';context.fillRect(0,0,12,8);
 const source=await rasterImage.decode(canvas.toBuffer(mime));const rgba=pixels(source.toPNG());
 expect(source.getSize()).toEqual({width:12,height:8});expect(rgba[0]).toBeGreaterThan(200);expect(rgba[2]).toBeLessThan(60);expect(rgba[3]).toBe(255);
});
