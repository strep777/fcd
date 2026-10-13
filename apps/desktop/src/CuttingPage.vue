<script setup lang="ts">
import {localize} from './localization';

import {inject,ref} from 'vue';
import WorkspaceSplit from './WorkspaceSplit.vue';
import SurfaceCutPanel from './SurfaceCutPanel.vue';
import CutLinesPanel from './CutLinesPanel.vue';
import UnwrapTools from './UnwrapTools.vue';
import CutLibraryPanel from './CutLibraryPanel.vue';
defineProps<{sectionActive?:boolean;language:'zh'|'en';targetId?:string;picked?:{faceId:string;vertexId:string}}>();
const advanced=inject('advancedMode',ref(false));
const emit=defineEmits<{draw:[request:{kind:'pen'|'freehand'|'brush'|'lasso'|'section';lineId?:string}];focus:[id:string];accepted:[id:string]}>(),cutTools=ref<InstanceType<typeof SurfaceCutPanel>>();
defineExpose({openSection:()=>cutTools.value?.openSection()});
</script>
<template><WorkspaceSplit storage-key="cutting-tools" :language="language" :label="language==='zh'?'裁切版型预览与工具宽度':localize('Cut previews and tools width')" :initial=".75" :min-second="260"><template #first><WorkspaceSplit class="editor dual-view" storage-key="cutting-previews" :language="language" :label="language==='zh'?'左右模型与裁片预览宽度':localize('Model and pattern preview widths')" :initial=".58" :min-first="180" :min-second="180"><template #first><div id="cutting-viewport" class="preview-host model-host"/></template><template #second><div id="cutting-pattern-viewport" class="preview-host pattern-host"/></template></WorkspaceSplit></template><template #second><aside class="inspector page-tools"><div class="tool-heading"><h2>{{language==='zh'?'裁切版型':localize('Cut patterns')}}</h2><p>{{language==='zh'?'完成花纹与自定义裁剪线后，点击裁切；审阅候选并保存到裁切库后进入制版。':localize('Finish markings and custom cut lines, then cut. Review and save the candidate to the cutting library before pattern making.')}}</p></div><div id="surface-cut-draft"/><SurfaceCutPanel ref="cutTools" :section-active="sectionActive" :language="language" :target-id="targetId" @draw="emit('draw',$event)" @focus="emit('focus',$event)"/><CutLinesPanel v-if="advanced" :language="language" :target-id="targetId" :picked="picked"/><UnwrapTools :language="language" @accepted="emit('accepted',$event)"/><CutLibraryPanel :language="language" @loaded="emit('accepted',$event)"/></aside></template></WorkspaceSplit></template>
