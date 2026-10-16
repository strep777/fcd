import {expect,it} from 'vitest';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';

const width=96,height=80;
function image(color:(x:number,y:number)=>number[]){const rgba=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set([...color(x,y),255],(y*width+x)*4);return rgba;}
const owner=(result:ReturnType<typeof illustrationRegions>,x:number,y:number)=>result.regions.find(r=>r.indices.includes(y*width+x));

it.each([[250,190,190],[247,207,207]].map(pink=>({pink})))('retains a measured pale material step $pink without requiring saturated highlight pixels',({pink})=>{
 const rgba=image((x,y)=>x<35+.2*y?pink:[217,217,217]),result=illustrationRegions(width,height,rgba,false,'head');
 expect(pigmentFamily(owner(result,20,40)!.color)).toBe(1);
 expect(pigmentFamily(owner(result,70,40)!.color)).toBe(0);
 expect(new Set(result.regions.flatMap(r=>r.indices)).size).toBe(width*height);
});

it.each([{background:[249,227,60],family:2},{background:[30,30,30],family:6}])('preserves a sharp four-pixel white inset in family $family but still removes isolated pigment speckles',({background,family})=>{
 const rgba=image((x,y)=>x>=40&&x<44&&y>=35&&y<39?[237,231,234]:x===20&&y===20?[237,231,234]:background);
 const result=illustrationRegions(width,height,rgba,false,'head');
 expect(pigmentFamily(owner(result,41,36)!.color)).toBe(0);
 expect(pigmentFamily(owner(result,20,20)!.color)).toBe(family);
});

it('does not turn a diffuse warm illumination gradient into a pale material step',()=>{
 const rgba=image((x)=>{const t=Math.max(0,1-Math.abs(x-48)/40);return [Math.round(217+25*t),Math.round(217-10*t),Math.round(217-10*t)];});
 const result=illustrationRegions(width,height,rgba,false,'head');
 expect(result.regions.every(r=>pigmentFamily(r.color)===0)).toBe(true);
});
