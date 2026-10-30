import {beforeAll,it,expect} from 'vitest';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import {PDFDocument,PDFArray,PDFDict,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {patternTextWidth} from '../../packages/pattern/annotation-text';
import {interiorRectangle,patternAnnotationLayout} from '../../packages/pattern/annotation-layout';
import {Repository} from '../../apps/desktop/main/repository';
import {analyze} from '../../apps/desktop/main/worker';
import {layout,svgExport,pdfExport,dxfExport} from '../../apps/desktop/main/export';
import {nest} from '../../apps/desktop/main/nesting';
import {parseSvg} from '../../apps/desktop/main/svg-import';
import {exportFont} from '../../apps/desktop/main/export-assets';
import {project,rectangle} from '../fixtures';
import type {Piece} from '../../packages/schema/index';

type XY={xMm:number;yMm:number};
const worker=resolve('target/release/fpcad-worker.exe'),directory=resolve('test-results/2026-10-28-imported-cut/annotations');
const ring=(points:number[][])=>points.map(([xMm,yMm])=>({id:crypto.randomUUID(),xMm,yMm}));
const inside=(p:XY,r:XY[])=>{let value=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a.yMm>p.yMm)!==(b.yMm>p.yMm)&&p.xMm<(b.xMm-a.xMm)*(p.yMm-a.yMm)/(b.yMm-a.yMm)+a.xMm)value=!value;}return value;};
function cloth(p:XY,outer:XY[],holes:XY[][]){return inside(p,outer)&&!holes.some(h=>inside(p,h));}
function rectangleFits(box:{xMm:number;yMm:number;widthMm:number;heightMm:number},outer:XY[],holes:XY[][]){
 for(let row=0;row<=20;row++)for(let column=0;column<=20;column++)expect(cloth({xMm:box.xMm+(column/20-.5)*box.widthMm,yMm:box.yMm+(row/20-.5)*box.heightMm},outer,holes),'annotation crosses cloth boundary or a hole').toBe(true);
 for(const hole of holes)for(const p of hole)expect(Math.abs(p.xMm-box.xMm)<box.widthMm/2&&Math.abs(p.yMm-box.yMm)<box.heightMm/2,'a complete hole lies inside the annotation box').toBe(false);
}
let font:ReturnType<typeof fontkit.create>;
beforeAll(async()=>{font=fontkit.create(await exportFont());await mkdir(directory,{recursive:true});});
function verifyInk(piece:Piece,annotation:ReturnType<typeof patternAnnotationLayout>,outer:XY[]=piece.nodes,holes:XY[][]=piece.holes??[]){
 expect(annotation.fontSizeMm).toBeGreaterThan(0);rectangleFits(annotation.box,outer,holes);
 for(const arrow of annotation.arrows)for(let i=1;i<arrow.points.length;i++)for(let t=0;t<=20;t++){
  const a=arrow.points[i-1],b=arrow.points[i],p={xMm:a.xMm+(b.xMm-a.xMm)*t/20,yMm:a.yMm+(b.yMm-a.yMm)*t/20};
  // The preview stroke also has physical width; verify its outer edges.
  for(const [dx,dy] of [[0,0],[annotation.fontSizeMm*.05,0],[-annotation.fontSizeMm*.05,0],[0,annotation.fontSizeMm*.05],[0,-annotation.fontSizeMm*.05]])expect(cloth({xMm:p.xMm+dx,yMm:p.yMm+dy},outer,holes)).toBe(true);
 }
 for(const label of [...annotation.caption,...annotation.arrows.map(a=>a.label)]){
  const run=font.layout(label.text,{kern:false,locl:false,liga:false});
  for(const mode of ['svg','pdf'] as const){
   const advance=run.positions.reduce((sum,p)=>sum+p.xAdvance,0),naturalWidth=advance/font.unitsPerEm*label.fontSizeMm;
   expect(label.widthMm).toBeCloseTo(naturalWidth,9);
   const size=mode==='pdf'?Math.min(label.fontSizeMm,label.widthMm*font.unitsPerEm/advance):label.fontSizeMm;
   const sx=size/font.unitsPerEm,sy=size/font.unitsPerEm,start=label.xMm-advance*sx/2;
   expect(sx).toBe(sy);expect(size).toBeCloseTo(label.fontSizeMm,9);
   let pen=0;
   for(let i=0;i<run.glyphs.length;i++){
    const glyph=run.glyphs[i],position=mode==='pdf'?{xOffset:0,yOffset:0,xAdvance:glyph.advanceWidth}:run.positions[i],b=glyph.bbox;
    if(b.maxX>b.minX&&b.maxY>b.minY)rectangleFits({xMm:start+(pen+position.xOffset+(b.minX+b.maxX)/2)*sx,yMm:label.yMm+(position.yOffset+(b.minY+b.maxY)/2)*sy,widthMm:(b.maxX-b.minX)*sx,heightMm:(b.maxY-b.minY)*sy},outer,holes);
    pen+=position.xAdvance;
   }
  }
 }
}
const shapes=[
 {name:'rectangle',points:[[0,0],[100,0],[100,200],[0,200]],holes:[],rooms:[[100,200]]},
 {name:'L concavity',points:[[0,0],[100,0],[100,30],[30,30],[30,100],[0,100]],holes:[],rooms:[[100,30],[30,100]]},
 {name:'central hole',points:[[0,0],[100,0],[100,100],[0,100]],holes:[[[40,40],[60,40],[60,60],[40,60]]],rooms:[[40,100],[100,40]]},
 {name:'U concavity',points:[[0,0],[100,0],[100,100],[80,100],[80,20],[20,20],[20,100],[0,100]],holes:[],rooms:[[100,20],[20,100]]},
 {name:'thin strip',points:[[0,0],[300,0],[300,3],[0,3]],holes:[],rooms:[[300,3]]},
 {name:'two holes',points:[[0,0],[100,0],[100,100],[0,100]],holes:[[[40,20],[60,20],[60,40],[40,40]],[[40,60],[60,60],[60,80],[40,80]]],rooms:[[40,100],[100,20]]},
];
it.each(shapes)('fits actual ink and arrow heads into $name at 80% of the analytic maximum',shape=>{
 const piece={...rectangle(),name:'前腿 WMWM gyp',nodes:ring(shape.points),holes:shape.holes.map(ring),furRad:Math.PI/4,grainRad:Math.PI/2};
 const result=patternAnnotationLayout(piece);verifyInk(piece,result);
 // For these orthogonal shapes every contained rectangle is contained in one
 // of the listed strips, giving a closed-form maximum independent of search.
 const availableScale=Math.max(...shape.rooms.map(([w,h])=>Math.min(w/result.box.widthMm,h/result.box.heightMm)));
 expect(1/availableScale).toBeGreaterThanOrEqual(.79);expect(1/availableScale).toBeLessThanOrEqual(.80001);
 expect(result.caption.map(l=>l.text).join('')).toBe(piece.name);expect(result.arrows.map(a=>a.kind)).toEqual(['fur','grain']);
});
it('the rectangle solver agrees with analytic concave and holed maximum squares',()=>{
 for(const [shape,side] of [[shapes[0],100],[shapes[1],30],[shapes[2],40],[shapes[3],20],[shapes[4],3]] as const){const fit=interiorRectangle(ring(shape.points),shape.holes.map(ring),1,1);expect(fit.widthMm).toBeCloseTo(side,0);expect(fit.heightMm).toBeCloseTo(side,0);}
});
it('large pieces enlarge annotations, preserve long names and combine equal fur/grain angles',()=>{
 const small={...rectangle(100,200),name:'中文名称 WMWM gyp '.repeat(8),grainRad:Math.PI/2},large={...small,nodes:small.nodes.map(n=>({...n,xMm:n.xMm*5,yMm:n.yMm*5}))};
 const a=patternAnnotationLayout(small),b=patternAnnotationLayout(large);verifyInk(small,a);verifyInk(large,b);expect(b.fontSizeMm/a.fontSizeMm).toBeCloseTo(5,2);expect(b.caption.map(l=>l.text).join('')).toBe(small.name);expect(b.arrows).toHaveLength(1);expect(b.arrows[0].text).toBe('毛向 / 布向');
});
it('curved inset boundaries constrain the entire annotation instead of the node box',()=>{
 const piece={...rectangle(100,100),name:'弯曲裁片',furRad:Math.PI/4};piece.curves=[{id:crypto.randomUUID(),startNodeId:piece.nodes[2].id,endNodeId:piece.nodes[3].id,c1:{id:crypto.randomUUID(),xMm:100,yMm:-20},c2:{id:crypto.randomUUID(),xMm:0,yMm:-20}}];
 // Independently sample the mathematical cubic, without production flattening.
 const curve=Array.from({length:201},(_,i)=>{const t=i/200,u=1-t;return{xMm:100*u*u*u+300*u*u*t,yMm:100*u*u*u-60*u*u*t-60*u*t*t+100*t*t*t};});
 verifyInk(piece,patternAnnotationLayout(piece),[piece.nodes[0],piece.nodes[1],...curve]);
});
it('new project and SVG defaults give real 2 mm cuts while old explicit and implicit settings remain intact',async()=>{
 const repo=new Repository(':memory:');try{
  const fresh=repo.create('2 mm default');expect(fresh.defaultAllowanceMm).toBe(2);
  const imported=parseSvg('<svg width="100mm" height="200mm" viewBox="0 0 100 200"><rect width="100" height="200"/></svg>')[0];expect(imported.allowanceMm).toBe(2);
  fresh.pieces=[{...imported,allowanceSource:'project'}];const [g]=await analyze(worker,fresh);expect(Math.max(...g.cut.map(p=>p.xMm))-Math.min(...g.cut.map(p=>p.xMm))).toBeCloseTo(104,6);expect(Math.max(...g.cut.map(p=>p.yMm))-Math.min(...g.cut.map(p=>p.yMm))).toBeCloseTo(204,6);
  for(const source of ['piece','project'] as const){const old=project();old.pieces[0].allowanceSource=source;repo.open(old,null);expect(repo.snapshot()).toEqual(old);const [g]=await analyze(worker,repo.snapshot()!);expect(Math.max(...g.cut.map(p=>p.xMm))-Math.min(...g.cut.map(p=>p.xMm))).toBeCloseTo(120,6);}
 }finally{repo.close();}
});
it('actual worker geometry keeps mirrored and rotated nested annotations inside cloth with correct directions',async()=>{
 const p=project();p.pieces=[{...rectangle(160,90),name:'左右前爪 WMWM',cutQty:2,mirror:true,furRad:.35,grainRad:1.1}];const g=await analyze(worker,p),before=JSON.stringify(p);
 for(const nested of [false,true]){
  if(nested)p.nesting=nest(p,g,{widthMm:600,lengthLimitMm:2000,gapMm:5,marginMm:10,alignGrain:false,rotationsRad:[Math.PI/2]});
  const placed=layout(p,g,nested);expect(placed).toHaveLength(2);
  for(const row of placed){verifyInk(row.piece,row.annotation,row.seam,row.seamHoles);const angle=nested?p.nesting!.sheets[0].placements.find(v=>v.instance===row.instance)!.angleRad:0;for(const arrow of row.annotation.arrows){const original=arrow.kind==='fur'?.35:1.1,expected=(row.mirror?Math.PI-original:original)+angle;expect(Math.atan2(Math.sin(arrow.angle-expected),Math.cos(arrow.angle-expected))).toBeCloseTo(0,9);}}
  const svg=svgExport(p,g,[],nested),dxf=dxfExport(p,g,[],nested);expect(svg.match(/data-direction="fur"/g)).toHaveLength(2);expect(svg.match(/data-direction="grain"/g)).toHaveLength(2);expect(dxf).toContain('$INSUNITS\r\n70\r\n4');await writeFile(resolve(directory,`annotations-${nested?'nested':'mirrored'}.svg`),svg);
 }
 delete p.nesting;expect(JSON.stringify(p)).toBe(before);
});
it('PDF uses the same physical annotation and retains A4 and a true 100 mm ruler',async()=>{
 const p=project();p.pieces=[{...rectangle(100,140),name:'前爪 WMWM gyp',grainRad:0}];const g=await analyze(worker,p),svg=svgExport(p,g,[]),bytes=await pdfExport(p,g,[]),pdf=await PDFDocument.load(bytes);
 expect(svg).not.toMatch(/textLength=|lengthAdjust=/);expect(svg).toContain('font-kerning:none');expect(pdf.getPageCount()).toBe(1);
 const embedded=svg.match(/data:font\/ttf;base64,([^"]+)/)?.[1];expect(embedded).toBeDefined();expect(Buffer.from(embedded!,'base64')).toEqual(await exportFont());
 const page=pdf.getPage(0);expect(page.getWidth()*25.4/72).toBeCloseTo(210,9);expect(page.getHeight()*25.4/72).toBeCloseTo(297,9);
 const contents=page.node.Contents(),refs=contents instanceof PDFArray?contents.asArray():[contents],operators=refs.map(r=>{const s=pdf.context.lookup(r!);return s instanceof PDFRawStream?new TextDecoder().decode(decodePDFRawStream(s).decode()):'';}).join('\n');
 expect([...operators.matchAll(/([-\d.eE]+) ([-\d.eE]+) m\s+([-\d.eE]+) ([-\d.eE]+) l\s+S/g)].some(m=>Math.abs((Number(m[3])-Number(m[1]))*25.4/72-100)<1e-8&&Number(m[2])===Number(m[4]))).toBe(true);
 // Decode the emitted PDF's own Unicode map and text matrices, so the test
 // catches exporter omissions, fixed type sizes and incorrect mm transforms.
 const fonts=page.node.Resources()!.lookup(PDFName.of('Font'),PDFDict),maps=new Map<string,Map<string,string>>();
 for(const [name,ref] of fonts.entries()){
  const dict=pdf.context.lookup(ref,PDFDict),stream=pdf.context.lookup(dict.get(PDFName.of('ToUnicode'))!);expect(stream).toBeInstanceOf(PDFRawStream);const cmap=new TextDecoder().decode(decodePDFRawStream(stream as PDFRawStream).decode()),map=new Map<string,string>();
  for(const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const pair of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi))map.set(pair[1].toUpperCase(),String.fromCharCode(...pair[2].match(/.{4}/g)!.map(u=>parseInt(u,16))));maps.set(name.toString(),map);
 }
 const actual:[string,number,number,number][]=[];
 for(const block of operators.matchAll(/BT([\s\S]*?)ET/g)){
  const tf=block[1].match(/(\/[^\s]+)\s+([-\d.eE]+)\s+Tf/),tm=block[1].match(/1 0 0 1 ([-\d.eE]+) ([-\d.eE]+) Tm/),tj=block[1].match(/<([\da-f]+)>\s*Tj/i);if(!tf||!tm||!tj)continue;
  const map=maps.get(tf[1])!,glyphWidth=map.keys().next().value!.length,text=tj[1].match(new RegExp(`.{${glyphWidth}}`,'g'))!.map(g=>map.get(g.toUpperCase())).join('');actual.push([text,Number(tf[2])*25.4/72,Number(tm[1])*25.4/72,Number(tm[2])*25.4/72]);
 }
 const placed=layout(p,g)[0],height=Number(svg.match(/viewBox="0 0 [^ ]+ ([^"]+)"/)![1]),y0=height-277;
 for(const expected of [...placed.annotation.caption,...placed.annotation.arrows.map(a=>a.label)]){
  const emitted=actual.find(([text])=>text===expected.text);expect(emitted,`missing actual PDF annotation ${expected.text}`).toBeDefined();const [,size,x,y]=emitted!,run=font.layout(expected.text,{kern:false,locl:false,liga:false}),advance=run.glyphs.reduce((n,g)=>n+g.advanceWidth,0),width=advance/font.unitsPerEm*size;
  expect(size).toBeCloseTo(expected.fontSizeMm,7);expect(width).toBeCloseTo(expected.widthMm,7);expect(x+width/2-10).toBeCloseTo(expected.xMm,7);expect(y-10+y0).toBeCloseTo(expected.yMm,7);
  let pen=0;for(let i=0;i<run.glyphs.length;i++){const b=run.glyphs[i].bbox,s=size/font.unitsPerEm;if(b.maxX>b.minX&&b.maxY>b.minY)rectangleFits({xMm:x-10+(pen+(b.minX+b.maxX)/2)*s,yMm:y-10+y0+(b.minY+b.maxY)/2*s,widthMm:(b.maxX-b.minX)*s,heightMm:(b.maxY-b.minY)*s},placed.seam,placed.seamHoles);pen+=run.glyphs[i].advanceWidth;}
 }
 await writeFile(resolve(directory,'annotation-actual-size.pdf'),bytes);
});

it('natural widths agree with the actual bundled font including Latin, accents, CJK and disabled ligatures',()=>{
 for(const text of ['前腿 WMWM gyp','Fur / grain','Grain','AV To fi ffi','Été façade — € 100 mm','毛向 / 布向','パターン']){
  const run=font.layout(text,{kern:false,locl:false,liga:false}),width=run.positions.reduce((sum,p)=>sum+p.xAdvance,0)/font.unitsPerEm;
  expect(patternTextWidth(text),text).toBeCloseTo(width,10);
 }
});
