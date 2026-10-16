import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {rectangle,project} from '../fixtures';

async function fixture(leftEdge=10,rightEdge=10,fillHole=false,swapColors=false){
 const width=20,height=20,raw=Buffer.alloc(width*height*4),regions=[{color:'#e6b41e',indices:[] as number[]},{color:'#1e3cb4',indices:[] as number[]}];
 for(let y=2;y<18;y++)for(let x=2;x<18;x++){if(x>=4&&x<8&&y>=6&&y<12)continue;const i=y*width+x,owner=x<10?0:1;regions[owner].indices.push(i);raw.set(owner?[30,60,180,255]:[230,180,30,255],4*i);}
 const png='data:image/png;base64,'+(await sharp(raw,{raw:{width,height,channels:4}}).png().toBuffer()).toString('base64'),referenceId=randomUUID(),node=(x:number,y:number)=>({id:randomUUID(),xMm:-x,yMm:y}),nodes=(x0:number,y0:number,x1:number,y1:number)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>node(x,y)),left=rectangle(),right=rectangle();
 left.color=regions[swapColors?1:0].color;right.color=regions[swapColors?0:1].color;left.allowanceMm=right.allowanceMm=0;left.nodes=nodes(2,2,leftEdge,18);left.holes=fillHole?[]:[nodes(4,6,8,12)];right.nodes=nodes(rightEdge,2,18,18);const p=project();p.patternLibrary=[left,right].map(piece=>({piece,referenceId,view:'front' as const,category:'body'}));
 p.references=[{id:referenceId,view:'front',width,height,png,calibration:{a:{x:0,y:0},b:{x:0,y:20},distanceMm:20}}] as any;
 const {auditSourcePartition}=await import(pathToFileURL(resolve('tests/real-source-partition-audit.mjs')).href);return auditSourcePartition(p,{worker:resolve('target/release/fpcad-worker.exe'),illustrationRegions:()=>({regions})});
}
it('accepts exact shared edges and a genuine raster/vector hole without counting shared boundary as overlap',async()=>{
 const result=await fixture();expect(result.passed).toBe(true);expect(result.references[0].rawSourceHoles).toBe(1);expect(result.references[0].rasterHoles.interior).toBeGreaterThan(0);expect(result.references[0].rasterHoles.painted).toBe(0);expect(result.references[0].seams.interior).toBeGreaterThan(10);expect(result.references[0].seams.unsupportedOverlap).toBe(0);
});
it('independently detects a seam gap and rejects expansion that overlaps its neighbor',async()=>{
 const gap=await fixture(9.7,10.3),overlap=await fixture(10.3,9.7);expect(gap.passed).toBe(false);expect(gap.references[0].seams.unsupported).toBeGreaterThan(10);expect(gap.references[0].seams.maxGapMm).toBeCloseTo(.3,6);expect(overlap.passed).toBe(false);expect(overlap.references[0].seams.unsupportedOverlap).toBeGreaterThan(10);expect(overlap.references[0].seams.maxOverlapDepthMm).toBeCloseTo(.3,6);expect(overlap.references[0].seams.unsupported).toBe(0);
});
it('permits only the stated tiny interior bevel budget',async()=>{
 expect((await fixture(9.995,10.005)).passed).toBe(true);expect((await fixture(9.98,10.02)).passed).toBe(false);
});
it('rejects filling a genuine raster hole even when foreground coverage is complete',async()=>{
 const result=await fixture(10,10,true);expect(result.passed).toBe(false);expect(result.references[0].rasterHoles.painted).toBeGreaterThan(0);expect(result.references[0].seams.unsupported).toBe(0);expect(result.references[0].foreground.unsupported).toBe(0);
});
it('rejects swapping colors even with perfect union, holes and no overlap',async()=>{
 const result=await fixture(10,10,false,true),r=result.references[0];expect(result.passed).toBe(false);expect(r.colors.interior).toBeGreaterThan(0);expect(r.colors.wrong).toBe(r.colors.interior);expect(r.seams.unsupported).toBe(0);expect(r.seams.unsupportedOverlap).toBe(0);expect(r.rasterHoles.painted).toBe(0);
});
