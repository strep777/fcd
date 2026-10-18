<template>
 <section class="cutting-workspace" :aria-label="language==='zh'?'裁切工作台':localize('Cutting workspace')">
  <aside class="cutting-sidebar inspector">
   <div class="cutting-sidebar-heading">
    <span class="cutting-eyebrow">CUTTING</span>
    <h2>{{language==='zh'?'裁切版型':localize('Cut patterns')}}</h2>
    <p>{{language==='zh'?'选择部件，绘制裁线，再计算展开版型。':localize('Choose parts, draw cut lines, then unwrap the patterns.')}}</p>
   </div>
   <div id="cutting-parts" class="cutting-parts-host"/>
   <SurfaceCutPanel ref="cutTools" tools-target="#cutting-drawing-tools" @draft-dirty="lineEditorDirty=$event" :section-active="sectionActive" :language="language" :target-id="targetId" @draw="emit('draw',$event)" @focus="emit('focus',$event)"/>
   <div id="surface-cut-draft"/>
   <CutLinesPanel v-if="advanced" :language="language" :target-id="targetId" :picked="picked"/>
   <section ref="computePanel" class="cutting-compute-section">
    <div class="cutting-section-heading"><strong>{{language==='zh'?'裁切与展开':localize('Cut & unwrap')}}</strong><span>02</span></div>
    <UnwrapTools action-target="#cutting-compute-action" :language="language" :cut-draft-active="cutDraftActive||lineEditorDirty" @preview-ready="previewOpen=true" @mapping="emit('mapping')" @accepted="emit('accepted',$event)"/>
   </section>
   <CutLibraryPanel :language="language" @loaded="emit('accepted',$event)"/>
  </aside>
  <main class="cutting-main">
   <div class="cutting-workspace-toolbar">
    <div id="cutting-drawing-tools" class="cutting-drawing-tools"/>
    <div id="cutting-compute-action" class="cutting-compute-action"/>
    <div class="cutting-toolbar-actions">
     <button class="cutting-settings-button" @click="showComputeSettings"><ToolIcon name="settings"/><span>{{language==='zh'?'裁切设置':localize('Cut settings')}}</span></button>
     <button :class="{active:previewOpen}" :aria-pressed="previewOpen" aria-controls="cutting-preview-dock" @click="previewOpen=!previewOpen"><ToolIcon name="rectangle"/><span>{{language==='zh'?'二维预览':localize('2D preview')}}</span></button>
    </div>
   </div>
   <div class="cutting-model-workspace">
    <div id="cutting-viewport" class="preview-host model-host"/>
    <section id="cutting-preview-dock" v-show="previewOpen" class="cutting-preview-dock" :class="{expanded:previewExpanded}" :aria-label="language==='zh'?'二维裁片辅助预览':localize('2D pattern preview')">
     <div class="cutting-preview-heading">
      <strong><span>2D</span>{{language==='zh'?'裁片预览':localize('Pattern preview')}}</strong>
      <span v-if="store.data.project?.surfaceRun" class="cutting-preview-state">{{store.data.project.surfaceRun.accepted?(language==='zh'?'已确认':localize('Accepted')):(language==='zh'?'候选待审阅':localize('Candidate for review'))}}</span>
      <span class="cutting-preview-count">{{store.data.project?.surfaceRun?.pieces.length??store.data.project?.pieces.length??0}} {{language==='zh'?'片':localize('pieces')}}</span>
      <button :aria-label="previewExpanded?(language==='zh'?'缩小二维预览':localize('Reduce 2D preview')):(language==='zh'?'放大二维预览':localize('Expand 2D preview'))" :title="previewExpanded?(language==='zh'?'缩小预览':localize('Reduce preview')):(language==='zh'?'放大预览':localize('Expand preview'))" :aria-pressed="previewExpanded" @click="previewExpanded=!previewExpanded"><ToolIcon :name="previewExpanded?'collapse':'expand'"/></button>
      <button :aria-label="language==='zh'?'收起二维预览':localize('Hide 2D preview')" :title="language==='zh'?'收起预览':localize('Hide preview')" @click="previewOpen=false"><ToolIcon name="cancel"/></button>
     </div>
     <div id="cutting-pattern-viewport" class="preview-host pattern-host"/>
    </section>
   </div>
  </main>
 </section>
</template>

<script setup lang="ts">
import {inject,ref,useTemplateRef} from 'vue';
import {localize} from './localization';
import {useSession} from './store';
import SurfaceCutPanel from './SurfaceCutPanel.vue';
import CutLinesPanel from './CutLinesPanel.vue';
import UnwrapTools from './UnwrapTools.vue';
import CutLibraryPanel from './CutLibraryPanel.vue';
import ToolIcon from './ToolIcon.vue';

defineProps<{sectionActive?:boolean;cutDraftActive?:boolean;language:'zh'|'en';targetId?:string;picked?:{faceId:string;vertexId:string}}>();
const advanced=inject('advancedMode',ref(false)),store=useSession();
const emit=defineEmits<{draw:[request:{kind:'pen'|'freehand'|'brush'|'lasso'|'section'|'paint';lineId?:string}];focus:[id:string];mapping:[];accepted:[id:string]}>();
const cutTools=useTemplateRef<InstanceType<typeof SurfaceCutPanel>>('cutTools'),computePanel=useTemplateRef<HTMLElement>('computePanel');
const previewOpen=ref(!!store.data.project?.surfaceRun),previewExpanded=ref(false),lineEditorDirty=ref(false);
function showComputeSettings(){computePanel.value?.scrollIntoView({block:'start',behavior:'smooth'});}
defineExpose({openSection:()=>cutTools.value?.openSection()});
</script>

<style scoped>
.cutting-workspace{display:grid;grid-template-columns:280px minmax(0,1fr);height:100%;min-height:0;min-width:0;overflow:hidden;background:var(--panel-soft)}
.cutting-sidebar{border:0;border-right:1px solid var(--border);overscroll-behavior:contain;scroll-behavior:smooth;scroll-padding-top:12px}
.cutting-sidebar-heading{padding:18px 18px 16px;border-bottom:1px solid var(--border);background:var(--panel-soft)}
.cutting-eyebrow{font-size:9px;font-weight:700;letter-spacing:1.8px;color:var(--text-muted)}
.cutting-sidebar-heading h2{font-size:17px;line-height:1.5;margin:3px 0 5px;font-weight:650}
.cutting-sidebar-heading p{font-size:11px;line-height:1.7;margin:0;color:var(--text-muted)}
.cutting-parts-host{padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0}
.cutting-parts-host:empty{display:none}
.cutting-parts-host :deep(.drawing-parts){padding:0;font-size:11px}
.cutting-parts-host :deep(.drawing-parts summary){font-size:11px;font-weight:600;margin-bottom:9px}
.cutting-parts-host :deep(.drawing-parts button){font-size:10px;padding:4px 7px;margin:0 5px 7px 0}
.cutting-parts-host :deep(.drawing-parts label){display:flex;align-items:center;gap:7px;margin:0;padding:5px 2px;font-size:11px}
.cutting-parts-host :deep(.drawing-parts details){max-height:220px;overflow:auto}
.cutting-main{display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden}
.cutting-workspace-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 14px;min-height:55px;flex-shrink:0;border-bottom:1px solid var(--border);background:var(--panel);z-index:5}
.cutting-drawing-tools{min-width:0;flex:1}
.cutting-compute-action{flex-shrink:0}
.cutting-toolbar-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
.cutting-toolbar-actions button{display:flex;align-items:center;gap:6px;font-size:11px;padding:7px 9px;background:var(--panel-soft)}
.cutting-toolbar-actions .tool-icon{width:16px;height:16px}
.cutting-model-workspace{position:relative;display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}
.cutting-preview-dock{position:absolute;right:16px;bottom:16px;width:clamp(330px,38%,470px);height:38%;min-height:235px;max-height:calc(100% - 32px);display:flex;flex-direction:column;border:1px solid var(--border);border-radius:8px;background:var(--panel);box-shadow:0 8px 30px color-mix(in srgb,var(--shadow-color) 15%,transparent);overflow:hidden;z-index:4}
.cutting-preview-dock.expanded{inset:16px;width:auto;height:auto;min-height:0;max-height:none}
.cutting-preview-heading{display:flex;align-items:center;gap:8px;flex-shrink:0;min-height:36px;padding:5px 8px 5px 12px;border-bottom:1px solid var(--border);background:var(--panel-soft)}
.cutting-preview-heading strong{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:600}
.cutting-preview-heading strong>span{font-size:9px;font-weight:700;color:var(--studio-teal);border:1px solid var(--border);padding:1px 4px;border-radius:3px;background:var(--panel)}
.cutting-preview-count{flex:1;font-size:10px;color:var(--text-muted)}
.cutting-preview-state{font-size:9px;color:var(--studio-teal);background:var(--accent-soft);border-radius:3px;padding:2px 4px;white-space:nowrap}
.cutting-preview-heading button{padding:4px;border-color:transparent;background:transparent}
.cutting-preview-heading .tool-icon{width:15px;height:15px}
.cutting-preview-dock :deep(.pattern-editor>.editor-top){gap:6px;padding:6px 10px;min-height:36px}
.cutting-preview-dock :deep(.pattern-editor>.editor-top>strong){display:none}
.cutting-preview-dock :deep(.pattern-editor>.editor-top>.spacer){display:none}
.cutting-preview-dock :deep(.pattern-editor .physical-size){font-size:10px}
.cutting-preview-dock :deep(.pattern-editor .editor-bottom){font-size:9px;padding:4px 10px}
.cutting-preview-dock :deep(.pattern-icon-rail){left:7px;top:8px;width:36px;padding:3px;gap:0;max-height:calc(100% - 16px)}
.cutting-preview-dock :deep(.pattern-icon-rail button){width:28px;min-height:27px;padding:5px}
.cutting-preview-dock :deep(.pattern-icon-rail .tool-icon){width:17px;height:17px}
.cutting-preview-dock :deep(.canvas-metadata){left:50px;bottom:7px;right:7px}
.cutting-preview-dock :deep(.canvas-legend){padding:4px 6px;gap:5px;font-size:8px}
.cutting-preview-dock :deep(.scale-ruler){padding:4px 6px}
.cutting-preview-dock :deep(.canvas-empty){left:calc(50% + 18px);width:calc(100% - 58px)}
.cutting-preview-dock:not(.expanded) :deep(.canvas-empty){top:40%;background:color-mix(in srgb,var(--canvas) 95%,transparent);border-radius:6px;padding:8px}
.cutting-preview-dock:not(.expanded) :deep(.canvas-empty p){display:none}
.cutting-preview-dock :deep(.canvas-empty .outline-shape){font-size:30px}
.cutting-preview-dock :deep(.canvas-empty h2){font-size:13px;margin:6px}
.cutting-preview-dock :deep(.canvas-empty p){font-size:10px;line-height:1.6;margin:6px auto 12px;max-width:240px}
.cutting-compute-section{scroll-margin-top:8px;flex-shrink:0}
.cutting-section-heading{display:flex;align-items:center;justify-content:space-between;padding:15px 16px 0;font-size:12px}
.cutting-section-heading>span{font-size:10px;color:var(--text-muted);font-variant-numeric:tabular-nums}
.cutting-sidebar :deep(.unwrap-tool-section){border-top:0;padding-top:8px}
.cutting-sidebar :deep(.unwrap-tool-section>.tool-note:first-child){margin:0 0 12px;font-size:10px;color:var(--text-muted)}
.cutting-sidebar :deep(.cut-library){background:var(--panel-soft)}
.cutting-sidebar :deep(.cut-library h3){font-size:12px}
@media(max-width:1100px){.cutting-workspace{grid-template-columns:255px minmax(0,1fr)}.cutting-workspace-toolbar{flex-wrap:wrap;padding:7px 10px;gap:6px}.cutting-toolbar-actions{margin-left:auto}.cutting-preview-dock{right:10px;bottom:10px;width:clamp(300px,43%,420px);max-height:calc(100% - 20px)}.cutting-preview-dock.expanded{inset:10px;width:auto}}
@media(max-width:800px){.cutting-workspace{grid-template-columns:230px minmax(0,1fr)}.cutting-sidebar-heading{padding:14px}.cutting-preview-dock{width:calc(100% - 20px);height:34%;min-height:200px}.cutting-preview-dock.expanded{height:auto}.cutting-toolbar-actions button{padding:5px 7px;font-size:10px}}
@media(prefers-reduced-motion:reduce){.cutting-sidebar{scroll-behavior:auto}}
</style>
