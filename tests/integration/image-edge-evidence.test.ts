import {beforeAll,describe,expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import {edgeArcPoints} from '../../packages/pattern/edit';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';
import type {IllustrationRegion} from '../../packages/reference/illustration';
import {refineImageEdgeOwnership} from '../../packages/reference/image-edge-evidence';
import * as imageEdges from '../../packages/reference/image-edge-evidence';
import {traceMask} from '../../apps/desktop/main/reference-segmentation';
import {recoverSharedContours} from '../../packages/reference/shared-contour';
import type {Piece,Reference} from '../../packages/schema/index';

let rgba:Uint8Array,width:number,regions:ReturnType<typeof splitReferences>['regions'],refinedPieces:Piece[],refinedRegions:IllustrationRegion[];
describe('original image edge evidence',()=>{
beforeAll(async()=>{
 const original=await sharp('tests/fixtures/character-front-back.jpg').ensureAlpha().raw().toBuffer({resolveWithObject:true});
 rgba=new Uint8Array(original.data);width=original.info.width;
 const references:Reference[]=[];
 for(const [view,left,w] of [['front',609,666],['back',0,609]] as const){
  const png=await sharp('tests/fixtures/character-front-back.jpg').extract({left,top:0,width:w,height:750}).png().toBuffer();
  references.push({id:view,name:view,view,width:w,height:750,png:'data:image/png;base64,'+png.toString('base64'),resources:{} as Reference['resources'],calibration:{a:{x:0,y:750},b:{x:0,y:0},distanceMm:750},calibrationMode:'manual'});
 }
 let captured:{rgba:Uint8Array;regions:IllustrationRegion[]}|undefined;
 const refine=refineImageEdgeOwnership;
 const observe=vi.spyOn(imageEdges,'refineImageEdgeOwnership').mockImplementation((w,h,pixels,input)=>{if(w===666&&h===750)captured={rgba:pixels,regions:input};return refine(w,h,pixels,input);});
 try{regions=splitReferences(references,750,6,true).regions;}finally{observe.mockRestore();}
 expect(captured).toBeDefined();
 const corrected=refineImageEdgeOwnership(666,750,captured!.rgba,captured!.regions);
 refinedRegions=corrected.regions;
 const originals=corrected.regions.map(r=>{const mask=new Uint8Array(666*750);r.indices.forEach(i=>{mask[i]=1;});return traceMask(666,750,mask,{a:{x:0,y:750},b:{x:0,y:0},distanceMm:750},666,750,r.color,true).piece;});
 refinedPieces=recoverSharedContours(originals,.8,()=>crypto.randomUUID()).pieces;
},120000);

function crossings(piece:Piece,y:number){
 const ring=piece.nodes.flatMap(n=>edgeArcPoints(piece,n.id).slice(0,-1)).map(p=>({x:p.xMm+609,y:750-p.yMm})),xs:number[]=[];
 for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y))xs.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y));}
 return xs;
}
function yellowChroma(x:number,y:number){const i=(y*width+x)*4,r=rgba[i],g=rgba[i+1],b=rgba[i+2];return (r+g-2*b)/(r+g+b+1);}
function descendingGradient(x:number,y:number){return (yellowChroma(x-2,y)+2*yellowChroma(x-1,y)-2*yellowChroma(x+1,y)-yellowChroma(x+2,y))/8;}

function thighDistances(pieces:Piece[]){
 // This is the imageLEFT front thigh shown by the user, not the opposite
 // x839..1009 fixture used by the earlier contour-to-mask regression.
 const candidates=pieces.filter(p=>pigmentFamily(p.color!)===2);
 const thigh=candidates.find(p=>crossings(p,530.5).some(x=>x>775&&x<798));expect(thigh).toBeDefined();
 const distances:number[]=[];
 for(let y=500;y<=570;y++){
  // Fixed image-space search corridor selected from the original image;
  // it is independent of the reconstructed contour and pigment mask.
  const center=y<540?791-(y-500)*.32:780-(y-540)*.55;
  const left=Math.floor(center)-8,right=Math.ceil(center)+8;
  const interior=(yellowChroma(left,y)+yellowChroma(left+1,y))/2,exterior=(yellowChroma(right,y)+yellowChroma(right-1,y))/2;
  // At the upper taper a second white feature enters this source-only
  // corridor. Those rows lack two material plateaus and cannot locate this
  // edge independently; retain only rows with actual bilateral color support.
  if(interior-exterior<.3)continue;
  const level=(interior+exterior)/2,observedCrossings:number[]=[];
  for(let x=left;x<right;x++){const a=yellowChroma(x,y),b=yellowChroma(x+1,y);if(a>=level&&b<level)observedCrossings.push(x+.5+(a-level)/(a-b));}
  // Argmax gradients switch between two modes inside the same broad JPEG
  // transition at y533/534. Independently measured two-plateau contrast
  // defines the physical color step without an across-row smoothness prior.
  expect(observedCrossings).toHaveLength(1);
  const observed=observedCrossings[0],xs=crossings(thigh!,y+.5);
  expect(xs.length).toBeGreaterThanOrEqual(2);distances.push(Math.abs(Math.max(...xs)-observed));
 }
 distances.sort((a,b)=>a-b);
 expect(distances.length).toBeGreaterThanOrEqual(60);
 return distances;
}
it('the screenshot yellow thigh follows the original JPEG pigment edge rather than only its classified mask',()=>{
 const distances=thighDistances(regions.filter(r=>r.view==='front').map(r=>r.piece));
 // Permit JPEG ridge variation, but reject multi-pixel systematic drift.
 expect(distances[Math.floor(distances.length*.95)]).toBeLessThanOrEqual(1.8);
 expect(distances.at(-1)).toBeLessThanOrEqual(2.5);
});
it('image-supported ownership refinement removes the actual multi-pixel image-edge drift through the same joint contour pipeline',()=>{
 const distances=thighDistances(refinedPieces);
 expect(distances[Math.floor(distances.length*.95)]).toBeLessThanOrEqual(1.8);expect(distances.at(-1)).toBeLessThanOrEqual(2.5);
});
it('the small raised claw follows the original black-to-white diagonal instead of keeping a false pale flat top',()=>{
 const claw=regions.filter(r=>r.view==='front'&&pigmentFamily(r.piece.color!)===6).map(r=>r.piece).find(p=>p.nodes.some(n=>n.xMm+609>=658&&n.xMm+609<=674&&750-n.yMm>=226&&750-n.yMm<=235));
 expect(claw).toBeDefined();
 const light=(x:number,y:number)=>{const i=(y*width+x)*4;return (rgba[i]+rgba[i+1]+rgba[i+2])/3;};
 const source:{x:number,y:number}[]=[];
 for(let x=660;x<=673;x++){
  const white=(light(x,224)+light(x,225))/2,black=Math.min(...[227,228,229,230,231,232].map(y=>light(x,y))),level=(white+black)/2,edges:{x:number,y:number}[]=[];
  for(let y=225;y<231;y++){const a=light(x,y),b=light(x,y+1);if(a>=level&&b<level)edges.push({x:x+.5,y:y+.5+(a-level)/(a-b)});}
  if(white-black>128&&black<80&&edges.length===1)source.push(edges[0]);
 }
 expect(source.length).toBeGreaterThanOrEqual(10);
 const ring=claw!.nodes.flatMap(n=>edgeArcPoints(claw!,n.id).slice(0,-1)).map(p=>({x:p.xMm+609,y:750-p.yMm}));
 const distance=(p:{x:number,y:number},a:{x:number,y:number},b:{x:number,y:number})=>{const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
 const nearest=(p:{x:number,y:number},path:{x:number,y:number}[],closed=false)=>Math.min(...path.slice(0,closed?undefined:-1).map((a,i)=>distance(p,a,path[(i+1)%path.length])));
 expect(Math.max(...source.map(p=>nearest(p,ring,true)))).toBeLessThanOrEqual(1.05);
 const dense=ring.flatMap((a,i)=>{const b=ring[(i+1)%ring.length],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.1));return Array.from({length:n},(_,j)=>({x:a.x+(b.x-a.x)*j/n,y:a.y+(b.y-a.y)*j/n}));}).filter(p=>p.x>=662&&p.x<=670&&p.y>=225&&p.y<=230);
 expect(dense.length).toBeGreaterThan(20);
 // Horizontal intercept error amplifies displacement at a shallow edge. Both
 // directions use Euclidean distance to the independently measured source;
 // the .05 margin covers the .1-pixel fitted-path sampling interval.
 expect(Math.max(...dense.map(p=>nearest(p,source)))+.05).toBeLessThanOrEqual(1.05);
});
it('the yellow thigh excludes the source blue ink overshoot below its unique pigment color step',()=>{
 for(let x=743;x<=746;x++){
  const inside=yellowChroma(x,577),outside=yellowChroma(x,590),level=(inside+outside)/2;
  expect(inside-outside).toBeGreaterThan(.6);
  const crossings:number[]=[];
  for(let y=578;y<587;y++){const a=yellowChroma(x,y),b=yellowChroma(x,y+1);if(a>=level&&b<level)crossings.push(y+.5+(a-level)/(a-b));}
  expect(crossings).toHaveLength(1);expect(crossings[0]).toBeLessThan(582);
  expect(yellowChroma(x,582)).toBeLessThan(level);
  const owner=refinedRegions.find(r=>r.indices.includes(582*666+x-609));expect(owner).toBeDefined();expect(pigmentFamily(owner!.color)).toBe(0);
 }
});
});

const colors=['#ede7ea','#f9e33c','#08060a'];
function scene(w:number,h:number,ownership:(x:number,y:number)=>number,image:(x:number,y:number)=>number[]){
 const pixels=new Uint8Array(w*h*4),groups=colors.map((color):IllustrationRegion=>({color,part:'unknown',side:'unknown',indices:[],confidence:0}));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,owner=ownership(x+.5,y+.5);if(owner>=0)groups[owner].indices.push(i);pixels.set([...image(x+.5,y+.5),255],i*4);}
 return {pixels,groups};
}
function componentCount(w:number,h:number,ids:number[],eight=false){
 const remaining=new Set(ids);let count=0;while(remaining.size){const first=remaining.values().next().value!;remaining.delete(first);count++;const queue=[first];for(let q=0;q<queue.length;q++){const i=queue[q],x=i%w,y=Math.floor(i/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy||!eight&&Math.abs(dx)+Math.abs(dy)!==1||x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;const n=(y+dy)*w+x+dx;if(remaining.delete(n))queue.push(n);}}}return count;
}
const rgb=(id:number)=>[1,3,5].map(i=>parseInt(colors[id].slice(i,i+2),16));
it('refinement keeps foreground partition, components, enclosed holes and complete thin dark tips',()=>{
 const w=80,h=70,dark=(x:number,y:number)=>x>=39&&x<42&&y>=4&&y<18,hole=(x:number,y:number)=>(x-40)**2+(y-37)**2<49;
 const owner=(x:number,y:number)=>x<4||x>=76||y<3||y>=67?-1:dark(x,y)?2:hole(x,y)?0:x>=20&&x<60&&y>=12&&y<61?1:0;
 const actual=(x:number,y:number)=>dark(x,y)?2:hole(x,y)?0:x>=23&&x<57&&y>=12&&y<61?1:0;
 const {pixels,groups}=scene(w,h,owner,(x,y)=>rgb(actual(x,y))),result=refineImageEdgeOwnership(w,h,pixels,groups);
 expect(result.report.movedPixels).toBeGreaterThan(0);
 expect(result.regions[2].indices).toEqual(groups[2].indices);
 const before=groups.flatMap(r=>r.indices).sort((a,b)=>a-b),after=result.regions.flatMap(r=>r.indices).sort((a,b)=>a-b);
 expect(after).toEqual(before);expect(new Set(after).size).toBe(after.length);
 for(let id=0;id<groups.length;id++){
  expect(componentCount(w,h,result.regions[id].indices)).toBe(componentCount(w,h,groups[id].indices));
  const complement=(ids:number[])=>{const occupied=new Set(ids);return Array.from({length:w*h},(_,i)=>i).filter(i=>!occupied.has(i));};
  expect(componentCount(w,h,complement(result.regions[id].indices),true)).toBe(componentCount(w,h,complement(groups[id].indices),true));
 }
});
it.each([1,2,3])('native-scale %s sharp diagonal edges and narrow stripes stay stationary',scale=>{
 const w=80*scale,h=60*scale,owner=(x:number,y:number)=>x>20*scale+y*.3&&x<60*scale?1:0;
 const {pixels,groups}=scene(w,h,owner,(x,y)=>rgb(owner(x,y))),result=refineImageEdgeOwnership(w,h,pixels,groups);
 expect(result.regions.map(r=>r.indices)).toEqual(groups.map(r=>r.indices));
 const stripe=(x:number)=>x>=38*scale&&x<40*scale?1:0,thin=scene(w,h,(x)=>stripe(x),(x)=>rgb(stripe(x)));
 expect(refineImageEdgeOwnership(w,h,thin.pixels,thin.groups).regions.map(r=>r.indices)).toEqual(thin.groups.map(r=>r.indices));
});
it.each([1,2,3])('native-scale %s biased diagonal ownership follows antialiased original color transitions',scale=>{
 const w=80*scale,h=60*scale,boundary=(y:number)=>25*scale+y*.33;
 const owner=(x:number,y:number)=>x>=boundary(y)+2?1:0,neutral=rgb(0),yellow=rgb(1);
 const {pixels,groups}=scene(w,h,owner,(x,y)=>{const coverage=Math.max(0,Math.min(1,.5+(x-boundary(y))/2));return neutral.map((v,c)=>Math.round(v+(yellow[c]-v)*coverage));});
 const result=refineImageEdgeOwnership(w,h,pixels,groups);expect(result.report.movedPixels).toBeGreaterThan(h/2);
 for(let y=10;y<h-10;y++){
  const row=result.regions[1].indices.filter(i=>Math.floor(i/w)===y),first=Math.min(...row)%w;
  expect(Math.abs(first-boundary(y+.5))).toBeLessThanOrEqual(.85);
 }
});
it.each([1,2])('native-scale %s curved blurred color steps recover their analytic edge centers without rounding sharp features',scale=>{
 const w=90*scale,h=90*scale,c=45*scale,r=27*scale,neutral=rgb(0),yellow=rgb(1),radius=(x:number,y:number)=>Math.hypot(x-c,y-c);
 const {pixels,groups}=scene(w,h,(x,y)=>radius(x,y)<r+2?1:0,(x,y)=>{const coverage=Math.max(0,Math.min(1,.5+(r-radius(x,y))/2));return neutral.map((v,i)=>Math.round(v+(yellow[i]-v)*coverage));});
 const result=refineImageEdgeOwnership(w,h,pixels,groups),inside=new Set(result.regions[1].indices),errors:number[]=[];
 for(const i of inside){const x=i%w,y=Math.floor(i/w);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])if(!inside.has(i+dx+dy*w))errors.push(Math.abs(radius(x+.5+dx*.5,y+.5+dy*.5)-r));}
 errors.sort((a,b)=>a-b);expect(errors[Math.floor(errors.length*.95)]).toBeLessThanOrEqual(1);
});
it('rejects malformed dimensions and overlapping or out-of-range ownership',()=>{
 const region:IllustrationRegion={color:colors[0],part:'unknown',side:'unknown',confidence:0,indices:[0]};
 expect(()=>refineImageEdgeOwnership(2.5,2,new Uint8Array(20),[region])).toThrow('IMAGE_LIMIT');
 expect(()=>refineImageEdgeOwnership(2,2,new Uint8Array(16),[region,{...region}])).toThrow('INVALID_MASK');
 expect(()=>refineImageEdgeOwnership(2,2,new Uint8Array(16),[{...region,indices:[4]}])).toThrow('INVALID_MASK');
});
it('two gradient modes inside one blurred color transition retain the known step center',()=>{
 const w=90,h=70,center=(y:number)=>32.3+y*.19,neutral=rgb(0),yellow=rgb(1),normalize=(c:number[])=>{const sum=c.reduce((a,b)=>a+b,0);return c.map(v=>v/sum);},a=normalize(neutral),b=normalize(yellow),sigmoid=(x:number)=>1/(1+Math.exp(-x*1.7));
 const {pixels,groups}=scene(w,h,(x,y)=>x>=center(y)+2?1:0,(x,y)=>{const z=x-center(y),coverage=(sigmoid(z-2)+sigmoid(z+2))/2;return a.map((v,i)=>Math.round((v+(b[i]-v)*coverage)*500));});
 const result=refineImageEdgeOwnership(w,h,pixels,groups);
 for(let y=10;y<h-10;y++){
  const row=result.regions[1].indices.filter(i=>Math.floor(i/w)===y),first=Math.min(...row)%w;
  expect(Math.abs(first-center(y+.5)),JSON.stringify({y,first,center:center(y+.5),report:result.report})).toBeLessThanOrEqual(.85);
 }
});
it.each([0,-1])('biased antialiased dark tips adjoining owner %s follow source luminance while keeping true core pixels and the acute apex',exterior=>{
 const w=90,h=80,tip={x:40,y:15},right=(y:number)=>40+(y-15)*1.8,left=(y:number)=>40-(y-15)*.32;
 const truth=(x:number,y:number)=>y>=15&&y<62&&x>=left(y)&&x<=right(y);
 const {pixels,groups}=scene(w,h,(x,y)=>y>=15&&y<62&&x>=left(y)-2&&x<=right(y)+2?2:exterior,(x,y)=>{let coverage=0;for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++)if(truth(x-.5+(dx+.5)/8,y-.5+(dy+.5)/8))coverage+=1/64;return [0,1,2].map(()=>Math.round(245*(1-coverage)+8*coverage));});
 const result=refineImageEdgeOwnership(w,h,pixels,groups),dark=new Set(result.regions[2].indices);
 expect(result.report.movedPixels).toBeGreaterThan(0);
 if(exterior<0){
  expect(result.report.removedForegroundPixels).toBeGreaterThan(0);
  expect(groups.flatMap(r=>r.indices).length-result.regions.flatMap(r=>r.indices).length).toBe(result.report.removedForegroundPixels);
 }
 const complement=(ids:number[])=>{const inside=new Set(ids);return Array.from({length:w*h},(_,i)=>i).filter(i=>!inside.has(i));};
 expect(componentCount(w,h,complement(result.regions[2].indices),true)).toBe(componentCount(w,h,complement(groups[2].indices),true));
 for(const i of groups[2].indices)if(Math.max(...pixels.subarray(i*4,i*4+3))<60)expect(dark.has(i)).toBe(true);
 expect(componentCount(w,h,result.regions[2].indices)).toBe(1);
 for(let y=20;y<35;y++){const row=result.regions[2].indices.filter(i=>Math.floor(i/w)===y),end=Math.max(...row)%w+1;expect(Math.abs(end-right(y+.5))).toBeLessThanOrEqual(1);}
 const apex=result.regions[2].indices.filter(i=>Math.floor(i/w)===tip.y);expect(apex.length).toBeGreaterThan(0);expect(apex.some(i=>Math.abs(i%w+.5-tip.x)<1)).toBe(true);
});



it('a pigment step followed by an ink chroma overshoot on the same exterior side recovers the unique material crossing',()=>{
 const w=60,h=60,yellow=rgb(1),neutral=rgb(0),blue=[30,90,140];
 const {pixels,groups}=scene(w,h,(x,y)=>y<36?1:0,(x,y)=>{
  const coverage=Math.max(0,Math.min(1,(y-31)/3)),overshoot=Math.max(0,1-Math.abs(y-36)/4);
  const step=yellow.map((v,c)=>v+(neutral[c]-v)*coverage);
  return step.map((v,c)=>Math.round(v+(blue[c]-v)*overshoot));
 });
 const result=refineImageEdgeOwnership(w,h,pixels,groups);
 expect(result.report.movedPixels).toBeGreaterThan(0);
 for(let x=10;x<50;x++)expect(result.labels[34*w+x]).toBe(0);
});

it('back-foot pink material stops at the original dark separator instead of including distant warm gray fur',async()=>{
 const w=609,h=750,pixels=new Uint8Array(await sharp('tests/fixtures/character-front-back.jpg').extract({left:0,top:0,width:w,height:h}).ensureAlpha().raw().toBuffer());
 const light=(x:number,y:number)=>{const i=(y*w+x)*4;return(pixels[i]+pixels[i+1]+pixels[i+2])/3;};
 const chroma=(x:number,y:number)=>{const i=(y*w+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2];return(2*r-g-b)/(r+g+b+1);};
 const source:{x:number,y:number}[]=[];
 // These two material plateaus and the ink search corridor are fixed from
 // the original back-foot pixels, independently of segmentation or fitting.
 for(let y=682;y<=693;y++){
  const insideLight=([307,308,309].reduce((s,x)=>s+light(x,y),0))/3,outsideLight=([318,319,320].reduce((s,x)=>s+light(x,y),0))/3;
  const insideChroma=([307,308,309].reduce((s,x)=>s+chroma(x,y),0))/3,outsideChroma=([318,319,320].reduce((s,x)=>s+chroma(x,y),0))/3;
  const x=[311,312,313,314,315].reduce((a,b)=>light(a,y)<light(b,y)?a:b),center=light(x,y),left=light(x-1,y),right=light(x+1,y);
  if(Math.min(insideLight,outsideLight)-center<30||insideChroma-outsideChroma<.08)continue;
  expect(left+right-2*center).toBeGreaterThan(0);
  source.push({x:x+.5+.5*(left-right)/(left+right-2*center),y:y+.5});
 }
 expect(source.length).toBeGreaterThanOrEqual(9);
 const result=illustrationRegions(w,h,pixels),pink=new Set(result.regions.filter(r=>pigmentFamily(r.color)===1).flatMap(r=>r.indices));
 // True pad color and its white glint remain material; only the fur on the
 // opposite side of its independently supported separator must be excluded.
 expect(pink.has(685*w+308)).toBe(true);expect(pink.has(688*w+312)).toBe(true);
 for(const p of source){
  const y=Math.floor(p.y),row=Array.from({length:40},(_,i)=>300+i).filter(x=>pink.has(y*w+x));
  expect(row.length).toBeGreaterThan(0);
  // The JPEG stroke has finite width. Two native pixels still reject the
  // observed 15 to 22-pixel material extension without assuming a smoothed line.
  expect(Math.abs(Math.max(...row)+1-p.x),JSON.stringify(p)).toBeLessThanOrEqual(2);
 }
},10000);

it('a low-chroma pink-gray step with quiet source plateaus corrects biased ownership without responding to uniform JPEG-scale noise',()=>{
 const w=80,h=60,a=[220,208,215],b=[203,141,149],boundary=(y:number)=>29+y*.21;
 const make=(noisy=false)=>{
  const s=scene(w,h,(x,y)=>x>=boundary(y)+2?1:0,(x,y)=>{
   const coverage=noisy?0:Math.max(0,Math.min(1,.5+(x-boundary(y))/2));
   return a.map((v,c)=>Math.round((v+(b[c]-v)*coverage)+(noisy?((Math.floor(x)+Math.floor(y))%2?1:-1):0)));
  });s.groups[0].color='#dcd0d7';s.groups[1].color='#cb8d95';return s;
 };
 const {pixels,groups}=make(),result=refineImageEdgeOwnership(w,h,pixels,groups);
 expect(result.report.movedPixels).toBeGreaterThan(h/2);
 for(let y=10;y<h-10;y++){
  const first=Math.min(...result.regions[1].indices.filter(i=>Math.floor(i/w)===y))%w;
  expect(Math.abs(first-boundary(y+.5))).toBeLessThanOrEqual(1);
 }
 const noisy=make(true),stationary=refineImageEdgeOwnership(w,h,noisy.pixels,noisy.groups);
 expect(stationary.report.movedPixels).toBe(0);expect(stationary.regions.map(r=>r.indices)).toEqual(noisy.groups.map(r=>r.indices));
});
