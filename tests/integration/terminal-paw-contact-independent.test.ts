import {expect,it} from 'vitest';
import {terminalPawSupport} from '../../packages/reference/terminal-paw-support';
function hand(){const width=260,height=360,span=340,saturation=new Float32Array(width*height),value=new Float32Array(width*height),rect=(x0:number,y0:number,x1:number,y1:number,v:number)=>{const points:number[]=[];for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=y*width+x;points.push(i);saturation[i]=.1;value[i]=v;}return points;},r=(indices:number[])=>({part:'arm' as const,side:'right' as const,confidence:.6,indices}),regions=[r(rect(185,100,215,135,.85)),r(rect(192,92,199,101,.05)),r(rect(216,110,223,119,.05))],arm:number[]=[];for(let y=125;y<185;y++)for(let x=165+185-y-10;x<165+185-y+10;x++)arm.push(y*width+x);return {width,span,top:0,head:{minX:80,minY:20,maxX:150,maxY:90},regions,saturation,value,arms:new Map<'left'|'right',number[]>([['right',arm]]),existing:new Set<'left'|'right'>(),rect};}
it('the original proximal touching dark block stays outside the confirmed paw without changing pixels',()=>{
  const input=hand(),third={part:'tail' as const,side:'center' as const,confidence:.6,indices:input.rect(183,119,187,124,.05)},regions=[...input.regions,third],before=structuredClone(regions),result=terminalPawSupport({...input,regions});expect(result.map(r=>r.regionIndices)).toEqual([[0,1,2]]);expect(regions).toEqual(before);
});
it('a distinct small dark tip touching the distal outer palm joins that already supported paw without changing pixels',()=>{
  const input=hand(),third={part:'tail' as const,side:'center' as const,confidence:.6,indices:input.rect(215,100,219,105,.05)},regions=[...input.regions,third],before=structuredClone(regions),palmPixels=new Set(input.regions[0].indices);expect(third.indices.every(i=>!palmPixels.has(i))).toBe(true);
  const result=terminalPawSupport({...input,regions});expect(result.map(r=>r.regionIndices)).toEqual([[0,1,2,3]]);expect(regions).toEqual(before);
});
it('one pre-existing claw plus a touching unrelated dark source cannot establish a hand',()=>{
  const input=hand(),third={part:'tail' as const,side:'center' as const,confidence:.6,indices:input.rect(183,119,187,124,.05)};expect(terminalPawSupport({...input,regions:[input.regions[0],input.regions[1],third]})).toEqual([]);
});
it('two component records for the same physical dark tip do not count as independent distal evidence',()=>{
  const input=hand(),duplicate={...input.regions[1],indices:[...input.regions[1].indices]},third={part:'tail' as const,side:'center' as const,confidence:.6,indices:input.rect(183,119,187,124,.05)};
  expect(terminalPawSupport({...input,regions:[input.regions[0],input.regions[1],duplicate,third]})).toEqual([]);
});
it.each(['separated','bright','oversized','bbox-only'] as const)('does not recruit a third %s component merely because the hand is nearby',kind=>{
  const input=hand();let indices=input.rect(178,119,182,124,.05);if(kind==='bright')indices=input.rect(183,119,187,124,.8);if(kind==='oversized')indices=input.rect(162,119,187,124,.05);if(kind==='bbox-only'){input.regions[0].indices=input.regions[0].indices.filter(i=>!(i%input.width>=193&&i%input.width<207&&Math.floor(i/input.width)>=108&&Math.floor(i/input.width)<128));indices=input.rect(198,114,202,119,.05);}
  const regions=[...input.regions,{part:'tail' as const,side:'center' as const,confidence:.6,indices}],result=terminalPawSupport({...input,regions});expect(result).toHaveLength(1);expect(result[0].regionIndices).toEqual([0,1,2]);
});
it.each(['separated','bright','oversized','bbox-only'] as const)('distal placement alone cannot recruit a third %s component',kind=>{
  const input=hand();let indices=input.rect(218,102,222,107,.05);if(kind==='bright')indices=input.rect(215,100,219,105,.8);if(kind==='oversized')indices=input.rect(215,100,240,105,.05);if(kind==='bbox-only'){input.regions[0].indices=input.regions[0].indices.filter(i=>!(i%input.width>=201&&i%input.width<213&&Math.floor(i/input.width)>=100&&Math.floor(i/input.width)<112));indices=input.rect(205,104,209,108,.05);}
  const regions=[...input.regions,{part:'tail' as const,side:'center' as const,confidence:.6,indices}],before=structuredClone(regions),result=terminalPawSupport({...input,regions});expect(result).toHaveLength(1);expect(result[0].regionIndices).toEqual([0,1,2]);expect(regions).toEqual(before);
});
