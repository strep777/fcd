<script setup lang="ts">
import {localize} from './localization';

import {computed} from 'vue';
import WorkspaceSplit from './WorkspaceSplit.vue';
import PatternProperties from './PatternProperties.vue';
import CutSelection from './CutSelection.vue';
import CutLibraryPanel from './CutLibraryPanel.vue';
import MaterialsPanel from './MaterialsPanel.vue';
import SeamsPanel from './SeamsPanel.vue';
import NestingPanel from './NestingPanel.vue';
import WorkflowPage from './WorkflowPage.vue';
import {usePatternContext} from './modules/patternEditorContext';
import type {Stage,PatternTab} from './modules/workflow-tabs';
const props=defineProps<{language:'zh'|'en';panel:PatternTab;targetId?:string}>(),emit=defineEmits<{'update:panel':[panel:PatternTab];navigate:[stage:Stage,id?:string,tab?:'materials'|'seams'|'nesting'];export:[]}>(),{project,paper,selectedId,selectPiece}=usePatternContext();
const panels=computed(()=>props.language==='zh'?[['pieces','裁片编辑'],['materials','材料'],['seams','接缝'],['nesting','排料'],['workflow','制作流程']]:[['pieces','Patterns'],['materials','Materials'],['seams','Seams'],['nesting','Nesting'],['workflow','Workflow']]);
</script>
<template><section class="pattern-page"><nav class="subtabs pattern-subtabs" role="tablist" :aria-label="language==='zh'?'制版工具':localize('Pattern tools')"><button v-for="p in panels" :key="p[0]" role="tab" :aria-selected="panel===p[0]" :class="{active:panel===p[0]}" @click="emit('update:panel',p[0] as PatternTab)">{{p[1]}}</button></nav><WorkflowPage v-show="panel==='workflow'" :language="language" @navigate="(s,id,t)=>emit('navigate',s,id,t)"/><WorkspaceSplit v-show="panel!=='workflow'" storage-key="pattern-tools" :language="language" :label="language==='zh'?'制版预览与裁片工具宽度':localize('Pattern preview and tools width')" :initial=".72"><template #first><div id="pattern-viewport" class="preview-host pattern-host"/></template><template #second><aside class="inspector page-tools"><div class="tool-heading"><h2>{{language==='zh'?'制版':localize('Pattern making')}}</h2><p>{{language==='zh'?'从裁切库获取版型，在左侧查看二维单片，然后微调和打印。':localize('Load patterns from the cutting library, preview a 2D piece, then adjust and print.')}}</p></div><section v-show="panel==='pieces'"><CutLibraryPanel :language="language" manufacturing @loaded="selectPiece($event)"/><CutSelection :key="project?.id+'-cuts'" :language="language" :selected-id="selectedId" :paper="paper" @select="selectPiece($event)"/><PatternProperties/></section><MaterialsPanel v-show="panel==='materials'" :key="project?.id" :target-id="targetId??''" :language="language" :selected-id="selectedId"/><SeamsPanel v-show="panel==='seams'" :key="project?.id" :target-id="targetId??''" :language="language"/><NestingPanel v-show="panel==='nesting'" :key="project?.id" :language="language" @select="selectPiece($event)"/><button v-show="panel!=='pieces'" class="primary production-export" @click="emit('export')">{{language==='zh'?'导出 ↗':localize('Export ↗')}}</button></aside></template></WorkspaceSplit></section></template>
<style scoped>.pattern-page{height:100%;width:100%;min-width:0;min-height:0;display:flex;flex-direction:column}.pattern-page>.workspace-split{flex:1;height:0}.pattern-page>.workflow-page{height:0}.pattern-subtabs{padding:8px 10px;background:var(--panel);border-bottom:1px solid var(--border);flex-shrink:0}.pattern-subtabs button{flex:0 1 140px;border:1px solid transparent;border-radius:var(--radius-control);background:transparent}.pattern-subtabs button.active{background:var(--selected);border-color:var(--studio-orange);color:var(--ink)}</style>
