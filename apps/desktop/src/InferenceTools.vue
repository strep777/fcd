<template><details v-if="sources.length" class="inference-panel"><summary>{{zh?'侧面花纹补全':localize('Complete side markings')}}</summary><p>{{zh?'沿相邻面延伸仅填充没有花纹记录的整面，距离为相邻面中心路径近似。对称仅支持关于指定 X 平面的精确网格对应。原有区域不覆盖，推断结果在三维/裁版中显示，核对并确认后才可制造导出；复杂边界请手绘。':localize('Extension fills only faces without marking records using approximate adjacent-center distance. Symmetry requires exact mesh correspondence about an X plane. Existing regions stay intact. Inspect inferred results in both views and approve before exporting; draw complex boundaries manually.')}}</p><div class="reference-controls"><select v-model="inferenceSource" aria-label="Inference source"><option value="">{{zh?'选择来源花纹':localize('Choose source marking')}}</option><option v-for="m in sources" :key="m.id" :value="m.id">{{m.name}}</option></select><select v-model="inferenceMode" aria-label="Inference mode"><option value="extend">{{zh?'沿邻面延伸':localize('Extend adjacent faces')}}</option><option value="symmetry">{{zh?'左右对称':localize('Mirror about X')}}</option></select><label v-if="inferenceMode==='extend'">{{zh?'延伸距离 mm':localize('Extension distance mm')}}<input v-model.number="inferenceDistance" aria-label="Inference distance" type="number" min=".01" max="10000"></label><label v-else>{{zh?'对称平面 X mm':localize('Symmetry plane X mm')}}<input v-model.number="inferencePlane" aria-label="Symmetry plane" type="number"></label><button :disabled="store.busy||!inferenceSource" @click="infer">{{zh?'生成待审核补全':localize('Generate completion for review')}}</button><button v-if="inferring" :disabled="store.cancelling" @click="store.cancelRun()">{{store.cancelling?(zh?'正在取消…':localize('Cancelling…')):(zh?'取消计算':localize('Cancel calculation'))}}</button></div></details></template>

<script setup lang="ts">
import {localize} from './localization';

import {computed,ref,watch} from 'vue';
import {useSession} from './store';
const props=defineProps<{language:'zh'|'en'}>(),store=useSession(),zh=computed(()=>props.language==='zh');
const inferenceSource=ref(''),inferenceMode=ref<'extend'|'symmetry'>('extend'),inferenceDistance=ref(100),inferencePlane=ref(0),inferring=ref(false);
const sources=computed(()=>(store.data.project?.markings??[]).filter(m=>!m.inference&&m.surfaceId===store.data.project?.surface?.id));
watch([()=>store.data.project?.id,()=>store.data.project?.surface?.id],()=>{inferenceSource.value='';});
watch(sources,()=>{if(!sources.value.some(m=>m.id===inferenceSource.value))inferenceSource.value='';});
async function infer(){const p=store.data.project;if(!p||store.busy||!sources.value.some(m=>m.id===inferenceSource.value))return;inferring.value=true;try{await store.run(()=>window.fpcad.inferMarking(p.id,p.revision,inferenceSource.value,inferenceMode.value,inferenceDistance.value,inferencePlane.value),{label:zh.value?'正在计算侧面花纹补全':localize('Completing side markings'),cancel:()=>window.fpcad.cancelSurface(p.id,p.revision)});}finally{inferring.value=false;}}
</script>

<style scoped>p{font-size:11px;line-height:1.7}label{display:block;font-size:11px;margin:10px 0}button{width:100%;white-space:normal;margin-block:5px}</style>
