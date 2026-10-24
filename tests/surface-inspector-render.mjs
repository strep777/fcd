import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

// Render the actual inspector components with persisted legacy records. This
// checks their visible UI without requiring an WebView2 window or app build.
await mkdir('.local/tests',{recursive:true});
await mkdir('test-results',{recursive:true});
const directory=resolve(await mkdtemp('.local/tests/surface-inspector-'));
const file=resolve(directory,'fixture.mjs');
await build({stdin:{contents:`
import {createSSRApp,h,ref} from 'vue';
import {renderToString} from '@vue/server-renderer';
import {createPinia} from 'pinia';
import SurfaceCutPanel from './apps/desktop/src/SurfaceCutPanel.vue';
import MappingTools from './apps/desktop/src/MappingTools.vue';
import {useSession} from './apps/desktop/src/store';
const section={id:'legacy-section',name:'Legacy section record',kind:'section',enabled:true,controlPoints:[],regions:['panel'],edges:[{a:'v0',b:'v1'}],section:{axis:'y',positionMm:25}};
const inferred={id:'inferred',name:'Legacy inferred marking',surfaceId:'mesh',color:'#0088aa',source:'manual',locked:false,paths:[],fragments:[],inference:{reviewed:false}};
const project={id:'p',revision:1,pieces:[],markings:[inferred],patternLibrary:[],bindings:[],surface:{id:'mesh',vertices:[{id:'v0',xMm:0,yMm:0,zMm:0},{id:'v1',xMm:10,yMm:10,zMm:0},{id:'v2',xMm:0,yMm:10,zMm:0}],faces:[{id:'f',vertices:['v0','v1','v2'],region:'panel'}],cutLines:[section],cutConstraints:[]}};
export async function render(kind,language,advanced){
 const pinia=createPinia(),component=kind==='cut'?SurfaceCutPanel:MappingTools;
 const app=createSSRApp({render:()=>h(component,{language,...(kind==='cut'?{targetId:'cutLine:legacy-section'}:{})})});
 app.use(pinia);app.provide('advancedMode',ref(advanced));
 useSession(pinia).data={project:structuredClone(project),geometry:[],canUndo:false,canRedo:false,history:[],recovery:[],recent:[],jobs:[]};
 return renderToString(app);
}
`,resolveDir:resolve('.'),sourcefile:'surface-inspector-fixture.ts',loader:'ts'},outfile:file,bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'inspector-vue',setup(builder){builder.onLoad({filter:/\.vue$/},async({path})=>{
 const {descriptor}=parse(await readFile(path,'utf8'));
 return {contents:compileScript(descriptor,{id:'inspector',inlineTemplate:true}).content,loader:'ts',resolveDir:dirname(path)};
});}}]});
const {render}=await import(pathToFileURL(file).href);
const checks=[];
for(const language of['zh','en'])for(const advanced of[false,true]){
 const cut=await render('cut',language,advanced),mapping=await render('mapping',language,advanced);
 assert(!cut.includes('legacy-section-generator')&&!cut.includes('section-workspace-button'),'new section creation is absent');
 assert(!cut.includes('Create section ring')&&!cut.includes('生成并保存截面环线'));
 assert(cut.includes('Legacy section record')&&cut.includes('cut-line-editor')&&cut.includes('value="25"'),'persisted section selection and position remain editable');
 assert(cut.includes(language==='zh'?'在模型上调整截面':'Adjust section on model'),'legacy section retains model editing action');
 assert(!mapping.includes('inference-panel')&&!mapping.includes('Inference source'),'side completion no longer occupies the right inspector');
 assert(mapping.includes('Legacy inferred marking')&&mapping.includes(language==='zh'?'已检查，确认补全':'Approve inspected completion'),'existing inferred records remain visible and reviewable');
 checks.push({language,advanced,passed:true});
}
await writeFile('test-results/surface-inspector-render.json',JSON.stringify({passed:true,checks},null,2));
console.log(JSON.stringify({passed:true,checks}));
