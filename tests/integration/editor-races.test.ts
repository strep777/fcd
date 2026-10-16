import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {ref,markRaw,nextTick} from 'vue';
import {useSession} from '../../apps/desktop/src/store';
import {usePatternEditor} from '../../apps/desktop/src/modules/usePatternEditor';
import type {Stage} from '../../apps/desktop/src/modules/workflow-tabs';
import {project} from '../fixtures';
import {stubAnimationFrames} from '../animation-frames';
import type {Piece,Response} from '../../packages/schema/index';
let frames:ReturnType<typeof stubAnimationFrames>;
beforeEach(()=>{setActivePinia(createPinia());frames=stubAnimationFrames();});afterEach(()=>vi.unstubAllGlobals());
function setup(){
 const store=useSession(),p=project();store.data.project=p;const stage=ref<Stage>('pattern'),editor=usePatternEditor(ref('zh'),stage,()=>{}),apply=vi.fn(async(_id:string,_revision:number,_command:{type:'piece.put';piece:Piece})=>({ok:true,data:store.data}));vi.stubGlobal('window',{fpcad:{apply},dispatchEvent:()=>true});
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

it.each(['polygon','open','hole'] as const)('retains a rejected %s drawing so it can be corrected and saved again',async kind=>{
 const {editor,p,store}=setup();editor.cancel();editor.selectedId.value=p.pieces[0].id;
 if(kind==='hole')editor.startHole();else if(kind==='open')editor.startOpenPath();
 editor.tool.value='polygon';const nodes=[{id:'new-a',xMm:10,yMm:10},{id:'new-b',xMm:20,yMm:10},{id:'new-c',xMm:20,yMm:20}];editor.draft.value=nodes;
 const apply=vi.fn<(...args:unknown[])=>Promise<Response>>().mockResolvedValueOnce({ok:false,error:{code:'INVALID_GEOMETRY',messageKey:'INVALID_GEOMETRY'}}).mockImplementationOnce(async(...args)=>{const command=args[2] as {piece:Piece};return {ok:true,data:{...store.data,project:{...p,revision:p.revision+1,pieces:[command.piece]}}};});
 vi.stubGlobal('window',{fpcad:{apply},dispatchEvent:()=>true});await editor.finish();
 expect(editor.draft.value).toEqual(nodes);expect(editor.tool.value).toBe('polygon');expect(editor.draftClosed.value).toBe(kind!=='open');expect(editor.holeTarget.value).toBe(kind==='hole'?p.pieces[0].id:'');
 editor.draft.value[2].xMm=18;await editor.finish();expect(apply).toHaveBeenCalledTimes(2);expect(editor.draft.value).toEqual([]);expect(editor.tool.value).toBe('node');
 const saved=(apply.mock.calls[1][2] as {piece:Piece}).piece;expect(kind==='hole'?saved.holes?.at(-1)?.[2].xMm:saved.nodes[2].xMm).toBe(18);expect(saved.closed).toBe(kind!=='open');
});

it('does not turn a hole whose parent was removed into a new standalone pattern',async()=>{
 const {editor,p,store,apply}=setup();editor.cancel();editor.selectedId.value=p.pieces[0].id;editor.startHole();editor.tool.value='polygon';editor.draft.value=[{id:'a',xMm:1,yMm:1},{id:'b',xMm:2,yMm:1},{id:'c',xMm:2,yMm:2}];
 store.data.project={...p,revision:p.revision+1,pieces:[]};await editor.finish();expect(apply).not.toHaveBeenCalled();expect(editor.draft.value).toHaveLength(3);expect(store.error).toBe('STALE_EDIT');
});

it('a completed save does not erase a replacement draft started while it was pending',async()=>{
 const {editor,store}=setup();editor.cancel();editor.tool.value='polygon';editor.draft.value=[{id:'a',xMm:1,yMm:1},{id:'b',xMm:2,yMm:1},{id:'c',xMm:2,yMm:2}];
 let complete!:(response:Response)=>void;const apply=vi.fn(()=>new Promise<Response>(resolve=>{complete=resolve;}));vi.stubGlobal('window',{fpcad:{apply},dispatchEvent:()=>true});
 const saving=editor.finish();await editor.finish();expect(apply).toHaveBeenCalledTimes(1);editor.cancel();editor.changeTool('polygon');editor.draft.value=[{id:'replacement',xMm:30,yMm:40}];
 complete({ok:true,data:store.data});await saving;expect(editor.draft.value).toEqual([{id:'replacement',xMm:30,yMm:40}]);expect(editor.tool.value).toBe('polygon');
});
