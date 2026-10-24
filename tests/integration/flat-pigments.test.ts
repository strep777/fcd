import {expect,it} from 'vitest';
import {illustrationRegions} from '../../packages/reference/illustration';

const width=104,height=104;
function fixture(color:(x:number,y:number)=>number[]){
 const rgba=new Uint8Array(width*height*4);
 for(let y=2;y<102;y++)for(let x=2;x<102;x++)rgba.set([...color(x-2,y-2),255],(y*width+x)*4);
 return rgba;
}
const extract=(rgba:Uint8Array)=>illustrationRegions(width,height,rgba,true,'head');
it.each([
 [[255,0,0],[255,128,0]],
 [[0,180,255],[0,30,255]],
 [[0,255,0],[80,255,140]],
])('keeps two hard chromatic materials inside a broad hue family: %j', (left,right)=>{
 const result=extract(fixture(x=>x<50?left:right));
 const a=result.regions.find(r=>r.indices.includes(40*width+20))!,b=result.regions.find(r=>r.indices.includes(40*width+80))!;
 expect(a).toBeDefined();expect(b).toBeDefined();expect(a).not.toBe(b);
 expect(a.color).toBe('#'+left.map(n=>n.toString(16).padStart(2,'0')).join(''));
 expect(b.color).toBe('#'+right.map(n=>n.toString(16).padStart(2,'0')).join(''));
 expect(a.indices).toHaveLength(5000);expect(b.indices).toHaveLength(5000);
 expect(new Set(result.regions.flatMap(r=>r.indices)).size).toBe(10000);
 expect(result.foregroundPixels-result.discardedPixels).toBe(10000);
 expect(result.palette).toContain(a.color);expect(result.palette).toContain(b.color);
});
it('retains a continuous hue gradient as one pigment instead of artificial bands',()=>{
 const result=extract(fixture(x=>[255,Math.round(x*1.28),0]));
 expect(result.regions).toHaveLength(1);expect(result.regions[0].indices).toHaveLength(10000);
});
it('does not split a saturated pigment at a brightness-only shadow step',()=>{
 const result=extract(fixture(x=>x<50?[255,100,120]:[153,60,72]));
 expect(result.regions).toHaveLength(1);expect(result.regions[0].indices).toHaveLength(10000);
});
it('small color noise cannot become a new cloth panel',()=>{
 const result=extract(fixture((x,y)=>x>=49&&x<52&&y>=49&&y<52?[255,128,0]:[255,0,0]));
 expect(result.regions).toHaveLength(1);expect(result.regions[0].indices).toHaveLength(10000);
});
