<template>
 <section v-if="mesh" ref="panel" class="surface-cut-panel">
  <Teleport :to="toolsTarget??'body'" :disabled="!toolsTarget" defer>
   <div class="cut-drawing-tools" :class="{'in-workspace-toolbar':!!toolsTarget}" :aria-label="zh?'裁剪线绘制工具':localize('Cut drawing tools')">
    <button v-for="tool in drawingTools" :key="tool.kind" :disabled="store.busy" :title="zh?tool.zh:localize(tool.en)" @click="emit('draw',{kind:tool.kind})"><ToolIcon :name="tool.icon"/><span>{{zh?tool.zh:localize(tool.en)}}</span></button>
   </div>
  </Teleport>
  <div class="saved-cut-header">
   <strong>{{zh?'已保存裁线':localize('Saved cut lines')}} <span>{{mesh.cutLines?.length??0}}</span></strong>
   <button :disabled="store.busy||(!store.data.canUndo&&!history.canUndo.value)" @click="restore"><ToolIcon name="undo"/>{{zh?'恢复':localize('Restore')}}</button>
  </div>
  <input v-model="search" class="cut-line-search" :placeholder="zh?'搜索裁剪线':localize('Search cut lines')" :aria-label="zh?'搜索裁剪线':localize('Search cut lines')">
  <div class="saved-cut-list">
   <div v-for="line in lines" :key="line.id" :class="['saved-line',{active:selected===line.id||selected===line.mirroredFrom,disabled:!line.enabled}]">
    <input type="checkbox" :checked="line.enabled" :disabled="store.busy||!!line.mirroredFrom" :aria-label="(zh?'启用裁剪线 ':localize('Enable cut '))+line.name" @change="metadata(line,($event.target as HTMLInputElement).checked)">
    <button class="select-cut" @click="choose(line)"><strong>{{line.name}}</strong><small>{{line.edges.length}} {{zh?'段 · 已保存':localize('edges · saved')}}{{line.mirroredFrom?(zh?' · 对称':localize(' · symmetric')):''}}</small></button>
    <button class="focus-cut" :aria-label="(zh?'聚焦裁剪线 ':localize('Focus cut '))+line.name" :title="zh?'在模型上查看':localize('Show on model')" @click="emit('focus',line.id)"><ToolIcon name="eye"/></button>
   </div>
   <div v-if="!lines.length" class="cut-lines-empty"><ToolIcon name="cut"/><small>{{search?(zh?'没有匹配的裁线。':localize('No matching cut lines.')):(zh?'在模型上绘制并保存裁线，或自动计算裁线预览。':localize('Draw and save lines on the model, or compute a cut preview.'))}}</small></div>
  </div>
  <div v-if="draft&&!sectionActive" class="cut-line-editor">
   <label>{{zh?'裁剪线名称':localize('Cut line name')}}<input v-model="draft.name" maxlength="120" @change="metadata(draft,draft.enabled,draft.name)"></label>
   <div class="two-col"><button :disabled="store.busy||draft.kind==='midline'" @click="emit('draw',{kind:draft.section?'section':draft.kind as 'pen'|'freehand',lineId:draft.id})">{{draft.section?(zh?'在模型上调整截面':localize('Adjust section on model')):(zh?'编辑路径节点':localize('Edit path nodes'))}}</button><button :disabled="store.busy||draft.kind==='midline'&&mesh.cutScope?.side!=='full'" @click="remove(draft)">{{zh?'删除裁剪线':localize('Delete cut line')}}</button></div>
   <small>{{zh?'在模型上拖动路径圆点调整，保存前可取消。':localize('Drag path nodes on the model; cancel before saving.')}}</small>
   <template v-if="draft.kind!=='midline'">
    <template v-if="draft.section"><label>{{zh?'截面位置 mm':localize('Section position mm')}}<input v-model.number="draft.section.positionMm" type="number" step="1"></label></template>
    <template v-else>
     <label class="check-label"><input v-model="draft.symmetric" type="checkbox">{{zh?'对称绘制':localize('Symmetric drawing')}}</label>
     <label v-if="advanced" class="check-label"><input v-model="draft.closed" type="checkbox">{{zh?'闭合裁剪线':localize('Close cut line')}}</label>
     <label v-if="advanced&&draft.kind==='pen'">{{zh?'钢笔张力':localize('Pen tension')}}<input v-model.number="draft.tension" type="range" min="0" max="1" step=".05"></label>
     <details v-if="advanced"><summary>{{zh?'路径点调整与新增切分点':localize('Path points & insert points')}} · {{draft.controlPoints.length}}</summary><div v-for="(p,i) in draft.controlPoints" :key="p.id" class="cut-control-point"><span>{{i+1}}</span><label v-for="axis in (['xMm','yMm','zMm'] as const)" :key="axis">{{axis[0].toUpperCase()}} mm<input v-model.number="p[axis]" type="number" step=".5"></label><button :disabled="draft.controlPoints.length<=2" :aria-label="'Remove point '+(i+1)" @click="draft.controlPoints.splice(i,1)">−</button><button v-if="i<draft.controlPoints.length-1" :disabled="draft.controlPoints.length>=400" :aria-label="'Insert point after '+(i+1)" @click="insert(i)">＋</button></div></details>
    </template>
    <button class="apply-path" :disabled="store.busy||!draft.name.trim()" @click="savePath">{{zh?'应用路径调整':localize('Apply path edits')}}</button><button v-if="draftDirty" class="apply-path" :disabled="store.busy" @click="discardPathEdits">{{zh?'取消路径调整':localize('Cancel path edits')}}</button>
   </template>
  </div>
  <details v-if="advanced" class="half-cut-settings">
   <summary>{{zh?'半侧制版与中线围合':localize('Half-side & midline')}}</summary>
   <label>{{zh?'制版范围':localize('Cutting scope')}}<select v-model="scope.side" :aria-label="zh?'制版范围':localize('Cutting scope')"><option value="full">{{zh?'完整模型':localize('Full model')}}</option><option value="right">{{zh?'半侧 · 右侧':localize('Half · right')}}</option><option value="left">{{zh?'半侧 · 左侧':localize('Half · left')}}</option></select></label>
   <div class="two-col"><label>{{zh?'中线轴':localize('Midline axis')}}<select v-model="scope.axis"><option>x</option><option>y</option><option>z</option></select></label><label>{{zh?'中线位置 mm':localize('Midline mm')}}<input v-model.number="scope.positionMm" type="number" step="1"></label></div>
   <label class="check-label"><input v-model="scope.closeMidline" type="checkbox">{{zh?'中线参与围合（缝合）；关闭则沿中线对折裁剪':localize('Sewn midline; unchecked means cut on fold')}}</label>
   <button :disabled="store.busy||!Number.isFinite(scope.positionMm)" @click="apply({type:'surface.cutScope',scope})">{{zh?'应用制版范围':localize('Apply scope')}}</button>
   <small>{{zh?'右侧为坐标大于中线的一侧，左侧为小于中线的一侧。半侧纸样自动设置镜像双片；对折边缝份为 0 mm。':localize('Right uses coordinates above the midline; left below. Half patterns use mirrored pairs, fold edges have zero allowance.')}}</small>
   <div v-if="midlines.length" class="midline-list"><strong>{{zh?'中线边界管理':localize('Midline boundaries')}}</strong> · {{midlines.length}}<button v-for="line in midlines" :key="line.id" @click="choose(line)">{{line.name}} · {{line.edges.length}} {{zh?'段':localize('edges')}}</button></div>
  </details>
 </section>
</template>

<script setup lang="ts">
import {localize} from './localization';

import {computed,inject,ref,watch,nextTick,useTemplateRef} from 'vue';
import {useSession} from './store';
import {useDraftHistory} from './modules/useDraftHistory';
import ToolIcon from './ToolIcon.vue';
import type {CutLine,CutScope,Command} from '../../../packages/schema/index';
const props=defineProps<{sectionActive?:boolean;language:'zh'|'en';targetId?:string;toolsTarget?:string}>(),emit=defineEmits<{draw:[request:{kind:'pen'|'freehand'|'brush'|'lasso'|'section'|'paint';lineId?:string}];focus:[lineId:string];draftDirty:[dirty:boolean]}>(),store=useSession(),zh=computed(()=>props.language==='zh'),mesh=computed(()=>store.data.project?.surface);
const advanced=inject('advancedMode',ref(false));
const search=ref(''),selected=ref(''),draft=ref<CutLine>();
const scope=ref<CutScope>({side:'full',axis:'x',positionMm:0,closeMidline:true});
const panel=useTemplateRef<HTMLElement>('panel');
const drawingTools=[{kind:'paint',icon:'brushAdd',zh:'花纹画笔（涂区域）',en:'Paint markings (areas)'},{kind:'pen',icon:'pen',zh:'曲面钢笔',en:'Surface pen'},{kind:'freehand',icon:'pen',zh:'手绘裁线',en:'Freehand cut line'},{kind:'lasso',icon:'lasso',zh:'套索裁线',en:'Lasso cut line'}] as const;
const history=useDraftHistory(()=>({draft:draft.value,scope:scope.value}),value=>{draft.value=value.draft;scope.value=value.scope;},()=>!props.sectionActive&&!!panel.value?.getClientRects().length,()=>store.busy);
const draftDirty=computed(()=>!!draft.value&&JSON.stringify(draft.value)!==JSON.stringify(mesh.value?.cutLines?.find(line=>line.id===draft.value?.id)));
watch(draftDirty,dirty=>emit('draftDirty',dirty),{immediate:true});
function discardPathEdits(){const saved=mesh.value?.cutLines?.find(line=>line.id===draft.value?.id);if(saved)history.reset(()=>{draft.value=JSON.parse(JSON.stringify(saved));});}
const lines=computed(()=>mesh.value?.cutLines?.filter(l=>l.name.toLowerCase().includes(search.value.toLowerCase()))??[]),midlines=computed(()=>mesh.value?.cutLines?.filter(l=>l.kind==='midline')??[]);
watch(()=>JSON.stringify(mesh.value?.cutScope),()=>{const s=mesh.value?.cutScope;history.reset(()=>{scope.value=structuredClone(s??{side:'full',axis:'x',positionMm:0,closeMidline:true});});},{immediate:true});
watch(()=>mesh.value?.id,()=>{history.reset(()=>{selected.value='';draft.value=undefined;});});
watch(()=>JSON.stringify(mesh.value?.cutLines),()=>{history.reset(()=>{if(selected.value){const line=mesh.value?.cutLines?.find(l=>l.id===selected.value);draft.value=line?JSON.parse(JSON.stringify(line)):undefined;}});},{deep:false});
function choose(line:CutLine){const base=line.mirroredFrom?mesh.value?.cutLines?.find(l=>l.id===line.mirroredFrom)??line:line;history.reset(()=>{selected.value=base.id;draft.value=JSON.parse(JSON.stringify(base));});emit('focus',line.id);}
watch(()=>props.targetId,id=>{if(id?.startsWith('cutLine:')){const line=mesh.value?.cutLines?.find(l=>l.id===id.slice(8));if(line)choose(line);}},{immediate:true});
async function apply(command:Command){const p=store.data.project;if(p)return store.run(()=>window.fpcad.apply(p.id,p.revision,JSON.parse(JSON.stringify(command))));}
async function metadata(line:CutLine,enabled=line.enabled,name=line.name){await apply({type:'surface.cutLine.meta',lineId:line.id,name,enabled});}
async function remove(line:CutLine){if(await apply({type:'surface.cutLine.delete',lineId:line.id})){selected.value='';draft.value=undefined;}}
async function savePath(){const d=draft.value;if(!d)return;if(d.section)await apply({type:'surface.section',id:d.id,name:d.name,section:d.section});else if(d.projection)await apply({type:'surface.curve',id:d.id,name:d.name,kind:d.kind as 'pen'|'freehand',regions:d.regions,controlPoints:d.controlPoints,...(d.surfaceAnchored?{surfaceAnchored:true}:{}),projection:d.projection,tension:d.tension,closed:d.closed,symmetric:d.symmetric});}
function insert(index:number){const d=draft.value;if(!d||index>=d.controlPoints.length-1)return;const a=d.controlPoints[index],b=d.controlPoints[index+1];d.controlPoints.splice(index+1,0,{id:crypto.randomUUID(),xMm:(a.xMm+b.xMm)/2,yMm:(a.yMm+b.yMm)/2,zMm:(a.zMm+b.zMm)/2});}
async function openSection(){if(props.sectionActive||!draft.value?.section)return;await nextTick();const editor=panel.value?.querySelector<HTMLElement>('.cut-line-editor');editor?.scrollIntoView({block:'nearest'});editor?.querySelector<HTMLInputElement>('input[type=number]')?.focus();}
defineExpose({openSection});
function restore(){window.dispatchEvent(new CustomEvent('fpcad-document-history',{detail:{redo:false}}));}
</script>

<style scoped>
.surface-cut-panel{padding:15px 16px;border-bottom:1px solid var(--border);font-size:11px;flex-shrink:0}
.saved-cut-header{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}
.saved-cut-header>strong{font-size:12px}.saved-cut-header>strong>span{margin-left:6px;color:var(--text-muted);font-size:10px;font-weight:500}
.saved-cut-header>button{display:flex;align-items:center;gap:4px;font-size:10px;padding:4px 6px;background:transparent}.saved-cut-header .tool-icon{width:13px;height:13px}
.cut-drawing-tools{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px}
.cut-drawing-tools button{display:flex;align-items:center;justify-content:center;gap:7px;font-size:11px;padding:7px 9px}
.cut-drawing-tools .tool-icon{width:17px;height:17px}
.cut-drawing-tools.in-workspace-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:0}
.in-workspace-toolbar button{border-color:transparent;background:transparent;padding:7px 9px;min-height:33px}
.in-workspace-toolbar button:hover{border-color:var(--border);background:var(--panel-soft)}
.surface-cut-panel label{font-size:11px;margin:10px 0}.surface-cut-panel label>select{margin-top:6px}
.surface-cut-panel summary{font-size:11px;font-weight:600;cursor:pointer}
.surface-cut-panel details{margin:14px 0 0;padding:12px 0 0;border-top:1px solid var(--border)}
.surface-cut-panel small{display:block;color:var(--text-muted);line-height:1.7;margin:6px 0}
.cut-line-search{font-size:11px;padding:7px 9px!important;background:var(--panel-soft)!important}
.saved-cut-list{max-height:280px;overflow:auto;margin-top:9px}
.saved-line{display:flex;align-items:center;gap:5px;padding:2px 5px;border:1px solid transparent;border-radius:5px}
.saved-line+.saved-line{margin-top:3px}.saved-line.active{border-color:var(--studio-teal);background:var(--accent-soft)}.saved-line.disabled .select-cut{opacity:.6}
.saved-line>input{width:auto;margin:0 3px 0 0;flex-shrink:0}
.select-cut{flex:1;text-align:left;min-width:0;border-color:transparent;background:transparent;padding:6px 2px}
.select-cut:hover{background:transparent;border-color:transparent}
.select-cut strong{display:block;overflow-wrap:anywhere;white-space:normal;font-size:11px;font-weight:550}
.select-cut small{font-size:9px;margin:3px 0 0}
.focus-cut{padding:5px;background:transparent;border-color:transparent}.focus-cut .tool-icon{width:15px;height:15px}
.cut-lines-empty{display:flex;align-items:center;gap:10px;padding:12px 4px 8px;color:var(--text-muted)}.cut-lines-empty>.tool-icon{width:24px;height:24px;opacity:.55}.cut-lines-empty>small{margin:0;font-size:10px}
.cut-line-editor{margin-top:12px;padding:0 10px 10px;background:var(--panel-soft);border:1px solid var(--border);border-radius:6px}
.cut-line-editor .two-col{gap:6px}.cut-line-editor button{white-space:normal;font-size:10px}.apply-path{width:100%;margin-top:7px}
.cut-control-point{display:grid;grid-template-columns:12px repeat(3,minmax(0,1fr)) 20px 20px;gap:3px;align-items:center}.cut-control-point label{font-size:9px;margin:5px 0}
.cut-control-point input{padding:5px 2px;font-size:10px;min-width:0}.cut-control-point button{padding:3px}
.half-cut-settings>button{width:100%;font-size:10px}.midline-list>button{display:block;width:100%;margin:4px 0;text-align:left;font-size:10px}
@media(max-width:1100px){.in-workspace-toolbar button{font-size:10px;padding:6px 7px;gap:5px}.in-workspace-toolbar .tool-icon{width:16px;height:16px}}
@media(max-width:800px){.surface-cut-panel{padding:13px}.in-workspace-toolbar button{padding:5px 6px}}
</style>
