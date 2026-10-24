import {chromium} from 'playwright';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import assert from 'node:assert/strict';
await mkdir('.local/tests',{recursive:true});await mkdir('test-results',{recursive:true});const directory=await mkdtemp(resolve('.local/tests/tauri-release-')),build=process.env.FPCAD_TEST_EXECUTABLE?{executable:resolve(process.env.FPCAD_TEST_EXECUTABLE),source:'explicit release executable'}:JSON.parse(await readFile('release/latest.json','utf8'));
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');build.sha256=await hash(build.executable);build.backendSha256=await hash(join(dirname(build.executable),'dist/main/main.cjs'));build.nativeWorkerSha256=await hash(join(dirname(build.executable),'dist/bin/fpcad-worker.exe'));build.nodeSha256=await hash(join(dirname(build.executable),'dist/bin/node.exe'));
if(process.env.FPCAD_RELEASE_REQUIRE_CURRENT==='1'){const renderer=resolve('dist/renderer'),files=(await readdir(renderer,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile()).map(entry=>resolve(entry.parentPath,entry.name)).sort(),manifest=await Promise.all(files.map(async path=>({path:path.slice(renderer.length+1).replaceAll('\\','/'),sha256:await hash(path)})));build.workspaceRendererSha256=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');build.workspaceRendererFileCount=manifest.length;build.workspaceNativeWorkerSha256=await hash('target/release/fpcad-worker.exe');assert.equal(build.nativeWorkerSha256,build.workspaceNativeWorkerSha256,'release must bundle the current native worker');}
if(process.env.FPCAD_RELEASE_REQUIRE_CURRENT==='1'){build.workspaceBackendSha256=await hash('dist/main/main.cjs');assert.equal(build.backendSha256,build.workspaceBackendSha256,'release must bundle the current backend');}
const reportPath=resolve(process.env.FPCAD_RELEASE_REPORT??'test-results/tauri-release.json'),coordinates={nearZero:-5.5108101000737325e-15,large:421.31319111392395},nativeWindows=[],observations=[];
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
async function launch(){
 const server=createServer();await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const port=server.address().port;await new Promise(ok=>server.close(ok));
 const child=spawn(build.executable,['--fpcad-background-test'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,FPCAD_DATA_DIR:directory,WEBVIEW2_USER_DATA_FOLDER:join(directory,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});let log='',spawnFailure;child.on('error',error=>{spawnFailure=error;});child.stderr.on('data',b=>log+=b);child.stdout.on('data',b=>log+=b);
 let browser,lastConnectionError;const until=Date.now()+45000;while(Date.now()<until){if(spawnFailure)throw spawnFailure;if(child.exitCode!==null)throw Error('Packaged application exited: '+log);try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});break;}catch(error){lastConnectionError=error;await pause(100);}}
 if(!browser){await promisify(execFile)('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}).catch(()=>child.kill());throw Error('Packaged WebView2 connection failed: '+String(lastConnectionError)+'\nApplication log: '+log);}
 const context=browser.contexts()[0];let page;while(Date.now()<until){page=context.pages().find(p=>p.url().includes('tauri.localhost'));if(page)break;await pause(100);}assert(page);await page.waitForFunction(()=>!!window.fpcad);
 return {page,pid:child.pid,async close(){
  await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'})).catch(error=>console.error('Native close:',error));
  const deadline=Date.now()+15000;while(child.exitCode===null&&child.signalCode===null&&Date.now()<deadline)await pause(50);
  if(child.exitCode===null){console.error('Close state',await page.evaluate(()=>window.fpcad.read()).catch(String),log);child.kill();throw Error('Packaged application failed graceful close');}assert.equal(child.exitCode,0);await browser.close();
 }};
}
async function hidden(app,phase){
 const script=`Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ReleaseSmokeWindow {
 public delegate bool Callback(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb, IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder text, int count);
}
'@
$rows=[System.Collections.Generic.List[object]]::new()
[ReleaseSmokeWindow]::EnumWindows({param($h,$unused) [uint32]$owner=0; [void][ReleaseSmokeWindow]::GetWindowThreadProcessId($h,[ref]$owner); if($owner -eq ${app.pid}) { $title=[Text.StringBuilder]::new(512);$class=[Text.StringBuilder]::new(256);[void][ReleaseSmokeWindow]::GetWindowText($h,$title,512);[void][ReleaseSmokeWindow]::GetClassName($h,$class,256);$rows.Add([pscustomobject]@{handle=[long]$h;title=$title.ToString();className=$class.ToString();visible=[ReleaseSmokeWindow]::IsWindowVisible($h)}) };return $true },[IntPtr]::Zero) | Out-Null
[uint32]$foregroundOwner=0;[void][ReleaseSmokeWindow]::GetWindowThreadProcessId([ReleaseSmokeWindow]::GetForegroundWindow(),[ref]$foregroundOwner)
ConvertTo-Json -InputObject @{windows=@($rows.ToArray());foregroundOwner=$foregroundOwner} -Compress`;
 const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});const state=JSON.parse(stdout);nativeWindows.push({phase,pid:app.pid,...state});const main=state.windows.filter(w=>w.className==='Tauri Window');assert(main.length>0,'native application window must exist');assert(main.every(w=>!w.visible),'release test window must stay hidden');assert.notEqual(state.foregroundOwner,app.pid,'release must not take foreground focus');
}
function exactContour(response,phase){
 assert(response.ok,JSON.stringify(response));const project=response.data.project,piece=project.pieces.find(p=>p.name==='Fractional contour persistence');assert(piece,'The real contour piece must survive');assert.equal(piece.nodes[0].xMm,coordinates.nearZero,phase+': near-zero coordinate must retain its exact double');assert.equal(piece.nodes[1].xMm,coordinates.large,phase+': large coordinate must retain its exact double');assert.equal(piece.nodes[2].xMm,coordinates.large);assert.equal(piece.nodes[3].xMm,coordinates.nearZero);
 const calibration=project.pieces.find(p=>p.name==='100 mm calibration'),geometry=response.data.geometry.find(g=>g.id===calibration?.id);assert(geometry,'Bundled worker must return calibration geometry');assert.equal(geometry.areaMm2,10000);for(const axis of ['xMm','yMm'])assert.equal(Math.max(...geometry.cut.map(p=>p[axis]))-Math.min(...geometry.cut.map(p=>p[axis])),100,'Calibration cut must retain 100 mm dimensions at 1:1');assert(response.data.geometry.every(g=>!g.issues.some(issue=>issue.severity==='error')),'Both actual contours must remain valid');observations.push({phase,nearZero:piece.nodes[0].xMm,large:piece.nodes[1].xMm,calibrationAreaMm2:geometry.areaMm2});
}
let app,expected;const checks=[];
try{
 app=await launch();try{
  await hidden(app,'initial-launch');
  // Negative command probe only: no test_control response or debug adapter is
  // used to create, modify, save, inspect or restore application data.
  assert.equal(await app.page.evaluate(async()=>{try{await window.__TAURI_INTERNALS__.invoke('test_control',{action:'state',payload:null});return false;}catch{return true;}}),true,'release must not include automation commands');checks.push('release rejects debug test_control');
  expected=await app.page.evaluate(async coordinates=>{const r=await window.fpcad.create({name:'Packaged Tauri persistence',unit:'mm'});if(!r.ok)throw Error(JSON.stringify(r));const p=r.data.project,make=(name,points)=>({id:crypto.randomUUID(),name,color:'#22aa88',nodes:points.map(([xMm,yMm])=>({id:crypto.randomUUID(),xMm,yMm})),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'test',furRad:0}),calibration=make('100 mm calibration',[[0,0],[100,0],[100,100],[0,100]]),contour=make('Fractional contour persistence',[[coordinates.nearZero,200],[coordinates.large,200],[coordinates.large,300],[coordinates.nearZero,300]]);return window.fpcad.apply(p.id,p.revision,{type:'pieces.replace',removeIds:[],pieces:[calibration,contour]});},coordinates);exactContour(expected,'committed-command');
  for(let i=0;i<3;i++){const read=await app.page.evaluate(()=>window.fpcad.read());exactContour(read,'read-before-close-'+i);assert.deepEqual(read.data.project,expected.data.project);}
  await hidden(app,'after-real-worker-and-repeated-reads');checks.push('100 mm 1:1 real cut geometry','two exact fractional contour coordinates through command IPC and repeated reads');
 }finally{await app.close();app=undefined;}
 checks.push('graceful checkpoint');app=await launch();try{
  await hidden(app,'restart');const restored=await app.page.evaluate(()=>window.fpcad.read());exactContour(restored,'restart');assert.deepEqual(restored.data.project,expected.data.project);await hidden(app,'after-restored-read');checks.push('exact full-project and fractional-contour restart persistence');
 }finally{await app.close();app=undefined;}
 await writeFile(reportPath,JSON.stringify({passed:true,build,directory,backgroundFlag:'--fpcad-background-test',nativeWindows,coordinates,observations,checks},null,2));console.log('Hidden release, 100 mm geometry and exact contour persistence passed');
}catch(error){await writeFile(reportPath,JSON.stringify({passed:false,build,directory,backgroundFlag:'--fpcad-background-test',nativeWindows,coordinates,observations,checks,error:error.stack??String(error)},null,2));throw error;}
