<template><section class="mapping-page"><MarkingLibrary :language="language" :target-id="targetId" drawer/><WorkspaceSplit storage-key="mapping-tools-left" :language="language" :label="language==='zh'?'模型预览与花纹工具宽度':localize('Model preview and mapping tools width')" :initial=".26"><template #first><aside class="inspector page-tools"><div class="tool-heading"><h2>{{language==='zh'?'花纹映射':localize('Pattern mapping')}}</h2></div><MappingTools :language="language" :selection="selection" @select="emit('select',$event)"/></aside></template><template #second><p v-if="store.data.project?.surfaceRun&&!store.data.project.surfaceRun.accepted" class="mapping-cut-review" role="status">{{language==='zh'?'裁线候选待审阅。可在模型上检查半透明边界，再返回裁切页确认保存。':localize('Cut-line candidate awaits review. Inspect the translucent boundaries, then return to cutting to accept and save.')}}</p><div id="mapping-viewport" class="preview-host model-host"/><button class="page-next" @click="emit('cutting')">{{store.data.project?.surfaceRun&&!store.data.project.surfaceRun.accepted?(language==='zh'?'返回裁切并审阅候选 →':localize('Return to cutting and review candidate →')):(language==='zh'?'下一步：裁切版型 →':localize('Next: cutting →'))}}</button></template></WorkspaceSplit></section></template>
<script setup lang="ts">
import {localize} from './localization';

import WorkspaceSplit from './WorkspaceSplit.vue';
import MarkingLibrary from './MarkingLibrary.vue';
import MappingTools from './MappingTools.vue';
import {useSession} from './store';
const store=useSession();
defineProps<{language:'zh'|'en';targetId?:string;selection?:{markingId:string;pieceId:string}}>();
const emit=defineEmits<{cutting:[];select:[id:string]}>();
</script>
<style scoped>.mapping-page{display:flex;height:100%;width:100%;min-width:0;min-height:0}.mapping-page>.workspace-split{flex:1;width:0}.mapping-page>.drawer{max-width:40%}.mapping-cut-review{flex-shrink:0;margin:0;padding:9px 14px;border-bottom:1px solid var(--border);background:var(--accent-soft);color:var(--studio-teal);font-size:11px;line-height:1.7}</style>
