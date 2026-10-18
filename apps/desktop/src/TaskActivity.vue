<template>
 <section v-if="store.busy||store.taskOutcome" class="task-activity" :class="{complete:!store.busy}" role="status" aria-live="polite" :aria-label="language==='zh'?'任务状态':localize('Task status')">
  <span v-if="store.busy" class="task-spinner" aria-hidden="true"/><span v-else class="task-complete" aria-hidden="true">✓</span>
  <div class="task-copy"><strong>{{store.busy?(store.cancelling?(language==='zh'?'正在取消任务…':localize('Cancelling task…')):(store.task?.label||(language==='zh'?'正在处理，请稍候…':localize('Working, please wait…')))):(language==='zh'?'任务已取消':localize('Task cancelled'))}}</strong><small v-if="store.busy" aria-hidden="true">{{language==='zh'?'已运行':localize('Elapsed')}} {{elapsedSeconds}} {{language==='zh'?'秒':localize('seconds')}}</small><small v-if="store.taskCancelFailed" class="task-cancel-error">{{language==='zh'?'取消未成功，可再次点击取消。':localize('Cancellation failed. You can try again.')}}</small></div>
  <button v-if="store.busy&&store.task?.cancellable" :disabled="store.cancelling" @click="store.cancelRun()">{{store.cancelling?(language==='zh'?'正在取消…':localize('Cancelling…')):(language==='zh'?'取消任务':localize('Cancel task'))}}</button>
  <button v-if="!store.busy" :aria-label="language==='zh'?'关闭任务提示':localize('Dismiss task notice')" @click="store.taskOutcome=''">×</button>
  <div v-if="store.busy" class="task-indeterminate" aria-hidden="true"/>
 </section>
</template>

<script setup lang="ts">
import {onBeforeUnmount,ref,watch} from 'vue';
import {localize} from './localization';
import {useSession} from './store';
defineProps<{language:'zh'|'en'}>();
const store=useSession(),elapsedSeconds=ref(0);
let timer:ReturnType<typeof setInterval>|undefined;
function stopTimer(){if(timer!==undefined){clearInterval(timer);timer=undefined;}}
watch(()=>store.task,task=>{stopTimer();elapsedSeconds.value=0;if(!task)return;const update=()=>{elapsedSeconds.value=Math.max(0,Math.floor((Date.now()-task.startedAt)/1000));};update();timer=setInterval(update,1000);},{immediate:true});
onBeforeUnmount(stopTimer);
</script>

<style scoped>
.task-activity{position:fixed;right:18px;bottom:40px;z-index:1500;display:flex;align-items:center;gap:11px;max-width:min(560px,calc(100vw - 36px));min-width:240px;padding:12px 14px 15px;border:1px solid var(--border);border-radius:8px;background:var(--panel);box-shadow:0 6px 28px color-mix(in srgb,var(--shadow-color) 18%,transparent);overflow:hidden}
.task-copy{min-width:0;flex:1}.task-copy strong{display:block;font-size:12px;line-height:1.6;overflow-wrap:anywhere}.task-copy small{display:block;font-size:10px;color:var(--text-muted);font-variant-numeric:tabular-nums}.task-activity button{flex-shrink:0;font-size:11px;padding:6px 9px}.task-spinner{width:20px;height:20px;flex-shrink:0;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:task-spin .8s linear infinite}.task-complete{color:var(--studio-teal);font-size:18px}.task-indeterminate{position:absolute;bottom:0;left:0;right:0;height:3px;background:var(--accent-soft);overflow:hidden}.task-indeterminate:after{content:'';display:block;width:35%;height:100%;background:var(--accent);animation:task-slide 1.5s ease-in-out infinite}.task-activity.complete{padding-bottom:12px}
@keyframes task-spin{to{transform:rotate(360deg)}}@keyframes task-slide{from{transform:translateX(-100%)}to{transform:translateX(390%)}}
@media(prefers-reduced-motion:reduce){.task-spinner,.task-indeterminate:after{animation:none}.task-spinner{border-top-color:var(--accent);border-right-color:var(--accent)}}
</style>
