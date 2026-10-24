<template>
 <WorkspaceSplit class="markings-page" storage-key="extraction-panels" @pointerdown.capture="dismissDetail" :language="language" :label="zh?'花纹图片与分类预览宽度':localize('Reference and library preview widths')" :initial=".72" :min-first="400" :min-second="260">
  <template #first>
   <div class="reference-workspace">
    <section class="auto-reference">
     <div class="auto-reference-heading">
      <h2>{{zh?'提取角色花纹':localize('Extract character markings')}}</h2>
      <span>{{zh?'正背视图 → 部位花纹':localize('FRONT / BACK → PART MARKINGS')}}</span>
     </div>
     <div class="reference-actions">
      <button class="primary" :disabled="store.busy" @click="upload">{{zh?'上传双视图并自动拆分':localize('Upload dual views and split')}}</button>
      <button :disabled="store.busy" @click="importSingle">{{zh?'导入单张原图':localize('Import single image')}}</button>
      <button v-if="extracting&&store.working" :disabled="store.cancelling" @click="store.cancelRun()">{{store.cancelling?(zh?'正在取消…':localize('Cancelling…')):(zh?'取消后台拆分':localize('Cancel extraction'))}}</button>
      <button :disabled="store.busy||store.data.project?.references?.length!==2" @click="split()">{{zh?'按当前标定重新拆分':localize('Split with current calibration')}}</button>
      <button :disabled="!store.data.project?.patternLibrary?.length" @click="emit('edit',selectedTarget??store.data.project?.patternLibrary?.[0]?.piece.id??'')">{{zh?'下一步：花纹修改 →':localize('Next: edit markings →')}}</button>
     </div>
     <details class="extraction-notes">
      <summary>{{zh?'提取说明':localize('Extraction details')}}</summary>
      <p>{{zh?'沿原图的连续颜色区域提取，合并相近阴影；部位标签不会切开色块。正背视图共同预览，遮挡区域通过对应色区生成补全候选。':localize('Merge pigment shading, remove stroke fragments, smooth outlines and suggest editable part categories. Both views describe colors and transitions; only existing model parts receive markings.')}}</p>
      <p>{{zh?'部位识别是可修正的候选：姿势特别、遮挡或局部图请检查分类。重新拆分会替换花纹库和相关贴附；已锁定来源会阻止替换。':localize('Part suggestions are editable; review unusual poses and occlusion. Resplitting replaces sources and related placements. Locked sources prevent replacement.')}}</p>
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
async function importSingle(){const p=store.data.project;if(p&&await store.run(()=>window.fpcad.importReference(p.id,p.revision,'front')))selectedSource.value=store.data.project?.references?.find(r=>r.view==='front')?.id??'';}
async function upload(){const p=store.data.project;if(p&&!store.busy){extracting.value=true;try{await store.run(()=>window.fpcad.autoReference(p.id,p.revision,'front-right',1800,6,true,'simple','character'),{label:zh.value?'正在提取原图花纹':localize('Extracting reference markings'),cancel:()=>window.fpcad.cancelSurface(p.id,p.revision)});}finally{extracting.value=false;}}}
async function split(){const p=store.data.project;if(p&&!store.busy){extracting.value=true;try{await store.run(()=>window.fpcad.splitAllReferences(p.id,p.revision,p.references?.[0]?.calibration?.distanceMm??1800,6,true,'simple',p.references?.[0]?.illustration?.subject??'character'),{label:zh.value?'正在提取原图花纹':localize('Extracting reference markings'),cancel:()=>window.fpcad.cancelSurface(p.id,p.revision)});}finally{extracting.value=false;}}}
</script>

<style scoped>
.markings-page{height:100%;width:100%;min-width:0;min-height:0;background:var(--bg)}
.reference-workspace{height:100%;overflow:auto;overscroll-behavior:contain;background:var(--bg)}
.auto-reference{padding:18px 20px 14px;border-bottom:1px solid var(--border);background:var(--panel)}
.auto-reference-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.auto-reference-heading h2{font-size:17px;font-weight:600;line-height:1.4;letter-spacing:-.02em;margin:0}
.auto-reference-heading>span{font-size:10px;color:var(--text-muted);letter-spacing:0}
.reference-actions{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 10px}
.reference-actions button{font-size:11px;padding:7px 10px;white-space:normal;text-align:left;line-height:1.4}
.extraction-notes{font-size:11px;color:var(--text-muted)}
.extraction-notes summary{cursor:pointer;width:fit-content;color:var(--text-muted);line-height:1.6}
.extraction-notes p{max-width:80ch;margin:8px 0 0;line-height:1.7;color:var(--text-muted)}
.auto-reference>.error{font-size:11px;line-height:1.6;margin:0 0 10px}
.reference-workspace :deep(.reference-view){height:400px}
.reference-workspace :deep(.reference-controls){margin-top:12px}
@media(max-width:1100px){.auto-reference{padding:16px}}
</style>
