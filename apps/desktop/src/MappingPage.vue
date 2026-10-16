<script setup lang="ts">
import {localize} from './localization';

import WorkspaceSplit from './WorkspaceSplit.vue';
import MarkingLibrary from './MarkingLibrary.vue';
import MappingTools from './MappingTools.vue';
defineProps<{language:'zh'|'en';targetId?:string;selection?:{markingId:string;pieceId:string}}>();
const emit=defineEmits<{cutting:[];select:[id:string]}>();
</script>
<template><section class="mapping-page"><MarkingLibrary :language="language" :target-id="targetId" drawer/><WorkspaceSplit storage-key="mapping-tools" :language="language" :label="language==='zh'?'模型预览与花纹工具宽度':localize('Model preview and mapping tools width')" :initial=".7"><template #first><div id="mapping-viewport" class="preview-host model-host"/><button class="page-next" @click="emit('cutting')">{{language==='zh'?'下一步：裁切版型 →':localize('Next: cutting →')}}</button></template><template #second><aside class="inspector page-tools"><div class="tool-heading"><h2>{{language==='zh'?'花纹映射':localize('Pattern mapping')}}</h2></div><MappingTools :language="language" :selection="selection" @select="emit('select',$event)"/></aside></template></WorkspaceSplit></section></template>
<style scoped>.mapping-page{display:flex;height:100%;width:100%;min-width:0;min-height:0}.mapping-page>.workspace-split{flex:1;width:0}.mapping-page>.drawer{max-width:40%}</style>
