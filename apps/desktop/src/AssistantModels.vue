<script setup lang="ts">
import {computed,nextTick,ref} from 'vue';
import {localize} from './localization';
import {providerKinds,providerPresets,type ProviderKind,type AssistantConfig} from '../../../packages/schema/assistant-config';
const props=defineProps<{config:AssistantConfig;language:'zh'|'en'}>();
const emit=defineEmits<{models:[id:string]}>();
const zh=computed(()=>props.language==='zh');
const text=(cn:string,en:string)=>zh.value?cn:localize(en);
const newModel=ref(''),newProvider=ref(''),editingId=ref(''),connectionsOpen=ref(false),error=ref('');
const additions=ref<Record<string,string>>({});
const connectionSection=ref<HTMLElement>();
const catalog=computed(()=>[...new Set(props.config.providers.flatMap(p=>p.models))].map(id=>({id,providers:props.config.providers.filter(p=>p.models.includes(id))})));
const editor=computed(()=>props.config.providers.find(p=>p.id===editingId.value)??props.config.providers[0]);
const selectedPair=computed({get:()=>props.config.selectedProvider&&props.config.selectedModel?JSON.stringify([props.config.selectedProvider,props.config.selectedModel]):'',set:(value:string)=>{const [provider,model]=value?JSON.parse(value):[];props.config.selectedProvider=provider;props.config.selectedModel=model;}});
const available=(model:string)=>props.config.providers.filter(p=>!p.models.includes(model));
const addition=(model:string)=>available(model).find(p=>p.id===additions.value[model])?.id??available(model)[0]?.id;
function clearDefault(provider:string,model?:string){if(props.config.selectedProvider===provider&&(!model||props.config.selectedModel===model)){delete props.config.selectedProvider;delete props.config.selectedModel;}}
function attach(model:string,provider:string){const p=props.config.providers.find(p=>p.id===provider);if(!p)return false;if(!model.trim()||model.trim().length>120){error.value=text('模型标识需要 1–120 个字符。','Model IDs must contain 1–120 characters.');return false;}if(p.models.length>=200&&!p.models.includes(model)){error.value=text('此连接已达到 200 个模型上限。','This connection already has 200 models.');return false;}if(!p.models.includes(model))p.models.push(model);error.value='';return true;}
function addModel(){if(attach(newModel.value.trim(),newProvider.value||props.config.providers[0]?.id)){newModel.value='';}}
function unlink(model:string,provider:string){const p=props.config.providers.find(p=>p.id===provider);if(p)p.models=p.models.filter(id=>id!==model);clearDefault(provider,model);}
function removeModel(model:string){for(const p of props.config.providers)unlink(model,p.id);}
async function openConnection(id:string){editingId.value=id;connectionsOpen.value=true;await nextTick();connectionSection.value?.scrollIntoView({block:'nearest'});}
function createConnection(model?:string){if(props.config.providers.length>=30){error.value=text('最多保存 30 个提供商连接。','You can save up to 30 provider connections.');return;}const id=crypto.randomUUID();props.config.providers.push({id,name:text('自定义服务','Custom provider'),kind:'openai-compatible',baseUrl:providerPresets['openai-compatible'].baseUrl,models:model?[model]:[],enabled:true});newProvider.value=id;openConnection(id);}
function removeConnection(id:string){props.config.providers=props.config.providers.filter(p=>p.id!==id);clearDefault(id);if(newProvider.value===id)newProvider.value='';}
function changeKind(p:AssistantConfig['providers'][number],kind:ProviderKind){const preset=providerPresets[kind];Object.assign(p,{kind,name:preset.name,baseUrl:preset.baseUrl,models:[],apiKey:'',hasKey:false,allowHttp:false});clearDefault(p.id);}
</script>
<template>
 <div class="assistant-models">
  <label>{{text('默认模型连接','Default model connection')}}<select v-model="selectedPair" :aria-label="text('默认模型连接','Default model connection')"><option value="">—</option><template v-for="p in config.providers.filter(p=>p.enabled)" :key="p.id"><option v-for="model in p.models" :key="model" :value="JSON.stringify([p.id,model])">{{model}} · {{p.name}}</option></template></select></label>
  <p>{{text('在每个模型中管理提供商连接。同一模型可使用多个服务，地址和密钥由连接统一保存。','Manage provider connections on each model. A model can use multiple services; each connection shares its address and key.')}}</p>
  <div class="add-model">
   <label>{{text('模型标识','Model ID')}}<input v-model="newModel" :aria-label="text('新增模型标识','New model ID')" maxlength="120" @keydown.enter.prevent="addModel"></label>
   <label>{{text('提供商连接','Provider connection')}}<select :value="newProvider||config.providers[0]?.id" :aria-label="text('新增模型的提供商','Provider for new model')" @change="newProvider=($event.target as HTMLSelectElement).value"><option v-for="p in config.providers" :key="p.id" :value="p.id">{{p.name}}</option></select></label>
   <button :disabled="!newModel.trim()||!config.providers.length" @click="addModel">{{text('添加模型','Add model')}}</button>
   <button @click="createConnection()">{{text('新建提供商连接','New provider connection')}}</button>
  </div>
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <p v-if="!catalog.length" class="empty-models">{{text('尚未添加模型。填写模型标识，或在下方连接服务并获取模型。','No models yet. Enter a model ID or connect a service below to fetch models.')}}</p>
  <article v-for="model in catalog" :key="model.id" class="model-card">
   <header><h3>{{model.id}}</h3><button @click="removeModel(model.id)">{{text('删除模型','Delete model')}}</button></header>
   <div v-for="p in model.providers" :key="p.id" class="model-provider"><strong>{{p.name}}</strong><small v-if="!p.enabled">{{text('未启用','Disabled')}}</small><button :disabled="!p.enabled" @click="selectedPair=JSON.stringify([p.id,model.id])">{{config.selectedProvider===p.id&&config.selectedModel===model.id?text('当前默认','Current default'):text('设为默认','Set as default')}}</button><button @click="openConnection(p.id)">{{text('编辑连接','Edit connection')}}</button><button @click="unlink(model.id,p.id)">{{text('移除此连接','Remove this connection')}}</button></div>
   <div class="model-connections"><label>{{text('添加提供商连接','Add provider connection')}}<select :value="addition(model.id)" :aria-label="text('添加提供商连接','Add provider connection')" @change="additions[model.id]=($event.target as HTMLSelectElement).value"><option v-for="p in available(model.id)" :key="p.id" :value="p.id">{{p.name}}</option></select></label><button :disabled="!available(model.id).length" @click="attach(model.id,addition(model.id));delete additions[model.id]">{{text('添加连接','Add connection')}}</button><button @click="createConnection(model.id)">{{text('新建提供商连接','New provider connection')}}</button></div>
  </article>
  <details ref="connectionSection" :open="connectionsOpen||!catalog.length" class="connection-settings" @toggle="connectionsOpen=($event.target as HTMLDetailsElement).open">
   <summary>{{text('提供商连接设置','Provider connection settings')}}</summary>
   <label>{{text('编辑提供商连接','Edit provider connection')}}<select :value="editor?.id" :aria-label="text('编辑提供商连接','Edit provider connection')" @change="editingId=($event.target as HTMLSelectElement).value"><option v-for="p in config.providers" :key="p.id" :value="p.id">{{p.name}} · {{p.models.length}}</option></select></label>
   <div v-if="editor" class="provider-grid"><article class="provider-card">
    <div class="row"><label><input v-model="editor.enabled" type="checkbox" @change="!editor.enabled&&clearDefault(editor.id)">{{text('启用','Enabled')}}</label><strong>{{editor.name}}</strong><button @click="removeConnection(editor.id)">{{text('删除连接','Delete connection')}}</button></div>
    <label>{{text('提供商类型','Provider type')}}<select :value="editor.kind??'openai-compatible'" @change="changeKind(editor,($event.target as HTMLSelectElement).value as ProviderKind)"><option v-for="kind in providerKinds" :key="kind" :value="kind">{{kind==='openai-compatible'?text('OpenAI 兼容服务','OpenAI compatible'):providerPresets[kind].name}}</option></select></label>
    <label>{{text('显示名称','Display name')}}<input v-model="editor.name" :aria-label="text('提供商名称','Provider name')"></label>
    <label>{{text(editor.kind==='ollama'?'Ollama 服务地址（不加 /v1）':'接口基础地址','API base URL')}}<input v-model="editor.baseUrl" type="url" :placeholder="providerPresets[editor.kind??'openai-compatible'].baseUrl"></label>
    <label>{{text('接口密钥','API key')}}<input v-model="editor.apiKey" type="password" autocomplete="off" :placeholder="editor.hasKey?text('已保存；不编辑则保留','Saved; unchanged unless edited'):providerPresets[editor.kind??'openai-compatible'].keyRequired?text('填写此提供商的密钥','Provider API key'):text('本地服务可留空','Optional for local servers')"></label>
    <label v-if="/^http:/i.test(editor.baseUrl)" class="http-option"><input v-model="editor.allowHttp" type="checkbox">{{text('允许 HTTP 连接（适用于自建服务）','Allow HTTP for this server')}}</label>
    <p v-if="editor.kind==='volcengine'||editor.kind==='volcengine-coding'">{{text('请在上方添加控制台提供的模型或推理接入点标识。','Add the model or endpoint ID from the provider console above.')}}</p><button v-else :disabled="!editor.enabled" @click="emit('models',editor.id)">{{text('连接并获取模型','Connect and fetch models')}}</button>
    <small>{{text('此连接的修改会应用于使用它的所有模型。修改类型会清除模型列表；修改类型或地址后请重新输入密钥。','Connection changes apply to all its models. Changing its type clears its model list; re-enter the key after changing type or address.')}}</small>
   </article></div>
  </details>
 </div>
</template>
<style scoped>
.assistant-models{max-width:1100px}.assistant-models label{display:flex;flex-direction:column;gap:6px;min-width:0}.assistant-models input,.assistant-models select{margin:0;width:100%;min-width:0}.assistant-models input[type=checkbox]{width:auto}p,small{color:var(--text-muted);line-height:1.6}.add-model,.model-connections{display:flex;gap:12px;align-items:end;flex-wrap:wrap}.add-model>label,.model-connections>label{flex:1;min-width:190px}.model-card,.provider-card{background:var(--panel);border:1px solid var(--border);padding:18px;margin:14px 0;border-radius:6px;min-width:0}.model-card header,.row{display:flex;align-items:center;gap:12px}.model-card header{justify-content:space-between;flex-wrap:wrap}.model-card h3{margin:0;overflow-wrap:anywhere}.model-provider{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 0;border-bottom:1px solid var(--border)}.model-provider strong{flex:1;min-width:120px}.model-connections{margin-top:14px}.connection-settings{margin-top:24px;border-top:1px solid var(--border);padding-top:14px}.connection-settings summary{cursor:pointer;margin-bottom:14px}.provider-grid{display:grid;gap:16px}.provider-card{display:flex;flex-direction:column;gap:12px;margin:0}.provider-card .row strong{flex:1}.provider-card .row label,.provider-card .http-option{flex-direction:row;align-items:center}.provider-card>button{align-self:flex-start}.provider-card p,.provider-card small{margin:0}.error{color:var(--danger)}
</style>
