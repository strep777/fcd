import {it,expect} from 'vitest';
import {calibratedPoint,segmentPixels} from '../../apps/desktop/main/reference-segmentation';
import {analyze} from '../../apps/desktop/main/worker';
import {resolve} from 'node:path';
import {project} from '../fixtures';
it('two-point calibration handles rotated axes, exact mm and invalid points',()=>{
 const c={a:{x:0,y:100},b:{x:0,y:0},distanceMm:1000};expect(calibratedPoint(20,80,c)).toEqual({xMm:200,yMm:200});const rotated={a:{x:10,y:10},b:{x:110,y:10},distanceMm:1000};expect(calibratedPoint(10,20,rotated)).toEqual({xMm:100,yMm:0});expect(()=>calibratedPoint(0,0,{a:{x:0,y:0},b:{x:0,y:0},distanceMm:1})).toThrow('INVALID_CALIBRATION');
});
it('traditional seeded component preserves holes and original-to-proxy calibration scale',async()=>{
 const width=12,height=10,rgba=new Uint8Array(width*height*4);for(let y=2;y<8;y++)for(let x=2;x<10;x++){if(x>=4&&x<6&&y>=4&&y<6)continue;const i=(y*width+x)*4;rgba.set([100,40,20,255],i);}
 const c={a:{x:0,y:100},b:{x:0,y:0},distanceMm:1000},result=segmentPixels(width,height,rgba,{x:25,y:25},0,c,120,100);expect(result.pixelCount).toBe(44);expect(result.piece.nodes).toHaveLength(4);expect(result.piece.holes).toHaveLength(1);expect(result.piece.color).toBe('#642814');const p=project();p.pieces=[{...result.piece,allowanceMm:0}];const g=await analyze(resolve('target/release/fpcad-worker.exe'),p);expect(g[0].issues).toEqual([]);expect(g[0].areaMm2).toBe(440000);
 expect(()=>segmentPixels(width,height,rgba,{x:0,y:0},10,c,120,100)).toThrow('TRANSPARENT_SEED');expect(()=>segmentPixels(width,height,rgba,{x:120,y:100},10,c,120,100)).toThrow('INVALID_SEED');
});

it('diagonal hole-to-exterior contact yields a reviewed bounded contour instead of an ambiguous mask',async()=>{
 const rgba=new Uint8Array(3*3*4);for(let i=0;i<9;i++)rgba.set(i===4||i===8?[255,255,255,255]:[255,0,0,255],i*4);
 const r=segmentPixels(3,3,rgba,{x:0,y:0},0,{a:{x:0,y:3},b:{x:0,y:0},distanceMm:3},3,3);expect(r.pixelCount).toBe(7);expect(r.mask.pixels).toBe('111101110');expect(r.contourRepair?.corners).toBe(1);expect(r.contourRepair?.maxDeviationMm).toBeLessThanOrEqual(.01);
 const p=project();p.pieces=[r.piece];const g=await analyze(resolve('target/release/fpcad-worker.exe'),p);expect(g[0].issues.filter(i=>i.severity==='error')).toEqual([]);expect(Math.abs(g[0].areaMm2-7)).toBeLessThanOrEqual((r.contourRepair?.areaLossMm2??0)+1e-8);
});

it('all connected 3x3 raster patterns retain pixels, bounded area and valid native contours',async()=>{
 const cases:ReturnType<typeof segmentPixels>[]=[],counts:number[]=[];for(let bits=0;bits<512;bits++){const mask=Array.from({length:9},(_,i)=>(bits>>i)&1),count=mask.reduce((s,n)=>s+n,0);if(count<4)continue;const queue=[mask.indexOf(1)],seen=new Set(queue);for(let k=0;k<queue.length;k++){const i=queue[k],x=i%3,y=Math.floor(i/3);for(const n of [x?i-1:-1,x<2?i+1:-1,y?i-3:-1,y<2?i+3:-1])if(n>=0&&mask[n]&&!seen.has(n)){seen.add(n);queue.push(n);}}if(seen.size!==count)continue;const rgba=new Uint8Array(36);for(let i=0;i<9;i++)rgba.set(mask[i]?[255,0,0,255]:[255,255,255,255],i*4);const seed=mask.indexOf(1),r=segmentPixels(3,3,rgba,{x:seed%3,y:Math.floor(seed/3)},0,{a:{x:0,y:3},b:{x:0,y:0},distanceMm:30},3,3);expect(r.mask.pixels).toBe(mask.join(''));cases.push(r);counts.push(count);}
 const p=project();p.pieces=cases.map(r=>r.piece);const geometries=await analyze(resolve('target/release/fpcad-worker.exe'),p);expect(cases.length).toBeGreaterThan(100);for(let i=0;i<cases.length;i++){expect(geometries[i].issues.filter(e=>e.severity==='error'),cases[i].mask.pixels).toEqual([]);expect(Math.abs(geometries[i].areaMm2-counts[i]*100),cases[i].mask.pixels).toBeLessThanOrEqual((cases[i].contourRepair?.areaLossMm2??0)+1e-7);}
});
