<script setup lang="ts">
import {localize} from './localization';

import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import type {Surface,SurfaceRun,Marking} from '../../../packages/schema/index';
import {cutAssembly,cutAssemblyMarkings,assemblySummary} from '../../../packages/surface/cut-assembly';
import {assemblyRenderer} from './modules/assembly-renderer';
import WorkspaceSplit from './WorkspaceSplit.vue';
import {piecePath,pointBounds} from '../../../packages/pattern/edit';
const props=defineProps<{surface:Surface;run:SurfaceRun;markings?:Marking[];language:'zh'|'en'}>(),canvas=ref<HTMLCanvasElement>(),chosen=ref<string[]>([]),yaw=ref(.35),pitch=ref(.12),zoom=ref(1),zh=computed(()=>props.language==='zh');
const triangles=computed(()=>cutAssembly(props.surface,props.run));
const overlays=computed(()=>cutAssemblyMarkings(props.surface,props.run,props.markings??[]));
const explosion=ref(0),version=ref(0),search=ref(''),shown=computed(()=>props.run.pieces.filter(p=>p.name.toLowerCase().includes(search.value.trim().toLowerCase()))),summary=computed(()=>assemblySummary(props.surface,triangles.value,chosen.value));
const previews=computed(()=>new Map(props.run.pieces.map(piece=>{const controls=piece.curves?.flatMap(c=>[c.c1,c.c2])??[],bounds=pointBounds([...piece.nodes,...(piece.holes??[]).flat(),...controls]),width=Math.max(1,bounds.maxX-bounds.minX),height=Math.max(1,bounds.maxY-bounds.minY),pad=Math.max(width,height)*.08;return [piece.id,{path:piecePath(piece),viewBox:`${bounds.minX-pad} ${-bounds.maxY-pad} ${width+pad*2} ${height+pad*2}`}];})));
watch(()=>props.run.pieces.map(p=>p.id).join(','),(ids,previous)=>{const current=props.run.pieces.map(p=>p.id),before=new Set(previous?.split(',')??[]);chosen.value=previous===undefined?current:current.filter(id=>chosen.value.includes(id)||!before.has(id));},{immediate:true});
let observer:ResizeObserver|undefined,frame=0,drag:{x:number;y:number;id:number}|undefined,painter:ReturnType<typeof assemblyRenderer>|undefined,disposed=false,renderVersion=0;
watch([triangles,overlays],async()=>{const own=++renderVersion;cancelAnimationFrame(frame);frame=0;painter?.dispose();painter=undefined;version.value++;await nextTick();if(disposed||own!==renderVersion||!canvas.value)return;painter=assemblyRenderer(canvas.value,triangles.value,overlays.value);schedule();},{immediate:true});
watch(canvas,c=>{observer?.disconnect();if(c)observer?.observe(c);});
function draw(){frame=0;const box=canvas.value?.getBoundingClientRect();if(!box||box.width<=0||box.height<=0)return;painter?.draw({yaw:yaw.value,pitch:pitch.value,zoom:zoom.value,explode:explosion.value},chosen.value);}
function schedule(){if(!disposed&&!frame)frame=requestAnimationFrame(draw);}
function resetView(){yaw.value=.35;pitch.value=.12;zoom.value=1;explosion.value=0;schedule();}
watch([chosen,yaw,pitch,zoom,explosion],schedule,{deep:false});
function start(e:PointerEvent){if(e.button!==0)return;canvas.value?.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,id:e.pointerId};}
function move(e:PointerEvent){if(!drag||drag.id!==e.pointerId)return;yaw.value+=(e.clientX-drag.x)*.01;pitch.value=Math.max(-1.5,Math.min(1.5,pitch.value+(e.clientY-drag.y)*.01));drag.x=e.clientX;drag.y=e.clientY;}
function stop(){drag=undefined;}
onMounted(()=>{observer=new ResizeObserver(schedule);if(canvas.value)observer.observe(canvas.value);schedule();});onBeforeUnmount(()=>{disposed=true;renderVersion++;observer?.disconnect();cancelAnimationFrame(frame);painter?.dispose();});
</script>
<template>
 <section class="assembly-preview">
  <div class="assembly-preview-heading"><strong>{{zh?'裁片组合 · 模型贴合预览':localize('Cut assembly · model fit preview')}}</strong><p>{{zh?'仅按裁片绑定重建保存的模型位置；隐藏裁片会形成真实缺口。左键旋转、滚轮缩放，可分解检查。':localize('Rebuild saved positions from actual cut bindings; hidden pieces leave real gaps. Drag, zoom and explode to inspect.')}}</p></div>
  <WorkspaceSplit class="assembly-layout" storage-key="assembly-piece-picker" :language="language" :label="zh?'拼接模型与裁片列表宽度':localize('Assembly model and piece list width')" :initial=".76" :min-first="240" :min-second="220">
   <template #first>
    <div class="assembly-model-pane">
     <div class="assembly-canvas-host"><canvas :key="version" ref="canvas" :aria-label="zh?'裁片三维组合预览':localize('3D cut assembly preview')" @pointerdown="start" @pointermove="move" @pointerup="stop" @pointercancel="stop" @lostpointercapture="stop" @wheel.prevent="zoom=Math.max(.2,Math.min(5,zoom*Math.exp(-$event.deltaY*.001)))"/><p v-if="!chosen.length" class="assembly-no-selection" role="status">{{zh?'从右侧选择裁片以查看拼接位置。':localize('Select pieces in the list to inspect their assembly positions.')}}</p></div>
     <div class="assembly-view-controls"><button @click="resetView">{{zh?'复位拼接视图':localize('Reset assembly view')}}</button><span>{{Math.round(zoom*100)}}%</span><label class="explosion-control">{{zh?'分解距离':localize('Explode distance')}}<input v-model.number="explosion" type="range" min="0" max="1" step="0.01" :aria-label="zh?'分解距离':localize('Explode distance')"></label></div>
     <p class="assembly-coverage" aria-live="polite">{{summary.pieceCount}} / {{run.pieces.length}} {{zh?'片显示':localize('pieces shown')}} · {{zh?'模型表面积覆盖':localize('Model surface area covered')}} {{(summary.coverage*100).toFixed(1)}}% · {{summary.triangleCount}} {{zh?'绑定三角形':localize('bound triangles')}}</p>
    </div>
   </template>
   <template #second>
    <aside class="assembly-picker" :aria-label="zh?'拼接裁片选择':localize('Assembly piece selection')">
     <div class="assembly-picker-heading"><strong>{{zh?'裁片选择':localize('Select pieces')}}</strong><span>{{chosen.length}} / {{run.pieces.length}}</span></div>
     <input v-model="search" :placeholder="zh?'搜索拼接裁片':localize('Search assembly pieces')" :aria-label="zh?'搜索拼接裁片':localize('Search assembly pieces')">
     <div class="assembly-actions"><button @click="chosen=run.pieces.map(p=>p.id)">{{zh?'组合全部':localize('Combine all')}}</button><button @click="chosen=[]">{{zh?'清空预览':localize('Clear preview')}}</button></div>
     <div class="assembly-pieces"><label v-for="piece in shown" :key="piece.id" :class="['assembly-piece',{selected:chosen.includes(piece.id)}]"><input v-model="chosen" type="checkbox" :value="piece.id" :aria-label="(zh?'显示裁片 ':localize('Show cut '))+piece.name"><svg class="assembly-piece-thumbnail" :viewBox="previews.get(piece.id)?.viewBox" aria-hidden="true"><path :d="previews.get(piece.id)?.path" :fill="piece.color" fill-rule="evenodd" stroke="var(--text-muted)" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg><span class="assembly-piece-name">{{piece.name}}</span></label><p v-if="!shown.length" class="assembly-search-empty" role="status">{{zh?'没有匹配的裁片，请修改搜索内容。':localize('No matching pieces. Try a different search.')}}</p></div>
    </aside>
   </template>
  </WorkspaceSplit>
 </section>
</template>
<style scoped>
.assembly-preview{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;margin-block:12px;container-type:inline-size;container-name:assembly-preview}
.assembly-preview-heading{flex-shrink:0}.assembly-preview-heading p,.assembly-coverage,.assembly-search-empty{font-size:11px;line-height:1.7;color:var(--text-muted);margin:8px 0}
.assembly-layout{flex:1;min-height:300px}.assembly-model-pane{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;padding-right:12px}
.assembly-canvas-host{position:relative;flex:1;min-height:220px;overflow:hidden;border:1px solid var(--border);border-radius:8px;background:var(--canvas)}
.assembly-canvas-host canvas{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;cursor:grab}
.assembly-no-selection{position:absolute;inset:40% 16px auto;text-align:center;color:var(--text-muted);font-size:12px;pointer-events:none}
.assembly-view-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:10px;font-size:11px}.explosion-control{display:flex;flex:1;align-items:center;gap:8px;min-width:150px}.explosion-control input{flex:1;min-width:80px;width:auto}
.assembly-picker{display:flex;flex:1;flex-direction:column;min-height:0;min-width:0;padding-left:12px}.assembly-picker-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;margin-bottom:10px}.assembly-picker-heading span{font-size:11px;color:var(--text-muted)}
.assembly-picker>input{width:100%;min-width:0}.assembly-actions{display:flex;gap:6px;margin:8px 0}.assembly-actions button{flex:1;min-width:0;font-size:11px}
.assembly-pieces{flex:1;min-height:0;overflow:auto;padding-right:3px}.assembly-piece{display:flex;align-items:center;gap:8px;padding:7px 8px;margin-bottom:6px;border:1px solid var(--border);border-radius:6px;background:var(--panel);cursor:pointer;font-size:11px}.assembly-piece.selected{border-color:var(--accent);background:var(--accent-soft)}.assembly-piece input{width:auto;flex-shrink:0}.assembly-piece-thumbnail{width:58px;height:54px;flex-shrink:0;background:var(--canvas);border-radius:4px}.assembly-piece-name{min-width:0;overflow-wrap:anywhere}
@container assembly-preview (max-width:620px){.assembly-layout{min-height:400px;display:flex;flex-direction:column}.assembly-layout :deep(.split-handle){display:none}.assembly-layout :deep(.first-pane){min-height:220px}.assembly-layout :deep(.second-pane){min-height:160px;max-height:240px}.assembly-model-pane{padding-right:0}.assembly-picker{padding:12px 0 0}.assembly-piece-thumbnail{width:44px;height:42px}}
</style>
