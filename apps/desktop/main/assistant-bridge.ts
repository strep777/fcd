import {createServer,type Server,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {requestSchema,type Request,type Response,type AssistantConnection} from '../../../packages/schema/index';
export const assistantMethods=['session.read','validation.run','command.apply','command.undo','command.redo','surface.unwrap','surface.accept','marking.project','marking.surface','marking.edit','marking.source.edit','marking.infer','pattern.corner','pattern.boolean','pattern.allowance','pattern.offset','result.accept','result.discard','job.cancel','nesting.run','patterns.preview'] as const;
export const assistantCommands=['project.rename','piece.put','piece.delete','piece.split','workflow.node','surface.curve','surface.section','surface.cutScope','surface.cutLine.meta','surface.cutLine.delete','surface.split','model.rename','model.activate','material.put','material.delete','seam.put','seam.delete'] as const;
const failure=(code:string)=>({ok:false as const,error:{code,messageKey:code}});
/** Session-only authority: loopback, no browser origins, bounded requests, explicit capabilities. */
export class AssistantBridge {
 private server?:Server;private enabling?:Promise<AssistantConnection>;private token='';private endpoint='';private generation=0;private lastRequestAt?:string;private requests=0;private period=0;private pending=0;
 constructor(private dispatch:(request:Request,active:()=>boolean)=>Promise<Response>){}
 status():AssistantConnection{return {enabled:!!this.server,endpoint:this.endpoint,token:this.token,connected:!!this.server&&!!this.lastRequestAt&&Date.now()-Date.parse(this.lastRequestAt)<30000,lastRequestAt:this.lastRequestAt,methods:[...assistantMethods],commands:[...assistantCommands]};}
 async enable(){if(this.server)return this.status();if(this.enabling)return this.enabling;const pending=this.start();this.enabling=pending;try{return await pending;}finally{if(this.enabling===pending)this.enabling=undefined;}}
 private async start(){const generation=++this.generation;this.token=randomBytes(32).toString('hex');this.lastRequestAt=undefined;this.requests=0;this.period=Date.now();
  const server=createServer((req,res)=>{void this.receive(req,res,generation);});server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=32;
  try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});}catch(error){if(generation===this.generation)this.token='';server.close();throw error;}
  const address=server.address();if(!address||typeof address==='string')throw Error('ASSISTANT_START_FAILED');if(generation!==this.generation){server.close();throw Error('ASSISTANT_DISABLED');}this.server=server;this.endpoint=`http://127.0.0.1:${address.port}`;return this.status();
 }
 disable(){++this.generation;const server=this.server;this.server=undefined;this.enabling=undefined;this.token='';this.endpoint='';this.lastRequestAt=undefined;server?.close();server?.closeAllConnections();return this.status();}
 private reply(res:ServerResponse,status:number,data:unknown){if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
 private async receive(req:IncomingMessage,res:ServerResponse,generation:number){
  const active=()=>generation===this.generation&&!!this.server;
  try{
   if(!active())return this.reply(res,503,failure('ASSISTANT_DISABLED'));
   if(req.headers.origin||req.headers.host!==this.endpoint.slice(7)||req.socket.remoteAddress!=='127.0.0.1')return this.reply(res,403,failure('FORBIDDEN'));
   const supplied=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+this.token);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return this.reply(res,401,failure('UNAUTHORIZED'));
   if(Date.now()-this.period>60000){this.period=Date.now();this.requests=0;}if(++this.requests>120||this.pending>=4)return this.reply(res,429,failure('ASSISTANT_BUSY'));
   if(req.method==='GET'&&req.url==='/v1/status'){this.lastRequestAt=new Date().toISOString();const {token,...connection}=this.status();return this.reply(res,200,{ok:true,connection});}
   if(req.method!=='POST'||req.url!=='/v1/request')return this.reply(res,404,failure('NOT_FOUND'));
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))return this.reply(res,415,failure('JSON_REQUIRED'));
   if(Number(req.headers['content-length']??0)>2*1024*1024)return this.reply(res,413,failure('RESOURCE_LIMIT'));
   this.pending++;try{
    const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)return this.reply(res,413,failure('RESOURCE_LIMIT'));chunks.push(Buffer.from(chunk));}
    if(!active())return this.reply(res,503,failure('ASSISTANT_DISABLED'));
    let raw:unknown;try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return this.reply(res,400,failure('VALIDATION_ERROR'));}
    const parsed=requestSchema.safeParse(raw);if(!parsed.success)return this.reply(res,400,failure('VALIDATION_ERROR'));const request=parsed.data;
    if(!(assistantMethods as readonly string[]).includes(request.method)||request.method==='command.apply'&&!(assistantCommands as readonly string[]).includes(request.payload.type))return this.reply(res,403,failure('FORBIDDEN'));
    this.lastRequestAt=new Date().toISOString();const response=await this.dispatch(request,active);return this.reply(res,response.ok?200:409,response);
   }finally{this.pending--;}
  }catch{return this.reply(res,500,failure('ASSISTANT_REQUEST_FAILED'));}
 }
}
