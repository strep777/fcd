import {desktopScreenshot} from './desktop-screenshot.mjs';
import {chooseProject} from './ui-navigation.mjs';
import {referenceTools,pickReference} from './reference-controls.mjs';
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {desktopArgs,executablePath} from './desktop-launch.mjs';
const directory=await mkdtemp(resolve('.local/tests/extraction-safety-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:desktopArgs,executablePath,env}),page=await app.firstWindow(),checks=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
async function verifySourceGeometry(project,label){
 const root=await app.evaluate(({app})=>app.getAppPath()),worker=resolve(root,'dist/bin',process.platform==='win32'?'fpcad-worker.exe':'fpcad-worker'),regions=project.patternLibrary,geometry=[];
 assert(regions.length>0&&regions.every(r=>r.piece.closed&&r.piece.nodes.length>=3),label+': every source must be a closed editable contour');
 assert.deepEqual(new Set(regions.map(r=>r.view)),new Set(['front','back']),label+': both original views must retain their sources');
 for(let start=0;start<regions.length;start+=20){const pieces=regions.slice(start,start+20).map(r=>r.piece),result=spawnSync(worker,[],{windowsHide:true,input:JSON.stringify({protocolVersion:1,pieces}),encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024});assert.equal(result.status,0,label+': native worker '+(result.error?.message??result.stderr));const parsed=JSON.parse(result.stdout);assert(parsed.ok,label+': '+JSON.stringify(parsed));assert.deepEqual(parsed.geometry.map(g=>g.id),pieces.map(p=>p.id));geometry.push(...parsed.geometry);}
 assert.deepEqual(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error')),[],label+': extracted sources must remain valid for actual manufacturing');
 const pixelAreas=new Map();for(const [i,g] of geometry.entries()){
  const region=regions[i],reference=project.references.find(r=>r.id===region.referenceId),c=reference?.calibration;assert(c&&reference.view===region.view,label+': source/reference/calibration association');assert(g.areaMm2>0&&g.perimeterMm>0&&g.cut.length>=3,label+': positive material geometry');
  const dx=c.b.x-c.a.x,dy=c.b.y-c.a.y,toPixel=n=>({x:c.a.x+(-dy*n.xMm+dx*n.yMm)/c.distanceMm,y:c.a.y+(dx*n.xMm+dy*n.yMm)/c.distanceMm});
  pixelAreas.set(reference.id,(pixelAreas.get(reference.id)??0)+g.areaMm2*(Math.hypot(dx,dy)/c.distanceMm)**2);
  for(const node of [...g.seam??g.cut,...(g.seamHoles??g.cutHoles??[]).flat()]){const p=toPixel(node);assert(Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=-1&&p.y>=-1&&p.x<=reference.width+1&&p.y<=reference.height+1,label+': source millimetres must map back inside their actual image');}
 }
 // The pinned original must conserve material within 0.1% after calibrated
 // contour fitting. This independently detects missing or duplicated sources.
 const coverage=project.references.map(reference=>{const expected=reference.illustration.foregroundPixels-reference.illustration.discardedPixels,actual=pixelAreas.get(reference.id)??0,errorRatio=Math.abs(actual-expected)/expected;assert(errorRatio<.001,label+': calibrated material area must recover the original retained pixel area: '+JSON.stringify({view:reference.view,expected,actual,errorRatio}));return {view:reference.view,expectedPixels:expected,materialPixels:actual,errorRatio};});
 return {regions:regions.length,totalAreaMm2:geometry.reduce((sum,g)=>sum+g.areaMm2,0),holes:regions.reduce((sum,r)=>sum+(r.piece.holes?.length??0),0),curved:regions.filter(r=>r.piece.curves?.length).length,coverage};
}
try{
 await page.setViewportSize({width:1440,height:960});await page.waitForFunction(()=>!!window.fpcad);await page.locator('.project-picker').waitFor();
 let r=await page.evaluate(()=>window.fpcad.create({name:'原图边缘回归',unit:'mm'}));assert(r.ok);
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},resolve('tests/fixtures/character-front-back.jpg'));
 r=await page.evaluate(async()=>{const s=await window.fpcad.read();return window.fpcad.autoReference(s.data.project.id,s.data.project.revision,'front-right',1800,6,true,'precise');});assert(r.ok,JSON.stringify(r));
 const advanced=r.data.project,regions=advanced.patternLibrary;
 assert.equal(advanced.references.find(r=>r.view==='front').width,666,'both modes must respect the off-center gutter');
 const advancedMetrics=await verifySourceGeometry(advanced,'advanced');
 checks.push({name:'advanced real-image sources have native-valid geometry, calibrated image coordinates and independent cropped views',...advancedMetrics});
 await page.reload();await chooseProject(page);await page.locator('.region-card').first().waitFor();assert.equal(await page.locator('.mode-switch').count(),0);
 assert.equal(await page.locator('.region-card path').first().getAttribute('vector-effect'),'non-scaling-stroke');
 const height=page.getByRole('spinbutton',{name:'参考高度 mm'});await height.fill('0');
 for(const name of ['上传双视图并自动拆分','按当前标定重新拆分'])assert(await page.getByRole('button',{name,exact:true}).isDisabled());
 assert.equal(await page.getByRole('button',{name:'交换正面 / 背面并重新拆分',exact:true}).count(),0);
 assert(await page.getByRole('alert').isVisible());
 assert.deepEqual((await page.evaluate(()=>window.fpcad.read())).data.project,advanced);
 await height.fill('1800');await page.locator('[aria-label="搜索花纹"]').fill('不存在的花纹');assert(await page.locator('.library-groups [role=status]').isVisible());await page.locator('[aria-label="搜索花纹"]').fill('');
 checks.push({name:'mode restoration, stable outline strokes, invalid-input blocking and search empty state'});
 await desktopScreenshot(app,page,{path:'test-results/flat-advanced.png'});
 r=await page.evaluate(async()=>{const s=await window.fpcad.read();return window.fpcad.splitAllReferences(s.data.project.id,s.data.project.revision,1800,6,true,'simple','character');});assert(r.ok,JSON.stringify(r));
 assert(r.data.project.patternLibrary.length<=120);const simpleMetrics=await verifySourceGeometry(r.data.project,'simple');
 checks.push({name:'simple extraction preserves native-valid original contours and mm calibration without requiring arbitrary curve counts',...simpleMetrics});
 await page.reload();await chooseProject(page);await page.locator('.region-card').first().waitFor();await page.locator('.mask-view').scrollIntoViewIfNeeded();await desktopScreenshot(app,page,{path:'test-results/flat-reference.png'});
 const witnesses=await page.evaluate(async()=>{const p=(await window.fpcad.read()).data.project,at=(x,y)=>{const owners=p.patternLibrary.filter(r=>r.view==='front'&&document.querySelector(`.mask-view [data-source-region-id="${r.piece.id}"]`).isPointInFill(new DOMPoint(x+.5,y+.5)));if(owners.length!==1)throw Error('Expected one actual source at '+x+','+y+', got '+owners.length);return {id:owners[0].piece.id,color:owners[0].piece.color};};return {structures:[[178,55],[188,80],[218,140],[249,90],[265,125]].map(([x,y])=>at(x,y)),tail:[[541,440],[500,473],[530,415]].map(([x,y])=>at(x,y)),thigh:[[348,547],[350,556],[352,566],[331,573],[356,575]].map(([x,y])=>at(x,y)),pads:[[155,72],[45,243],[70,244],[28,264]].map(([x,y])=>at(x,y))};});
 const rgb=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)),yellow=source=>{const [r,g,b]=rgb(source.color);return r>b*2&&g>b*2;},pink=source=>{const [r,g,b]=rgb(source.color);return r>g*1.15&&r>b*1.15;};
 assert.equal(new Set(witnesses.structures.map(p=>p.id)).size,5,'real horn, forehead and outer-ear pigment must remain distinct');assert(witnesses.structures.every(yellow));for(const group of [witnesses.tail,witnesses.thigh]){assert.equal(new Set(group.map(p=>p.id)).size,1,'a genuine connected pigment must remain one contour through its cast shadow');assert(group.every(yellow));}assert(witnesses.pads.every(pink),'real inner ear and pads must retain their original pink pigment');checks.push({name:'independent real-image witnesses retain distinct horns, forehead and ear patches, genuine pink pads, and connected yellow thigh/tail shadow boundaries',witnesses});
 // A delayed native picker previously allowed an edit to be interleaved with watcher
 // replacement ("100" became "1800100"). Controls must remain frozen until import settles.
 await referenceTools(page).getByRole('button',{name:'两点标定',exact:true}).click();
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=()=>new Promise(resolve=>{globalThis.finishReferencePicker=()=>resolve({canceled:false,filePaths:[path]});});},resolve('tests/fixtures/character-front-back.jpg'));
 await page.getByRole('button',{name:'导入单张原图',exact:true}).click();
 const distance=page.getByLabel('标定真实距离',{exact:true});
 await page.waitForFunction(()=>document.querySelector('.references-panel fieldset')?.disabled);
 assert(await distance.isDisabled());assert(await referenceTools(page).getByRole('button',{name:'按颜色选取',exact:true}).isDisabled());
 await app.evaluate(()=>globalThis.finishReferencePicker());
 await distance.fill('100');assert.equal(await distance.inputValue(),'100');
 await referenceTools(page).getByRole('button',{name:'按颜色选取',exact:true}).click();await pickReference(page,938,322);assert(await page.getByRole('button',{name:'确认颜色选区并加入花纹库',exact:true}).isDisabled());
 await referenceTools(page).getByRole('button',{name:'两点标定',exact:true}).click();await page.getByRole('button',{name:'保存标定',exact:true}).click();await referenceTools(page).getByRole('button',{name:'按颜色选取',exact:true}).click();await pickReference(page,938,322);assert(await page.getByRole('button',{name:'确认颜色选区并加入花纹库',exact:true}).isEnabled());
 await referenceTools(page).getByRole('button',{name:'两点标定',exact:true}).click();await distance.fill('0');assert(await page.getByRole('button',{name:'保存标定',exact:true}).isDisabled());await referenceTools(page).getByRole('button',{name:'按颜色选取',exact:true}).click();assert(await page.getByRole('button',{name:'确认颜色选区并加入花纹库',exact:true}).isDisabled());
 checks.push({name:'imports freeze editable settings; invalid or unsaved calibration cannot be used to generate patterns'});
 assert.deepEqual(errors,[]);
 await writeFile('test-results/extraction-safety.json',JSON.stringify({passed:true,checks,errors},null,2));
 console.log(JSON.stringify(checks));
}catch(error){await writeFile('test-results/extraction-safety.json',JSON.stringify({passed:false,checks,errors,error:String(error)},null,2));throw error;}finally{await app.close();}

