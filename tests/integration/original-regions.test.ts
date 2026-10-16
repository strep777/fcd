import {it,expect} from 'vitest';
import {illustrationRegions} from '../../packages/reference/illustration';
it('adjacent close hues crossing a palette boundary merge, while strong color edges remain',()=>{
 const w=90,h=140,rgba=new Uint8Array(w*h*4).fill(255);
 for(let y=10;y<130;y++)for(let x=15;x<75;x++)rgba.set(x<35?[235,130,30,255]:x<55?[235,165,30,255]:[0,150,240,255],(y*w+x)*4);
 const result=illustrationRegions(w,h,rgba,true,'head');
 expect(result.regions).toHaveLength(2);expect(result.regions.map(r=>r.indices.length).sort((a,b)=>a-b)).toEqual([2400,4800]);
});
it('a continuous color crossing suggested anatomical bands remains one region',()=>{
 const w=90,h=140,rgba=new Uint8Array(w*h*4).fill(255);
 for(let y=10;y<130;y++)for(let x=15;x<75;x++)rgba.set(x<35?[0,155,235,255]:x<55?[240,210,30,255]:[245,125,150,255],(y*w+x)*4);
 const result=illustrationRegions(w,h,rgba,true);
 expect(result.regions).toHaveLength(3);
 for(const region of result.regions)expect(region.indices.length).toBe(2400);
});
it('native-resolution thin stripes survive; dark saturated shading stays in the blue region',()=>{
 const w=900,h=700,rgba=new Uint8Array(w*h*4).fill(255);
 for(let y=50;y<650;y++)for(let x=50;x<850;x++)rgba.set(x===451||x===452?[245,130,155,255]:x<400?[0,160,230,255]:[0,45,65,255],(y*w+x)*4);
 const result=illustrationRegions(w,h,rgba,true,'head');
 const pink=result.regions.find(r=>r.color.startsWith('#f5'));
 expect(pink?.indices.length).toBe(1200);
 expect(result.regions.filter(r=>r.color==='#000000')).toHaveLength(0);
 expect(result.regions).toHaveLength(3); // The narrow pink stripe separates two blue components.
});
