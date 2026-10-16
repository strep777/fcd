import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {afterAll,expect,it} from 'vitest';
import {rectangle} from '../fixtures';
import {traceMask} from '../../apps/desktop/main/reference-segmentation';
import {imageBoundaryFit,type BoundaryFit} from '../../packages/reference/image-contour';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import {safeContour} from '../../packages/reference/contour-topology';
import type {Piece,Point} from '../../packages/schema/index';

type XY={xMm:number;yMm:number};
const records:unknown[]=[];
const point=(xMm:number,yMm:number):Point=>({id:randomUUID(),xMm,yMm});
function polygon(ring:number[][],holes:number[][][]=[]):Piece{return{...rectangle(),allowanceMm:0,nodes:ring.map(([x,y])=>point(x,y)),holes:holes.map(r=>r.map(([x,y])=>point(x,y))),curves:[]};}
const area=(r:XY[])=>Math.abs(r.reduce((sum,a,i)=>{const b=r[(i+1)%r.length];return sum+a.xMm*b.yMm-a.yMm*b.xMm;},0)/2);
function inside(q:XY,r:XY[]){let hit=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a.yMm>q.yMm)!==(b.yMm>q.yMm)&&q.xMm<(b.xMm-a.xMm)*(q.yMm-a.yMm)/(b.yMm-a.yMm)+a.xMm)hit=!hit;}return hit;}
function sample(p:Piece,ring=p.nodes):XY[]{return ring.flatMap((a,i)=>{const b=ring[(i+1)%ring.length],c=p.curves?.find(v=>v.startNodeId===a.id&&v.endNodeId===b.id);return Array.from({length:128},(_,j)=>{const t=j/128,s=1-t;return c?{xMm:s**3*a.xMm+3*s*s*t*c.c1.xMm+3*s*t*t*c.c2.xMm+t**3*b.xMm,yMm:s**3*a.yMm+3*s*s*t*c.c1.yMm+3*s*t*t*c.c2.yMm+t**3*b.yMm}:{xMm:a.xMm+t*(b.xMm-a.xMm),yMm:a.yMm+t*(b.yMm-a.yMm)};});});}
const owns=(p:Piece,q:XY)=>inside(q,sample(p))&&!(p.holes??[]).some(r=>inside(q,sample(p,r)));

it('retains the default 3% area gate without a source-specific allowance',()=>{
 const original=polygon([[0,0],[10,0],[10,10],[0,10]]),within=polygon([[0,0],[10.2,0],[10.2,10],[0,10]]),beyond=polygon([[0,0],[10.4,0],[10.4,10],[0,10]]);
 expect(safeContour(within,original,.8)).toBe(true);expect(safeContour(beyond,original,.8)).toBe(false);
});
it.each([.05,1,10])('keeps the default area contract in calibrated millimeters at scale %s',scale=>{
 const original=polygon([[0,0],[10,0],[10,10],[0,10]]),within=polygon([[0,0],[10.2,0],[10.2,10],[0,10]]),beyond=polygon([[0,0],[10.4,0],[10.4,10],[0,10]]);
 for(const p of [original,within,beyond])p.nodes=p.nodes.map(n=>({...n,xMm:n.xMm*scale,yMm:n.yMm*scale}));
 expect(safeContour(within,original,.8*scale)).toBe(true);expect(safeContour(beyond,original,.8*scale)).toBe(false);
});
it('rejects translated boundaries, intersections, inverted rings, removed holes and a filled deep slit',()=>{
 const original=polygon([[0,0],[10,0],[10,10],[0,10]]),translated={...original,nodes:original.nodes.map(p=>({...p,xMm:p.xMm+2}))},crossed=polygon([[0,0],[10,0],[10,10],[5,10],[5,8],[6,10],[4,10],[0,10]]),inverted={...original,nodes:[...original.nodes].reverse()},withHole=polygon([[0,0],[10,0],[10,10],[0,10]],[[[4,4],[4,6],[6,6],[6,4]]]);
 for(const candidate of [translated,crossed,inverted])expect(safeContour(candidate,original,.8)).toBe(false);
 expect(safeContour({...withHole,holes:[]},withHole,.8)).toBe(false);
 const slit=polygon([[0,0],[20,0],[20,20],[11,20],[11,5],[9,5],[9,20],[0,20]]),filled=polygon([[0,0],[20,0],[20,20],[0,20]]);
 expect(safeContour(filled,slit,.8)).toBe(false);
});

it('does not let a measured source bypass default area and boundary limits',()=>{
 const original=polygon([[0,0],[10,0],[10,10],[0,10]]),measured:BoundaryFit=raw=>({nodes:raw.map(p=>({...p,xMm:p.xMm===10?10.4:p.xMm})),curves:[]});
 const accepted=recoverSharedContours([original],.8,randomUUID,measured);expect(accepted.report.imageSupportedChains).toBe(0);expect(area(sample(accepted.pieces[0]))).toBeCloseTo(100,6);expect(safeContour(accepted.pieces[0],original,.8)).toBe(true);
 const unsafe:BoundaryFit=raw=>({nodes:raw.map(p=>({...p,xMm:p.xMm+2})),curves:[]}),fallback=recoverSharedContours([original],.8,randomUUID,unsafe);
 expect(fallback.report.imageSupportedChains).toBe(0);expect(safeContour(fallback.pieces[0],original,.8)).toBe(true);expect(area(sample(fallback.pieces[0]))).toBeCloseTo(100,6);
});
it('keeps both shared owners inside the default area contract',()=>{
 const originals=[polygon([[0,0],[20,0],[20,30],[0,30]]),polygon([[20,0],[40,0],[40,30],[20,30]])];
 const fit:BoundaryFit=(raw,closed)=>{if(closed||raw.some(p=>Math.abs(p.xMm-20)>1e-8))return;const a=raw[0],b=raw.at(-1)!,dy=Math.sign(b.yMm-a.yMm);return{nodes:[a,point(20.8,a.yMm+2*dy),point(20.8,b.yMm-2*dy),b],curves:[]};};
 const result=recoverSharedContours(originals,.8,randomUUID,fit);
 for(let i=0;i<2;i++){expect(safeContour(result.pieces[i],originals[i],.8)).toBe(true);expect(area(sample(result.pieces[i]))).toBeCloseTo(600,5);}
 expect(owns(result.pieces[0],{xMm:20.3,yMm:15})).toBe(false);expect(owns(result.pieces[1],{xMm:20.3,yMm:15})).toBe(true);
});
it('retains a small hole when a proposed shrink exceeds the default ring area budget',()=>{
 const original=polygon([[0,0],[10,0],[10,10],[0,10]],[[[4,4],[4,6],[6,6],[6,4]]]);
 const fit:BoundaryFit=raw=>({nodes:raw.every(p=>p.xMm>=4&&p.xMm<=6)?raw.map(p=>({...p,xMm:5+(p.xMm-5)*.85,yMm:5+(p.yMm-5)*.85})):raw,curves:[]});
 const result=recoverSharedContours([original],.8,randomUUID,fit),piece=result.pieces[0];expect(piece.holes).toHaveLength(1);expect(area(piece.holes![0])).toBeCloseTo(4,6);
 expect(safeContour(piece,original,.8)).toBe(true);expect(owns(piece,{xMm:4.05,yMm:5})).toBe(false);
});

type Shape='circle'|'ellipse'|'sharp'|'slit'|'hole';
function antialiased(shape:Shape,scale=1){
 const width=48,height=48,aa=8,rgba=new Uint8Array(width*height*4),mask=new Uint8Array(width*height),cx=24.5,cy=24.5,rx=shape==='circle'?5.1:7.1,ry=shape==='circle'?5.1:3.1;
 const sharp=[[24,5],[32,24],[24,43],[16,24]].map(([xMm,yMm])=>({xMm,yMm})),slit=[[8,8],[40,8],[40,40],[22,40],[22,24],[20,24],[20,40],[8,40]].map(([xMm,yMm])=>({xMm,yMm}));
 const material=(x:number,y:number)=>shape==='circle'||shape==='ellipse'?((x-cx)/rx)**2+((y-cy)/ry)**2<1:shape==='sharp'?inside({xMm:x,yMm:y},sharp):shape==='slit'?inside({xMm:x,yMm:y},slit):x>=8&&x<40&&y>=8&&y<40&&!(x>=23&&x<25&&y>=23&&y<25);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let coverage=0;for(let sy=0;sy<aa;sy++)for(let sx=0;sx<aa;sx++)coverage+=+material(x+(sx+.5)/aa,y+(sy+.5)/aa)/(aa*aa);
  rgba.set([...[245,245,245].map((v,c)=>Math.round(v*(1-coverage)+[10,157,214][c]*coverage)),255],(y*width+x)*4);mask[y*width+x]=+material(x+.5,y+.5);
 }
 const calibration={a:{x:0,y:height},b:{x:0,y:0},distanceMm:height*scale},raw=traceMask(width,height,mask,calibration,width,height,'#0a9dd6',true).piece;
 const toPixel=(p:XY)=>({xMm:p.xMm/scale,yMm:height-p.yMm/scale}),fromPixel=(p:XY)=>({xMm:p.xMm*scale,yMm:(height-p.yMm)*scale}),fit=imageBoundaryFit(width,height,rgba,toPixel,fromPixel),proposals:{closed:boolean;points:number;piece:Piece}[]=[];
 const observe:BoundaryFit=(...args)=>{const fitted=fit(...args);if(fitted)proposals.push({closed:args[1],points:args[0].length,piece:{...raw,...fitted,holes:[]}});return fitted;};
 const before=structuredClone(raw),baseline=recoverSharedContours([raw],.8*scale,randomUUID),result=recoverSharedContours([raw],.8*scale,randomUUID,observe),piece=result.pieces[0];
 expect(raw).toEqual(before);return{raw,piece,result,baseline,proposals,toPixel,fromPixel,cx,cy,rx,ry,sharp};
}
it.each((['circle','ellipse']as const).flatMap(shape=>[.05,1,10].map(scale=>({shape,scale}))))('preserves the independent $shape antialias geometry at calibration scale $scale',({shape,scale})=>{
 const f=antialiased(shape,scale),points=sample(f.piece).map(f.toPixel),analytic=Array.from({length:2048},(_,i)=>({xMm:f.cx+f.rx*Math.cos(i*2*Math.PI/2048),yMm:f.cy+f.ry*Math.sin(i*2*Math.PI/2048)}));
 const distance=(p:XY,r:XY[])=>Math.min(...r.map(q=>Math.hypot(q.xMm-p.xMm,q.yMm-p.yMm))),forward=Math.max(...points.map(p=>distance(p,analytic))),reverse=Math.max(...analytic.map(p=>distance(p,points)));
 const truthArea=Math.PI*f.rx*f.ry,rawError=Math.abs(area(f.raw.nodes.map(f.toPixel))-truthArea),savedError=Math.abs(area(points)-truthArea),baselinePoints=sample(f.baseline.pieces[0]).map(f.toPixel);
 records.push({shape,scale,source:{aa:8,cx:f.cx,cy:f.cy,rx:f.rx,ry:f.ry,truthArea},raw:{area:area(f.raw.nodes.map(f.toPixel)),error:rawError,nodes:f.raw.nodes.length},baseline:{report:f.baseline.report,area:area(baselinePoints),error:Math.abs(area(baselinePoints)-truthArea),nodes:f.baseline.pieces[0].nodes.length,curves:f.baseline.pieces[0].curves?.length,forward:Math.max(...baselinePoints.map(p=>distance(p,analytic)))},saved:{report:f.result.report,area:area(points),error:savedError,nodes:f.piece.nodes.length,curves:f.piece.curves?.length,forward,reverse,defaultSafe:safeContour(f.piece,f.raw,.8*scale)},proposals:f.proposals.map(p=>({closed:p.closed,points:p.points,area:area(sample(p.piece).map(f.toPixel)),nodes:p.piece.nodes.map(f.toPixel),curves:p.piece.curves?.map(c=>({...c,c1:f.toPixel(c.c1),c2:f.toPixel(c.c2)}))}))});
 expect(f.piece.holes??[]).toHaveLength(0);expect(Math.max(forward,reverse)).toBeLessThanOrEqual(1.05);
 // A declined RGB proposal may safely retain raster geometry. A raw mask can
 // also have coincidentally correct total area despite biased local edges;
 // requiring every fit to improve that cancellation is not a source oracle.
 const rawArea=area(f.raw.nodes.map(f.toPixel));expect(Math.abs(area(points)-rawArea)).toBeLessThanOrEqual(Math.max(.8**2,rawArea*.03)+1e-8);
 expect(safeContour(f.piece,f.raw,.8*scale)).toBe(true);
});
it.each(['circle','ellipse']as const)('keeps the same native-pixel %s boundary when only millimeter calibration changes',shape=>{
 const reference=antialiased(shape,1),expected=sample(reference.piece).map(reference.toPixel);
 const distance=(p:XY,r:XY[])=>Math.min(...r.map((a,i)=>{const b=r[(i+1)%r.length],dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);}));
 for(const scale of [.05,10]){
  const actual=antialiased(shape,scale),points=sample(actual.piece).map(actual.toPixel),maximum=Math.max(...points.map(p=>distance(p,expected)),...expected.map(p=>distance(p,points)));
  records.push({shape,kind:'calibration consistency',scale,referenceScale:1,maximumNativePixels:maximum});
  // The 0.02px comparison allowance covers direct cubic sampling, far below
  // the separate one-pixel source quantization budget. It is not a fit budget.
  expect.soft(maximum,`native boundary changed at scale ${scale}`).toBeLessThanOrEqual(.02);
 }
});
it('retains source-supported acute tips in an actual antialiased input',()=>{
 const sharp=antialiased('sharp');for(const tip of [sharp.sharp[0],sharp.sharp[2]]){
  const points=sample(sharp.piece).map(sharp.toPixel),rawDistance=Math.min(...sample(sharp.raw).map(sharp.toPixel).map(p=>Math.hypot(p.xMm-tip.xMm,p.yMm-tip.yMm))),baselineDistance=Math.min(...sample(sharp.baseline.pieces[0]).map(sharp.toPixel).map(p=>Math.hypot(p.xMm-tip.xMm,p.yMm-tip.yMm))),savedDistance=Math.min(...points.map(p=>Math.hypot(p.xMm-tip.xMm,p.yMm-tip.yMm)));
  records.push({shape:'sharp',tip,rawDistance,baselineDistance,savedDistance,report:sharp.result.report,baselineReport:sharp.baseline.report});
  // Existing independent analytic acceptance uses 1.5 native pixels for
  // source raster quantization. The separate 1.05 recovery-to-raster gate
  // cannot be reused directly as an analytic apex error allowance.
  expect.soft(savedDistance).toBeLessThanOrEqual(1.5);
  const turns=sharp.piece.nodes.flatMap((p,i)=>{const q=sharp.toPixel(p);if(Math.hypot(q.xMm-tip.xMm,q.yMm-tip.yMm)>2)return[];const a=sharp.piece.curves?.find(c=>c.endNodeId===p.id)?.c2??sharp.piece.nodes[(i+sharp.piece.nodes.length-1)%sharp.piece.nodes.length],b=sharp.piece.curves?.find(c=>c.startNodeId===p.id)?.c1??sharp.piece.nodes[(i+1)%sharp.piece.nodes.length];return[Math.abs(Math.atan2((p.xMm-a.xMm)*(b.yMm-p.yMm)-(p.yMm-a.yMm)*(b.xMm-p.xMm),(p.xMm-a.xMm)*(b.xMm-p.xMm)+(p.yMm-a.yMm)*(b.yMm-p.yMm)))];});
  expect.soft(Math.max(0,...turns),'an actual acute paint corner cannot become a smooth join').toBeGreaterThan(.8);
 }
});
it('retains the complete narrow exterior slit in an actual antialiased input',()=>{
 const slit=antialiased('slit');for(const y of [25,30,35,39])expect(owns(slit.piece,slit.fromPixel({xMm:21,yMm:y}))).toBe(false);
});
it('retains the two-pixel painted hole in an actual antialiased input',()=>{
 const hole=antialiased('hole');expect(hole.piece.holes).toHaveLength(1);for(const x of [23.25,24,24.75])expect(owns(hole.piece,hole.fromPixel({xMm:x,yMm:24}))).toBe(false);
});

afterAll(()=>{const directory=resolve('test-results/contour-repair/test-review');mkdirSync(directory,{recursive:true});writeFileSync(resolve(directory,'small-aa-safety-metrics.json'),JSON.stringify({scope:'Original three-argument safeContour / default 3% contract. Small independent 8x8 AA source fixtures; direct cubic sampling, analytic geometry and raster-only recovery baseline. No JPEG, native, desktop or production mutation.',records},null,2));});
