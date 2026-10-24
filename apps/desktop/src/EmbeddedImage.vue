<template><image :href="url"/></template>

<script setup lang="ts">
import {ref,watch} from 'vue';
import {acquireImageUrl} from './modules/image-url';
const props=defineProps<{source:string}>(),url=ref('');
watch(()=>props.source,(source,_previous,cleanup)=>{const image=acquireImageUrl(source);url.value=image.url;cleanup(image.release);},{immediate:true,flush:'sync'});
</script>
