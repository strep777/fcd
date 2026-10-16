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
<template><WorkspaceSplit storage-key="model-tools" :language="language" :label="language==='zh'?'模型预览与管理宽度':localize('Model preview and management width')" :initial=".7"><template #first><div id="model-viewport" class="preview-host model-host"/><button class="page-next" @click="emit('mapping')">{{language==='zh'?'下一步：花纹映射 →':localize('Next: pattern mapping →')}}</button></template><template #second><aside class="inspector page-tools"><div class="tool-heading"><h2>{{language==='zh'?'模型管理':localize('Model management')}}</h2></div><ModelLibrary :language="language"/><ModelAnatomyPanel :language="language"/><ModelTools ref="modelTools" :language="language"/></aside></template></WorkspaceSplit></template>
