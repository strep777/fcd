import {desktopScreenshot} from './desktop-screenshot.mjs';
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
import {workflow,production,activity,openDetails,chooseProject} from './ui-navigation.mjs';

const directory=await mkdtemp(resolve('.local/tests/studio-ui-')),output='test-results/studio-ui';await mkdir(output,{recursive:true});
const checks=[],errors=[],contrast=[],screenshots=[];let app,page;
async function launch(data){const env={...process.env,FPCAD_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({args:desktopArgs,executablePath,env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);await page.setViewportSize({width:1440,height:960});await page.waitForFunction(()=>!!window.fpcad);}
async function shot(name){const path=output+'/'+name+'.png';await desktopScreenshot(app,page,{path});screenshots.push(path);}
async function audit(name){
 // Evaluate the settled state after the theme's 180 ms feedback transitions.
 await page.waitForTimeout(250);
 const result=await page.evaluate(()=>{
  const rgb=s=>{const n=s.match(/[-+]?\d*\.?\d+/g)?.map(Number)??[];return s.startsWith('color(')?[n[0]*255,n[1]*255,n[2]*255,n[3]??1]:[n[0]??0,n[1]??0,n[2]??0,n[3]??1];};
  const luminance=c=>c.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
  let count=0;const failures=[];
  const root=document.querySelector('dialog[open],.modal[role=dialog],.print-preview[role=dialog],.mask-editor.expanded')??document;
  for(const element of root.querySelectorAll('button,input,select,textarea,label,p,small,strong,h1,h2,h3,summary,span,dt,dd')){
   if(element.closest('svg,[disabled]'))continue;const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
   const text=[...element.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim()||(['INPUT','TEXTAREA'].includes(element.tagName)?element.value:'');
   if(!text||!rect.width||!rect.height||rect.bottom<0||rect.top>innerHeight||rect.right<0||rect.left>innerWidth||style.visibility!=='visible')continue;
   const layers=[];let opacity=1;for(let parent=element;parent;parent=parent.parentElement){const css=getComputedStyle(parent);opacity*=Number(css.opacity);layers.unshift(rgb(css.backgroundColor));}if(opacity<.95)continue;
   let bg=[255,255,255];for(const layer of layers)bg=bg.map((n,i)=>n*(1-layer[3])+layer[i]*layer[3]);
   const foreground=rgb(style.color),a=luminance(foreground),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05),size=parseFloat(style.fontSize),minimum=size>=24||size>=18.66&&Number(style.fontWeight)>=700?3:4.5;
   count++;if(ratio+.03<minimum)failures.push({text:text.slice(0,65),class:element.className,color:style.color,background:bg,ratio});
  }
  return {count,failures,bodyOverflow:document.documentElement.scrollWidth>innerWidth};
 });contrast.push({page:name,...result});assert(!result.bodyOverflow,name+' body overflow');assert.deepEqual(result.failures,[],name+' low contrast: '+JSON.stringify(result.failures));
}
try{
 await launch(directory);await page.locator('.welcome').waitFor();await audit('welcome');await shot('welcome');const seeded=await page.evaluate(()=>window.fpcad.create({name:'Studio source choices',unit:'mm'}));assert(seeded.ok);await page.reload();await chooseProject(page);await page.locator('.workspace').waitFor();await workflow(page,'model');await page.getByRole('button',{name:'创建 / 导入模型',exact:true}).click();await page.locator('.model-source-dialog[open]').waitFor();await audit('model-dialog');await shot('model-dialog');await page.keyboard.press('Escape');await app.close();
 const fixture=JSON.parse(await readFile('test-results/workflow-pages.json','utf8'));assert(fixture.passed);
 const data=resolve(directory,'workflow');await cp(fixture.directory,data,{recursive:true});await launch(data);await chooseProject(page);await page.locator('.workspace').waitFor();
 const before=await page.evaluate(async()=>{const r=await window.fpcad.read();return r.data.project;});
 for(const stage of ['references','model','mapping','cutting','assembly','pattern']){await workflow(page,stage);await audit(stage);await shot(stage);}
 checks.push('all six editing pages, including actual cut assembly, retain readable controls and consistent studio surfaces without body overflow');
 await workflow(page,'references');await page.locator('.image-tools').getByRole('button',{name:'钢笔选区',exact:true}).click();await page.getByRole('button',{name:'放大选区编辑',exact:true}).click();await audit('expanded-mask');await shot('expanded-mask');await page.getByRole('button',{name:'收起选区编辑',exact:true}).click();await workflow(page,'pattern');
 checks.push('expanded manual-selection editor uses the shared controls and readable foregrounds');
 await page.locator('.cut-selection .cut-row>button').first().click();await page.getByRole('button',{name:'单片分页拼接预览',exact:true}).click();await page.locator('.print-preview').waitFor();await audit('print-dialog');await shot('print-dialog');await page.keyboard.press('Escape');
 checks.push('model source and tiled-print dialogs keep readable foregrounds, controls and studio styling');
 for(const key of ['materials','seams','nesting']){await production(page,key);await audit(key);await shot(key);}
 await workflow(page,'workflow');await audit('workflow');await shot('workflow');for(const key of ['jobs','diagnostics','history','recovery']){await activity(page,key);await audit('activity-'+key);}await page.locator('.activity-close').click();
 checks.push('materials, seams, nesting, workflow nodes and activity use the same readable theme');
 await page.getByRole('button',{name:'＋ 新建项目',exact:true}).click();await page.getByRole('dialog').waitFor();await audit('project-dialog');await shot('project-dialog');await page.keyboard.press('Escape');
 await page.locator('.workflow-nav>button[data-stage=model]').focus();assert.equal(await page.locator('.workflow-nav>button[data-stage=model]').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'＋ 新建项目',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('dialog').evaluate(e=>getComputedStyle(e).animationName),'none');await page.keyboard.press('Escape');
 checks.push('keyboard focus remains visible and reduced-motion disables decorative motion');
 await page.setViewportSize({width:1000,height:680});for(const stage of ['references','model','mapping','cutting','assembly','pattern']){await workflow(page,stage);await audit('small-'+stage);}await shot('small-pattern');
 await page.getByLabel('Language').selectOption('en');await audit('english-small');await shot('english-small');
 const after=await page.evaluate(async()=>{const r=await window.fpcad.read();return r.data.project;});assert.deepEqual(after,before);
 checks.push('1000 x 680 and English layouts stay usable; navigation and visual changes preserve exact project geometry and colors');
 await app.close();app=undefined;
 const original=JSON.parse(await readFile('test-results/simple-markings.json','utf8'));assert(original.passed);const realData=resolve(directory,'original');await cp(original.directory,realData,{recursive:true});await launch(realData);await chooseProject(page);await page.locator('.workspace').waitFor();await workflow(page,'references');await audit('original-reference');await shot('original-reference');await page.locator('.references-panel').scrollIntoViewIfNeeded();await audit('original-dual-views');await shot('original-dual-views');
 checks.push('the original furry character and colored source library retain artwork colors under the new chrome');
 assert.deepEqual(errors,[]);await writeFile(output+'/report.json',JSON.stringify({passed:true,testedBuild,directory,checks,contrast,screenshots,errors},null,2));console.log('Studio UI audit passed:',checks.length,'checks;',contrast.reduce((n,x)=>n+x.count,0),'text samples');
}catch(error){if(page)await desktopScreenshot(app,page,{path:output+'/failure.png'}).catch(()=>{});await writeFile(output+'/report.json',JSON.stringify({passed:false,checks,contrast,errors,error:String(error)},null,2));throw error;}finally{await app?.close();}
