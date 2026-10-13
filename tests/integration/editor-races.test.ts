import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {ref,markRaw,nextTick} from 'vue';
import {useSession} from '../../apps/desktop/src/store';
import {usePatternEditor} from '../../apps/desktop/src/modules/usePatternEditor';
import type {Stage} from '../../apps/desktop/src/modules/workflow-tabs';
import {project} from '../fixtures';
import {stubAnimationFrames} from '../animation-frames';
import type {Piece} from '../../packages/schema/index';
let frames:ReturnType<typeof stubAnimationFrames>;
beforeEach(()=>{setActivePinia(createPinia());frames=stubAnimationFrames();});afterEach(()=>vi.unstubAllGlobals());
function setup(){
 const store=useSession(),p=project();store.data.project=p;const stage=ref<Stage>('pattern'),editor=usePatternEditor(ref('zh'),stage,()=>{}),apply=vi.fn(async(_id:string,_revision:number,_command:{type:'piece.put';piece:Piece})=>({ok:true,data:store.data}));vi.stubGlobal('window',{fpcad:{apply}});
 editor.svg.value=markRaw({clientWidth:800,clientHeight:600,getScreenCTM:()=>({inverse:()=>({})}),createSVGPoint:()=>({x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}}),setPointerCapture:()=>{}}) as unknown as SVGSVGElement;
 const event=(x:number)=>({button:0,clientX:x,clientY:0,pointerId:1}) as PointerEvent;
 expect(editor.tool.value).toBe('select');editor.changeTool('select');
 editor.down(event(0),p.pieces[0],p.pieces[0].nodes[0]);editor.move(event(20));return {store,p,stage,editor,apply};
}
it('does not replace an external revision with the old drag snapshot',async()=>{
 const {store,p,editor,apply}=setup();store.data.project={...p,revision:1,pieces:[{...p.pieces[0],name:'助手已修改'}]};await editor.up();
 expect(apply).not.toHaveBeenCalled();expect(store.data.project.pieces[0].name).toBe('助手已修改');expect(store.error).toBe('STALE_EDIT');expect(editor.preview.value).toBeNull();
 expect(frames.pending).toBe(0);frames.flush();expect(apply).not.toHaveBeenCalled();expect(editor.preview.value).toBeNull();
});
it('does not commit a pointer gesture after leaving the pattern editor',async()=>{const {stage,editor,apply}=setup();stage.value='references';await editor.up();expect(apply).not.toHaveBeenCalled();});
it('submits normal drags using their original revision and refreshes selected coordinates after external edits',async()=>{
 const {store,p,editor,apply}=setup();await editor.up();expect(apply).toHaveBeenCalledWith(p.id,0,expect.objectContaining({type:'piece.put'}));
 expect(apply.mock.calls[0][2].piece.nodes[0].xMm).toBe(20);expect(frames.pending).toBe(0);
 store.data.project={...p,revision:1,pieces:[{...p.pieces[0],nodes:p.pieces[0].nodes.map((n,i)=>i===0?{...n,xMm:42,yMm:43}:n)}]};await nextTick();expect(editor.nodeX.value).toBe(42);expect(editor.nodeY.value).toBe(43);
});
it('coalesces pointer motion into one frame, flushes its final point on release and discards cancelled pending moves',async()=>{
 const {p,editor,apply}=setup();const event=(x:number)=>({button:0,clientX:x,clientY:0,pointerId:1}) as PointerEvent;
 editor.move(event(25));editor.move(event(40));expect(frames.pending).toBe(1);expect(editor.preview.value).toBeNull();frames.flush();expect(editor.preview.value!.nodes[0].xMm).toBe(40);
 editor.move(event(65));expect(frames.pending).toBe(1);await editor.up();expect(apply).toHaveBeenCalledTimes(1);expect(apply.mock.calls[0][2].piece.nodes[0].xMm).toBe(65);expect(frames.pending).toBe(0);
 editor.down(event(0),p.pieces[0],p.pieces[0].nodes[0]);editor.move(event(80));expect(frames.pending).toBe(1);editor.cancel();expect(frames.pending).toBe(0);frames.flush();await editor.up();expect(apply).toHaveBeenCalledTimes(1);expect(editor.preview.value).toBeNull();
});
it('pattern zoom keeps the cursor location fixed and cannot change geometry or accept invalid wheel values',()=>{
 const {p,editor}=setup();editor.cancel();editor.view.value={x:-100,y:-100,w:800,h:600};const before=structuredClone(p),event={deltaY:-100,clientX:100,clientY:150,preventDefault(){}} as WheelEvent;
 const u=(event.clientX-editor.view.value.x)/editor.view.value.w,v=(event.clientY-editor.view.value.y)/editor.view.value.h;editor.zoom(event);
 expect((event.clientX-editor.view.value.x)/editor.view.value.w).toBeCloseTo(u,12);expect((event.clientY-editor.view.value.y)/editor.view.value.h).toBeCloseTo(v,12);expect(p).toEqual(before);
 const view={...editor.view.value};editor.zoom({...event,deltaY:NaN} as WheelEvent);expect(editor.view.value).toEqual(view);
});
