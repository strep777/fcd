import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {realpath,readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
import {hiddenWindowId} from './desktop-window.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {workflow} from './ui-navigation.mjs';
import {focusLegacyPaintCamera} from './legacy-paint-camera.mjs';
const root=await realpath(resolve('.local/tests')),directory=await realpath(resolve(process.env.FPCAD_INSPECT_DATA_DIR??'.'));
assert(directory.startsWith(root+sep),'Visual inspection must use an existing isolated test project');
const env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:desktopArgs,executablePath,env}),page=await app.firstWindow(),errors=[];
page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
const read=async()=>{const r=await page.evaluate(()=>window.fpcad.read());assert(r.ok);return r.data.project;};
const outlineBounds=async()=>page.locator('#cutting-pattern-viewport svg.canvas').evaluate(svg=>{
 const rect=r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
 const canvas=rect(svg.getBoundingClientRect()),clip={left:Math.max(0,canvas.left),top:Math.max(0,canvas.top),right:Math.min(innerWidth,canvas.right),bottom:Math.min(innerHeight,canvas.bottom)},ancestors=[];
 for(let el=svg.parentElement;el;el=el.parentElement){const style=getComputedStyle(el),box=rect(el.getBoundingClientRect()),x=/(hidden|clip|auto|scroll)/.test(style.overflowX),y=/(hidden|clip|auto|scroll)/.test(style.overflowY);if(x||y){ancestors.push({tag:el.tagName,id:el.id,className:el.className,overflowX:style.overflowX,overflowY:style.overflowY,box});if(x){clip.left=Math.max(clip.left,box.left);clip.right=Math.min(clip.right,box.right);}if(y){clip.top=Math.max(clip.top,box.top);clip.bottom=Math.min(clip.bottom,box.bottom);}}}
 const pieces=[...svg.querySelectorAll(':scope > g[data-piece-id]')].map(g=>{const boxes=[...g.querySelectorAll(':scope > path.screen-outline')].map(p=>rect(p.getBoundingClientRect()));const box={left:Math.min(...boxes.map(b=>b.left)),top:Math.min(...boxes.map(b=>b.top)),right:Math.max(...boxes.map(b=>b.right)),bottom:Math.max(...boxes.map(b=>b.bottom))};return{id:g.getAttribute('data-piece-id'),box,outside:{left:Math.max(0,clip.left-box.left),top:Math.max(0,clip.top-box.top),right:Math.max(0,box.right-clip.right),bottom:Math.max(0,box.bottom-clip.bottom)}};});
 return{viewBox:svg.getAttribute('viewBox'),canvas,clip,ancestors,pieces,outside:pieces.filter(p=>Object.values(p.outside).some(n=>n>.5))};
});
const settle=()=>page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
try{
 await hiddenWindowId(app,page);await page.setViewportSize({width:1920,height:1080});await workflow(page,'cutting');
 const before=await read();assert(before.surfaceRun?.accepted&&before.pieces.length>0);assert(before.markings.every(m=>m.paths.length>0));
 let report;
 if(process.env.FPCAD_INSPECT_LEGACY_ONLY!=='1'){
 const dock=page.locator('#cutting-preview-dock');if(!await dock.isVisible())await page.getByRole('button',{name:'二维预览',exact:true}).click();
 const picker=page.getByLabel('裁切版型预览裁片',{exact:true});await picker.selectOption('');await settle();const compactBounds=await outlineBounds();await page.getByRole('button',{name:'放大二维预览',exact:true}).click();await settle();const expandedBounds=await outlineBounds();
 const groups=()=>page.locator('#cutting-pattern-viewport svg.canvas > g[data-piece-id]');assert.equal(await groups().count(),before.pieces.length);
 const allDimensions=await page.getByLabel('Actual preview dimensions',{exact:true}).innerText();assert(allDimensions.startsWith('全片范围'));
 const outlines=await page.locator('#cutting-pattern-viewport .screen-outline').evaluateAll(paths=>paths.map(p=>({vectorEffect:getComputedStyle(p).vectorEffect,strokePx:parseFloat(getComputedStyle(p).strokeWidth)})));assert(outlines.length>0);assert(outlines.every(p=>p.vectorEffect==='non-scaling-stroke'&&p.strokePx>=.8));
 await desktopScreenshot(app,page,{path:'test-results/current-cutting/real-current-2d-all-pieces.png'});
 const screenshotBounds=await outlineBounds();await page.locator('#cutting-pattern-viewport').getByRole('button',{name:'适应视图',exact:true}).click();await settle();const refitBounds=await outlineBounds();await writeFile('test-results/current-cutting/real-current-2d-outline-bounds.json',JSON.stringify({compactBounds,expandedBounds,screenshotBounds,refitBounds},null,2));assert.equal(expandedBounds.outside.length,0,'Every expanded overview outline must fit inside the actual visible canvas');assert.equal(screenshotBounds.outside.length,0,'Hidden capture must not leave an overview outline clipped');assert.equal(refitBounds.outside.length,0,'Fit view must contain every overview outline');
 const paintColors=new Set(before.markings.map(m=>m.color)),colored=before.pieces.filter(p=>paintColors.has(p.color));assert(colored.length>0);
 const selected=colored[0];await picker.selectOption(selected.id);assert.equal(await picker.inputValue(),selected.id);
 assert.equal(await groups().count(),1);assert.equal(await picker.locator('option').count(),before.pieces.length+1);
 assert(await page.locator('#cutting-pattern-viewport svg.canvas path').count()>0);
 await desktopScreenshot(app,page,{path:'test-results/current-cutting/real-current-2d-colored-piece.png'});
 const observed=await page.locator('#cutting-pattern-viewport').evaluate(el=>({viewBox:el.querySelector('svg.canvas')?.getAttribute('viewBox'),dimensions:el.querySelector('[aria-label="Actual piece dimensions"]')?.textContent,paintedPaths:[...new Set([...el.querySelectorAll('svg.canvas path')].map(p=>p.getAttribute('fill')).filter(x=>x&&!x.startsWith('url(')))]}));
 assert(observed.paintedPaths.includes(selected.color));assert(observed.dimensions);assert.equal((await read()).revision,before.revision);assert.deepEqual(errors,[]);
 const zoom=page.locator('#cutting-pattern-viewport').getByLabel('预览缩放百分比',{exact:true});for(const percent of[37,3200,100]){await zoom.fill(String(percent));await zoom.press('Tab');assert.equal(await page.getByLabel('Actual piece dimensions',{exact:true}).innerText(),observed.dimensions);assert.equal(await groups().count(),1);}assert.equal((await read()).revision,before.revision);
 report={passed:true,directory,hidden:true,pieces:before.pieces.length,markings:before.markings.length,sources:before.patternLibrary.length,coloredPieces:colored.length,selected:{id:selected.id,name:selected.name,color:selected.color},allDimensions,outlineCount:outlines.length,outlineStrokePx:outlines[0].strokePx,observed,errors};
 await writeFile('test-results/current-cutting/real-current-visual-inspection.json',JSON.stringify(report,null,2));
 }else{report=JSON.parse(await readFile('test-results/current-cutting/real-current-visual-inspection.json','utf8'));assert(report.passed);assert.equal(report.directory,directory);assert.equal(report.pieces,before.pieces.length);}
 let legacyEdit;
 if(process.env.FPCAD_INSPECT_LEGACY_PAINT==='1'){
  await workflow(page,'mapping');const marking=before.markings.find(m=>m.surfaceShape&&!m.surfaceShape.curves?.length);assert(marking,'The saved legacy surface-paint record is required');assert.equal(marking.surfaceShape.nodes.length,147);assert.equal(marking.surfaceShape.holes?.length??0,0);
  await page.locator('#mapping-surface-controls').getByLabel('Select attached marking',{exact:true}).selectOption(marking.id);
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),readState=async()=>{const r=await page.evaluate(()=>window.fpcad.read());assert(r.ok);return r.data;},beforeEdit=await readState(),beforeHashes={project:hash(beforeEdit.project),geometry:hash(beforeEdit.geometry)};
  await page.locator('.surface-tool-rail').getByRole('button',{name:'编辑已贴附花纹节点',exact:true}).click();const points=page.locator('#mapping-surface-controls .surface-drawing > span');await points.waitFor();const draftText=await points.innerText();await writeFile('test-results/current-cutting/real-current-legacy-paint-observed.json',JSON.stringify({markingId:marking.id,source:marking.source,savedNodes:marking.surfaceShape.nodes.length,draftText,beforeHashes,revision:beforeEdit.project.revision},null,2));await desktopScreenshot(app,page,{path:'test-results/current-cutting/real-current-legacy-paint-draft.png'});assert.match(draftText,/^18\s*(点|points)$/);assert(await page.getByLabel('Surface drawing mode',{exact:true}).isDisabled(),'The compact legacy draft must retain fitted curves');
  const handles=page.locator('.surface-view .curve-handles circle'),domHandles=await handles.count();if(domHandles)assert.equal(domHandles,18);
  let focusedView;
  if(process.env.FPCAD_INSPECT_LEGACY_ZOOM==='1'){
   focusedView=await focusLegacyPaintCamera(page);await desktopScreenshot(app,page,{path:'test-results/current-cutting/real-current-legacy-paint-focused.png'});
  }
  await desktopScreenshot(app,page,{path:'test-results/current-cutting/real-current-legacy-paint-draft.png'});
  await page.locator('.surface-tool-rail').getByRole('button',{name:'取消三维绘制',exact:true}).click();const afterEdit=await readState(),afterHashes={project:hash(afterEdit.project),geometry:hash(afterEdit.geometry)};assert.equal(afterEdit.project.revision,beforeEdit.project.revision);assert.deepEqual(afterHashes,beforeHashes);assert.deepEqual(afterEdit.project.markings,beforeEdit.project.markings);assert(afterEdit.project.surfaceRun.accepted);
  if(process.env.FPCAD_INSPECT_ACCEPTED_MATERIAL==='1'){assert.equal(await handles.count(),0);await desktopScreenshot(app,page,{path:'test-results/current-cutting/real-current-accepted-material-focused.png'});await writeFile('test-results/current-cutting/real-current-accepted-material-view.json',JSON.stringify({directory,hidden:true,revision:afterEdit.project.revision,markingId:marking.id,color:marking.color,accepted:true,draftOverlay:false,focusedView,beforeHashes,afterHashes,visualReviewRequired:true},null,2));}
  legacyEdit={markingId:marking.id,savedNodes:147,draftPoints:18,draftText,hasFittedCurves:true,domHandles,focusedView,handleMeasurement:domHandles?'SVG handle circles':'Displayed draft point count; canvas handles are not DOM elements',revision:afterEdit.project.revision,beforeHashes,afterHashes,cancelPreservedProjectAndGeometry:true};await writeFile('test-results/current-cutting/real-current-legacy-paint-cancel.json',JSON.stringify(legacyEdit,null,2));
 }
 assert.deepEqual(errors,[]);await writeFile('test-results/current-cutting/real-current-visual-inspection.json',JSON.stringify({...report,legacyEdit,errors},null,2));
}finally{await app.close();}
