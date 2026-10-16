<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {useSession} from './store';
import {useModelEdit,type ModelSelectionMode} from './modules/modelEditContext';
import {vDecimal} from './modules/decimal-input';

const props=defineProps<{language:'zh'|'en'}>(),store=useSession(),edit=useModelEdit(),zh=computed(()=>props.language==='zh');
const surface=computed(()=>store.data.project?.surface),axes=['x','y','z'] as const;
const translationMm=ref({x:0,y:0,z:0}),rotationDeg=ref({x:0,y:0,z:0}),scale=ref({x:1,y:1,z:1}),notice=ref('');
const regions=computed(()=>[...new Set(surface.value?.faces.map(f=>f.region).filter((r):r is string=>!!r)??[])].sort());
const selectedCount=computed(()=>edit.selectionMode==='object'?(surface.value?.vertices.length??0):edit.selectionMode==='vertex'?edit.selectedVertexIds.length:edit.selectedRegions.length);
const valid=computed(()=>!!selectedCount.value&&axes.every(axis=>Number.isFinite(translationMm.value[axis])&&Number.isFinite(rotationDeg.value[axis])&&Number.isFinite(scale.value[axis])&&scale.value[axis]>0&&scale.value[axis]<=1000));
function resetDraft(){translationMm.value={x:0,y:0,z:0};rotationDeg.value={x:0,y:0,z:0};scale.value={x:1,y:1,z:1};notice.value='';}
watch(()=>surface.value?.id,resetDraft);
async function apply(){
 const p=store.data.project;if(!p||!surface.value||store.busy||!valid.value)return;
 const selection=edit.selectionMode==='vertex'?{vertexIds:[...edit.selectedVertexIds]}:edit.selectionMode==='region'?{regions:[...edit.selectedRegions]}:{};
 if(await store.run(()=>window.fpcad.apply(p.id,p.revision,{type:'surface.transform',...selection,translationMm:{...translationMm.value},rotationDeg:{...rotationDeg.value},scale:{...scale.value}}))){resetDraft();notice.value=zh.value?'模型变换已保存，可撤销；请检查贴附花纹并重新裁切。':'Model transform saved and undoable. Review attached markings and recompute cuts.';}
}
</script>
<template><section v-if="surface" class="model-edit-controls" aria-label="Model editing controls">
 <h3>{{zh?'模型编辑':'Model editing'}}</h3>
 <label>{{zh?'选择层级':'Selection mode'}}<select :value="edit.selectionMode" aria-label="Model selection mode" :disabled="store.busy" @change="edit.changeSelectionMode(($event.target as HTMLSelectElement).value as ModelSelectionMode)"><option value="object">{{zh?'对象（整个模型）':'Object (whole model)'}}</option><option value="region">{{zh?'部位':'Region'}}</option><option value="vertex">{{zh?'顶点':'Vertex'}}</option></select></label>
 <div class="model-tools" role="group" :aria-label="zh?'模型工具':'Model tools'"><button v-for="item in (['select','move','rotate','scale'] as const)" :key="item" :aria-label="'Model tool '+item" :aria-pressed="edit.tool===item" :class="{active:edit.tool===item}" :disabled="store.busy" @click="edit.tool=item">{{zh?({select:'选择',move:'移动',rotate:'旋转',scale:'缩放'}[item]):item}}</button></div>
 <label>{{zh?'拖动轴约束':'Drag axis'}}<select v-model="edit.axis" aria-label="Model transform axis" :disabled="store.busy"><option value="free">{{zh?'自由':'Free'}}</option><option v-for="axis in axes" :key="axis" :value="axis">{{axis.toUpperCase()}}</option></select></label>
 <details v-if="edit.selectionMode==='region'"><summary>{{zh?'部位列表':'Regions'}} · {{edit.selectedRegions.length}}</summary><p v-if="!regions.length">{{zh?'模型没有命名部位，可选择整个对象或顶点。':'This model has no named regions; select the object or vertices.'}}</p><label v-for="region in regions" :key="region" class="region-choice"><input type="checkbox" :checked="edit.selectedRegions.includes(region)" :disabled="store.busy" @change="edit.selectRegion(region,true)">{{region}}</label></details>
 <p class="selection-status" role="status">{{edit.selectionMode==='object'?(zh?'整个对象已选中':'Whole object selected'):(zh?'已选中 ':'Selected ')+selectedCount+(edit.selectionMode==='vertex'?(zh?' 个顶点':' vertices'):(zh?' 个部位':' regions'))}}</p>
 <button v-if="edit.selectionMode!=='object'" :disabled="store.busy||!selectedCount" @click="edit.clearSelection">{{zh?'清空选择':'Clear selection'}}</button>
 <p class="model-edit-help">{{zh?'左键选择或拖动当前工具；Shift 点击追加或移除选择。中键旋转视图，Shift＋中键平移。':'Left-click selects or drags with the active tool; Shift-click adds or removes selection. Middle drag orbits; Shift + middle drag pans.'}}</p>
 <details open><summary>{{zh?'数值变换（选区中心）':'Numeric transform (selection centre)'}}</summary><div class="transform-grid"><span></span><strong v-for="axis in axes" :key="axis">{{axis.toUpperCase()}}</strong><span>{{zh?'移动 mm':'Move mm'}}</span><input v-for="axis in axes" :key="'move'+axis" v-model.number="translationMm[axis]" v-decimal :aria-label="'Model translation '+axis+' mm'" type="number" step="1" :disabled="store.busy"><span>{{zh?'旋转 °':'Rotate °'}}</span><input v-for="axis in axes" :key="'rotate'+axis" v-model.number="rotationDeg[axis]" v-decimal :aria-label="'Model rotation '+axis+' degrees'" type="number" step="1" :disabled="store.busy"><span>{{zh?'缩放倍率':'Scale'}}</span><input v-for="axis in axes" :key="'scale'+axis" v-model.number="scale[axis]" v-decimal :aria-label="'Model scale '+axis" type="number" min=".001" max="1000" step=".01" :disabled="store.busy"></div><small v-if="!valid" role="alert">{{zh?'请选择部位或顶点，输入有限数值与正数缩放倍率。':'Select regions or vertices and enter finite values with positive scale factors.'}}</small><button class="primary" :disabled="store.busy||!valid" @click="apply">{{zh?'应用模型变换（可撤销）':'Apply model transform (undoable)'}}</button><button :disabled="store.busy" @click="resetDraft">{{zh?'重置变换参数':'Reset transform values'}}</button></details>
 <p class="model-edit-help">{{zh?'整体变换保留随模型贴附的花纹；局部编辑会使旧花纹投影失效，需重新贴附并展开。旋转按 X → Y → Z 顺序应用。':'Whole-object transforms keep attached markings with the mesh. Local edits invalidate previous projected markings; reattach them and recompute cuts. Rotations apply in X → Y → Z order.'}}</p><p v-if="notice" role="status">{{notice}}</p>
</section></template>
<style scoped>.model-edit-controls{padding:12px 0;border-top:1px solid var(--border)}.model-edit-controls h3{font-size:13px;margin:0 0 10px}.model-edit-controls label{display:block;margin:8px 0}.model-tools{display:flex;flex-wrap:wrap;gap:5px;margin:10px 0}.model-tools button{flex:1}.model-tools .active{border-color:var(--accent);background:var(--accent-soft)}.transform-grid{display:grid;grid-template-columns:68px repeat(3,minmax(0,1fr));align-items:center;gap:6px;margin:10px 0}.transform-grid input{width:100%;min-width:0}.transform-grid strong{text-align:center}.transform-grid span,.model-edit-help{font-size:11px;line-height:1.6}.selection-status{font-size:12px}.region-choice{overflow-wrap:anywhere}</style>
