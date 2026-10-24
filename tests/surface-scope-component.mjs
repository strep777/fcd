import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {mount,fixtureProject,capture,flush,id} from './surface-viewport-host.mjs';
const checks=[];
for(const rect of [{x:0,y:0,width:720,height:540},{x:137,y:58,width:1020,height:420}]){
 const p=fixtureProject(),nodes=[{xMm:20,yMm:20},{xMm:80,yMm:20},{xMm:80,yMm:80}],shape={nodes,origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],anchorFaceId:id('lower'),regions:['lower-part']};
 p.markings=[{id:id('scoped-marking'),name:'Scoped ear',color:'#2288cc',source:'surface',sourceHash:'',surfaceHash:'',surfaceId:p.surface.id,topologyVersion:1,view:'front',offsetXmm:0,offsetYmm:0,paths:[],surfaceShape:shape,fragments:[{faceId:id('lower'),rings:[[[.8,0,.2],[.2,.6,.2],[.2,0,.8]]]}]}];const calls=[];
 const f=await mount(p,{mode:'mapping',rect,controls:false,api:{editSurfaceMarking:async(...args)=>{calls.push(args);return {ok:true,data:{...JSON.parse(JSON.stringify(f.store.data)),project:{...JSON.parse(JSON.stringify(f.store.data.project)),revision:2}}};}}});
 try{
  await f.click(f.button('Front'));f.byLabel('Select attached marking').attrs['onUpdate:modelValue'](id('scoped-marking'));await flush();await f.click(f.byLabel('Edit attached marking nodes'));const handles=capture().handles;assert.equal(handles.length,3);const saved=JSON.parse(JSON.stringify(f.store.data.project)),before={...handles[1]},scale=Math.min(rect.width/720,rect.height/540),center={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  const down={x:center.x+(before.x+2)*scale,y:center.y+(before.y-1)*scale};await f.event('onPointerdown',down.x,down.y);await f.event('onPointermove',down.x,down.y);assert(Math.hypot(capture().handles[1].x-before.x,capture().handles[1].y-before.y)<1e-8,'stationary off-centre knot grab does not snap it to cursor');
  await f.event('onPointermove',down.x+12*scale,down.y-6*scale);assert(Math.hypot(capture().handles[1].x-before.x-12,capture().handles[1].y-before.y+6)<1e-7,'grab offset survives drag at resized viewport');await f.event('onPointerup',down.x+12*scale,down.y-6*scale);assert.deepEqual(f.store.data.project,saved,'live scoped edit remains uncommitted');
  await f.click(f.button('Confirm marking edit'));assert.equal(calls.length,1);assert.deepEqual(calls[0].slice(0,3),[id('project'),1,id('scoped-marking')]);assert.equal(calls[0][3].anchorFaceId,id('lower'));assert.deepEqual(calls[0][3].regions,['lower-part']);assert.notDeepEqual(calls[0][3].nodes,nodes);assert.deepEqual(calls[0][3].origin,shape.origin);checks.push({case:`${rect.width}x${rect.height}: off-centre node grab and real edit IPC preserve anchorFaceId/regions`,passed:true});
 }finally{f.app.unmount();}
}
await writeFile('test-results/surface-scope-component.json',JSON.stringify({passed:true,verification:'Actual SurfacePanel SFC, pointer callbacks and edit IPC contract; custom DOM/GPU host, not WebView2 pixels',checks},null,2));console.log(JSON.stringify({passed:true,checks}));
