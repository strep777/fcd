<template><div id="mapping-surface-controls"/><AutoMappingPanel :language="language"/><div class="mapping-tools"><TexturePanel :language="language"/><MarkingRecords :language="language" @select="emit('select',$event)"/><MarkingEditor :selection="validSelection" :language="language" @select="emit('select',$event)"/></div></template>
<script setup lang="ts">
import {computed} from 'vue';
import {useSession} from './store';
import AutoMappingPanel from './AutoMappingPanel.vue';
import MarkingEditor from './MarkingEditor.vue';
import TexturePanel from './TexturePanel.vue';
import MarkingRecords from './MarkingRecords.vue';
const props=defineProps<{language:'zh'|'en';selection?:{markingId:string;pieceId:string}}>(),store=useSession();
const validSelection=computed(()=>props.selection&&store.data.project?.markings?.some(m=>m.id===props.selection!.markingId)?props.selection:undefined);
const emit=defineEmits<{select:[id:string]}>();
</script>

<style scoped>.mapping-tools{padding:15px}</style>
