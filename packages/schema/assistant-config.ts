import {z} from 'zod';
const name=z.string().trim().min(1).max(120),id=z.string().min(1).max(100);
const parseEndpoint=(value:string)=>{try{return new URL(value);}catch{return null;}};
const webEndpoint=z.string().url().max(1000).refine(v=>{const u=parseEndpoint(v);return !!u&&!u.username&&!u.password&&!u.search&&!u.hash&&['https:','http:'].includes(u.protocol);},'INVALID_ENDPOINT');
export const isLocalEndpoint=(v:string)=>['localhost','127.0.0.1','[::1]'].includes(parseEndpoint(v)?.hostname??'');
export const endpoint=webEndpoint.refine(v=>parseEndpoint(v)?.protocol==='https:'||isLocalEndpoint(v),'HTTP_REQUIRES_OPT_IN');
export const providerKinds=['openai-compatible','openai','deepseek','ollama','anthropic','gemini','lmstudio','llamacpp','vllm','volcengine','volcengine-coding'] as const;
export type ProviderKind=typeof providerKinds[number];
export const providerPresets:Record<ProviderKind,{name:string;baseUrl:string;native:string;keyRequired:boolean}>={
 'openai-compatible':{name:'OpenAI 兼容服务',baseUrl:'http://127.0.0.1:8000/v1',native:'GET /models',keyRequired:false},
 openai:{name:'OpenAI',baseUrl:'https://api.openai.com/v1',native:'GET /models · Bearer',keyRequired:true},
 deepseek:{name:'DeepSeek',baseUrl:'https://api.deepseek.com',native:'GET /models · Bearer',keyRequired:true},
 ollama:{name:'Ollama',baseUrl:'http://127.0.0.1:11434',native:'GET /api/tags',keyRequired:false},
 anthropic:{name:'Anthropic',baseUrl:'https://api.anthropic.com/v1',native:'GET /models · x-api-key',keyRequired:true},
 gemini:{name:'Gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',native:'GET /models · x-goog-api-key',keyRequired:true},
 lmstudio:{name:'LM Studio',baseUrl:'http://127.0.0.1:1234/v1',native:'GET /models',keyRequired:false},
 llamacpp:{name:'llama.cpp',baseUrl:'http://127.0.0.1:8080/v1',native:'GET /models',keyRequired:false},
 vllm:{name:'vLLM',baseUrl:'http://127.0.0.1:8000/v1',native:'GET /models',keyRequired:false},
 volcengine:{name:'火山引擎',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',native:'模型 / 推理接入点标识 · Bearer',keyRequired:true},
 'volcengine-coding':{name:'火山引擎 Coding Plan',baseUrl:'https://ark.cn-beijing.volces.com/api/coding/v3',native:'模型标识 · Bearer',keyRequired:true}
};
const providerSchema=z.object({id,name,kind:z.enum(providerKinds).optional(),baseUrl:webEndpoint,allowHttp:z.boolean().optional(),apiKey:z.string().max(4096).optional(),hasKey:z.boolean().optional(),models:z.array(name).max(200),enabled:z.boolean()}).strict().superRefine((v,c)=>{if(parseEndpoint(v.baseUrl)?.protocol==='http:'&&!isLocalEndpoint(v.baseUrl)&&!v.allowHttp)c.addIssue({code:'custom',path:['baseUrl'],message:'HTTP_REQUIRES_OPT_IN'});});
export const assistantConfigSchema=z.object({providers:z.array(providerSchema).max(30),selectedProvider:id.optional(),selectedModel:name.optional(),skills:z.array(z.object({id,name,content:z.string().max(100000),enabled:z.boolean()}).strict()).max(100),mcp:z.array(z.object({id,name,url:endpoint,enabled:z.boolean()}).strict()).max(50)}).strict().superRefine((v,c)=>{for(const rows of [v.providers,v.skills,v.mcp])if(new Set(rows.map(x=>x.id)).size!==rows.length)c.addIssue({code:'custom',message:'Duplicate ID'});if(v.selectedProvider&&!v.providers.some(p=>p.id===v.selectedProvider&&p.enabled))c.addIssue({code:'custom',message:'Selected provider unavailable'});if(v.selectedModel&&!v.providers.find(p=>p.id===v.selectedProvider)?.models.includes(v.selectedModel))c.addIssue({code:'custom',message:'Selected model unavailable'});});
export type AssistantConfig=z.infer<typeof assistantConfigSchema>;
export const defaultAssistantConfig=():AssistantConfig=>({providers:(["deepseek","ollama","lmstudio","llamacpp","vllm"] as const).map(kind=>({id:kind,kind,name:providerPresets[kind].name,baseUrl:providerPresets[kind].baseUrl,models:[],enabled:true})),skills:[],mcp:[]});
export type AssistantSettingsRequest={action:'read'}|{action:'save';config:AssistantConfig}|{action:'models';providerId:string}|{action:'mcp-test';serverId:string};
export type AssistantSettingsResponse={ok:true;config:AssistantConfig;models?:string[];tools?:string[]}|{ok:false;error:string};
