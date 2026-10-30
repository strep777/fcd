import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as Vue from 'vue';
import {createPinia,setActivePinia} from 'pinia';
import {createHash,randomUUID} from 'node:crypto';
import SurfacePanel from '../../apps/desktop/src/SurfacePanel.vue';
import {useSession} from '../../apps/desktop/src/store';
import type {Project,Surface} from '../../packages/schema/index';
import {project} from '../fixtures';

const calls=vi.hoisted(()=>({integrity:vi.fn(),seams:vi.fn()}));
vi.mock('../../packages/surface/assembly-integrity',async original=>{const actual=await original<typeof import('../../packages/surface/assembly-integrity')>();return {...actual,assemblyIntegrity:calls.integrity.mockImplementation(actual.assemblyIntegrity)};});
vi.mock('../../packages/surface/candidate-seams',async original=>{const actual=await original<typeof import('../../packages/surface/candidate-seams')>();return {...actual,candidateSeamPreview:calls.seams.mockImplementation(actual.candidateSeamPreview)};});
const mounted:Vue.App[]=[];
beforeEach(()=>{
 setActivePinia(createPinia());calls.integrity.mockClear();calls.seams.mockClear();const events=new EventTarget();
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>setTimeout(()=>callback(performance.now()),0));vi.stubGlobal('cancelAnimationFrame',(handle:ReturnType<typeof setTimeout>)=>clearTimeout(handle));
 vi.stubGlobal('document',{documentElement:{},querySelector:()=>null});vi.stubGlobal('getComputedStyle',()=>({getPropertyValue:()=>''}));vi.stubGlobal('window',{addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)});
});
afterEach(()=>{for(const app of mounted.splice(0))app.unmount();vi.unstubAllGlobals();});
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture():Project{
 const p=project(),piece=p.pieces[0],vertices=piece.nodes.map(point=>({id:randomUUID(),xMm:point.xMm,yMm:point.yMm,zMm:0})),surface:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces:[{id:randomUUID(),region:'sheet',vertices:[vertices[0].id,vertices[1].id,vertices[2].id]},{id:randomUUID(),region:'sheet',vertices:[vertices[0].id,vertices[2].id,vertices[3].id]}]};p.surface=surface;
 p.bindings=[{pieceId:piece.id,surfaceId:surface.id,topologyVersion:1,geometryHash:hash({nodes:piece.nodes,holes:[],curves:[]}),surfaceHash:hash(surface),report:{faceIds:surface.faces.map(face=>face.id),uv:vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm})),boundary:vertices.map(v=>v.id),areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'}}];
 p.surfaceRun={accepted:true,sourceHash:hash(surface),algorithm:'lscm-arap-1',pieces:structuredClone(p.pieces),bindings:structuredClone(p.bindings)};return p;
}
function mount(p:Project,mode:'mapping'|'cutting'|'model'|'references'='mapping'){
 const store=useSession();store.data={project:p,geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery:[],history:[],recent:[],jobs:[]};let state:any;
 const props=Vue.reactive({language:'en',mode,selectedId:''}),renderer=Vue.createRenderer<any,any>({createElement:()=>({children:[]}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){},insert(){},remove(){}}),setup=(SurfacePanel as unknown as {setup:(props:unknown,context:unknown)=>any}).setup;
 const app=renderer.createApp(Vue.defineComponent({setup(){state=setup(props,{emit:vi.fn(),expose(){}});return()=>null;}}));app.provide(Vue.ssrContextKey,{modules:new Set()});app.mount({});mounted.push(app);return {state,props,store};
}
async function settled(){await Vue.nextTick();await Promise.all(calls.integrity.mock.results.filter(result=>result.type==='return').map(result=>result.value));await Vue.nextTick();}

it.each(['model','references'] as const)('does not check saved seam geometry on the %s page',async mode=>{
 const {state,store}=mount(fixture(),mode);await Vue.nextTick();store.data={...store.data,project:structuredClone(Vue.toRaw(store.data.project))};await Vue.nextTick();expect(calls.integrity).not.toHaveBeenCalled();expect(state.acceptedSeams.value).toEqual([]);
});
it('skips disabled saved seams and checks the latest project when enabled again',async()=>{
 const {state,store}=mount(fixture());await settled();expect(state.acceptedSeamRun.value).toBeDefined();state.showAcceptedSeams.value=false;await Vue.nextTick();calls.integrity.mockClear();store.data={...store.data,project:structuredClone(Vue.toRaw(store.data.project))};await Vue.nextTick();expect(calls.integrity).not.toHaveBeenCalled();expect(state.acceptedSeams.value).toEqual([]);
 state.showAcceptedSeams.value=true;await settled();expect(calls.integrity).toHaveBeenCalledOnce();expect(state.acceptedSeamRun.value).toBeDefined();
});
it('reprojects saved seam lines during orbit without rebuilding their world geometry',async()=>{
 const {state}=mount(fixture());await settled();const before=state.acceptedSeams.value;expect(before.length).toBeGreaterThan(0);expect(calls.seams).toHaveBeenCalledOnce();state.yaw.value+=.5;const after=state.acceptedSeams.value;expect(after).not.toEqual(before);expect(calls.seams).toHaveBeenCalledOnce();expect(calls.integrity).toHaveBeenCalledOnce();
});
it('hides saved seams when the source geometry changes and becomes invalid',async()=>{
 const {state,store}=mount(fixture());await settled();expect(state.acceptedSeams.value.length).toBeGreaterThan(0);const changed=structuredClone(Vue.toRaw(store.data.project!));changed.surface!.vertices[0].zMm+=10;store.data={...store.data,project:changed};await settled();expect(state.acceptedSeamRun.value).toBeUndefined();expect(state.acceptedSeams.value).toEqual([]);
});
