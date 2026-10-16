<script setup lang="ts">
import {localize} from './localization';

import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue';
const props=withDefaults(defineProps<{storageKey:string;label:string;initial?:number;minFirst?:number;minSecond?:number;language?:'zh'|'en'}>(),{initial:.65,minFirst:200,minSecond:240,language:'zh'});
const element=ref<HTMLElement>(),ratio=ref(props.initial),width=ref(1000),dragging=ref(false);
function clamp(value:number){const usable=Math.max(1,width.value-8),lo=Math.min(.45,props.minFirst/usable),hi=Math.max(.55,1-props.minSecond/usable);return Math.max(lo,Math.min(hi,value));}
// Fractional tracks remain correct while a hidden pane has not received its resize notification.
const columns=computed(()=>`minmax(min(${props.minFirst}px,45%),${clamp(ratio.value)}fr) 8px minmax(min(${props.minSecond}px,45%),${1-clamp(ratio.value)}fr)`);
function save(){try{localStorage.setItem('fpcad.split.'+props.storageKey,String(ratio.value));}catch{/* Layout still works without local storage. */}}
function resize(event:PointerEvent){if(!dragging.value||!element.value)return;ratio.value=clamp((event.clientX-element.value.getBoundingClientRect().left)/(width.value-8));}
function end(){if(!dragging.value)return;dragging.value=false;save();}
function begin(event:PointerEvent){if(event.button!==0)return;event.preventDefault();dragging.value=true;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);resize(event);}
function reset(){ratio.value=clamp(props.initial);save();}
function keyboard(event:KeyboardEvent){const step=event.shiftKey?.1:.025;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();ratio.value=clamp(ratio.value+(event.key==='ArrowLeft'?-step:step));save();}else if(event.key==='Home'){event.preventDefault();reset();}else if(event.key==='End'){event.preventDefault();ratio.value=clamp(1);save();}}
let observer:ResizeObserver|undefined;
onMounted(()=>{try{const saved=Number(localStorage.getItem('fpcad.split.'+props.storageKey));if(saved>0&&saved<1)ratio.value=saved;}catch{}observer=new ResizeObserver(entries=>{if(entries[0].contentRect.width>0)width.value=entries[0].contentRect.width;});if(element.value){width.value=element.value.clientWidth||1000;observer.observe(element.value);}window.addEventListener('blur',end);});
watch(()=>props.storageKey,()=>{ratio.value=props.initial;try{const saved=Number(localStorage.getItem('fpcad.split.'+props.storageKey));if(saved>0&&saved<1)ratio.value=saved;}catch{}});
onBeforeUnmount(()=>{observer?.disconnect();window.removeEventListener('blur',end);});
</script>
<template><section ref="element" class="workspace-split" :class="{resizing:dragging}" :style="{gridTemplateColumns:columns}" :data-split="storageKey"><div class="split-pane first-pane"><slot name="first"/></div><div class="split-handle" role="separator" tabindex="0" aria-orientation="vertical" :aria-label="label" :aria-valuenow="Math.round(clamp(ratio)*100)" aria-valuemin="0" aria-valuemax="100" :title="language==='zh'?'拖动调整左右宽度；方向键微调，双击恢复':localize('Drag to resize; arrows adjust, double click resets')" @pointerdown="begin" @pointermove="resize" @pointerup="end" @pointercancel="end" @lostpointercapture="end" @dblclick="reset" @keydown="keyboard"><span/></div><div class="split-pane second-pane"><slot name="second"/></div></section></template>
<style scoped>.workspace-split{display:grid;height:100%;width:100%;min-width:0;min-height:0;overflow:hidden}.split-pane{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column}.split-handle{background:var(--panel-blue);cursor:col-resize;touch-action:none;display:flex;align-items:center;justify-content:center;z-index:4}.split-handle span{width:3px;height:42px;border-radius:3px;background:var(--accent)}.split-handle:hover,.split-handle:focus-visible,.resizing>.split-handle{background:var(--studio-sky);outline:1px solid var(--accent)}.resizing{user-select:none}</style>
