import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createServer} from 'vite';
import vue from '@vitejs/plugin-vue';
import {chromium} from 'playwright';

// Render real source components with the same available height as the desktop
// shell. The API fixture checks UI state transitions only, never solver output.
await mkdir('.local/tests',{recursive:true});
const outputDirectory=resolve(process.env.FPCAD_TEST_OUTPUT_DIR??'test-results');
await mkdir(outputDirectory,{recursive:true});
const directory=await mkdtemp(resolve('.local/tests/cut-workspace-'));
const entry=`
import {createApp,h,ref,provide,Teleport,nextTick} from 'vue';
import {createPinia} from 'pinia';
import CuttingPage from '/apps/desktop/src/CuttingPage.vue';
import ModelViewport from '/apps/desktop/src/ModelViewport.vue';
import PatternCanvas from '/apps/desktop/src/PatternCanvas.vue';
import {useSession} from '/apps/desktop/src/store';
import {usePatternEditor} from '/apps/desktop/src/modules/usePatternEditor';
import {patternEditorKey} from '/apps/desktop/src/modules/patternEditorContext';
import {setLocale} from '/apps/desktop/src/localization';
import '/apps/desktop/src/style.css';
import '/apps/desktop/src/studio.css';
setLocale('zh');
const id=()=>crypto.randomUUID();
const vertices=[[-100,0,0],[100,0,0],[100,200,0],[-100,200,0]].map(([xMm,yMm,zMm])=>({id:id(),xMm,yMm,zMm}));
const faces=[{id:id(),vertices:[vertices[0].id,vertices[1].id,vertices[2].id],region:'body'},{id:id(),vertices:[vertices[0].id,vertices[2].id,vertices[3].id],region:'arm_left'}];
const surface={id:id(),topologyVersion:1,source:'obj',vertices,faces,cutLines:[{id:id(),name:'肩部裁线',kind:'pen',enabled:true,controlPoints:[{id:id(),xMm:-50,yMm:50,zMm:0},{id:id(),xMm:50,yMm:140,zMm:0}],projection:{origin:[0,100,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},tension:.5,closed:false,symmetric:false,regions:['body','arm_left'],edges:[]}],cutConstraints:[]};
const piece={id:id(),name:'身体裁片',nodes:[[0,0],[200,0],[200,200],[0,200]].map(([xMm,yMm])=>({id:id(),xMm,yMm})),closed:true,color:'#a3bdb7',allowanceMm:10,cutQty:1,mirror:false,furRad:Math.PI/2,material:'毛皮'};
const binding={pieceId:piece.id,surfaceId:surface.id,topologyVersion:1,geometryHash:'fixture',surfaceHash:'fixture',report:{faceIds:faces.map(f=>f.id),uv:vertices.map(v=>({vertexId:v.id,xMm:v.xMm+100,yMm:v.yMm})),boundary:vertices.map(v=>v.id),areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'}};
const run={sourceHash:'fixture',algorithm:'lscm-cg-1',pieces:[piece],bindings:[binding],accepted:false,cutPreview:[{id:piece.id,cut:piece.nodes,seam:piece.nodes,issues:[]}]};
const project={schemaVersion:2,id:id(),name:'裁切工作台布局检查',unit:'mm',revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),pieces:[],markings:[],bindings:[],surface,defaultAllowanceMm:10};
const pinia=createPinia(),store=useSession(pinia);
store.data={sessionId:id(),project,geometry:[],canUndo:false,canRedo:false,savedRevision:1,history:[],recovery:[],recent:[],jobs:[]};
window.calls=[];
window.store=store;
window.fpcad={onSurfaceProgress:()=>()=>{},unwrapSurface:async(projectId,revision,options)=>{window.calls.push({type:'unwrap',projectId,revision,options});const data=JSON.parse(JSON.stringify(store.data));data.project.revision++;data.project.surfaceRun=run;return {ok:true,data};},acceptSurface:async()=>{window.calls.push({type:'accept'});const data=JSON.parse(JSON.stringify(store.data));data.project.revision++;data.project.surfaceRun.accepted=true;data.project.pieces=data.project.surfaceRun.pieces;return {ok:true,data};}};
const app=createApp({setup(){
 const language=ref('zh'),stage=ref('cutting'),advanced=ref(false),request=ref(),focus=ref(''),focusToken=ref(0),sectionActive=ref(false),cutDraftActive=ref(false);
 const editor=usePatternEditor(language,stage,()=>{});
 provide(patternEditorKey,editor);provide('advancedMode',advanced);
 nextTick(()=>editor.fit());
 return()=>h('div',{class:'app-shell'},[
  h('div',{class:'fixture-shell'},[h('strong','FurryPattern CAD'),h('span','模型管理  /  花纹映射  /  裁切版型')]),
  h('main',{class:'workspace page-cutting'},[
   h(CuttingPage,{language:language.value,sectionActive:sectionActive.value,cutDraftActive:cutDraftActive.value,onDraw:value=>request.value={...value,token:Date.now()},onFocus:id=>{focus.value=id;focusToken.value++;},onAccepted:id=>window.acceptedPiece=id}),
   h(Teleport,{to:'#cutting-viewport',defer:true},h(ModelViewport,{mode:'cutting',language:language.value,selectedId:editor.selectedId.value,cutRequest:request.value,focusCutId:focus.value,focusCutToken:focusToken.value,onSectionActive:value=>sectionActive.value=value,onCutDraftActive:value=>cutDraftActive.value=value,onSelect:editor.selectPiece})),
   h(Teleport,{to:'#cutting-pattern-viewport',defer:true},h(PatternCanvas))
  ]),h('footer','就绪 · 1 单位 = 1 毫米')
 ]);
}});
app.use(pinia);app.mount('#app');
`;
await writeFile(resolve(directory,'entry.ts'),entry);
await writeFile(resolve(directory,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><link rel="icon" href="data:,"><style>.fixture-shell{height:145px;flex-shrink:0;display:flex;flex-direction:column;justify-content:center;gap:16px;padding:20px;background:var(--panel);border-bottom:1px solid var(--border)}.fixture-shell strong{font-size:17px}.fixture-shell span{font-size:12px;color:var(--text-muted)}#app{height:100vh}</style><div id="app"></div><script type="module" src="./entry.ts"></script></html>');
const server=await createServer({root:resolve('.'),configFile:false,plugins:[vue()],optimizeDeps:{noDiscovery:true,include:['vue','pinia','zod']},server:{host:'127.0.0.1',port:0,watch:null}});
await server.listen();
const address=server.httpServer.address();
assert(address&&typeof address==='object');
let browser;
try{browser=await chromium.launch({...process.env.FPCAD_TEST_BROWSER?{executablePath:process.env.FPCAD_TEST_BROWSER}:{channel:'msedge'},headless:true,args:['--disable-gpu']});}
catch(error){if(process.env.FPCAD_TEST_BROWSER){await server.close();throw error;}browser=await chromium.launch({headless:true,args:['--disable-gpu']});}
const page=await browser.newPage(),errors=[],checks=[];
page.setDefaultTimeout(20000);
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
const visibleInViewport=async locator=>{
 assert(await locator.isVisible(),'control must be visible');
 const box=await locator.boundingBox(),size=page.viewportSize();
 assert(box&&box.width>0&&box.height>0);
 assert(box.x>=0&&box.y>=0&&box.x+box.width<=size.width+1&&box.y+box.height<=size.height+1,'control must fit inside the window');
};
try{
 await page.setViewportSize({width:1280,height:800});
 await page.goto('http://127.0.0.1:'+address.port+'/'+relative(resolve('.'),resolve(directory,'index.html')).replaceAll('\\','/'));
 await page.waitForLoadState('networkidle');
 console.log('Source cutting workspace loaded');
 await page.locator('.cutting-workspace').waitFor();
 await page.locator('#cutting-parts .drawing-parts').waitFor();
 assert.equal(await page.locator('#cutting-preview-dock').isVisible(),false,'no-run projects leave the model drawing area unobstructed');
 assert.equal(await page.getByRole('button',{name:'二维预览',exact:true}).getAttribute('aria-pressed'),'false');
 checks.push('no-run projects initially hide the empty 2D dock');
 for(const size of[{width:1000,height:680},{width:1280,height:800},{width:1920,height:1080}]){
  await page.setViewportSize(size);
  await page.waitForFunction(()=>document.querySelector('#cutting-viewport').clientWidth>600);
  for(const control of[
   page.locator('#cutting-drawing-tools').getByRole('button',{name:'曲面钢笔',exact:true}),
   page.locator('#cutting-drawing-tools').getByRole('button',{name:'花纹画笔（涂区域）',exact:true}),
   page.getByRole('button',{name:'自动计算裁线并预览',exact:true}),
   page.getByRole('button',{name:'二维预览',exact:true}),
   page.locator('.surface-controls').getByRole('button',{name:'正面',exact:true})
  ])await visibleInViewport(control);
  const sidebar=await page.locator('.cutting-sidebar').boundingBox(),model=await page.locator('#cutting-viewport').boundingBox();
  assert(sidebar.x<model.x&&model.width>sidebar.width*2,'model has the primary workspace');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:resolve(outputDirectory,'cut-workspace-'+size.width+'x'+size.height+'.png')});
  await page.getByRole('button',{name:'二维预览',exact:true}).click();
  await visibleInViewport(page.getByRole('button',{name:'放大二维预览',exact:true}));
  const preview=await page.locator('#cutting-preview-dock').boundingBox();
  assert(preview.width<model.width*.6&&preview.height<model.height*.6,'manually opened 2D preview stays secondary');
  await page.screenshot({path:resolve(outputDirectory,'cut-workspace-'+size.width+'x'+size.height+'-preview.png')});
  await page.getByRole('button',{name:'二维预览',exact:true}).click();
  checks.push('layout and top controls at '+size.width+'x'+size.height);
 }
 await page.getByRole('button',{name:'二维预览',exact:true}).click();
 await page.getByRole('button',{name:'放大二维预览',exact:true}).click();
 assert(await page.locator('#cutting-preview-dock').evaluate(element=>element.classList.contains('expanded')));
 await page.getByRole('button',{name:'缩小二维预览',exact:true}).click();
 await page.getByRole('button',{name:'收起二维预览',exact:true}).click();
 assert.equal(await page.locator('#cutting-preview-dock').isVisible(),false);
 await page.locator('#cutting-drawing-tools').getByRole('button',{name:'曲面钢笔',exact:true}).click();
 assert(await page.getByRole('button',{name:'自动计算裁线并预览',exact:true}).isDisabled());
 assert(await page.locator('.pending-cut-draft').isVisible(),'the pending draft is explained beside the disabled action');
 assert.equal(await page.evaluate(()=>window.calls.length),0,'a pending draft cannot invoke the solver');
 await page.locator('.curve-cut-draft').getByRole('button',{name:'取消路径修改',exact:true}).click();
 assert(await page.getByRole('button',{name:'自动计算裁线并预览',exact:true}).isEnabled());
 checks.push('unsaved cut drafts block computation until explicitly saved or cancelled');
 await page.locator('#cutting-drawing-tools').getByRole('button',{name:'花纹画笔（涂区域）',exact:true}).click();
 assert(await page.locator('#surface-cut-draft .surface-brush-controls').isVisible(),'cutting paint exposes area brush settings');
 assert.equal(await page.locator('.curve-cut-draft').count(),0,'area painting does not start a cut-line draft');
 assert(await page.getByRole('button',{name:'自动计算裁线并预览',exact:true}).isEnabled());
 checks.push('area paint and freehand cut-line modes have distinct controls');
 await page.getByRole('button',{name:'自动计算裁线并预览',exact:true}).click();
 await page.locator('.candidate-cut-review').waitFor({state:'attached'});
 assert(await page.locator('#cutting-preview-dock').isVisible(),'compute reopens the candidate preview');
 assert.equal(await page.evaluate(()=>window.calls.length),1);
 assert.equal(await page.evaluate(()=>window.calls[0].type),'unwrap');
 assert.equal(await page.evaluate(()=>window.store.data.project.pieces.length),0,'preview does not accept patterns');
 checks.push('compute calls the existing API and reopens preview before acceptance');
 await page.getByRole('button',{name:'裁切设置',exact:true}).click();
 await page.getByRole('button',{name:'确认版型并保存到裁切库（可撤销）',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.calls.at(-1).type),'accept');
 assert.equal(await page.evaluate(()=>window.store.data.project.pieces.length),1);
 checks.push('explicit acceptance retains the existing save action');
 assert.deepEqual(errors,[]);
 await writeFile(resolve(outputDirectory,'cut-workspace-render.json'),JSON.stringify({passed:true,checks,errors},null,2));
 console.log(JSON.stringify({passed:true,checks},null,2));
}catch(error){
 await page.screenshot({path:resolve(outputDirectory,'cut-workspace-failure.png')}).catch(()=>{});
 await writeFile(resolve(outputDirectory,'cut-workspace-render.json'),JSON.stringify({passed:false,error:String(error),checks,errors},null,2));
 throw error;
}finally{await browser.close();await server.close();}
