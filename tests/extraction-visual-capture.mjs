// Diagnostic captures of actual hidden compositor pixels from the fixed original.
import {_electron as electron} from 'playwright';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
import {workflow,chooseProject} from './ui-navigation.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const directory=await mkdtemp(resolve('.local/tests/extraction-visual-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:desktopArgs,executablePath,env}),page=await app.firstWindow();
try{
 await page.setViewportSize({width:1500,height:1000});await page.waitForFunction(()=>!!window.fpcad);assert((await page.evaluate(()=>window.fpcad.create({name:'原图曲线与指甲视觉验收',unit:'mm'}))).ok);
 await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),resolve('tests/fixtures/character-front-back.jpg'));
 const result=await page.evaluate(async()=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.autoReference(p.id,p.revision,'front-right',1800,6,true,'simple','character');});assert(result.ok,JSON.stringify(result));const p=result.data.project,ref=p.references.find(r=>r.view==='front'),c=ref.calibration,dx=c.b.x-c.a.x,dy=c.b.y-c.a.y;
 const bounds=region=>{const points=region.piece.nodes.map(n=>({x:c.a.x+(-dy*n.xMm+dx*n.yMm)/c.distanceMm,y:c.a.y+(dx*n.xMm+dy*n.yMm)/c.distanceMm}));return {minX:Math.min(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxX:Math.max(...points.map(p=>p.x)),maxY:Math.max(...points.map(p=>p.y))};};
 const regions=p.patternLibrary.filter(r=>r.view==='front').map(r=>({r,b:bounds(r)})),targets=[['thigh',regions.find(({r,b})=>r.piece.color.startsWith('#f')&&b.minX<350&&b.maxX>350&&b.minY<555&&b.maxY>555)],['blue-thigh',regions.find(({r})=>r.anatomy?.contexts?.some(c=>c.part==='body')&&parseInt(r.piece.color.slice(5,7),16)>parseInt(r.piece.color.slice(1,3),16)*2)],['left-claws',regions.find(({r,b})=>parseInt(r.piece.color.slice(1,3),16)<30&&b.minX<116&&b.maxX>116&&b.minY<688&&b.maxY>688)],['right-claws',regions.find(({r,b})=>parseInt(r.piece.color.slice(1,3),16)<30&&b.minX<425&&b.maxX>425&&b.minY<720&&b.maxY>720)]];
 await page.reload();await chooseProject(page);await workflow(page,'references');const captures=[];
 for(const [name,target] of targets){assert(target,name+' source');await page.locator(`.region-card[data-region-id="${target.r.piece.id}"]`).click();await page.locator('.mask-view').scrollIntoViewIfNeeded();{const zoom=page.getByRole('region',{name:'Pen selection viewport',exact:true}).getByLabel('预览缩放百分比',{exact:true});await zoom.fill(name.includes('claws')?'500':'100');await zoom.press('Tab');}const file=`test-results/extraction-current-${name}.png`;await desktopScreenshot(app,page,{path:file});captures.push({name,file,regionId:target.r.piece.id,bounds:target.b});}
 assert(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())));await writeFile('test-results/extraction-current-visual.json',JSON.stringify({testedBuild,directory,captures},null,2));console.log(JSON.stringify(captures));
}finally{await app.close();}
