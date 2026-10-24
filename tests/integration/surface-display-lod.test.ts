import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as Vue from 'vue';
import {createPinia,setActivePinia} from 'pinia';
import {randomUUID} from 'node:crypto';
import SurfacePanel from '../../apps/desktop/src/SurfacePanel.vue';
import {useSession} from '../../apps/desktop/src/store';
import type {Project,Surface} from '../../packages/schema/index';
import {project} from '../fixtures';

const lod=vi.hoisted(()=>({compute:vi.fn()}));
vi.mock('../../packages/surface/preview',async original=>({...await original<typeof import('../../packages/surface/preview')>(),previewLod:lod.compute}));
const mounted:Vue.App[]=[];
beforeEach(()=>{
 setActivePinia(createPinia());lod.compute.mockReset();const events=new EventTarget();vi.stubGlobal('document',{documentElement:{},querySelector:()=>null});vi.stubGlobal('getComputedStyle',()=>({getPropertyValue:()=>''}));vi.stubGlobal('window',{addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)});
});
afterEach(()=>{for(const app of mounted.splice(0))app.unmount();vi.unstubAllGlobals();});

function fixture(){
 const p=project(),piece=p.pieces[0],vertices=piece.nodes.map(point=>({id:randomUUID(),xMm:point.xMm,yMm:point.yMm,zMm:0})),surface:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces:[{id:randomUUID(),region:'sheet',vertices:[vertices[0].id,vertices[1].id,vertices[2].id]},{id:randomUUID(),region:'sheet',vertices:[vertices[0].id,vertices[2].id,vertices[3].id]}]};p.surface=surface;
 p.bindings=[{pieceId:piece.id,surfaceId:surface.id,topologyVersion:1,geometryHash:'0'.repeat(64),surfaceHash:'0'.repeat(64),report:{faceIds:[surface.faces[1].id],uv:vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm})),boundary:vertices.map(v=>v.id),areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'}}];return p;
}
function mount(p:Project){
 const store=useSession();store.data={project:p,geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery:[],history:[],recent:[],jobs:[]};let state:any;
 const renderer=Vue.createRenderer<any,any>({createElement:()=>({children:[]}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){},insert(){},remove(){}});
 // Run the actual SFC setup and computed display data. No GPU/LOD algorithm is
 // substituted as correctness evidence: the analytic source-face map below
 // tests only whether the UI reads the display mesh it actually selected.
 const setup=(SurfacePanel as unknown as {setup:(props:unknown,context:unknown)=>any}).setup,app=renderer.createApp(Vue.defineComponent({setup(){state=setup(Vue.reactive({language:'en',mode:'model',selectedId:p.pieces[0].id}),{emit:vi.fn(),expose(){}});return()=>null;}}));app.provide(Vue.ssrContextKey,{modules:new Set()});app.mount({});mounted.push(app);return state;
}

it.each(['texture','explicit detail'] as const)('does not construct an unused simplified mesh when %s displays full geometry with a selected pattern',mode=>{
 const p=fixture();if(mode==='texture')p.surface!.textures=[{id:randomUUID(),name:'Texture',width:1,height:1,png:'data:image/png;base64,AA==',sha256:'0'.repeat(64),proxy:{width:1,height:1,png:'data:image/png;base64,AA=='}}];lod.compute.mockImplementation(()=>{throw Error('Unexpected LOD computation');});const state=mount(p);if(mode==='explicit detail')state.detail.value=true;
 const faces=state.faceStyles.value;expect(faces).toHaveLength(2);expect(faces[1].pieceId).toBe(p.pieces[0].id);expect(faces[1].color).toBe('#ffffff');expect(lod.compute).not.toHaveBeenCalled();
});

it('highlights a simplified display face when its original source face belongs to the selected pattern',()=>{
 const p=fixture(),surface=p.surface!,previewFace={...surface.faces[0],id:randomUUID()};lod.compute.mockReturnValue({vertices:surface.vertices,faces:[previewFace],errorMm:.1,sourceFaces:new Map([[previewFace.id,surface.faces.map(face=>face.id)]])});const state=mount(p),faces=state.faceStyles.value;
 expect(lod.compute).toHaveBeenCalledOnce();expect(faces).toHaveLength(1);expect(faces[0]).toMatchObject({id:previewFace.id,pieceId:p.pieces[0].id,color:'#ffffff'});
});
