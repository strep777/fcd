import {afterEach,expect,it,vi} from 'vitest';
import {createRenderer,defineComponent,ref} from 'vue';
import {createPinia,setActivePinia} from 'pinia';
import {usePatternEditor} from '../../apps/desktop/src/modules/usePatternEditor';
import {useSession} from '../../apps/desktop/src/store';
import {withPatternSpacing} from '../../packages/manufacturing/pattern-spacing';
import {project,rectangle} from '../fixtures';

afterEach(()=>vi.unstubAllGlobals());
function setup(){
 setActivePinia(createPinia());const store=useSession(),p=project();p.pieces=[{...rectangle(),allowanceMm:0},{...rectangle(60,80),allowanceMm:20}];store.data.project=p;
 let editor!:ReturnType<typeof usePatternEditor>;
 const renderer=createRenderer<any,any>({createElement:()=>({}),createText:()=>({}),createComment:()=>({}),insert(){},remove(){},setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){}}),app=renderer.createApp(defineComponent({setup(){editor=usePatternEditor(ref('zh'),ref('pattern'),vi.fn());return ()=>null;}}));app.mount({});return {store,p,editor,app};
}

it('applies spacing once to every current pattern without selecting a piece or creating a calculation job',async()=>{
 const ui=setup(),apply=vi.fn(async(_id:string,revision:number,command:{widthMm:number;join:'round'})=>({ok:true as const,data:{...JSON.parse(JSON.stringify(ui.store.data)),project:{...withPatternSpacing(ui.p,command.widthMm,command.join),revision:revision+1}}}));vi.stubGlobal('window',{fpcad:{apply,cancelSurface:vi.fn()}});
 try{expect(ui.editor.selectedId.value).toBe('');ui.editor.spacingMm.value=6;ui.editor.spacingJoin.value='round';await ui.editor.applyPatternSpacing();expect(apply).toHaveBeenCalledTimes(1);expect(apply).toHaveBeenCalledWith(ui.p.id,ui.p.revision,{type:'patterns.allowance',widthMm:6,join:'round'});expect(ui.store.data.project!.pieces.every(piece=>piece.allowanceMm===6&&piece.join==='round')).toBe(true);expect(ui.store.data.jobs).toEqual([]);await ui.editor.applyPatternSpacing();expect(apply).toHaveBeenCalledTimes(1);}finally{ui.app.unmount();}
});

it('does not send invalid or busy spacing edits, and a rejected operation preserves every piece',async()=>{
 const ui=setup(),apply=vi.fn(async()=>({ok:false,error:{code:'INVALID_GEOMETRY'}}));vi.stubGlobal('window',{fpcad:{apply,cancelSurface:vi.fn()}});
 try{const before=JSON.parse(JSON.stringify(ui.p));for(const width of [-1,1001,NaN]){ui.editor.spacingMm.value=width;await ui.editor.applyPatternSpacing();}expect(apply).not.toHaveBeenCalled();ui.editor.spacingMm.value=5;ui.store.busy=true;await ui.editor.applyPatternSpacing();expect(apply).not.toHaveBeenCalled();ui.store.busy=false;await ui.editor.applyPatternSpacing();expect(apply).toHaveBeenCalledTimes(1);expect(ui.store.data.project).toEqual(before);expect(ui.store.error).toBe('INVALID_GEOMETRY');}finally{ui.app.unmount();}
});
