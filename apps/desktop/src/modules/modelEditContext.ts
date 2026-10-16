import {defineStore} from 'pinia';
import {ref,watch} from 'vue';
import {useSession} from '../store';

export type ModelSelectionMode='object'|'region'|'vertex';
export type ModelEditTool='select'|'move'|'rotate'|'scale';
export type ModelEditAxis='free'|'x'|'y'|'z';

/** Model controls and the viewport share selection, while transform drafts stay local. */
export const useModelEdit=defineStore('model-edit',()=>{
 const session=useSession();
 const selectionMode=ref<ModelSelectionMode>('object'),tool=ref<ModelEditTool>('select'),axis=ref<ModelEditAxis>('free');
 const selectedVertexIds=ref<string[]>([]),selectedRegions=ref<string[]>([]);
 function clearSelection(){selectedVertexIds.value=[];selectedRegions.value=[];}
 function changeSelectionMode(mode:ModelSelectionMode){if(selectionMode.value!==mode){selectionMode.value=mode;clearSelection();}}
 function selectVertex(id:string,additive=false){changeSelectionMode('vertex');selectedRegions.value=[];selectedVertexIds.value=additive?(selectedVertexIds.value.includes(id)?selectedVertexIds.value.filter(v=>v!==id):[...selectedVertexIds.value,id]):[id];}
 function selectRegion(region:string,additive=false){changeSelectionMode('region');selectedVertexIds.value=[];selectedRegions.value=additive?(selectedRegions.value.includes(region)?selectedRegions.value.filter(v=>v!==region):[...selectedRegions.value,region]):[region];}
 watch(()=>session.data.project?.surface?.id,()=>{clearSelection();tool.value='select';});
 return {selectionMode,tool,axis,selectedVertexIds,selectedRegions,clearSelection,changeSelectionMode,selectVertex,selectRegion};
});
