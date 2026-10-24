import UPNG from '@pdf-lib/upng';
import {chromium} from 'playwright';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {mkdir,mkdtemp,readdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createCanvas,Image,ImageData} from '@napi-rs/canvas';

async function port(){const server=createServer();await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const port=server.address().port;await new Promise(ok=>server.close(ok));return port;}
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
// Fixture image generation is test-local. All project requests use the real host.
const codec=UPNG.default??UPNG;
function raster(canvas){return {toPNG:()=>canvas.toBuffer('image/png'),toJPEG:q=>canvas.toBuffer('image/jpeg',q/100),resize:({width,height})=>{const next=createCanvas(width,height);next.getContext('2d').drawImage(canvas,0,0,width,height);return raster(next);}};}
const rasterImage={createFromBitmap:(bytes,{width,height})=>{const rgba=new Uint8ClampedArray(bytes);for(let i=0;i<rgba.length;i+=4)[rgba[i],rgba[i+2]]=[rgba[i+2],rgba[i]];const canvas=createCanvas(width,height);canvas.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);return raster(canvas);},createFromBuffer:bytes=>{const decoded=codec.decode(Uint8Array.from(bytes).buffer),canvas=createCanvas(decoded.width,decoded.height);canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(codec.toRGBA8(decoded)[0]),decoded.width,decoded.height),0,0);return raster(canvas);}};

export const desktop={async launch({args=[],webviewArgs=[],env=process.env,executablePath}={}){
 await mkdir('.local/tests',{recursive:true});const control=await mkdtemp(resolve('.local/tests/tauri-control-'));
 const fixture=args.find(a=>a.endsWith('fixture.json'));
 const browserArguments=[...new Set(['--disable-background-timer-throttling','--disable-renderer-backgrounding',...webviewArgs])];
 let browser,page,proc,timer,inspector,closed=false;const inspectorPort=env.FPCAD_PROFILE==='1'?await port():undefined;const dialog={showOpenDialog:async()=>({canceled:true,filePaths:[]}),showSaveDialog:async()=>({canceled:true})};
 const controlCall=(action,payload=null)=>page.evaluate(({action,payload})=>window.__TAURI_INTERNALS__.invoke('test_control',{action,payload}),{action,payload});
 if(fixture){const config=JSON.parse(await readFile(fixture,'utf8'));browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-timer-throttling']});page=await browser.newPage({viewport:{width:config.width,height:config.height}});await page.goto(pathToFileURL(config.html).href);}
 else{
  const debugPort=await port();
  const executable=executablePath??(env.FPCAD_TEST_APP_DIR?resolve(env.FPCAD_TEST_APP_DIR,'src-tauri/target/debug/FurryPatternCAD.exe'):resolve('apps/desktop/src-tauri/target/debug/FurryPatternCAD.exe'));
  browserArguments.unshift(`--remote-debugging-port=${debugPort}`);
  proc=spawn(executable,['--fpcad-background-test'],{env:{...env,...(inspectorPort?{FPCAD_TEST_INSPECTOR_PORT:String(inspectorPort)}:{}),FPCAD_TEST_NATIVE_DIR:control,WEBVIEW2_USER_DATA_FOLDER:join(control,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:browserArguments.join(' ')},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';proc.stdout.on('data',b=>output+=b);proc.stderr.on('data',b=>output+=b);
  const deadline=Date.now()+60000;let lastCdpError;
  while(Date.now()<deadline){if(proc.exitCode!==null)throw Error('Tauri exited: '+output);try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`,{timeout:1000});break;}catch(error){lastCdpError=error;await pause(150);}}
  if(!browser){
   const endpoints=await Promise.all(['/json/version','/json/list'].map(async path=>{try{const response=await fetch(`http://127.0.0.1:${debugPort}${path}`,{signal:AbortSignal.timeout(1500)});return {path,status:response.status,body:(await response.text()).slice(0,4000)};}catch(error){return {path,error:String(error),cause:String(error.cause??'')};}}));
   const diagnostic={pid:proc.pid,debugPort,executable,control,lastCdpError:String(lastCdpError),endpoints,proxyEnvironment:Object.fromEntries(['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'].map(name=>[name,!!process.env[name]])),output};
   await writeFile(join(control,'launch-diagnostics.json'),JSON.stringify(diagnostic,null,2));console.error('WebView2 launch diagnostics',JSON.stringify(diagnostic));proc.kill();throw Error('WebView2 debugging endpoint unavailable: '+output+'\n'+String(lastCdpError));
  }
  while(Date.now()<deadline){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));if(page)break;await pause(100);}
  if(!page)throw Error('Main Tauri WebView not found');
  const seen=new Set();timer=setInterval(async()=>{for(const file of await readdir(control)){if(!file.endsWith('.request.json')||seen.has(file))continue;seen.add(file);void(async()=>{let request;try{request=JSON.parse(await readFile(join(control,file),'utf8'));}catch{seen.delete(file);return;}try{const value=request.method==='open'?await dialog.showOpenDialog(null,request.payload):request.method==='save'?await dialog.showSaveDialog(null,request.payload):await nativePrint(request.payload);await writeFile(join(control,file.replace('.request.','.response.')),JSON.stringify({native:request.native,value}));}catch(error){await writeFile(join(control,file.replace('.request.','.response.')),JSON.stringify({native:request.native,error:error.message}));}})();}},20);
  await page.waitForFunction(()=>!!window.fpcad,{},{timeout:30000});
  if(inspectorPort){
   const targets=await (await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json(),socket=new WebSocket(targets[0].webSocketDebuggerUrl),waiting=new Map();let sequence=0;
   await new Promise((ok,fail)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',fail,{once:true});});
   socket.addEventListener('message',event=>{const message=JSON.parse(event.data),task=waiting.get(message.id);if(task){waiting.delete(message.id);message.error?task.reject(Error(message.error.message)):task.resolve(message.result);}});
   inspector={close:()=>socket.close(),send:(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;waiting.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));})};
   if(env.FPCAD_TEST_EXCEPTION_LOG){
    socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Debugger.paused'){void appendFile(env.FPCAD_TEST_EXCEPTION_LOG,JSON.stringify({reason:message.params.reason,data:message.params.data,frames:message.params.callFrames.map(f=>({functionName:f.functionName,url:f.url,location:f.location}))})+'\n').finally(()=>inspector.send('Debugger.resume'));}});
    await inspector.send('Debugger.enable');await inspector.send('Debugger.setPauseOnExceptions',{state:'all'});
   }

  }
 }
 const printListeners=[];
 async function nativePrint(payload){
  const printPage=await browser.contexts()[0].newPage();await printPage.setContent(payload.html);
  const size=await printPage.evaluate(()=>{const m=document.documentElement.innerHTML.match(/size:\s*([\d.]+)mm\s+([\d.]+)mm/);return m?{width:Number(m[1])*1000,height:Number(m[2])*1000}:null;});
  const contents={executeJavaScript:source=>printPage.evaluate(source),print:(_options,callback)=>callback(true,'')};
  for(const listener of printListeners)listener(null,{contents});
  await new Promise((ok,fail)=>contents.print({printBackground:true,scaleFactor:100,pageSize:size},(success,reason)=>success?ok():fail(Error(reason))));await printPage.close();return null;
 }
 const snapshot=async()=>fixture?{visible:false,id:'fixture'}:await controlCall('state');
 async function context(){const state=await snapshot(),window={...state,isVisible:()=>state.visible,contents:{send:(event,value)=>controlCall('emit',{event,value})}};return {dialog,rasterImage,DesktopWindow:{getAllWindows:()=>[window],fromId:id=>id===state.id?window:undefined},host:{on:(_event,listener)=>printListeners.push(listener),getAppPath:()=>{if(typeof state.applicationDirectory!=='string'||!isAbsolute(state.applicationDirectory))throw Error('Debug test_control state.applicationDirectory is missing or not absolute; rebuild the Tauri debug application before testing its actual backend resources');return state.applicationDirectory;}}};}
 return {
  firstWindow:async()=>page,process:()=>proc,
  webviewLaunchInfo:async()=>{
   if(!proc)throw Error('Native WebView2 launch evidence is unavailable for a browser fixture');
   const script=`$all=Get-CimInstance Win32_Process; $ids=[Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${proc.pid}); do {$count=$ids.Count; foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)){[void]$ids.Add([int]$p.ProcessId)}}} while($ids.Count -ne $count); ConvertTo-Json -InputObject @($all | Where-Object {$ids.Contains([int]$_.ProcessId) -and $_.Name -eq 'msedgewebview2.exe'} | ForEach-Object {[pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;name=$_.Name;commandLine=$_.CommandLine}}) -Compress`;
   const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});
   return {hostPid:proc.pid,hostArguments:proc.spawnargs.slice(1),configuredWebviewArguments:[...browserArguments],processes:JSON.parse(stdout)};
  },
  request:payload=>page.evaluate(payload=>window.__TAURI_INTERNALS__.invoke('desktop_request',{channel:'fpcad:request',payload}),payload),
  backendEvaluate:async(callback,arg)=>{if(!inspector)throw Error('Backend inspection requires a debug test build and FPCAD_PROFILE=1');const expression=`(${callback.toString()})({request:payload=>process.getBuiltinModule('module').createRequire(process.argv[1])(process.argv[1]).receiveRequest('fpcad:request',payload)},${JSON.stringify(arg)??'undefined'})`;const result=await inspector.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;},
  metrics:async()=>{
   const script=`$all=Get-CimInstance Win32_Process; $ids=[Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${proc.pid}); do {$count=$ids.Count; foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)){[void]$ids.Add([int]$p.ProcessId)}}} while($ids.Count -ne $count); @($all | Where-Object {$ids.Contains([int]$_.ProcessId)} | ForEach-Object {$p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if($p){[pscustomobject]@{pid=$p.Id;type=$p.ProcessName;workingSetBytes=$p.WorkingSet64;privateBytes=$p.PrivateMemorySize64}}}) | ConvertTo-Json -Compress`;
   const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});return JSON.parse(stdout);
  },
  profileStart:async()=>{if(!inspector)throw Error('Backend profiling requires FPCAD_PROFILE=1');await inspector.send('Profiler.enable');await inspector.send('Profiler.setSamplingInterval',{interval:1000});await inspector.send('Profiler.start');},
  profileStop:async()=>JSON.stringify((await inspector.send('Profiler.stop')).profile),
  backendCpu:async()=>(await inspector.send('Runtime.evaluate',{expression:'process.cpuUsage()',returnByValue:true})).result.value,
  evaluate:async(callback,arg)=>callback(await context(),arg),
  window:async()=>({evaluate:async(callback,arg)=>callback((await context()).DesktopWindow.getAllWindows()[0],arg),dispose:async()=>{}}),
  close:async()=>{if(closed)return;closed=true;try{inspector?.close();if(proc&&proc.exitCode===null&&proc.signalCode===null){await controlCall('close').catch(()=>{});if(proc.exitCode===null&&proc.signalCode===null)await Promise.race([new Promise(ok=>proc.once('exit',ok)),pause(15000)]);if(proc.exitCode===null&&proc.signalCode===null){proc.kill();throw Error('Tauri did not close cleanly');}}await browser.close();}finally{clearInterval(timer);}},
 };
}};
