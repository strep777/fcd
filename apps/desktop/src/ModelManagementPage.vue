<template>
 <WorkspaceSplit class="model-management-page" storage-key="model-tools" :language="language" :label="language==='zh'?'模型预览与管理宽度':localize('Model preview and management width')" :initial=".7" :min-first="320" :min-second="280">
  <template #first>
   <div id="model-viewport" class="preview-host model-host"/>
   <button class="page-next" @click="emit('mapping')">{{language==='zh'?'下一步：花纹映射 →':localize('Next: pattern mapping →')}}</button>
  </template>
  <template #second>
   <aside class="inspector page-tools model-tools">
    <div class="tool-heading"><h2>{{language==='zh'?'模型管理':localize('Model management')}}</h2></div>
    <ModelLibrary :language="language"/>
    <ModelAnatomyPanel :language="language"/>
    <ModelTools ref="modelTools" :language="language"/>
   </aside>
  </template>
 </WorkspaceSplit>
</template>
<script setup lang="ts">
import {localize} from './localization';

import WorkspaceSplit from './WorkspaceSplit.vue';
import ModelLibrary from './ModelLibrary.vue';
import ModelAnatomyPanel from './ModelAnatomyPanel.vue';
import ModelTools from './ModelTools.vue';
import {ref} from 'vue';
defineProps<{language:'zh'|'en'}>();
const emit=defineEmits<{mapping:[]}>();
const modelTools=ref<InstanceType<typeof ModelTools>>();
defineExpose({openSource:()=>modelTools.value?.openSource()});
</script>
<style scoped>
.model-management-page{height:100%;width:100%;min-width:0;min-height:0;background:var(--bg)}
.model-tools{background:var(--panel);overscroll-behavior:contain}
.model-tools>.tool-heading{padding:13px 16px;border-left:0;background:var(--panel)}
.model-tools>.tool-heading h2{margin:0;font-size:13px;line-height:1.5;font-weight:600;letter-spacing:0}
.model-management-page .page-next{padding:10px 14px;font-size:12px;font-weight:500;color:var(--accent);background:var(--panel)}
</style>
