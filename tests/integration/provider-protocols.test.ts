import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {Repository} from '../../apps/desktop/main/repository';
import {AssistantSettings} from '../../apps/desktop/main/assistant-settings';
import {assistantConfigSchema,defaultAssistantConfig} from '../../packages/schema/assistant-config';
const vault={available:()=>true,encrypt:(s:string)=>Buffer.from(s),decrypt:(b:Buffer)=>b.toString()};
it('reports partially edited endpoint text as validation data instead of throwing URL parser exceptions',()=>{
 for(const value of ['', 'http:', '127.0.0.1', 'https://', 'file:///tmp/server']){const config=defaultAssistantConfig();config.providers[0].baseUrl=value;expect(()=>assistantConfigSchema.safeParse(config)).not.toThrow();expect(assistantConfigSchema.safeParse(config).success).toBe(false);}
});
it('uses each provider native discovery route, authentication and pagination',async()=>{
 const calls:{url:string;headers:Record<string,unknown>}[]=[],server=createServer((req,res)=>{calls.push({url:req.url!,headers:req.headers});res.setHeader('Content-Type','application/json');
 if(req.url==='/api/tags')res.end(JSON.stringify({models:[{name:'local:latest'}]}));
 else if(req.url?.startsWith('/v1beta/models'))res.end(JSON.stringify(req.url.includes('pageToken=next')?{models:[{name:'models/gemini-second'}]}:{models:[{name:'models/gemini-first'}],nextPageToken:'next'}));
 else if(req.url?.startsWith('/v1/models'))res.end(JSON.stringify(req.url.includes('after_id=claude-first')?{data:[{id:'claude-second'}],has_more:false}:{data:[{id:'claude-first'}],has_more:true,last_id:'claude-first'}));
 else {res.statusCode=404;res.end('{}');}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port,repo=new Repository(':memory:'),settings=new AssistantSettings(repo.db,vault);
 try{const cfg=settings.read();cfg.providers=[{id:'native',name:'Native',kind:'ollama',baseUrl:`http://127.0.0.1:${port}`,models:[],enabled:true} as any];settings.save(cfg);expect(await settings.models('native')).toEqual(['local:latest']);
 for(const [kind,path] of [['anthropic','/v1'],['gemini','/v1beta']]){const c=settings.read();Object.assign(c.providers[0],{kind,baseUrl:`http://127.0.0.1:${port}${path}`,apiKey:'test-key'});settings.save(c);expect((await settings.models('native')).length).toBe(2);}
 expect(calls[0].url).toBe('/api/tags');expect(calls[0].headers.authorization).toBeUndefined();expect(calls[1].headers['x-api-key']).toBe('test-key');expect(calls[1].headers['anthropic-version']).toBe('2023-06-01');expect(calls[1].headers.authorization).toBeUndefined();expect(calls[3].headers['x-goog-api-key']).toBe('test-key');expect(calls[2].url).toContain('after_id=claude-first');expect(calls[4].url).toContain('pageToken=next');
 }finally{repo.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
it('allows explicitly selected HTTP servers without admitting credential URLs or retaining keys across protocol changes',()=>{
 const repo=new Repository(':memory:'),settings=new AssistantSettings(repo.db,vault);try{const c=settings.read();Object.assign(c.providers[0],{baseUrl:'http://192.168.1.10:11434',kind:'ollama',allowHttp:true,apiKey:'local-key'});c.providers[0].allowHttp=false;expect(()=>settings.save(c)).toThrow('HTTP_REQUIRES_OPT_IN');c.providers[0].allowHttp=true;settings.save(c);expect(settings.read().providers[0].hasKey).toBe(true);const next=settings.read();(next.providers[0] as any).kind='openai-compatible';settings.save(next);expect(settings.read().providers[0].hasKey).toBe(false);next.providers[0].baseUrl='http://user:password@example.com';expect(()=>settings.save(next)).toThrow();}finally{repo.close();}
});
