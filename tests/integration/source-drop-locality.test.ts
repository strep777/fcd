import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {project,rectangle} from '../fixtures';
import {sourceSurfaceShape} from '../../packages/surface/source-drop';
import {surfaceDragShape,shapeWorld,transformShape} from '../../packages/surface/attached-edit';
import {moveContourNode} from '../../packages/surface/shape-contour';
import {previewFragments} from '../../packages/surface/marking-preview';
import {surfaceMarking} from '../../apps/desktop/main/markings';
import {editSurfaceMarking} from '../../apps/desktop/main/surface-marking-edit';
import {surfaceCornerNormals} from '../../packages/surface/rendering';
import type {Surface,Project,Marking} from '../../packages/schema/index';

const worker=resolve('target/release/fpcad-worker.exe'),frame={origin:[0,0,0] as [number,number,number],axes:[[1,0,0],[0,1,0],[0,0,1]] as [[number,number,number],[number,number,number],[number,number,number]]};
function parts(surface:Surface,fragments:Marking['fragments']){const byId=new Map(surface.faces.map(f=>[f.id,f.region]));return [...new Set(fragments.map(f=>byId.get(f.faceId)))].sort();}
function overlappingParts(){
 const p=project();p.pieces=[];p.bindings=[];p.markings=[];
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 for(const [region,z]of [['arm-left',100],['torso',0],['leg-left',-100]]as const){
  const ids=[[-40,-120],[40,-120],[40,120],[-40,120]].map(([xMm,yMm])=>{const id=randomUUID();vertices.push({id,xMm,yMm,zMm:z});return id;});
  for(const triangle of [[0,1,2],[0,2,3]])faces.push({id:randomUUID(),vertices:triangle.map(i=>ids[i]) as [string,string,string],region});
 }
 p.surface={id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces};return p;
}
it('editing an arm attachment does not preview paint through the occluding arm onto torso or leg',async()=>{
 const p=overlappingParts(),source=rectangle(30,80),position={xMm:0,yMm:0,zMm:100};
 const shape=surfaceDragShape(sourceSurfaceShape(source,position,frame),{xMm:0,yMm:0},position,[0,0,1]);
 const saved=await surfaceMarking(worker,p,shape,source.color,'Arm source drop');expect(parts(p.surface!,saved.fragments)).toEqual(['arm-left']);p.markings=[saved];
 const changed={...shape,...moveContourNode(shape,0,{xMm:shape.nodes[0].xMm+2,yMm:shape.nodes[0].yMm+2})};
 const committed=await editSurfaceMarking(worker,p,saved.id,changed);expect(parts(p.surface!,committed.fragments)).toEqual(['arm-left']);
 const draft=previewFragments(p.surface!,changed)!;
 expect(parts(p.surface!,draft),'UI draft paint must obey the same actual occlusion as persisted paint').toEqual(['arm-left']);
});

it('a dropped source cannot jump to a disconnected surface with the same part label',async()=>{
 const p=project();p.pieces=[];p.bindings=[];p.markings=[];
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 for(const [left,z]of [[0,100],[80,90]]){
  const ids=[[left,0],[left+40,0],[left+40,80],[left,80]].map(([xMm,yMm])=>{const id=randomUUID();vertices.push({id,xMm,yMm,zMm:z});return id;});
  for(const triangle of [[0,1,2],[0,2,3]])faces.push({id:randomUUID(),vertices:triangle.map(i=>ids[i]) as [string,string,string],region:'arm-left'});
 }
 p.surface={id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces};
 const source=rectangle(160,40),position={xMm:20,yMm:30,zMm:100};
 const original=sourceSurfaceShape(source,position,frame);
 const shape=surfaceDragShape({...original,regions:['arm-left']},{xMm:0,yMm:0},position,[0,0,1],'arm-left',faces[0].id);
 const saved=await surfaceMarking(worker,p,shape,source.color,'One disconnected arm sheet');p.markings=[saved];
 const changed={...shape,...moveContourNode(shape,0,{xMm:shape.nodes[0].xMm+1,yMm:shape.nodes[0].yMm+1})};
 const edited=await editSurfaceMarking(worker,p,saved.id,changed),draft=previewFragments(p.surface,changed)!;
 const allowed=new Set(faces.slice(0,2).map(f=>f.id));
 for(const fragments of [saved.fragments,edited.fragments,draft]){expect(fragments.length).toBeGreaterThan(0);expect(fragments.every(f=>allowed.has(f.faceId)),'all paint must stay on the surface sheet picked by the drop').toBe(true);}
});

const actualPath=resolve('test-results/current-task/real-cut-project.json');
(existsSync(actualPath)?it:it.skip)('the actual region17 source dropped on an arm has no remote torso/leg fragments',async()=>{
 const input=JSON.parse(readFileSync(actualPath,'utf8')) as Project;
 const source=input.patternLibrary!.find(r=>r.view==='front'&&r.piece.name.endsWith('/ 17'))!.piece;
 const p={...structuredClone(input),pieces:[],bindings:[],markings:[]} as Project,mesh=p.surface!;
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v])),normals=surfaceCornerNormals(mesh),evidence=[];
 const faceData=mesh.faces.map(face=>({face,t:face.vertices.map(id=>vertices.get(id)!)}));
 const observed=(position:{xMm:number;yMm:number;zMm:number},region:string)=>{
  let best=-Infinity,owner='';
  for(const {face,t}of faceData){const [a,b,c]=t,det=(b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm);if(Math.abs(det)<1e-9)continue;
   const u=((position.xMm-a.xMm)*(c.yMm-a.yMm)-(position.yMm-a.yMm)*(c.xMm-a.xMm))/det,v=((b.xMm-a.xMm)*(position.yMm-a.yMm)-(b.yMm-a.yMm)*(position.xMm-a.xMm))/det;
   if(u<0||v<0||u+v>1)continue;const depth=(1-u-v)*a.zMm+u*b.zMm+v*c.zMm;if(depth>best){best=depth;owner=face.region;}
  }return owner===region;
 };
 // Front-visible faces along both upper arms provide actual observed targets.
 for(const region of ['arm-left','arm-right']){
  const candidates=mesh.faces.filter(f=>f.region===region).map(face=>{const t=face.vertices.map(id=>vertices.get(id)!);return {face,t,position:{xMm:t.reduce((s,v)=>s+v.xMm/3,0),yMm:t.reduce((s,v)=>s+v.yMm/3,0),zMm:t.reduce((s,v)=>s+v.zMm/3,0)}};}).filter(v=>v.position.zMm>5&&observed(v.position,region));
  const targets=[
   {name:'middle',target:candidates.filter(v=>Math.abs(v.position.xMm)>250&&Math.abs(v.position.xMm)<450).sort((a,b)=>b.position.zMm-a.position.zMm)[0]},
   {name:'shoulder',target:[...candidates].sort((a,b)=>Math.abs(a.position.xMm)-Math.abs(b.position.xMm))[0]},
   {name:'side silhouette',target:[...candidates].filter(v=>Math.abs(v.position.xMm)>250&&Math.abs(v.position.xMm)<700).sort((a,b)=>a.position.zMm-b.position.zMm)[0]}
  ];
  for(const {name,target}of targets)for(const grab of ['center','lower']as const){expect(target).toBeDefined();
  const normal=[0,1,2].map(axis=>normals.get(target.face.id)!.reduce((s,n)=>s+n[axis]/3,0)) as [number,number,number];
  // This is the current dropSource business chain, preserving calibrated size.
  const anchor=grab==='lower'?{xMm:(Math.min(...source.nodes.map(n=>n.xMm))+Math.max(...source.nodes.map(n=>n.xMm)))/2,yMm:Math.min(...source.nodes.map(n=>n.yMm))+20}:undefined;
  const original=sourceSurfaceShape(source,target.position,frame,anchor);
  const shape=surfaceDragShape({...original,regions:[region]},{xMm:0,yMm:0},target.position,normal,region,target.face.id);
  const saved=await surfaceMarking(worker,p,shape,source.color,source.name);
  const changed={...shape,...moveContourNode(shape,0,{xMm:shape.nodes[0].xMm+2,yMm:shape.nodes[0].yMm+2})};
  p.markings=[saved];const edited=await editSurfaceMarking(worker,p,saved.id,changed),draft=previewFragments(mesh,changed);
  evidence.push({region,target:name,grab,targetFace:target.face.id,position:target.position,normal,shape,savedParts:parts(mesh,saved.fragments),editedParts:parts(mesh,edited.fragments),draftParts:draft&&parts(mesh,draft),editedNodeWorld:shapeWorld(changed,changed.nodes[0])});
  }
 }
 const output=resolve('test-results/current-task-2');mkdirSync(output,{recursive:true});writeFileSync(resolve(output,'source-region17-locality.json'),JSON.stringify(evidence,null,2));
 for(const e of evidence){expect(e.savedParts,`${e.region} original drop`).toEqual([e.region]);expect(e.editedParts,`${e.region} edited drop`).toEqual([e.region]);expect(e.draftParts,`${e.region} live node draft`).toEqual([e.region]);}
},120000);

it('shrinking an attachment can leave the original picked triangle while staying on its connected sheet',async()=>{
 const p=project();p.pieces=[];const vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 for(let y=0;y<=10;y++)for(let x=0;x<=10;x++)vertices.push({id:randomUUID(),xMm:x*10,yMm:y*10,zMm:0});
 for(let y=0;y<10;y++)for(let x=0;x<10;x++){const a=y*11+x,b=a+1,c=a+11,d=c+1;for(const ids of [[a,b,d],[a,d,c]])faces.push({id:randomUUID(),vertices:ids.map(i=>vertices[i].id) as [string,string,string],region:'panel'});}
 p.surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces};
 const shape={...frame,regions:['panel'],anchorFaceId:faces[0].id,nodes:[{xMm:1,yMm:1},{xMm:90,yMm:1},{xMm:90,yMm:90},{xMm:1,yMm:90}]};
 const shrunk=transformShape(shape,.2,.2,0),marking=await surfaceMarking(worker,p,shrunk,'#cc3311','Resized');
 expect(marking.fragments.length).toBeGreaterThan(0);expect(marking.fragments.some(f=>f.faceId===faces[0].id)).toBe(false);
 expect(previewFragments(p.surface,shrunk)!.map(f=>f.faceId).sort()).toEqual(marking.fragments.map(f=>f.faceId).sort());
});
