import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {traceMask} from '../../apps/desktop/main/reference-segmentation';
import {recoverContour} from '../../packages/reference/recover-contour';
import {safeContour,contourBoundaryError} from '../../packages/reference/contour-topology';

it.each([[4,13,.4],[4,13,.9],[15,5,.4],[4,22,.4],[4,40,.4]])('straight %s by %s at pixel phase %s stays straight after changing traversal and ids',(rx,ry,phase)=>{
 const w=110,h=110,mask=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(Math.abs(x+.5-55-phase)/rx+Math.abs(y+.5-55-phase)/ry<1)mask[y*w+x]=1;
 const raw=traceMask(w,h,mask,{a:{x:0,y:h},b:{x:0,y:0},distanceMm:h},w,h,'#123456',true).piece;
 for(const scale of [.05,1,10])for(const reverse of [false,true])for(const fraction of [0,.25,.5,.75]){
  const start=Math.floor(raw.nodes.length*fraction),cyclic=[...raw.nodes.slice(start),...raw.nodes.slice(0,start)],order=reverse?cyclic.reverse():cyclic;
  const original={...raw,nodes:order.map(p=>({id:randomUUID(),xMm:1000+scale*(p.xMm*Math.cos(.37)-p.yMm*Math.sin(.37)),yMm:-1000+scale*(p.xMm*Math.sin(.37)+p.yMm*Math.cos(.37))}))},result=recoverContour(original,.8*scale,randomUUID);
  expect(result.curves??[],JSON.stringify({rx,ry,phase,scale,reverse,fraction,nodes:result.nodes.length})).toHaveLength(0);expect(result.nodes.length).toBeLessThanOrEqual(16);
  expect(safeContour(result,original,.8*scale)).toBe(true);
  expect(contourBoundaryError(result,original,.1*scale,1.05*scale)).toBeLessThanOrEqual(1.05*scale);
 }
},60000);

