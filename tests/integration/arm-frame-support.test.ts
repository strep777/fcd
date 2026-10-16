import {it,expect} from 'vitest';
import {armFrameSupport} from '../../packages/reference/arm-frame-support';
it('excludes detached low tail and hip support while preserving a shoulder-connected down arm reaching a confirmed paw',()=>{
 const width=300,height=500,ids:number[]=[],paint=(x0:number,y0:number,x1:number,y1:number)=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)ids.push(y*width+x);};
 paint(200,160,220,310); // genuine down arm extends beyond .53 of height
 paint(70,230,130,240); // detached horizontal tail inside the upper-limb band
 paint(230,290,250,345); // detached lower hip
 paint(280,175,283,180); // tiny upper fleck
 const original=[...ids],paws=[{minX:195,minY:320,maxX:225,maxY:350}],kept=armFrameSupport(width,height,ids,0,height,paws);
 expect(kept).toHaveLength(20*150);expect(new Set(kept)).toEqual(new Set(original.slice(0,20*150)));expect(ids).toEqual(original);
 const unsupported=armFrameSupport(width,height,ids,0,height,[]);expect(unsupported.length).toBeLessThan(kept.length);expect(Math.max(...unsupported.map(i=>Math.floor(i/width)))).toBeLessThan(280);
});
