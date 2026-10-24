<template><aside class="model-editor" aria-label="3D model preview"><div class="editor-top"><strong>3D / {{language==='zh'?'模型预览':localize('Model preview')}}</strong></div><SurfacePanel :mode="mode==='guide'||mode==='assembly'||mode==='marking-edit'?'references':mode" :language="language" :selected-id="selectedId" :cut-request="cutRequest" :focus-cut-id="focusCutId" :focus-cut-token="focusCutToken" @cut-draft-active="emit('cutDraftActive',$event)" @marking="emit('marking',$event)" @select="emit('select',$event)" @point="emit('point',$event)" @choices="emit('choices',$event)" @model="emit('model')"/></aside></template>

<script setup lang="ts">
import {localize} from './localization';

import SurfacePanel from './SurfacePanel.vue';
import type {Stage} from './modules/workflow-tabs';
defineProps<{mode:Stage;language:'zh'|'en';selectedId:string;cutRequest?:{kind:'pen'|'paint';lineId?:string;token:number};focusCutId?:string;focusCutToken?:number}>();
const emit=defineEmits<{cutDraftActive:[active:boolean];marking:[selection:{markingId:string;pieceId:string}];select:[id:string];point:[point:{pieceId:string;xMm:number;yMm:number}];choices:[ids:string[]];model:[]}>();
</script>
