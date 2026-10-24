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
    <button class="select-cut" @click="choose(line)"><strong>{{line.name}}</strong><small>{{line.edges.length}} {{zh?'段 · 已保存':localize('edges · saved')}}{{line.kind!=='midline'&&!line.closed?(zh?' · 待闭合修复':localize(' · closure repair needed')):''}}{{line.mirroredFrom?(zh?' · 对称':localize(' · symmetric')):''}}</small></button>
    <button class="focus-cut" :aria-label="(zh?'聚焦裁剪线 ':localize('Focus cut '))+line.name" :title="zh?'在模型上查看':localize('Show on model')" @click="emit('focus',line.id)"><ToolIcon name="eye"/></button>
   </div>
   <div v-if="!lines.length" class="cut-lines-empty"><ToolIcon name="cut"/><small>{{search?(zh?'没有匹配的裁线。':localize('No matching cut lines.')):(zh?'在模型上绘制并保存裁线，或自动计算裁线预览。':localize('Draw and save lines on the model, or compute a cut preview.'))}}</small></div>
  </div>
  <div v-if="selectedLine" class="cut-line-editor">
   <label>{{zh?'裁剪线名称':localize('Cut line name')}}<input v-model="lineName" maxlength="120" @change="metadata(selectedLine,selectedLine.enabled,lineName)"></label>
   <div class="two-col"><button :disabled="store.busy||selectedLine.kind==='midline'" @click="emit('draw',{kind:'pen',lineId:selectedLine.id})">{{pathWarning?(zh?'用钢笔修复闭合':localize('Repair closure with pen')):(zh?'编辑钢笔节点':localize('Edit pen nodes'))}}</button><button :disabled="store.busy||selectedLine.kind==='midline'&&mesh.cutScope?.side!=='full'" @click="remove(selectedLine)">{{zh?'删除裁剪线':localize('Delete cut line')}}</button></div>
   <template v-if="selectedLine.kind!=='midline'">
    <small v-if="pathWarning" class="cut-path-warning" role="status">{{pathWarning}}</small>
    <small v-else>{{zh?'在模型上拖动钢笔节点调整闭合裁线，保存前可取消。':localize('Drag pen nodes on the model to edit the closed cut; cancel before saving.')}}</small>
   </template>
  </div>
  <details v-if="advanced" class="half-cut-settings">
   <summary>{{zh?'半侧制版与中线围合':localize('Half-side & midline')}}</summary>
   <label>{{zh?'制版范围':localize('Cutting scope')}}<select v-model="scope.side" :aria-label="zh?'制版范围':localize('Cutting scope')"><option value="full">{{zh?'完整模型':localize('Full model')}}</option><option value="right">{{zh?'半侧 · 右侧':localize('Half · right')}}</option><option value="left">{{zh?'半侧 · 左侧':localize('Half · left')}}</option></select></label>
   <div class="two-col"><label>{{zh?'中线轴':localize('Midline axis')}}<select v-model="scope.axis"><option>x</option><option>y</option><option>z</option></select></label><label>{{zh?'中线位置 mm':localize('Midline mm')}}<input v-model.number="scope.positionMm" type="number" step="1"></label></div>
   <label class="check-label"><input v-model="scope.closeMidline" type="checkbox">{{zh?'中线参与围合（缝合）；关闭则沿中线对折裁剪':localize('Sewn midline; unchecked means cut on fold')}}</label>
   <button :disabled="store.busy||!Number.isFinite(scope.positionMm)" @click="apply({type:'surface.cutScope',scope})">{{zh?'应用制版范围':localize('Apply scope')}}</button>
   <small>{{zh?'右侧为坐标大于中线的一侧，左侧为小于中线的一侧。半侧纸样自动设置镜像双片；对折边拼接间距为 0 mm。':localize('Right uses coordinates above the midline; left below. Half patterns use mirrored pairs, fold edges have zero allowance.')}}</small>
   <div v-if="midlines.length" class="midline-list"><strong>{{zh?'中线边界管理':localize('Midline boundaries')}}</strong> · {{midlines.length}}<button v-for="line in midlines" :key="line.id" @click="choose(line)">{{line.name}} · {{line.edges.length}} {{zh?'段':localize('edges')}}</button></div>
  </details>
 </section>
</template>

<script setup lang="ts">
import {localize} from './localization';

import {computed,inject,ref,watch,useTemplateRef} from 'vue';
import {useSession} from './store';
import {useDraftHistory} from './modules/useDraftHistory';
import ToolIcon from './ToolIcon.vue';
import type {CutLine,CutScope,Command} from '../../../packages/schema/index';
const props=defineProps<{language:'zh'|'en';targetId?:string;toolsTarget?:string}>(),emit=defineEmits<{draw:[request:{kind:'pen'|'paint';lineId?:string}];focus:[lineId:string]}>(),store=useSession(),zh=computed(()=>props.language==='zh'),mesh=computed(()=>store.data.project?.surface);
const advanced=inject('advancedMode',ref(false));
const search=ref(''),selected=ref(''),lineName=ref('');
const selectedLine=computed(()=>mesh.value?.cutLines?.find(line=>line.id===selected.value));
const scope=ref<CutScope>({side:'full',axis:'x',positionMm:0,closeMidline:true});
const panel=useTemplateRef<HTMLElement>('panel');
const drawingTools=[{kind:'paint',icon:'brushAdd',zh:'花纹画笔（涂区域）',en:'Paint markings (areas)'},{kind:'pen',icon:'pen',zh:'曲面钢笔（闭合裁线）',en:'Surface pen (closed cuts)'}] as const;
const history=useDraftHistory(()=>scope.value,value=>{scope.value=value;},()=>!!panel.value?.getClientRects().length,()=>store.busy);
const pathWarning=computed(()=>{const line=selectedLine.value;if(!line||line.kind==='midline')return '';if(line.kind!=='pen')return zh.value?'这条旧裁线需要用钢笔重新确认闭合路径。请在模型上修复后保存，原裁线会保留到保存成功。':localize('Confirm this legacy line as a closed pen path on the model. The original line stays until saving succeeds.');if(!line.closed)return zh.value?'此裁线尚未闭合。请在模型上用钢笔补足至少 3 个节点并确认闭合，原裁线会保留到保存成功。':localize('This cut is open. Repair it on the model with at least 3 pen nodes and confirm closure. The original stays until saving succeeds.');if(line.controlPoints.length<3)return zh.value?'闭合裁线至少需要 3 个节点；请在模型上补足节点后保存。':localize('A closed cut needs at least 3 nodes. Add nodes on the model before saving.');if(!line.projection)return zh.value?'这条旧裁线缺少钢笔编辑信息，请在模型上修复后保存。':localize('This legacy line is missing pen editing data. Repair it on the model before saving.');return '';});
const lines=computed(()=>mesh.value?.cutLines?.filter(l=>l.name.toLowerCase().includes(search.value.toLowerCase()))??[]),midlines=computed(()=>mesh.value?.cutLines?.filter(l=>l.kind==='midline')??[]);
watch(()=>JSON.stringify(mesh.value?.cutScope),()=>{const s=mesh.value?.cutScope;history.reset(()=>{scope.value=structuredClone(s??{side:'full',axis:'x',positionMm:0,closeMidline:true});});},{immediate:true});
watch(()=>mesh.value?.id,()=>{selected.value='';lineName.value='';});
watch(()=>selectedLine.value?.name,name=>{lineName.value=name??'';},{immediate:true});
function choose(line:CutLine){const base=line.mirroredFrom?mesh.value?.cutLines?.find(l=>l.id===line.mirroredFrom)??line:line;selected.value=base.id;lineName.value=base.name;emit('focus',line.id);}
watch(()=>props.targetId,id=>{if(id?.startsWith('cutLine:')){const line=mesh.value?.cutLines?.find(l=>l.id===id.slice(8));if(line)choose(line);}},{immediate:true});
async function apply(command:Command){const p=store.data.project;if(p)return store.run(()=>window.fpcad.apply(p.id,p.revision,JSON.parse(JSON.stringify(command))));}
async function metadata(line:CutLine,enabled=line.enabled,name=line.name){await apply({type:'surface.cutLine.meta',lineId:line.id,name,enabled});}
async function remove(line:CutLine){if(await apply({type:'surface.cutLine.delete',lineId:line.id})){selected.value='';lineName.value='';}}
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
.cut-line-editor .two-col{gap:6px}.cut-line-editor button{white-space:normal;font-size:10px}
.cut-line-editor .cut-path-warning{color:var(--warning)}
.half-cut-settings>button{width:100%;font-size:10px}.midline-list>button{display:block;width:100%;margin:4px 0;text-align:left;font-size:10px}
@media(max-width:1100px){.in-workspace-toolbar button{font-size:10px;padding:6px 7px;gap:5px}.in-workspace-toolbar .tool-icon{width:16px;height:16px}}
@media(max-width:800px){.surface-cut-panel{padding:13px}.in-workspace-toolbar button{padding:5px 6px}}
</style>
