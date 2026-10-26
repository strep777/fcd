<template>
 <WorkspaceSplit class="markings-page" storage-key="extraction-panels" @pointerdown.capture="dismissDetail" :language="language" :label="zh?'花纹图片与分类预览宽度':localize('Reference and library preview widths')" :initial=".72" :min-first="400" :min-second="260">
  <template #first>
   <div class="reference-workspace">
    <section class="auto-reference">
     <div class="auto-reference-heading">
      <h2>{{zh?'提取角色花纹':localize('Extract character markings')}}</h2>
      <span>{{zh?'整张设定图 → 部位花纹':localize('REFERENCE SHEET → PART MARKINGS')}}</span>
     </div>
     <div class="reference-actions">
      <button class="primary" :disabled="store.busy" @click="upload">{{zh?'上传设定图并提取花纹':localize('Upload reference sheet and extract markings')}}</button>
      <button :disabled="store.busy" @click="importSingle">{{zh?'仅导入设定图':localize('Import reference sheet only')}}</button>
      <button v-if="extracting&&store.working" :disabled="store.cancelling" @click="store.cancelRun()">{{store.cancelling?(zh?'正在取消…':localize('Cancelling…')):(zh?'取消提取':localize('Cancel extraction'))}}</button>
      <button :disabled="store.busy||!store.data.project?.references?.length" @click="split">{{zh?'按当前标定重新提取':localize('Extract with current calibration')}}</button>
      <button :disabled="!store.data.project?.patternLibrary?.length" @click="emit('edit',selectedTarget??store.data.project?.patternLibrary?.[0]?.piece.id??'')">{{zh?'下一步：花纹修改 →':localize('Next: edit markings →')}}</button>
     </div>
     <details class="extraction-notes">
      <summary>{{zh?'提取说明':localize('Extraction details')}}</summary>
      <p>{{zh?'整张设定图作为一张原图提取，保留图中全部角色和细节。连续颜色区域分别生成花纹，相近阴影合并；部位标签不会切开色块。':localize('Extract the entire reference sheet as one image, keeping all subjects and details. Continuous color regions become markings; similar shading is merged, and part labels do not split regions.')}}</p>
      <p>{{zh?'部位分类可以修改。姿势特别、遮挡或局部图请检查分类。重新提取会替换花纹库和相关贴附；已锁定来源会阻止替换。':localize('Part suggestions are editable; review unusual poses and occlusion. Re-extraction replaces sources and related placements. Locked sources prevent replacement.')}}</p>
      <p>{{zh?'可直接上传一整张设定图，也可先导入，在原图工作区标定和手工选区。':localize('Upload one complete reference sheet, or import it first to calibrate and draw selections in the image workspace.')}}</p>
     </details>
    </section>
    <ReferencesPanel :target-id="selectedTarget" library :language="language" :selection="selection" @unwrap="emit('unwrap')" @select="selectSource" @edit="emit('edit',$event)"/>
   </div>
  </template>
  <template #second><MarkingLibrary :target-id="selectedTarget" :language="language" @select="selectSource" @edit="emit('edit',$event)"/></template>
 </WorkspaceSplit>
</template>

<script setup lang="ts">
import {localize} from './localization';

import {computed,ref,watch} from 'vue';
import {useSession} from './store';
import WorkspaceSplit from './WorkspaceSplit.vue';
import ReferencesPanel from './ReferencesPanel.vue';
import MarkingLibrary from './MarkingLibrary.vue';


const props=defineProps<{language:'zh'|'en';targetId?:string;selection?:{markingId:string;pieceId:string}}>(),emit=defineEmits<{edit:[id:string];unwrap:[];select:[id:string]}>(),store=useSession(),zh=computed(()=>props.language==='zh');
const extracting=ref(false),selectedSource=ref<string>();
const selectedTarget=computed(()=>selectedSource.value??props.targetId);
watch(()=>props.targetId,()=>{selectedSource.value=undefined;});
function selectSource(id:string){selectedSource.value=id;emit('select',id);}
function dismissDetail(event:PointerEvent){const target=event.target as Element;if(target.closest('.marking-library,button,input,select,textarea,label,summary,a,[role=toolbar],.mask-controls,.tool-options,.zoom-toolbar,.pen-node,.pen-handle,[data-source-region-id]'))return;selectSource('');}
async function importSingle(){const p=store.data.project;if(p&&!store.busy&&await store.run(()=>window.fpcad.importReference(p.id,p.revision,'sheet')))selectedSource.value=store.data.project?.references?.find(r=>r.view==='sheet')?.id??'';}
async function upload(){const p=store.data.project;if(p&&!store.busy){extracting.value=true;try{await store.run(()=>window.fpcad.autoReference(p.id,p.revision,'sheet',1800,6,true,'simple','character'),{label:zh.value?'正在提取原图花纹':localize('Extracting reference markings'),cancel:()=>window.fpcad.cancelSurface(p.id,p.revision)});}finally{extracting.value=false;}}}
async function split(){const p=store.data.project,reference=p?.references?.[0];if(!p||store.busy||!reference)return;extracting.value=true;try{await store.run(()=>window.fpcad.splitAllReferences(p.id,p.revision,reference.calibration?.distanceMm??1800,6,true,'simple',reference.illustration?.subject??'character'),{label:zh.value?'正在提取原图花纹':localize('Extracting reference markings'),cancel:()=>window.fpcad.cancelSurface(p.id,p.revision)});}finally{extracting.value=false;}}
</script>

<style scoped>
.markings-page{height:100%;width:100%;min-width:0;min-height:0;background:var(--bg)}
.reference-workspace{height:100%;overflow:auto;overscroll-behavior:contain;background:var(--bg)}
.auto-reference{padding:18px 20px 14px;border-bottom:1px solid var(--border);background:var(--panel)}
.auto-reference-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.auto-reference-heading h2{font-size:17px;font-weight:600;line-height:1.4;letter-spacing:-.02em;margin:0}
.auto-reference-heading>span{font-size:10px;color:var(--text-muted);letter-spacing:0}
.reference-actions{display:flex;align-items:end;gap:7px;flex-wrap:wrap;margin:0 0 10px}
.reference-actions button{font-size:11px;padding:7px 10px;white-space:normal;text-align:left;line-height:1.4}
.extraction-notes{font-size:11px;color:var(--text-muted)}
.extraction-notes summary{cursor:pointer;width:fit-content;color:var(--text-muted);line-height:1.6}
.extraction-notes p{max-width:80ch;margin:8px 0 0;line-height:1.7;color:var(--text-muted)}
.auto-reference>.error{font-size:11px;line-height:1.6;margin:0 0 10px}
.reference-workspace :deep(.reference-view){height:400px}
.reference-workspace :deep(.reference-controls){margin-top:12px}
@media(max-width:1100px){.auto-reference{padding:16px}}
</style>
