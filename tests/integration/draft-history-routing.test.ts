import {createRenderer,defineComponent,ref,nextTick,h} from 'vue';
import {expect,it} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {usePatternEditor} from '../../apps/desktop/src/modules/usePatternEditor';
import {nextHistoryStamp} from '../../packages/ui/draft-history';
import {useDraftHistory,requestDraftHistory} from '../../apps/desktop/src/modules/useDraftHistory';
const renderer=createRenderer<any,any>({createElement:type=>({type,children:[]}),insert:(node,parent)=>parent.children.push(node),remove:()=>{},createText:text=>({text}),createComment:text=>({text}),setText:(n,t)=>{n.text=t;},setElementText:(n,t)=>{n.text=t;},parentNode:()=>null,nextSibling:()=>null,patchProp:()=>{}});
it('undo and redo follow interleaved edits across two visible drafts in action order',()=>{
 const left=ref({x:0}),right=ref({x:0}),active=ref(true);let a:ReturnType<typeof useDraftHistory<{x:number}>>,b:typeof a;
 const app=renderer.createApp(defineComponent({setup(){a=useDraftHistory(()=>left.value,value=>{left.value=value;},()=>active.value);b=useDraftHistory(()=>right.value,value=>{right.value=value;},()=>active.value);return ()=>null;}}));app.mount({children:[]});
 try{left.value.x=1;right.value.x=2;left.value.x=3;expect(requestDraftHistory()).toBe(true);expect(left.value.x).toBe(1);expect(right.value.x).toBe(2);expect(requestDraftHistory()).toBe(true);expect(right.value.x).toBe(0);expect(left.value.x).toBe(1);expect(requestDraftHistory()).toBe(true);expect(left.value.x).toBe(0);expect(requestDraftHistory(true)).toBe(true);expect(left.value.x).toBe(1);expect(requestDraftHistory(true)).toBe(true);expect(right.value.x).toBe(2);expect(requestDraftHistory(true)).toBe(true);expect(left.value.x).toBe(3);a!.reset(()=>{left.value={x:0};});b!.reset(()=>{right.value={x:0};});}finally{app.unmount();}
});
it('one continuous node gesture restores every field and a committed reset discards stale redo',()=>{
 const state=ref({nodes:[0,10],holes:[[2,3]]});let history:ReturnType<typeof useDraftHistory<typeof state.value>>;const app=renderer.createApp(defineComponent({setup(){history=useDraftHistory(()=>state.value,value=>{state.value=value;},()=>true);return ()=>null;}}));app.mount({children:[]});
 try{history!.begin();for(let i=0;i<30;i++){state.value.nodes[0]=i;state.value.holes[0][0]=i+2;}history!.end();history!.move();expect(state.value).toEqual({nodes:[0,10],holes:[[2,3]]});history!.move(true);expect(state.value.nodes[0]).toBe(29);history!.reset(()=>{state.value={nodes:[100,110],holes:[[102,103]]};});expect(history!.move()).toBe(false);expect(history!.move(true)).toBe(false);}finally{app.unmount();}
});

it('redo survives a child editor restoration emitted to a parent and rendered on the next tick',async()=>{
 const state=ref({x:0});let history:ReturnType<typeof useDraftHistory<{x:number}>>;
 const Child=defineComponent({props:['value'],emits:['update'],setup(props,{emit}){history=useDraftHistory(()=>props.value,value=>emit('update',value),()=>true);return ()=>null;}});
 const app=renderer.createApp(defineComponent({setup(){return ()=>h(Child,{value:state.value,onUpdate:(value:{x:number})=>{state.value=value;}});}}));app.mount({children:[]});
 try{state.value={x:12};await nextTick();expect(history!.move()).toBe(true);await nextTick();expect(state.value.x).toBe(0);expect(history!.move(true)).toBe(true);await nextTick();expect(state.value.x).toBe(12);expect(history!.move()).toBe(true);await nextTick();expect(state.value.x).toBe(0);}finally{app.unmount();}
});

it('draft A, committed B, draft C undo C/B/A and redo A/B/C without crossing a newer boundary',()=>{
 const left=ref({x:0}),right=ref({x:0});let a:ReturnType<typeof useDraftHistory<{x:number}>>,c:typeof a;
 const app=renderer.createApp(defineComponent({setup(){a=useDraftHistory(()=>left.value,v=>{left.value=v;},()=>true);c=useDraftHistory(()=>right.value,v=>{right.value=v;},()=>true);return ()=>null;}}));app.mount({children:[]});
 try{left.value.x=1;const committedB=nextHistoryStamp();right.value.x=3;expect(requestDraftHistory(false,committedB)).toBe(true);expect(right.value.x).toBe(0);expect(requestDraftHistory(false,committedB)).toBe(false);expect(left.value.x).toBe(1);expect(requestDraftHistory(false,0)).toBe(true);expect(left.value.x).toBe(0);expect(requestDraftHistory(true,committedB)).toBe(true);expect(left.value.x).toBe(1);expect(requestDraftHistory(true,committedB)).toBe(false);expect(right.value.x).toBe(0);expect(requestDraftHistory(true)).toBe(true);expect(right.value.x).toBe(3);expect(requestDraftHistory()).toBe(true);left.value.x=4;expect(c!.canRedo.value).toBe(false);a!.reset(()=>{left.value={x:0};});c!.reset(()=>{right.value={x:0};});expect(requestDraftHistory(false,Infinity)).toBe(false);}finally{app.unmount();}
});

it('hidden editor synchronization does not create a user undo step or retain stale redo',()=>{const state=ref({x:0}),active=ref(true);let history:ReturnType<typeof useDraftHistory<{x:number}>>;const app=renderer.createApp(defineComponent({setup(){history=useDraftHistory(()=>state.value,v=>{state.value=v;},()=>active.value);return ()=>null;}}));app.mount({children:[]});try{state.value.x=1;history!.move();expect(history!.canRedo.value).toBe(true);active.value=false;state.value.x=20;active.value=true;expect(history!.canUndo.value).toBe(false);expect(history!.canRedo.value).toBe(false);expect(history!.move()).toBe(false);}finally{app.unmount();}});

it('stopping a pattern pointer gesture before committed undo preserves an older polygon draft',()=>{setActivePinia(createPinia());let editor:ReturnType<typeof usePatternEditor>;const app=renderer.createApp(defineComponent({setup(){editor=usePatternEditor(ref<'zh'|'en'>('en'),ref<'pattern'>('pattern'),()=>{});return ()=>null;}}));app.mount({children:[]});try{editor!.tool.value='polygon';editor!.draft.value=[{id:'a',xMm:0,yMm:0}];const b=nextHistoryStamp();editor!.draft.value.push({id:'c',xMm:20,yMm:0});expect(requestDraftHistory(false,b)).toBe(true);expect(editor!.draft.value).toHaveLength(1);expect(requestDraftHistory(false,b)).toBe(false);editor!.stopGesture();expect(editor!.draft.value).toHaveLength(1);expect(requestDraftHistory(false,0)).toBe(true);expect(editor!.draft.value).toHaveLength(0);}finally{app.unmount();}});
