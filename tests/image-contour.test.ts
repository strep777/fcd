import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {imageBoundaryFit} from '../packages/reference/image-contour';
import {recoverBoundaryChain,contourPolyline} from '../packages/reference/recover-contour';
import type {Point} from '../packages/schema/index';

it.each([.087,.317,.713])('uses source antialias evidence to recover a straight transition at slope %s',slope=>{
 const width=180,height=180,offset=20.27,rgba=new Uint8Array(width*height*4),a=[10,157,214],b=[250,226,52];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const signed=(y+.5-slope*(x+.5)-offset)/Math.hypot(1,slope),t=Math.max(0,Math.min(1,.5+signed/2));
  for(let c=0;c<3;c++)rgba[(y*width+x)*4+c]=Math.round(a[c]*(1-t)+b[c]*t);rgba[(y*width+x)*4+3]=255;
 }
 const raw:Point[]=[];
 for(let x=10;x<=160;x++){
  const y=Math.round(slope*(x+.5)+offset);raw.push({id:randomUUID(),xMm:x,yMm:y});raw.push({id:randomUUID(),xMm:x+1,yMm:y});
 }
 const points=raw.filter((p,i)=>!i||p.xMm!==raw[i-1].xMm||p.yMm!==raw[i-1].yMm);
 const result=imageBoundaryFit(width,height,rgba,p=>p,p=>p)(points,false,['#0a9dd6','#fae234'],randomUUID);
 expect(result).toBeDefined();
 const sampled=contourPolyline(result!.nodes,result!.curves,false,.001,randomUUID).filter(p=>p.xMm>15&&p.xMm<155);
 expect(result!.curves).toHaveLength(0);
 const error=(p:Point)=>Math.abs(p.yMm-slope*p.xMm-offset)/Math.hypot(1,slope);
 expect(Math.max(...sampled.map(error))).toBeLessThan(.25);
 expect(result!.nodes.length).toBeLessThanOrEqual(6);
 // The same source outline has only quantized coordinates without the image.
 const raster=recoverBoundaryChain(points,.8,randomUUID);
 expect(result!.nodes.some(p=>!Number.isInteger(p.xMm)||!Number.isInteger(p.yMm))).toBe(true);
 expect(raster.nodes.length).toBeGreaterThan(1);
});
