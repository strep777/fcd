<template>
 <section class="marking-edit-page" :aria-label="zh?'花纹修改工作区':localize('Marking editing workspace')">
  <header class="edit-page-heading">
   <div><h1>{{zh?'花纹修改':localize('Edit markings')}}</h1><p>{{region?.piece.name??(zh?'选择要修改的花纹':localize('Choose a marking to edit'))}}</p></div>
   <div class="edit-page-navigation"><button @click="emit('references')">{{zh?'返回花纹提取':localize('Back to extraction')}}</button><button :disabled="!regions.length" @click="emit('model')">{{zh?'下一步：模型管理 →':localize('Next: model management →')}}</button></div>
  </header>
  <div v-if="pendingSelection!==null" class="edit-switch-confirm" role="alertdialog" :aria-label="zh?'保存当前花纹修改':localize('Save current marking changes')"><span>{{zh?'当前花纹有未保存修改。':localize('The current marking has unsaved changes.')}}</span><button class="primary" :disabled="store.busy" @click="saveAndSwitch">{{zh?'保存并切换':localize('Save and switch')}}</button><button :disabled="store.busy" @click="discardAndSwitch">{{zh?'放弃并切换':localize('Discard and switch')}}</button><button @click="pendingSelection=null">{{zh?'继续编辑':localize('Keep editing')}}</button></div>
  <div class="edit-page-content" :class="{collapsed:!listOpen}">
   <aside class="edit-source-list">
    <div class="source-list-heading"><strong v-if="listOpen">{{zh?'花纹库':localize('Marking library')}} <span>{{regions.length}}</span></strong><button :aria-expanded="listOpen" :aria-label="listOpen?(zh?'收起花纹列表':localize('Collapse marking list')):(zh?'展开花纹列表':localize('Expand marking list'))" @click="listOpen=!listOpen"><ToolIcon :name="listOpen?'left':'right'"/></button></div>
    <template v-if="listOpen"><input v-model="search" :placeholder="zh?'搜索花纹':localize('Search markings')" :aria-label="zh?'搜索修改花纹':localize('Search markings to edit')"><div class="editable-sources"><button v-for="r in filtered" :key="r.piece.id" :data-edit-region-id="r.piece.id" :class="['edit-source-card',{active:selected===r.piece.id}]" :aria-pressed="selected===r.piece.id" :disabled="store.busy" @click="selectSource(r.piece.id)"><svg :viewBox="box(r.piece)" aria-hidden="true"><path :d="piecePath(r.piece)" :fill="r.piece.color" fill-rule="evenodd" stroke="#424650" stroke-width="1.25" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg><span><strong>{{r.piece.name}}</strong><small>{{r.category}}</small></span></button><p v-if="regions.length&&!filtered.length" class="list-empty">{{zh?'没有匹配的花纹':localize('No matching markings')}}</p></div></template>
   </aside>
   <div class="edit-canvas-area">
    <SourceRegionEditor v-if="region" :key="region.piece.id" ref="sourceEditor" :piece="region.piece" :reference="reference" :language="language" :active="active" :busy="store.busy" :reset-token="sourceReset" :save-error="sourceSaveError" @dirty="dirty=$event;if(!$event)sourceSaveError=''" @commit="saveSource"/>
    <div v-else class="edit-empty"><ToolIcon name="brushAdd"/><h2>{{zh?'先提取花纹，再在这里补全':localize('Extract a marking, then complete it here')}}</h2><p>{{zh?'选择花纹后会显示虚线选区。使用画笔补上缺失的色块，用橡皮修整边缘。':localize('Choose a marking to see its dotted selection. Paint missing areas and erase unwanted edges.')}}</p><button class="primary" @click="emit('references')">{{zh?'前往花纹提取':localize('Go to extraction')}}</button></div>
   </div>
  </div>
  <div class="edit-save-status"><p v-if="notice" class="edit-save-notice" role="status">{{notice}}</p></div>
 </section>
</template>

<script setup lang="ts">
import {computed,ref,useTemplateRef,watch} from 'vue';
import {localize} from './localization';
import {useSession} from './store';
import ToolIcon from './ToolIcon.vue';
import SourceRegionEditor from './SourceRegionEditor.vue';
import {piecePath,pointBounds} from '../../../packages/pattern/edit';
import type {Piece} from '../../../packages/schema/index';
import type {SourceEdit} from '../../../packages/reference/source-edit';

const props=defineProps<{language:'zh'|'en';targetId?:string;active:boolean}>(),emit=defineEmits<{references:[];model:[];select:[id:string];dirty:[value:boolean]}>(),store=useSession(),zh=computed(()=>props.language==='zh');
const sourceEditor=useTemplateRef<InstanceType<typeof SourceRegionEditor>>('sourceEditor'),selected=ref(''),search=ref(''),listOpen=ref(true),dirty=ref(false),sourceReset=ref(0),sourceSaveError=ref(''),notice=ref(''),pendingSelection=ref<string|null>(null);
const regions=computed(()=>store.data.project?.patternLibrary??[]),region=computed(()=>regions.value.find(r=>r.piece.id===selected.value)),reference=computed(()=>store.data.project?.references?.find(r=>r.id===region.value?.referenceId));
const filtered=computed(()=>regions.value.filter(r=>(r.piece.name+' '+r.category+' '+r.piece.color).toLowerCase().includes(search.value.trim().toLowerCase())));
watch(dirty,value=>{if(value)notice.value='';emit('dirty',value);},{flush:'sync'});
watch(()=>props.targetId,id=>{if(id&&regions.value.some(r=>r.piece.id===id))selectSource(id);},{immediate:true});
watch(regions,list=>{if(!list.some(r=>r.piece.id===selected.value)){selected.value=list[0]?.piece.id??'';dirty.value=false;sourceSaveError.value='';pendingSelection.value=null;}},{immediate:true});
function selectSource(id:string){if(selected.value===id)return;if(dirty.value){pendingSelection.value=id;return;}selected.value=id;notice.value='';sourceSaveError.value='';emit('select',id);}
function discard(){sourceEditor.value?.reset();dirty.value=false;sourceSaveError.value='';pendingSelection.value=null;}
function discardAndSwitch(){const id=pendingSelection.value;if(id===null)return;discard();selectSource(id);}
async function saveAndSwitch(){const id=pendingSelection.value;if(id!==null&&await save())selectSource(id);}
async function saveSource(edit:SourceEdit){const p=store.data.project,r=region.value;if(!p||!r||store.busy)return false;sourceSaveError.value='';notice.value='';const id=r.piece.id;
 if(await store.run(()=>window.fpcad.editLibraryRegion(p.id,p.revision,id,edit),{label:zh.value?'正在保存花纹修改…':localize('Saving marking changes…')})){sourceReset.value++;dirty.value=false;pendingSelection.value=null;notice.value=zh.value?'花纹修改已保存，原图中的选区已同步。':localize('Marking changes saved; the selection on the original image is updated.');return true;}
 sourceSaveError.value=store.error;return false;
}
async function save(){if(!dirty.value)return true;const edit=sourceEditor.value?.getEdit();if(!edit)return false;return saveSource(edit);}
function box(piece:Piece){const b=pointBounds([...piece.nodes,...(piece.holes??[]).flat(),...(piece.curves??[]).flatMap(c=>[c.c1,c.c2])]),pad=Math.max(3,Math.max(b.maxX-b.minX,b.maxY-b.minY)*.08);return `${b.minX-pad} ${-b.maxY-pad} ${b.maxX-b.minX+pad*2} ${b.maxY-b.minY+pad*2}`;}
defineExpose({save,discard,dirty});
</script>

<style scoped>
.edit-save-status{height:36px;flex:none;overflow:auto}
.marking-edit-page{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;background:var(--panel)}.edit-page-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:69px;padding:12px 20px;border-bottom:1px solid var(--border);background:var(--panel)}.edit-page-heading h1{font-size:17px;line-height:1.3;letter-spacing:-.02em;font-weight:650;margin:0 0 4px}.edit-page-heading p{font-size:11px;line-height:1.5;color:var(--text-muted);margin:0;overflow-wrap:anywhere}.edit-page-navigation{display:flex;gap:8px;flex:none}.edit-page-navigation button{font-size:11px;padding:7px 10px}.edit-page-navigation button:last-child{color:var(--accent)}
.edit-page-content{display:grid;grid-template-columns:240px minmax(0,1fr);flex:1;min-height:0;min-width:0}.edit-page-content.collapsed{grid-template-columns:46px minmax(0,1fr)}.edit-source-list{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0;padding:12px;background:var(--panel-soft);border-right:1px solid var(--border)}.source-list-heading{display:flex;justify-content:space-between;align-items:center;gap:6px;min-height:30px}.source-list-heading strong{font-size:12px;font-weight:600}.source-list-heading span{color:var(--text-muted);font-weight:400;margin-left:5px}.source-list-heading button{display:grid;place-items:center;width:28px;min-height:28px;padding:5px;background:transparent}.source-list-heading .tool-icon{width:16px;height:16px}.edit-source-list>input{margin:0;font-size:11px;padding:7px 9px}.editable-sources{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:7px}.edit-source-card{min-width:0;white-space:normal;display:grid;grid-template-columns:64px minmax(0,1fr);align-items:center;gap:10px;padding:7px;text-align:left;flex:none;min-height:64px;background:var(--panel);border:1px solid var(--border)}.edit-source-card.active{background:var(--selected);border-color:var(--accent);outline:1px solid var(--accent);outline-offset:-1px}.edit-source-card svg{display:block;width:64px;height:64px;background:var(--canvas);border-radius:4px}.edit-source-card>span{min-width:0}.edit-source-card strong{display:block;font-size:11px;line-height:1.5;font-weight:500;overflow-wrap:anywhere}.edit-source-card small{display:block;font-size:10px;color:var(--text-muted);line-height:1.5;margin-top:3px;overflow-wrap:anywhere}.collapsed .edit-source-list{padding-inline:9px}.edit-canvas-area{min-width:0;min-height:0;overflow:hidden}.edit-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;height:100%;padding:32px;text-align:center;background:var(--canvas)}.edit-empty>.tool-icon{width:36px;height:36px;color:var(--text-muted)}.edit-empty h2{font-size:17px;line-height:1.4;font-weight:550;margin:0}.edit-empty p{color:var(--text-muted);font-size:12px;line-height:1.8;max-width:45ch;margin:0}.list-empty{font-size:11px;color:var(--text-muted);line-height:1.7}.edit-switch-confirm{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 20px;background:var(--warning-soft);border-bottom:1px solid var(--border);font-size:12px}.edit-switch-confirm span{margin-right:auto}.edit-switch-confirm button{font-size:11px;padding:6px 10px}.edit-save-notice{margin:0;padding:7px 18px;border-top:1px solid var(--border);color:var(--text-muted);font-size:11px;line-height:1.6}
@media(max-width:1100px){.edit-page-content{grid-template-columns:180px minmax(0,1fr)}.edit-page-heading{padding:10px 14px}.edit-source-list{padding:10px}.edit-source-card{grid-template-columns:44px minmax(0,1fr);gap:7px}.edit-source-card svg{width:44px;height:44px}}
</style>
