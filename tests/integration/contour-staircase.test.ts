import {expect,it} from 'vitest';
import {traceMask,maskPieces,segmentPixels} from '../../apps/desktop/main/reference-segmentation';
import {smoothContour} from '../../packages/reference/smooth-contour';
import {edgeArcPoints} from '../../packages/pattern/edit';
import {safeContour} from '../../packages/reference/contour-topology';
it('an isolated sub-four-pixel remnant does not abort a usable mask candidate',()=>{
 const pixels=new Uint8Array(100);for(let y=2;y<6;y++)for(let x=2;x<6;x++)pixels[y*10+x]=1;pixels[99]=1;
 const result=maskPieces({width:10,height:10,pixels:Array.from(pixels).join('')},{a:{x:0,y:10},b:{x:0,y:0},distanceMm:10},10,10,'#ffffff');
 expect(result.pieces).toHaveLength(1);expect(result.pixelCount).toBe(16);expect(result).toHaveProperty('discardedPixels',1);
});
it('small original masks and RGB selections use the same staircase removal',()=>{
 const w=100,h=100,pixels=new Uint8Array(w*h),rgba=new Uint8Array(w*h*4).fill(255),calibration={a:{x:0,y:h},b:{x:0,y:0},distanceMm:h};
 for(let x=10;x<90;x++)for(let y=0;y<h;y++)if(y>=Math.floor(x*.5)+5&&y<Math.floor(x*.5)+10){pixels[y*w+x]=1;rgba.set([0,150,220,255],(y*w+x)*4);}
 expect(maskPieces({width:w,height:h,pixels:Array.from(pixels).join('')},calibration,w,h,'#0096dc').pieces[0].nodes.length).toBeLessThan(20);
 expect(segmentPixels(w,h,rgba,{x:20,y:17},0,calibration,w,h,true).piece.nodes.length).toBeLessThan(20);
});

it.each([.25,.5,.6,1,1.5])('keeps a narrow band at slope %s simple and topologically valid',slope=>{
 const w=100,h=160,mask=new Uint8Array(w*h);
 for(let x=10;x<90;x++)for(let y=0;y<h;y++)if(y>=Math.floor(x*slope)+5&&y<Math.floor(x*slope)+10)mask[y*w+x]=1;
 const raw=traceMask(w,h,mask,{a:{x:0,y:h},b:{x:0,y:0},distanceMm:h},w,h,'#ffffff',true).piece;
 const result=smoothContour(raw,.8,()=>crypto.randomUUID());
 expect(result.nodes.length).toBeLessThan(20);expect(safeContour(result,raw,.8)).toBe(true);
});

it('removes pixel stairs from a narrow sloping marking without erasing its tips',()=>{
 const w=120,h=90,mask=new Uint8Array(w*h);
 for(let x=10;x<110;x++)for(let y=0;y<h;y++)if(y>=Math.floor(x*.6)&&y<Math.floor(x*.6)+5)mask[y*w+x]=1;
 const raw=traceMask(w,h,mask,{a:{x:0,y:h},b:{x:0,y:0},distanceMm:h},w,h,'#ffffff',true).piece;
 const result=smoothContour(raw,.8,()=>crypto.randomUUID());
 expect(result.nodes.length).toBeLessThan(20);
 const area=(nodes:typeof raw.nodes)=>Math.abs(nodes.reduce((s,a,i)=>{const b=nodes[(i+1)%nodes.length];return s+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2);
 expect(Math.abs(area(result.nodes)-area(raw.nodes))/area(raw.nodes)).toBeLessThan(.03);
 for(const node of result.nodes)for(const p of edgeArcPoints(result,node.id)){
  const nearest=Math.min(...raw.nodes.map((a,i)=>{const b=raw.nodes[(i+1)%raw.nodes.length],x=b.xMm-a.xMm,y=b.yMm-a.yMm,t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*x+(p.yMm-a.yMm)*y)/(x*x+y*y)));return Math.hypot(p.xMm-a.xMm-t*x,p.yMm-a.yMm-t*y);}));
  expect(nearest).toBeLessThan(1.2);
 }
});


