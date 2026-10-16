import {expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import type {Reference} from '../../packages/schema/index';
import {segmentReference} from '../../apps/desktop/main/references';
import {contourBoundaryError,safeContour} from '../../packages/reference/contour-topology';

// The original PNG path does not use Electron's decoder. Keep this test on
// the same public service invoked by the advanced colour-selection UI.
vi.mock('electron',()=>({nativeImage:{}}));
async function reference(scale:number,shape:'diamond'|'ellipse'|'ring'='diamond',size=150){
 const width=size,height=size,rgba=Buffer.alloc(width*height*4,255);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const a=(x+.5-size/2)/(size*35/150),b=(y+.5-size/2)/(size*55/150);
  if(shape==='diamond'?Math.abs(a)+Math.abs(b)<1:a*a+b*b<1&&(shape!=='ring'||a*a+b*b>.16))rgba.set([0,150,220,255],(y*width+x)*4);
 }
 const png=await sharp(rgba,{raw:{width,height,channels:4}}).png().toBuffer();
 return {id:randomUUID(),name:'Straight source',view:'front',width,height,png:'data:image/png;base64,'+png.toString('base64'),calibration:{a:{x:0,y:height},b:{x:0,y:0},distanceMm:height*scale}} satisfies Reference;
}
it.each([.05,.2])('custom fitting preserves the source diamond at %s mm/pixel instead of rounding its straight sides',async scale=>{
 const input=await reference(scale),before=JSON.stringify(input);
 const result=segmentReference(input,{x:75,y:75},0,undefined,.5);
 const bow=Math.max(0,...(result.piece.curves??[]).flatMap(c=>{
  const a=result.piece.nodes.find(p=>p.id===c.startNodeId)!,b=result.piece.nodes.find(p=>p.id===c.endNodeId)!;
  return [c.c1,c.c2].map(p=>Math.abs((b.xMm-a.xMm)*(p.yMm-a.yMm)-(b.yMm-a.yMm)*(p.xMm-a.xMm))/Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm));
 }));
 expect(bow/scale,'straight source sides must not acquire curved handles').toBeLessThan(1e-8);
 expect(result.piece.nodes.length).toBeLessThan(20);
 expect(result.curveFit!.maxDeviationMm).toBeLessThanOrEqual(.5);
 expect(result.accepted).toBe(false);expect(JSON.stringify(input)).toBe(before);
});
it('fits a large original raster before applying the editable-node contract',async()=>{
 const input=await reference(.05,'diamond',1200);
 const result=segmentReference(input,{x:600,y:600},0,undefined,.5);
 expect(result.curveFit!.inputNodes).toBeGreaterThan(2000);
 expect(result.piece.nodes.length).toBeLessThan(20);
 expect(result.piece.curves??[]).toHaveLength(0);
 expect(result.curveFit!.fallbackCount).toBe(0);
});
it('a tight requested tolerance falls back to the original pixels without inventing curvature',async()=>{
 const input=await reference(1),result=segmentReference(input,{x:75,y:75},0,undefined,.01);
 expect(result.piece.curves??[]).toHaveLength(0);
 expect(result.curveFit!.fallbackCount).toBe(1);
 expect(result.curveFit!.maxDeviationMm).toBe(0);
});
it('custom tolerance preserves a measured arc inside both the native-pixel and requested-mm limits',async()=>{
 const input=await reference(.2,'ellipse'),result=segmentReference(input,{x:75,y:75},0,undefined,.5);
 const {segmentPixels}=await import('../../apps/desktop/main/reference-segmentation');
 const rgba=await sharp(Buffer.from(input.png.split(',')[1],'base64')).ensureAlpha().raw().toBuffer();
 const raw=segmentPixels(150,150,rgba,{x:75,y:75},0,input.calibration!,150,150,false,true).piece;
 expect(result.piece.curves!.length).toBeGreaterThan(0);
 expect(safeContour(result.piece,raw,.16)).toBe(true);
 expect(contourBoundaryError(result.piece,raw,.02,.21)).toBeLessThanOrEqual(.21);
 expect(result.curveFit!.maxDeviationMm).toBeLessThanOrEqual(.5);
});
it.each([.2,100])('custom fitting retains exact holes and falls back safely when its sampling budget is exhausted at %s mm/pixel',async scale=>{
 const input=await reference(scale,'ring'),before=JSON.stringify(input),tolerance=scale===100?.01:.5;
 const result=segmentReference(input,{x:100,y:75},0,undefined,tolerance);
 const {segmentPixels}=await import('../../apps/desktop/main/reference-segmentation');
 const rgba=await sharp(Buffer.from(input.png.split(',')[1],'base64')).ensureAlpha().raw().toBuffer();
 const raw=segmentPixels(150,150,rgba,{x:100,y:75},0,input.calibration!,150,150,false,true).piece;
 const coordinates=(ring:typeof raw.nodes)=>ring.map(p=>[p.xMm,p.yMm]);
 expect(result.piece.holes!.map(coordinates)).toEqual(raw.holes!.map(coordinates));
 expect(result.accepted).toBe(false);expect(JSON.stringify(input)).toBe(before);
 if(scale===100){
  expect(coordinates(result.piece.nodes)).toEqual(coordinates(raw.nodes));
  expect(result.curveFit!.fallbackCount).toBe(1);expect(result.curveFit!.maxDeviationMm).toBe(0);
 }else{
  expect(result.curveFit!.fallbackCount).toBe(0);
  expect(result.curveFit!.maxDeviationMm).toBeLessThanOrEqual(tolerance);
 }
});
