<script setup lang="ts">
import {localize} from './localization';

import {computed,ref} from 'vue';
const props=defineProps<{language:'zh'|'en';busy:boolean;scale:number;notice:string}>();
const emit=defineEmits<{import:[];template:[];'update:scale':[value:number]}>();
const dialog=ref<HTMLDialogElement>(),zh=computed(()=>props.language==='zh');
const validScale=computed(()=>Number.isFinite(props.scale)&&props.scale>0&&props.scale<=10000);
function open(){if(!props.busy&&!dialog.value?.open)dialog.value?.showModal();}
function close(){if(!props.busy)dialog.value?.close();}
defineExpose({open,close});
</script>
<template>
 <Teleport to="body">
  <dialog ref="dialog" class="modal model-source-dialog" :aria-label="zh?'创建 / 导入模型':localize('Create / import model')" @keydown.stop @cancel="busy&&$event.preventDefault()" @click.self="close">
   <button class="modal-close" :disabled="busy" :aria-label="zh?'关闭模型选择':localize('Close model choices')" @click="close">×</button>
   <h2>{{zh?'创建 / 导入模型':localize('Create / import model')}}</h2>
   <p>{{zh?'选择模型来源。导入或生成成功后，模型会自动保存到当前项目的模型库。':localize('Choose a model source. Imported or generated models are automatically saved in this project’s model library.')}}</p>
   <label>{{zh?'导入比例（OBJ 每单位 mm；GLB 额外倍率）':localize('Import scale (OBJ mm per unit; GLB extra multiplier)')}}<input :value="scale" :disabled="busy" type="number" min=".00001" max="10000" step=".1" @input="emit('update:scale',Number(($event.target as HTMLInputElement).value))"></label>
   <p>{{zh?'OBJ 坐标为 mm 时填 1，为 cm 时填 10。GLB 自动从米转换为 mm，通常填 1。':localize('For OBJ use 1 for mm coordinates or 10 for cm. GLB metres convert to mm automatically; normally use 1.')}}</p>
   <p v-if="!validScale" role="alert">{{zh?'请输入大于 0 且不超过 10000 的有效比例。':localize('Enter a valid scale greater than 0 and up to 10000.')}}</p>
   <p v-if="notice" class="source-notice" role="status">{{notice}}</p>
   <div class="source-choices">
    <button class="primary" :disabled="busy||!validScale" @click="emit('import')">{{busy?(zh?'正在导入…':localize('Importing…')):(zh?'导入 OBJ / GLB 文件':localize('Import OBJ / GLB file'))}}</button>
    <button :disabled="busy" @click="emit('template')">{{zh?'使用内置物种模板':localize('Use built-in species template')}}</button>
    <button :disabled="busy" @click="close">{{zh?'取消':localize('Cancel')}}</button>
   </div>
  </dialog>
 </Teleport>
</template>
<style scoped>
.model-source-dialog{color:var(--text);margin:auto}.model-source-dialog::backdrop{background:color-mix(in srgb,var(--studio-deep) 62%,transparent);backdrop-filter:blur(5px)}.model-source-dialog h2{font-size:22px}.source-choices{display:flex;flex-direction:column;gap:12px;margin-top:20px}.source-notice{color:var(--warning)}.model-source-dialog input{max-width:100%}
</style>
