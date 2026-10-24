<template><section class="assembly-page" aria-label="裁片拼接预览"><header><div><h2>{{zh?'拼接预览':localize('Cut assembly')}}</h2><p>{{zh?'从实际裁片的三维绑定与接缝检查拼接，再进入制版。此处是保存位置的几何重建，不能预测布料张力与缝合变形。':localize('Inspect actual cut bindings and seams before pattern making. This reconstructs saved positions; it does not predict fabric tension or sewn deformation.')}}</p></div><button @click="emit('pattern')">{{zh?'进入制版 →':localize('Pattern making →')}}</button></header><label class="assembly-source">{{zh?'拼接来源':localize('Assembly source')}}<select v-model="choice" :aria-label="zh?'拼接来源':localize('Assembly source')"><option value="current">{{zh?'当前候选 / 制版裁片':localize('Current candidate / working patterns')}}</option><option v-for="entry in project?.cuttingLibrary??[]" :key="entry.id" :value="entry.id">{{entry.name}} · {{entry.run.pieces.length}} {{zh?'片':localize('pieces')}}</option></select></label><template v-if="source&&available&&integrity==='valid'"><p class="assembly-status" role="status">{{source.run.accepted?(zh?'已确认裁片绑定':localize('Accepted cut bindings')):(zh?'裁切候选 · 尚未确认，不是完整成品':localize('Unconfirmed cut candidate · not a finished garment'))}} · {{available.run.pieces.length}} / {{source.run.pieces.length}} {{zh?'片有效':localize('valid pieces')}} · {{source.seams.length}} {{zh?'条保存接缝':localize('saved seams')}}</p><div v-if="available.missing.length||available.stale.length||missingSeams.length" class="assembly-problems" role="alert"><p v-if="available.missing.length">{{zh?'缺失裁片，三维中保留真实缺口：':localize('Missing cuts leave real gaps: ')}}{{available.missing.map(name).join('、')}}</p><p v-if="available.stale.length">{{zh?'以下裁片或绑定已变化，已隐藏；请重新裁切计算，再确认拼接：':localize('Edited cuts or stale bindings are hidden. Recompute cuts before checking assembly: ')}}{{available.stale.map(name).join('、')}}</p><p v-if="missingSeams.length">{{zh?'缺失或过期裁片影响接缝：':localize('Missing or stale cuts affect seams: ')}}{{missingSeams.map(s=>s.name).join('、')}}</p><button @click="emit('cutting')">{{zh?'返回裁切重算':localize('Recompute cuts')}}</button></div><CutAssemblyPreview :key="choice" :surface="source.surface" :run="available.run" :markings="source.markings" :language="language"/><details v-if="source.seams.length" class="assembly-seams"><summary>{{zh?'检查保存接缝':localize('Inspect saved seams')}}</summary><p v-for="seam in source.seams" :key="seam.id">{{seam.name}} · <button @click="emit('pattern',seam.a.pieceId)">{{name(seam.a.pieceId)}}</button> ↔ <button @click="emit('pattern',seam.b.pieceId)">{{name(seam.b.pieceId)}}</button> · {{zh?'预留松量':localize('Expected ease')}} {{seam.expectedEaseMm}} mm</p></details></template><div v-else-if="source" v-show="integrity!=='checking'||checking" class="assembly-integrity" role="status"><p>{{integrity==='checking'?(zh?'正在检查裁片版本…':localize('Checking saved cut geometry…')):(zh?'裁片版本与保存的模型不一致，无法预览。请重新裁切。':localize('Saved cuts no longer match their model. Recompute cuts before previewing.'))}}</p><button v-if="integrity==='stale'" @click="emit('cutting')">{{zh?'返回裁切重算':localize('Recompute cuts')}}</button></div><div v-else class="assembly-empty"><h3>{{zh?'尚无可拼接的裁片':localize('No bound cuts to assemble')}}</h3><p>{{zh?'先在裁切版型计算候选，或载入已保存的裁切版本。原始模型不会替代裁片显示。':localize('Compute a cut candidate or load a saved cut version. Only actual cut bindings are displayed.')}}</p><button @click="emit('cutting')">{{zh?'去裁切版型':localize('Go to cutting')}}</button></div></section></template>
<script setup lang="ts">
import {localize} from './localization';
import {computed,ref,watch,onBeforeUnmount} from 'vue';
import {useSession} from './store';
import {useDelayedActivity} from './modules/useDelayedActivity';
import CutAssemblyPreview from './CutAssemblyPreview.vue';
import {assemblyAvailability} from '../../../packages/surface/cut-assembly';
import {assemblyIntegrity} from '../../../packages/surface/assembly-integrity';
const props=defineProps<{language:'zh'|'en';active?:boolean}>(),emit=defineEmits<{pattern:[id?:string];cutting:[]}>(),store=useSession(),choice=ref('current'),zh=computed(()=>props.language==='zh'),project=computed(()=>store.data.project);
const saved=computed(()=>project.value?.cuttingLibrary?.find(e=>e.id===choice.value));
const currentRun=computed(()=>project.value?.surfaceRun??project.value?.cuttingLibrary?.find(e=>e.id===project.value?.activeCutId)?.run);
const source=computed(()=>saved.value?{surface:saved.value.surface,run:saved.value.run,markings:saved.value.markings,seams:saved.value.seams}:project.value?.surface&&currentRun.value?{surface:project.value.surface,run:currentRun.value,markings:project.value.previewMarkings??project.value.markings??[],seams:project.value.seams??[]}:undefined);
const integrity=ref<'checking'|'valid'|'stale'>('checking');let validation=0;
const checking=useDelayedActivity(()=>integrity.value==='checking'&&!!source.value&&props.active!==false);
watch([source,()=>props.active],async([s,active])=>{const version=++validation;integrity.value='checking';if(!s||active===false)return;try{const valid=await assemblyIntegrity(s.surface,s.run,s.markings);if(version===validation)integrity.value=valid?'valid':'stale';}catch{if(version===validation)integrity.value='stale';}},{immediate:true});
onBeforeUnmount(()=>{validation++;});
const available=computed(()=>{const s=source.value,p=project.value;if(!s||!p)return;const current=choice.value==='current'&&s.run.accepted,stale=new Set(store.data.geometry.filter(g=>g.issues.some(i=>i.messageKey==='STALE_BINDING')).map(g=>g.id));return assemblyAvailability(s.surface,s.run,current?p.pieces:s.run.pieces,current?(p.bindings??[]).filter(b=>!stale.has(b.pieceId)):s.run.bindings);});
const missingSeams=computed(()=>{const s=source.value,a=available.value;if(!s||!a)return [];const ids=new Set(a.run.pieces.map(p=>p.id));return s.seams.filter(seam=>!ids.has(seam.a.pieceId)||!ids.has(seam.b.pieceId));});
const name=(id:string)=>source.value?.run.pieces.find(p=>p.id===id)?.name??id;
</script>
<style scoped>
.assembly-page{display:flex;flex-direction:column;gap:12px;height:100%;min-width:0;min-height:0;overflow-x:hidden;overflow-y:auto;padding:18px 20px;background:var(--bg)}
.assembly-page>header{height:auto;min-height:0;padding:0;border:0;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-shrink:0}
.assembly-page>header>div{min-width:0}
h2{font-size:20px;font-weight:600;letter-spacing:-.025em;line-height:1.35;margin:0}
.assembly-page>header p,.assembly-empty p{font-size:11px;line-height:1.7;color:var(--text-muted);max-width:760px;margin:6px 0 0}
.assembly-page>header button{flex-shrink:0;border-radius:8px;font-size:12px;color:var(--accent)}
.assembly-source{display:flex;align-items:center;gap:12px;flex-shrink:0;font-size:11px;color:var(--text);margin:0}
.assembly-source select{max-width:440px;min-width:0;font-size:12px;padding:7px 9px;margin:0}
.assembly-status{flex-shrink:0;font-size:11px;line-height:1.5;color:var(--text-muted);margin:0;font-variant-numeric:tabular-nums}
.assembly-problems{flex-shrink:0;max-height:130px;overflow:auto;padding:9px 12px;background:var(--warning-soft);border:1px solid color-mix(in srgb,var(--warning) 25%,transparent);border-radius:8px;font-size:11px;color:var(--warning)}
.assembly-problems p{margin:5px 0;line-height:1.6;overflow-wrap:anywhere}
.assembly-problems button{font-size:11px;margin-top:4px}
.assembly-empty,.assembly-integrity{overflow:auto;margin:auto;max-width:560px;padding:36px 28px;border:1px solid var(--border);border-radius:12px;background:var(--panel);text-align:center}
.assembly-empty h3{font-size:17px;font-weight:600;letter-spacing:-.015em;margin:0}
.assembly-empty p{margin:10px auto 18px;max-width:48ch}
.assembly-integrity p{font-size:12px;line-height:1.7;color:var(--text-muted);margin:0 0 16px}
.assembly-seams{flex-shrink:0;max-height:120px;overflow:auto;padding:10px 14px;background:var(--panel);border:1px solid var(--border);border-radius:8px;font-size:11px}
.assembly-seams summary{cursor:pointer;font-weight:500;color:var(--text)}
.assembly-seams p{margin:8px 0;line-height:1.7}
.assembly-seams button{font-size:11px;padding:4px 7px}
.assembly-page :deep(.assembly-preview){flex:1 0 260px;min-height:260px;margin:0;border:1px solid var(--border);border-radius:12px;background:var(--panel);overflow:hidden}
.assembly-page :deep(.assembly-preview-heading){padding:9px 14px;border-bottom:1px solid var(--border)}
.assembly-page :deep(.assembly-preview-heading strong){display:none}
.assembly-page :deep(.assembly-preview-heading p){margin:0;font-size:11px;line-height:1.5}
.assembly-page :deep(.assembly-layout){min-height:0}
.assembly-page :deep(.assembly-model-pane){padding-right:0}
.assembly-page :deep(.assembly-canvas-host){min-height:140px;border:0;border-radius:0}
.assembly-page :deep(.assembly-view-controls){gap:9px;margin:0;padding:9px 12px;border-top:1px solid var(--border)}
.assembly-page :deep(.assembly-view-controls button){font-size:11px;padding:6px 9px}
.assembly-page :deep(.assembly-coverage){margin:0;padding:0 12px 9px;font-size:10px;line-height:1.6}
.assembly-page :deep(.assembly-picker){padding:12px;background:var(--panel)}
.assembly-page :deep(.assembly-piece){border-color:transparent;border-radius:8px;background:var(--panel-soft)}
.assembly-page :deep(.assembly-piece.selected){border-color:transparent;background:var(--selected)}
@media(max-width:1100px){.assembly-page{padding:16px;gap:10px}.assembly-page>header{gap:12px}.assembly-page>header p{max-width:62ch}}
@media(max-width:800px){.assembly-page{padding:12px}.assembly-page>header{flex-wrap:wrap}.assembly-source select{width:100%}.assembly-empty,.assembly-integrity{padding:24px 18px}.assembly-page :deep(.assembly-preview){flex-basis:420px;min-height:420px}}
</style>
