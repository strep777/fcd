import {expect,it} from 'vitest';
import {refineImageEdgeOwnership} from '../../packages/reference/image-edge-evidence';
import type {IllustrationRegion} from '../../packages/reference/illustration';

const white=[210,210,210],pink=[250,190,190],ink=[8,6,10];
const directions=[['x',false],['x',true],['y',false],['y',true]] as const;
function source(axis:'x'|'y',mirror:boolean,bias:number,mode:'quiet'|'inside-third'|'noisy'|'short2-before'|'short2-after'='quiet',midpointShift=0){
 const width=axis==='x'?80:30,height=axis==='x'?30:80,maskEdge=40+bias;
 // The known physical source transition is centered at coordinate 40.5.
 // A separator at base+6 blocks the broad original profile; it lies beyond
 // an actual four-pixel source-side plateau. At base+3 it blocks even the
 // shortest bilateral support corridor, and must never be borrowed across.
 const short2=mode==='short2-before'||mode==='short2-after',sourceEdge=mode==='short2-before'?40.2:mode==='short2-after'?41.8:40.5;
 const separator=maskEdge-1+(mode==='inside-third'?3:short2?4:6),regions=['#d2d2d2','#fabebe','#08060a'].map((color):IllustrationRegion=>({color,part:'unknown',side:'unknown',confidence:0,indices:[]})),rgba=new Uint8Array(width*height*4);
 const index=(native:number,cross=15)=>{const along=mirror?79-native:native;return axis==='x'?cross*width+along:along*width+cross;};
 for(let cross=0;cross<30;cross++)for(let native=0;native<80;native++){
  const coverage=Math.max(0,Math.min(1,.5+(native+.5-sourceEdge)/(short2?.6:2)));
  let rgb=white.map((v,c)=>Math.round(v+(pink[c]-v)*coverage));
  if(native===40&&!short2)rgb=[230+midpointShift,200-midpointShift,200];
  if(mode==='noisy'&&(native<=39||native>=42)){const variation=native%2?8:-8;rgb=[rgb[0]+variation,rgb[1]-variation,rgb[2]];}
  const owner=native===separator?2:native>=maskEdge?1:0,i=index(native,cross);
  if(owner===2)rgb=ink;rgba.set([...rgb,255],i*4);regions[owner].indices.push(i);
 }
 regions.forEach(r=>r.indices.sort((a,b)=>a-b));
 return{width,height,rgba,regions,index,separator};
}

it.each(directions)('axis %s mirror %s uses a quiet short source profile when the wide corridor reaches a third material',(axis,mirror)=>{
 const input=source(axis,mirror,2),result=refineImageEdgeOwnership(input.width,input.height,input.rgba,input.regions);
 // Pixel 41 is one native pixel inside the independently specified pink
 // source, but the deliberately biased initial mask assigns it to white.
 expect(input.regions[0].indices).toContain(input.index(41));
 expect(result.labels[input.index(41)]).toBe(1);
 expect(result.labels[input.index(39)]).toBe(0);
 expect(result.regions[2].indices).toEqual(input.regions[2].indices);
 expect(result.report.movedPixels).toBeGreaterThan(0);
 expect(result.report.removedForegroundPixels).toBe(0);
 const all=result.regions.flatMap(r=>r.indices);expect(all).toHaveLength(input.width*input.height);expect(new Set(all).size).toBe(all.length);
});

it.each(directions)('axis %s mirror %s rejects a third material inside every short support corridor',(axis,mirror)=>{
 const input=source(axis,mirror,2,'inside-third'),result=refineImageEdgeOwnership(input.width,input.height,input.rgba,input.regions);
 expect(result.labels[input.index(41)]).toBe(0);
 expect(result.regions.map(r=>r.indices)).toEqual(input.regions.map(r=>r.indices));
 expect(result.report.movedPixels).toBe(0);
});

it.each(directions)('axis %s mirror %s rejects source-side fluctuation instead of selecting a favorable short window',(axis,mirror)=>{
 const input=source(axis,mirror,2,'noisy'),result=refineImageEdgeOwnership(input.width,input.height,input.rgba,input.regions);
 expect(result.labels[input.index(41)]).toBe(0);
 expect(result.regions.map(r=>r.indices)).toEqual(input.regions.map(r=>r.indices));
 expect(result.report.movedPixels).toBe(0);
});

it.each(directions)('axis %s mirror %s retains either initial midpoint owner under byte quantization despite short-profile support',(axis,mirror)=>{
 for(const owner of[0,1])for(const shift of[-1,0,1]){
  const input=source(axis,mirror,owner===1?0:1,'quiet',shift),result=refineImageEdgeOwnership(input.width,input.height,input.rgba,input.regions);
  expect(result.labels[input.index(40)],JSON.stringify({owner,shift})).toBe(owner);
  expect(result.regions.map(r=>r.indices)).toEqual(input.regions.map(r=>r.indices));
 }
});

it.each(directions)('axis %s mirror %s finds a short-two crossing between the left inner plateau pixel and the mask edge',(axis,mirror)=>{
 const input=source(axis,mirror,1,'short2-before'),result=refineImageEdgeOwnership(input.width,input.height,input.rgba,input.regions);
 // True edge 40.2 puts center 40.5 clearly inside pink. The separator at
 // base+4 excludes reach>=3; the crossing is outside the center-only pair,
 // but between already certified inner plateau pixels at base-1 and base+2.
 expect(input.regions[0].indices).toContain(input.index(40));
 expect(result.labels[input.index(40)]).toBe(1);
 expect(result.regions[2].indices).toEqual(input.regions[2].indices);
});

it.each(directions)('axis %s mirror %s finds a short-two crossing between the mask edge and the right inner plateau pixel',(axis,mirror)=>{
 const input=source(axis,mirror,1,'short2-after'),result=refineImageEdgeOwnership(input.width,input.height,input.rgba,input.regions);
 // True edge 41.8 puts center 41.5 clearly inside white. The same source
 // support validates the opposite direction of one-pixel classification error.
 expect(input.regions[1].indices).toContain(input.index(41));
 expect(result.labels[input.index(41)]).toBe(0);
 expect(result.regions[2].indices).toEqual(input.regions[2].indices);
});
