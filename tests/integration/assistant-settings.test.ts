import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {Repository} from '../../apps/desktop/main/repository';
import {AssistantSettings} from '../../apps/desktop/main/assistant-settings';
import {assistantConfigSchema} from '../../packages/schema/assistant-config';
const vault={available:()=>true,encrypt:(s:string)=>Buffer.from(s.split('').reverse().join('')),decrypt:(b:Buffer)=>b.toString().split('').reverse().join('')};
it('persists providers, skills and MCP separately from project deletion, never returns stored keys',()=>{
 const r=new Repository(':memory:'),settings=new AssistantSettings(r.db,vault),c=settings.read();expect(c.providers.map(p=>p.id)).toContain('ollama');c.providers[0].apiKey='private-test-key';c.skills.push({id:'test',name:'Cut review',content:'Review seam continuity',enabled:true});c.mcp.push({id:'local',name:'Tools',url:'http://127.0.0.1:9999/mcp',enabled:true});settings.save(c);
 expect(JSON.stringify(settings.read())).not.toContain('private-test-key');expect(String(r.db.prepare("SELECT value FROM settings WHERE key='assistant.config'").get()?.value)).not.toContain('private-test-key');expect(settings.read().providers[0].hasKey).toBe(true);
 r.create('temporary');r.deleteSession(r.sessionId!);expect(settings.read().skills[0].content).toBe('Review seam continuity');const next=settings.read();next.providers[0].baseUrl='https://example.com/v1';settings.save(next);expect(settings.read().providers[0].hasKey).toBe(false);r.close();
});
it('rejects insecure remote URLs, duplicate IDs and inconsistent model selections',()=>{
 const r=new Repository(':memory:'),settings=new AssistantSettings(r.db,vault),c=settings.read();c.providers[0].baseUrl='http://example.com/v1';expect(()=>settings.save(c)).toThrow();c.providers[0].baseUrl='https://example.com/v1';c.selectedProvider='deepseek';c.selectedModel='missing';expect(assistantConfigSchema.safeParse(c).success).toBe(false);delete c.selectedModel;c.skills=[{id:'same',name:'One',content:'',enabled:true},{id:'same',name:'Two',content:'',enabled:true}];expect(()=>settings.save(c)).toThrow();r.close();
});
it('fetches actual model lists and performs MCP handshake/tool discovery without invoking tools',async()=>{
 const calls:string[]=[],server=createServer(async(req,res)=>{if(req.url==='/api/tags'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({models:[{name:'local-model'},{name:'local-model'}]}));return;}if(req.method==='DELETE'){calls.push('close');res.end();return;}let text='';for await(const chunk of req)text+=chunk;const rpc=JSON.parse(text);calls.push(rpc.method);if(!rpc.id){res.writeHead(202);res.end();return;}res.setHeader('Content-Type','application/json');res.setHeader('Mcp-Session-Id','test-session');res.end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result:rpc.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'test',version:'1'}}:{tools:[{name:'inspect_pattern'}]}}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as {port:number},url=`http://127.0.0.1:${address.port}`,r=new Repository(':memory:'),settings=new AssistantSettings(r.db,vault);
 try{const c=settings.read();c.providers[1].baseUrl=url;c.mcp=[{id:'test',name:'Test',url:url+'/mcp',enabled:true}];settings.save(c);expect(await settings.models('ollama')).toEqual(['local-model']);expect(await settings.mcpTest('test')).toEqual(['inspect_pattern']);expect(calls).toEqual(['initialize','notifications/initialized','tools/list','close']);}finally{r.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
