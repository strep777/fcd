import {afterEach,it,expect,vi} from 'vitest';
import {createRenderer,defineComponent,h,nextTick,ref} from 'vue';
import * as Vue from 'vue';
import * as viewport from '../../packages/ui/viewport';
import {readFileSync} from 'node:fs';
import {parse,compileScript} from '@vue/compiler-sfc';
import {transformSync} from 'esbuild';
const descriptor=parse(readFileSync('apps/desktop/src/ZoomViewport.vue','utf8')).descriptor,script=compileScript(descriptor,{id:'focus-regression',inlineTemplate:true}),compiled=transformSync(script.content,{loader:'ts',format:'cjs'}).code,loaded={exports:{} as any};
new Function('require','module','exports',compiled)((name:string)=>name==='vue'?Vue:name.endsWith('/viewport')?viewport:{default:defineComponent({render:()=>h('svg')})},loaded,loaded.exports);
const ZoomViewport=loaded.exports.default;
type Node={tag:string;text?:string;props:Record<string,any>;children:Node[];parent?:Node;querySelector:(selector:string)=>Node|undefined;getScreenCTM:()=>any;setPointerCapture:()=>void;hasPointerCapture:()=>boolean;releasePointerCapture:()=>void;focus:()=>void};
const find=(node:Node,predicate:(node:Node)=>boolean):Node|undefined=>predicate(node)?node:node.children.map(child=>find(child,predicate)).find(Boolean);
function node(tag:string,text?:string):Node{return {tag,text,props:{},children:[],querySelector(selector){return find(this,n=>n.tag===selector);},getScreenCTM:()=>({inverse:()=>({})}),setPointerCapture(){},hasPointerCapture(){return false;},releasePointerCapture(){},focus(){}};}
function mount(hide=false){
 vi.stubGlobal('window',{addEventListener(){},removeEventListener(){}});vi.stubGlobal('DOMPoint',class{constructor(public x:number,public y:number){}matrixTransform(){return this;}});
 const renderer=createRenderer<Node,Node>({createElement:tag=>node(tag),createText:text=>node('#text',text),createComment:text=>node('#comment',text),setText:(n,text)=>{n.text=text;},setElementText:(n,text)=>{n.text=text;n.children=[];},parentNode:n=>n.parent??null,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]??null,patchProp:(n,key,_old,value)=>{n.props[key]=value;},insert(n,parent,anchor){if(n.parent)n.parent.children=n.parent.children.filter(child=>child!==n);n.parent=parent;const index=anchor?parent.children.indexOf(anchor):-1;if(index<0)parent.children.push(n);else parent.children.splice(index,0,n);},remove(n){if(n.parent)n.parent.children=n.parent.children.filter(child=>child!==n);}});
 const focusBox=ref<string|undefined>('400 200 100 100'),drawing=ref(false),root=node('root'),app=renderer.createApp(defineComponent({setup(){return ()=>h(ZoomViewport,{viewBox:'0 0 1000 600',focusBox:focusBox.value,hideInteractionTools:hide,drawing:drawing.value,label:'test',language:'zh'},{default:({viewBox}:{viewBox:string})=>h('svg',{viewBox})});}}));app.mount(root);return {root,app,focusBox,drawing,box:()=>find(root,n=>n.tag==='svg'&&!!n.props.viewBox)!.props.viewBox,content:()=>find(root,n=>n.props.class?.includes('zoom-content'))!};
}
afterEach(()=>vi.unstubAllGlobals());
it('clearing a focused source leaves the current camera and active middle-pan gesture intact',async()=>{
 const ui=mount();try{const focused=ui.box();ui.focusBox.value=undefined;await nextTick();expect(ui.box()).toBe(focused);
 ui.focusBox.value='200 100 100 100';await nextTick();const next=ui.box();expect(next).not.toBe(focused);const event={button:1,pointerId:3,clientX:0,clientY:0,preventDefault(){},stopImmediatePropagation(){}};ui.content().props.onPointerdownCapture(event);ui.content().props.onPointermoveCapture({...event,clientX:20,clientY:10});await nextTick();const panned=ui.box();expect(panned).not.toBe(next);ui.focusBox.value=undefined;await nextTick();expect(ui.box()).toBe(panned);ui.content().props.onPointermoveCapture({...event,clientX:40,clientY:20});await nextTick();expect(ui.box()).not.toBe(panned);ui.content().props.onPointerupCapture(event);
 }finally{ui.app.unmount();}
});
it('focus changes cannot jump the camera during drawing and interaction buttons can be omitted for a shared source rail',async()=>{
 const ui=mount(true);try{const before=ui.box();ui.drawing.value=true;await nextTick();ui.focusBox.value='10 20 40 50';await nextTick();expect(ui.box()).toBe(before);ui.focusBox.value=undefined;await nextTick();expect(ui.box()).toBe(before);expect(find(ui.root,n=>n.props['aria-label']==='选择 / 编辑')).toBeUndefined();expect(find(ui.root,n=>n.props['aria-label']==='手形平移')).toBeUndefined();expect(find(ui.root,n=>n.props['aria-label']==='放大')).toBeDefined();}finally{ui.app.unmount();}
});
