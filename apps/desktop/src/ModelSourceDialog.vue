<template>
 <Teleport to="body">
  <dialog ref="dialog" class="modal model-source-dialog" tabindex="-1" :aria-label="zh?'创建 / 导入模型':localize('Create / import model')" @close="closed" @cancel="busy&&$event.preventDefault()" @click.self="close">
   <button class="modal-close" :disabled="busy" :aria-label="zh?'关闭模型选择':localize('Close model choices')" @click="close">×</button>
   <h2>{{zh?'创建 / 导入模型':localize('Create / import model')}}</h2>
   <p>{{zh?'选择模型来源。导入或生成成功后，模型会自动保存到当前项目的模型库。':localize('Choose a model source. Imported or generated models are automatically saved in this project’s model library.')}}</p>
   <label>{{zh?'导入比例（OBJ 每单位 mm；GLB 额外倍率）':localize('Import scale (OBJ mm per unit; GLB extra multiplier)')}}<input :value="scale" :disabled="busy" type="number" min=".00001" max="10000" step=".1" @input="emit('update:scale',Number(($event.target as HTMLInputElement).value))"></label>
   <p>{{zh?'OBJ 坐标为 mm 时填 1，为 cm 时填 10。GLB 自动从米转换为 mm，通常填 1。':localize('For OBJ use 1 for mm coordinates or 10 for cm. GLB metres convert to mm automatically; normally use 1.')}}</p>
   <p v-if="!validScale" role="alert">{{zh?'请输入大于 0 且不超过 10000 的有效比例。':localize('Enter a valid scale greater than 0 and up to 10000.')}}</p>
   <p v-if="notice" class="source-notice" role="status">{{notice}}</p>
   <div class="source-choices">
    <button class="primary" :disabled="busy||!validScale" @click="emit('import')">{{working?(zh?'正在导入…':localize('Importing…')):(zh?'导入 OBJ / GLB 文件':localize('Import OBJ / GLB file'))}}</button>
    <button :disabled="busy" @click="emit('template')">{{zh?'使用内置物种模板':localize('Use built-in species template')}}</button>
    <button :disabled="busy" @click="close">{{zh?'取消':localize('Cancel')}}</button>
   </div>
  </dialog>
 </Teleport>
</template>

<script setup lang="ts">
import {localize} from './localization';

import {computed,onBeforeUnmount,useTemplateRef,watch} from 'vue';
const props=defineProps<{language:'zh'|'en';busy:boolean;working?:boolean;scale:number;notice:string}>();
const emit=defineEmits<{import:[];template:[];'update:scale':[value:number]}>();
const dialog=useTemplateRef<HTMLDialogElement>('dialog'),zh=computed(()=>props.language==='zh');
const validScale=computed(()=>Number.isFinite(props.scale)&&props.scale>0&&props.scale<=10000);
let returnFocus:HTMLElement|undefined;
function focusable(){return Array.from(dialog.value?.querySelectorAll<HTMLElement>('button,input:not([type="hidden"]),select,textarea,a[href],[tabindex]')??[]).filter(element=>!element.matches(':disabled')&&element.tabIndex>=0&&element.getClientRects().length);}
function open(){const element=dialog.value;if(props.busy||!element||element.open)return;returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;document.addEventListener('keydown',keydown,true);element.showModal();(focusable()[0]??element).focus({preventScroll:true});}
function closed(){if(dialog.value?.open)return;document.removeEventListener('keydown',keydown,true);if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=undefined;}
function close(){if(!props.busy&&dialog.value?.open){dialog.value.close();closed();}}
function keydown(event:KeyboardEvent){const element=dialog.value;if(!element?.open)return;event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();}else if(event.key==='Tab'){event.preventDefault();const controls=focusable(),index=controls.indexOf(document.activeElement as HTMLElement),next=event.shiftKey?(index<=0?controls.length-1:index-1):(index<0||index===controls.length-1?0:index+1);(controls[next]??element).focus({preventScroll:true});}}
watch(()=>props.busy,busy=>{if(!busy&&dialog.value?.open){const controls=focusable();if(!controls.includes(document.activeElement as HTMLElement))(controls[0]??dialog.value).focus({preventScroll:true});}},{flush:'post'});
onBeforeUnmount(()=>document.removeEventListener('keydown',keydown,true));
defineExpose({open,close});
</script>

<style scoped>
.model-source-dialog{width:min(460px,calc(100vw - 40px));max-height:calc(100dvh - 48px);margin:auto;padding:28px;border:1px solid var(--border);border-radius:var(--radius-panel);background:var(--panel);color:var(--text);box-shadow:0 20px 70px color-mix(in srgb,var(--shadow-color) 20%,transparent)}.model-source-dialog::backdrop{background:color-mix(in srgb,var(--shadow-color) 28%,transparent);backdrop-filter:blur(5px)}.model-source-dialog h2{margin:4px 28px 12px 0;color:var(--text);font-size:22px;font-weight:650;line-height:1.35;letter-spacing:-.4px}.model-source-dialog p{margin:12px 0 20px;color:var(--text-muted);font-size:12px;line-height:1.7}.model-source-dialog>label{display:grid;gap:8px;margin-top:24px;color:var(--text-muted);font-size:12px;line-height:1.6}.model-source-dialog input{width:100%;max-width:100%;margin:0;padding:9px 10px;font-variant-numeric:tabular-nums}.model-source-dialog .modal-close{display:grid;place-items:center;top:14px;right:14px;width:28px;height:28px;min-height:28px;padding:0;border-radius:50%;background:var(--panel-soft);color:var(--text-muted);font-size:18px;line-height:1}.source-choices{display:flex;flex-direction:column;gap:10px;margin-top:24px}.source-choices button{min-height:38px;padding:9px 14px;border-radius:var(--radius-control);font-size:12px;line-height:1.5;white-space:normal}.source-choices button:last-child{align-self:center;min-width:100px;margin-top:2px;padding:7px 14px;border-color:transparent;background:transparent;color:var(--text-muted)}.model-source-dialog .source-notice{padding:10px 12px;border:1px solid color-mix(in srgb,var(--warning) 24%,var(--border));border-radius:var(--radius-control);background:var(--warning-soft);color:var(--warning)}.model-source-dialog p[role=alert]{color:var(--danger)}
@media(max-width:600px){.model-source-dialog{padding:24px}.model-source-dialog h2{font-size:20px}}
@media(prefers-reduced-transparency:reduce){.model-source-dialog::backdrop{backdrop-filter:none}}
</style>
