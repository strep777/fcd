import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {resolve,sep} from 'node:path';
import {constants,setPriority,getPriority} from 'node:os';
import {desktop} from './tauri-desktop.mjs';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {workflow,surfaceCoordinates,chooseProject,waitForIdle} from './ui-navigation.mjs';
import {PDFDocument,PDFArray,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {auditRuntime,testedArtifacts,sha256} from './real-mapping-fixture-audit.mjs';
import {assertDesignCutContract} from './cut-result-contract.mjs';
import {assertBodyModelScope} from './fixtures/character-functional-oracle.mjs';
import {observeNativeResponses} from './native-response-observer.mjs';
import {assertFreshOriginalJpegSources} from './fixtures/original-jpeg-native-oracle.mjs';
import {auditSmallPhysicalPanels} from './fixtures/independent-material-domain-association.mjs';

const finalFresh=process.env.FPCAD_JPEG_FINAL_FRESH==='1';
if(finalFresh){assert(!process.env.FPCAD_JPEG_RESUME_CUT_INPUT&&!process.env.FPCAD_JPEG_REPLAY_PROJECT,'Final fresh acceptance cannot resume or replay a historical candidate');for(const key of ['FPCAD_JPEG_EXPECT_HOST_SHA','FPCAD_JPEG_EXPECT_MAIN_SHA','FPCAD_JPEG_EXPECT_SURFACE_WORKER_SHA','FPCAD_JPEG_EXPECT_NATIVE_WORKER_SHA'])assert(process.env[key],key+' must pin the frozen build');}
const output=resolve(process.env.FPCAD_JPEG_PADDED_RESULTS??'test-results/reported-functional-acceptance/jpeg-padded-chain');
await mkdir(output,{recursive:true});
const resumeInput=process.env.FPCAD_JPEG_RESUME_CUT_INPUT?resolve(process.env.FPCAD_JPEG_RESUME_CUT_INPUT):undefined;
const expectedResume=resumeInput?JSON.parse(await readFile(resumeInput,'utf8')):undefined;
const replayInput=process.env.FPCAD_JPEG_REPLAY_PROJECT?resolve(process.env.FPCAD_JPEG_REPLAY_PROJECT):undefined;
assert(!(resumeInput&&replayInput),'Choose an unchanged-cut retry or a historical-candidate downstream replay');
const replayBytes=replayInput?await readFile(replayInput):undefined,replayProject=replayBytes?JSON.parse(replayBytes.toString()):undefined;
if(replayInput){assert(replayInput.startsWith(resolve('test-results')+sep),'Only pinned test evidence may be replayed');assert.equal(sha256(replayBytes),process.env.FPCAD_JPEG_REPLAY_SHA?.toLowerCase(),'Pin the immutable real candidate SHA256');assert.equal(replayProject.surfaceRun?.pieces.length,65);assert.equal(replayProject.surfaceRun.accepted,false);}
if(process.env.FPCAD_JPEG_REPLAY_SOURCE_INPUT){const source=JSON.parse(await readFile(resolve(process.env.FPCAD_JPEG_REPLAY_SOURCE_INPUT),'utf8')),reference=JSON.parse(await readFile(resolve(process.env.FPCAD_JPEG_REPLAY_REFERENCE_INPUT),'utf8'));assert.deepEqual(source,reference,'Replay derives from exactly the failed native input');const {surfaceRun,...base}=replayProject;assert.deepEqual(base,source,'Only the actual calculated candidate may have been added to the unchanged native input');}
const replayFullPath=process.env.FPCAD_JPEG_REPLAY_FULL_RESULT?resolve(process.env.FPCAD_JPEG_REPLAY_FULL_RESULT):undefined,replayFullBytes=replayFullPath?await readFile(replayFullPath):undefined,replayFull=replayFullBytes?JSON.parse(replayFullBytes.toString()):undefined;
if(replayFull){assert.equal(sha256(replayFullBytes),process.env.FPCAD_JPEG_REPLAY_FULL_SHA?.toLowerCase(),'Pin the exact actual cutPreview return, including mapped markings');assert.deepEqual(replayFull.run,replayProject.surfaceRun);assert.equal(replayFull.markings.length,replayProject.markings.length);assert(replayFull.markings.reduce((n,m)=>n+m.paths.length,0)>0,'Replay requires the actual cutPreview mapped-marking result, not a run-only package');replayProject.previewMarkings=replayFull.markings;}
const directory=process.env.FPCAD_JPEG_PADDED_DATA_DIR?resolve(process.env.FPCAD_JPEG_PADDED_DATA_DIR):await mkdtemp(resolve('.local/tests/jpeg-padded-chain-'));
assert(directory.startsWith(resolve('.local/tests')+sep),'Only an isolated test library may be used');
assert(!resumeInput||process.env.FPCAD_JPEG_PADDED_DATA_DIR,'Resume the original native test library, never a substituted project');
const launchOptions={args:desktopArgs,executablePath,env:{...process.env,FPCAD_DATA_DIR:directory}};
let app=await desktop.launch(launchOptions),page=await app.firstWindow();
page.setDefaultTimeout(30000);
const report={passed:false,started:new Date().toISOString(),testEntrySha256:sha256(await readFile(new URL(import.meta.url))),freeze:process.env.FPCAD_JPEG_FREEZE,testedBuild,directory,resumeInput,scope:resumeInput?'Independent retry of exactly the original native input and native deadline. Original extraction/placement/complex-source checks remain evidence from the first run and are not claimed as repeated.':'Fresh original JPEG through the actual native UI/API chain.',steps:[],qualityIssues:[],pageErrors:[],processes:[],complexSourcePolicy:'A separate, explicitly 180 mm wide copy of the saved real 318-cubic / 6-hole source is tested on the actual curved chest. It is removed by real undo before cutting the unmodified JPEG placements.'};
if(replayInput){report.scope='Downstream native acceptance/persistence/output replay of a pinned historical real 65-piece candidate. No cut is executed. This does not replace either failed 1935 fresh native cut.';report.replay={input:replayInput,sha256:sha256(replayBytes),candidatePublishedByNativeCut:false};await writeFile(resolve(output,'immutable-real-65-project.json'),replayBytes);}
if(replayFull){report.replay.fullResult={path:replayFullPath,sha256:sha256(replayFullBytes),mappedMarkings:replayFull.markings.length,paths:replayFull.markings.reduce((n,m)=>n+m.paths.length,0)};await writeFile(resolve(output,'immutable-full-candidate-result.json'),replayFullBytes);}
function registerProcess(){const pid=app.process().pid;setPriority(pid,constants.priority.PRIORITY_LOW);report.processes.push({pid,priority:getPriority(pid),closed:false});}
registerProcess();
page.on('pageerror',e=>report.pageErrors.push(e.message));
// Preserve every project field while avoiding CDP's per-node object wrapper
// for 100+ MB accepted documents. Mutation replies need only status here.
async function read(){const json=await page.evaluate(async()=>{const r=await window.fpcad.read();if(!r.ok)throw Error(JSON.stringify(r));return JSON.stringify(r.data.project);});return JSON.parse(json);}
async function native(method,...args){return page.evaluate(async({method,args})=>{const r=await window.fpcad[method](...args);return {ok:r.ok,error:r.error,...(r.autoPlacementReport?{autoPlacementReport:r.autoPlacementReport}:{})};},{method,args});}
async function mutate(method,...args){return page.evaluate(async({method,args})=>{const p=(await window.fpcad.read()).data.project,r=await window.fpcad[method](p.id,p.revision,...args);return {ok:r.ok,error:r.error,...(r.autoPlacementReport?{autoPlacementReport:r.autoPlacementReport}:{})};},{method,args});}
async function capture(name){const project=await read();await writeFile(resolve(output,name+'.json'),JSON.stringify(project));return project;}
async function step(name,callback){console.log('START '+name);try{const evidence=await callback();report.steps.push({name,passed:true,evidence});console.log('PASS '+name);return evidence;}catch(error){report.steps.push({name,passed:false,error:String(error.stack??error)});await capture(name+'-failed-project').catch(()=>{});await desktopScreenshot(app,page,{path:resolve(output,name+'-failure.png')}).catch(()=>{});return undefined;}finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));}}
function candidateHash(project){
 const {surface,pieces,bindings,markings,patternLibrary,materials,defaultAllowanceMm}=project;
 const references=project.references?.map(({id,view,calibration,illustration})=>({id,view,calibration,illustration}));
 const used=new Set([project.activeCutId,...(markings??[]).filter(m=>m.source==='cut-library').map(m=>m.cutLibraryId)]);
 const materialHistory=project.cuttingLibrary?.filter(e=>used.has(e.id)&&e.run.materialPalette).map(e=>({id:e.id,palette:e.run.materialPalette}));
 return sha256(JSON.stringify({surface,pieces,bindings,markings,patternLibrary,materials,defaultAllowanceMm,references,...(materialHistory?.length?{materialHistory}:{})}));
}
async function importCandidate(project,name){const file=resolve(output,name+'.workflow.json');await writeFile(file,JSON.stringify({format:'fpcad-workflow',version:1,project}));if(!await read()){const created=await native('create',{name:'Real historical candidate downstream replay',unit:'mm'});assert(created.ok);}await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),file);const r=await mutate('workflowFile','import');assert(r.ok,JSON.stringify(r));return capture(name+'-native-project');}
async function measureCandidate(p){
 const physical=assertDesignCutContract(p),count=p.surfaceRun.pieces.length;
 if(count<10||count>50)report.qualityIssues.push({kind:'colored-piece-count',actual:count,required:[10,50]});
 const vv=new Map(p.surface.vertices.map(v=>[v.id,[v.xMm,v.yMm,v.zMm]])),ff=new Map(p.surface.faces.map(f=>[f.id,f])),pieceById=new Map(p.surfaceRun.pieces.map(piece=>[piece.id,piece]));
 const panels=p.surfaceRun.bindings.map(binding=>{const area=binding.trim.triangles.reduce((sum,t)=>{const face=ff.get(t.faceId),points=t.barycentric.map(w=>[0,1,2].map(axis=>w.reduce((s,n,i)=>s+n*vv.get(face.vertices[i])[axis],0))),[a,b,c]=points,u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);return sum+Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;},0);return {id:binding.pieceId,name:pieceById.get(binding.pieceId).name,physicalAreaMm2:area};});
 const small=panels.filter(panel=>panel.physicalAreaMm2<100);
 let smallDomainAssociation;
 if(finalFresh){
  smallDomainAssociation=await auditSmallPhysicalPanels(p,{thresholdMm2:100,run:p.surfaceRun});await writeFile(resolve(output,'small-panel-domain-association.json'),JSON.stringify(smallDomainAssociation,null,2));
  const artificial=smallDomainAssociation.panels.filter(panel=>!panel.allowedTrueSmallDomain);
  if(!smallDomainAssociation.passed)report.qualityIssues.push({kind:'colored-small-artificial-fragments-or-unverified-domains',actual:artificial.length,required:0,panels:artificial,globalIssues:smallDomainAssociation.globalIssues,policy:'A whole independently established physical material domain is retained at its original size. Additional small pieces from larger domains, changed/unknown support or unavailable reference are failures. Never delete colour, resize artwork or approve by area alone.'});
  report.smallPanelPolicy={thresholdMm2:100,completeTrueSmallDomainsAllowed:true,artificialFragmentLimit:0,allowed:smallDomainAssociation.panels.filter(panel=>panel.allowedTrueSmallDomain),artificialOrUnverified:artificial,sourceCompatible:smallDomainAssociation.sourceCompatible};
 }else if(small.length)report.qualityIssues.push({kind:'colored-sub-100mm2-panels',actual:small.length,required:0,panels:small,policy:'Historical replay uses its original recorded size-only policy. It does not establish that every small panel is an artificial fragment, and cannot replace the current independent true-domain acceptance.'});
 await writeFile(resolve(output,'colored-panel-physical-areas.json'),JSON.stringify({thresholdMm2:100,small,panels,smallDomainAssociation},null,2));
 const colors=[...new Set(p.surfaceRun.pieces.map(p=>p.color))];assert(colors.length>=3,'Paper pieces preserve independently visible real material colors');
 if(finalFresh){assert.deepEqual([...colors].sort(),['#ede7ea','#02a6f4','#f9e33c'].sort(),'Fresh full-body material colours are the original white/blue/yellow cloth');assert.equal(p.surfaceRun.materialPalette?.algorithm,'reference-fabric-1');assert.equal(p.surfaceRun.materialPalette.baseColor,'#ede7ea');assert.equal(p.surfaceRun.materialPalette.markings.length,p.markings.filter(m=>m.fabrication!=='detail').length);}
 const physicalAreaByColor={};for(const panel of panels){const color=pieceById.get(panel.id).color;physicalAreaByColor[color]=(physicalAreaByColor[color]??0)+panel.physicalAreaMm2;}
 let independentMaterialAreaChecks;
 if(finalFresh){
  independentMaterialAreaChecks=Object.entries(smallDomainAssociation.expectedMaterialAreasByColor).map(([color,expectedMm2])=>{const actual=physicalAreaByColor[color]??0,independentActual=smallDomainAssociation.physicalAreaByColor[color]??0,differenceMm2=actual-expectedMm2,toleranceMm2=expectedMm2*smallDomainAssociation.limits.coverageRatio;return {color,expectedMm2,actualMm2:actual,independentActualMm2:independentActual,differenceMm2,toleranceMm2,passed:smallDomainAssociation.sourceCompatible&&Math.abs(differenceMm2)<=toleranceMm2&&Math.abs(actual-independentActual)<=toleranceMm2};});
  report.independentMaterialReference={fixture:'tests/fixtures/default-padded-three-material-small-domains.json',referenceInputSha256:smallDomainAssociation.referenceInputSha256,referenceRunSha256:smallDomainAssociation.referenceRunSha256,policy:'Additional per-colour physical-area conservation prevents deleting true tiny islands. Every established small domain must also be present exactly once with complete bidirectional support. Aggregate areas do not replace the independent complete footprint audit.'};
  if(independentMaterialAreaChecks.some(row=>!row.passed))report.qualityIssues.push({kind:'original-material-physical-area-changed',checks:independentMaterialAreaChecks});
 }
 report.materialEvidence={colors,physicalAreaByColor,independentMaterialAreaChecks,materialPalette:p.surfaceRun.materialPalette};
 return {pieces:count,colors,physical,physicalAreaByColor,smallPanels:small,largestPieceId:[...panels].sort((a,b)=>b.physicalAreaMm2-a.physicalAreaMm2)[0].id};
}
const inside=(p,r)=>{let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a.yMm>p.yMm)!==(b.yMm>p.yMm)&&p.xMm<(b.xMm-a.xMm)*(p.yMm-a.yMm)/(b.yMm-a.yMm)+a.xMm)yes=!yes;}return yes;};
function frontHit(surface,x,y){const vertices=new Map(surface.vertices.map(v=>[v.id,v]));let result;
  for(const f of surface.faces){const [a,b,c]=f.vertices.map(id=>vertices.get(id)),det=(b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm);if(Math.abs(det)<1e-12)continue;const u=((x-a.xMm)*(c.yMm-a.yMm)-(y-a.yMm)*(c.xMm-a.xMm))/det,v=((b.xMm-a.xMm)*(y-a.yMm)-(b.yMm-a.yMm)*(x-a.xMm))/det;if(u<0||v<0||u+v>1)continue;const z=a.zMm*(1-u-v)+b.zMm*u+c.zMm*v;if(!result||z>result.zMm)result={faceId:f.id,xMm:x,yMm:y,zMm:z};}assert(result,'Independent front ray must meet the real chest');return result;}
try{
  await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>!!window.fpcad);
  assert(app.process()?.pid);assert(await app.evaluate(({DesktopWindow})=>DesktopWindow.getAllWindows().every(w=>!w.isVisible())));
  report.webview=await app.webviewLaunchInfo();report.artifacts=await testedArtifacts(undefined,await app.evaluate(({host})=>host.getAppPath()));
  for(const [name,key] of [['main','FPCAD_JPEG_EXPECT_MAIN_SHA'],['surfaceWorker','FPCAD_JPEG_EXPECT_SURFACE_WORKER_SHA'],['nativeWorker','FPCAD_JPEG_EXPECT_NATIVE_WORKER_SHA']])if(process.env[key])assert.equal(report.artifacts[name].sha256,process.env[key].toLowerCase(),'Frozen '+name+' must match the approved build');
  report.hostSha256=sha256(await readFile(resolve(executablePath??'apps/desktop/src-tauri/target/debug/FurryPatternCAD.exe')));
  if(process.env.FPCAD_JPEG_EXPECT_HOST_SHA)assert.equal(report.hostSha256,process.env.FPCAD_JPEG_EXPECT_HOST_SHA.toLowerCase(),'Use the explicitly approved rebuilt native host');
  const helpers=resumeInput||replayInput?undefined:await auditRuntime(directory),parameters=helpers?.speciesDefaults('canine','padded');
  const originalPath=resolve('tests/fixtures/character-front-back.jpg');report.imageSha256=sha256(await readFile(originalPath));
  if(!resumeInput&&!replayInput){
  await app.evaluate(({dialog},path)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]}),originalPath);
  const seeded=await step('original-jpeg-and-default-padded',async()=>{
    const r=await page.evaluate(async parameters=>{let r=await window.fpcad.create({name:'Real JPEG on default padded garment',unit:'mm'});if(!r.ok)return r;let p=r.data.project;r=await window.fpcad.autoReference(p.id,p.revision,'front-right',1800,8,true);if(!r.ok)return r;p=r.data.project;return window.fpcad.generateSpecies(p.id,p.revision,parameters);},parameters);
    assert(r.ok,JSON.stringify(r));const p=await capture('extracted-default-padded');const originalSources=finalFresh?await assertFreshOriginalJpegSources(p,originalPath):undefined;if(originalSources)await writeFile(resolve(output,'fresh-source-independent-oracle.json'),JSON.stringify(originalSources,null,2));return {sources:p.patternLibrary.length,originalSources,scope:assertBodyModelScope(p.surface,'padded')};
  });
  assert(seeded,'Cannot run downstream tests without the real original and default garment');
  await step('automatic-body-placement',async()=>{
    const before=await read(),regions=new Set(before.surface.faces.map(f=>f.region));
    const presentPart=part=>part==='body'?regions.has('torso'):[...regions].some(region=>region===part||region.startsWith(part+'-'));
    // Keep actual foot/paw sources in the original library. A body-only shell
    // must report their missing physical parts, rather than reclassify them as
    // lower-leg paint or require imaginary feet to satisfy the coverage gate.
    const r=await page.evaluate(async()=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.autoPlaceMarkings(p.id,p.revision,p.patternLibrary.map(s=>s.piece.id),['body','arm','leg','foot','paw']);});
    await writeFile(resolve(output,'automatic-placement-response.json'),JSON.stringify(r));assert(r.ok,JSON.stringify(r));
    const p=await capture('automatically-mapped-project');report.automaticPlacement=r.autoPlacementReport;
    await page.reload();await workflow(page,'mapping');
    for(const [view,label] of [['front','正面'],['side','左侧'],['back','背面']]){await page.locator('.surface-panel').getByRole('button',{name:label,exact:true}).click();await desktopScreenshot(app,page,{path:resolve(output,'mapped-'+view+'.png')});}
    const actual=new Set((p.markings??[]).filter(m=>m.placement).map(m=>m.placement.part+':'+m.placement.side));
    const vertices=new Map(p.surface.vertices.map(v=>[v.id,v])),faces=new Map(p.surface.faces.map(f=>[f.id,f]));
    const signedArea=ring=>{const o=ring[0];return ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+(a[0]-o[0])*(b[1]-o[1])-(b[0]-o[0])*(a[1]-o[1]);},0)/2;};
    const cyanCoverage=[];
    for(const view of ['front','back']){
      const sign=view==='front'?1:-1,cyan=(p.markings??[]).filter(m=>m.view===view&&m.placement?.part==='body'&&parseInt(m.color.slice(1,3),16)<25&&parseInt(m.color.slice(5,7),16)>150);
      const denominator=p.surface.faces.filter(f=>f.region==='torso').reduce((s,f)=>s+Math.max(0,signedArea(f.vertices.map(id=>[sign*vertices.get(id).xMm,vertices.get(id).yMm]))),0);
      const rings=cyan.flatMap(m=>m.fragments.flatMap(f=>{const t=faces.get(f.faceId).vertices.map(id=>vertices.get(id));return f.rings.map(r=>r.map(w=>[sign*w.reduce((s,n,i)=>s+n*t[i].xMm,0),w.reduce((s,n,i)=>s+n*t[i].yMm,0)]));}));
      const points=rings.flat(),fraction=Math.abs(rings.reduce((s,r)=>s+signedArea(r),0))/denominator,height=points.length?Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1])):0;
      cyanCoverage.push({view,fraction,heightMm:height,cyanSources:cyan.length});
      if(!(fraction>(view==='front'?.25:.4)&&height>450))report.qualityIssues.push({kind:'dominant-cyan-body-coverage',view,fraction,heightMm:height,requiredFraction:view==='front'?.25:.4,requiredHeightMm:450});
    }
    report.cyanBodyCoverage=cyanCoverage;
    const required=['body:center',...['arm','leg','foot','paw'].filter(presentPart).flatMap(part=>['left','right'].map(side=>part+':'+side))];
    const missing=required.filter(key=>!actual.has(key));
    assert.deepEqual(missing,[],'Every supported physical garment part receives real artwork');
    assert.deepEqual(p.patternLibrary,before.patternLibrary,'Automatic projection keeps every original source and its classification');
    const absentParts=[];
    for(const part of ['foot','paw'].filter(part=>!presentPart(part))){
      const sources=before.patternLibrary.filter(source=>{const a=source.anatomy,contexts=a?.method!=='manual'&&a?.contexts?.length?a.contexts:a?[a]:[];return contexts.some(a=>a.part===part);});
      assert(sources.length>0,'The original JPEG retains genuine '+part+' sources as missing-part evidence');
      for(const source of sources)assert((r.autoPlacementReport?.skipped??[]).some(s=>s.pieceId===source.piece.id&&s.reason==='MODEL_PART_MISSING'),'Missing '+part+' source must be explicitly reported: '+source.piece.name);
      assert(!(p.markings??[]).some(m=>m.placement?.part===part),'Absent '+part+' cannot be painted onto the legs');
      absentParts.push({part,sourceIds:sources.map(s=>s.piece.id),reason:'MODEL_PART_MISSING'});
    }
    assert.equal((r.autoPlacementReport?.skipped??[]).filter(s=>s.reason==='AMBIGUOUS_PROJECTION').length,0,'Normal automatic body placements must not report coplanar projection ambiguity');
    assert.equal((r.autoPlacementReport?.skipped??[]).filter(s=>s.reason==='NO_VISIBLE_PROJECTION').length,0,'Supported body sources must not lose their visible projection');
    assert((p.markings??[]).every(m=>m.placement&&!m.placement.reviewed),'Automatic placements remain explicitly unreviewed');
    return {placed:p.markings?.length??0,parts:[...actual],requiredParts:required,absentParts,report:r.autoPlacementReport,cyanCoverage};
  });
  await step('complex-real-source-chest-drop',async()=>{
    const before=await read(),legacy=JSON.parse(await readFile('tests/fixtures/legacy-curved-character-piece.json','utf8'));
    const xs=legacy.nodes.map(n=>n.xMm),ys=legacy.nodes.map(n=>n.yMm),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2,scale=180/(Math.max(...xs)-Math.min(...xs));
    const point=n=>({...n,xMm:(n.xMm-cx)*scale,yMm:(n.yMm-cy)*scale});
    const source={...legacy,id:randomUUID(),name:'Real complex contour at explicit 180 mm width',nodes:legacy.nodes.map(point),holes:legacy.holes.map(r=>r.map(point)),curves:legacy.curves.map(c=>({...c,c1:point(c.c1),c2:point(c.c2)}))};
    const candidates=[];for(let y=-100;y<=100;y+=5)for(let x=-75;x<=75;x+=5){const p={xMm:x,yMm:y};if(inside(p,source.nodes)&&!source.holes.some(h=>inside(p,h)))candidates.push(p);}
    candidates.sort((a,b)=>Math.hypot(a.xMm,a.yMm)-Math.hypot(b.xMm,b.yMm));const anchor=candidates[0];assert(anchor,'Choose an actual interior grab point rather than a transparent hole');
    let put=false,dropped=false;
    try{
      const r=await page.evaluate(async source=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.apply(p.id,p.revision,{type:'library.region.put',region:{piece:source,referenceId:p.references.find(r=>r.view==='front').id,view:'front',category:'body',anatomy:{part:'body',side:'center',confidence:1,method:'manual'}}});},source);assert(r.ok,JSON.stringify(r));put=true;
      await page.reload();await workflow(page,'mapping');await page.locator('.surface-panel').getByRole('button',{name:'正面',exact:true}).click();
      const p=await read(),mesh=p.surface,x=0,y=1250,hit=frontHit(mesh,x,y),v=mesh.vertices;
      const b={cx:(Math.min(...v.map(p=>p.xMm))+Math.max(...v.map(p=>p.xMm)))/2,cy:(Math.min(...v.map(p=>p.yMm))+Math.max(...v.map(p=>p.yMm)))/2,extent:Math.max(...['xMm','yMm','zMm'].map(k=>Math.max(...v.map(p=>p[k]))-Math.min(...v.map(p=>p[k]))))};
      const card=page.locator('.mapping-page .region-card[data-region-id="'+source.id+'"]'),transfer=await page.evaluateHandle(()=>new DataTransfer());
      await card.dispatchEvent('dragstart',{dataTransfer:transfer});await transfer.evaluate((t,{id,anchor})=>{t.setData('application/x-fpcad-region',id);t.setData('application/x-fpcad-anchor',JSON.stringify(anchor));},{id:source.id,anchor});
      const drop=await surfaceCoordinates(page,(x-b.cx)*450/b.extent,-(y-b.cy)*450/b.extent);
      await page.evaluate(()=>{const view=document.querySelector('.surface-view');view.addEventListener('drop',event=>{const canvas=view instanceof HTMLCanvasElement?view:view.querySelector('canvas'),r=canvas.getBoundingClientRect(),s=getComputedStyle(canvas),n=v=>parseFloat(v)||0,left=n(s.borderLeftWidth)+n(s.paddingLeft),top=n(s.borderTopWidth)+n(s.paddingTop),width=r.width-left-n(s.borderRightWidth)-n(s.paddingRight),height=r.height-top-n(s.borderBottomWidth)-n(s.paddingBottom);window.__reportedDropEvent={clientX:event.clientX,clientY:event.clientY,viewport:{x:r.x+left,y:r.y+top,width,height,scale:Math.min(width/720,height/540)}};},{once:true});});
      await page.locator('.surface-view').dispatchEvent('drop',{dataTransfer:transfer,clientX:drop.x,clientY:drop.y});await card.dispatchEvent('dragend',{dataTransfer:transfer});await transfer.dispose();
      await page.waitForFunction(async revision=>{const r=await window.fpcad.read();return r.ok&&(r.data.project.revision>revision||!!document.querySelector('.error-banner')||!!document.querySelector('.drop-message')?.textContent);},p.revision,{timeout:120000});
      const after=await capture('complex-drop-project'),mark=(after.markings??[]).find(m=>m.name===source.name);dropped=!!mark;
      await desktopScreenshot(app,page,{path:resolve(output,'complex-chest-drop.png')});assert(mark,JSON.stringify({dropMessage:await page.locator('.drop-message').allTextContents(),errors:await page.locator('.error-banner').allTextContents()}));
      assert.equal(mark.surfaceShape.curves.length,318);assert.equal(mark.surfaceShape.holes.length,6);assert(mark.fragments.length>0);assert.deepEqual(after.patternLibrary.find(s=>s.piece.id===source.id).piece,source);
      const observed=await page.evaluate(()=>window.__reportedDropEvent),vp=observed.viewport;
      const actualX=b.cx+(observed.clientX-vp.x-vp.width/2)/vp.scale/(450/b.extent),actualY=b.cy-(observed.clientY-vp.y-vp.height/2)/vp.scale/(450/b.extent),actualHit=frontHit(mesh,actualX,actualY);
      // sourceSurfaceShape translates the selected source anchor to UV zero.
      // Use the actual DOM DragEvent coordinates, whose integer conversion can
      // differ from the requested fractional CSS point by a visible pixel.
      const placedGrab=[...mark.surfaceShape.origin];
      const evidence={originalWidthMm:Math.max(...xs)-Math.min(...xs),testedWidthMm:180,curves:318,holes:6,fragments:mark.fragments.length,intendedHit:hit,observedEvent:observed,independentActualHit:actualHit,placedGrab};
      await writeFile(resolve(output,'complex-drop-visible-hit.json'),JSON.stringify(evidence,null,2));
      assert(Math.hypot(placedGrab[0]-actualHit.xMm,placedGrab[1]-actualHit.yMm,placedGrab[2]-actualHit.zMm)<1e-4,'The actual DOM drop ray receives the grabbed material point');
      return evidence;
    }finally{
      for(let i=0;i<Number(put)+Number(dropped);i++){const r=await page.evaluate(async()=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.undo(p.id,p.revision);});assert(r.ok,JSON.stringify(r));}
      const restored=await read();assert.deepEqual(restored.markings??[],before.markings??[],'Undo removes the explicit test decal and preserves automatic real-artwork placements');assert.deepEqual(restored.patternLibrary,before.patternLibrary);
    }
  });
  }else if(resumeInput)await step('resume-exact-unchanged-native-cut-input',async()=>{const project=await capture('resumed-native-project');assert.deepEqual(project,expectedResume,'The timed-out native job left the exact original project, UUIDs, source geometry, settings and revision unchanged');assert(!project.surfaceRun);await page.reload();await workflow(page,'cutting');return {input:resumeInput,inputSha256:sha256(await readFile(resumeInput)),revision:project.revision,faces:project.surface.faces.length,markings:project.markings.length,scope:assertBodyModelScope(project.surface,'padded')};});
  else await step('import-pinned-historical-real-candidate',async()=>{const p=await importCandidate(replayProject,'raw-65');assert.deepEqual(p.surface,replayProject.surface);assert.deepEqual(p.surfaceRun,replayProject.surfaceRun);assert.deepEqual(p.patternLibrary,replayProject.patternLibrary);assert.deepEqual(p.markings,replayProject.markings);if(replayFull)assert.deepEqual(p.previewMarkings,replayFull.markings);return {sha256:sha256(replayBytes),pieces:p.surfaceRun.pieces.length,physical:assertDesignCutContract(p),scope:assertBodyModelScope(p.surface,'padded')};});
  const cut=replayInput?await step('real-candidate-publication-review-and-stale-guards',async()=>{
    let p=await read();const immutableRun=structuredClone(replayProject.surfaceRun),runGeometry=run=>{const {inputHash,...geometry}=run;return geometry;};
    const refused=await mutate('acceptSurface',true);assert(!refused.ok);assert.equal(refused.error.code,'STALE_RESULT');assert.deepEqual(await read(),p,'Missing publication fingerprint cannot mutate the project');
    if(p.markings.every(m=>!m.placement||m.placement.reviewed)){
      p=await importCandidate({...p,surfaceRun:{...immutableRun,inputHash:candidateHash(p)}},'original-reviewed-published-65');assert.deepEqual(p.markings,replayProject.markings,'Original native review flags and every registration fingerprint remain untouched');assert.deepEqual(runGeometry(p.surfaceRun),runGeometry(immutableRun));assert.deepEqual(p.surface,replayProject.surface);assert.deepEqual(p.patternLibrary,replayProject.patternLibrary);report.replay.publication={rawStaleRefused:true,reviewAlreadyExplicitInOriginalNativeInput:true,reviewFlagsChanged:false,sourceDependenciesRebased:false,geometryRecalculated:false,onlyRunMetadataAdded:'inputHash',runGeometrySha256:sha256(JSON.stringify(runGeometry(p.surfaceRun)))};await page.reload();await workflow(page,'cutting');await desktopScreenshot(app,page,{path:resolve(output,'historical-real-65-candidate.png')});return measureCandidate(p);
    }
    p=await importCandidate({...p,surfaceRun:{...immutableRun,inputHash:candidateHash(p)}},'unreviewed-published-65');const unreviewedBefore=await read(),unreviewed=await page.evaluate(async()=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.acceptSurface(p.id,p.revision,true);});assert(!unreviewed.ok);assert.equal(unreviewed.error.code,'AUTOMATIC_PLACEMENT_REVIEW');assert.deepEqual(await read(),unreviewedBefore,'Unreviewed automatic placements cannot be silently accepted');
    const reviewed=await page.evaluate(async()=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.apply(p.id,p.revision,{type:'marking.placement.review',markingIds:p.markings.filter(m=>m.placement).map(m=>m.id),reviewed:true});});assert(reviewed.ok,JSON.stringify(reviewed));p=await read();assert(!p.surfaceRun,'Actual explicit native review correctly invalidates the old candidate');assert(p.markings.every(m=>!m.placement||m.placement.reviewed));
    const compared=structuredClone(p.markings);for(const m of compared)if(m.placement)m.placement.reviewed=false;assert.deepEqual(compared,replayProject.markings,'Explicit review changes no projection, source dependency or fragment');
    p=await importCandidate({...p,surfaceRun:{...immutableRun,inputHash:candidateHash(p)}},'reviewed-published-65');assert.deepEqual(runGeometry(p.surfaceRun),runGeometry(immutableRun),'Replay publication changes no actual calculated geometry/UV/seam/material result');assert.deepEqual(p.surface,replayProject.surface);assert.deepEqual(p.patternLibrary,replayProject.patternLibrary);
    report.replay.publication={rawStaleRefused:true,unreviewedRefused:true,explicitNativeReview:true,geometryRecalculated:false,onlyRunMetadataAdded:'inputHash',runGeometrySha256:sha256(JSON.stringify(runGeometry(p.surfaceRun)))};await page.reload();await workflow(page,'cutting');await desktopScreenshot(app,page,{path:resolve(output,'historical-real-65-candidate.png')});return measureCandidate(p);
  }):await step('real-jpeg-colored-cut',async()=>{
    const unreviewed=(await read()).markings.filter(m=>m.placement&&!m.placement.reviewed);if(unreviewed.length){await page.reload();await workflow(page,'mapping');await page.locator('.mapping-page').getByRole('button',{name:/^已检查并确认自动贴附位置/}).click();await waitForIdle(page);assert((await read()).markings.filter(m=>m.placement).every(m=>m.placement.reviewed),'Only the actual UI review command can approve these automatic placements');}report.placementReview={method:'actual-native-ui-review-button',reviewedMarkings:unreviewed.length};
    await page.reload();await workflow(page,'cutting');assert(await page.getByLabel('按花纹颜色拆分裁片',{exact:true}).isChecked());
    const input=await capture('colored-cut-input');
    if(expectedResume)assert.deepEqual(input,expectedResume,'Retry does not even add a redundant review revision');
    const points=input.markings.reduce((n,m)=>n+m.fragments.reduce((s,f)=>s+f.rings.reduce((z,r)=>z+r.length,0),0),0);report.nativeCalculation={started:new Date().toISOString(),points,faces:input.surface.faces.length,nativeDeadlineMs:Math.min(900000,Math.max(60000,points*20,input.surface.faces.length*40))};if(finalFresh)assert.equal(report.nativeCalculation.nativeDeadlineMs,511920,'The original native solve deadline remains 511920ms; no acceptance budget extension');await writeFile(resolve(output,'native-calculation.json'),JSON.stringify(report.nativeCalculation,null,2));
    const progressStream=createWriteStream(resolve(output,'cut-progress.ndjson'),{flags:'wx'});let lastStage,lastConsoleAt=0;
    const progressListener=message=>{const text=message.text();if(!text.startsWith('FPCAD_CUT_PROGRESS '))return;const raw=text.slice('FPCAD_CUT_PROGRESS '.length);progressStream.write(raw+'\n');const p=JSON.parse(raw);if(p.stage!==lastStage||p.elapsedMs-lastConsoleAt>=30000){console.log('CUT '+JSON.stringify(p));lastStage=p.stage;lastConsoleAt=p.elapsedMs;}};
    page.on('console',progressListener);await page.evaluate(({id,revision})=>{const start=performance.now();window.__jpegCutProgress=[];window.__jpegCutStop=window.fpcad.onSurfaceProgress(progress=>{if(progress.projectId!==id||progress.revision!==revision)return;const record={...progress,observedAt:new Date().toISOString(),elapsedMs:performance.now()-start};window.__jpegCutProgress.push(record);console.log('FPCAD_CUT_PROGRESS '+JSON.stringify(record));});},{id:input.id,revision:input.revision});
    const observer=await observeNativeResponses(page,directory,['surface.unwrap']);
    await page.getByRole('button',{name:'自动计算裁线并预览',exact:true}).click();
    await page.waitForFunction(()=>!!document.querySelector('.run-report > strong')||!!document.querySelector('.error-banner'),undefined,{timeout:920000});
    await page.evaluate(()=>window.__jpegCutStop?.());page.off('console',progressListener);await new Promise(ok=>progressStream.end(ok));const progress=await page.evaluate(()=>window.__jpegCutProgress);await writeFile(resolve(output,'cut-progress.json'),JSON.stringify(progress,null,2));report.nativeCalculation.finished=new Date().toISOString();report.nativeCalculation.lastProgress=progress.at(-1);await writeFile(resolve(output,'native-calculation.json'),JSON.stringify(report.nativeCalculation,null,2));
    const p=await capture('colored-cut-candidate-project'),nativeReply=await observer.waitFor('surface.unwrap',0,30000),productionReply=nativeReply.result,banners=await page.locator('.error-banner').allTextContents();await observer.stop();report.nativeCalculation.actualIpcTiming=nativeReply.requestTiming;report.nativeCalculation.actualIpcResponseEndMs=nativeReply.requestTiming.responseEnd;report.nativeCalculation.uiObservationTimeoutMs=920000;report.nativeCalculation.observationScope='UI observation includes response transport; it does not change the native solver deadline.';await writeFile(resolve(output,'native-calculation.json'),JSON.stringify(report.nativeCalculation,null,2));await writeFile(resolve(output,'colored-native-response.json'),JSON.stringify(nativeReply,null,2));
    await writeFile(resolve(output,'colored-cut-result.json'),JSON.stringify({productionReply,banners,candidatePresent:!!p.surfaceRun,failureProjectUnchanged:!p.surfaceRun?JSON.stringify(p)===JSON.stringify(input):null},null,2));
    assert.deepEqual(banners,[],JSON.stringify({productionReply,banners}));assert(p.surfaceRun,'The completed real cut produces an actual candidate');
    await writeFile(resolve(output,'colored-cut-candidate.json'),JSON.stringify(p.surfaceRun));
    await desktopScreenshot(app,page,{path:resolve(output,'colored-cutting.png')});return measureCandidate(p);
  });
  const persisted=cut?await step('accept-save-and-real-outputs',async()=>{
    const accepted=await mutate('acceptSurface',true);assert(accepted.ok,JSON.stringify(accepted));
    const p=await capture('accepted-project');assert.equal(p.pieces.length,cut.pieces);assert.equal(p.cuttingLibrary.length,1);if(finalFresh){assert.deepEqual(p.cuttingLibrary[0].run.materialPalette,report.materialEvidence.materialPalette,'Accepted immutable history retains the exact candidate material interpretation');assert.deepEqual(p.patternLibrary,JSON.parse(await readFile(resolve(output,'colored-cut-input.json'),'utf8')).patternLibrary,'Accepting material interpretation changes no original source artwork');}
    const outputs=[];for(const format of ['fpcad','svg','dxf']){
      const path=resolve(output,'real-jpeg-padded.'+format);await app.evaluate(({dialog},path)=>dialog.showSaveDialog=async()=>({canceled:false,filePath:path}),path);
      const r=await page.evaluate(async format=>{const s=await window.fpcad.read(),p=s.data.project,r=format==='fpcad'?await window.fpcad.save(p.id,p.revision,true):await window.fpcad.export(p.id,p.revision,format,s.data.geometry.flatMap(g=>g.issues.filter(i=>i.severity==='warning').map(i=>i.ruleId)));return {ok:r.ok,error:r.error};},format);assert(r.ok,JSON.stringify(r));const bytes=await readFile(path);assert(bytes.length>1000);outputs.push({format,path,bytes:bytes.length,sha256:sha256(bytes)});
      if(format==='fpcad'){
        const expected=await read();
        await app.evaluate(({dialog},path)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]}),path);
        const opened=await native('open');assert(opened.ok,JSON.stringify(opened));
        const restored=await capture('reopened-project');
        for(const key of ['pieces','surface','markings','bindings','materials','cuttingLibrary','activeCutId','patternLibrary','references'])assert.deepEqual(restored[key],expected[key],`Reopening the actual saved archive preserves ${key}`);
        await page.reload();await workflow(page,'cutting');
      }
    }
    const svg=await readFile(resolve(output,'real-jpeg-padded.svg'),'utf8');assert(svg.includes('mm')&&svg.includes('M10 12 H110'));const openingTag=svg.slice(0,svg.indexOf('>')+1),svgWidth=Number(openingTag.match(/width="([\d.eE+-]+)mm"/)?.[1]),svgHeight=Number(openingTag.match(/height="([\d.eE+-]+)mm"/)?.[1]),viewBox=openingTag.match(/viewBox="([^"]+)"/)?.[1].trim().split(/\s+/).map(Number);assert(svgWidth>0&&svgHeight>0&&viewBox?.length===4);assert.deepEqual(viewBox,[0,0,svgWidth,svgHeight],'One SVG coordinate equals one physical millimetre');
    const dxf=await readFile(resolve(output,'real-jpeg-padded.dxf'),'utf8');assert(dxf.includes('SECTION')&&dxf.includes('ENTITIES')&&dxf.includes('MARKING'),'Real DXF contains physical geometry and mapped markings');assert(/\$INSUNITS\s+70\s+4(?:\s|$)/.test(dxf),'DXF INSUNITS remains millimetres');report.exportScale={svg:{widthMm:svgWidth,heightMm:svgHeight,viewBox,coordinatesPerMm:1},dxf:{insunits:4,unit:'mm'}};
    const expectedPaths=p.markings.reduce((n,m)=>n+m.paths.filter(path=>path.rings.some(r=>r.length>=3)).length,0);assert(expectedPaths>0,'Actual returned previewMarkings must survive candidate acceptance');const svgPaths=await page.evaluate(svg=>{const doc=new DOMParser().parseFromString(svg,'image/svg+xml');return [...doc.querySelectorAll('#Marking path')].filter(p=>!!p.getAttribute('d')?.trim()).length;},svg);assert(svgPaths>=expectedPaths,'SVG contains actual mapped paths, not an empty Marking layer');const codes=dxf.split(/\r?\n/),entities=[];let entity;for(let i=0;i+1<codes.length;i+=2){const code=codes[i].trim(),value=codes[i+1].trim();if(code==='0'){if(entity)entities.push(entity);entity={type:value};}else if(code==='8'&&entity)entity.layer=value;}if(entity)entities.push(entity);const dxfMarkings=entities.filter(e=>['LWPOLYLINE','POLYLINE'].includes(e.type)&&e.layer==='MARKING').length;assert(dxfMarkings>0,'DXF contains actual Marking entities, not just a layer-table name');report.mappedOutput={expectedPaths,svgPaths,dxfMarkings};
    await workflow(page,'assembly');await page.waitForFunction(()=>Number(document.querySelector('.assembly-page canvas')?.dataset.triangles)>0);assert((await page.locator('.assembly-page .assembly-coverage').innerText()).includes('100.0%'));await desktopScreenshot(app,page,{path:resolve(output,'assembly.png')});
    return {pieces:p.pieces.length,archiveId:p.activeCutId,svgBytes:Buffer.byteLength(svg),outputs};
  }):undefined;
  const acceptedReady=!!persisted||!!(cut&&(await read()).surfaceRun?.accepted);
  if(acceptedReady)await step('accepted-recovery-and-undo-redo',async()=>{
    const before=await read(),path=resolve(output,'recovery-checkpoint.fpcad');await app.evaluate(({dialog},path)=>dialog.showSaveDialog=async()=>({canceled:false,filePath:path}),path);
    const saved=await mutate('save',true);assert(saved.ok,JSON.stringify(saved));
    const session=await page.evaluate(async()=>{const r=await window.fpcad.read();return {ok:r.ok,data:{recovery:r.data.recovery}};});assert(session.ok);assert(session.data.recovery.includes(before.revision),'The saved accepted revision is an actual recovery point');
    const same=project=>{for(const key of ['pieces','surface','markings','bindings','seams','materials','cuttingLibrary','activeCutId','patternLibrary','references'])assert.deepEqual(project[key],before[key],'History/recovery preserves accepted '+key);};
    const renamed=await mutate('apply',{type:'project.rename',name:before.name+' recovery probe'});assert(renamed.ok,JSON.stringify(renamed));assert.equal((await read()).name,before.name+' recovery probe');same(await read());
    for(const forward of [false,true]){const r=await mutate(forward?'redo':'undo');assert(r.ok,JSON.stringify(r));const p=await read();assert.equal(p.name,forward?before.name+' recovery probe':before.name);same(p);}
    const restored=await mutate('restore',before.revision);assert(restored.ok,JSON.stringify(restored));const p=await capture('recovery-restored-project');assert.equal(p.name,before.name);same(p);await page.reload();return {checkpointRevision:before.revision,restoredRevision:p.revision,checkpointBytes:(await readFile(path)).length,undoRedo:true};
  });
  if(acceptedReady)await step('real-manufacturing-preview-and-pdf',async()=>{
    await workflow(page,'pattern');await page.getByLabel('界面模式',{exact:true}).selectOption('false');const before=await read(),selection=page.locator('.cut-selection');assert.equal(await selection.locator('.cut-row').count(),before.pieces.length);
    for(const tab of ['材料','接缝','排料']){await page.getByLabel('界面模式',{exact:true}).selectOption('true');await page.getByRole('tab',{name:tab,exact:true}).click();assert.equal(await page.getByRole('tab',{name:tab,exact:true}).getAttribute('aria-selected'),'true');await page.getByLabel('界面模式',{exact:true}).selectOption('false');assert.deepEqual(await page.locator('.pattern-subtabs').getByRole('tab').allTextContents(),['版型预览']);for(const cls of ['materials-panel','seams-panel','nesting-panel'])assert.equal(await page.locator('.pattern-tools .'+cls).count(),0);}report.manufacturingModes={eachAdvancedTab:['材料','接缝','排料'],simpleOnlyPreview:true};
    await selection.getByLabel('全选当前列表',{exact:true}).uncheck();const row=selection.locator('.cut-row').filter({has:page.locator('input[value="'+cut.largestPieceId+'"]')});assert.equal(await row.count(),1);await row.locator('.piece-row').click();
    const warning=selection.getByLabel(/已检查并确认当前制造警告/);if(await warning.count())await warning.check();await selection.getByRole('button',{name:'单片分页拼接预览',exact:true}).click();const preview=page.getByRole('dialog',{name:'分页与拼接预览',exact:true});await preview.waitFor();const image=preview.locator('.print-sheet-view image');assert.equal(await image.count(),1);assert((await image.getAttribute('href')).startsWith('data:image/svg+xml;'));await desktopScreenshot(app,page,{path:resolve(output,'real-piece-pagination-preview.png')});await page.keyboard.press('Escape');await preview.waitFor({state:'hidden'});
    const path=resolve(output,'real-jpeg-largest-piece.pdf');await app.evaluate(({dialog},path)=>dialog.showSaveDialog=async()=>({canceled:false,filePath:path}),path);await selection.getByRole('button',{name:'单片 PDF',exact:true}).click();await waitForIdle(page,{timeout:120000});const bytes=await readFile(path),pdf=await PDFDocument.load(bytes);assert(pdf.getPageCount()>0);let calibratedPages=0;
    for(const sheet of pdf.getPages()){assert(Math.abs(sheet.getWidth()*25.4/72-210)<1e-7);assert(Math.abs(sheet.getHeight()*25.4/72-297)<1e-7);const contents=sheet.node.Contents(),refs=contents instanceof PDFArray?contents.asArray():[contents],text=refs.map(ref=>{const stream=pdf.context.lookup(ref);return stream instanceof PDFRawStream?new TextDecoder().decode(decodePDFRawStream(stream).decode()):'';}).join('\n'),lines=[...text.matchAll(/([-\d.eE]+) ([-\d.eE]+) m\s+([-\d.eE]+) ([-\d.eE]+) l\s+S/g)];assert(lines.some(m=>Math.abs((Number(m[3])-Number(m[1]))*25.4/72-100)<1e-7&&Number(m[2])===Number(m[4])),'Every actual A4 page retains the 100mm calibration ruler');calibratedPages++;}
    assert.deepEqual(await read(),before,'Real print preview/PDF cannot modify accepted geometry or project revision');return {pieceId:cut.largestPieceId,path,bytes:bytes.length,pages:pdf.getPageCount(),calibratedPages,sha256:sha256(bytes)};
  });
  if(acceptedReady)await step('real-process-restart-and-preview',async()=>{
    const expected=await read(),firstProcessId=app.process()?.pid;
    await app.close();report.processes.at(-1).closed=app.process().exitCode!==null||app.process().signalCode!==null;app=await desktop.launch(launchOptions);registerProcess();page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.pageErrors.push(e.message));
    await page.setViewportSize({width:1440,height:1000});await chooseProject(page);
    const restored=await capture('restarted-project');assert.deepEqual(restored,expected,'A true native process restart preserves the complete accepted project');
    const processId=app.process()?.pid;assert(processId&&processId!==firstProcessId,'Restart must create a new actual native process');
    const hostSha256=sha256(await readFile(resolve(executablePath??'apps/desktop/src-tauri/target/debug/FurryPatternCAD.exe')));assert.equal(hostSha256,report.hostSha256);
    await workflow(page,'pattern');await page.locator('svg.canvas').first().waitFor();assert(await page.locator('svg.canvas g[data-piece-id]').count()>0,'Accepted physical paper geometry renders after restart');
    await desktopScreenshot(app,page,{path:resolve(output,'restarted-paper-preview.png')});
    await workflow(page,'assembly');await page.waitForFunction(()=>Number(document.querySelector('.assembly-page canvas')?.dataset.triangles)>0);assert((await page.locator('.assembly-page .assembly-coverage').innerText()).includes('100.0%'));
    await desktopScreenshot(app,page,{path:resolve(output,'restarted-assembly.png')});
    return {firstProcessId,processId,hostSha256,pieces:restored.pieces.length,archives:restored.cuttingLibrary.length,webview:await app.webviewLaunchInfo()};
  });
  assert(await app.evaluate(({DesktopWindow})=>DesktopWindow.getAllWindows().every(w=>!w.isVisible())));
  report.functionalPassed=report.steps.length===(resumeInput||replayInput?6:8)&&report.steps.every(s=>s.passed)&&report.pageErrors.length===0;
  report.passed=report.functionalPassed&&report.qualityIssues.length===0;
  assert(report.passed,JSON.stringify({failures:report.steps.filter(s=>!s.passed),qualityIssues:report.qualityIssues,pageErrors:report.pageErrors}));
}catch(error){report.error=String(error.stack??error);throw error;}
finally{await app.close();report.processes.at(-1).closed=app.process().exitCode!==null||app.process().signalCode!==null;await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));}
