import {afterAll,expect,it} from 'vitest';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';
import {traceMask} from '../../apps/desktop/main/reference-segmentation';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import {contourPolyline} from '../../packages/reference/recover-contour';
import type {Piece} from '../../packages/schema/index';

type XY={x:number;y:number};
const sourceFingerprint=()=>Object.fromEntries(['recover-contour.ts','shared-contour.ts','illustration.ts','image-edge-evidence.ts'].map(file=>[file,createHash('sha256').update(readFileSync(resolve('packages/reference',file))).digest('hex')]));
const sourceAtModuleLoad=sourceFingerprint();
type Case={name:string;w:number;h:number;owner:(x:number,y:number)=>number;boundary:XY[][];aa?:number;maxError:number;holes?:number;maxNodes?:number;straight?:boolean;maxArcTurnDegrees?:number};
const colors=[[237,231,234],[249,227,60],[30,110,220]];
const segment=(a:XY,b:XY,step=.1)=>Array.from({length:Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/step)},(_,i)=>{const t=i/Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/step);return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};});
const polygon=(r:XY[])=>r.flatMap((a,i)=>segment(a,r[(i+1)%r.length]));
const inside=(x:number,y:number,r:XY[])=>{let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
const circle=(cx:number,cy:number,r:number)=>Array.from({length:Math.ceil(2*Math.PI*r/.1)},(_,i)=>({x:cx+r*Math.cos(i*2*Math.PI/Math.ceil(2*Math.PI*r/.1)),y:cy+r*Math.sin(i*2*Math.PI/Math.ceil(2*Math.PI*r/.1))}));
const distance=(p:XY,a:XY,b:XY)=>{const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
const nearest=(p:XY,rings:XY[][])=>{let d=Infinity;for(const r of rings)for(let i=0;i<r.length;i++)d=Math.min(d,distance(p,r[i],r[(i+1)%r.length]));return d;};
const quantiles=(a:number[])=>{a.sort((x,y)=>x-y);return{p95:a[Math.floor(a.length*.95)],max:a.at(-1)!,samples:a.length};};
const netArea=(rings:XY[][])=>rings.reduce((sum,r,j)=>sum+(j?-1:1)*Math.abs(r.reduce((a,p,i)=>{const q=r[(i+1)%r.length];return a+p.x*q.y-q.x*p.y;},0)/2),0);
const turns=(r:XY[])=>r.map((p,i)=>{const a=r[(i+r.length-1)%r.length],b=r[(i+1)%r.length];return{...p,angle:Math.abs(Math.atan2((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x),(p.x-a.x)*(b.x-p.x)+(p.y-a.y)*(b.y-p.y)))};});
const flatten=(p:Piece,h:number):XY[][]=>[contourPolyline(p.nodes,p.curves??[],true,.015,()=>crypto.randomUUID()),...(p.holes??[])].map(r=>r.map(n=>({x:n.xMm,y:h-n.yMm})));
const straight=[{x:18.25,y:20.5},{x:92.75,y:20.5},{x:75.35,y:92.5},{x:18.25,y:70.35}];
const pointed=[{x:56.3,y:10.2},{x:94.1,y:96.4},{x:50.2,y:78.1},{x:20.4,y:96.4}];
const openCurve=[...Array.from({length:1121},(_,i)=>({x:54.2+17.3*Math.sin(i*.1/21),y:i*.1})),{x:0,y:112},{x:0,y:0}];
const lineArc=[{x:20,y:20},...Array.from({length:1132},(_,i)=>{const t=-Math.PI/2+i*Math.PI/1131;return{x:56+36*Math.cos(t),y:56+36*Math.sin(t)};}),{x:20,y:92}];
const diamond=(cx:number,cy:number,rx:number,ry:number)=>[{x:cx-rx,y:cy},{x:cx,y:cy-ry},{x:cx+rx,y:cy},{x:cx,y:cy+ry}];
const cases:Case[]=[
 {name:'straight-and-diagonal-aa',w:112,h:112,owner:(x,y)=>inside(x,y,straight)?1:0,boundary:[straight],aa:8,maxError:1.5,maxNodes:8,straight:true},
 {name:'curved-aa',w:112,h:112,owner:(x,y)=>Math.hypot(x-55.2,y-56.4)<35.6?1:0,boundary:[circle(55.2,56.4,35.6)],aa:8,maxError:1.5},
 {name:'acute-tip-and-concave-corner-aa',w:112,h:112,owner:(x,y)=>inside(x,y,pointed)?1:0,boundary:[pointed],aa:8,maxError:1.5},
 {name:'enclosed-hole-aa',w:112,h:112,owner:(x,y)=>Math.hypot(x-56.2,y-55.4)<38.3&&Math.hypot(x-55.2,y-54.4)>12.7?1:0,boundary:[circle(56.2,55.4,38.3),circle(55.2,54.4,12.7)],aa:8,maxError:1.5,holes:1},
 {name:'low-resolution-curve-aa',w:32,h:32,owner:(x,y)=>Math.hypot(x-15.2,y-16.4)<9.6?1:0,boundary:[circle(15.2,16.4,9.6)],aa:8,maxError:1.5},
 {name:'three-colors-shared-junction-aa',w:112,h:112,owner:(x,y)=>x<35.3+y*.23?1:y<55.7?2:0,boundary:[[{x:35.3,y:0},{x:35.3+112*.23,y:112},{x:0,y:112},{x:0,y:0}]],aa:8,maxError:1.5},
 {name:'low-resolution-straight-sharp',w:32,h:32,owner:(x,y)=>x>=5&&x<27&&y>=7&&y<25?1:0,boundary:[[{x:5,y:7},{x:27,y:7},{x:27,y:25},{x:5,y:25}]],aa:1,maxError:.1},
 {name:'open-curve-with-shared-ends-aa',w:112,h:112,owner:(x,y)=>x<54.2+17.3*Math.sin(y/21)?1:0,boundary:[openCurve],aa:8,maxError:1.5},
 {name:'line-to-arc-junction-aa',w:112,h:112,owner:(x,y)=>y>=20&&y<92&&x>=20&&(x<=56||Math.hypot(x-56,y-56)<36)?1:0,boundary:[lineArc],aa:8,maxError:1.5,maxArcTurnDegrees:15},
 ...[[15,5,.4],[4,13,.4],[4,13,.9]].map(([rx,ry,phase]):Case=>({name:`small-diamond-${rx}-${ry}-phase-${phase}-aa`,w:110,h:110,owner:(x,y)=>Math.abs(x-55-phase)/rx+Math.abs(y-55-phase)/ry<1?1:0,boundary:[diamond(55+phase,55+phase,rx,ry)],aa:8,maxError:1.5,maxNodes:8,straight:true})),
];
const records:unknown[]=[],visuals:{c:Case;rgba:Uint8Array;ring:XY[][]}[]=[];
it.each(cases)('$name checks recovered native geometry against independent original-image geometry',c=>{
 // Supersample the original colored image itself. The analytic contour is
 // independent of ownership thresholds, raw mask tracing, and vector fitting.
 const rgba=new Uint8Array(c.w*c.h*4),n=c.aa??1;
 for(let y=0;y<c.h;y++)for(let x=0;x<c.w;x++){
  const sum=[0,0,0];for(let dy=0;dy<n;dy++)for(let dx=0;dx<n;dx++){const id=c.owner(x+(dx+.5)/n,y+(dy+.5)/n);for(let k=0;k<3;k++)sum[k]+=colors[id][k]/(n*n);}
  rgba.set([...sum.map(Math.round),255],(y*c.w+x)*4);
 }
 const classified=illustrationRegions(c.w,c.h,rgba,false,'head'),raw=classified.regions.map(r=>{const mask=new Uint8Array(c.w*c.h);r.indices.forEach(i=>mask[i]=1);return traceMask(c.w,c.h,mask,{a:{x:0,y:c.h},b:{x:0,y:0},distanceMm:c.h},c.w,c.h,r.color,true).piece;});
 const recovered=recoverSharedContours(raw,.8,()=>crypto.randomUUID()),targets=recovered.pieces.filter(p=>pigmentFamily(p.color!)===2);
 expect(targets).toHaveLength(1);const p=targets[0],ring=flatten(p,c.h),truth=c.boundary.map(r=>polygon(r));
 const sourceToSaved=quantiles(truth.flatMap(r=>r.map(q=>nearest(q,ring)))),savedToSource=quantiles(ring.flatMap(r=>polygon(r).map(q=>nearest(q,c.boundary))));
 const mismatchedCenterPixels=Array.from({length:c.w*c.h},(_,i)=>i).filter(i=>{const x=i%c.w+.5,y=Math.floor(i/c.w)+.5;return (inside(x,y,ring[0])&&!ring.slice(1).some(r=>inside(x,y,r)))!==(c.owner(x,y)===1);}).length;
 const arcTurns=c.name==='line-to-arc-junction-aa'?turns(ring[0]).filter(q=>q.x>54).sort((a,b)=>b.angle-a.angle):undefined;
 const straightAngles=c.straight?ring[0].map((a,i)=>{const b=ring[0][(i+1)%ring[0].length],m={x:(a.x+b.x)/2,y:(a.y+b.y)/2},truth=c.boundary[0];if(Math.min(...truth.map(p=>Math.hypot(p.x-m.x,p.y-m.y)))<2)return undefined;const side=truth.map((p,j)=>({a:p,b:truth[(j+1)%truth.length],distance:distance(m,p,truth[(j+1)%truth.length])})).sort((p,q)=>p.distance-q.distance)[0],u=Math.atan2(b.y-a.y,b.x-a.x),v=Math.atan2(side.b.y-side.a.y,side.b.x-side.a.x),angle=Math.acos(Math.min(1,Math.abs(Math.cos(u-v))));return{...m,length:Math.hypot(b.x-a.x,b.y-a.y),degrees:angle*180/Math.PI};}).filter(q=>q!==undefined).sort((a,b)=>b.degrees-a.degrees):undefined;
 const originalImageArea=netArea(c.boundary),classifiedPixelArea=classified.regions.filter(r=>pigmentFamily(r.color)===2).reduce((sum,r)=>sum+r.indices.length,0),savedArea=netArea(ring);
 records.push({case:c.name,width:c.w,height:c.h,aa:n,sourceToSaved,savedToSource,mismatchedCenterPixels,area:{originalImageArea,classifiedPixelArea,savedArea,savedVersusMaskRelativeError:Math.abs(savedArea-classifiedPixelArea)/classifiedPixelArea,savedVersusImageRelativeError:Math.abs(savedArea-originalImageArea)/originalImageArea},nodes:p.nodes.length,curves:p.curves?.length??0,holes:p.holes?.length??0,regions:raw.length,sharedChains:recovered.report.sharedChains,...(arcTurns?{largestArcTurns:arcTurns.slice(0,6).map(q=>({...q,degrees:q.angle*180/Math.PI}))}:{}),...(straightAngles?{largestStraightSpanDirectionErrors:straightAngles.slice(0,6)}:{})});visuals.push({c,rgba,ring});
 // Keep sampling coverage and flattening allowances distinct from the
 // measured maxima reported above. These are conservative test margins.
 expect(sourceToSaved.max+.05+.015,JSON.stringify(records.at(-1))).toBeLessThanOrEqual(c.maxError);
 expect(savedToSource.max+.05+.015,JSON.stringify(records.at(-1))).toBeLessThanOrEqual(c.maxError);
 if(c.holes!==undefined)expect(p.holes?.length??0).toBe(c.holes);
 if(c.maxNodes!==undefined){expect(p.curves??[],JSON.stringify(records.at(-1))).toHaveLength(0);expect(p.nodes.length,JSON.stringify(records.at(-1))).toBeLessThanOrEqual(c.maxNodes);}
 // This known radius-36 source has no corner along its curved half. Bound
 // visible unsupported turns independently of positional fidelity. Allow
 // finite native-pixel uncertainty at the tangent join; do not require C1.
 if(c.maxArcTurnDegrees!==undefined)expect(arcTurns![0].angle*180/Math.PI,JSON.stringify(records.at(-1))).toBeLessThanOrEqual(c.maxArcTurnDegrees);
 // Material network coverage uses saved geometry sampled independently; no
 // chain signatures, padding, or post-fit dilation can conceal a seam.
 const all=recovered.pieces.map(p=>flatten(p,c.h));let gaps=0,overlap=0;
 for(let y=.371;y<c.h;y+=.75)for(let x=.283;x<c.w;x+=.75){const owners=all.filter(r=>inside(x,y,r[0])&&!r.slice(1).some(h=>inside(x,y,h))).length;if(!owners)gaps++;if(owners>1)overlap++;}
 expect({gaps,overlap}).toEqual({gaps:0,overlap:0});
});
afterAll(async()=>{
 if(process.env.FPCAD_EDGE_AUDIT!=='1')return;
 const dir=resolve('test-results/latest-edge');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'original-edge-matrix.json'),JSON.stringify({capturedAt:new Date().toISOString(),sourceAtModuleLoad,sourceAtEvidenceSave:sourceFingerprint(),measurement:'Bidirectional Euclidean distance in native pixels. Reported p95/max are sampled measurements, not strict continuous maxima. Source/vector samples have at most 0.1px spacing (0.05px nearest-sample margin); curve flattening tolerance is separately 0.015px. Original image generated by 8x8 subpixel coverage. No smoothing or dilation in verification.',cases:records},null,2));
 for(const{c,rgba,ring}of visuals){const png=await sharp(rgba,{raw:{width:c.w,height:c.h,channels:4}}).png().toBuffer();const d=ring.map(r=>'M'+r.map(p=>`${p.x},${p.y}`).join('L')+'Z').join('');const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${c.w*8}" height="${c.h*4}" viewBox="0 0 ${c.w*2} ${c.h}"><image width="${c.w}" height="${c.h}" href="data:image/png;base64,${png.toString('base64')}"/><g transform="translate(${c.w} 0)"><image width="${c.w}" height="${c.h}" href="data:image/png;base64,${png.toString('base64')}"/><path d="${d}" fill="none" stroke="#ff006e" stroke-width=".3"/></g></svg>`;writeFileSync(resolve(dir,c.name+'.svg'),svg);await sharp(Buffer.from(svg)).png().toFile(resolve(dir,c.name+'.png'));}
});
