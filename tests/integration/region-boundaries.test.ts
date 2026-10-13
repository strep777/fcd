import {it,expect} from 'vitest';
import {illustrationRegions} from '../../packages/reference/illustration';
import {namedPart} from '../../packages/reference/body-parts';
import {illustrationSchema} from '../../packages/schema/index';
it('a continuous ink divider keeps neighboring same-pigment objects independent',()=>{
 const w=80,h=100,rgba=new Uint8Array(w*h*4).fill(255);
 for(let y=10;y<90;y++)for(let x=10;x<70;x++)rgba.set(x===39||x===40?[20,25,30,255]:[240,210,30,255],(y*w+x)*4);
 const result=illustrationRegions(w,h,rgba,true,'head');
 expect(result.regions).toHaveLength(2);
 expect(result.regions.every(r=>r.indices.length>2000)).toBe(true);
 expect(result.regions.reduce((n,r)=>n+r.indices.length,0)).toBe(4800);
});
it('an incomplete ink stroke does not invent a closed object boundary',()=>{
 const w=80,h=100,rgba=new Uint8Array(w*h*4).fill(255);
 for(let y=10;y<90;y++)for(let x=10;x<70;x++)rgba.set(x===40&&y<60?[20,25,30,255]:[240,210,30,255],(y*w+x)*4);
 expect(illustrationRegions(w,h,rgba,true,'head').regions).toHaveLength(1);
});
it('original-resolution statistics are not limited to a 512-pixel proxy',()=>{
 expect(illustrationSchema.safeParse({algorithm:'illustration-2',bounds:{minX:0,minY:0,maxX:1000,maxY:1000},partBounds:[],foregroundPixels:600000,discardedPixels:0,palette:['#ffffff'],smoothingPx:.8}).success).toBe(true);
});
it('horns are not classified as ear or generic head groups',()=>{
 expect(namedPart('horn-right')).toEqual({part:'horn',side:'right'});
 expect(namedPart('左角')).toEqual({part:'horn',side:'left'});
});
it('a colored protrusion between the head and ear bands is withheld from ear auto-placement',()=>{
 const w=100,h=200,rgba=new Uint8Array(w*h*4).fill(255);
 for(let y=40;y<180;y++)for(let x=30;x<70;x++)rgba.set([0,150,220,255],(y*w+x)*4);
 for(let y=12;y<40;y++)for(let x=15;x<25;x++)rgba.set([240,130,160,255],(y*w+x)*4);
 for(let y=8;y<45;y++)for(let x=70;x<80;x++)rgba.set([240,210,30,255],(y*w+x)*4);
 const protrusion=illustrationRegions(w,h,rgba).regions.find(r=>r.color==='#f0d21e');
 expect(protrusion?.part).toBe('unknown');expect(protrusion?.confidence).toBe(0);
});
