import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {AssistantBridge} from '../../apps/desktop/main/assistant-bridge';
import type {Request,Response} from '../../packages/schema/index';
const success:Response={ok:true,data:{project:null,geometry:[],canUndo:false,canRedo:false,savedRevision:null,recovery:[],history:[],recent:[],jobs:[]}};
const read=()=>({protocolVersion:1,requestId:randomUUID(),method:'session.read',payload:{}});
it('concurrent enable calls share one connection and disabling during startup cannot revoke a newer connection',async()=>{
 const bridge=new AssistantBridge(async()=>success);try{
  const connections=await Promise.all(Array.from({length:8},()=>bridge.enable()));expect(new Set(connections.map(s=>s.endpoint)).size).toBe(1);expect(new Set(connections.map(s=>s.token)).size).toBe(1);
  bridge.disable();const interrupted=bridge.enable();bridge.disable();const fresh=bridge.enable();const results=await Promise.allSettled([interrupted,fresh]);expect(results[0].status).toBe('rejected');expect(results[1].status).toBe('fulfilled');
  const state=bridge.status();expect(state.enabled).toBe(true);expect(state.token).toHaveLength(64);expect((await fetch(state.endpoint+'/v1/status',{headers:{Authorization:'Bearer '+state.token}})).status).toBe(200);
 }finally{bridge.disable();}
});
it('binds only to loopback, starts disconnected, authenticates, hides token from HTTP status and rotates it after disable',async()=>{
 const bridge=new AssistantBridge(async()=>success);expect(bridge.status().enabled).toBe(false);try{const state=await bridge.enable();expect(state.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);expect(state.token).toHaveLength(64);expect(state.connected).toBe(false);
 const response=await fetch(state.endpoint+'/v1/status',{headers:{Authorization:'Bearer '+state.token}});expect(response.status).toBe(200);const status=await response.json();expect(status.connection.connected).toBe(true);expect(status.connection.token).toBeUndefined();expect(bridge.status().lastRequestAt).toBeTruthy();bridge.disable();expect(bridge.status().token).toBe('');const next=await bridge.enable();expect(next.token).not.toBe(state.token);expect((await fetch(next.endpoint+'/v1/status',{headers:{Authorization:'Bearer '+state.token}})).status).toBe(401);
 }finally{bridge.disable();}
});
it('rejects missing token, browser origins and wrong Host even with a valid token',async()=>{
 const bridge=new AssistantBridge(async()=>success);try{const s=await bridge.enable();expect((await fetch(s.endpoint+'/v1/status')).status).toBe(401);expect((await fetch(s.endpoint+'/v1/status',{headers:{Authorization:'Bearer '+s.token,Origin:'http://localhost'}})).status).toBe(403);
 const status=await new Promise<number>(resolve=>{const req=httpRequest(s.endpoint+'/v1/status',{headers:{Authorization:'Bearer '+s.token,Host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode!);});req.end();});expect(status).toBe(403);
 }finally{bridge.disable();}
});
it('uses schema and capability validation; file export, raw surface injection and session switching cannot reach dispatch',async()=>{
 const dispatched:Request[]=[];const bridge=new AssistantBridge(async r=>{dispatched.push(r);return success;});try{const s=await bridge.enable(),send=(body:unknown)=>fetch(s.endpoint+'/v1/request',{method:'POST',headers:{Authorization:'Bearer '+s.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 expect((await send(read())).status).toBe(200);expect(dispatched).toHaveLength(1);
 for(const req of [{...read(),method:'project.open'},{...read(),method:'session.activate',payload:{sessionId:randomUUID()}},{...read(),method:'workflow.file',projectId:randomUUID(),expectedRevision:0,payload:{action:'export'}}])expect((await send(req)).status).toBe(403);
 expect((await send({...read(),projectId:randomUUID(),method:'command.apply',expectedRevision:0,payload:{type:'pieces.replace',removeIds:[],pieces:[]}})).status).toBe(403);expect((await send({...read(),payload:{garbage:1}})).status).toBe(400);expect(dispatched).toHaveLength(1);
 }finally{bridge.disable();}
});
it('limits payloads, concurrent requests and per-minute requests without arbitrary filesystem access',async()=>{
 let release:()=>void=()=>{},count=0;const blocked=new Promise<void>(r=>{release=r;}),bridge=new AssistantBridge(async()=>{count++;await blocked;return success;});try{const s=await bridge.enable(),headers={Authorization:'Bearer '+s.token,'Content-Type':'application/json'},send=()=>fetch(s.endpoint+'/v1/request',{method:'POST',headers,body:JSON.stringify(read())});
 expect((await fetch(s.endpoint+'/v1/request',{method:'POST',headers,body:' '.repeat(2*1024*1024+1)})).status).toBe(413);
 const pending=Array.from({length:4},send);while(count<4)await new Promise(r=>setTimeout(r,10));expect((await send()).status).toBe(429);release();await Promise.all(pending);
 let limited=false;for(let i=0;i<125;i++){if((await fetch(s.endpoint+'/v1/status',{headers})).status===429){limited=true;break;}}expect(limited).toBe(true);
 }finally{release();bridge.disable();}
});
it('disabling revokes queued authority before a dispatch can mutate data',async()=>{
 let active:()=>boolean=()=>true,started:()=>void=()=>{},release:()=>void=()=>{};const reached=new Promise<void>(r=>{started=r;}),blocked=new Promise<void>(r=>{release=r;}),bridge=new AssistantBridge(async(_request,check)=>{active=check;started();await blocked;return active()?success:{ok:false,error:{code:'ASSISTANT_DISABLED',messageKey:'ASSISTANT_DISABLED'}};});
 const state=await bridge.enable();const pending=fetch(state.endpoint+'/v1/request',{method:'POST',headers:{Authorization:'Bearer '+state.token,'Content-Type':'application/json'},body:JSON.stringify(read())}).catch(()=>null);await reached;expect(active()).toBe(true);bridge.disable();expect(active()).toBe(false);release();await pending;
});
