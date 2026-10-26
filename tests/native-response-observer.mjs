import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

// The public desktop client is frozen. Observe the actual Tauri network
// response without replacing a client method, invoking a second command or
// changing any request/response returned to the application.
export async function observeNativeResponses(page,directory,methods){
 // A full CAD candidate exceeds Chromium's default inspector body cache.
 // This changes only the test observer's cache, never the application deadline.
 const network=await page.context().newCDPSession(page);
 await network.send('Network.enable',{maxTotalBufferSize:256*1024*1024,maxResourceBufferSize:128*1024*1024});
 const decoder=resolve(directory,'native-response-decoder.mjs');
 await build({stdin:{contents:"export {parseResponse} from './packages/api/response-wire';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:decoder});
 const {parseResponse}=await import(pathToFileURL(decoder).href),records=[],errors=[],pending=new Set();
 const requests=new Map();
 network.on('Network.requestWillBeSent',event=>{
  if(!event.request.url.includes('ipc.localhost/desktop_request'))return;
  let envelope;try{envelope=JSON.parse(event.request.postData);}catch{return;}
  const command=envelope?.payload;if(methods.includes(command?.method))requests.set(event.requestId,{command,start:event.timestamp,wallTime:event.wallTime});
 });
 network.on('Network.responseReceived',event=>{const request=requests.get(event.requestId);if(request)request.response=event.response;});
 network.on('Network.loadingFailed',event=>{const request=requests.get(event.requestId);if(request){errors.push({request:request.command,error:event.errorText});requests.delete(event.requestId);}});
 network.on('Network.loadingFinished',event=>{
  const request=requests.get(event.requestId);if(!request)return;
  const command=request.command;
  const task=(async()=>{try{
   const body=await network.send('Network.getResponseBody',{requestId:event.requestId}),raw=body.base64Encoded?Buffer.from(body.body,'base64').toString('utf8'):body.body,result=parseResponse(raw),project=result.ok?result.data?.project:undefined;
   records.push({request:command,requestTiming:{startTime:request.wallTime*1000,responseEnd:(event.timestamp-request.start)*1000,...request.response?.timing},status:request.response?.status,responseBytes:Buffer.byteLength(raw),responseSha256:createHash('sha256').update(raw).digest('hex'),result:result.ok?{ok:true,...(result.autoPlacementReport?{autoPlacementReport:result.autoPlacementReport}:{}),projectRevision:project?.revision,markingIds:(project?.markings??[]).map(m=>m.id),...(project?.surfaceRun?{candidate:{pieces:project.surfaceRun.pieces.length,bindings:project.surfaceRun.bindings.length,accepted:project.surfaceRun.accepted}}:{})}:result});
  }catch(error){errors.push({request:command,error:String(error.stack??error)});}})();
  requests.delete(event.requestId);
  pending.add(task);void task.finally(()=>pending.delete(task));
 });
 return {records,errors,async waitFor(method,after=0,timeoutMs=120000){const end=Date.now()+timeoutMs;while(Date.now()<end){const record=records.slice(after).find(r=>r.request.method===method);if(record)return record;const error=errors.find(r=>r.request.method===method);if(error)throw Error(error.error);await new Promise(ok=>setTimeout(ok,100));}throw Error('Actual native response not observed: '+method);},async stop(){await Promise.allSettled([...pending]);await network.detach();}};
}
