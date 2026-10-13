import {it,expect} from 'vitest';
import {splitReferencePixels} from '../../apps/desktop/main/automatic-reference';
import {segmentPixels} from '../../apps/desktop/main/reference-segmentation';
import {clusterMask} from '../../packages/reference/color-cluster';
import {flood} from '../../packages/reference/mask';
import type {Reference} from '../../packages/schema/index';
import {smoothContour} from '../../packages/reference/smooth-contour';
import {analyze} from '../../apps/desktop/main/worker';
import {project} from '../fixtures';
import {resolve} from 'node:path';

const calibration={a:{x:0,y:80},b:{x:0,y:0},distanceMm:80};
const reference={id:crypto.randomUUID(),view:'front',width:80,height:80,calibration} as Reference;
it('automatic advanced extraction removes pixel stairs on a round marking',()=>{
 const rgba=new Uint8Array(80*80*4).fill(255);
 for(let y=0;y<80;y++)for(let x=0;x<80;x++)if(Math.hypot(x-40,y-40)<25)rgba.set([0,140,220,255],(y*80+x)*4);
 const regions=splitReferencePixels(reference,80,80,rgba,3,true);
 expect(regions).toHaveLength(1);
 expect(regions[0].piece.nodes.length).toBeLessThan(40);
 expect(regions[0].piece.curves?.length).toBeGreaterThan(0);
});
it('background subtraction does not send newly isolated one-pixel remnants to contour tracing',()=>{
 const rgba=new Uint8Array(80*80*4).fill(255);
 for(let y=20;y<60;y++)for(let x=20;x<60;x++)rgba.set([0,140,220,255],(y*80+x)*4);
 // A near-white connected halo with one darker compression pixel surviving the flood.
 for(let x=20;x<60;x++)rgba.set([235,235,235,255],(19*80+x)*4);
 rgba.set([220,220,220,255],(19*80+40)*4);
 expect(()=>splitReferencePixels(reference,80,80,rgba,2,true)).not.toThrow();
});
it.each([NaN,Infinity,-Infinity])('all seed entry points reject non-finite coordinates (%s)',x=>{
 const rgba=new Uint8Array(80*80*4).fill(255);
 expect(()=>segmentPixels(80,80,rgba,{x,y:10},10,calibration,80,80)).toThrow('INVALID_SEED');
 expect(()=>clusterMask(80,80,rgba,{x,y:10},{space:'lab',clusters:2,minRegionPixels:4})).toThrow('INVALID_SEED');
 expect(()=>flood({width:2,height:2,pixels:'0000'},{x,y:0},true)).toThrow('INVALID_SEED');
});
it('calibration and raster dimensions are validated before tracing',()=>{
 const rgba=new Uint8Array(80*80*4).fill(255);
 expect(()=>segmentPixels(80,80,rgba,{x:10,y:10},10,{...calibration,a:{x:NaN,y:80}},80,80)).toThrow('INVALID_CALIBRATION');
 expect(()=>segmentPixels(80,80,rgba,{x:10,y:10},10,calibration,0,80)).toThrow('IMAGE_LIMIT');
 expect(()=>clusterMask(2.5,2,new Uint8Array(20).fill(255),{x:0,y:0},{space:'lab',clusters:2,minRegionPixels:4})).toThrow('IMAGE_LIMIT');
});
it('discarded pigment speckles do not leave false cutting holes, while transparency stays a hole',()=>{
 const rgba=new Uint8Array(80*80*4).fill(255);
 for(let y=5;y<75;y++)for(let x=5;x<75;x++)rgba.set([0,140,220,255],(y*80+x)*4);
 for(let y=10;y<70;y+=5)for(let x=10;x<70;x+=5)rgba.set([230,160,40,255],(y*80+x)*4);
 for(let y=32;y<40;y++)for(let x=32;x<40;x++)rgba.set([0,0,0,0],(y*80+x)*4);
 const regions=splitReferencePixels(reference,80,80,rgba,3,true);
 expect(regions).toHaveLength(1);expect(regions[0].piece.holes).toHaveLength(1);
 const hole=regions[0].piece.holes![0];expect(Math.max(...hole.map(p=>p.xMm))-Math.min(...hole.map(p=>p.xMm))).toBe(8);
});
it('smoothing all connected 3x3 masks preserves native contour validity and hole count',async()=>{
 const p=project();p.pieces=[];
 for(let bits=0;bits<512;bits++){
  const rgba=new Uint8Array(36);for(let i=0;i<9;i++)rgba.set(bits&(1<<i)?[0,140,220,255]:[255,255,255,255],i*4);
  const first=Array.from({length:9},(_,i)=>i).find(i=>bits&(1<<i));if(first===undefined)continue;
  try{const result=segmentPixels(3,3,rgba,{x:first%3,y:Math.floor(first/3)},0,{a:{x:0,y:3},b:{x:0,y:0},distanceMm:3},3,3);
   const smoothed=smoothContour(result.piece,1,()=>crypto.randomUUID());expect(smoothed.holes?.length).toBe(result.piece.holes?.length);p.pieces.push(smoothed);
  }catch(error){if((error as Error).message!=='REGION_TOO_SMALL')throw error;}
 }
 expect(p.pieces.length).toBeGreaterThan(100);
 const geometry=await analyze(resolve('target/release/fpcad-worker.exe'),p);expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
});

