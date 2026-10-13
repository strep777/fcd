<script setup lang="ts">
import AutoMappingPanel from './AutoMappingPanel.vue';
import MarkingEditor from './MarkingEditor.vue';
import TexturePanel from './TexturePanel.vue';
import InferenceTools from './InferenceTools.vue';
import MarkingRecords from './MarkingRecords.vue';
defineProps<{language:'zh'|'en';selection?:{markingId:string;pieceId:string}}>();
const emit=defineEmits<{select:[id:string]}>();
</script>
<template><AutoMappingPanel :language="language"/><div class="mapping-tools"><TexturePanel :language="language"/><InferenceTools :language="language"/><MarkingRecords :language="language" @select="emit('select',$event)"/><MarkingEditor :selection="selection" :language="language" @select="emit('select',$event)"/></div></template>
<style scoped>.mapping-tools{padding:15px}</style>
