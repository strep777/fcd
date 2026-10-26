import {afterEach,expect,it,vi} from 'vitest';
import * as Vue from 'vue';
import {createPinia,setActivePinia} from 'pinia';
import {parse,compileScript} from '@vue/compiler-sfc';
import {transformSync} from 'esbuild';
import {readFileSync} from 'node:fs';
import {useSession} from '../../apps/desktop/src/store';
import {usePatternEditor} from '../../apps/desktop/src/modules/usePatternEditor';
import * as context from '../../apps/desktop/src/modules/patternEditorContext';
import * as localization from '../../apps/desktop/src/localization';
import * as history from '../../apps/desktop/src/modules/useDraftHistory';
import * as decimal from '../../apps/desktop/src/modules/decimal-input';
import * as spacing from '../../packages/manufacturing/pattern-spacing';
import {project,rectangle} from '../fixtures';
import {acceptedCutProject} from '../fixtures/accepted-cut';
import type {PatternTab} from '../../apps/desktop/src/modules/workflow-tabs';
import type {Piece,Response,SurfaceProgress} from '../../packages/schema/index';

// Render the production page/progress templates and exercise their handlers.
// Child editors are probes; this suite checks mode visibility, not their logic.
class HostNode {
 __v_skip=true;children:HostNode[]=[];parentNode:HostNode|null=null;attrs:Record<string,any>={};style:Record<string,any>={};text:string|undefined;tagName:string;value='';type='';selected=false;
 constructor(readonly tag:string){this.tagName=tag.toUpperCase();}
 get textContent():string{return this.text??this.children.filter(node=>node.tag!=='#comment').map(node=>node.textContent).join('');}
 set textContent(value:string){this.text=value;this.children=[];}
 get options(){return this.children.filter(node=>node.tag==='option');}
 get multiple(){return !!this.attrs.multiple;}
 get ownerDocument(){return {activeElement:null};}
 addEventListener(){}removeEventListener(){}getClientRects(){return [{}];}
 setAttribute(key:string,value:unknown){this.attrs[key]=value;}removeAttribute(key:string){delete this.attrs[key];}
}
function walk(node:HostNode):HostNode[]{return [node,...node.children.flatMap(walk)];}
const renderer=Vue.createRenderer<HostNode,HostNode>({
 createElement:tag=>new HostNode(tag),createText:text=>{const node=new HostNode('#text');node.text=text;return node;},createComment:()=>new HostNode('#comment'),
 setText:(node,text)=>{node.text=text;},setElementText:(node,text)=>{node.textContent=text;},parentNode:node=>node.parentNode,nextSibling:node=>node.parentNode?.children[node.parentNode.children.indexOf(node)+1]??null,
 insert(node,parent,anchor){if(node.parentNode){const previous=node.parentNode.children.indexOf(node);if(previous>=0)node.parentNode.children.splice(previous,1);}const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,node);node.parentNode=parent;},
 remove(node){if(node.parentNode){const index=node.parentNode.children.indexOf(node);if(index>=0)node.parentNode.children.splice(index,1);node.parentNode=null;}},
 patchProp(node,key,_before,value){node.attrs[key]=value;if(key==='value')node.value=value;if(key==='type')node.type=value;},querySelector:()=>null,
});
const probes=new Map<string,unknown>();
function child(name:string){
 if(!probes.has(name))probes.set(name,Vue.defineComponent({name,inheritAttrs:false,setup(_props,{slots}){return ()=>name==='WorkspaceSplit'?Vue.h('section',{'data-child':name},[slots.first?.(),slots.second?.()]):Vue.h('section',{'data-child':name},name);}}));
 return probes.get(name);
}
function component(name:string){
 const script=compileScript(parse(readFileSync(`apps/desktop/src/${name}.vue`,'utf8')).descriptor,{id:`simple-${name}`,inlineTemplate:true,templateOptions:{compilerOptions:{hoistStatic:false}}});
 const loaded={exports:{} as any},compiled=transformSync(script.content,{loader:'ts',format:'cjs'}).code;
 new Function('require','module','exports',compiled)((path:string)=>path==='vue'?Vue:path==='./store'?{useSession}:path==='./localization'?localization:path.endsWith('/patternEditorContext')?context:path.endsWith('/useDraftHistory')?history:path.endsWith('/decimal-input')?decimal:path.endsWith('/pattern-spacing')?spacing:path.endsWith('.vue')?{__esModule:true,default:child(path.slice(2,-4))}:{},loaded,loaded.exports);
 return loaded.exports.default;
}
const PatternPage=component('PatternPage'),UnwrapTools=component('UnwrapTools');
const apps:{unmount:()=>void}[]=[];
async function flush(){for(let i=0;i<4;i++){await Promise.resolve();await Vue.nextTick();}}
afterEach(()=>{for(const app of apps.splice(0))app.unmount();vi.useRealTimers();vi.unstubAllGlobals();localization.setLocale('en');});
function state(){const pinia=createPinia();setActivePinia(pinia);const store=useSession(),p=project();store.data.project=p;return {pinia,store,p};}
async function mountPattern(enabled=false,initialPanel:PatternTab='pieces',language:'zh'|'en'='zh'){
 const {pinia,store,p}=state(),advanced=Vue.ref(enabled),panel=Vue.ref<PatternTab>(initialPanel),root=new HostNode('root');
 const app=renderer.createApp(Vue.defineComponent({setup(){const editor=usePatternEditor(Vue.ref(language),Vue.ref('pattern'),()=>{});Vue.provide('advancedMode',advanced);Vue.provide(context.patternEditorKey,editor);return ()=>Vue.h(PatternPage,{language,panel:panel.value,'onUpdate:panel':(value:PatternTab)=>{panel.value=value;}});}}));app.use(pinia);app.mount(root);apps.push(app);await flush();
 return {advanced,panel,root,store,p,tabs:()=>walk(root).filter(node=>node.attrs.role==='tab'),children:()=>walk(root).map(node=>node.attrs['data-child']).filter(Boolean)};
}
it('opens only the pattern preview in simple mode, including a stale advanced subtab',async()=>{
 const ui=await mountPattern(false,'nesting');
 expect(ui.tabs().map(tab=>tab.textContent)).toEqual(['版型预览']);expect(ui.panel.value).toBe('pieces');
 expect(walk(ui.root).some(node=>node.attrs.id==='pattern-viewport')).toBe(true);
 expect(ui.children()).toEqual(['WorkspaceSplit','CutLibraryPanel','CutSelection']);
 expect(ui.store.data.project).toEqual(ui.p);expect(ui.store.data.project!.revision).toBe(0);
});
it('moves each advanced subtab back to preview when switching to simple mode without writing the project',async()=>{
 const ui=await mountPattern(true),before=JSON.stringify(ui.store.data.project);
 for(const [key,label]of [['materials','材料'],['seams','接缝'],['nesting','排料'],['workflow','制作流程']] as const){
  ui.advanced.value=true;await flush();expect(ui.tabs().map(tab=>tab.textContent)).toEqual(['裁片编辑','材料','接缝','排料','制作流程']);
  ui.tabs().find(tab=>tab.textContent===label)!.attrs.onClick();await flush();expect(ui.panel.value).toBe(key);
  ui.advanced.value=false;await flush();expect(ui.panel.value).toBe('pieces');expect(ui.tabs().map(tab=>tab.textContent)).toEqual(['版型预览']);
  expect(ui.children()).toEqual(['WorkspaceSplit','CutLibraryPanel','CutSelection']);
 }
 expect(JSON.stringify(ui.store.data.project)).toBe(before);
});
it('translates the simple preview label and advanced tools after locale changes',async()=>{
 localization.setLocale('ja');const ui=await mountPattern(false,'pieces','en');expect(ui.tabs().map(tab=>tab.textContent)).toEqual(['型紙プレビュー']);
 ui.advanced.value=true;await flush();expect(ui.tabs().map(tab=>tab.textContent)).toEqual(['型紙','素材','接ぎ目','配置','製作フロー']);
 ui.advanced.value=false;localization.setLocale('en');await flush();expect(ui.tabs().map(tab=>tab.textContent)).toEqual(['Pattern preview']);
});
async function mountProgress(enabled:boolean,language:'zh'|'en'='zh',settings:{defaultAllowanceMm?:number|null;applyResult?:'success'|'failure'|'cancel'}={}){
 vi.useFakeTimers();const {pinia,store,p}=state(),advanced=Vue.ref(enabled),root=new HostNode('root');p.surface={id:crypto.randomUUID(),topologyVersion:1,source:'obj',vertices:[],faces:[]};
 // Progress tests use an explicit existing preference. The separate missing
 // default cases below verify the intentional next-generation 2 mm change.
 if(settings.defaultAllowanceMm===null){delete p.defaultAllowanceMm;p.cuttingLibrary=acceptedCutProject().cuttingLibrary;}else{p.defaultAllowanceMm=settings.defaultAllowanceMm??10;p.pieces=p.pieces.map(piece=>({...piece,allowanceMm:p.defaultAllowanceMm!}));}
 const initial=JSON.stringify(store.data.project),calls:string[]=[];
 let listener!:(value:SurfaceProgress)=>void,resolve!:(value:Response)=>void;const pending=new Promise<Response>(done=>{resolve=done;}),unwrap=vi.fn(()=>{calls.push('unwrap');return pending;}),cancel=vi.fn(async()=>({ok:true,cancelled:true,data:store.data}));
 const apply=vi.fn(async(projectId:string,revision:number,command:{type:string;widthMm:number}):Promise<Response>=>{
  calls.push('apply');expect(projectId).toBe(p.id);expect(revision).toBe(store.data.project!.revision);expect(command.type).toBe('patterns.allowance');
  if(settings.applyResult==='failure')return{ok:false,error:{code:'TEST_REJECTED',messageKey:'TEST_REJECTED'}};
  if(settings.applyResult==='cancel')return{ok:true,cancelled:true,data:store.data};
  const current=JSON.parse(JSON.stringify(store.data));return{ok:true,data:{...current,project:{...spacing.withPatternSpacing(current.project,command.widthMm),revision:revision+1}}};
 });
 vi.stubGlobal('window',{fpcad:{onSurfaceProgress:(callback:(value:SurfaceProgress)=>void)=>{listener=callback;return ()=>{};},apply,unwrapSurface:unwrap,cancelSurface:cancel}});
 const app=renderer.createApp(Vue.defineComponent({setup(){Vue.provide('advancedMode',advanced);return ()=>Vue.h(UnwrapTools,{language});}}));app.use(pinia);app.mount(root);apps.push(app);await flush();
 const button=walk(root).find(node=>node.tag==='button'&&node.attrs.title===(language==='zh'?'裁切并计算版型预览':'Cut and compute pattern preview'))!;
 const action=button.attrs.onClick();await flush();await vi.advanceTimersByTimeAsync(200);await flush();
 const progress=(stage:SurfaceProgress['stage']='unwrap')=>{listener({projectId:p.id,revision:store.data.project!.revision,stage,completed:7500,total:10000});};
 return {root,store,p,initial,calls,apply,advanced,progress,unwrap,cancel,finish:async(pieces?:Piece[])=>{resolve(pieces?{ok:true,data:{...JSON.parse(JSON.stringify(store.data)),project:{...JSON.parse(JSON.stringify(store.data.project)),surfaceRun:{sourceHash:'a'.repeat(64),algorithm:'lscm-arap-1',accepted:false,pieces,bindings:[]}}}}:{ok:false,error:{code:'CANCELLED',messageKey:'CANCELLED'}});await action;await flush();}};
}
it('keeps mesh counts out of simple progress and shows only the real candidate piece count after completion',async()=>{
 const ui=await mountProgress(false);try{
  ui.progress();await flush();const status=walk(ui.root).find(node=>node.attrs.class==='surface-progress')!;expect(status.textContent).toContain('展开版型');expect(status.textContent).not.toMatch(/7500|10000|三角面|展开面/);
  const bar=walk(status).find(node=>node.tag==='progress')!;expect(bar.attrs.value).toBeUndefined();expect(bar.attrs.max).toBeUndefined();
  await ui.finish([rectangle(),rectangle(),rectangle()]);
  const report=walk(ui.root).find(node=>node.attrs.class==='run-report')!;expect(report.children.find(node=>node.tag==='strong')!.textContent).toContain('3 片');expect(report.textContent).not.toContain('10000');
 }finally{await ui.finish();}
});
it('labels advanced counts as mesh triangle workload and removes them when switching to simple mode',async()=>{
 const ui=await mountProgress(true,'en');try{
  ui.progress();await flush();let status=walk(ui.root).find(node=>node.attrs.class==='surface-progress')!;expect(status.textContent).toContain('Mesh triangles (workload) 7500 / 10000');expect(status.textContent).not.toMatch(/10000 pieces|10000 faces/);
  let bar=walk(status).find(node=>node.tag==='progress')!;expect(bar.attrs).toMatchObject({value:7500,max:10000,'aria-label':'Mesh triangle processing progress'});
  ui.progress('validate');await flush();status=walk(ui.root).find(node=>node.attrs.class==='surface-progress')!;expect(status.textContent).toContain('Validating patterns');expect(status.textContent).not.toContain('10000');
  ui.progress();ui.advanced.value=false;await flush();status=walk(ui.root).find(node=>node.attrs.class==='surface-progress')!;expect(status.textContent).not.toContain('10000');bar=walk(status).find(node=>node.tag==='progress')!;expect(bar.attrs.value).toBeUndefined();
  const cancel=walk(status).find(node=>node.tag==='button')!;await cancel.attrs.onClick();expect(ui.cancel).toHaveBeenCalledWith(ui.p.id,ui.p.revision);
 }finally{await ui.finish();}
});
it('a missing generation preference applies 2 mm before computing at the new revision and retains saved cut snapshots',async()=>{
 const ui=await mountProgress(false,'zh',{defaultAllowanceMm:null});try{
  expect(ui.calls).toEqual(['apply','unwrap']);expect(ui.apply).toHaveBeenCalledExactlyOnceWith(ui.p.id,0,{type:'patterns.allowance',widthMm:2});expect(ui.unwrap).toHaveBeenCalledWith(ui.p.id,1,expect.any(Object));
  expect(ui.store.data.project!.defaultAllowanceMm).toBe(2);expect(ui.store.data.project!.pieces.every(piece=>piece.allowanceMm===2)).toBe(true);expect(ui.store.data.project!.cuttingLibrary).toEqual(JSON.parse(ui.initial).cuttingLibrary);
  ui.progress();await flush();expect(walk(ui.root).find(node=>node.attrs.class==='surface-progress')!.textContent).toContain('展开版型');
 }finally{await ui.finish();}
});
it.each(['failure','cancel'] as const)('a %s while applying the new default leaves all project state intact and never starts computation',async applyResult=>{
 const ui=await mountProgress(false,'zh',{defaultAllowanceMm:null,applyResult});try{expect(ui.apply).toHaveBeenCalledTimes(1);expect(ui.unwrap).not.toHaveBeenCalled();expect(ui.calls).toEqual(['apply']);expect(JSON.stringify(ui.store.data.project)).toBe(ui.initial);expect(walk(ui.root).some(node=>node.attrs.class==='surface-progress')).toBe(false);expect(ui.store.busy).toBe(false);}finally{await ui.finish();}
});
it('an explicit custom generation preference is retained without an extra write',async()=>{
 const ui=await mountProgress(false,'zh',{defaultAllowanceMm:7});try{expect(ui.apply).not.toHaveBeenCalled();expect(ui.unwrap).toHaveBeenCalledWith(ui.p.id,0,expect.any(Object));expect(ui.store.data.project!.defaultAllowanceMm).toBe(7);expect(ui.store.data.project!.pieces[0].allowanceMm).toBe(7);}finally{await ui.finish();}
});
