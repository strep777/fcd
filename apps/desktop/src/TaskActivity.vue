<template>
 <section v-if="store.working||store.taskOutcome" class="task-activity" :class="{complete:!store.working}" role="status" aria-live="polite" :aria-label="language==='zh'?'任务状态':localize('Task status')">
  <span v-if="store.working" class="task-spinner" aria-hidden="true"/><span v-else class="task-complete" aria-hidden="true">✓</span>
  <div class="task-copy"><strong>{{store.working?(store.cancelling?(language==='zh'?'正在取消任务…':localize('Cancelling task…')):(store.task?.label||(language==='zh'?'正在处理，请稍候…':localize('Working, please wait…')))):(language==='zh'?'任务已取消':localize('Task cancelled'))}}</strong><small v-if="store.working" aria-hidden="true">{{language==='zh'?'已运行':localize('Elapsed')}} {{elapsedSeconds}} {{language==='zh'?'秒':localize('seconds')}}</small><small v-if="store.taskCancelFailed" class="task-cancel-error">{{language==='zh'?'取消未成功，可再次点击取消。':localize('Cancellation failed. You can try again.')}}</small></div>
  <button v-if="store.working&&store.task?.cancellable" :disabled="store.cancelling" @click="store.cancelRun()">{{store.cancelling?(language==='zh'?'正在取消…':localize('Cancelling…')):(language==='zh'?'取消任务':localize('Cancel task'))}}</button>
  <button v-if="!store.working" :aria-label="language==='zh'?'关闭任务提示':localize('Dismiss task notice')" @click="store.taskOutcome=''">×</button>
  <div v-if="store.working" class="task-indeterminate" aria-hidden="true"/>
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
watch(()=>store.working,active=>{stopTimer();elapsedSeconds.value=0;const task=store.task;if(!active||!task)return;const update=()=>{elapsedSeconds.value=Math.max(0,Math.floor((Date.now()-task.startedAt)/1000));};update();timer=setInterval(update,1000);},{immediate:true});
onBeforeUnmount(stopTimer);
</script>

<style scoped>
.task-activity{position:fixed;right:20px;bottom:41px;z-index:1500;display:flex;align-items:center;gap:12px;max-width:min(520px,calc(100vw - 40px));min-width:min(280px,calc(100vw - 40px));padding:15px 16px 18px;border:1px solid var(--border);border-radius:var(--radius-panel);background:var(--panel);box-shadow:0 8px 32px color-mix(in srgb,var(--shadow-color) 14%,transparent);overflow:hidden}
.task-copy{min-width:0;flex:1}.task-copy strong{display:block;color:var(--text);font-size:12px;font-weight:600;line-height:1.6;overflow-wrap:anywhere}.task-copy small{display:block;margin-top:3px;color:var(--text-muted);font-size:11px;line-height:1.5;font-variant-numeric:tabular-nums}.task-copy .task-cancel-error{color:var(--danger)}.task-activity button{flex-shrink:0;min-height:30px;padding:5px 10px;font-size:11px;border-radius:var(--radius-control)}.task-spinner{width:19px;height:19px;flex-shrink:0;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:task-spin .8s linear infinite}.task-complete{display:grid;place-items:center;flex:none;width:24px;height:24px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-size:14px;font-weight:600}.task-indeterminate{position:absolute;bottom:0;left:0;right:0;height:2px;background:var(--accent-soft);overflow:hidden}.task-indeterminate:after{content:'';display:block;width:35%;height:100%;background:var(--accent);animation:task-slide 1.5s ease-in-out infinite}.task-activity.complete{padding-bottom:15px}
@keyframes task-spin{to{transform:rotate(360deg)}}@keyframes task-slide{from{transform:translateX(-100%)}to{transform:translateX(390%)}}
@media(prefers-reduced-motion:reduce){.task-spinner,.task-indeterminate:after{animation:none}.task-spinner{border-top-color:var(--accent);border-right-color:var(--accent)}}
</style>
