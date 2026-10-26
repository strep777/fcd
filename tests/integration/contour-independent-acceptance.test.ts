import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {afterAll,expect,it,vi} from 'vitest';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import * as shared from '../../packages/reference/shared-contour';
import type {Calibration,Piece,Point,Reference} from '../../packages/schema/index';

type XY={x:number;y:number};
type Fixture={name:string;width:number;height:number;rings:XY[][];seed:XY;aa:number;weak?:boolean;faint?:boolean;noise?:number;straight?:boolean;corners?:XY[];smooth?:(p:XY)=>boolean;holes?:number;fill?:(p:XY)=>boolean};
const records:unknown[]=[];
const distance=(p:XY,a:XY,b:XY)=>{const x=b.x-a.x,y=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/(x*x+y*y||1)));return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);};
function inside(p:XY,ring:XY[]){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
const material=(p:XY,rings:XY[][])=>inside(p,rings[0])&&!rings.slice(1).some(r=>inside(p,r));
const nearest=(p:XY,rings:XY[][])=>{let best=Infinity;for(const ring of rings)for(let i=0;i<ring.length;i++)best=Math.min(best,distance(p,ring[i],ring[(i+1)%ring.length]));return best;};
const area=(r:XY[])=>r.reduce((sum,p,i)=>{const q=r[(i+1)%r.length];return sum+p.x*q.y-q.x*p.y;},0)/2;
const netArea=(rings:XY[][])=>rings.reduce((sum,r,i)=>sum+(i?-1:1)*Math.abs(area(r)),0);
function densify(r:XY[],spacing=.3){return r.flatMap((a,i)=>{const b=r[(i+1)%r.length],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/spacing));return Array.from({length:n},(_,j)=>({x:a.x+(b.x-a.x)*j/n,y:a.y+(b.y-a.y)*j/n}));});}
const circle=(cx:number,cy:number,r:number)=>Array.from({length:1000},(_,i)=>({x:cx+r*Math.cos(2*Math.PI*i/1000),y:cy+r*Math.sin(2*Math.PI*i/1000)}));
const oblique=[{x:19.3,y:28.6},{x:136.7,y:49.9},{x:124.1,y:119.4},{x:6.7,y:98.1}];
const fork=[{x:15.3,y:126.2},{x:43.2,y:17.4},{x:72.3,y:72.6},{x:106.7,y:18.2},{x:143.1,y:126.2},{x:112.1,y:126.2},{x:112.1,y:116.2},{x:108.1,y:116.2},{x:108.1,y:126.2}];
const wave=(y:number)=>72.3+.12*y+13.2*Math.sin(y/27.4);
const wavy=[{x:0,y:0},...Array.from({length:901},(_,i)=>({x:wave(i*.2),y:i*.2})),{x:0,y:180}];
const fixtures:Fixture[]=[
 {name:'hard oblique four-sided paint',width:160,height:150,rings:[oblique],seed:{x:70,y:70},aa:1,straight:true,corners:oblique},
 {name:'antialiased oblique four-sided paint',width:160,height:150,rings:[oblique],seed:{x:70,y:70},aa:8,straight:true,corners:oblique},
 {name:'weak pink curved interface',width:180,height:180,rings:[wavy],seed:{x:25,y:90},aa:8,weak:true,fill:p=>p.x<wave(p.y),smooth:p=>p.x>50&&p.y>12&&p.y<168},
 {name:'weak pink curved interface with measured RGB texture',width:180,height:180,rings:[wavy],seed:{x:25,y:90},aa:8,weak:true,noise:1,fill:p=>p.x<wave(p.y),smooth:p=>p.x>50&&p.y>12&&p.y<168},
 {name:'faint pink material remains distinguishable from neutral fabric',width:180,height:180,rings:[wavy],seed:{x:25,y:90},aa:8,weak:true,faint:true,fill:p=>p.x<wave(p.y),smooth:p=>p.x>50&&p.y>12&&p.y<168},
 {name:'acute fork with a real four-pixel square notch',width:160,height:150,rings:[fork],seed:{x:80,y:100},aa:8,corners:fork,holes:0},
 {name:'sharp square hole and broader curved boundary',width:160,height:150,rings:[circle(80.3,75.1,59.4),[{x:77,y:73},{x:81,y:73},{x:81,y:77},{x:77,y:77}]],seed:{x:50,y:75},aa:1,holes:1,fill:p=>Math.hypot(p.x-80.3,p.y-75.1)<59.4&&!(p.x>=77&&p.x<81&&p.y>=73&&p.y<77),smooth:p=>Math.hypot(p.x-80.3,p.y-75.1)>50},
 {name:'two separate measured holes',width:180,height:180,rings:[circle(90.2,89.7,73.1),circle(66.1,87.4,13.7),circle(112.3,91.2,16.3)],seed:{x:90,y:45},aa:8,holes:2,fill:p=>Math.hypot(p.x-90.2,p.y-89.7)<73.1&&Math.hypot(p.x-66.1,p.y-87.4)>=13.7&&Math.hypot(p.x-112.3,p.y-91.2)>=16.3,smooth:p=>Math.hypot(p.x-90.2,p.y-89.7)>65},
];
// These are source-image rotations, not a calibration transform: each angle
// creates a different staircase and each phase changes its quantized endcaps.
const hardStraightMatrix:Fixture[]=[2,5,85,-5].flatMap(degrees=>[.17,.73].map(phase=>{
 const angle=degrees*Math.PI/180,co=Math.cos(angle),si=Math.sin(angle),center={x:110+phase,y:110+phase};
 const corners=[[-77,-27],[77,-27],[77,27],[-77,27]].map(([x,y])=>({x:center.x+x*co-y*si,y:center.y+x*si+y*co}));
 return{name:`hard straight ${degrees} degrees phase ${phase}`,width:220,height:220,rings:[corners],seed:center,aa:1,straight:true,corners};
}));

// This suite enters through the same dual-image decoder, pigment ownership,
// shared boundary recovery and calibrated output as the default application.
// Expected geometry is specified before rasterization. No production distance,
// flattening, topology check, mask or fitted proposal supplies the oracle.
async function extract(f:Fixture,scale=1,rotation=0,jpegQuality?:number){
 const colors=f.faint?[[217,217,217],[247,207,207]]:f.weak?[[210,210,210],[250,190,190]]:[[237,231,234],[249,227,60]],rgba=new Uint8Array(f.width*f.height*4);
 let state=0x5eed1234;const noise=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state/2**32*2-1)*(f.noise??0);};
 for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){
  let coverage=0;for(let j=0;j<f.aa;j++)for(let i=0;i<f.aa;i++)coverage+=+(f.fill??(p=>material(p,f.rings)))({x:x+(i+.5)/f.aa,y:y+(j+.5)/f.aa})/(f.aa*f.aa);
  rgba.set([...colors[0].map((v,c)=>Math.round(v+(colors[1][c]-v)*coverage+noise())),255],(y*f.width+x)*4);
 }
 const raster=sharp(rgba,{raw:{width:f.width,height:f.height,channels:4}}),encoded=jpegQuality?await raster.jpeg({quality:jpegQuality,chromaSubsampling:'4:2:0'}).toBuffer():await raster.png().toBuffer();
 const decoded=await sharp(encoded).metadata();expect(decoded.format).toBe(jpegQuality?'jpeg':'png');
 // Imported JPEGs enter reference extraction as decoded PNG resources. Keep
 // the lossy JPEG round trip, then use that same normalized decoder boundary.
 const png=jpegQuality?await sharp(encoded).png().toBuffer():encoded;
 let jpeg:undefined|{quality:number;chromaSubsampling:string;sha256:string;bytes:number;jpegPath:string;decodedPngPath:string;seedRgb:number[];backgroundRgb:number[]};
 if(jpegQuality){
  const directory=resolve('test-results/2026-10-25-pattern-quality/jpeg-analytic-inputs');mkdirSync(directory,{recursive:true});const basename=`quality-${jpegQuality}-`+f.name.replace(/[^a-z0-9]+/gi,'-').toLowerCase(),jpegPath=resolve(directory,basename+'.jpg'),decodedPngPath=resolve(directory,basename+'-decoded.png');writeFileSync(jpegPath,encoded);writeFileSync(decodedPngPath,png);
  const raw=await sharp(png).removeAlpha().raw().toBuffer(),at=(x:number,y:number)=>[...raw.subarray((Math.floor(y)*f.width+Math.floor(x))*3,(Math.floor(y)*f.width+Math.floor(x))*3+3)];
  jpeg={quality:jpegQuality,chromaSubsampling:'4:2:0',sha256:createHash('sha256').update(encoded).digest('hex'),bytes:encoded.length,jpegPath,decodedPngPath,seedRgb:at(f.seed.x,f.seed.y),backgroundRgb:at(f.width-10,f.height/2)};
 }
 const c:Calibration={a:{x:11,y:f.height-7},b:{x:11+f.height*Math.sin(rotation),y:f.height-7-f.height*Math.cos(rotation)},distanceMm:f.height*scale};
 const references:Reference[]=(['front','back']as const).map(view=>({id:randomUUID(),name:view,view,width:f.width,height:f.height,png:'data:image/png;base64,'+png.toString('base64'),calibration:c,calibrationMode:'manual',resources:{} as Reference['resources']}));
 const reports:ReturnType<typeof shared.recoverSharedContours>['report'][]=[];
 const recover=shared.recoverSharedContours,spy=vi.spyOn(shared,'recoverSharedContours').mockImplementation((...args)=>{const result=recover(...args);reports.push(result.report);return result;});
 let output:ReturnType<typeof splitReferences>;try{output=splitReferences(references,f.height*scale,6,false,'simple','head');}finally{spy.mockRestore();}
 const pixel=(p:Pick<Point,'xMm'|'yMm'>):XY=>{const dx=c.b.x-c.a.x,dy=c.b.y-c.a.y;return{x:c.a.x+(-dy*p.xMm+dx*p.yMm)/c.distanceMm,y:c.a.y+(dx*p.xMm+dy*p.yMm)/c.distanceMm};};
 function sample(piece:Piece,ring=piece.nodes){return ring.flatMap((a,i)=>{
  const b=ring[(i+1)%ring.length],curve=piece.curves?.find(q=>q.startNodeId===a.id&&q.endNodeId===b.id),p=pixel(a),q=pixel(b),u=curve?pixel(curve.c1):p,v=curve?pixel(curve.c2):q;
  const count=Math.max(1,Math.ceil((Math.hypot(u.x-p.x,u.y-p.y)+Math.hypot(v.x-u.x,v.y-u.y)+Math.hypot(q.x-v.x,q.y-v.y))/.25));
  return Array.from({length:count},(_,j)=>{const t=j/count,s=1-t;return{x:s**3*p.x+3*s*s*t*u.x+3*s*t*t*v.x+t**3*q.x,y:s**3*p.y+3*s*s*t*u.y+3*s*t*t*v.y+t**3*q.y};});
 });}
 const pieces=output.regions.filter(r=>r.view==='front').map(r=>r.piece),rings=pieces.map(p=>[p.nodes,...p.holes??[]].map(r=>sample(p,r))),selected=pieces.map((piece,i)=>({piece,rings:rings[i]})).filter(p=>material(f.seed,p.rings));
 expect(selected,'exactly one saved material must contain the independently chosen pigment seed').toHaveLength(1);
 return{...selected[0],all:rings,pixel,sample,reports,jpeg};
}
function tangentTurns(piece:Piece,pixel:(p:Point)=>XY){return piece.nodes.map((n,i)=>{
 const p=pixel(n),a=pixel(piece.curves?.find(c=>c.endNodeId===n.id)?.c2??piece.nodes[(i+piece.nodes.length-1)%piece.nodes.length]),b=pixel(piece.curves?.find(c=>c.startNodeId===n.id)?.c1??piece.nodes[(i+1)%piece.nodes.length]);
 return{...p,radians:Math.abs(Math.atan2((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x),(p.x-a.x)*(b.x-p.x)+(p.y-a.y)*(b.y-p.y)))};
});}
async function assertAnalytic(f:Fixture,jpegQuality?:number){
 const saved=await extract(f,1,0,jpegQuality),truth=f.rings.map(r=>densify(r)),forward=Math.max(...saved.rings.flatMap(r=>r.map(p=>nearest(p,f.rings)))),reverse=Math.max(...truth.flatMap(r=>r.map(p=>nearest(p,saved.rings))));
 const turns=tangentTurns(saved.piece,saved.pixel),smoothTurns=f.smooth?turns.filter(f.smooth):[],relativeArea=Math.abs(netArea(saved.rings)-netArea(f.rings))/netArea(f.rings);
 let wrongInterior=0,gaps=0,overlaps=0;
 // Deliberately off-grid probes test the saved material partition; points
 // inside the 1.5px quantization envelope do not claim a unique raster owner.
 for(let y=.317;y<f.height;y+=2.7)for(let x=.731;x<f.width;x+=2.7){const p={x,y},owners=saved.all.filter(r=>material(p,r)).length;if(!owners)gaps++;if(owners>1)overlaps++;if(nearest(p,f.rings)>1.5&&material(p,saved.rings)!==material(p,f.rings))wrongInterior++;}
 const metrics={name:f.name,jpeg:saved.jpeg,forward,reverse,relativeArea,wrongInterior,gaps,overlaps,holes:saved.piece.holes?.length??0,nodes:saved.piece.nodes.length,curves:saved.piece.curves?.length??0,smoothTurns:smoothTurns.slice().sort((a,b)=>b.radians-a.radians).slice(0,6),recovery:saved.reports};records.push(metrics);
 expect.soft(forward,JSON.stringify(metrics)).toBeLessThanOrEqual(1.5);expect.soft(reverse,JSON.stringify(metrics)).toBeLessThanOrEqual(1.5);
 expect.soft(relativeArea,JSON.stringify(metrics)).toBeLessThanOrEqual(.04);
 expect.soft({wrongInterior,gaps,overlaps},JSON.stringify(metrics)).toEqual({wrongInterior:0,gaps:0,overlaps:0});
 expect.soft(saved.piece.holes?.length??0,JSON.stringify(metrics)).toBe(f.holes??0);
 for(const hole of saved.rings.slice(1)){expect.soft(Math.sign(area(hole)),'hole winding is opposite to exterior').toBe(-Math.sign(area(saved.rings[0])));expect.soft(hole.every(p=>inside(p,saved.rings[0])),'every hole stays contained').toBe(true);}
 if(f.straight){
  const local=turns.filter(p=>f.corners!.every(c=>Math.hypot(p.x-c.x,p.y-c.y)>4));
  expect.soft(Math.max(0,...local.map(p=>p.radians)),JSON.stringify(metrics)).toBeLessThanOrEqual(.08);
  // A bowed cubic can have tiny join turns. Check all its handles against
  // the independently prescribed straight paint edges as well.
  for(const curve of saved.piece.curves??[])for(const handle of[curve.c1,curve.c2])expect.soft(nearest(saved.pixel(handle),f.rings),'a straight painted span cannot gain bowed handles').toBeLessThanOrEqual(.8);
 }
 if(f.smooth)expect.soft(Math.max(0,...smoothTurns.map(p=>p.radians)),JSON.stringify(metrics)).toBeLessThanOrEqual(Math.PI/9);
 for(const corner of f.corners??[]){const local=turns.filter(p=>Math.hypot(p.x-corner.x,p.y-corner.y)<=3);expect.soft(nearest(corner,saved.rings),'the measured corner stays present').toBeLessThanOrEqual(1.5);expect.soft(Math.max(0,...local.map(p=>p.radians)),`the measured corner ${JSON.stringify(corner)} stays sharp`).toBeGreaterThanOrEqual(.35);}
}
it.each([...fixtures,...hardStraightMatrix])('$name survives the complete default import against analytic geometry',async f=>{await assertAnalytic(f);},60000);
it.each([90,75].flatMap(quality=>[fixtures[1],fixtures[2]].map(f=>({quality,f,name:f.name}))))('JPEG quality $quality $name retains the unchanged 1.5px and 20-degree analytic gates',async({quality,f})=>{await assertAnalytic(f,quality);},60000);
it.each([{scale:.05,rotation:.37},{scale:8,rotation:1.07}])('weak curved import preserves source evidence at scale $scale rotation $rotation',async({scale,rotation})=>{
 const f=fixtures[2],saved=await extract(f,scale,rotation),turns=tangentTurns(saved.piece,saved.pixel).filter(f.smooth!),maxError=Math.max(...saved.rings[0].map(p=>nearest(p,f.rings))),maxTurn=Math.max(0,...turns.map(p=>p.radians));records.push({name:f.name,scale,rotation,maxError,maxTurn,nodes:saved.piece.nodes.length});
 expect.soft(maxError).toBeLessThanOrEqual(1.5);expect.soft(maxTurn).toBeLessThanOrEqual(Math.PI/9);expect.soft(saved.piece.holes??[]).toHaveLength(0);
},60000);
afterAll(()=>{const dir=resolve('test-results/independent-contour');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'analytic-default-import.json'),JSON.stringify({measurement:'Independent analytic shapes rasterized with 1x or 8x coverage and deterministic RGB texture. Full splitReferences import; direct cubic evaluation at <=0.25px control-polygon steps; analytic truth sampled at <=0.3px. Bidirectional sampled errors use native pixels. 1.5px geometric allowance and 20-degree tangent-jump bound are separate criteria. Interior material probes exclude the uncertainty envelope; gap/overlap probes do not.',records},null,2));});
