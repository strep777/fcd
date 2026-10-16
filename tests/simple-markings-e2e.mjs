import {desktopScreenshot} from './desktop-screenshot.mjs';
import {chooseProject} from './ui-navigation.mjs';
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {executablePath,desktopArgs} from './desktop-launch.mjs';
const directory=await mkdtemp(resolve('.local/tests/simple-markings-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath,args:desktopArgs,env}),page=await app.firstWindow(),checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.setViewportSize({width:1440,height:960});await page.waitForFunction(()=>!!window.fpcad);
 await page.evaluate(()=>window.fpcad.create({name:'用户双视图简单模式',unit:'mm'}));
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},resolve('tests/fixtures/character-front-back.jpg'));
 const response=await page.evaluate(async()=>{const r=await window.fpcad.read();return window.fpcad.autoReference(r.data.project.id,r.data.project.revision,'front-right',1800,6,true);});assert(response.ok,JSON.stringify(response));
 const project=response.data.project,regions=project.patternLibrary;
 await writeFile('.local/auto-reference-fixture.json',JSON.stringify(project.references));
 const metrics={regions:regions.length,curves:regions.filter(r=>r.piece.curves?.length).length,categories:[...new Set(regions.map(r=>r.category))],views:[...new Set(regions.map(r=>r.view))]};
 await writeFile('test-results/simple-markings-metrics.json',JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics));
 assert.notEqual(project.references.find(r=>r.view==='front').width,Math.ceil(1275/2),'original drawing gutter is not the image midpoint');assert(project.references.every(r=>!r.illustration.edgeClipped),'original silhouettes must not be cut into the other view');
 assert(regions.length<=120,'simple mode must avoid hundreds of edge/shading fragments');
 assert(regions.some(r=>r.anatomy?.part==='head'),'head markings need semantic classification');
 assert(regions.some(r=>r.anatomy?.part==='body'),'body markings need semantic classification');
 assert(regions.some(r=>r.anatomy?.part==='foot'),'foot markings need semantic classification');
 assert(regions.some(r=>r.anatomy?.part==='paw'),'paw markings need semantic classification');
 assert(metrics.curves>0&&metrics.curves<regions.length,'simple mode keeps measured arcs and straight-edged source regions');assert(regions.every(r=>r.piece.closed&&r.piece.nodes.length>=3),'Every source remains a closed editable vector');
 checks.push('real JPEG front/back views yield edge-constrained, anatomically classified color regions');
 await page.reload();await chooseProject(page);await page.waitForFunction(()=>document.querySelector('.region-card'));
 assert.equal(await page.getByLabel('界面模式',{exact:true}).inputValue(),'false');assert.equal(await page.locator('.cross-view-completion').count(),0);
 await page.locator('[data-stage=guide]').click();assert((await page.locator('.guide-page').innerText()).includes('像素不是毫米'));await page.locator('[data-stage=references]').click();
 assert.equal(await page.locator('svg.mask-view').count(),1);assert.equal(await page.locator('.mask-view image').count(),1);
 const selected=regions[0];await page.locator(`.region-card[data-region-id="${selected.piece.id}"]`).click();const highlighted=page.locator(`.mask-view [data-source-region-id="${selected.piece.id}"][data-selected="true"]`);assert.equal(await highlighted.count(),1);assert.equal(await highlighted.getAttribute('fill'),'var(--accent)');assert.equal(await page.locator('.image-tools button svg').count(),6);await page.locator('.workspace-heading strong').click();assert.equal(await page.locator('.region-settings').count(),0);checks.push('simple-mode library selection highlights original source; blank click dismisses detail');
 await desktopScreenshot(app,page,{path:'test-results/simple-markings.png'});checks.push('simple interface explains units and shows independent front/back part comparisons');
 // These original-image witnesses identify the two actual yellow thigh
 // markings. Region numbers change when false cast-shadow islands disappear.
 const legSources=await page.evaluate(async witnesses=>{const p=(await window.fpcad.read()).data.project;return witnesses.map(w=>{const owners=p.patternLibrary.filter(r=>r.view==='front'&&document.querySelector(`.mask-view [data-source-region-id="${r.piece.id}"]`).isPointInFill(new DOMPoint(w.x+.5,w.y+.5)));if(owners.length!==1)throw Error('Expected one original-image thigh source at '+w.x+','+w.y);return {...w,pieceId:owners[0].piece.id,originalAnatomy:owners[0].anatomy,color:owners[0].piece.color};});},[{x:150,y:520,side:'right'},{x:350,y:556,side:'left'}]);
 assert.equal(new Set(legSources.map(s=>s.pieceId)).size,2);for(const source of legSources){assert.equal(source.originalAnatomy.part,'unknown','A cross-band thigh marking requires explicit anatomy review');const rgb=[1,3,5].map(i=>parseInt(source.color.slice(i,i+2),16));assert(rgb[0]>rgb[2]*2&&rgb[1]>rgb[2]*2,'The reviewed source must be real yellow pigment');}
 const sourceIds=regions.map(r=>r.piece.id),box=(region,w,h,y=0)=>{const points=[[-w/2,y,-w/2],[w/2,y,-w/2],[w/2,y+h,-w/2],[-w/2,y+h,-w/2],[-w/2,y,w/2],[w/2,y,w/2],[w/2,y+h,w/2],[-w/2,y+h,w/2]],faces=[[1,3,2],[1,4,3],[5,6,7],[5,7,8],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,4,8],[3,8,7],[4,1,5],[4,5,8]];return points.map(p=>'v '+p.join(' ')).join('\n')+'\ng '+region+'\n'+faces.map(f=>'f '+f.join(' ')).join('\n');};
 const tpose=()=>{let vertex=0;const quad=(x0,y0,x1,y1,z,back=false)=>{const first=vertex+1;vertex+=4;return [[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>`v ${x} ${y} ${z}`).join('\n')+`\nf ${first} ${first+(back?2:1)} ${first+(back?1:2)}\nf ${first} ${first+(back?3:2)} ${first+(back?2:3)}\n`;};return 'g unknown\n'+[50,-50].map(z=>[[-150,400,150,1000],[-550,800,-150,950],[150,800,550,950],[-150,0,-20,400],[20,0,150,400]].map(a=>quad(...a,z,z<0)).join('')).join('');};
 for(const kind of ['body','body-tpose','head','paw','foot']){
  const path=resolve(directory,kind+'.obj');await writeFile(path,kind==='body-tpose'?tpose():box('unnamed',kind==='body'?500:320,kind==='body'?850:kind==='head'?350:250));
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);
  let r=await page.evaluate(async()=>{const r=await window.fpcad.read();return window.fpcad.importSurface(r.data.project.id,r.data.project.revision,1);});assert(r.ok,JSON.stringify(r));
  r=await page.evaluate(async kind=>{const r=await window.fpcad.read();return window.fpcad.apply(r.data.project.id,r.data.project.revision,{type:'surface.classify',kind:kind==='body-tpose'?'body':kind,...(kind==='paw'||kind==='foot'?{side:'left'}:{})});},kind);assert(r.ok,JSON.stringify(r));
  if(kind==='body'){
   const before=(await page.evaluate(()=>window.fpcad.read())).data.project;
   for(const payload of [{type:'markings.batch',markings:[]},{type:'surface.anatomy',assignments:[{region:'unnamed',part:'body',side:'center'}],faceRegions:[{faceId:before.surface.faces[0].id,region:'forged'}]}]){const rejected=await page.evaluate(async payload=>{const r=await window.fpcad.read();return window.fpcad.apply(r.data.project.id,r.data.project.revision,payload);},payload);assert(!rejected.ok&&rejected.error.code==='FORBIDDEN');assert.deepEqual((await page.evaluate(()=>window.fpcad.read())).data.project,before);}
   const duplicate=await page.evaluate(async id=>{const r=await window.fpcad.read();return window.fpcad.autoPlaceMarkings(r.data.project.id,r.data.project.revision,[id,id]);},sourceIds[0]);assert(!duplicate.ok&&duplicate.error.code==='INVALID_SELECTION');assert.deepEqual((await page.evaluate(()=>window.fpcad.read())).data.project,before);
   const cancelled=await page.evaluate(async ids=>{const r=await window.fpcad.read(),work=window.fpcad.autoPlaceMarkings(r.data.project.id,r.data.project.revision,ids);await new Promise(resolve=>setTimeout(resolve,100));await window.fpcad.cancelSurface(r.data.project.id,r.data.project.revision);return work;},sourceIds);assert(!cancelled.ok&&cancelled.error.code==='CANCELLED');assert.deepEqual((await page.evaluate(()=>window.fpcad.read())).data.project,before);checks.push('duplicate selection, forged internal geometry and cancellation retain the whole previous project');
  }
  r=await page.evaluate(async ids=>{const r=await window.fpcad.read();return window.fpcad.autoPlaceMarkings(r.data.project.id,r.data.project.revision,ids);},sourceIds);assert(r.ok,JSON.stringify(r));assert(r.autoPlacementReport.placed>0,kind+': no sources placed');
  if(kind==='body-tpose'){
   // Previously this assertion passed because three false pink cast shadows
   // happened to have left/right leg labels. Genuine ambiguous sources must
   // stay rejected until the same public classification command as the UI.
   for(const source of legSources)assert(!r.data.project.markings.some(m=>m.sourcePieceId===source.pieceId),'A genuine ambiguous yellow thigh must remain unattached without anatomy review');
   assert(r.data.project.markings.filter(m=>m.placement.part==='leg').every(m=>!m.placement.reviewed),'Context candidates still require placement review');
   for(const source of legSources)assert(r.autoPlacementReport.skipped.some(s=>s.pieceId===source.pieceId&&s.reason==='ANATOMY_REQUIRED'));
   const centerLegs=r.data.project.patternLibrary.filter(s=>s.anatomy?.part==='leg'&&s.anatomy.side==='center');assert(centerLegs.length>0);for(const source of centerLegs)assert(r.autoPlacementReport.skipped.some(s=>s.pieceId===source.piece.id&&s.reason==='ANATOMY_SIDE_REQUIRED'));
   for(const source of legSources){const before=(await page.evaluate(()=>window.fpcad.read())).data.project,original=before.patternLibrary.find(s=>s.piece.id===source.pieceId);const classified=await page.evaluate(async({pieceId,side})=>{const p=(await window.fpcad.read()).data.project,region=p.patternLibrary.find(s=>s.piece.id===pieceId);return window.fpcad.apply(p.id,p.revision,{type:'library.region.put',region:{...region,category:'腿',anatomy:{part:'leg',side,confidence:1,method:'manual'}}});},source);assert(classified.ok,JSON.stringify(classified));assert.deepEqual(classified.data.project.patternLibrary.find(s=>s.piece.id===source.pieceId).piece,original.piece,'Anatomy review must preserve the original pigment geometry');}
   r=await page.evaluate(async ids=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.autoPlaceMarkings(p.id,p.revision,ids);},sourceIds);assert(r.ok,JSON.stringify(r));
   assert(r.data.project.markings.every(m=>['body','arm','leg'].includes(m.placement.part)));assert(r.data.project.markings.some(m=>m.placement.part==='arm'),'T-pose arms not painted');assert(r.data.project.markings.some(m=>m.placement.part==='leg'),'T-pose legs not painted');for(const source of legSources)assert(r.data.project.markings.some(m=>m.sourcePieceId===source.pieceId&&m.placement.part==='leg'&&m.placement.side===source.side));
   checks.push('ambiguous real thigh sources reject placement; explicit public left/right classification preserves geometry and paints both T-pose legs');
  }else assert(r.data.project.markings.every(m=>m.placement.part===kind),kind+': markings leaked from absent parts');
  if(kind==='paw'||kind==='foot')assert(r.data.project.markings.every(m=>m.placement.side==='left'),kind+': opposite side painted on single limb');
  assert(r.autoPlacementReport.skipped.some(s=>s.reason==='MODEL_PART_MISSING'));
  assert(r.data.project.markings.every(m=>!m.placement.reviewed&&m.fragments.length>0));
  const ids=r.data.project.markings.map(m=>m.id);r=await page.evaluate(async ids=>{const r=await window.fpcad.read();return window.fpcad.apply(r.data.project.id,r.data.project.revision,{type:'marking.placement.review',markingIds:ids,reviewed:true});},ids);assert(r.ok,JSON.stringify(r));assert(r.data.project.markings.every(m=>m.placement.reviewed),"All automatic positions must be reviewed");
  checks.push(kind+'-only model places appropriate front/back sources, skips absent parts, and requires explicit review');
 }
 await page.locator('[data-stage="mapping"]').click();await desktopScreenshot(app,page,{path:'test-results/simple-mapping.png'});assert.deepEqual(errors,[]);
 const prior=(await page.evaluate(()=>window.fpcad.read())).data.project;const swapped=await page.evaluate(async()=>{const r=await window.fpcad.read();return window.fpcad.splitAllReferences(r.data.project.id,r.data.project.revision,1800,6,true,'simple','character',true);});assert(swapped.ok,JSON.stringify(swapped));for(const ref of swapped.data.project.references){const old=prior.references.find(r=>r.id===ref.id);assert.notEqual(ref.view,old.view);assert.equal(ref.resources.source.sha256,old.resources.source.sha256);}assert.equal(swapped.data.project.markings.length,0);assert(swapped.data.project.modelLibrary.every(m=>!m.markings?.length));assert(swapped.data.project.patternLibrary.every(r=>swapped.data.project.references.some(ref=>r.referenceId===ref.id&&r.view===ref.view)));checks.push('swapping front/back preserves original pixels, regenerates classifications and clears all obsolete model attachments');
 await writeFile('test-results/simple-markings.json',JSON.stringify({passed:true,checks,metrics,errors,directory},null,2));
}catch(error){await writeFile('test-results/simple-markings.json',JSON.stringify({passed:false,checks,errors,error:String(error),directory},null,2));throw error;}finally{await app.close();}
