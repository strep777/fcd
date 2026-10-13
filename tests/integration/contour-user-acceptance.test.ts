import {expect,it} from 'vitest';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import {traceMask} from '../../apps/desktop/main/reference-segmentation';
import {resolve} from 'node:path';
import {clip} from '../../apps/desktop/main/markings';
import {edgeArcPoints} from '../../packages/pattern/edit';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import {pigmentFamily} from '../../packages/reference/illustration';
import type {Piece,Point,Reference} from '../../packages/schema/index';

// Independent observations on the user's exact original JPEG. These open
// intervals contain the broad painted bend only; tips, fur notches, material
// junctions and pad creases are deliberately outside the acceptance interval.
// A mask-distance check alone accepted the visible alternating polygon turns.
const rois=[
 {name:'left yellow thigh broad outer bend',color:'#f9e33c',minX:776,maxX:789,minY:515,maxY:543},
 {name:'raised pink paw lower pad broad outer bend',color:'#f9b2b3',minX:635,maxX:653,minY:292,maxY:306}
];
const angle=(a:{x:number;y:number},b:{x:number;y:number})=>Math.abs(Math.atan2(a.x*b.y-a.y*b.x,a.x*b.x+a.y*b.y));
function tangentTurn(piece:Piece,id:string){
 const i=piece.nodes.findIndex(n=>n.id===id),p=piece.nodes[i],previous=piece.nodes[(i+piece.nodes.length-1)%piece.nodes.length],next=piece.nodes[(i+1)%piece.nodes.length],incoming=piece.curves?.find(c=>c.endNodeId===id),outgoing=piece.curves?.find(c=>c.startNodeId===id);
 const a=incoming?.c2??previous,b=outgoing?.c1??next;
 return angle({x:p.xMm-a.xMm,y:p.yMm-a.yMm},{x:b.xMm-p.xMm,y:b.yMm-p.yMm});
}
// Sample cubic coordinates directly, independent of production flatteners.
function sample(piece:Piece){return piece.nodes.flatMap((a,i)=>{const b=piece.nodes[(i+1)%piece.nodes.length],c=piece.curves?.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id);return Array.from({length:64},(_,k)=>{const t=k/64,s=1-t;return c?{xMm:s*s*s*a.xMm+3*s*s*t*c.c1.xMm+3*s*t*t*c.c2.xMm+t*t*t*b.xMm,yMm:s*s*s*a.yMm+3*s*s*t*c.c1.yMm+3*s*t*t*c.c2.yMm+t*t*t*b.yMm}:{xMm:a.xMm+t*(b.xMm-a.xMm),yMm:a.yMm+t*(b.yMm-a.yMm)};});});}
let importedPromise:Promise<Piece[]>|undefined;
function importOriginal(){return importedPromise??=(async()=>{
 const refs:Reference[]=[];
 for(const[view,left,width]of[['back',0,609],['front',609,666]] as const){const png=await sharp('tests/fixtures/character-front-back.jpg').extract({left,top:0,width,height:750}).png().toBuffer();refs.push({id:randomUUID(),name:view,view,width,height:750,png:'data:image/png;base64,'+png.toString('base64'),calibration:{a:{x:0,y:750},b:{x:0,y:0},distanceMm:750},calibrationMode:'manual',resources:{} as Reference['resources']});}
 return splitReferences(refs,750,12,true).regions.filter(p=>p.view==='front').map(p=>p.piece);
})();}
it.each(rois)('original JPEG $name has no artificial sharp heading changes',async roi=>{
 // The representative palette can move by one RGB level when an unrelated
 // misclassified patch is corrected. Locate the material by family and the
 // independently observed image interval, rather than its old exact hex.
 const imported=await importOriginal(),candidates=imported.filter(p=>pigmentFamily(p.color)===pigmentFamily(roi.color)&&sample(p).some(n=>n.xMm+609>=roi.minX&&n.xMm+609<=roi.maxX&&750-n.yMm>=roi.minY&&750-n.yMm<=roi.maxY));
 expect(candidates.length).toBeGreaterThan(0);
 const turns=candidates.flatMap(p=>p.nodes.filter(n=>n.xMm+609>=roi.minX&&n.xMm+609<=roi.maxX&&750-n.yMm>=roi.minY&&750-n.yMm<=roi.maxY).map(n=>({x:n.xMm+609,y:750-n.yMm,turn:tangentTurn(p,n.id)})));
 // 20 degrees is a geometric discontinuity bound at an observed broad bend,
 // not a demand for G1 at true corners or a prescribed cubic/node count.
 expect(Math.max(0,...turns.map(t=>t.turn)),JSON.stringify(turns)).toBeLessThanOrEqual(Math.PI/9);
},60000);

it.each([.05,1,10].flatMap(scale=>[0,.37,1.1].map(rotation=>({scale,rotation}))))('recovers an analytic curved interface at scale $scale rotation $rotation without polygon heading spikes',async({scale,rotation})=>{
 const width=220,height=180,masks=[new Uint8Array(width*height),new Uint8Array(width*height)];
 for(let y=10;y<170;y++)for(let x=10;x<210;x++)masks[((x+.5-110)/85)**2+((y+.5-90)/60)**2<1?0:1][y*width+x]=1;
 const raw=masks.map(mask=>traceMask(width,height,mask,{a:{x:0,y:height},b:{x:0,y:0},distanceMm:height},width,height,'#123456',true).piece),transform=(p:Point)=>({...p,xMm:1000+scale*(p.xMm*Math.cos(rotation)-p.yMm*Math.sin(rotation)),yMm:-1000+scale*(p.xMm*Math.sin(rotation)+p.yMm*Math.cos(rotation))}),originals=raw.map(p=>({...p,nodes:p.nodes.map(transform),holes:p.holes?.map(h=>h.map(transform))})),recovered=recoverSharedContours(originals,.8*scale,randomUUID).pieces,piece=recovered[0];
 const untransform=(p:{xMm:number;yMm:number})=>{const x=(p.xMm-1000)/scale,y=(p.yMm+1000)/scale;return{x:x*Math.cos(rotation)+y*Math.sin(rotation),y:-x*Math.sin(rotation)+y*Math.cos(rotation)}};
 // The known analytic boundary is an oracle distinct from classified pixels.
 const normalized=sample(piece).map(untransform);
 const distanceToEllipse=(p:{x:number;y:number})=>{const x=p.x-110,y=p.y-90;let t=Math.atan2(y/60,x/85);for(let i=0;i<12;i++){const c=Math.cos(t),s=Math.sin(t),f=(60*60-85*85)*s*c+85*x*s-60*y*c,d=(60*60-85*85)*(c*c-s*s)+85*x*c+60*y*s;t-=f/d;}return Math.hypot(x-85*Math.cos(t),y-60*Math.sin(t));};
 // Pixel centres classify the analytic ellipse. A raster boundary vertex is
 // at most half the pixel diagonal away from the crossing between opposing
 // centres. First verify that independent quantization envelope, then add
 // the existing 1.05-pixel recovery envelope by the triangle inequality.
 expect(Math.max(...originals[0].nodes.map(untransform).map(distanceToEllipse))).toBeLessThanOrEqual(Math.SQRT1_2+1e-8);
 expect(Math.max(...normalized.map(distanceToEllipse))).toBeLessThanOrEqual(Math.SQRT1_2+1.05+1e-8);
 expect(Math.max(...piece.nodes.map(n=>tangentTurn(piece,n.id)))).toBeLessThanOrEqual(Math.PI/9);
 expect(piece.holes?.length??0).toBe(0);expect(recovered[1].holes).toHaveLength(1);
 const rings=(p:Piece)=>[p.nodes.flatMap(n=>edgeArcPoints(p,n.id).slice(0,-1)).map(n=>[n.xMm,n.yMm]as[number,number]),...(p.holes??[]).map(h=>h.map(n=>[n.xMm,n.yMm]as[number,number]))].map(r=>r.map(([x,y])=>[x-1000,y+1000]as[number,number])),area=(r:number[][][])=>Math.abs(r.reduce((a,p)=>a+p.reduce((s,n,i)=>{const q=p[(i+1)%p.length];return s+n[0]*q[1]-q[0]*n[1];},0)/2,0));
 const rect=[[[10,10],[210,10],[210,170],[10,170]].map(([x,y])=>[scale*(x*Math.cos(rotation)-y*Math.sin(rotation)),scale*(x*Math.sin(rotation)+y*Math.cos(rotation))]as[number,number])],worker=resolve('target/release/fpcad-worker.exe'),[union]=await clip(worker,[{subjects:recovered.flatMap(rings),union:true}],9),[gap,overlap]=await clip(worker,[{subjects:rect,subtract:union},{subjects:rings(recovered[0]),clips:rings(recovered[1])}],9);
 // Worker comparisons use a 10^-9 mm integer clip grid. Two rounded
 // boundaries can differ by one grid unit; bound that numerical sliver by
 // the source perimeter, in addition to transformed-coordinate roundoff.
 const numericArea=(128*Number.EPSILON*1000+1e-9)*2*(width+height)*scale;expect(area(gap)).toBeLessThan(numericArea);expect(area(overlap)).toBeLessThan(numericArea);
});
it.each([.13,.6,1,1.5,2.7].flatMap(slope=>[.05,1,10].flatMap(scale=>[0,.37].map(rotation=>({slope,scale,rotation})))))('keeps analytic straight slopes $slope straight at scale $scale rotation $rotation',({slope,scale,rotation})=>{
 const height=180,width=Math.ceil(160*slope)+80,masks=Array.from({length:3},()=>new Uint8Array(width*height));for(let y=10;y<170;y++)for(let x=10;x<width-10;x++){const border=30+slope*(y+.5-10);masks[x+.5<border?0:x+.5<border+8?1:2][y*width+x]=1;}
 const transform=(p:Point)=>({...p,xMm:1000+scale*(p.xMm*Math.cos(rotation)-p.yMm*Math.sin(rotation)),yMm:-1000+scale*(p.xMm*Math.sin(rotation)+p.yMm*Math.cos(rotation))}),originals=masks.map(mask=>{const raw=traceMask(width,height,mask,{a:{x:0,y:height},b:{x:0,y:0},distanceMm:height},width,height,'#123456',true).piece;return{...raw,nodes:raw.nodes.map(transform),holes:raw.holes?.map(h=>h.map(transform))};}),piece=recoverSharedContours(originals,.8*scale,randomUUID).pieces[1];
 const points=sample(piece).map(p=>{const x=(p.xMm-1000)/scale,y=(p.yMm+1000)/scale;return{x:x*Math.cos(rotation)+y*Math.sin(rotation),y:-x*Math.sin(rotation)+y*Math.cos(rotation)}}),turns:number[]=[];
 for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if(a.y<40||a.y>140||b.y<40||b.y>140||Math.hypot(b.x-a.x,b.y-a.y)<1e-8)continue;const t=angle({x:b.x-a.x,y:b.y-a.y},{x:slope,y:-1});turns.push(Math.min(t,Math.PI-t));}
 expect(turns.length).toBeGreaterThan(0);expect(Math.max(...turns)).toBeLessThanOrEqual(.02);
});
