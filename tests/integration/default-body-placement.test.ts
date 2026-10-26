import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {project,rectangle} from '../fixtures';
import {generateSpecies,speciesDefaults} from '../../apps/desktop/main/species';
import {assembleSpecies} from '../../apps/desktop/main/species-assembly';
import {surfaceMarking} from '../../apps/desktop/main/markings';
import {sourceSurfaceShape} from '../../packages/surface/source-drop';
import {surfaceDragShape} from '../../packages/surface/attached-edit';
import {previewFragments} from '../../packages/surface/marking-preview';
import {surfaceCornerNormals} from '../../packages/surface/rendering';

it('normal sized decals attach at visible front, back and side body sites without coplanar chart ambiguity',async()=>{
 const surface=await assembleSpecies(generateSpecies(speciesDefaults('canine','padded'))),p={...project(),surface,pieces:[],bindings:[],markings:[]};
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),normals=surfaceCornerNormals(surface),source=rectangle(80,80),worker=resolve('target/release/fpcad-worker.exe');
 const frame={origin:[0,0,0] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]};
 const rows=surface.faces.map(face=>{const t=face.vertices.map(id=>vertices.get(id)!);return {face,position:{xMm:t.reduce((s,v)=>s+v.xMm/3,0),yMm:t.reduce((s,v)=>s+v.yMm/3,0),zMm:t.reduce((s,v)=>s+v.zMm/3,0)}};});
 const evidence=[];
 for(const region of ['torso','arm-left','arm-right','leg-left','leg-right'])for(const view of ['front','back','side']){
  const candidates=rows.filter(r=>r.face.region===region&&r.position.yMm>(region==='torso'?1050:region.startsWith('arm')?1250:400)&&r.position.yMm<(region==='torso'?1350:region.startsWith('arm')?1460:800));
  const sign=region.endsWith('left')?-1:1,target=candidates.sort((a,b)=>(view==='side'?sign*(b.position.xMm-a.position.xMm):(view==='back'?-1:1)*(b.position.zMm-a.position.zMm)))[0];
  expect(target,region+' '+view).toBeDefined();
  const normal=[0,1,2].map(axis=>normals.get(target.face.id)!.reduce((s,n)=>s+n[axis]/3,0)) as [number,number,number];
  const shape=surfaceDragShape(sourceSurfaceShape(source,target.position,frame),{xMm:0,yMm:0},target.position,normal,undefined,target.face.id);
  try{const marking=await surfaceMarking(worker,p,shape,source.color,region+' '+view);expect(marking.fragments.length).toBeGreaterThan(0);
   const draft=previewFragments(surface,shape);expect(draft?.length).toBeGreaterThan(0);expect(new Set(draft!.map(f=>f.faceId))).toEqual(new Set(marking.fragments.map(f=>f.faceId)));evidence.push({region,view,ok:true});
  }catch(error){evidence.push({region,view,ok:false,error:String(error),target:{faceId:target.face.id,position:target.position,normal},shape});}
 }
 const output=resolve(process.env.FPCAD_DEFAULT_PLACEMENT_RESULTS??'test-results/default-body-placement');mkdirSync(output,{recursive:true});writeFileSync(resolve(output,'actual-targets.json'),JSON.stringify({scope:'Unchanged production-generated default padded body and original 80x80 source; all fifteen front/back/side sites, no resized source or changed target.',surface,source,evidence},null,2));
 expect(evidence.filter(e=>!e.ok)).toEqual([]);
},120000);
