import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {calibratedPoint,traceMask,segmentPixels} from '../../apps/desktop/main/reference-segmentation';
import {imageBoundaryFit} from '../../packages/reference/image-contour';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import {safeContour,contourBoundaryError} from '../../packages/reference/contour-topology';
import type {Piece,Calibration} from '../../packages/schema/index';

type XY={xMm:number;yMm:number};
const results:unknown[]=[];
// Analytic pigment shapes are sampled as RGB transitions. The signed-distance
// oracle is independent of both traced pixel vertices and fitting routines.
function fixture(size:number,kind:'circle'|'annulus'|'thin-annulus'|'crescent'|'diamond'|'wavy',contrast='normal',scale=1,rotation=0){
 const cx=size*.5+.313,cy=size*.5+.271,r=size*.32,inner=kind==='thin-annulus'?r-4.25:size*.16;
 const outer=(x:number,y:number)=>Math.hypot(x-cx,y-cy)-r;
 const top=(x:number)=>size*.20+.17*x+size*.035*Math.sin(x/(size*.14));
 const signed=(x:number,y:number)=>kind==='wavy'?Math.max(size*.12-x,x-size*.88,(top(x)-y)/Math.hypot(1,.17+.25*Math.cos(x/(size*.14))),(y-top(x)-size*.25)/Math.hypot(1,.17+.25*Math.cos(x/(size*.14)))):
  kind==='annulus'||kind==='thin-annulus'?Math.max(outer(x,y),inner-Math.hypot(x-cx,y-cy)):
  kind==='crescent'?Math.max(outer(x,y),r*.83-Math.hypot(x-cx-r*.47,y-cy)):
  kind==='diamond'?(Math.abs(x-cx)/(size*.20)+Math.abs(y-cy)/(size*.38)-1)/Math.hypot(1/(size*.20),1/(size*.38)):outer(x,y);
 const colors=contrast==='low'?['#587887','#607d89']:['#0a9dd6','#fae234'];
 const rgb=colors.map(color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16))),rgba=new Uint8Array(size*size*4),mask=new Uint8Array(size*size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const d=signed(x+.5,y+.5),t=Math.max(0,Math.min(1,.5+d/2)),i=y*size+x;
  mask[i]=+(d<0);for(let k=0;k<3;k++)rgba[i*4+k]=Math.round(rgb[0][k]*(1-t)+rgb[1][k]*t);rgba[i*4+3]=255;
 }
 const calibration:Calibration={a:{x:13,y:size-9},b:{x:13+size*Math.sin(rotation),y:size-9-size*Math.cos(rotation)},distanceMm:size*scale};
 const fromPixel=(p:XY)=>calibratedPoint(p.xMm,p.yMm,calibration);
 const toPixel=(p:XY)=>{const c=calibration,dx=c.b.x-c.a.x,dy=c.b.y-c.a.y;return{xMm:c.a.x+(-dy*p.xMm+dx*p.yMm)/c.distanceMm,yMm:c.a.y+(dx*p.xMm+dy*p.yMm)/c.distanceMm};};
 const seed=kind==='wavy'?{x:Math.floor(size*.4),y:Math.floor(top(size*.4)+size*.125)}:{x:Math.floor(kind==='diamond'?cx:kind==='thin-annulus'?cx-r+2:cx-r*.7),y:Math.floor(cy)};
 const tolerance=Math.hypot(...rgb[0].map((v,k)=>v-rgb[1][k]))/2;
 const selected=segmentPixels(size,size,rgba,seed,tolerance,calibration,size,size,false,true),raw=selected.piece;
 const fit=imageBoundaryFit(size,size,rgba,toPixel,fromPixel);
 return {size,kind,scale,rotation,raw,mask,rgba,colors,signed,cx,cy,inner,r,toPixel,fromPixel,calibration,fit};
}
function sample(piece:Piece,toPixel:(p:XY)=>XY,ring=piece.nodes){
 return ring.flatMap((a,i)=>{const b=ring[(i+1)%ring.length],curve=piece.curves?.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id),pa=toPixel(a),pb=toPixel(b),h1=curve?toPixel(curve.c1):pa,h2=curve?toPixel(curve.c2):pb;
  const count=Math.max(1,Math.ceil((Math.hypot(h1.xMm-pa.xMm,h1.yMm-pa.yMm)+Math.hypot(h2.xMm-h1.xMm,h2.yMm-h1.yMm)+Math.hypot(pb.xMm-h2.xMm,pb.yMm-h2.yMm))/.1));
  return Array.from({length:count},(_,j)=>{const t=j/count,s=1-t;return curve?{xMm:s**3*pa.xMm+3*s*s*t*h1.xMm+3*s*t*t*h2.xMm+t**3*pb.xMm,yMm:s**3*pa.yMm+3*s*s*t*h1.yMm+3*s*t*t*h2.yMm+t**3*pb.yMm}:{xMm:pa.xMm+t*(pb.xMm-pa.xMm),yMm:pa.yMm+t*(pb.yMm-pa.yMm)};});
 });
}
async function record(value:unknown){results.push(value);await mkdir(resolve('test-results/current-task-2'),{recursive:true});await writeFile(resolve('test-results/current-task-2/image-contour-independent.json'),JSON.stringify(results,null,2));}
it.each(['circle','annulus','thin-annulus','crescent','diamond','wavy']as const)('image-supported %s preserves the analytic painted boundary and topology',async kind=>{
 const f=fixture(192,kind),baseline=recoverSharedContours([f.raw],.8,randomUUID),actual=recoverSharedContours([f.raw],.8,randomUUID,f.fit),p=actual.pieces[0];
 const points=[p.nodes,...p.holes??[]].flatMap(r=>sample(p,f.toPixel,r)),errors=points.map(q=>Math.abs(f.signed(q.xMm,q.yMm))).sort((a,b)=>a-b),old=[baseline.pieces[0].nodes,...baseline.pieces[0].holes??[]].flatMap(r=>sample(baseline.pieces[0],f.toPixel,r)).map(q=>Math.abs(f.signed(q.xMm,q.yMm))).sort((a,b)=>a-b);
 const metrics={kind,max:errors.at(-1),p95:errors[Math.floor(errors.length*.95)],rasterP95:old[Math.floor(old.length*.95)],nodes:p.nodes.length,curves:p.curves?.length,holes:p.holes?.length,report:actual.report};await record(metrics);
 expect(safeContour(p,f.raw,.8),JSON.stringify(metrics)).toBe(true);expect(contourBoundaryError(p,f.raw,.1,1.05)).toBeLessThanOrEqual(1.05);
 expect(p.holes?.length??0).toBe(kind.includes('annulus')?1:0);expect(errors.at(-1),JSON.stringify(metrics)).toBeLessThanOrEqual(1.25);
 expect(actual.report.restoredChains,'image evidence must not cause more full raster fallbacks').toBeLessThanOrEqual(baseline.report.restoredChains);
 if(kind==='circle'){expect(p.curves?.length,'the original circular arc remains curved').toBeGreaterThan(0);expect(metrics.p95).toBeLessThanOrEqual(.55);expect(metrics.p95,'RGB evidence improves accuracy against the independent analytic edge').toBeLessThan(metrics.rasterP95);}
 if(kind==='wavy'){expect(p.curves?.length,'changing pigment curvature must remain represented').toBeGreaterThan(0);expect(metrics.p95).toBeLessThanOrEqual(.8);}
 if(kind==='diamond'){
  const vertices=[[f.cx,f.cy-192*.38],[f.cx+192*.20,f.cy],[f.cx,f.cy+192*.38],[f.cx-192*.20,f.cy]];
  for(const [x,y]of vertices){const index=p.nodes.reduce((best,n,i)=>Math.hypot(f.toPixel(n).xMm-x,f.toPixel(n).yMm-y)<Math.hypot(f.toPixel(p.nodes[best]).xMm-x,f.toPixel(p.nodes[best]).yMm-y)?i:best,0),a=f.toPixel(p.nodes[(index+p.nodes.length-1)%p.nodes.length]),b=f.toPixel(p.nodes[index]),c=f.toPixel(p.nodes[(index+1)%p.nodes.length]);
   expect(Math.hypot(b.xMm-x,b.yMm-y)).toBeLessThanOrEqual(2);expect(Math.abs(Math.atan2((b.xMm-a.xMm)*(c.yMm-b.yMm)-(b.yMm-a.yMm)*(c.xMm-b.xMm),(b.xMm-a.xMm)*(c.xMm-b.xMm)+(b.yMm-a.yMm)*(c.yMm-b.yMm))),'a measured cusp cannot be rounded into a smooth arc').toBeGreaterThan(.7);
  }
 }
});
it.each([96,192,384].flatMap(size=>[.05,5.5].map(scale=>({size,scale,rotation:.37}))))('image evidence survives resolution $size and calibration scale $scale rotation $rotation',async({size,scale,rotation})=>{
 const f=fixture(size,'circle','normal',scale,rotation),p=recoverSharedContours([f.raw],.8*scale,randomUUID,f.fit).pieces[0],errors=sample(p,f.toPixel).map(q=>Math.abs(f.signed(q.xMm,q.yMm))).sort((a,b)=>a-b);await record({size,scale,rotation,p95:errors[Math.floor(errors.length*.95)],max:errors.at(-1),nodes:p.nodes.length,curves:p.curves?.length});
 expect(errors[Math.floor(errors.length*.95)]).toBeLessThanOrEqual(.65);expect(errors.at(-1)).toBeLessThanOrEqual(1.05);expect(safeContour(p,f.raw,.8*scale)).toBe(true);
});
it('low-contrast source samples preserve safe geometry without inventing unsupported curvature',async()=>{
 const f=fixture(192,'diamond','low'),old=recoverSharedContours([f.raw],.8,randomUUID),result=recoverSharedContours([f.raw],.8,randomUUID,f.fit),p=result.pieces[0];await record({kind:'low-contrast diamond',report:result.report,nodes:p.nodes.length,curves:p.curves?.length});
 expect(safeContour(p,f.raw,.8)).toBe(true);expect(contourBoundaryError(p,f.raw,.1,1.05)).toBeLessThanOrEqual(1.05);expect(p.curves?.length??0).toBe(old.pieces[0].curves?.length??0);expect(p.nodes.length).toBe(old.pieces[0].nodes.length);
});
it.each(['circle','wavy','crescent']as const)('the image-only %s proposal itself stays on measured pigment samples',async kind=>{
 const f=fixture(192,kind),fit=f.fit(f.raw.nodes,true,f.colors,randomUUID);
 // An unsupported transition may be declined; the pipeline tests above still
 // require its real curved geometry to remain safe. A returned image proposal
 // must itself fit observed color transitions instead of cutting across them.
 if(!fit){await record({kind,stage:'image proposal before network validation',supported:false});return;}
 const piece={...f.raw,...fit},sampled=sample(piece,f.toPixel),errors=sampled.map(q=>Math.abs(f.signed(q.xMm,q.yMm))).sort((a,b)=>a-b),worst=sampled.reduce((a,b)=>Math.abs(f.signed(a.xMm,a.yMm))>Math.abs(f.signed(b.xMm,b.yMm))?a:b),metrics={kind,stage:'image proposal before network validation',p95:errors[Math.floor(errors.length*.95)],max:errors.at(-1),worst,nodes:piece.nodes.length,curves:piece.curves.length,pixelNodes:piece.nodes.map(f.toPixel),pixelCurves:piece.curves.map(c=>({...c,c1:f.toPixel(c.c1),c2:f.toPixel(c.c2)}))};await record(metrics);
 expect(piece.curves.length).toBeGreaterThan(0);expect(metrics.p95,JSON.stringify(metrics)).toBeLessThanOrEqual(.6);expect(metrics.max,JSON.stringify(metrics)).toBeLessThanOrEqual(1.05);
});
it('both material owners share the same image-supported circular hole without cracks',async()=>{
 const f=fixture(192,'circle'),otherMask=new Uint8Array(f.mask.map(v=>v?0:1)),other=traceMask(192,192,otherMask,f.calibration,192,192,f.colors[1],true).piece,raw=[f.raw,other];
 const {pieces,report}=recoverSharedContours(raw,.8,randomUUID,f.fit);await record({kind:'shared circle',report,ownerNodes:pieces.map(p=>p.nodes.length),holeNodes:pieces[1].holes?.[0].length});
 expect(pieces[1].holes).toHaveLength(1);for(let i=0;i<2;i++){expect(safeContour(pieces[i],raw[i],.8)).toBe(true);expect(contourBoundaryError(pieces[i],raw[i],.1,1.05)).toBeLessThanOrEqual(1.05);}
 const boundary=pieces[0].nodes.map(f.toPixel),hole=pieces[1].holes![0].map(f.toPixel);expect(hole).toHaveLength(boundary.length);const keys=(r:XY[])=>r.map(p=>`${p.xMm.toFixed(7)},${p.yMm.toFixed(7)}`).sort();expect(keys(boundary)).toEqual(keys(hole));
});
it.each([2,8,16])('RGB noise amplitude %s does not invent a biased circular edge or damage topology',async amplitude=>{
 const f=fixture(192,'circle');let state=0x1ce5eed;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
 for(let i=0;i<f.rgba.length;i+=4)for(let c=0;c<3;c++)f.rgba[i+c]=Math.max(0,Math.min(255,Math.round(f.rgba[i+c]+(random()*2-1)*amplitude)));
 // Noise enters the actual business color-selection input, not only the fit.
 const raw=segmentPixels(192,192,f.rgba,{x:49,y:96},135,f.calibration,192,192,false,true).piece,baseline=recoverSharedContours([raw],.8,randomUUID),result=recoverSharedContours([raw],.8,randomUUID,f.fit),piece=result.pieces[0];
 const deviations=sample(piece,f.toPixel).map(p=>f.signed(p.xMm,p.yMm)),errors=deviations.map(Math.abs).sort((a,b)=>a-b),bias=deviations.reduce((s,v)=>s+v,0)/deviations.length,metrics={kind:'noisy circle',amplitude,p95:errors[Math.floor(errors.length*.95)],max:errors.at(-1),bias,report:result.report};await record(metrics);
 expect(safeContour(piece,raw,.8)).toBe(true);expect(contourBoundaryError(piece,raw,.1,1.05)).toBeLessThanOrEqual(1.05);expect(piece.holes?.length??0).toBe(0);
 expect(metrics.p95,JSON.stringify(metrics)).toBeLessThanOrEqual(.75);expect(metrics.max,JSON.stringify(metrics)).toBeLessThanOrEqual(1.25);expect(Math.abs(bias),JSON.stringify(metrics)).toBeLessThanOrEqual(.3);
 expect(result.report.restoredChains).toBeLessThanOrEqual(baseline.report.restoredChains);
});
