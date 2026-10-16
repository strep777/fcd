import {expect,it} from 'vitest';
import {refineImageEdgeOwnership} from '../../packages/reference/image-edge-evidence';
import type {IllustrationRegion} from '../../packages/reference/illustration';

// Equal RGB totals make the analytic material midpoint exact before byte
// rounding. Expectations come from the known image-generating step, not a
// classified contour or a reimplementation of the refinement decision.
const white=[210,210,210],pink=[250,190,190];
const colors=['#d2d2d2','#fabebe'];
function imageStep(scale:number,bias:number,midpointByteShift=0,noisy=false,mirror=false){
 const width=80*scale,height=30*scale,edge=40*scale+.5;
 const rgba=new Uint8Array(width*height*4),regions=colors.map((color):IllustrationRegion=>({color,part:'unknown',side:'unknown',confidence:0,indices:[]}));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const nativeX=mirror?width-1-x:x,coverage=Math.max(0,Math.min(1,.5+(nativeX+.5-edge)/(2*scale)));
  let rgb=white.map((v,c)=>Math.round(v+(pink[c]-v)*coverage));
  if(nativeX===40*scale)rgb=[230+midpointByteShift,200-midpointByteShift,200];
  if(noisy&&(nativeX<40*scale-3||nativeX>40*scale+3)){
   const noise=nativeX%2?12:-12;rgb=[rgb[0]+noise,rgb[1]-noise,rgb[2]];
  }
  const index=y*width+x;rgba.set([...rgb,255],index*4);
  regions[nativeX>=40*scale+bias?1:0].indices.push(index);
 }
 return {width,height,rgba,regions,index:(nativeX:number,y=15*scale)=>(y*width+(mirror?width-1-nativeX:nativeX))};
}

it.each([1,2,3])('scale %s retains either original owner when byte quantization cannot resolve the analytic half-contrast pixel',scale=>{
 for(const mirror of [false,true])for(const originalOwner of [0,1])for(const shift of [-1,0,1]){
  const input=imageStep(scale,originalOwner===1?0:1,shift,false,mirror);
  // +/- one R and G byte produces observations on both sides of the exact
  // midpoint although the generating source edge is unchanged. A geometric
  // half-pixel or a palette tie is insufficient evidence to change ownership.
  const result=refineImageEdgeOwnership(input.width,input.height,input.rgba,input.regions);
  expect(result.labels[input.index(40*scale)],JSON.stringify({scale,mirror,originalOwner,shift})).toBe(originalOwner);
  expect(result.regions.map(r=>r.indices)).toEqual(input.regions.map(r=>r.indices));
 }
});

it.each([1,2,3])('scale %s corrects a clearly biased original owner in both image directions',scale=>{
 for(const mirror of [false,true]){
  const input=imageStep(scale,2,0,false,mirror),result=refineImageEdgeOwnership(input.width,input.height,input.rgba,input.regions);
  // The next pixel is strictly inside the analytic pink material by one
  // native pixel; unlike the midpoint its color separation exceeds rounding.
  expect(input.regions[0].indices).toContain(input.index(40*scale+1));
  expect(result.labels[input.index(40*scale+1)]).toBe(1);
  expect(result.report.movedPixels).toBeGreaterThan(0);
  expect(result.report.removedForegroundPixels).toBe(0);
  const all=result.regions.flatMap(r=>r.indices);
  expect(new Set(all).size).toBe(input.width*input.height);
  expect(all).toHaveLength(input.width*input.height);
 }
});

it.each([1,2,3])('scale %s leaves ownership unchanged when source plateaus fluctuate too much to identify the step',scale=>{
 for(const mirror of [false,true]){
  const input=imageStep(scale,2,0,true,mirror),result=refineImageEdgeOwnership(input.width,input.height,input.rgba,input.regions);
  // Equal-total +/-12-byte material-side perturbations are prescribed by the
  // synthetic image, not inferred from the result. They exceed one quarter
  // of this pastel material contrast, so no source position is certified.
  expect(result.regions.map(r=>r.indices)).toEqual(input.regions.map(r=>r.indices));
  expect(result.report.movedPixels).toBe(0);
 }
});

it('does not borrow an apparent quiet plateau across a third source material',()=>{
 for(const mirror of [false,true]){
  const width=90,height=70,rgba=new Uint8Array(width*height*4),palette=['#ede7ea','#f9e33c','#08060a'],regions=palette.map((color):IllustrationRegion=>({color,part:'unknown',side:'unknown',confidence:0,indices:[]}));
  const rgb=(id:number)=>[1,3,5].map(i=>parseInt(palette[id].slice(i,i+2),16)),normalize=(p:number[])=>p.map(v=>v/p.reduce((s,c)=>s+c,0)),a=normalize(rgb(0)),b=normalize(rgb(1)),sigmoid=(x:number)=>1/(1+Math.exp(-x*1.7));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const sx=mirror?width-1-x:x,center=32.3+(y+.5)*.19,z=sx+.5-center,coverage=(sigmoid(z-2)+sigmoid(z+2))/2,index=y*width+x;
   // A true dark separator lies outside the original profile but between its
   // changing white-side tail and the more distant quiet white material.
   const owner=sx===31?2:sx+.5>=center+2?1:0;
   regions[owner].indices.push(index);rgba.set([...(owner===2?rgb(2):a.map((v,c)=>Math.round((v+(b[c]-v)*coverage)*500))),255],index*4);
  }
  const result=refineImageEdgeOwnership(width,height,rgba,regions),x=mirror?width-1-37:37;
  // Neither distant material beyond the separator nor the source palette
  // supplies bilateral evidence for resolving this weak interior pixel.
  expect(result.labels[25*width+x]).toBe(0);
  expect(result.regions[2].indices).toEqual(regions[2].indices);
 }
});
