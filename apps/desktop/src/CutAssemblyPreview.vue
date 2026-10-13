<script setup lang="ts">
import {localize} from './localization';

import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import type {Surface,SurfaceRun,Marking} from '../../../packages/schema/index';
import {cutAssembly,cutAssemblyMarkings,assemblySummary} from '../../../packages/surface/cut-assembly';
import {assemblyRenderer} from './modules/assembly-renderer';
const props=defineProps<{surface:Surface;run:SurfaceRun;markings?:Marking[];language:'zh'|'en'}>(),canvas=ref<HTMLCanvasElement>(),chosen=ref<string[]>([]),yaw=ref(.35),pitch=ref(.12),zoom=ref(1),zh=computed(()=>props.language==='zh');
const triangles=computed(()=>cutAssembly(props.surface,props.run));
const overlays=computed(()=>cutAssemblyMarkings(props.surface,props.run,props.markings??[]));
const explosion=ref(0),version=ref(0),search=ref(''),shown=computed(()=>props.run.pieces.filter(p=>p.name.toLowerCase().includes(search.value.toLowerCase()))),summary=computed(()=>assemblySummary(props.surface,triangles.value,chosen.value));
watch(()=>props.run,run=>{chosen.value=run.pieces.map(p=>p.id);},{immediate:true});
let observer:ResizeObserver|undefined,frame=0,drag:{x:number;y:number;id:number}|undefined,painter:ReturnType<typeof assemblyRenderer>|undefined;
watch([triangles,overlays],async()=>{cancelAnimationFrame(frame);frame=0;painter?.dispose();painter=undefined;version.value++;await nextTick();if(canvas.value)painter=assemblyRenderer(canvas.value,triangles.value,overlays.value);schedule();},{immediate:true});
watch(canvas,c=>{observer?.disconnect();if(c)observer?.observe(c);});
function draw(){frame=0;painter?.draw({yaw:yaw.value,pitch:pitch.value,zoom:zoom.value,explode:explosion.value},chosen.value);}
function schedule(){if(!frame)frame=requestAnimationFrame(draw);}
watch([chosen,yaw,pitch,zoom,explosion],schedule,{deep:false});
function start(e:PointerEvent){if(e.button!==0)return;canvas.value?.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,id:e.pointerId};}
function move(e:PointerEvent){if(!drag||drag.id!==e.pointerId)return;yaw.value+=(e.clientX-drag.x)*.01;pitch.value=Math.max(-1.5,Math.min(1.5,pitch.value+(e.clientY-drag.y)*.01));drag.x=e.clientX;drag.y=e.clientY;}
function stop(){drag=undefined;}
onMounted(()=>{observer=new ResizeObserver(schedule);if(canvas.value)observer.observe(canvas.value);schedule();});onBeforeUnmount(()=>{observer?.disconnect();cancelAnimationFrame(frame);painter?.dispose();});
</script>
<template><section class="assembly-preview"><strong>{{zh?'裁片组合 · 模型贴合预览':localize('Cut assembly · model fit preview')}}</strong><p>{{zh?'仅按裁片绑定重建保存的模型位置；未选择的裁片会形成缺口。左键旋转、滚轮缩放，可分解检查。候选不是成品，布料伸缩与缝合效果需试做。':localize('Rebuild saved positions from actual cut bindings; hidden pieces leave gaps. Drag, zoom and explode to inspect. Candidates are not finished garments; fabric stretch and sewing require a trial.')}}</p><canvas :key="version" ref="canvas" :aria-label="zh?'裁片三维组合预览':localize('3D cut assembly preview')" @pointerdown="start" @pointermove="move" @pointerup="stop" @pointercancel="stop" @lostpointercapture="stop" @wheel.prevent="zoom=Math.max(.2,Math.min(5,zoom*Math.exp(-$event.deltaY*.001)))"/><div class="assembly-actions"><button @click="chosen=run.pieces.map(p=>p.id)">{{zh?'组合全部':localize('Combine all')}}</button><button @click="chosen=[]">{{zh?'清空预览':localize('Clear preview')}}</button></div><label class="explosion-control">{{zh?'分解距离':localize('Explode distance')}}<input v-model.number="explosion" type="range" min="0" max="1" step="0.01" :aria-label="zh?'分解距离':localize('Explode distance')"></label><p class="assembly-coverage" aria-live="polite">{{summary.pieceCount}} / {{run.pieces.length}} {{zh?'片显示':localize('pieces shown')}} · {{zh?'模型表面积覆盖':localize('Model surface area covered')}} {{(summary.coverage*100).toFixed(1)}}% · {{summary.triangleCount}} {{zh?'绑定三角形':localize('bound triangles')}}</p><input v-model="search" :placeholder="zh?'搜索拼接裁片':localize('Search assembly pieces')" :aria-label="zh?'搜索拼接裁片':localize('Search assembly pieces')"><div class="assembly-pieces"><label v-for="piece in shown" :key="piece.id"><input v-model="chosen" type="checkbox" :value="piece.id" :aria-label="(zh?'显示裁片 ':localize('Show cut '))+piece.name"><span :style="{background:piece.color}"/>{{piece.name}}</label></div></section></template>
<style scoped>.assembly-preview{margin-block:12px}.assembly-preview p{font-size:11px;line-height:1.7;color:var(--text-muted)}canvas{display:block;width:100%;height:300px;background:var(--canvas);border:1px solid var(--border);border-radius:5px;touch-action:none;cursor:grab}.assembly-actions{display:flex;gap:6px;margin:8px 0}.assembly-pieces{max-height:160px;overflow:auto}.assembly-pieces label{display:flex;gap:6px;align-items:center;font-size:11px;margin:5px 0}.assembly-pieces input{width:auto}.assembly-pieces span{width:10px;height:10px;border:1px solid var(--border)}</style>
