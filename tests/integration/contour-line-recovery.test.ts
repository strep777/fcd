import {it,expect,vi} from 'vitest';
import sharp from 'sharp';
import {traceMask} from '../../apps/desktop/main/reference-segmentation';
import {illustrationRegions,pigmentFamily,type IllustrationRegion} from '../../packages/reference/illustration';
import * as imageEdges from '../../packages/reference/image-edge-evidence';
import {smoothContour} from '../../packages/reference/smooth-contour';
import {safeContour,contourBoundaryError} from '../../packages/reference/contour-topology';
import type {Piece} from '../../packages/schema/index';
const calibration=(h:number)=>({a:{x:0,y:h},b:{x:0,y:0},distanceMm:h});
function bow(piece:Piece){return Math.max(0,...(piece.curves??[]).map(c=>{const a=piece.nodes.find(n=>n.id===c.startNodeId)!,b=piece.nodes.find(n=>n.id===c.endNodeId)!,length=Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm);return Math.max(...[c.c1,c.c2].map(p=>Math.abs((b.xMm-a.xMm)*(p.yMm-a.yMm)-(b.yMm-a.yMm)*(p.xMm-a.xMm))/length));}));}
it('recovers a rasterized straight diamond without introducing any bowed edge',()=>{
 const width=120,height=120,mask=new Uint8Array(width*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(Math.abs(x+.5-60)/25+Math.abs(y+.5-60)/40<1)mask[y*width+x]=1;
 const raw=traceMask(width,height,mask,calibration(height),width,height,'#0096dc',true).piece,result=smoothContour(raw,.8,()=>crypto.randomUUID());
 expect(raw.nodes).toHaveLength(196);expect(result.nodes.length).toBeLessThanOrEqual(10);expect(bow(result),'straight painted edges must not acquire Bézier bow').toBeLessThan(1e-8);
 expect(safeContour(result,raw,.8)).toBe(true);expect(contourBoundaryError(result,raw,.1,1)).toBeLessThanOrEqual(1);
});
it('the actual replacement character blue back diamond stays straight instead of rounded by extraction',async()=>{
 const width=733,height=1024,rgba=new Uint8Array(await sharp('tests/fixtures/character-blue-white-front-back.png').extract({left:803,top:0,width,height}).ensureAlpha().raw().toBuffer());
 const interior=[[260,350],[250,350],[270,350],[260,335],[260,365]],exterior=[[220,350],[300,350],[260,300],[260,395]];
 // These blue interior and dark exterior pixels are visible in the original
 // PNG. Its antialiased border can change ownership without changing identity.
 for(const [x,y]of interior){const i=(y*width+x)*4;expect(rgba[i+2]-rgba[i]).toBeGreaterThan(70);expect(rgba[i+1]-rgba[i]).toBeGreaterThan(40);}
 for(const [x,y]of exterior)expect(Math.max(...rgba.subarray((y*width+x)*4,(y*width+x)*4+3))).toBeLessThan(80);
 const identify=(regions:IllustrationRegion[])=>{
  const region=regions.find(r=>r.indices.includes(350*width+260));expect(region).toBeDefined();
  expect(pigmentFamily(region!.color)).toBe(4);
  for(const [x,y]of interior)expect(regions.find(r=>r.indices.includes(y*width+x))).toBe(region);
  for(const [x,y]of exterior)expect(region!.indices.includes(y*width+x)).toBe(false);
  const xs=region!.indices.map(i=>i%width),ys=region!.indices.map(i=>Math.floor(i/width));
  expect(Math.min(...xs)).toBeGreaterThan(230);expect(Math.max(...xs)).toBeLessThan(290);
  expect(Math.min(...ys)).toBeGreaterThan(310);expect(Math.max(...ys)).toBeLessThan(400);
  return region!;
 };
 let before:IllustrationRegion[]|undefined;
 const refine=imageEdges.refineImageEdgeOwnership;
 const observe=vi.spyOn(imageEdges,'refineImageEdgeOwnership').mockImplementation((w,h,pixels,input)=>{before=input;return refine(w,h,pixels,input);});
 let regions:IllustrationRegion[];
 try{regions=illustrationRegions(width,height,rgba).regions;}finally{observe.mockRestore();}
 expect(before).toBeDefined();
 // Apply the same identity and geometry oracle to the original classification
 // and the image-supported result, without an exact border-pixel count.
 for(const candidates of[before!,regions!]){
  const region=identify(candidates),mask=new Uint8Array(width*height);for(const i of region.indices)mask[i]=1;
  const raw=traceMask(width,height,mask,calibration(height),width,height,region.color,true).piece,result=smoothContour(raw,.8,()=>crypto.randomUUID());
  expect(bow(result),'the original blue diamond has four painted straight sides').toBeLessThan(1e-8);expect(result.nodes.length).toBeLessThanOrEqual(12);
  expect(safeContour(result,raw,.8)).toBe(true);expect(contourBoundaryError(result,raw,.1,1)).toBeLessThanOrEqual(1);
 }
});

const cases=[.13,.3,.6,1,1.5,2.7].flatMap(slope=>[.05,1,10].map(scale=>({slope,scale})));
it.each(cases)('preserves straightness at slope $slope and pixel size $scale after rotation and large translation',({slope,scale})=>{
 const width=160,height=160,mask=new Uint8Array(width*height);
 for(let x=12;x<120;x++)for(let y=0;y<height;y++)if(y>=Math.floor((x-12)*slope)+10&&y<Math.floor((x-12)*slope)+17)mask[y*width+x]=1;
 const raster=traceMask(width,height,mask,calibration(height),width,height,'#0096dc',true).piece;
 const angle=.37,c=Math.cos(angle),s=Math.sin(angle),move=(p:Piece['nodes'][number])=>({...p,xMm:4e6+scale*(p.xMm*c-p.yMm*s),yMm:-3e6+scale*(p.xMm*s+p.yMm*c)});
 const raw={...raster,nodes:raster.nodes.map(move),holes:raster.holes?.map(h=>h.map(move))},result=smoothContour(raw,.8*scale,()=>crypto.randomUUID());
 expect(bow(result)).toBeLessThan(1e-7*scale);expect(result.nodes.length).toBeLessThan(20);
 expect(safeContour(result,raw,.8*scale)).toBe(true);
 expect(contourBoundaryError(result,raw,.1*scale,1.05*scale)).toBeLessThanOrEqual(1.05*scale);
});
it.each([[8,13],[18,31],[37,22]])('keeps small pointed markings %s by %s pixels as straight-sided geometry',(rx,ry)=>{
 const width=100,height=100,mask=new Uint8Array(width*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(Math.abs(x+.5-50)/rx+Math.abs(y+.5-50)/ry<1)mask[y*width+x]=1;
 const raw=traceMask(width,height,mask,calibration(height),width,height,'#080809',true).piece,result=smoothContour(raw,.8,()=>crypto.randomUUID());
 expect(result.nodes.length).toBeLessThanOrEqual(10);expect(bow(result)).toBeLessThan(1e-8);
 expect(safeContour(result,raw,.8)).toBe(true);expect(contourBoundaryError(result,raw,.1,1.05)).toBeLessThanOrEqual(1.05);
 // Neither opposite painted apex may disappear behind a round segment.
 for(const sign of [-1,1]){const y=50+sign*ry;expect(Math.min(...result.nodes.map(p=>Math.hypot(p.xMm-50,p.yMm-y)))).toBeLessThanOrEqual(1.5);}
});
