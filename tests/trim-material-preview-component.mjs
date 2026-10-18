import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {mount,fixtureProject,capture,flush,id,walk} from './surface-viewport-host.mjs';

const clone=value=>JSON.parse(JSON.stringify(value)),red='#e31b23',blue='#1749de',orange='#f6a400',grey='#b9bec6';
const regions=[{name:'red-trim',color:red,points:[[10,10],[30,10],[10,30]]},{name:'blue-trim',color:blue,points:[[60,10],[80,10],[60,30]]}];
function fixtureProjectWithTrim(accepted=true){
 const p=fixtureProject(),mesh=p.surface;mesh.vertices=[mesh.vertices[0],mesh.vertices[1],mesh.vertices[3]];mesh.faces=[{id:id('lower'),vertices:mesh.vertices.map(v=>v.id),region:'sheet'}];
 p.pieces=[];p.bindings=[];
 for(const {name,color,points}of regions){
  const nodes=points.map(([xMm,yMm],i)=>({id:id(name+i),xMm,yMm})),piece={id:id(name),name,color,nodes,closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Fur',furRad:0};p.pieces.push(piece);
  p.bindings.push({pieceId:piece.id,surfaceId:mesh.id,topologyVersion:1,geometryHash:'a'.repeat(64),surfaceHash:'b'.repeat(64),report:{faceIds:[id('lower')],uv:mesh.vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm})),boundary:mesh.vertices.map(v=>v.id),areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'},trim:{vertices:clone(nodes),triangles:[{faceId:id('lower'),vertices:nodes.map(v=>v.id),barycentric:points.map(([x,y])=>[1-x/100-y/100,x/100,y/100])}],boundary:nodes.map(v=>v.id),holes:[]}});
 }
 p.surfaceRun={sourceHash:'b'.repeat(64),algorithm:'lscm-arap-1',accepted,pieces:clone(p.pieces),bindings:clone(p.bindings)};return p;
}
// Independent even-odd point-in-polygon test and fixed analytic XY regions.
// No production clipping, mapping, shape sampling, or preview helper is used.
function inside(rings,x,y){let result=false;for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;}
function worldColor(x,y){
 const view=capture();let color=view.faces.find(f=>f.id===id('lower')).color;
 assert(Array.isArray(view.markings),'GPU child must receive actual marking data');
 for(const marking of view.markings)for(const fragment of marking.fragments){if(fragment.faceId!==id('lower'))continue;const rings=fragment.rings.map(r=>r.map(w=>[w[1]*100,w[2]*100]));if(inside(rings,x,y))color=marking.color;}
 return color;
}
const expectedColor=(x,y)=>regions.find(r=>inside([r.points],x,y))?.color??grey;
function grid(probe,expected=expectedColor){let count=0;for(let x=.371;x<100;x+=1.37)for(let y=.619;y<100-x;y+=1.19){assert.equal(probe(x,y),expected(x,y),`wrong material at physical (${x},${y})`);count++;}return count;}
async function mountTrim(p=fixtureProjectWithTrim(),mode='cutting'){const f=await mount(p,{mode,controls:false});await f.click(f.button('Front'));return f;}
async function toggle(f,label,value){const node=walk(f.root).find(n=>n.tag==='label'&&n.textContent===label);assert(node,'missing '+label);node.children.find(n=>n.tag==='input').attrs['onUpdate:modelValue'](value);await flush();}
const checks=[];async function check(name,run){try{checks.push({case:name,passed:true,...await run()});}catch(error){checks.push({case:name,passed:false,error:error.stack});}}
for(const accepted of [false,true])await check((accepted?'accepted':'candidate')+' different-color trims sharing one original triangle color only their exact physical footprints',async()=>{
 const f=await mountTrim(fixtureProjectWithTrim(accepted));try{const probes=grid(worldColor);assert.equal(worldColor(15,15),red);assert.equal(worldColor(65,15),blue);assert.equal(worldColor(40,40),grey);assert.equal(capture().faces[0].color,grey);return {probes,accepted};}finally{f.app.unmount();}
});
await check('a complete binding without trim retains the full-face material color',async()=>{
 const p=fixtureProjectWithTrim();p.pieces=p.pieces.slice(0,1);p.pieces[0].color='#159447';p.bindings=p.bindings.slice(0,1);delete p.bindings[0].trim;p.surfaceRun=undefined;
 const f=await mountTrim(p);try{const probes=grid(worldColor,()=> '#159447');return {probes};}finally{f.app.unmount();}
});
for(const failure of ['stale binding','inactive piece','wrong topology version','other surface'])await check(failure+' suppresses both trim material and selected highlight',async()=>{
 const p=fixtureProjectWithTrim();p.surfaceRun=undefined;
 if(failure==='inactive piece')p.pieces=[];
 if(failure==='wrong topology version')for(const b of p.bindings)b.topologyVersion=2;
 if(failure==='other surface')for(const b of p.bindings)b.surfaceId=id('other-surface');
 const f=await mountTrim(p);try{
  if(failure==='stale binding')f.store.data.geometry=p.pieces.map(piece=>({id:piece.id,issues:[{messageKey:'STALE_BINDING',ruleId:'stale',severity:'error'}]}));
  f.props.selectedId=id('red-trim');await flush();const probes=grid(worldColor,()=>grey);assert.equal(capture().markings.length,0);return {probes};
 }finally{f.app.unmount();}
});
await check('selection highlights only the exact selected trim and leaves adjacent color and bare surface intact',async()=>{
 const f=await mountTrim();try{f.props.selectedId=id('red-trim');await flush();const probes=grid(worldColor,(x,y)=>inside([regions[0].points],x,y)?'#e89935':inside([regions[1].points],x,y)?blue:grey);return {probes};}finally{f.app.unmount();}
});
await check('material color toggle removes and restores exact trim fills',async()=>{
 const f=await mountTrim();try{await toggle(f,'Piece colors',false);const off=grid(worldColor,()=>grey);await toggle(f,'Piece colors',true);const on=grid(worldColor);assert.equal(f.calls.length,0);return {offProbes:off,onProbes:on};}finally{f.app.unmount();}
});
await check('Canvas fallback receives the same precise material paths as the GPU marking footprints',async()=>{
 const f=await mountTrim();try{
  const gpu=grid(worldColor),camera={...capture().camera};assert.equal(typeof capture().onUnavailable,'function');capture().onUnavailable();await flush();
  const view=capture();assert(view.markings instanceof Map,'fallback must receive projected fragment paths');
  const polygons=[...(view.markings.get(id('lower'))??[])].map(m=>({...m,rings:m.path.split('Z').filter(s=>s.trim()).map(r=>[...r.matchAll(/[ML]([^MLZ]+)/g)].map(match=>match[1].trim().split(',').map(Number)))}));
  const probe=(x,y)=>{let color=view.faces.find(face=>face.id===id('lower')).color,sx=(x-camera.cx)*camera.factor+camera.panX,sy=-(y-camera.cy)*camera.factor+camera.panY;for(const p of polygons)if(inside(p.rings,sx,sy))color=p.color;return color;};
  const canvas=grid(probe);return {gpuProbes:gpu,canvasProbes:canvas};
 }finally{f.app.unmount();}
});
function painted(){const p=fixtureProjectWithTrim();p.markings=[{id:id('editable-trim-paint'),name:'Editable paint',color:orange,source:'surface',sourceHash:'',surfaceHash:'',surfaceId:p.surface.id,topologyVersion:1,view:'front',offsetXmm:0,offsetYmm:0,paths:[],surfaceShape:{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],anchorFaceId:id('lower'),nodes:regions[0].points.map(([xMm,yMm])=>({xMm,yMm}))},fragments:[{faceId:id('lower'),rings:[p.bindings[0].trim.triangles[0].barycentric]}]}];return p;}
async function selectPaint(f){f.byLabel('Select attached marking').attrs['onUpdate:modelValue'](id('editable-trim-paint'));await flush();}
for(const mode of ['node draft','free transform','moving'])await check('mapping '+mode+' shows current fragments without old archived trim; cancelling restores the original',async()=>{
 const f=await mountTrim(painted(),'mapping');try{
  await selectPaint(f);const before=clone(f.store.data.project);assert.equal(worldColor(65,15),blue);let polygon;
  if(mode==='node draft'){
   await f.click(f.byLabel('Edit attached marking nodes'));await f.pointEvent('onPointerdown',10,10);await f.pointEvent('onPointermove',10,20);await f.pointEvent('onPointerup',10,20);polygon=[[10,20],[30,10],[10,30]];
  }else if(mode==='free transform'){
   await f.click(f.button('Free transform Ctrl+T'));f.byLabel('Attached marking width').attrs['onUpdate:modelValue'](10);await flush();polygon=[[15,10],[25,10],[15,30]];
  }else{
   await f.pointEvent('onPointerdown',15,15);await f.pointEvent('onPointermove',40,15);polygon=[[35,10],[55,10],[35,30]];
  }
  assert.equal(worldColor(12,12),grey,'old trim and old marking must not leave a colored footprint');assert.equal(worldColor(65,15),grey,'archive material layer is hidden during mapping edits');
  const probes=grid(worldColor,(x,y)=>inside([polygon],x,y)?orange:grey);assert.deepEqual(clone(f.store.data.project),before);assert.equal(f.calls.length,0);
  if(mode==='moving')await f.pointEvent('onPointercancel',40,15);else await f.key('Escape');
  assert.equal(worldColor(12,12),orange);assert.equal(worldColor(65,15),blue);assert.deepEqual(clone(f.store.data.project),before);assert.equal(f.calls.length,0);return {probes};
 }finally{f.app.unmount();}
});
await mkdir('test-results/current-cutting',{recursive:true});const passed=checks.every(c=>c.passed);
await writeFile('test-results/current-cutting/final-regression-trim-material-preview-component.json',JSON.stringify({passed,verification:'Actual SurfacePanel Vue custom renderer with independent analytic XY grid probes; GPU child props and Canvas fallback projected paths inspected; no Electron/build/solver',checks},null,2));console.log(JSON.stringify({passed,checks}));if(!passed)process.exitCode=1;
