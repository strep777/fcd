import {setTimeout as delay} from 'node:timers/promises';
// Playwright's synchronous predicate poll does not await asynchronous IPC reads.
export async function waitForState(page,predicate,arg,options={}){
 const timeout=options.timeout??60000,start=Date.now();
 await page.waitForFunction(()=>!!window.fpcad,undefined,{timeout});
 do{
  try{if(await page.evaluate(predicate,arg))return;}
  catch(error){if(!String(error).includes('Execution context was destroyed'))throw error;}
  await delay(50);
 }while(Date.now()-start<timeout);
 throw new Error('Timed out waiting for application state after '+timeout+' ms');
}

export async function waitForFile(path,timeout=30000){
 const {stat}=await import('node:fs/promises');const start=Date.now();
 do{try{if((await stat(path)).size>0)return;}catch(e){if(e.code!=='ENOENT')throw e;}await delay(50);}while(Date.now()-start<timeout);
 throw Error('Timed out waiting for exported file: '+path);
}
