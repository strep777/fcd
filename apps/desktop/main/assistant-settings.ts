import type {DatabaseSync} from 'node:sqlite';
import {assistantConfigSchema,defaultAssistantConfig,type AssistantConfig} from '../../../packages/schema/assistant-config';
interface Vault{available():boolean;encrypt(value:string):Buffer;decrypt(value:Buffer):string}
export class AssistantSettings{
 constructor(private db:DatabaseSync,private vault:Vault){}
 private stored(){const row=this.db.prepare("SELECT value FROM settings WHERE key='assistant.config'").get();return row?JSON.parse(String(row.value)):{...defaultAssistantConfig(),secrets:{}};}
 read():AssistantConfig{const {secrets,...config}=this.stored();return assistantConfigSchema.parse({...config,providers:config.providers.map((p:AssistantConfig['providers'][number])=>({...p,hasKey:!!secrets[p.id]}))});}
 save(input:unknown){const next=assistantConfigSchema.parse(input),previous=this.stored(),secrets:Record<string,string>={};for(const p of next.providers){if(p.apiKey){if(!this.vault.available())throw Error('安全密钥存储不可用，未保存密钥');secrets[p.id]=this.vault.encrypt(p.apiKey).toString('base64');}else if(p.apiKey===undefined&&previous.providers.some((x:{id:string;baseUrl:string;kind?:string})=>x.id===p.id&&x.baseUrl===p.baseUrl&&(x.kind??'openai-compatible')===(p.kind??'openai-compatible'))&&previous.secrets[p.id])secrets[p.id]=previous.secrets[p.id];delete p.apiKey;delete p.hasKey;}this.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('assistant.config',?)").run(JSON.stringify({...next,secrets}));return this.read();}
 async models(providerId:string){
  const cfg=this.read(),p=cfg.providers.find(p=>p.id===providerId&&p.enabled);if(!p)throw Error('PROVIDER_UNAVAILABLE');
  const secret=this.stored().secrets[p.id],key=secret?this.vault.decrypt(Buffer.from(secret,'base64')):undefined,kind=p.kind??'openai-compatible';
  if(kind==='volcengine'||kind==='volcengine-coding')throw Error('PROVIDER_MANUAL_MODELS');
  const headers:Record<string,string>={Accept:'application/json'};
  if(kind==='anthropic'){headers['anthropic-version']='2023-06-01';if(key)headers['x-api-key']=key;}
  else if(kind==='gemini'){if(key)headers['x-goog-api-key']=key;}
  else if(key)headers.Authorization='Bearer '+key;
  const base=p.baseUrl.replace(/\/+$/,''),route=kind==='ollama'?base.replace(/\/api$/,'')+'/api/tags':base+'/models';
  const models:string[]=[],seenPages=new Set<string>();let cursor='';
  for(let page=0;page<20;page++){
   const url=new URL(route);if(cursor)url.searchParams.set(kind==='gemini'?'pageToken':'after_id',cursor);
   const res=await fetch(url,{headers,signal:AbortSignal.timeout(10000),redirect:'error'});if(!res.ok)throw Error('PROVIDER_HTTP_'+res.status);
   const body=await boundedJson(res),rows=kind==='ollama'||kind==='gemini'?body.models:body.data;if(!Array.isArray(rows))throw Error('MODEL_LIST_INVALID');
   for(const item of rows){if(!item||typeof item!=='object')throw Error('MODEL_LIST_INVALID');const raw=kind==='ollama'||kind==='gemini'?item.name:item.id;if(typeof raw!=='string'||!raw.trim()||raw.length>120)throw Error('MODEL_LIST_INVALID');const id=kind==='gemini'?raw.replace(/^models\//,''):raw;if(!models.includes(id))models.push(id);}
   cursor=kind==='gemini'?body.nextPageToken:kind==='anthropic'&&body.has_more?body.last_id:'';
   if(kind==='anthropic'&&body.has_more&&!cursor)throw Error('MODEL_PAGINATION_INVALID');
   if(!cursor||models.length>=200)break;if(typeof cursor!=='string'||cursor.length>1000||seenPages.has(cursor)||page===19)throw Error('MODEL_PAGINATION_INVALID');seenPages.add(cursor);
  }
  const latest=this.read(),current=latest.providers.find(item=>item.id===p.id&&item.enabled&&item.baseUrl===p.baseUrl&&(item.kind??'openai-compatible')===kind);
  if(!current)throw Error('PROVIDER_CHANGED');current.models=models.slice(0,200);if(latest.selectedProvider===p.id&&latest.selectedModel&&!current.models.includes(latest.selectedModel))delete latest.selectedModel;this.save(latest);return current.models;
 }
 async mcpTest(serverId:string){const server=this.read().mcp.find(s=>s.id===serverId&&s.enabled);if(!server)throw Error('MCP 服务不存在或未启用');let session='',protocol='2025-03-26';const post=async(method:string,params?:unknown)=>{const res=await fetch(server.url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(session?{'Mcp-Session-Id':session}:{}),'MCP-Protocol-Version':protocol},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),redirect:'error',signal:AbortSignal.timeout(10000)});if(!res.ok)throw Error('MCP 连接失败 HTTP '+res.status);session=res.headers.get('mcp-session-id')??session;const data=await boundedJson(res);if(data?.jsonrpc!=='2.0'||data.id!==1)throw Error('MCP_RESPONSE_INVALID');if(data.error)throw Error('MCP 请求失败');return data.result;};try{const init=await post('initialize',{protocolVersion:protocol,capabilities:{},clientInfo:{name:'FurryPattern CAD',version:'0.8.0'}});if(typeof init?.protocolVersion!=='string'||!['2024-11-05','2025-03-26','2025-06-18'].includes(init.protocolVersion))throw Error('不支持的 MCP 协议版本');protocol=init.protocolVersion;const res=await fetch(server.url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(session?{'Mcp-Session-Id':session}:{}),'MCP-Protocol-Version':protocol},body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}),signal:AbortSignal.timeout(10000),redirect:'error'});if(!res.ok)throw Error('MCP 初始化失败');const result=await post('tools/list');if(!Array.isArray(result?.tools)||result.tools.some((t:any)=>!t||typeof t.name!=='string'||!t.name.trim()))throw Error('MCP_TOOLS_INVALID');return result.tools.map((t:any)=>t.name).slice(0,200);}finally{if(session)await fetch(server.url,{method:'DELETE',headers:{'Mcp-Session-Id':session,'MCP-Protocol-Version':protocol},signal:AbortSignal.timeout(3000),redirect:'error'}).catch(()=>{});}}
}
async function boundedJson(res:Response){const reader=res.body?.getReader();if(!reader)throw Error('空响应');let text='',bytes=0;const decoder=new TextDecoder();try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024)throw Error('响应过大');text+=decoder.decode(value,{stream:true});if(res.headers.get('content-type')?.includes('text/event-stream')){for(const block of text.split(/\r?\n\r?\n/).slice(0,-1)){const data=block.split(/\r?\n/).filter(s=>s.startsWith('data:')).map(s=>s.slice(5).trim()).join('\n');if(data){const parsed=JSON.parse(data);if(parsed.id===1)return parsed;}}}}return JSON.parse(text+decoder.decode());}finally{await reader.cancel().catch(()=>{});}}
