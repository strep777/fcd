// Native original image → extraction → curved user model. Isolated source-level
// acceptance diagnostic: user database is read-only; no desktop or dist build.
import {build} from 'esbuild';
import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const folder=path.resolve('.local/tests/mapping-registration-quality');await mkdir(folder,{recursive:true});await mkdir('test-results',{recursive:true});
const outfile=path.join(folder,'runtime.mjs');
await build({stdin:{contents:`export {Repository} from './apps/desktop/main/repository';export {userMappingFixture} from './tests/user-mapping-fixture';export {splitReferences} from './apps/desktop/main/automatic-reference';export {illustrationRegions} from './packages/reference/illustration';export {anatomicalPlacement} from './apps/desktop/main/anatomical-placement';export {projectMarking} from './apps/desktop/main/markings';export {placedPoint} from './packages/reference/placement-transform';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile});
const api=await import(pathToFileURL(outfile));
const original=api.userMappingFixture();if(!original||original.surface.faces.length<8000)throw Error('Native user curved model acceptance fixture missing');
const inputs=[];
for(const [view,area]of [['front',{left:609,top:0,width:666,height:750}],['back',{left:0,top:0,width:609,height:750}]]){
 const png=await sharp('tests/fixtures/character-front-back.jpg').extract(area).png().toBuffer();
 const prior=original.references.find(r=>r.view===view);if(!prior)throw Error('Original reference missing');
 inputs.push({...structuredClone(prior),png:'data:image/png;base64,'+png.toString('base64'),width:area.width,height:area.height,calibration:undefined,calibrationMode:'automatic'});
}
const baselineFile=path.join(folder,'old-context.mjs');
await build({stdin:{contents:`export {illustrationRegions} from './packages/reference/illustration';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:baselineFile,plugins:[{name:'old-color-region-bounds',setup(builder){builder.onLoad({filter:/reference[\\/]illustration\.ts$/},async args=>{
 let code=await readFile(args.path,'utf8');const head="if(t<.3)return x<headBox.minX||x>=headBox.maxX?{part:'unknown',side:'unknown',confidence:0}:{part:'head',side:'center',confidence:.85};";
 if(!code.includes(head))throw Error('Baseline head rule no longer matches');code=code.replace(head,"if(t<.3)return {part:'head',side:'center',confidence:.85};");
 code=code.replace(/const partBounds=bodyParts\.flatMap\(part=>\{const ids=contextual\.get\(part\);return ids\?\.length\?\[\{part,\.\.\.box\(ids,width\)\}\]:\[\];\}\);/,"const partBounds=bodyParts.flatMap(part=>{const ids=regions.filter(r=>r.part===part).flatMap(r=>r.indices);return ids.length?[{part,...box(ids,width)}]:[];});");
 if(code.includes('const ids=contextual.get(part)'))throw Error('Baseline part bounds no longer match');return {contents:code,loader:'ts'};
});}}]});
const current=api.splitReferences(inputs,1800,8,true,'simple','character'),baselineRuntime=await import(pathToFileURL(baselineFile));
const beforeProject={...structuredClone(original),references:structuredClone(current.references),patternLibrary:structuredClone(current.regions),pieces:[],bindings:[],markings:[]};
for(const reference of beforeProject.references){const decoded=await sharp(Buffer.from(reference.png.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true}),prior=baselineRuntime.illustrationRegions(decoded.info.width,decoded.info.height,new Uint8Array(decoded.data));reference.illustration.partBounds=prior.partBounds.map(({part,...bounds})=>({part,bounds}));}
const afterProject={...structuredClone(beforeProject),references:current.references,patternLibrary:current.regions};
const vertices=new Map(original.surface.vertices.map(v=>[v.id,v])),faces=new Map(original.surface.faces.map(f=>[f.id,f])),records=[],states={before:[],after:[]};
const area=ring=>ring.reduce((n,a,i)=>{const b=ring[(i+1)%ring.length];return n+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2;
const bounds=points=>({minX:Math.min(...points.map(p=>p.xMm)),maxX:Math.max(...points.map(p=>p.xMm)),minY:Math.min(...points.map(p=>p.yMm)),maxY:Math.max(...points.map(p=>p.yMm))});
function fragmentPoints(mark){return mark.fragments.flatMap(fragment=>{const triangle=faces.get(fragment.faceId).vertices.map(id=>vertices.get(id));return fragment.rings.flatMap(ring=>ring.map(w=>({xMm:w.reduce((n,t,i)=>n+t*triangle[i].xMm,0),yMm:w.reduce((n,t,i)=>n+t*triangle[i].yMm,0),zMm:w.reduce((n,t,i)=>n+t*triangle[i].zMm,0)})));});}
for(const [state,p]of [['before',beforeProject],['after',afterProject]]){
 for(const source of p.patternLibrary){const record={state,view:source.view,part:source.anatomy.part,side:source.anatomy.side,name:source.piece.name,color:source.piece.color};
  try{
   // Baseline convention used the source's anatomical side as the template name.
   const projectedSource=state==='before'?{...source,anatomy:{...source.anatomy,method:'manual'}}:source;
   const placement=api.anatomicalPlacement(p,projectedSource),localProject=state==='before'?{...p,patternLibrary:p.patternLibrary.map(s=>s.piece.id===source.piece.id?projectedSource:s)}:p;
   record.expectedScreenSign=source.anatomy.side==='left'?(source.view==='front'?1:-1):source.anatomy.side==='right'?(source.view==='front'?-1:1):0;record.targetCenter=placement.targetCenter;record.regions=placement.regions;
   const mark=await api.projectMarking(path.resolve('target/release/fpcad-worker.exe'),localProject,source.piece.id,source.view,0,0,false,true),worldPoints=fragmentPoints(mark),sign=source.view==='front'?1:-1,points=worldPoints.map(p=>({...p,xMm:sign*p.xMm}));
   Object.assign(record,{placed:true,scale:placement.scaleX,modelSide:placement.modelSide,regions:placement.regions,fragments:mark.fragments.length,projectedAreaMm2:Math.abs(mark.fragments.reduce((n,f)=>n+f.rings.reduce((s,r)=>{const t=faces.get(f.faceId).vertices.map(id=>vertices.get(id));return s+area(r.map(w=>({xMm:sign*w.reduce((n,v,i)=>n+v*t[i].xMm,0),yMm:w.reduce((n,v,i)=>n+v*t[i].yMm,0)})));},0),0)),bounds:bounds(points),expectedScreenSign:source.anatomy.side==='left'?(source.view==='front'?1:-1):source.anatomy.side==='right'?(source.view==='front'?-1:1):0});
   states[state].push(mark);
  }catch(error){record.placed=false;record.reason=error.code??error.message;}
  records.push(record);
 }
 console.log(state+' projected '+states[state].length+'/'+p.patternLibrary.length);
}
const summarize=state=>{const data=records.filter(r=>r.state===state),byPart={};for(const part of new Set(data.map(r=>r.part))){const group=data.filter(r=>r.part===part),placed=group.filter(r=>r.placed);byPart[part]={sources:group.length,placed:placed.length,skipped:group.filter(r=>!r.placed).map(r=>r.reason),projectedAreaMm2:placed.reduce((n,r)=>n+r.projectedAreaMm2,0),wrongScreenSide:placed.filter(r=>r.expectedScreenSign&&Math.sign((r.bounds.minX+r.bounds.maxX)/2)!==r.expectedScreenSign).length,...(placed.length?{bounds:bounds(placed.flatMap(r=>[{xMm:r.bounds.minX,yMm:r.bounds.minY},{xMm:r.bounds.maxX,yMm:r.bounds.maxY}]))}:{})};}return {total:data.length,placed:data.filter(r=>r.placed).length,byPart};};
const bilateral=records.filter(r=>r.state==='after'&&['paw','arm','ear','leg','foot'].includes(r.part)&&r.expectedScreenSign),report={scope:'Identical newly extracted sources compare prior color-only/head bounds and direct side naming against current full-context bounds and explicit built-in modelSide. Does not claim full semantic segmentation.',surface:{source:original.surface.source,vertices:original.surface.vertices.length,faces:original.surface.faces.length},oldUserLibraryUntouched:original.patternLibrary.length,newSourceCount:current.regions.length,before:summarize('before'),after:summarize('after'),bilateralTargets:{checked:bilateral.length,wrong:bilateral.filter(r=>Math.sign(r.targetCenter.xMm)!==r.expectedScreenSign).length,accepted:bilateral.filter(r=>r.placed).length},views:['front','back'].map(view=>({view,placed:records.filter(r=>r.state==='after'&&r.view===view&&r.placed).length,skipped:records.filter(r=>r.state==='after'&&r.view===view&&!r.placed).map(({name,part,side,reason})=>({name,part,side,reason}))})),records};
function escape(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function modelSvg(state,view){const sign=view==='front'?1:-1,width=600,height=600,all=original.surface.vertices,box=bounds(all),scale=Math.min(540/(box.maxX-box.minX),540/(box.maxY-box.minY)),xy=p=>`${300+sign*p.xMm*scale},${570-(p.yMm-box.minY)*scale}`,visible=original.surface.faces.map(f=>{const t=f.vertices.map(id=>vertices.get(id));return {f,t,z:t.reduce((n,v)=>n+sign*v.zMm/3,0)};}).sort((a,b)=>a.z-b.z),byFace=new Map();for(const mark of states[state])for(const fragment of mark.fragments){if(!byFace.has(fragment.faceId))byFace.set(fragment.faceId,[]);byFace.get(fragment.faceId).push({mark,fragment});}
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="600" height="600" fill="#e7edf0"/><text x="20" y="25" font-size="18">${state.toUpperCase()} ${view.toUpperCase()} · ${states[state].length} placements</text>${visible.map(({f,t})=>`<path d="M${t.map(xy).join('L')}Z" fill="#b9bec6"/>${(byFace.get(f.id)??[]).map(({mark,fragment})=>`<path d="${fragment.rings.map(r=>`M${r.map(w=>xy({xMm:w.reduce((n,v,i)=>n+v*t[i].xMm,0),yMm:w.reduce((n,v,i)=>n+v*t[i].yMm,0)})).join('L')}Z`).join('')}" fill="${escape(mark.color)}" fill-rule="evenodd"/>`).join('')}`).join('')}</svg>`;
}
const images=[];for(const state of ['before','after'])for(const view of ['front','back']){const svg=modelSvg(state,view);await writeFile(path.join(folder,`${state}-${view}.svg`),svg);images.push(await sharp(Buffer.from(svg)).png().toBuffer());}
await sharp({create:{width:1200,height:1200,channels:4,background:'#e7edf0'}}).composite(images.map((input,i)=>({input,left:(i%2)*600,top:Math.floor(i/2)*600}))).png().toFile(path.join(folder,'before-after-placement.png'));
report.artifact=path.join(folder,'before-after-placement.png');
for(const [state,p]of [['before',beforeProject],['after',afterProject]]){const directory=path.join(folder,state);await mkdir(directory,{recursive:true});const repository=new api.Repository(path.join(directory,'workspace.sqlite'));try{repository.open({...p,name:'Registration comparison '+state,markings:states[state],surfaceRun:undefined,previewMarkings:undefined,modelLibrary:[],cuttingLibrary:[],activeCutId:undefined},null);}finally{repository.close();}}
await writeFile('test-results/mapping-registration-quality.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,records:undefined}));
// Strong semantic checks are kept independent of the number of accepted colors.
if(report.after.byPart.unknown?.placed)throw Error('Unclassified sources were placed');
if(Object.values(report.after.byPart).some(p=>p.wrongScreenSide))throw Error('A source was placed on the opposite screen side');
if(report.bilateralTargets.checked!==43||report.bilateralTargets.wrong!==0||report.bilateralTargets.accepted<40)throw Error('Real bilateral target registration regressed');
const headRecords=records.filter(r=>r.state==='after'&&r.part==='head'),frontHead=headRecords.filter(r=>r.view==='front'),frontHeadArea=frontHead.reduce((n,r)=>n+(r.projectedAreaMm2??0),0),baselineFrontHeadArea=records.filter(r=>r.state==='before'&&r.part==='head'&&r.view==='front').reduce((n,r)=>n+(r.projectedAreaMm2??0),0);
if(headRecords.length<12||headRecords.some(r=>!r.placed)||frontHeadArea<18000||frontHeadArea>32000)throw Error('Real head face coverage regressed');
if(!(frontHeadArea>baselineFrontHeadArea*1.4))throw Error('Head context did not improve full face coverage');
if(!headRecords.some(r=>{const [red,green,blue]=[1,3,5].map(i=>parseInt(r.color.slice(i,i+2),16));return r.view==='back'&&blue>green&&green>red*2&&r.projectedAreaMm2>8000;}))throw Error('The dominant central back-head blue region was not recovered');
