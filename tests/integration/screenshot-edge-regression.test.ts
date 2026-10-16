import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import * as illustration from '../../packages/reference/illustration';
import * as shared from '../../packages/reference/shared-contour';
import {contourPolyline} from '../../packages/reference/recover-contour';
import type {Piece,Reference,Calibration} from '../../packages/schema/index';

// Independent diagnostic for the three supplied UI crops. Coordinates below
// are fixed original-JPEG coordinates, not output-derived expected geometry.
const rois=[
 {name:'ear',x:870,y:20,w:90,h:150},
 {name:'yellow-tail',x:1040,y:525,w:180,h:95},
 {name:'eye',x:830,y:155,w:70,h:60}
];
const fingerprints=()=>Object.fromEntries(['apps/desktop/main/automatic-reference.ts',...['illustration.ts','recover-contour.ts','shared-contour.ts','image-contour.ts','image-edge-evidence.ts','pigment-shadows.ts','source-material-ownership.ts','image-dark-materials.ts'].map(f=>'packages/reference/'+f)].map(f=>[f,createHash('sha256').update(readFileSync(resolve(f))).digest('hex')]));
const loadedFingerprints=fingerprints();
type XY={x:number;y:number};
function pixel(p:{xMm:number;yMm:number},c:Calibration,left=609):XY{const dx=c.b.x-c.a.x,dy=c.b.y-c.a.y;return{x:left+c.a.x+(-dy*p.xMm+dx*p.yMm)/c.distanceMm,y:c.a.y+(dx*p.xMm+dy*p.yMm)/c.distanceMm};}
const inside=(p:XY,r:typeof rois[number])=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h;
function path(piece:Piece,c:Calibration,left=609){return[piece.nodes,...piece.holes??[]].map(r=>r.map((a,i)=>{const b=r[(i+1)%r.length],p=pixel(a,c,left),q=pixel(b,c,left),v=piece.curves?.find(v=>v.startNodeId===a.id&&v.endNodeId===b.id),u=v&&pixel(v.c1,c,left),w=v&&pixel(v.c2,c,left);return`${i?'':`M${p.x} ${p.y}`}${v?`C${u!.x} ${u!.y} ${w!.x} ${w!.y} ${q.x} ${q.y}`:`L${q.x} ${q.y}`}`;}).join('')+'Z').join('');}
function poly(piece:Piece,c:Calibration,left=609){return contourPolyline(piece.nodes,piece.curves??[],true,.015,randomUUID).map(p=>pixel(p,c,left));}
function distance(p:XY,ring:XY[]){let best=Infinity;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy));}return best;}
function turns(piece:Piece,c:Calibration,roi:typeof rois[number]){return piece.nodes.flatMap((n,i)=>{const p=pixel(n,c);if(!inside(p,roi))return[];const a=pixel(piece.curves?.find(v=>v.endNodeId===n.id)?.c2??piece.nodes[(i+piece.nodes.length-1)%piece.nodes.length],c),b=pixel(piece.curves?.find(v=>v.startNodeId===n.id)?.c1??piece.nodes[(i+1)%piece.nodes.length],c),ux=p.x-a.x,uy=p.y-a.y,vx=b.x-p.x,vy=b.y-p.y;return[{...p,turnDeg:Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy)*180/Math.PI,incoming:Math.hypot(ux,uy),outgoing:Math.hypot(vx,vy),incomingType:piece.curves?.some(v=>v.endNodeId===n.id)?'cubic':'line',outgoingType:piece.curves?.some(v=>v.startNodeId===n.id)?'cubic':'line'}];});}

it('records the screenshot ROIs through default import without substituting saved geometry for source truth',async()=>{
 const directory=resolve('test-results/contour-repair',process.env.FPCAD_CONTOUR_STAGE??'before');mkdirSync(directory,{recursive:true});
 const source='tests/fixtures/character-front-back.jpg',rgba=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const references:Reference[]=[];for(const[view,left,width]of[['back',0,609],['front',609,666]]as const){const png=await sharp(source).extract({left,top:0,width,height:750}).png().toBuffer();references.push({id:view,name:view,view,width,height:750,png:'data:image/png;base64,'+png.toString('base64'),resources:{} as Reference['resources']});}
 const classified:ReturnType<typeof illustration.illustrationRegions>[]=[],raw:Piece[][]=[],reports:ReturnType<typeof shared.recoverSharedContours>['report'][]=[];
 const actualClassify=illustration.illustrationRegions,actualShared=shared.recoverSharedContours;
 const classifySpy=vi.spyOn(illustration,'illustrationRegions').mockImplementation((...args)=>{const result=actualClassify(...args);classified.push(result);return result;});
 const sharedSpy=vi.spyOn(shared,'recoverSharedContours').mockImplementation((...args)=>{raw.push(structuredClone(args[0]));const result=actualShared(...args);reports.push(result.report);return result;});
 let saved:ReturnType<typeof splitReferences>;try{saved=splitReferences(references,1800,6,true);}finally{classifySpy.mockRestore();sharedSpy.mockRestore();}
 const ref=saved.references.find(r=>r.view==='front')!,c=ref.calibration!,front=saved.regions.filter(r=>r.view==='front'),frontRaw=raw[1];
 const sourcePNG=await sharp(source).png().toBuffer(),image=`<image width="1275" height="750" href="data:image/png;base64,${sourcePNG.toString('base64')}"/>`;
 const labels=classified.map((view,index)=>{const width=index===0?609:666,a=new Int32Array(width*750).fill(-1);view.regions.forEach((r,id)=>r.indices.forEach(i=>a[i]=id));return{view:index===0?'back':'front',width,height:750,labels:Array.from(a),regions:view.regions};});
 writeFileSync(resolve(directory,'classified-pixels.json'),JSON.stringify(labels));
 writeFileSync(resolve(directory,'raw-contours.json'),JSON.stringify({references:saved.references.map(({png,...r})=>r),raw}));
 writeFileSync(resolve(directory,'saved-pieces.json'),JSON.stringify(saved));
 const metrics=rois.map(roi=>({roi,regions:front.flatMap((r,i)=>{const ring=poly(r.piece,c);if(!ring.some(p=>inside(p,roi)))return[];const sourceRing=frontRaw[i].nodes.map(p=>pixel(p,c)),local=ring.filter(p=>inside(p,roi)),localRaw=sourceRing.filter(p=>inside(p,roi));return[{regionIndex:i,name:r.piece.name,color:r.piece.color,pigment:illustration.pigmentFamily(r.piece.color!),rawNodes:frontRaw[i].nodes.length,nodes:r.piece.nodes.length,curves:r.piece.curves?.length??0,maxOutputToRaw:Math.max(0,...local.map(p=>distance(p,sourceRing))),maxRawToOutput:Math.max(0,...localRaw.map(p=>distance(p,ring))),rawLocal:localRaw,turns:turns(r.piece,c,roi)}];})}));
 for(const roi of rois){
  const rawPaths=frontRaw.map(p=>`<path d="${path(p,c)}"/>`).join(''),savedPaths=front.map(r=>`<path d="${path(r.piece,c)}"/>`).join('');
  const panels=[image,image+`<g fill="none" stroke="#0077ff" stroke-width=".22">${rawPaths}</g>`,image+`<g fill="none" stroke="#ff006e" stroke-width=".22">${savedPaths}</g>`].map((content,i)=>`<svg x="${i*roi.w}" y="0" width="${roi.w}" height="${roi.h}" viewBox="${roi.x} ${roi.y} ${roi.w} ${roi.h}">${content}</svg>`).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${roi.w*18}" height="${roi.h*6}" viewBox="0 0 ${roi.w*3} ${roi.h}">${panels}</svg>`;writeFileSync(resolve(directory,roi.name+'-original-mask-saved.svg'),svg);await sharp(Buffer.from(svg)).png().toFile(resolve(directory,roi.name+'-original-mask-saved.png'));
 }
 // Retain RGB plus classification ownership in the exact fixed source areas.
 // Explicitly diagnostic: dark strokes, JPEG softness and highlights do not
 // identify a unique physical fabric boundary, nor a tangent ground truth.
 const localPixels=rois.map(roi=>({roi,rows:Array.from({length:roi.h},(_,dy)=>Array.from({length:roi.w},(_,dx)=>{const x=roi.x+dx,y=roi.y+dy,k=(y*1275+x)*4;return{rgb:Array.from(rgba.data.subarray(k,k+3)),label:labels[1].labels[y*666+x-609]};}))}));
 writeFileSync(resolve(directory,'roi-original-rgb-and-labels.json'),JSON.stringify(localPixels));
 const older='test-results/current-task/default-real-edge-output.json';
 let oldComparison:unknown='prior default-import artifact absent';
 if(existsSync(older)){const old=JSON.parse(readFileSync(older,'utf8')) as typeof saved;const geometry=(v:typeof saved)=>JSON.stringify(v.regions.map(r=>({view:r.view,color:r.piece.color,nodes:r.piece.nodes.map(n=>[n.xMm,n.yMm]),curves:r.piece.curves?.map(v=>[v.c1.xMm,v.c1.yMm,v.c2.xMm,v.c2.yMm]),holes:r.piece.holes?.map(h=>h.map(n=>[n.xMm,n.yMm]))})));oldComparison={path:older,sameGeometryIgnoringIds:geometry(old)===geometry(saved),oldRegions:old.regions.length,currentRegions:saved.regions.length,limitation:'Comparison is with a preserved test artifact, not the user project. Screenshot age or project origin cannot be established without reading that project.'};}
 writeFileSync(resolve(directory,'audit.json'),JSON.stringify({capturedAt:new Date().toISOString(),sourceSHA256:createHash('sha256').update(readFileSync(source)).digest('hex'),loadedFingerprints,savedFingerprints:fingerprints(),parameters:{heightMm:1800,clusters:6,excludeBackground:true,mode:'simple',subject:'character'},reports,metrics,oldComparison,limitations:['Generated overlays are not desktop screenshots.','Raw contours are exact classified pixel boundaries, not semantic ground truth.','Source RGB and full classified indices are saved for independent inspection.','Turn angles are measurements, not a quality oracle: source spikes and shared junctions can be real.','No original-user workspace, native geometry solver, desktop or old saved project was exercised.']},null,2));
 expect(classified).toHaveLength(2);expect(raw).toHaveLength(2);expect(metrics.every(r=>r.regions.length>0)).toBe(true);
 expect(fingerprints(),'source changed while evidence was computed').toEqual(loadedFingerprints);
},120000);

// Analytic regressions specify the artwork before rasterization. The decoded
// classification and recovery remain production code; only the renderer and
// the measurement oracle below are independent test code.
type AnalyticFixture={name:string;width:number;height:number;color:(p:XY)=>number[];blur?:number;perturb?:{x:number;y:number;rgb:number[]}};
function inPolygon(p:XY,ring:XY[]){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;}
function independentRing(piece:Piece,c:Calibration,ring=piece.nodes){return ring.flatMap((a,i)=>{const b=ring[(i+1)%ring.length],v=piece.curves?.find(v=>v.startNodeId===a.id&&v.endNodeId===b.id),p=pixel(a,c,0),q=pixel(b,c,0),u=v?pixel(v.c1,c,0):p,w=v?pixel(v.c2,c,0):q,n=Math.max(1,Math.ceil((Math.hypot(p.x-u.x,p.y-u.y)+Math.hypot(u.x-w.x,u.y-w.y)+Math.hypot(w.x-q.x,w.y-q.y))/.15));return Array.from({length:n},(_,j)=>{const t=j/n,s=1-t;return{x:s*s*s*p.x+3*s*s*t*u.x+3*s*t*t*w.x+t*t*t*q.x,y:s*s*s*p.y+3*s*s*t*u.y+3*s*t*t*w.y+t*t*t*q.y};});});}
async function analyticImport(f:AnalyticFixture){
 const rgba=new Uint8Array(f.width*f.height*4),aa=6;
 for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){const rgb=[0,0,0];for(let j=0;j<aa;j++)for(let i=0;i<aa;i++){const c=f.color({x:x+(i+.5)/aa,y:y+(j+.5)/aa});for(let k=0;k<3;k++)rgb[k]+=c[k]/(aa*aa);}rgba.set([...rgb.map(Math.round),255],(y*f.width+x)*4);}
 let raster=sharp(rgba,{raw:{width:f.width,height:f.height,channels:4}});if(f.blur)raster=raster.blur(f.blur);
 let bytes=await raster.raw().toBuffer();if(f.perturb)bytes.set([...f.perturb.rgb,255],(f.perturb.y*f.width+f.perturb.x)*4);
 const png=await sharp(bytes,{raw:{width:f.width,height:f.height,channels:4}}).png().toBuffer(),c:Calibration={a:{x:0,y:f.height},b:{x:0,y:0},distanceMm:f.height};
 const refs:Reference[]=(['back','front']as const).map(view=>({id:view,name:view,view,width:f.width,height:f.height,png:'data:image/png;base64,'+png.toString('base64'),resources:{} as Reference['resources'],calibration:c,calibrationMode:'manual'}));
 const result=splitReferences(refs,f.height,6,false,'simple','head'),pieces=result.regions.filter(r=>r.view==='front').map(r=>r.piece),rings=pieces.map(p=>[p.nodes,...p.holes??[]].map(r=>independentRing(p,c,r)));
 const contains=(i:number,p:XY)=>inPolygon(p,rings[i][0])&&!rings[i].slice(1).some(r=>inPolygon(p,r)),owners=(p:XY)=>pieces.map((piece,i)=>({piece,i})).filter(r=>contains(r.i,p));
 const directory=resolve('test-results/contour-repair',process.env.FPCAD_CONTOUR_STAGE??'before','analytic');mkdirSync(directory,{recursive:true});writeFileSync(resolve(directory,f.name+'-source.png'),png);writeFileSync(resolve(directory,f.name+'-saved.json'),JSON.stringify(result));writeFileSync(resolve(directory,f.name+'-provenance.json'),JSON.stringify({capturedAt:new Date().toISOString(),loadedFingerprints,savedFingerprints:fingerprints(),sourcePNGHash:createHash('sha256').update(png).digest('hex'),fixture:{name:f.name,width:f.width,height:f.height,blur:f.blur??0,antialias:aa,perturb:f.perturb},limitation:'Analytic artwork coverage does not prove semantic correctness on the real JPEG or desktop display.'},null,2));
 const overlay=`<svg xmlns="http://www.w3.org/2000/svg" width="${f.width*5}" height="${f.height*5}" viewBox="0 0 ${f.width} ${f.height}"><image width="${f.width}" height="${f.height}" href="data:image/png;base64,${png.toString('base64')}"/><g fill="none" stroke="#ff006e" stroke-width=".25">${pieces.map(p=>`<path d="${path(p,c,0)}"/>`).join('')}</g></svg>`;await sharp(Buffer.from(overlay)).png().toFile(resolve(directory,f.name+'-overlay.png'));
 return{pieces,rings,owners,c,directory};
}
const neutral=[237,231,234],yellow=[249,227,60],blue=[15,155,225],pink=[225,130,145];
const triangle=[{x:22.3,y:29.2},{x:148.4,y:78.3},{x:24.2,y:123.7}];
const analyticTurn=(piece:Piece,c:Calibration)=>turns(piece,c,{name:'all',x:0,y:0,w:1000,h:1000}).map(t=>({...t,x:t.x-609}));
it.each([0,.85])('analytic AA yellow triangle with blur $0 retains one acute tip in a multicolor drawing',async blur=>{
 const name='yellow-acute-tip-'+blur,f:AnalyticFixture={name,width:180,height:160,blur,color:p=>p.y<18?blue:Math.hypot(p.x-152,p.y-136)<14?pink:inPolygon(p,triangle)?yellow:neutral};
 const saved=await analyticImport(f),owner=saved.owners({x:62,y:78});expect(owner).toHaveLength(1);const selected=owner[0],rings=saved.rings[selected.i],tip=triangle[1],local=analyticTurn(selected.piece,saved.c).filter(p=>Math.hypot(p.x-tip.x,p.y-tip.y)<6),sharpCorners=local.filter(p=>Math.abs(p.turnDeg)>45);
 const tipError=distance(tip,rings[0]),localBoundaryError=Math.max(0,...rings[0].filter(p=>p.x>110).map(p=>distance(p,triangle))),metrics={oracle:'Known unblurred triangle vertices; six-by-six area antialiasing and optional symmetric Gaussian blur. 1.5 px position allowance is the existing independent analytic-suite quantization allowance. A triangle has one acute corner, rather than two right-angle endcaps.',triangle,tipError,localBoundaryError,local,sharpCorners:sharpCorners.length};writeFileSync(resolve(saved.directory,name+'-metrics.json'),JSON.stringify(metrics,null,2));
 expect.soft(illustration.pigmentFamily(selected.piece.color!)).toBe(2);for(const [probe,family]of[[{x:90,y:8},4],[{x:152,y:136},1]]as const){const owners=saved.owners(probe);expect.soft(owners,'the other independently painted colors remain represented').toHaveLength(1);expect.soft(owners.length?illustration.pigmentFamily(owners[0].piece.color!):undefined).toBe(family);}expect.soft(tipError,JSON.stringify(metrics)).toBeLessThanOrEqual(1.5);expect.soft(localBoundaryError,JSON.stringify(metrics)).toBeLessThanOrEqual(1.5);expect.soft(sharpCorners,JSON.stringify(metrics)).toHaveLength(1);expect.soft(Math.max(0,...local.map(p=>Math.abs(p.turnDeg))),'the true pointed tip remains sharp').toBeGreaterThan(110);
},60000);

it('analytic low-contrast diagonal with one JPEG-style pixel perturbation has no false cusp',async()=>{
 const name='low-contrast-single-pixel',line=(y:number)=>42.3+.42*y,f:AnalyticFixture={name,width:150,height:145,color:p=>p.y>130?blue:p.x<line(p.y)?[247,207,207]:[217,217,217],perturb:{x:72,y:72,rgb:[255,205,190]}};
 const saved=await analyticImport(f),selected=saved.owners({x:30,y:72});expect(selected).toHaveLength(1);const piece=selected[0].piece,ring=saved.rings[selected[0].i][0],local=analyticTurn(piece,saved.c).filter(p=>p.y>53&&p.y<92&&Math.abs(p.x-line(p.y))<6),maxTurn=Math.max(0,...local.map(p=>Math.abs(p.turnDeg))),error=Math.max(0,...ring.filter(p=>p.y>53&&p.y<92&&Math.abs(p.x-line(p.y))<6).map(p=>Math.abs(p.x-line(p.y))/Math.hypot(1,.42))),metrics={oracle:'Analytic straight interface x=42.3+0.42*y; one fixed source pixel changes RGB without changing the intended material boundary. The 20-degree cusp limit is shared with the existing independent contour acceptance suite.',perturb:f.perturb,local,maxTurn,error};writeFileSync(resolve(saved.directory,name+'-metrics.json'),JSON.stringify(metrics,null,2));
 expect.soft(maxTurn,JSON.stringify(metrics)).toBeLessThanOrEqual(20);expect.soft(error,JSON.stringify(metrics)).toBeLessThanOrEqual(1.5);expect.soft(illustration.pigmentFamily(piece.color!)).toBe(1);
},60000);

it('analytic eye preserves separate dark eye, iris, pupil and two white highlights',async()=>{
 const name='eye-with-separated-highlights',ellipse=(p:XY,cx:number,cy:number,rx:number,ry:number)=>((p.x-cx)/rx)**2+((p.y-cy)/ry)**2<1,glints=[{x:82,y:71,r:6},{x:111,y:76,r:5}],dark=[18,19,24],iris=[92,184,208];
 const color=(p:XY)=>glints.some(g=>Math.hypot(p.x-g.x,p.y-g.y)<g.r)?[248,248,248]:ellipse(p,96,83,9,18)?dark:ellipse(p,96,86,29,27)?iris:ellipse(p,92,80,63,40)?dark:neutral;
 const saved=await analyticImport({name,width:184,height:150,color}),probes=[{p:{x:40,y:80},family:6,role:'dark-eye'},{p:{x:96,y:83},family:6,role:'pupil'},{p:{x:80,y:97},family:4,role:'iris'},{p:{x:82,y:71},family:0,role:'left-highlight'},{p:{x:111,y:76},family:0,role:'right-highlight'},{p:{x:92,y:20},family:0,role:'outer-face'}],measured=probes.map(probe=>({...probe,owners:saved.owners(probe.p).map(r=>({i:r.i,family:illustration.pigmentFamily(r.piece.color!)}))}));
 let wrongInterior=0,gaps=0,overlaps=0;for(let y=35.317;y<123;y+=2.7)for(let x=24.731;x<159;x+=2.7){const p={x,y},expected=color(p),expectedFamily=expected===dark?6:expected===iris?4:0;const nearBoundary=Math.abs(Math.hypot((x-92)/63,(y-80)/40)-1)<.07||Math.abs(Math.hypot((x-96)/29,(y-86)/27)-1)<.11||Math.abs(Math.hypot((x-96)/9,(y-83)/18)-1)<.25||glints.some(g=>Math.abs(Math.hypot(x-g.x,y-g.y)-g.r)<2);if(nearBoundary)continue;const owner=saved.owners(p);if(!owner.length)gaps++;if(owner.length>1)overlaps++;if(owner.length===1&&illustration.pigmentFamily(owner[0].piece.color!)!==expectedFamily)wrongInterior++;}
 const highlightBoundaries=glints.map(g=>{const owner=saved.owners(g),ring=owner.length===1?saved.rings[owner[0].i]:[];return{...g,owner:owner.map(r=>r.i),maxBoundaryError:ring.length?Math.max(...ring.flatMap(r=>r.map(p=>Math.abs(Math.hypot(p.x-g.x,p.y-g.y)-g.r)))):null};});const metrics={oracle:'Exact independently specified nested ellipses and disjoint highlight circles. Interior probes skip a 2-3 px analytic uncertainty corridor; direct saved cubic evaluation supplies only the measured candidate geometry.',probes:measured,wrongInterior,gaps,overlaps,highlightBoundaries};writeFileSync(resolve(saved.directory,name+'-metrics.json'),JSON.stringify(metrics,null,2));
 for(const probe of measured)expect.soft(probe.owners,JSON.stringify(probe)).toEqual([{i:probe.owners[0]?.i,family:probe.family}]);expect.soft({wrongInterior,gaps,overlaps},JSON.stringify(metrics)).toEqual({wrongInterior:0,gaps:0,overlaps:0});
 const ids=measured.filter(p=>p.family===0).map(p=>p.owners[0]?.i);expect.soft(new Set(ids).size,'two white highlights stay separate from one another and the outer face').toBe(3);for(const g of highlightBoundaries)expect.soft(g.maxBoundaryError,JSON.stringify(g)).toBeLessThanOrEqual(1.5);
},60000);

const sharedArtwork=[{x:20.2,y:25.4},{x:179.7,y:25.4},{x:164.3,y:48.1},{x:210.4,y:58.3},{x:178.2,y:80.3},{x:222.4,y:95.2},{x:180.2,y:108.1},{x:204.3,y:132.2},{x:140.2,y:118.4},{x:110.3,y:144.2},{x:80.4,y:118.1},{x:35.2,y:135.4},{x:50.4,y:104.2},{x:15.3,y:82.2},{x:55.1,y:61.3}];
function sharedTruth(p:XY){return inPolygon(p,sharedArtwork)?2:p.x>198&&p.y>120?1:p.y<85?4:0;}
function texturedMaterial(p:XY,family:number){
 const base=family===2?yellow:family===4?blue:family===1?pink:neutral;
 // Broad, continuous lighting changes and 8x8 correlated RGB quantization
 // blocks are specified independently of the intended material geometry.
 const plateau=.42*Math.exp(-((p.x-176)**2+(p.y-94)**2)/(2*34**2)),light=.94+.06*Math.cos(p.x/47)*Math.sin(p.y/51),block=((Math.floor(p.x/8)*37+Math.floor(p.y/8)*19)%7-3);
 return base.map((v,k)=>Math.max(0,Math.min(255,(family===2?v*(1-plateau)+neutral[k]*plateau:v)*light+block*[1,-.5,.33][k])));
}
it.each([1.5,2,3])('analytic complete multicolor shared network with plateau/block noise and blur $0',async blur=>{
 const name='shared-network-blur-'+blur,saved=await analyticImport({name,width:240,height:180,blur,color:p=>texturedMaterial(p,sharedTruth(p))}),selected=saved.owners({x:100,y:80});expect(selected).toHaveLength(1);const chosen=selected[0],ring=saved.rings[chosen.i][0],turn=analyticTurn(chosen.piece,saved.c),cornerErrors=sharedArtwork.map(p=>({...p,error:distance(p,ring)})),maxCornerError=Math.max(...cornerErrors.map(p=>p.error)),maxOutputError=Math.max(...ring.map(p=>distance(p,sharedArtwork))),falseTurns=turn.filter(p=>sharedArtwork.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>12)&&Math.abs(p.turnDeg)>20);
 let wrongInterior=0,gaps=0,overlaps=0,probes=0;for(let y=5.317;y<175;y+=3.7)for(let x=5.731;x<235;x+=3.7){const p={x,y};if(distance(p,sharedArtwork)<5||Math.abs(y-85)<5||Math.abs(x-198)<5||Math.abs(y-120)<5)continue;probes++;const owners=saved.owners(p);if(!owners.length)gaps++;if(owners.length>1)overlaps++;if(owners.length===1&&illustration.pigmentFamily(owners[0].piece.color!)!==sharedTruth(p))wrongInterior++;}
 const junctionTruth=[{x:15.3+(50.4-15.3)*(85-82.2)/(104.2-82.2),y:85},{x:178.2+(222.4-178.2)*(85-80.3)/(95.2-80.3),y:85}],junctions=junctionTruth.map(p=>({...p,nearestSavedVertex:Math.min(...saved.pieces.flatMap(piece=>piece.nodes.map(n=>{const q=pixel(n,saved.c,0);return Math.hypot(q.x-p.x,q.y-p.y);}))) }));
 const metrics={oracle:'A fixed 15-corner yellow material crosses an independent blue/white half-plane boundary and touches pink. Full decoded shared network, not isolated triangles. Fixed intended geometry precedes AA, broad illumination/pale shift, 8x8 correlated RGB blocks and Gaussian blur. Blur 3 can remove acute-tip evidence; a failing intended-geometry assertion alone does not prove that this image determines a unique recoverable physical edge.',sharedArtwork,blur,cornerErrors,maxCornerError,maxOutputError,falseTurns,junctions,probes,wrongInterior,gaps,overlaps};writeFileSync(resolve(saved.directory,name+'-metrics.json'),JSON.stringify(metrics,null,2));
 expect.soft(illustration.pigmentFamily(chosen.piece.color!)).toBe(2);expect.soft(maxCornerError,JSON.stringify(metrics)).toBeLessThanOrEqual(1.5);expect.soft(maxOutputError,JSON.stringify(metrics)).toBeLessThanOrEqual(1.5);expect.soft(falseTurns,JSON.stringify(metrics)).toHaveLength(0);expect.soft({wrongInterior,gaps,overlaps},JSON.stringify(metrics)).toEqual({wrongInterior:0,gaps:0,overlaps:0});for(const junction of junctions)expect.soft(junction.nearestSavedVertex,JSON.stringify(junction)).toBeLessThanOrEqual(1.5);
},60000);

it('analytic textured eye keeps fixed dark/iris/highlight material boundaries through diffuse illumination',async()=>{
 const name='eye-textured-materials',ellipse=(p:XY,cx:number,cy:number,rx:number,ry:number)=>((p.x-cx)/rx)**2+((p.y-cy)/ry)**2<1,glints=[{x:82,y:71,r:6},{x:111,y:76,r:5}];
 const truth=(p:XY)=>glints.some(g=>Math.hypot(p.x-g.x,p.y-g.y)<g.r)?0:ellipse(p,96,83,9,18)?6:ellipse(p,96,86,29,27)?4:ellipse(p,92,80,63,40)?6:0;
 const color=(p:XY)=>{const family=truth(p);if(family===0)return neutral;const block=((Math.floor(p.x/7)*17+Math.floor(p.y/7)*11)%5-2),reflection=Math.exp(-((p.x-86)**2/(2*35**2)+(p.y-61)**2/(2*5**2)));if(family===6)return[18+66*reflection+block,19+46*reflection+block,24+60*reflection+block];const light=.88+.12*Math.sin(p.y/11),hue=5*Math.sin(p.x/17);return[92*light+hue,184*light-hue,208*light];};
 const saved=await analyticImport({name,width:184,height:150,blur:.6,color}),probes=[{p:{x:82,y:71},role:'left-highlight'},{p:{x:111,y:76},role:'right-highlight'},{p:{x:92,y:20},role:'outer-face'},{p:{x:72,y:61},role:'diffuse-reflection-on-dark-eye'},{p:{x:60,y:60},role:'dark-eye-interior'},{p:{x:80,y:97},role:'textured-iris'},{p:{x:96,y:83},role:'pupil'}].map(v=>({...v,family:truth(v.p),owners:saved.owners(v.p).map(r=>({i:r.i,family:illustration.pigmentFamily(r.piece.color!)}))}));
 const highlightBoundaries=glints.map(g=>{const owners=saved.owners(g),rings=owners.length===1?saved.rings[owners[0].i]:[];return{...g,owners:owners.map(r=>r.i),maxBoundaryError:rings.length?Math.max(...rings.flatMap(r=>r.map(p=>Math.abs(Math.hypot(p.x-g.x,p.y-g.y)-g.r)))):null};});
 const metrics={oracle:'Fixed nested ellipses and white circles; dark material has a smooth Gaussian luminance/chroma reflection and correlated 7x7 RGB blocks, iris has smooth independent luminance and hue changes. These illumination changes do not introduce intended material boundaries.',probes,highlightBoundaries};writeFileSync(resolve(saved.directory,name+'-metrics.json'),JSON.stringify(metrics,null,2));for(const p of probes)expect.soft(p.owners,JSON.stringify(p)).toEqual([{i:p.owners[0]?.i,family:p.family}]);for(const g of highlightBoundaries)expect.soft(g.maxBoundaryError,JSON.stringify(g)).toBeLessThanOrEqual(1.5);expect.soft(new Set(probes.slice(0,3).map(p=>p.owners[0]?.i)).size,'the highlights and outer face remain distinct white components').toBe(3);
},60000);
