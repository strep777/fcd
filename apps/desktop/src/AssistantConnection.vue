<template>
 <div class="assistant-connection" :class="{compact}">
  <InlineActivity v-if="working" :label="zh?'正在更新助手连接…':localize('Updating the assistant connection…')"/>
  <label class="connection-toggle"><input type="checkbox" :checked="!!connection?.enabled" :disabled="busy" @change="toggle"><span>{{zh?'允许 AI 助手连接':localize('Allow local AI assistant')}}</span></label>
  <span class="connection-state" :class="{connected:connection?.connected}">{{connection?.connected?(zh?'本机助手已连接':localize('Local assistant connected')):connection?.enabled?(zh?'等待本机助手连接':localize('Waiting for local assistant')):(zh?'AI 助手未连接':localize('AI assistant disconnected'))}}</span>
  <button v-if="connection?.enabled" :aria-expanded="expanded" :aria-controls="settingsId" @click="expanded=!expanded">{{zh?'连接设置':localize('Connection settings')}}</button>
  <span v-if="error" class="connection-error" role="alert">{{error}}</span>
  <div v-if="expanded&&connection?.enabled" :id="settingsId" class="assistant-settings" role="region" :aria-label="zh?'连接设置':localize('Connection settings')">
   <div class="connection-settings-heading"><strong>{{zh?'连接设置':localize('Connection settings')}}</strong><button :aria-label="zh?'关闭连接设置':localize('Close connection settings')" @click="expanded=false">×</button></div>
   <label>{{zh?'本机接口':localize('Local endpoint')}}<input :value="connection.endpoint+'/v1/request'" readonly :aria-label="zh?'本机助手接口':localize('Assistant endpoint')"></label>
   <div class="connection-token-field"><label :for="settingsId+'-token'">{{zh?'访问令牌（本次启动有效）':localize('Access token (this session)')}}</label><div class="connection-token"><input :id="settingsId+'-token'" :type="revealed?'text':'password'" :value="connection.token" readonly :aria-label="zh?'本机助手令牌':localize('Assistant token')"><button :aria-pressed="revealed" @click="revealed=!revealed">{{revealed?(zh?'隐藏':localize('Hide')):(zh?'显示':localize('Reveal'))}}</button></div></div>
   <small>{{zh?'将地址和令牌填入本机助手。使用 Bearer 认证；接口支持查看项目和修改花纹、裁剪线、裁片及制作节点。关闭开关即停止连接。':localize('Use Bearer authentication in your local assistant. Read the project and edit markings, cuts, patterns and workflow nodes. Turning off the switch closes the connection.')}}</small>
  </div>
 </div>
</template>

<script setup lang="ts">
import {localize} from './localization';
import InlineActivity from './InlineActivity.vue';
import {useDelayedActivity} from './modules/useDelayedActivity';

import {ref,computed,onMounted,onBeforeUnmount,useId} from 'vue';
import type {AssistantConnection} from '../../../packages/schema/index';
const props=defineProps<{language:'zh'|'en';compact?:boolean}>(),zh=computed(()=>props.language==='zh'),connection=ref<AssistantConnection>(),busy=ref(false),error=ref(''),expanded=ref(false),revealed=ref(false),settingsId=useId();let timer:ReturnType<typeof setInterval>,disposed=false,statusGeneration=0,statusPending=false;
const working=useDelayedActivity(()=>busy.value);
async function refresh(){if(disposed||busy.value||statusPending)return;const own=++statusGeneration;statusPending=true;try{const r=await window.fpcad.assistant('status');if(!disposed&&!busy.value&&own===statusGeneration&&r.ok)connection.value=r.connection;}catch{/* A failed background status read retains the last known connection. */}finally{if(own===statusGeneration)statusPending=false;}}
async function toggle(){if(disposed||busy.value)return;statusGeneration++;statusPending=false;busy.value=true;error.value='';try{const r=await window.fpcad.assistant(connection.value?.enabled?'disable':'enable');if(disposed)return;if(r.ok){connection.value=r.connection;expanded.value=r.connection.enabled;revealed.value=false;}else error.value=r.error.code;}catch{if(!disposed)error.value='ASSISTANT_CONNECTION_FAILED';}finally{if(!disposed)busy.value=false;}}
onMounted(()=>{void refresh();timer=setInterval(()=>void refresh(),3000);});onBeforeUnmount(()=>{disposed=true;statusGeneration++;statusPending=false;clearInterval(timer);});
</script>

<style scoped>
.assistant-connection{position:relative;display:flex;align-items:center;flex-wrap:wrap;gap:12px 16px;min-width:0;padding:18px;border:1px solid var(--border);border-radius:var(--radius-panel);background:var(--panel);font-size:12px;line-height:1.5}
.connection-toggle{display:flex;align-items:flex-start;gap:8px;margin:0;color:var(--text);font-weight:500}.connection-toggle span{float:none;color:inherit;overflow-wrap:anywhere}.connection-toggle input[type=checkbox]{flex:none;width:15px;height:15px;margin:2px 0 0}
.connection-state{display:flex;align-items:center;gap:6px;color:var(--text-muted);font-size:11px;overflow-wrap:anywhere}.connection-state:before{content:'';flex:none;width:6px;height:6px;border-radius:50%;background:var(--text-muted);opacity:.6}.connection-state.connected:before{background:var(--accent);opacity:1}
.assistant-connection button{min-height:30px;padding:5px 9px;font-size:11px;border-radius:var(--radius-control)}.connection-error{color:var(--danger);overflow-wrap:anywhere}
.assistant-settings{display:grid;gap:16px;width:100%;min-width:0;margin-top:2px;padding-top:16px;border-top:1px solid var(--border)}.assistant-settings label,.connection-token-field{display:grid;gap:6px;min-width:0;margin:0;font-size:12px;line-height:1.5}.assistant-settings input{width:100%;min-width:0;margin:0;padding:8px 10px;font-size:12px;font-variant-numeric:tabular-nums}.assistant-settings small{display:block;color:var(--text-muted);font-size:11px;line-height:1.7}.connection-token{display:flex;gap:8px;min-width:0}.connection-token input{flex:1}.connection-token button{flex:none}.connection-settings-heading{display:none}
.assistant-connection.compact{display:flex;align-items:stretch;flex-direction:column;gap:7px;padding:12px 4px 2px;border:0;border-top:1px solid var(--border);border-radius:0;background:transparent}.compact .connection-toggle{font-size:11px;line-height:1.6}.compact .connection-state{align-items:flex-start;font-size:10px;line-height:1.5}.compact .connection-state:before{margin-top:4px}.compact>button{align-self:flex-start;max-width:100%;min-height:28px;padding:4px 8px;white-space:normal;text-align:left}
.compact .assistant-settings{position:fixed;left:184px;bottom:38px;z-index:19;width:min(420px,calc(100vw - 200px));max-height:calc(100dvh - 76px);overflow:auto;margin:0;padding:20px;border:1px solid var(--border);border-radius:var(--radius-panel);background:var(--panel);box-shadow:0 10px 40px color-mix(in srgb,var(--shadow-color) 18%,transparent)}.compact .connection-settings-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--text);font-size:13px}.connection-settings-heading button{width:28px;min-height:28px;padding:0;font-size:18px;color:var(--text-muted);background:var(--panel-soft)}
@media(max-width:1250px){.compact .assistant-settings{left:160px;width:min(420px,calc(100vw - 176px))}}
@media(max-width:1000px){.assistant-connection.compact{flex:none;flex-direction:row;align-items:center;gap:8px;padding:0 4px 0 10px;margin-left:4px;border-top:0;border-left:1px solid var(--border)}.compact .connection-toggle{max-width:155px;line-height:1.25}.compact .connection-state{display:none}.compact>button{align-self:center;white-space:nowrap}.compact .assistant-settings{left:16px;bottom:40px;width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 80px)}}
@media(prefers-contrast:more){.compact .assistant-settings{border-color:var(--text-muted)}}
</style>
