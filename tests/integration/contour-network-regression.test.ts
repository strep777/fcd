import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import {traceMask} from '../../apps/desktop/main/reference-segmentation';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import {recoverContour} from '../../packages/reference/recover-contour';
import {safeContour,contourBoundaryError} from '../../packages/reference/contour-topology';
import type {Point,Piece,Reference} from '../../packages/schema/index';

const heading=(p:Piece,n:Point)=>{
 const i=p.nodes.indexOf(n),a=p.curves?.find(c=>c.endNodeId===n.id)?.c2??p.nodes[(i+p.nodes.length-1)%p.nodes.length],b=p.curves?.find(c=>c.startNodeId===n.id)?.c1??p.nodes[(i+1)%p.nodes.length];
 return Math.abs(Math.atan2((n.xMm-a.xMm)*(b.yMm-n.yMm)-(n.yMm-a.yMm)*(b.xMm-n.xMm),(n.xMm-a.xMm)*(b.xMm-n.xMm)+(n.yMm-a.yMm)*(b.yMm-n.yMm)));
};
let actualPieces:Promise<Piece[]>|undefined;
function actualFrontPieces(){return actualPieces??=(async()=>{
 const references:Reference[]=[];
 for(const [view,left,width]of[['back',0,609],['front',609,666]]as const){const png=await sharp('tests/fixtures/character-front-back.jpg').extract({left,top:0,width,height:750}).png().toBuffer();references.push({id:randomUUID(),name:view,view,width,height:750,png:'data:image/png;base64,'+png.toString('base64'),calibration:{a:{x:0,y:750},b:{x:0,y:0},distanceMm:750},calibrationMode:'manual',resources:{} as Reference['resources']});}
 return splitReferences(references,750,12,true).regions.filter(r=>r.view==='front').map(r=>r.piece);
})();}
it('the actual JPEG thigh bottom does not acquire a backwards-pointing cubic cusp',async()=>{
 const pieces=await actualFrontPieces(),checked:number[]=[];
 // The source boundary traverses this bottom interval monotonically in X,
 // even where its current ownership has a small vertical notch. A fitted
 // cubic must not add the backwards X tangent visible at (743,582).
 for(const p of pieces.filter(p=>p.color==='#f9e33c'))for(const c of p.curves??[]){
  const a=p.nodes.find(n=>n.id===c.startNodeId)!,b=p.nodes.find(n=>n.id===c.endNodeId)!;
  if([a,b].some(n=>n.xMm+609<731||n.xMm+609>764||750-n.yMm<570||750-n.yMm>588))continue;
  const sign=Math.sign(b.xMm-a.xMm);if(!sign)continue;
  for(let k=0;k<=128;k++){const t=k/128,s=1-t;checked.push(sign*3*(s*s*(c.c1.xMm-a.xMm)+2*s*t*(c.c2.xMm-c.c1.xMm)+t*t*(b.xMm-c.c2.xMm)));}
 }
 expect(checked.length).toBeGreaterThan(0);expect(Math.min(...checked)).toBeGreaterThanOrEqual(-1e-8);
},30000);
it('the actual JPEG inner white fur tip remains a sharp measured point',async()=>{
 const pieces=await actualFrontPieces(),tips=pieces.filter(p=>p.color==='#f9e33c').flatMap(p=>p.nodes.filter(n=>n.xMm+609>=760.5&&n.xMm+609<=763&&750-n.yMm>=510&&750-n.yMm<=513).map(n=>heading(p,n)));
 // Both long incident edges meet at the original narrow white fur tip near
 // (762,512). A broad cubic through this interval rounded the source point.
 expect(tips.length).toBeGreaterThan(0);expect(Math.max(...tips)).toBeGreaterThanOrEqual(Math.PI/3);
},30000);
it.each([8,15,25].flatMap(radius=>[.05,1,10].flatMap(scale=>[0,.37].map(rotation=>({radius,scale,rotation})))))('small analytic ellipse radius $radius retains its painted curvature at scale $scale rotation $rotation',({radius,scale,rotation})=>{
 const width=110,height=110,masks=[new Uint8Array(width*height),new Uint8Array(width*height)];
 for(let y=5;y<105;y++)for(let x=5;x<105;x++)masks[((x+.5-55)/(radius*1.4))**2+((y+.5-55)/radius)**2<1?0:1][y*width+x]=1;
 const transform=(p:Point)=>({...p,xMm:1000+scale*(p.xMm*Math.cos(rotation)-p.yMm*Math.sin(rotation)),yMm:-1000+scale*(p.xMm*Math.sin(rotation)+p.yMm*Math.cos(rotation))}),originals=masks.map(mask=>{const p=traceMask(width,height,mask,{a:{x:0,y:height},b:{x:0,y:0},distanceMm:height},width,height,'#123456',true).piece;return{...p,nodes:p.nodes.map(transform),holes:p.holes?.map(h=>h.map(transform))};}),{pieces}=recoverSharedContours(originals,.8*scale,randomUUID),p=pieces[0];
 for(let i=0;i<2;i++){expect(safeContour(pieces[i],originals[i],.8*scale)).toBe(true);expect(contourBoundaryError(pieces[i],originals[i],scale*.1,scale*1.05)).toBeLessThanOrEqual(scale*1.05);}
 expect(Math.max(...p.nodes.map(n=>heading(p,n)))).toBeLessThanOrEqual(Math.PI/9);
 // Independent analytic ellipse oracle, evaluating the stored curve directly.
 let error=0;
 for(let i=0;i<p.nodes.length;i++){const a=p.nodes[i],b=p.nodes[(i+1)%p.nodes.length],c=p.curves?.find(c=>c.startNodeId===a.id);for(let k=0;k<64;k++){const t=k/64,s=1-t,v=c?{xMm:s*s*s*a.xMm+3*s*s*t*c.c1.xMm+3*s*t*t*c.c2.xMm+t*t*t*b.xMm,yMm:s*s*s*a.yMm+3*s*s*t*c.c1.yMm+3*s*t*t*c.c2.yMm+t*t*t*b.yMm}:{xMm:a.xMm+t*(b.xMm-a.xMm),yMm:a.yMm+t*(b.yMm-a.yMm)},u=(v.xMm-1000)/scale,w=(v.yMm+1000)/scale,x=u*Math.cos(rotation)+w*Math.sin(rotation),y=-u*Math.sin(rotation)+w*Math.cos(rotation),theta=Math.atan2((y-55)/radius,(x-55)/(radius*1.4));error=Math.max(error,Math.hypot(x-55-radius*1.4*Math.cos(theta),y-55-radius*Math.sin(theta)));}}
 expect(error).toBeLessThanOrEqual(1.2);
});

it.each([.05,1,10].flatMap(scale=>[0,.37].map(rotation=>({scale,rotation}))))('small pointed marking retains four straight sides at scale $scale rotation $rotation',({scale,rotation})=>{
 const width=110,height=110,mask=new Uint8Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(Math.abs(x+.5-55)/8+Math.abs(y+.5-55)/13<1)mask[y*width+x]=1;
 const raw=traceMask(width,height,mask,{a:{x:0,y:height},b:{x:0,y:0},distanceMm:height},width,height,'#123456',true).piece,transform=(p:Point)=>({...p,xMm:1000+scale*(p.xMm*Math.cos(rotation)-p.yMm*Math.sin(rotation)),yMm:-1000+scale*(p.xMm*Math.sin(rotation)+p.yMm*Math.cos(rotation))}),original={...raw,nodes:raw.nodes.map(transform)},piece=recoverContour(original,.8*scale,randomUUID);
 expect(piece.curves??[]).toHaveLength(0);expect(piece.nodes.length).toBeLessThanOrEqual(10);
 expect(safeContour(piece,original,.8*scale)).toBe(true);
 expect(contourBoundaryError(piece,original,scale*.1,scale*1.05)).toBeLessThanOrEqual(scale*1.05);
});
