<template>
 <section class="pattern-page">
  <nav class="subtabs pattern-subtabs" role="tablist" :aria-label="language==='zh'?'制版工具':localize('Pattern tools')">
   <button v-for="p in panels" :key="p[0]" role="tab" :aria-selected="panel===p[0]" :class="{active:panel===p[0]}" @click="emit('update:panel',p[0] as PatternTab)">{{p[1]}}</button>
  </nav>
  <WorkflowPage v-show="panel==='workflow'" :language="language" @navigate="(s,id,t)=>emit('navigate',s,id,t)"/>
  <WorkspaceSplit v-show="panel!=='workflow'" storage-key="pattern-tools" :language="language" :label="language==='zh'?'制版预览与裁片工具宽度':localize('Pattern preview and tools width')" :initial=".72" :min-first="320" :min-second="290">
   <template #first><div id="pattern-viewport" class="preview-host pattern-host"/></template>
   <template #second>
    <aside class="inspector page-tools pattern-tools">
     <div class="tool-heading"><h2>{{panels.find(p=>p[0]===panel)?.[1]}}</h2></div>
     <section v-show="panel==='pieces'">
      <CutLibraryPanel :language="language" manufacturing @loaded="selectPiece($event)"/>
      <CutSelection :key="project?.id+'-cuts'" :language="language" :selected-id="selectedId" :paper="paper" @select="selectPiece($event)"/>
      <PatternProperties/>
     </section>
     <MaterialsPanel v-show="panel==='materials'" :key="project?.id" :target-id="targetId??''" :language="language" :selected-id="selectedId"/>
     <SeamsPanel v-show="panel==='seams'" :key="project?.id" :target-id="targetId??''" :language="language"/>
     <NestingPanel v-show="panel==='nesting'" :key="project?.id" :language="language" @select="selectPiece($event)"/>
     <button v-show="panel!=='pieces'" class="primary production-export" @click="emit('export')">{{language==='zh'?'导出 ↗':localize('Export ↗')}}</button>
    </aside>
   </template>
  </WorkspaceSplit>
 </section>
</template>
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
const panels=computed(()=>props.language==='zh'?[['pieces','裁片编辑'],['materials','材料'],['seams','接缝'],['nesting','排料'],['workflow','制作流程']]:[['pieces',localize('Patterns')],['materials',localize('Materials')],['seams',localize('Seams')],['nesting',localize('Nesting')],['workflow',localize('Workflow')]]);
</script>
<style scoped>
.pattern-page{height:100%;width:100%;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)}
.pattern-page>.workspace-split{flex:1;height:0}
.pattern-page>.workflow-page{height:0}
.pattern-subtabs{height:auto;min-height:47px;display:flex;align-items:center;gap:4px;padding:7px 12px;background:var(--panel);border-bottom:1px solid var(--border);flex-shrink:0;overflow-x:auto}
.pattern-subtabs button{flex:0 0 auto;min-width:74px;padding:7px 16px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--text-muted);font-size:12px;line-height:1.3}
.pattern-subtabs button.active{background:var(--selected);border-color:transparent;color:var(--accent);font-weight:600}
.pattern-tools{background:var(--panel);overscroll-behavior:contain}
.pattern-tools>.tool-heading{position:static;padding:13px 16px;border-left:0;background:var(--panel)}
.pattern-tools>.tool-heading h2{margin:0;font-size:13px;line-height:1.5;font-weight:600;letter-spacing:0}
.pattern-tools>.production-export{margin:12px 16px 16px;width:calc(100% - 32px);border-radius:8px;font-size:12px}
@media(max-width:1100px){.pattern-subtabs{padding:7px 10px}.pattern-subtabs button{min-width:66px;padding:7px 12px}}
</style>
