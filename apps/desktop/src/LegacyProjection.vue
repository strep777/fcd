<script setup lang="ts">
import {localize} from './localization';

import {computed,ref,watch} from 'vue';
import {useSession} from './store';
const props=defineProps<{language:'zh'|'en'}>(),store=useSession(),zh=computed(()=>props.language==='zh'),pieceId=ref(''),view=ref<'front'|'back'>('front'),offsetXmm=ref(0),offsetYmm=ref(0),replaceManual=ref(false);
const sources=computed(()=>store.data.project?.pieces.filter(p=>!store.data.project?.bindings?.some(b=>b.pieceId===p.id))??[]);
const manual=computed(()=>store.data.project?.markings?.some(m=>m.sourcePieceId===pieceId.value&&m.view===view.value&&(m.editMode==='uv-manual'||m.source==='manual'&&!m.editMode))??false);
watch([pieceId,view],()=>{replaceManual.value=false;});
watch(sources,list=>{if(!list.some(p=>p.id===pieceId.value))pieceId.value='';});
async function attach(){const p=store.data.project;if(p&&pieceId.value)await store.run(()=>window.fpcad.projectMarking(p.id,p.revision,pieceId.value,view.value,offsetXmm.value,offsetYmm.value,replaceManual.value));}
</script>
<template><details v-if="sources.length" class="legacy-projection"><summary>{{zh?'既有二维区域贴附':localize('Attach existing 2D regions')}}</summary><p>{{zh?'旧项目或手工创建的二维区域可作为花纹源。选择视图与毫米偏移，贴附到当前模型；展开前也可使用。':localize('Use an existing unbound 2D region as a source, including before unwrapping. Choose the view and offsets in millimetres.')}}</p><select v-model="pieceId" :aria-label="zh?'既有花纹区域':localize('Existing marking region')"><option value="">{{zh?'选择二维区域':localize('Choose a region')}}</option><option v-for="p in sources" :key="p.id" :value="p.id">{{p.name}}</option></select><select v-model="view" :aria-label="zh?'既有花纹投影视图':localize('Existing marking view')"><option value="front">{{zh?'正面':localize('Front')}}</option><option value="back">{{zh?'背面':localize('Back')}}</option></select><div class="two-col"><label>X mm<input v-model.number="offsetXmm" type="number"></label><label>Y mm<input v-model.number="offsetYmm" type="number"></label></div><label v-if="manual" class="check-label"><input v-model="replaceManual" type="checkbox">{{zh?'确认替换该花纹的片内人工编辑':localize('Confirm replacement of manual UV edits')}}</label><button :disabled="store.busy||!store.data.project?.surface||!pieceId||manual&&!replaceManual" @click="attach">{{zh?'投影并保存花纹':localize('Project and save marking')}}</button></details></template>
<style scoped>.legacy-projection{flex-shrink:0;max-height:45%;overflow:auto;padding:8px 0;border-block:1px solid var(--border)}summary{font-size:11px;cursor:pointer}p,label{font-size:11px;line-height:1.6}select{margin:6px 0}button{width:100%}</style>
