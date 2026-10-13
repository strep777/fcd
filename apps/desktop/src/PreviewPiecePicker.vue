<script setup lang="ts">
import {localize} from './localization';

import {usePatternContext} from './modules/patternEditorContext';
const {language,shownPieces,selectedId,selectPiece,fit,mappedPoint}=usePatternContext();
function choose(event:Event){const id=(event.target as HTMLSelectElement).value;selectPiece(id);if(!id){mappedPoint.value=null;fit();}}
</script>
<template><label class="preview-piece-picker">{{language==='zh'?'预览裁片':localize('Preview piece')}}<select :value="selectedId" :aria-label="language==='zh'?'裁切版型预览裁片':localize('Cut preview piece')" @change="choose"><option value="">{{language==='zh'?'全部裁片':localize('All pieces')}}</option><option v-for="p in shownPieces" :key="p.id" :value="p.id">{{p.name}}</option></select></label></template>
<style scoped>.preview-piece-picker{display:flex;gap:5px;align-items:center;min-width:0;font-size:10px}.preview-piece-picker select{max-width:160px;min-width:65px;width:auto;padding:4px}</style>
