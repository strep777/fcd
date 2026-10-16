import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import sharp from 'sharp';
import {afterAll,expect,it,vi} from 'vitest';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import * as shared from '../../packages/reference/shared-contour';
import {safeContour} from '../../packages/reference/contour-topology';
import {pigmentFamily} from '../../packages/reference/illustration';
import {rectangle} from '../fixtures';
import type {Piece,Point,Reference} from '../../packages/schema/index';

type XY={x:number;y:number};
type Fixture={name:string;kind:'round'|'straight';rings:XY[][];fill:(p:XY)=>boolean;seed:XY;area:number;color:number[];corners?:XY[]};
const width=32,height=32,aa=8,cx=16.21,cy=15.73,records:unknown[]=[];
const distance=(p:XY,a:XY,b:XY)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
function inside(p:XY,ring:XY[]){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;}
const owns=(p:XY,rings:XY[][])=>inside(p,rings[0])&&!rings.slice(1).some(r=>inside(p,r));
const nearest=(p:XY,rings:XY[][])=>{let best=Infinity;for(const r of rings)for(let i=0;i<r.length;i++)best=Math.min(best,distance(p,r[i],r[(i+1)%r.length]));return best;};
const area=(r:XY[])=>Math.abs(r.reduce((sum,a,i)=>{const b=r[(i+1)%r.length];return sum+a.x*b.y-a.y*b.x;},0)/2);
function densify(r:XY[]){return r.flatMap((a,i)=>{const b=r[(i+1)%r.length],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.04));return Array.from({length:n},(_,j)=>({x:a.x+(b.x-a.x)*j/n,y:a.y+(b.y-a.y)*j/n}));});}
const roundFixtures:Fixture[]=[2.5,3.5,5].flatMap(radius=>['circle','ellipse'].map(shape=>{
 const rx=radius,ry=radius*(shape==='circle'?1:.7),ring=Array.from({length:2048},(_,i)=>({x:cx+rx*Math.cos(i*Math.PI/1024),y:cy+ry*Math.sin(i*Math.PI/1024)}));
 return{name:`${shape} radius ${radius}`,kind:'round' as const,rings:[ring],fill:(p:XY)=>((p.x-cx)/rx)**2+((p.y-cy)/ry)**2<1,seed:{x:cx,y:cy},area:Math.PI*rx*ry,color:shape==='circle'?[255,255,255]:[255,238,90]};
}));
const polygonFixture=(name:string,corners:XY[],seed:XY):Fixture=>({name,kind:'straight',rings:[corners],fill:p=>inside(p,corners),seed,area:area(corners),color:[255,255,255],corners});
const fixtures=[...roundFixtures,
 polygonFixture('small painted square',[{x:13.25,y:12.75},{x:19.25,y:12.75},{x:19.25,y:18.75},{x:13.25,y:18.75}],{x:16.25,y:15.75}),
 polygonFixture('acute painted triangle',[{x:16.25,y:9.25},{x:20.25,y:22.25},{x:12.25,y:22.25}],{x:16.25,y:17.25}),
 polygonFixture('thin white stripe',[{x:7.25,y:15.25},{x:24.25,y:15.25},{x:24.25,y:16.75},{x:7.25,y:16.75}],{x:16,y:16})
];

// Truth is specified before RGB rasterization. Neither classifier masks nor
// fitted proposals supply the physical boundary or area oracle.
async function extract(f:Fixture,excludeBackground:boolean,scale:number){
 const rgba=new Uint8Array(width*height*4),coverage=new Float64Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let n=0;for(let sy=0;sy<aa;sy++)for(let sx=0;sx<aa;sx++)n+=+f.fill({x:x+(sx+.5)/aa,y:y+(sy+.5)/aa});
  const i=y*width+x;coverage[i]=n/(aa*aa);rgba.set([...f.color.map(v=>Math.round(v*coverage[i])),255],i*4);
 }
 const png=await sharp(rgba,{raw:{width,height,channels:4}}).png().toBuffer(),calibration={a:{x:0,y:height},b:{x:0,y:0},distanceMm:height*scale};
 const references:Reference[]=(['front','back']as const).map(view=>({id:randomUUID(),name:view,view,width,height,png:'data:image/png;base64,'+png.toString('base64'),calibration,calibrationMode:'manual',resources:{} as Reference['resources']}));
 const raws:Piece[][]=[],reports:unknown[]=[],actual=shared.recoverSharedContours,spy=vi.spyOn(shared,'recoverSharedContours').mockImplementation((...args)=>{raws.push(structuredClone(args[0]));const result=actual(...args);reports.push(result.report);return result;});
 let output:ReturnType<typeof splitReferences>;try{output=splitReferences(references,height*scale,6,excludeBackground);}finally{spy.mockRestore();}
 const pixel=(p:Pick<Point,'xMm'|'yMm'>):XY=>({x:p.xMm/scale,y:height-p.yMm/scale});
 function sample(piece:Piece,ring=piece.nodes):XY[]{return ring.flatMap((a,i)=>{
  const b=ring[(i+1)%ring.length],c=piece.curves?.find(v=>v.startNodeId===a.id&&v.endNodeId===b.id),p=pixel(a),q=pixel(b),u=c?pixel(c.c1):p,v=c?pixel(c.c2):q,n=Math.max(1,Math.ceil((Math.hypot(u.x-p.x,u.y-p.y)+Math.hypot(v.x-u.x,v.y-u.y)+Math.hypot(q.x-v.x,q.y-v.y))/.025));
  return Array.from({length:n},(_,j)=>{const t=j/n,s=1-t;return{x:s**3*p.x+3*s*s*t*u.x+3*s*t*t*v.x+t**3*q.x,y:s**3*p.y+3*s*s*t*u.y+3*s*t*t*v.y+t**3*q.y};});
 });}
 const pieces=output.regions.filter(r=>r.view==='front').map(r=>r.piece),rings=pieces.map(p=>[p.nodes,...p.holes??[]].map(r=>sample(p,r))),selected=pieces.map((piece,i)=>({piece,index:i,rings:rings[i]})).filter(p=>owns(f.seed,p.rings));
 expect(selected,'one saved bright material must retain the prescribed source core').toHaveLength(1);
 const chosen=selected[0],raw=raws[0][chosen.index],turns=chosen.piece.nodes.map((p,i)=>{
  const q=pixel(p),a=pixel(chosen.piece.curves?.find(c=>c.endNodeId===p.id)?.c2??chosen.piece.nodes[(i+chosen.piece.nodes.length-1)%chosen.piece.nodes.length]),b=pixel(chosen.piece.curves?.find(c=>c.startNodeId===p.id)?.c1??chosen.piece.nodes[(i+1)%chosen.piece.nodes.length]);
  return{...q,radians:Math.abs(Math.atan2((q.x-a.x)*(b.y-q.y)-(q.y-a.y)*(b.x-q.x),(q.x-a.x)*(b.x-q.x)+(q.y-a.y)*(b.y-q.y)))};
 });
 return{...chosen,raw,rawArea:area(raw.nodes.map(pixel)),all:rings,pieces,pixel,sample,turns,reports,coverage,rgba};
}

it.each(fixtures.flatMap(f=>[false,true].map(excludeBackground=>({f,excludeBackground,name:f.name}))))('$name keeps its independent bright source boundary (remove backdrop $excludeBackground)',async({f,excludeBackground})=>{
 let reference:XY[][]|undefined;
 for(const scale of [1,.05,10]){
  const saved=await extract(f,excludeBackground,scale),truth=f.rings.map(densify),errors=saved.rings.flatMap(r=>r.map(p=>nearest(p,truth))).sort((a,b)=>a-b),forward=errors.at(-1)!,reverse=Math.max(...truth.flatMap(r=>r.map(p=>nearest(p,saved.rings)))),p95=errors[Math.floor(errors.length*.95)],savedArea=area(saved.rings[0]);
  let missingBright=0,swallowedBlack=0,overlaps=0,gaps=0;
  // Pixel centres with complete 8x8 source coverage are independently known
  // bright/black. An additional one-pixel geometric margin excludes the AA
  // transition from ownership claims, without borrowing classifier labels.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const p={x:x+.5,y:y+.5},i=y*width+x,owners=saved.all.filter(r=>owns(p,r)).length;
   if(owners>1)overlaps++;if(!excludeBackground&&owners===0)gaps++;
   if(nearest(p,truth)>1&&saved.coverage[i]===1&&!owns(p,saved.rings))missingBright++;
   if(nearest(p,truth)>1&&saved.coverage[i]===0&&owns(p,saved.rings))swallowedBlack++;
  }
  const calibrationDrift=reference?Math.max(...saved.rings[0].map(p=>nearest(p,reference!)),...reference[0].map(p=>nearest(p,saved.rings))):0;
  const metrics={name:f.name,excludeBackground,scale,sourceArea:f.area,coverageArea:saved.coverage.reduce((s,v)=>s+v,0),rawArea:saved.rawArea,savedArea,forward,reverse,p95,maxTurn:Math.max(...saved.turns.map(p=>p.radians)),calibrationDrift,missingBright,swallowedBlack,overlaps,gaps,nodes:saved.piece.nodes.length,curves:saved.piece.curves?.length??0,holes:saved.piece.holes?.length??0,reports:saved.reports};records.push(metrics);
  const message=JSON.stringify(metrics);
  expect.soft({missingBright,swallowedBlack,overlaps,gaps},message).toEqual({missingBright:0,swallowedBlack:0,overlaps:0,gaps:0});
  expect.soft(pigmentFamily(saved.piece.color!),message).toBe(f.color[2]===255?0:2);
  expect.soft(saved.pieces,message).toHaveLength(excludeBackground?1:2);
  if(!excludeBackground){const dark=saved.pieces.filter(p=>pigmentFamily(p.color!)===6);expect.soft(dark,message).toHaveLength(1);if(dark.length===1)expect.soft(dark[0].holes??[],message).toHaveLength(1);}
  expect.soft(saved.piece.holes??[],message).toHaveLength(0);
  expect.soft(calibrationDrift,message).toBeLessThanOrEqual(.02);
  expect.soft(forward,message).toBeLessThanOrEqual(f.kind==='round'?1.05:1.5);expect.soft(reverse,message).toBeLessThanOrEqual(f.kind==='round'?1.05:1.5);
  // A half-pixel tube around independently prescribed source geometry bounds
  // quantized area uncertainty. This is not the raw mask's 3% area contract.
  const sourcePerimeter=truth[0].reduce((s,p,i)=>s+Math.hypot(p.x-truth[0][(i+1)%truth[0].length].x,p.y-truth[0][(i+1)%truth[0].length].y),0);
  expect.soft(Math.abs(savedArea-f.area),message).toBeLessThanOrEqual(sourcePerimeter*.5+Math.PI*.25);
  if(f.kind==='round'){
   expect.soft(p95,message).toBeLessThanOrEqual(.55);
   // A shared black-hole boundary is deliberately represented by polygon
   // samples: its chord-to-chord turn includes actual source curvature.
   // Only the isolated editable cubic loop has smooth-join semantics.
   if(excludeBackground){expect.soft(saved.piece.curves?.length??0,message).toBeGreaterThan(0);expect.soft(Math.max(...saved.turns.map(p=>p.radians)),message).toBeLessThanOrEqual(Math.PI/9);}
  }else{
   for(const corner of f.corners!){expect.soft(nearest(corner,saved.rings),message).toBeLessThanOrEqual(1.5);expect.soft(Math.max(0,...saved.turns.filter(p=>Math.hypot(p.x-corner.x,p.y-corner.y)<=1.5).map(p=>p.radians)),message).toBeGreaterThanOrEqual(.35);}
   for(const c of saved.piece.curves??[]){const a=saved.pixel(saved.piece.nodes.find(n=>n.id===c.startNodeId)!),b=saved.pixel(saved.piece.nodes.find(n=>n.id===c.endNodeId)!);for(const h of[c.c1,c.c2])expect.soft(distance(saved.pixel(h),a,b),'a prescribed straight painted span must not acquire bowed handles').toBeLessThanOrEqual(1e-6);}
  }
  reference??=saved.rings;
 }
},60000);

it('retains the default three-argument 3% area contract without source evidence',()=>{
 const original={...rectangle(),nodes:[[0,0],[10,0],[10,10],[0,10]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm})),curves:[],holes:[]},expand=(x:number)=>({...original,nodes:original.nodes.map(p=>({...p,xMm:p.xMm===10?x:p.xMm}))});
 expect(safeContour(expand(10.2),original,.8)).toBe(true);expect(safeContour(expand(10.4),original,.8)).toBe(false);
 const raster=shared.recoverSharedContours([original],.8,randomUUID);expect(safeContour(raster.pieces[0],original,.8)).toBe(true);
});

type NegativeFixture=Fixture&{seeds:XY[];blackProbes:XY[];smallDot?:{center:XY;radius:number};expectedBrightRegions?:number};
const negativeRecords:unknown[]=[];
const analyticCircle=(center:XY,radius:number)=>Array.from({length:1024},(_,i)=>({x:center.x+radius*Math.cos(i*Math.PI/512),y:center.y+radius*Math.sin(i*Math.PI/512)}));
const arrow=polygonFixture('acute concave arrow',[{x:16.25,y:6.25},{x:23.25,y:22.25},{x:16.25,y:19.25},{x:9.25,y:22.25}],{x:16.25,y:14.25});
const notch=polygonFixture('nonround paint with a deep two-pixel exterior notch',[{x:7.25,y:7.25},{x:24.25,y:7.25},{x:24.25,y:13.25},{x:12.25,y:13.25},{x:12.25,y:15.25},{x:24.25,y:15.25},{x:24.25,y:24.25},{x:7.25,y:24.25}],{x:10.25,y:16.25});
const glintCenters=[{x:12.25,y:15.75},{x:21.25,y:15.75}],glintRadius=3.5;
const speckMain={x:12.21,y:15.73},speckCenter={x:25.5,y:6.5},speckRadius=.35;
const negativeFixtures:NegativeFixture[]=[
 {...arrow,seeds:[arrow.seed],blackProbes:[{x:16.25,y:21.25},{x:8.25,y:21.25},{x:24.25,y:21.25}],expectedBrightRegions:1},
 {...notch,seeds:[notch.seed,{x:20.25,y:10.25},{x:20.25,y:20.25}],blackProbes:[13.25,16.25,20.25,23.25].map(x=>({x,y:14.25})),expectedBrightRegions:1},
 {name:'two nearby glints retain the real black gap',kind:'round',rings:glintCenters.map(c=>analyticCircle(c,glintRadius)),fill:p=>glintCenters.some(c=>Math.hypot(p.x-c.x,p.y-c.y)<glintRadius),seed:glintCenters[0],seeds:glintCenters,area:2*Math.PI*glintRadius**2,color:[255,255,255],blackProbes:[16.25,16.75,17.25].map(x=>({x,y:15.75})),expectedBrightRegions:2},
 {name:'a background white speck cannot expand or join the main glint',kind:'round',rings:[analyticCircle(speckMain,4.5),analyticCircle(speckCenter,speckRadius)],fill:p=>Math.hypot(p.x-speckMain.x,p.y-speckMain.y)<4.5||Math.hypot(p.x-speckCenter.x,p.y-speckCenter.y)<speckRadius,seed:speckMain,seeds:[speckMain],area:Math.PI*(4.5**2+speckRadius**2),color:[255,255,255],blackProbes:[{x:20,y:10},{x:24,y:6.5},{x:27,y:6.5},{x:25.5,y:8}],smallDot:{center:speckCenter,radius:speckRadius}}
];

it.each(negativeFixtures.flatMap(f=>[.05,1,10].map(scale=>({f,scale,name:f.name}))))('$name preserves prescribed material topology at scale $scale',async({f,scale})=>{
 const saved=await extract(f,false,scale),bright=saved.pieces.map((piece,i)=>({piece,rings:saved.all[i]})).filter(p=>pigmentFamily(p.piece.color!)===0),truth=f.rings.map(densify),seedOwners=f.seeds.map(seed=>bright.flatMap((p,i)=>owns(seed,p.rings)?[i]:[]));
 const swallowedBlack=f.blackProbes.filter(p=>bright.some(b=>owns(p,b.rings))),forward=Math.max(0,...bright.flatMap(b=>b.rings.flatMap(r=>r.map(p=>nearest(p,truth))))),reverse=Math.max(...truth[0].map(p=>nearest(p,bright.flatMap(b=>b.rings))));
 let gaps=0,overlaps=0,missingCore=0,expandedPaint=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p={x:x+.5,y:y+.5},i=y*width+x,owners=saved.all.filter(r=>owns(p,r)).length;
  if(!owners)gaps++;if(owners>1)overlaps++;
  if(nearest(p,truth)>1&&saved.coverage[i]===1&&!bright.some(b=>owns(p,b.rings)))missingCore++;
  if(nearest(p,truth)>1&&saved.coverage[i]===0&&bright.some(b=>owns(p,b.rings)))expandedPaint++;
 }
 const dotOwners=f.smallDot?bright.filter(b=>owns(f.smallDot!.center,b.rings)):[],dotAreas=dotOwners.map(b=>area(b.rings[0]));
 const metrics={name:f.name,kind:'source negative',scale,sourceArea:f.area,brightRegions:bright.length,seedOwners,blackProbes:f.blackProbes,swallowedBlack,forward,reverse,gaps,overlaps,missingCore,expandedPaint,dotAreas,nodes:bright.map(b=>b.piece.nodes.length),curves:bright.map(b=>b.piece.curves?.length??0),reports:saved.reports};negativeRecords.push(metrics);const message=JSON.stringify(metrics);
 expect.soft({gaps,overlaps,missingCore,expandedPaint},message).toEqual({gaps:0,overlaps:0,missingCore:0,expandedPaint:0});
 expect.soft(swallowedBlack,message).toHaveLength(0);expect.soft(forward,message).toBeLessThanOrEqual(1.5);expect.soft(reverse,message).toBeLessThanOrEqual(1.5);
 if(f.expectedBrightRegions!==undefined)expect.soft(bright,message).toHaveLength(f.expectedBrightRegions);
 for(const owners of seedOwners)expect.soft(owners,message).toHaveLength(1);
 if(f.name.startsWith('two nearby'))expect.soft(new Set(seedOwners.flat()).size,'independent bright source cores must have distinct saved owners').toBe(2);
 for(const b of bright)expect.soft(b.piece.holes??[],message).toHaveLength(0);
 for(const corner of f.corners??[]){
  expect.soft(nearest(corner,saved.rings),'source apex or concave notch corner must remain within its independent 1.5px raster budget').toBeLessThanOrEqual(1.5);
  expect.soft(Math.max(0,...saved.turns.filter(p=>Math.hypot(p.x-corner.x,p.y-corner.y)<=1.5).map(p=>p.radians)),message).toBeGreaterThanOrEqual(.35);
 }
 // Straight-sided negative controls retain their actual cusps. They do not
 // inherit the smooth-loop 20-degree join criterion.
 if(f.corners)for(const c of saved.piece.curves??[]){const a=saved.pixel(saved.piece.nodes.find(n=>n.id===c.startNodeId)!),b=saved.pixel(saved.piece.nodes.find(n=>n.id===c.endNodeId)!);for(const h of[c.c1,c.c2])expect.soft(distance(saved.pixel(h),a,b),'straight source edges cannot become bowed cubics').toBeLessThanOrEqual(1e-6);}
 if(f.smallDot){
  // The AA speck has no fully lit pixel: existing noise policy may discard
  // it or retain it separately. Neither outcome authorizes joining it to the
  // main highlight or expanding beyond its independent half-pixel area tube.
  expect.soft(dotOwners.length,message).toBeLessThanOrEqual(1);
  for(const b of dotOwners){expect.soft(owns(f.seed,b.rings),message).toBe(false);expect.soft(area(b.rings[0]),message).toBeLessThanOrEqual(Math.PI*(f.smallDot.radius+.5)**2);}
 }
},60000);

afterAll(()=>{const dir='test-results/contour-repair/test-review';mkdirSync(dir,{recursive:true});if(records.length)writeFileSync(dir+'/small-bright-source-metrics.json',JSON.stringify({oracle:'Independent 8x8 area-coverage RGB over black; prescribed analytic/polygon geometry and direct cubic samples <=.025px. Full dual-reference splitReferences. Rounded budgets inherit independent image-contour p95 .55px / max1.05px; 20deg/cubic check is limited to isolated editable loops, shared-hole polygon turns are diagnostic. Corner budget1.5px, native scale comparison .02px. Source area tube is independent of the production raster 3% contract.',records},null,2));if(negativeRecords.length)writeFileSync(dir+'/small-bright-source-negative-metrics.json',JSON.stringify({oracle:'Independent source polygons and disjoint 8x8 AA white components. Prescribed acute/concave corners, black notch/gap probes, distinct bright owners and no foreground invention. The subpixel speck may be filtered or retained separately but cannot expand or join the main highlight. No smooth-loop angle requirement is applied to these controls.',records:negativeRecords},null,2));});
